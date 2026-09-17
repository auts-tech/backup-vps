import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Notifier } from './notifier.js';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Dynamic multi-project backup engine.
 * Reads project configs and performs database dumps, file archives, env backups.
 * Supports Google Drive (rclone), S3, and SFTP targets.
 */
export class BackupEngine {
  static runningBackups = new Map(); // projectId -> { status, startTime, progress }

  static getConfig() {
    const configPath = join(__dirname, '..', 'data', 'config.json');
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  }

  static getLogFile() {
    return '/var/log/vps-backup-manager.log';
  }

  static log(message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    try {
      appendFileSync(BackupEngine.getLogFile(), line);
    } catch {
      // Fallback to console if log file not writable
    }
    console.log(`[Backup] ${message}`);
  }

  /**
   * Trigger backup for a specific project
   */
  static async backupProject(projectId, targetOverride) {
    const config = BackupEngine.getConfig();
    const project = config.projects.find(p => p.id === projectId);

    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    if (BackupEngine.runningBackups.has(projectId)) {
      return { success: false, error: 'Backup already running for this project' };
    }

    const backupId = `${project.name}-${Date.now()}`;
    const target = targetOverride || config.backup.defaultTarget;

    BackupEngine.runningBackups.set(projectId, {
      backupId,
      status: 'running',
      startTime: Date.now(),
      progress: 'Starting...',
      project: project.name
    });

    // Run backup asynchronously
    BackupEngine._executeBackup(project, backupId, target, config)
      .then(result => {
        BackupEngine.runningBackups.set(projectId, {
          backupId,
          status: 'completed',
          startTime: BackupEngine.runningBackups.get(projectId)?.startTime,
          endTime: Date.now(),
          result,
          project: project.name
        });

        // Auto-clear after 5 minutes
        setTimeout(() => BackupEngine.runningBackups.delete(projectId), 300000);
      })
      .catch(err => {
        BackupEngine.runningBackups.set(projectId, {
          backupId,
          status: 'failed',
          startTime: BackupEngine.runningBackups.get(projectId)?.startTime,
          endTime: Date.now(),
          error: err.message,
          project: project.name
        });
        setTimeout(() => BackupEngine.runningBackups.delete(projectId), 300000);
      });

    return { success: true, backupId, message: 'Backup started' };
  }

  /**
   * Trigger backup for all projects
   */
  static async backupAll(targetOverride) {
    const config = BackupEngine.getConfig();
    const results = [];
    for (const project of config.projects) {
      const result = await BackupEngine.backupProject(project.id, targetOverride);
      results.push({ project: project.name, ...result });
    }
    return results;
  }

