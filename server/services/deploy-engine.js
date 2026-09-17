import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Deploy engine — Git clone, configure, build, and manage projects.
 * Supports Node.js, PHP, static sites. Uses PM2 for process management.
 */
export class DeployEngine {

  static getConfig() {
    const configPath = join(__dirname, '..', 'data', 'config.json');
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  }

  /**
   * Clone a git repository to the server
   */
  static async cloneRepo(gitUrl, branch, deployPath) {
    try {
      if (existsSync(deployPath)) {
        return { success: false, error: `Directory already exists: ${deployPath}` };
      }

      await execAsync(`mkdir -p "$(dirname "${deployPath}")"`);
      const branchFlag = branch ? `--branch ${branch}` : '';
      await execAsync(
        `git clone ${branchFlag} --depth 1 "${gitUrl}" "${deployPath}"`,
        { timeout: 300000 }
      );

      return { success: true, message: `Cloned ${gitUrl} to ${deployPath}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Pull latest changes for a project
   */
  static async pullLatest(deployPath, branch) {
    try {
      if (!existsSync(deployPath)) {
        return { success: false, error: 'Deploy path does not exist' };
      }

      const branchArg = branch ? `origin ${branch}` : '';
      const { stdout } = await execAsync(
        `cd "${deployPath}" && git pull ${branchArg}`,
        { timeout: 120000 }
      );

      return { success: true, output: stdout.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Configure a project (install deps, build, set env vars)
   */
  static async configure(projectId, envVars = {}) {
    const config = DeployEngine.getConfig();
    const project = config.projects.find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const results = [];

    try {
      // Write .env file if env vars provided
      if (Object.keys(envVars).length > 0 && project.deployPath) {
        const envContent = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n');
        writeFileSync(join(project.deployPath, '.env'), envContent + '\n');
        results.push('✅ .env file written');
      }

      // Auto-detect project type and install dependencies
      const type = project.type || DeployEngine._detectProjectType(project.deployPath);

      if (type === 'node') {
        const { stdout } = await execAsync(
          `cd "${project.deployPath}" && npm install --production`,
          { timeout: 600000 }
        );
        results.push('✅ npm install completed');

        // Build if package.json has a build script
        const pkgJson = JSON.parse(readFileSync(join(project.deployPath, 'package.json'), 'utf-8'));
        if (pkgJson.scripts && pkgJson.scripts.build) {
          await execAsync(`cd "${project.deployPath}" && npm run build`, { timeout: 600000 });
          results.push('✅ Build completed');
        }
      } else if (type === 'php') {
        if (existsSync(join(project.deployPath, 'composer.json'))) {
          await execAsync(`cd "${project.deployPath}" && composer install --no-dev`, { timeout: 300000 });
          results.push('✅ Composer install completed');
        }
      }

      return { success: true, results };
    } catch (err) {
      return { success: false, error: err.message, results };
    }
  }

  /**
   * Start a project using PM2
   */
  static async start(projectId) {
    const config = DeployEngine.getConfig();
    const project = config.projects.find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };

    try {
      const type = project.type || DeployEngine._detectProjectType(project.deployPath);
      let startCmd;

      if (type === 'node') {
        const pkgJson = JSON.parse(readFileSync(join(project.deployPath, 'package.json'), 'utf-8'));
        const entryPoint = pkgJson.main || 'index.js';
        const startScript = pkgJson.scripts?.start;

        if (startScript) {
          startCmd = `cd "${project.deployPath}" && pm2 start npm --name "${project.name}" -- start`;
        } else {
          startCmd = `cd "${project.deployPath}" && pm2 start ${entryPoint} --name "${project.name}"`;
        }
      } else if (type === 'php') {
        // PHP typically runs behind nginx/apache, just ensure config is correct
        return { success: true, message: 'PHP project — ensure nginx/apache is configured' };
      } else if (type === 'static') {
        // Serve with PM2 + serve
        startCmd = `pm2 start serve --name "${project.name}" -- -s "${project.deployPath}" -l ${project.port || 3000}`;
      }

      if (startCmd) {
        const { stdout } = await execAsync(startCmd, { timeout: 30000 });
        await execAsync('pm2 save', { timeout: 10000 }).catch(() => {});
        return { success: true, output: stdout.trim() };
      }

      return { success: false, error: 'Could not determine start command' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Stop a project
   */
  static async stop(projectId) {
    const config = DeployEngine.getConfig();
    const project = config.projects.find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };

    try {
      const { stdout } = await execAsync(`pm2 stop "${project.name}"`, { timeout: 15000 });
      return { success: true, output: stdout.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Restart a project
   */
  static async restart(projectId) {
    const config = DeployEngine.getConfig();
    const project = config.projects.find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };

    try {
      const { stdout } = await execAsync(`pm2 restart "${project.name}"`, { timeout: 30000 });
      return { success: true, output: stdout.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get the runtime status of a project via PM2
   */
  static async getStatus(projectId) {
    const config = DeployEngine.getConfig();
    const project = config.projects.find(p => p.id === projectId);
    if (!project) return { status: 'unknown', error: 'Project not found' };

    try {
      const { stdout } = await execAsync(`pm2 jlist 2>/dev/null || echo "[]"`, { timeout: 10000 });
      const processes = JSON.parse(stdout);
      const proc = processes.find(p => p.name === project.name);

      if (!proc) {
        return { status: 'stopped', name: project.name };
      }

      return {
        status: proc.pm2_env?.status || 'unknown',
        name: proc.name,
        pid: proc.pid,
        cpu: proc.monit?.cpu,
        memory: proc.monit?.memory,
        uptime: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
        restarts: proc.pm2_env?.restart_time || 0
      };
    } catch {
      return { status: 'unknown', name: project?.name };
    }
  }

  /**
   * Get PM2 status for all projects
   */
  static async getAllStatuses() {
    try {
      const { stdout } = await execAsync(`pm2 jlist 2>/dev/null || echo "[]"`, { timeout: 10000 });
      const processes = JSON.parse(stdout);
      return processes.map(p => ({
        name: p.name,
        status: p.pm2_env?.status || 'unknown',
        pid: p.pid,
        cpu: p.monit?.cpu,
        memory: p.monit?.memory,
        uptime: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
        restarts: p.pm2_env?.restart_time || 0
      }));
    } catch {
      return [];
    }
  }

  /**
   * Auto-detect project type from directory contents
   */
  static _detectProjectType(deployPath) {
    if (!deployPath || !existsSync(deployPath)) return 'unknown';
    if (existsSync(join(deployPath, 'package.json'))) return 'node';
    if (existsSync(join(deployPath, 'composer.json'))) return 'php';
    if (existsSync(join(deployPath, 'index.html'))) return 'static';
    return 'unknown';
  }
}
