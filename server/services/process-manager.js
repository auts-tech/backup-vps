import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { connect } from "net";
import { DATA_DIR, httpError } from "../lib/config.js";
import { run, which, toolEnv } from "../lib/shell.js";

const ECOSYSTEM_DIR = join(DATA_DIR, "pm2");

/**
 * Parse `pm2 jlist`, which may print warnings before the JSON array.
 */
function parseJlist(stdout) {
  const start = stdout.indexOf("[");
  if (start === -1) return [];
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return [];
  }
}

function summarize(proc) {
  const env = proc.pm2_env || {};
  return {
    name: proc.name,
    status: env.status || "unknown", // online | stopping | stopped | launching | errored
    pid: proc.pid || null,
    cpu: proc.monit?.cpu ?? null,
    memory: proc.monit?.memory ?? null,
    uptime: env.status === "online" && env.pm_uptime ? Date.now() - env.pm_uptime : 0,
    restarts: env.restart_time || 0,
    unstableRestarts: env.unstable_restarts || 0,
    instances: env.instances || 1,
    cwd: env.pm_cwd || null,
    outLog: env.pm_out_log_path || null,
    errLog: env.pm_err_log_path || null,
  };
}

/**
 * PM2 wrapper for the Node.js / Next.js / Python apps of websites.
 * Each app gets a generated ecosystem file so the start command, folder and
 * port live in one place and `pm2 startOrReload` works for first start and redeploys.
 */
export class ProcessManager {
  static async installed() {
    return !!(await which("pm2"));
  }

  static async pm2(args, timeout = 60000) {
    return run("pm2", args, { timeout, env: toolEnv() });
  }

  /**
   * Map of process name → summary for every PM2 app.
   */
  static async list() {
    const map = new Map();
    if (!(await ProcessManager.installed())) return map;
    const r = await ProcessManager.pm2(["jlist"], 15000);
    for (const proc of parseJlist(r.stdout)) map.set(proc.name, summarize(proc));
    return map;
  }

  static async status(name) {
    if (!(await ProcessManager.installed())) return { status: "pm2-missing", name };
    return (await ProcessManager.list()).get(name) || { status: "not-started", name };
  }

  static ecosystemPath(site) {
    return join(ECOSYSTEM_DIR, `${site.id}.json`);
  }

  static writeEcosystem(site) {
    if (!site.startCommand) throw httpError(400, "Set a start command for this app first");
    mkdirSync(ECOSYSTEM_DIR, { recursive: true });
    const env = { NODE_ENV: "production" };
    if (site.port) env.PORT = String(site.port);
    const app = {
      name: site.name,
      cwd: site.deployPath,
      // `exec` lets bash expand $PORT etc. and then hands the process over to the command
      script: "bash",
      args: ["-c", `exec ${site.startCommand}`],
      interpreter: "none",
      env,
      autorestart: true,
      max_restarts: 15,
      min_uptime: "10s",
      restart_delay: 2000,
      kill_timeout: 8000,
      time: true,
      merge_logs: true,
    };
    const file = ProcessManager.ecosystemPath(site);
    writeFileSync(file, JSON.stringify({ apps: [app] }, null, 2), { mode: 0o600 });
    return file;
  }

  /**
   * Start the app, or reload it with the current settings when it already runs.
   */
  static async startOrReload(site) {
    if (!(await ProcessManager.installed()))
      throw httpError(409, "PM2 is not installed — install it from the App tab first");
    if (!existsSync(site.deployPath))
      throw httpError(409, `${site.deployPath} does not exist`);
    const file = ProcessManager.writeEcosystem(site);
    // A changed start command needs a fresh process; reload only re-reads env
    const current = await ProcessManager.status(site.name);
    const r =
      current.status === "not-started"
        ? await ProcessManager.pm2(["start", file])
        : await ProcessManager.pm2(["startOrReload", file, "--update-env"]);
    if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim() || "pm2 failed to start the app");
    await ProcessManager.pm2(["save"], 20000);
    return { success: true };
  }

  static async control(site, action) {
    if (action === "start" || action === "restart" || action === "reload") {
      const current = await ProcessManager.status(site.name);
      if (current.status === "not-started" || action !== "restart") return ProcessManager.startOrReload(site);
      const r = await ProcessManager.pm2(["restart", site.name, "--update-env"]);
      if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim());
      return { success: true };
    }
    if (action === "stop") {
      const r = await ProcessManager.pm2(["stop", site.name]);
      if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim());
      await ProcessManager.pm2(["save"], 20000);
      return { success: true };
    }
    throw httpError(400, "Action must be start, stop, restart or reload");
  }

  /**
   * Stop and forget the app (when a website is deleted or its name changes).
   */
  static async remove(site) {
    if (await ProcessManager.installed()) {
      const current = await ProcessManager.status(site.name);
      if (current.status !== "not-started") {
        await ProcessManager.pm2(["delete", site.name]);
        await ProcessManager.pm2(["save", "--force"], 20000);
      }
    }
    rmSync(ProcessManager.ecosystemPath(site), { force: true });
  }

  static async logs(site, type = "out", lines = 200) {
    const proc = await ProcessManager.status(site.name);
    const file = type === "err" ? proc.errLog : proc.outLog;
    if (!file || !existsSync(file)) return { path: file, lines: [] };
    const r = await run("tail", ["-n", String(Math.min(Math.max(parseInt(lines) || 200, 10), 2000)), file]);
    return { path: file, lines: r.stdout.split("\n").filter(Boolean) };
  }

  static async flushLogs(site) {
    await ProcessManager.pm2(["flush", site.name], 20000);
    return { success: true };
  }

  /**
   * Wait until something accepts TCP connections on 127.0.0.1:port.
   */
  static async waitForPort(port, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const open = await new Promise((resolve) => {
        const socket = connect({ host: "127.0.0.1", port }, () => {
          socket.destroy();
          resolve(true);
        });
        socket.on("error", () => resolve(false));
        socket.setTimeout(1500, () => {
          socket.destroy();
          resolve(false);
        });
      });
      if (open) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  /**
   * Install PM2 globally and register it with systemd so apps come back after a reboot.
   */
  static installScript() {
    return `
if ! command -v npm >/dev/null 2>&1; then echo "npm is not installed (Node.js is required)."; exit 1; fi
npm install -g pm2
if [ -d /run/systemd/system ]; then
  pm2 startup systemd -u "$(id -un)" --hp "$HOME" || true
fi
pm2 save --force || true
pm2 --version
echo ""
echo "PM2 is installed. Apps restart automatically and come back after a reboot."
`;
  }
}