  /**
   * Execute the actual backup
   */
  static async _executeBackup(project, backupId, target, config) {
    const date = new Date().toISOString().replace(/[T:]/g, '-').substring(0, 16);
    const backupDir = `/tmp/vps-backup-${project.name}-${date}`;
    const sizes = {};

    try {
      await execAsync(`mkdir -p "${backupDir}"`);

      // 1. Database dump
      if (project.database && project.database.name) {
        BackupEngine.log(`[${project.name}] Dumping database: ${project.database.name}`);
        BackupEngine.runningBackups.get(project.id).progress = 'Dumping database...';

        const dbType = project.database.type || 'mysql';
        let dumpCmd;
        if (dbType === 'mysql' || dbType === 'mariadb') {
          dumpCmd = `mysqldump -u"${project.database.user}" -p"${project.database.password}" --single-transaction --routines --triggers --events "${project.database.name}" 2>/dev/null | gzip > "${backupDir}/db_${date}.sql.gz"`;
        } else if (dbType === 'postgres') {
          dumpCmd = `PGPASSWORD="${project.database.password}" pg_dump -U "${project.database.user}" -h localhost "${project.database.name}" 2>/dev/null | gzip > "${backupDir}/db_${date}.sql.gz"`;
        }

        if (dumpCmd) {
          await execAsync(dumpCmd, { timeout: 300000 });
          const { stdout: dbSize } = await execAsync(`du -sh "${backupDir}/db_${date}.sql.gz" | cut -f1`);
          sizes.database = dbSize.trim();
          BackupEngine.log(`[${project.name}] DB dump complete: ${sizes.database}`);
        }
      }

      // 2. Backup directories
      if (project.backupDirs && project.backupDirs.length > 0) {
        BackupEngine.log(`[${project.name}] Archiving directories...`);
        BackupEngine.runningBackups.get(project.id).progress = 'Archiving files...';

        for (const dir of project.backupDirs) {
          if (existsSync(dir)) {
            const dirName = dir.replace(/\//g, '_').replace(/^_/, '');
            await execAsync(
              `tar czf "${backupDir}/files_${dirName}_${date}.tar.gz" -C "$(dirname "${dir}")" "$(basename "${dir}")"`,
              { timeout: 600000 }
            );
          } else {
            BackupEngine.log(`[${project.name}] WARNING: Directory not found: ${dir}`);
          }
        }
        const { stdout: filesSize } = await execAsync(`du -sh "${backupDir}" | cut -f1`);
        sizes.files = filesSize.trim();
      }

      // 3. Backup .env file
      if (project.deployPath) {
        const envPath = join(project.deployPath, '.env');
        if (existsSync(envPath)) {
          BackupEngine.log(`[${project.name}] Backing up .env`);
          await execAsync(`cp "${envPath}" "${backupDir}/env_${date}.env"`);
        }
      }

      // 4. Upload to target
      BackupEngine.runningBackups.get(project.id).progress = 'Uploading...';
      await BackupEngine._uploadToTarget(backupDir, project, date, target, config);

      // 5. Cleanup
      await execAsync(`rm -rf "${backupDir}"`);

      const endTime = Date.now();
      const startTime = BackupEngine.runningBackups.get(project.id)?.startTime || endTime;
      const duration = Math.round((endTime - startTime) / 1000);

      BackupEngine.log(`[${project.name}] Backup completed in ${duration}s`);

      // Send success notification
      await Notifier.notifyAll(config, {
        title: `✅ ${project.name} Backup Success`,
        message: `Backup completed successfully\n📅 Date: ${date}\n💾 Database: ${sizes.database || 'N/A'}\n📁 Files: ${sizes.files || 'N/A'}\n⏱️ Duration: ${duration}s`,
        color: 3066993,
        emailSubject: `✅ ${project.name} Backup Success — ${date}`,
        emailBody: `Backup completed successfully.\n\nProject: ${project.name}\nDate: ${date}\nDatabase: ${sizes.database || 'N/A'}\nFiles: ${sizes.files || 'N/A'}\nDuration: ${duration}s`
      });

      return { sizes, duration, target };

    } catch (err) {
      BackupEngine.log(`[${project.name}] BACKUP FAILED: ${err.message}`);
      await execAsync(`rm -rf "${backupDir}"`).catch(() => {});

      // Send failure notification
      await Notifier.notifyAll(config, {
        title: `❌ ${project.name} Backup FAILED`,
        message: `Backup failed!\n📅 Date: ${date}\n❗ Error: ${err.message}`,
        color: 15158332,
        emailSubject: `❌ ${project.name} Backup FAILED — ${date}`,
        emailBody: `Backup failed.\n\nProject: ${project.name}\nError: ${err.message}`
      });

      throw err;
    }
  }

  /**
   * Upload backup to configured target
   */
  static async _uploadToTarget(backupDir, project, date, target, config) {
    const targetConfig = config.backup.targets[target];
    if (!targetConfig || !targetConfig.enabled) {
      BackupEngine.log(`Target '${target}' not configured, skipping upload`);
      return;
    }

    if (target === 'gdrive') {
      const remotePath = `${targetConfig.remoteName}:${targetConfig.basePath}/${project.name}/${date}/`;
      BackupEngine.log(`Uploading to Google Drive: ${remotePath}`);
      await execAsync(
        `rclone copy "${backupDir}" "${remotePath}" --drive-chunk-size=64M --transfers=2 --retries=5 --retries-sleep=10s`,
        { timeout: 1800000 }
      );
    } else if (target === 's3') {
      const s3Path = `s3://${targetConfig.bucket}/${targetConfig.basePath}/${project.name}/${date}/`;
      BackupEngine.log(`Uploading to S3: ${s3Path}`);
      await execAsync(
        `AWS_ACCESS_KEY_ID="${targetConfig.accessKey}" AWS_SECRET_ACCESS_KEY="${targetConfig.secretKey}" aws s3 cp "${backupDir}" "${s3Path}" --recursive --region "${targetConfig.region}"`,
        { timeout: 1800000 }
      );
    } else if (target === 'sftp') {
      const remotePath = `${targetConfig.basePath}/${project.name}/${date}/`;
      BackupEngine.log(`Uploading via SFTP to ${targetConfig.host}:${remotePath}`);
      await execAsync(
        `scp -r -P ${targetConfig.port} -i "${targetConfig.keyPath}" "${backupDir}"/* ${targetConfig.user}@${targetConfig.host}:"${remotePath}"`,
        { timeout: 1800000 }
      );
    }
  }

  /**
   * Full VPS snapshot (everything except system dirs)
   */
  static async snapshotVPS(targetOverride) {
    const config = BackupEngine.getConfig();
    const target = targetOverride || config.backup.defaultTarget;
    const date = new Date().toISOString().replace(/[T:]/g, '-').substring(0, 16);
    const snapshotDir = `/tmp/vps-snapshot-${date}`;
    const snapshotId = `vps-snapshot-${Date.now()}`;

    BackupEngine.runningBackups.set('vps-snapshot', {
      backupId: snapshotId,
      status: 'running',
      startTime: Date.now(),
      progress: 'Creating VPS snapshot...',
      project: 'VPS Snapshot'
    });

    try {
      await execAsync(`mkdir -p "${snapshotDir}"`);

      BackupEngine.log('[VPS Snapshot] Creating full server backup...');
      await execAsync(
        `tar czf "${snapshotDir}/vps_snapshot_${date}.tar.gz" --exclude='/proc' --exclude='/sys' --exclude='/dev' --exclude='/run' --exclude='/tmp' --exclude='/var/cache' --exclude='/snap' --exclude='/boot' --exclude='/lost+found' / 2>/dev/null || true`,
        { timeout: 7200000 }
      );

      const targetConfig = config.backup.targets[target];
      if (targetConfig && targetConfig.enabled) {
        if (target === 'gdrive') {
          await execAsync(
            `rclone copy "${snapshotDir}" "${targetConfig.remoteName}:${targetConfig.basePath}/vps-snapshots/${date}/" --drive-chunk-size=128M --transfers=2 --retries=5`,
            { timeout: 7200000 }
          );
        }
      }

      await execAsync(`rm -rf "${snapshotDir}"`);

      BackupEngine.runningBackups.set('vps-snapshot', {
        backupId: snapshotId, status: 'completed', endTime: Date.now(), project: 'VPS Snapshot'
      });
      setTimeout(() => BackupEngine.runningBackups.delete('vps-snapshot'), 300000);

      return { success: true, snapshotId };
    } catch (err) {
      BackupEngine.runningBackups.set('vps-snapshot', {
        backupId: snapshotId, status: 'failed', error: err.message, project: 'VPS Snapshot'
      });
      await execAsync(`rm -rf "${snapshotDir}"`).catch(() => {});
      throw err;
    }
  }

  /**
   * List backups from remote storage
   */
  static async listBackups(projectName) {
    const config = BackupEngine.getConfig();
    const target = config.backup.defaultTarget;
    const targetConfig = config.backup.targets[target];

    if (!targetConfig || !targetConfig.enabled) {
      return [];
    }

    try {
      let remotePath;
      if (target === 'gdrive') {
        remotePath = projectName
          ? `${targetConfig.remoteName}:${targetConfig.basePath}/${projectName}/`
          : `${targetConfig.remoteName}:${targetConfig.basePath}/`;
      }

      const { stdout } = await execAsync(
        `rclone lsjson "${remotePath}" --dirs-only 2>/dev/null || echo "[]"`,
        { timeout: 30000 }
      );

      const dirs = JSON.parse(stdout);
      return dirs.map(d => ({
        name: d.Name,
        path: d.Path,
        date: d.ModTime,
        isDir: d.IsDir
      })).sort((a, b) => b.name.localeCompare(a.name));
    } catch {
      return [];
    }
  }

  /**
   * Restore a backup
   */
  static async restoreBackup(projectId, backupDate, options = {}) {
    const config = BackupEngine.getConfig();
    const project = config.projects.find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const target = config.backup.defaultTarget;
    const targetConfig = config.backup.targets[target];
    const restoreDir = `/tmp/vps-restore-${Date.now()}`;

    try {
      await execAsync(`mkdir -p "${restoreDir}"`);

      // Download backup
      if (target === 'gdrive') {
        const remotePath = `${targetConfig.remoteName}:${targetConfig.basePath}/${project.name}/${backupDate}/`;
        await execAsync(`rclone copy "${remotePath}" "${restoreDir}" --transfers=4`, { timeout: 1800000 });
      }

      // Restore database
      if (options.restoreDb !== false) {
        const dbDump = (await execAsync(`ls "${restoreDir}"/db_*.sql.gz 2>/dev/null || echo ""`)).stdout.trim();
        if (dbDump) {
          BackupEngine.log(`Restoring database for ${project.name}`);
          const dbType = project.database?.type || 'mysql';
          if (dbType === 'mysql' || dbType === 'mariadb') {
            await execAsync(
              `gunzip < "${dbDump}" | mysql -u"${project.database.user}" -p"${project.database.password}" "${project.database.name}"`,
              { timeout: 600000 }
            );
          }
        }
      }

      // Restore files
      if (options.restoreFiles !== false) {
        const archives = (await execAsync(`ls "${restoreDir}"/files_*.tar.gz 2>/dev/null || echo ""`)).stdout.trim();
        if (archives) {
          for (const archive of archives.split('\n').filter(Boolean)) {
            BackupEngine.log(`Restoring files from ${archive}`);
            await execAsync(`tar xzf "${archive}" -C "${project.deployPath || '/'}"`, { timeout: 600000 });
          }
        }
      }

      // Restore .env
      if (options.restoreEnv !== false) {
        const envFile = (await execAsync(`ls "${restoreDir}"/env_*.env 2>/dev/null || echo ""`)).stdout.trim();
        if (envFile && project.deployPath) {
          await execAsync(`cp "${envFile}" "${project.deployPath}/.env"`);
        }
      }

      await execAsync(`rm -rf "${restoreDir}"`);
      return { success: true, message: 'Restore completed' };
    } catch (err) {
      await execAsync(`rm -rf "${restoreDir}"`).catch(() => {});
      return { success: false, error: err.message };
    }
  }

  /**
   * Get status of running backups
   */
  static getStatus() {
    const status = {};
    for (const [key, value] of BackupEngine.runningBackups) {
      status[key] = value;
    }
    return status;
  }

  /**
   * Clean up old backups based on retention policy
   */
  static async cleanupOldBackups(projectName) {
    const config = BackupEngine.getConfig();
    const target = config.backup.defaultTarget;
    const targetConfig = config.backup.targets[target];
    const retentionDays = config.backup.retentionDays || 30;

    if (target !== 'gdrive' || !targetConfig.enabled) return;

    try {
      const remotePath = projectName
        ? `${targetConfig.remoteName}:${targetConfig.basePath}/${projectName}/`
        : `${targetConfig.remoteName}:${targetConfig.basePath}/`;

      const { stdout } = await execAsync(`rclone lsd "${remotePath}" 2>/dev/null || echo ""`);
      const dirs = stdout.trim().split('\n').filter(Boolean);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoff = cutoffDate.toISOString().substring(0, 10);

      for (const dirLine of dirs) {
        const dirName = dirLine.trim().split(/\s+/).pop();
        if (dirName && dirName < cutoff) {
          BackupEngine.log(`Deleting old backup: ${dirName}`);
          await execAsync(`rclone purge "${remotePath}${dirName}" 2>/dev/null`).catch(() => {});
        }
      }
    } catch (err) {
      BackupEngine.log(`Cleanup error: ${err.message}`);
    }
  }
}
