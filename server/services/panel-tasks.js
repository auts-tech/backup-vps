import { join } from "path";
import { getConfig, SERVER_DIR } from "../lib/config.js";
import { shq } from "../lib/shell.js";
import { CronManager } from "./cron-manager.js";

export const CRON_LOG = "/var/log/vps-panel-cron.log";

/**
 * `node server/cli.js` with absolute paths (cron runs with a minimal PATH).
 */
export function cliCommand() {
  return `"${process.execPath}" "${join(SERVER_DIR, "cli.js")}"`;
}

/**
 * Built-in panel tasks that can be scheduled with cron.
 */
export function panelTasks() {
  const cli = cliCommand();
  const logSuffix = ` >> ${CRON_LOG} 2>&1`;
  const config = getConfig();

  const tasks = [
    {
      id: "backup-all",
      label: "Backup all websites",
      description: "Database + files + .env of every website",
      command: `${cli} backup-all${logSuffix}`,
    },
    {
      id: "vps-snapshot",
      label: "Full VPS snapshot",
      description: "Archive the whole server to the default target",
      command: `${cli} vps-snapshot${logSuffix}`,
    },
    {
      id: "cleanup",
      label: "Prune expired backups",
      description: `Delete backups older than ${config.backup?.retentionDays || 30} days`,
      command: `${cli} cleanup${logSuffix}`,
    },
  ];
  for (const p of config.projects || []) {
    tasks.push({
      id: `backup:${p.id}`,
      label: `Backup ${p.name}`,
      description: "Backup a single website",
      command: `${cli} backup ${p.id}${logSuffix}`,
    });
  }
  return tasks;
}

/**
 * Run a cron command through the CLI wrapper, which sends a notification when it fails.
 */
export function wrapCronCommand(command, label) {
  return `${cliCommand()} cron-run --label ${shq(label || "Cron job")} -- ${shq(command)}`;
}

/**
 * Cron jobs that belong to one website: its backup schedule and Laravel scheduler.
 */
export async function siteCronJobs(site) {
  const jobs = await CronManager.list().catch(() => []);
  const backupTask = ` backup ${site.id} `;
  return {
    backups: jobs.filter((j) => j.command.includes(backupTask) || j.command.includes(` backup ${site.id}'`)),
    scheduler: site.deployPath
      ? jobs.filter((j) => j.command.includes("artisan schedule:run") && j.command.includes(site.deployPath))
      : [],
  };
}
