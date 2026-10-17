import { exec, spawn } from "child_process";
import { promisify } from "util";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  statSync,
  readdirSync,
  createReadStream,
  createWriteStream,
  copyFileSync,
  rmSync,
} from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { createGzip, createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { Notifier } from "./notifier.js";
import { MysqlManager } from "./mysql-manager.js";
import { JobRunner } from "./job-runner.js";
import { cleanEnv, run } from "../lib/shell.js";
import { httpError } from "../lib/config.js";

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Rebuildable folders left out of file archives unless a website overrides it
export const DEFAULT_BACKUP_EXCLUDES = ["node_modules"];

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function folderSize(dir) {
  let total = 0;
  for (const f of readdirSync(dir)) total += statSync(join(dir, f)).size;
  return total;
}

/**
 * Dynamic multi-project backup engine.
 * Reads project configs and performs database dumps, file archives, env backups.
 * Supports Google Drive (rclone), S3, and SFTP targets.
 */
export class BackupEngine {
  static runningBackups = new Map(); // projectId -> { status, startTime, progress }
  static pending = new Map(); // backupId -> promise resolving when the backup finishes

  static getConfig() {
    const configPath = join(__dirname, "..", "data", "config.json");
    return JSON.parse(readFileSync(configPath, "utf-8"));
  }

  static getLogFile() {
    return "/var/log/vps-backup-manager.log";
  }

  static getRcloneConfigFlag() {
    const candidates = [
      join(__dirname, "..", "..", "rclone.conf"),
      "/root/.config/rclone/rclone.conf",
      process.env.HOME
        ? join(process.env.HOME, ".config", "rclone", "rclone.conf")
        : null,
    ].filter(Boolean);

    for (const c of candidates) {
      if (existsSync(c)) {
        return `--config="${c}"`;
      }
    }
    return "";
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

  static logNotificationResults(results) {
    for (const [channel, result] of Object.entries(results || {})) {
      if (!result.success)
        BackupEngine.log(
          `Notification ${channel} failed: ${result.error || "unknown error"}`,
        );
    }
  }

  /**
   * Trigger backup for a specific project
   */
  static async backupProject(projectId, targetOverride) {
    const config = BackupEngine.getConfig();
    const project = config.projects.find((p) => p.id === projectId);

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    // Finished entries stay visible for 5 minutes; only a *running* one blocks a new backup
    if (BackupEngine.runningBackups.get(projectId)?.status === "running") {
      return {
        success: false,
        error: "Backup already running for this project",
      };
    }

    const backupId = `${project.name}-${Date.now()}`;
    const target = targetOverride || config.backup.defaultTarget;
    const startTime = Date.now();

    BackupEngine.runningBackups.set(projectId, {
      backupId,
      status: "running",
      startTime,
      progress: "Starting...",
      project: project.name,
    });

    // Clear this backup's status entry later, unless a newer backup replaced it
    const clearLater = () =>
      setTimeout(() => {
        if (BackupEngine.runningBackups.get(projectId)?.backupId === backupId) {
          BackupEngine.runningBackups.delete(projectId);
        }
      }, 300000).unref();

    // Run backup asynchronously
    const promise = BackupEngine._executeBackup(
      project,
      backupId,
      target,
      config,
    )
      .then((result) => {
        BackupEngine.runningBackups.set(projectId, {
          backupId,
          status: "completed",
          startTime,
          endTime: Date.now(),
          result,
          project: project.name,
        });
        clearLater();
        return { success: true, result };
      })
      .catch((err) => {
        BackupEngine.runningBackups.set(projectId, {
          backupId,
          status: "failed",
          startTime,
          endTime: Date.now(),
          error: err.message,
          project: project.name,
        });
        clearLater();
        return { success: false, error: err.message };
      });
    BackupEngine.pending.set(backupId, promise);
    promise.finally(() => BackupEngine.pending.delete(backupId));

    return { success: true, backupId, message: "Backup started" };
  }

  /**
   * Wait for every backup started in this process to finish (used by the CLI).
   */
  static async waitForAll() {
    return Promise.all([...BackupEngine.pending.values()]);
  }

  static setProgress(projectId, progress) {
    const entry = BackupEngine.runningBackups.get(projectId);
    if (entry) entry.progress = progress;
  }

  /**
   * Trigger backup for all projects
   */
  static async backupAll(targetOverride) {
    const config = BackupEngine.getConfig();
    const results = [];
    for (const project of config.projects) {
      const result = await BackupEngine.backupProject(
        project.id,
        targetOverride,
      );
      results.push({ project: project.name, ...result });
    }
    return results;
  }

  /**
   * Execute the actual backup
   */
  static async _executeBackup(project, backupId, target, config) {
    const date = new Date()
      .toISOString()
      .replace(/[T:]/g, "-")
      .substring(0, 16);
    const backupDir = `/tmp/vps-backup-${project.name}-${date}`;
    const sizes = {};

    try {
      await execAsync(`mkdir -p "${backupDir}"`);

      // 1. Database dump
      if (project.database && project.database.name) {
        BackupEngine.log(
          `[${project.name}] Dumping database: ${project.database.name}`,
        );
        BackupEngine.setProgress(project.id, "Dumping database...");

        const dbType = project.database.type || "mysql";
        const out = join(backupDir, `db_${date}.sql.gz`);
        if (dbType === "mysql" || dbType === "mariadb") {
          await BackupEngine._dumpMysql(project.database, out, backupDir);
        } else if (dbType === "postgres") {
          await BackupEngine._dumpPostgres(project.database, out);
        }
        if (existsSync(out)) {
          sizes.database = formatBytes(statSync(out).size);
          BackupEngine.log(
            `[${project.name}] DB dump complete: ${sizes.database}`,
          );
        }
      }

      // 2. Backup directories (rebuildable folders such as node_modules are skipped)
      if (project.backupDirs && project.backupDirs.length > 0) {
        BackupEngine.log(`[${project.name}] Archiving directories...`);
        BackupEngine.setProgress(project.id, "Archiving files...");
        const excludes = Array.isArray(project.backupExcludes)
          ? project.backupExcludes
          : DEFAULT_BACKUP_EXCLUDES;

        for (const dir of project.backupDirs) {
          if (existsSync(dir)) {
            const dirName = dir.replace(/\//g, "_").replace(/^_/, "");
            const r = await run(
              "tar",
              [
                "czf",
                join(backupDir, `files_${dirName}_${date}.tar.gz`),
                ...excludes.flatMap((e) => [`--exclude=${e}`]),
                "-C",
                dirname(dir),
                basename(dir),
              ],
              { timeout: 3600000 },
            );
            // exit 1 = "file changed as we read it": the archive is still usable
            if (r.code !== 0 && r.code !== 1)
              throw new Error(`Archiving ${dir} failed: ${r.stderr.trim()}`);
          } else {
            BackupEngine.log(
              `[${project.name}] WARNING: Directory not found: ${dir}`,
            );
          }
        }
        sizes.files = formatBytes(folderSize(backupDir));
      }

      // 3. Backup .env file
      if (project.deployPath) {
        const envPath = join(project.deployPath, ".env");
        if (existsSync(envPath)) {
          BackupEngine.log(`[${project.name}] Backing up .env`);
          copyFileSync(envPath, join(backupDir, `env_${date}.env`));
        }
      }

      // 4. Upload to target
      BackupEngine.setProgress(project.id, "Uploading...");
      await BackupEngine._uploadToTarget(
        backupDir,
        project,
        date,
        target,
        config,
      );

      // 5. Cleanup
      await execAsync(`rm -rf "${backupDir}"`);

      const endTime = Date.now();
      const startTime =
        BackupEngine.runningBackups.get(project.id)?.startTime || endTime;
      const duration = Math.round((endTime - startTime) / 1000);

      BackupEngine.log(`[${project.name}] Backup completed in ${duration}s`);

      // Send success notification
      const notifications = await Notifier.notifyAll(config, {
        title: `✅ ${project.name} Backup Success`,
        message: `Backup completed successfully\n📅 Date: ${date}\n💾 Database: ${sizes.database || "N/A"}\n📁 Files: ${sizes.files || "N/A"}\n⏱️ Duration: ${duration}s`,
        color: 3066993,
        emailSubject: `✅ ${project.name} Backup Success — ${date}`,
        emailBody: `Backup completed successfully.\n\nProject: ${project.name}\nDate: ${date}\nDatabase: ${sizes.database || "N/A"}\nFiles: ${sizes.files || "N/A"}\nDuration: ${duration}s`,
      });
      BackupEngine.logNotificationResults(notifications);

      return { sizes, duration, target };
    } catch (err) {
      BackupEngine.log(`[${project.name}] BACKUP FAILED: ${err.message}`);
      await execAsync(`rm -rf "${backupDir}"`).catch(() => {});

      // Send failure notification
      const notifications = await Notifier.notifyAll(config, {
        title: `❌ ${project.name} Backup FAILED`,
        message: `Backup failed!\n📅 Date: ${date}\n❗ Error: ${err.message}`,
        color: 15158332,
        emailSubject: `❌ ${project.name} Backup FAILED — ${date}`,
        emailBody: `Backup failed.\n\nProject: ${project.name}\nError: ${err.message}`,
      });
      BackupEngine.logNotificationResults(notifications);

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

    if (target === "gdrive") {
      const remotePath = `${targetConfig.remoteName}:${targetConfig.basePath}/${project.name}/${date}/`;
      BackupEngine.log(`Uploading to Google Drive: ${remotePath}`);
      const cfg = BackupEngine.getRcloneConfigFlag();
      try {
        await execAsync(
          `rclone copy "${backupDir}" "${remotePath}" ${cfg} --drive-chunk-size=64M --transfers=2 --retries=3 --retries-sleep=5s --drive-acknowledge-abuse`,
          { timeout: 1800000 },
        );
      } catch (err) {
        if (err.message && err.message.includes("storageQuotaExceeded")) {
          const helpfulMsg =
            "Google Drive Error 403: Service Accounts do not have storage quota on personal Google Drives. Solution: Go to Settings > Google Drive and use an OAuth Token in rclone.conf instead of a service account, or use a Google Workspace Shared Drive.";
          BackupEngine.log(`[Error] ${helpfulMsg}`);
          throw new Error(helpfulMsg);
        }
        throw err;
      }
    } else if (target === "s3") {
      const s3Path = `s3://${targetConfig.bucket}/${targetConfig.basePath}/${project.name}/${date}/`;
      BackupEngine.log(`Uploading to S3: ${s3Path}`);
      await execAsync(
        `AWS_ACCESS_KEY_ID="${targetConfig.accessKey}" AWS_SECRET_ACCESS_KEY="${targetConfig.secretKey}" aws s3 cp "${backupDir}" "${s3Path}" --recursive --region "${targetConfig.region}"`,
        { timeout: 1800000 },
      );
    } else if (target === "sftp") {
      const remotePath = `${targetConfig.basePath}/${project.name}/${date}/`;
      BackupEngine.log(
        `Uploading via SFTP to ${targetConfig.host}:${remotePath}`,
      );
      await execAsync(
        `scp -r -P ${targetConfig.port} -i "${targetConfig.keyPath}" "${backupDir}"/* ${targetConfig.user}@${targetConfig.host}:"${remotePath}"`,
        { timeout: 1800000 },
      );
    }
  }

  /**
   * Full VPS snapshot (everything except system dirs)
   */
  static async snapshotVPS(targetOverride) {
    const config = BackupEngine.getConfig();
    const target = targetOverride || config.backup.defaultTarget;
    const date = new Date()
      .toISOString()
      .replace(/[T:]/g, "-")
      .substring(0, 16);
    const snapshotDir = `/tmp/vps-snapshot-${date}`;
    const snapshotId = `vps-snapshot-${Date.now()}`;

    BackupEngine.runningBackups.set("vps-snapshot", {
      backupId: snapshotId,
      status: "running",
      startTime: Date.now(),
      progress: "Creating VPS snapshot...",
      project: "VPS Snapshot",
    });

    try {
      await execAsync(`mkdir -p "${snapshotDir}"`);

      BackupEngine.log("[VPS Snapshot] Creating full server backup...");
      await execAsync(
        `tar czf "${snapshotDir}/vps_snapshot_${date}.tar.gz" --exclude='/proc' --exclude='/sys' --exclude='/dev' --exclude='/run' --exclude='/tmp' --exclude='/var/cache' --exclude='/snap' --exclude='/boot' --exclude='/lost+found' / 2>/dev/null || true`,
        { timeout: 7200000 },
      );

      const targetConfig = config.backup.targets[target];
      if (targetConfig && targetConfig.enabled) {
        if (target === "gdrive") {
          const cfg = BackupEngine.getRcloneConfigFlag();
          await execAsync(
            `rclone copy "${snapshotDir}" "${targetConfig.remoteName}:${targetConfig.basePath}/vps-snapshots/${date}/" ${cfg} --drive-chunk-size=128M --transfers=2 --retries=5 --drive-acknowledge-abuse`,
            { timeout: 7200000 },
          );
        }
      }

      await execAsync(`rm -rf "${snapshotDir}"`);

      BackupEngine.runningBackups.set("vps-snapshot", {
        backupId: snapshotId,
        status: "completed",
        endTime: Date.now(),
        project: "VPS Snapshot",
      });
      setTimeout(
        () => BackupEngine.runningBackups.delete("vps-snapshot"),
        300000,
      );

      return { success: true, snapshotId };
    } catch (err) {
      BackupEngine.runningBackups.set("vps-snapshot", {
        backupId: snapshotId,
        status: "failed",
        error: err.message,
        project: "VPS Snapshot",
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
      if (target === "gdrive") {
        remotePath = projectName
          ? `${targetConfig.remoteName}:${targetConfig.basePath}/${projectName}/`
          : `${targetConfig.remoteName}:${targetConfig.basePath}/`;
      }

      const cfg = BackupEngine.getRcloneConfigFlag();
      const { stdout } = await execAsync(
        `rclone lsjson "${remotePath}" ${cfg} --dirs-only 2>/dev/null || echo "[]"`,
        { timeout: 30000 },
      );

      const dirs = JSON.parse(stdout);
      return dirs
        .map((d) => ({
          name: d.Name,
          path: d.Path,
          date: d.ModTime,
          isDir: d.IsDir,
        }))
        .sort((a, b) => b.name.localeCompare(a.name));
    } catch {
      return [];
    }
  }

  /**
   * rclone --config arguments (argument-array form of getRcloneConfigFlag).
   */
  static rcloneConfigArgs() {
    const flag = BackupEngine.getRcloneConfigFlag();
    const file = (flag.match(/^--config="(.+)"$/) || [])[1];
    return file ? ["--config", file] : [];
  }

  /**
   * Option file for mysqldump/mysql: the panel's own admin account when the
   * Databases page is connected, otherwise the website's credentials. Kept
   * outside the backup folder so it is never uploaded.
   */
  static _mysqlDefaults(db) {
    try {
      if (MysqlManager.getCreds()) return { file: MysqlManager.defaultsFile(), temp: false };
    } catch {}
    const quote = (v) => `"${String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const file = join("/tmp", `vps-panel-my-${process.pid}-${Date.now()}.cnf`);
    writeFileSync(
      file,
      `[client]\nuser=${quote(db.user)}\npassword=${quote(db.password)}\nhost=${quote(db.host || "localhost")}\n`,
      { mode: 0o600 },
    );
    return { file, temp: true };
  }

  /**
   * mysqldump | gzip > out, without the password ever appearing in `ps`.
   */
  static async _dumpMysql(db, out) {
    const { dump } = await MysqlManager.binaries();
    if (!dump) throw new Error("mysqldump is not installed (apt install mariadb-client)");
    const defaults = BackupEngine._mysqlDefaults(db);
    try {
      const child = spawn(
        dump,
        [
          `--defaults-extra-file=${defaults.file}`,
          "--single-transaction",
          "--quick",
          "--routines",
          "--triggers",
          "--events",
          db.name,
        ],
        { env: cleanEnv() },
      );
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      const exit = new Promise((resolve) => child.on("close", resolve));
      await pipeline(child.stdout, createGzip(), createWriteStream(out));
      const code = await exit;
      if (code !== 0) throw new Error(`mysqldump failed: ${stderr.trim() || `exit ${code}`}`);
    } finally {
      if (defaults.temp) rmSync(defaults.file, { force: true });
    }
  }

  static async _dumpPostgres(db, out) {
    const child = spawn("pg_dump", ["-U", db.user, "-h", "localhost", db.name], {
      env: cleanEnv({ PGPASSWORD: db.password || "" }),
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const exit = new Promise((resolve) => child.on("close", resolve));
    await pipeline(child.stdout, createGzip(), createWriteStream(out));
    const code = await exit;
    if (code !== 0) throw new Error(`pg_dump failed: ${stderr.trim() || `exit ${code}`}`);
  }

  /**
   * Restore a backup as a background job with a live log.
   * backupName is the dated folder listed by listBackups().
   */
  static restoreJob(project, backupName, options = {}) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(backupName || ""))
      throw httpError(400, "Choose a backup to restore");
    const config = BackupEngine.getConfig();
    const target = config.backup.defaultTarget;
    const targetConfig = config.backup.targets[target];
    if (target !== "gdrive" || !targetConfig?.enabled)
      throw httpError(
        400,
        "Restoring from the dashboard works with the Google Drive target. Download S3/SFTP backups manually.",
      );
    const restoreDir = `/tmp/vps-restore-${Date.now()}`;
    const remotePath = `${targetConfig.remoteName}:${targetConfig.basePath}/${project.name}/${backupName}/`;
    const find = (prefix, suffix) =>
      existsSync(restoreDir)
        ? readdirSync(restoreDir)
            .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
            .map((f) => join(restoreDir, f))
        : [];

    const steps = [
      {
        title: `Download backup ${backupName}`,
        run: async (ctx) => {
          mkdirSync(restoreDir, { recursive: true });
          const code = await ctx.exec("rclone", [
            "copy",
            remotePath,
            restoreDir,
            ...BackupEngine.rcloneConfigArgs(),
            "--transfers=4",
          ]);
          if (code !== 0) throw new Error("Download failed — check the storage settings");
          const files = readdirSync(restoreDir);
          if (!files.length) throw new Error("The backup folder is empty");
          ctx.log(`Downloaded ${files.length} file(s): ${files.join(", ")}`);
        },
      },
      {
        title: "Restore database",
        when: () => options.restoreDb !== false && !!project.database?.name,
        run: async (ctx) => {
          const [dump] = find("db_", ".sql.gz");
          if (!dump) return ctx.log("This backup has no database dump — skipped.");
          const { client } = await MysqlManager.binaries();
          if (!client) throw new Error("The mysql client is not installed");
          const defaults = BackupEngine._mysqlDefaults(project.database);
          try {
            // The database may have been dropped since the backup was taken
            await run(client, [`--defaults-extra-file=${defaults.file}`, "-e", `CREATE DATABASE IF NOT EXISTS \`${project.database.name.replace(/`/g, "")}\``]);
            ctx.log(`Importing ${basename(dump)} into ${project.database.name}...`);
            const child = spawn(client, [`--defaults-extra-file=${defaults.file}`, project.database.name], { env: cleanEnv() });
            let stderr = "";
            child.stderr.on("data", (d) => (stderr += d));
            const exit = new Promise((resolve) => child.on("close", resolve));
            await pipeline(createReadStream(dump), createGunzip(), child.stdin);
            const code = await exit;
            if (code !== 0) throw new Error(stderr.trim() || `mysql exited with ${code}`);
            ctx.log("Database restored.");
          } finally {
            if (defaults.temp) rmSync(defaults.file, { force: true });
          }
        },
      },
      {
        title: "Restore files",
        when: () => options.restoreFiles !== false,
        run: async (ctx) => {
          const archives = find("files_", ".tar.gz");
          if (!archives.length) return ctx.log("This backup has no file archives — skipped.");
          for (const archive of archives) {
            // Archives hold "<folder>/..." — extract next to the folder they came from
            const list = await run("tar", ["tzf", archive], { timeout: 600000 });
            const top = (list.stdout.split("\n")[0] || "").split("/")[0];
            const origin = (project.backupDirs || []).find((d) => basename(d) === top);
            const dest = origin ? dirname(origin) : join(project.deployPath || "/tmp", `restored-${backupName}`);
            mkdirSync(dest, { recursive: true });
            ctx.log(`Extracting ${basename(archive)} → ${join(dest, top)}`);
            const code = await ctx.exec("tar", ["xzf", archive, "-C", dest]);
            if (code !== 0) throw new Error(`Extracting ${basename(archive)} failed`);
          }
        },
      },
      {
        title: "Restore .env",
        when: () => options.restoreEnv !== false && !!project.deployPath,
        run: async (ctx) => {
          const [envFile] = find("env_", ".env");
          if (!envFile) return ctx.log("This backup has no .env file — skipped.");
          copyFileSync(envFile, join(project.deployPath, ".env"));
          ctx.log(`Restored ${join(project.deployPath, ".env")}`);
        },
      },
    ];

    return JobRunner.pipeline(`Restore ${project.name} from ${backupName}`, steps, {
      meta: { kind: "restore", siteId: project.id },
      onExit: (job) => {
        rmSync(restoreDir, { recursive: true, force: true });
        BackupEngine.log(`[${project.name}] Restore from ${backupName}: ${job.status}`);
      },
    });
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

    if (target !== "gdrive" || !targetConfig.enabled) return;

    // Backups are stored as <basePath>/<project>/<date>/ — prune every project's dated folders
    if (!projectName) {
      for (const project of config.projects || []) {
        await BackupEngine.cleanupOldBackups(project.name);
      }
      return;
    }

    try {
      const remotePath = projectName
        ? `${targetConfig.remoteName}:${targetConfig.basePath}/${projectName}/`
        : `${targetConfig.remoteName}:${targetConfig.basePath}/`;

      const cfg = BackupEngine.getRcloneConfigFlag();
      const { stdout } = await execAsync(
        `rclone lsd "${remotePath}" ${cfg} 2>/dev/null || echo ""`,
      );
      const dirs = stdout.trim().split("\n").filter(Boolean);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoff = cutoffDate.toISOString().substring(0, 10);

      for (const dirLine of dirs) {
        const dirName = dirLine.trim().split(/\s+/).pop();
        if (dirName && dirName < cutoff) {
          BackupEngine.log(`Deleting old backup: ${dirName}`);
          await execAsync(
            `rclone purge "${remotePath}${dirName}" ${cfg} 2>/dev/null`,
          ).catch(() => {});
        }
      }
    } catch (err) {
      BackupEngine.log(`Cleanup error: ${err.message}`);
    }
  }
}
