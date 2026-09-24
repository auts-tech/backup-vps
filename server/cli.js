#!/usr/bin/env node
/**
 * Panel task runner — used by cron jobs and backup.sh.
 *
 *   node server/cli.js backup-all
 *   node server/cli.js backup <projectId>
 *   node server/cli.js vps-snapshot
 *   node server/cli.js cleanup
 *
 * Calls the running panel's API (authenticated with the panel API key) so progress
 * shows up in the dashboard. If the panel is not running, the task runs directly
 * in this process and the command waits until it has finished.
 */
import dotenv from "dotenv";
import { join } from "path";
import { getConfig, PROJECT_ROOT } from "./lib/config.js";

dotenv.config({ path: join(PROJECT_ROOT, ".env"), quiet: true });

const TASKS = {
  "backup-all": { path: "/backups/trigger", body: () => ({}) },
  backup: {
    path: "/backups/trigger",
    body: (id) => ({ projectId: id }),
    needsArg: true,
  },
  "vps-snapshot": { path: "/backups/trigger-vps", body: () => ({}) },
  cleanup: { path: "/backups/cleanup", body: () => ({}) },
};

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function viaApi(task, arg) {
  const config = getConfig();
  const port = process.env.PORT || config.server?.port || 9090;
  const res = await fetch(`http://127.0.0.1:${port}/api/v1${task.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey || "",
    },
    body: JSON.stringify({ ...task.body(arg), waitForCompletion: true }),
    signal: AbortSignal.timeout(
      task.path.includes("trigger-vps") ? 4 * 3600 * 1000 : 60000,
    ),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(data.error || `HTTP ${res.status}`), {
      http: true,
    });
  return data;
}

async function direct(name, arg) {
  const { BackupEngine } = await import("./services/backup-engine.js");
  if (name === "backup-all") {
    const started = await BackupEngine.backupAll();
    const results = await BackupEngine.waitForAll();
    return { started, results };
  }
  if (name === "backup") {
    const started = await BackupEngine.backupProject(arg);
    if (!started.success) throw new Error(started.error);
    return { results: await BackupEngine.waitForAll() };
  }
  if (name === "vps-snapshot") return BackupEngine.snapshotVPS();
  if (name === "cleanup") {
    await BackupEngine.cleanupOldBackups();
    return { success: true };
  }
}

async function main() {
  const [name, arg] = process.argv.slice(2);
  const task = TASKS[name];
  if (!task || (task.needsArg && !arg)) {
    console.error(
      `Usage: node cli.js <${Object.keys(TASKS).join("|")}> [projectId]`,
    );
    process.exit(2);
  }

  log(`Task "${name}${arg ? " " + arg : ""}" started`);
  try {
    const data = await viaApi(task, arg);
    log(`Handed to running panel: ${JSON.stringify(data)}`);
  } catch (err) {
    if (err.http) {
      log(`Panel API refused the task: ${err.message}`);
      process.exit(1);
    }
    log(
      `Panel not reachable (${err.cause?.code || err.message}) — running task directly`,
    );
    const data = await direct(name, arg);
    log(`Finished: ${JSON.stringify(data)}`);
  }
  process.exit(0);
}

main().catch((err) => {
  log(`FAILED: ${err.message}`);
  process.exit(1);
});
