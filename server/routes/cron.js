import { Router } from "express";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { CronManager } from "../services/cron-manager.js";
import { JobRunner } from "../services/job-runner.js";
import {
  CRON_LOG,
  panelTasks,
  wrapCronCommand,
} from "../services/panel-tasks.js";
import { httpError, SERVER_DIR } from "../lib/config.js";
import { run, serviceCtl, which } from "../lib/shell.js";

const router = Router();

/**
 * Earlier versions scheduled `curl -X POST http://127.0.0.1:9090/api/v1/backups/trigger`
 * without an API key, which the API always rejected (401), so those jobs never ran.
 * Rewrite them to the authenticated CLI task runner. Runs once at startup.
 */
export async function migrateLegacyCronJobs() {
  const lines = await CronManager.readLines();
  const cli = `"${process.execPath}" "${join(SERVER_DIR, "cli.js")}"`;
  const legacy =
    /^(#off# )?(@\w+|\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+curl\s.*127\.0\.0\.1:\d+\/api\/v1\/backups\/(trigger-vps|trigger)\b.*$/;
  let migrated = 0;
  const out = lines.map((line) => {
    const m = line.match(legacy);
    if (!m || /x-api-key/i.test(line)) return line;
    migrated++;
    const task = m[3] === "trigger-vps" ? "vps-snapshot" : "backup-all";
    return `${m[1] || ""}${m[2]} ${wrapCronCommand(`${cli} ${task} >> ${CRON_LOG} 2>&1`, task)}`;
  });
  const jobs = CronManager.parse(out);
  for (const job of jobs) {
    const labelLine = job.line > 0 ? out[job.line - 1] : "";
    if (
      !labelLine.startsWith("# vps-panel: ") ||
      job.command.includes(" cron-run ")
    )
      continue;
    const body = out[job.line].startsWith("#off# ")
      ? out[job.line].slice(6)
      : out[job.line];
    const parts = CronManager.splitJobLine(body);
    if (!parts) continue;
    const disabled = out[job.line].startsWith("#off# ") ? "#off# " : "";
    out[job.line] =
      `${disabled}${parts.schedule} ${wrapCronCommand(parts.command, job.label)}`;
    migrated++;
  }
  if (migrated) await CronManager.writeLines(out);
  return migrated;
}

async function cronDaemonStatus() {
  // Ignore zombie (defunct) processes left behind by a stopped daemon
  const { stdout } = await run("ps", ["-eo", "stat=,comm="], { timeout: 5000 });
  const running = stdout.split("\n").some((line) => {
    const [stat, comm] = line.trim().split(/\s+/);
    return (
      stat &&
      !stat.startsWith("Z") &&
      ["cron", "crond", "cronie"].includes(comm)
    );
  });
  const installed = !!(await which("crontab"));
  return { running, installed };
}

/**
 * Resolve { task | command, logOutput } from a request body into the final command line.
 */
function resolveCommand(body) {
  if (body.task) {
    const task = panelTasks().find((t) => t.id === body.task);
    if (!task) throw httpError(400, `Unknown task "${body.task}"`);
    const label = body.label || task.label;
    return { command: wrapCronCommand(task.command, label), label };
  }
  let command = (body.command || "").trim();
  if (body.logOutput && command && !command.includes(">")) {
    // Subshell so every part of `a && b` is logged, not just the last command
    command = `( ${command} ) >> ${CRON_LOG} 2>&1`;
  }
  const label = body.label || "";
  return { command: wrapCronCommand(command, label), label };
}

// GET /api/v1/cron — List jobs + cron daemon status
router.get("/", async (req, res) => {
  const [jobs, daemon] = await Promise.all([
    CronManager.list(),
    cronDaemonStatus(),
  ]);
  res.json({
    jobs,
    daemon,
    logFile: CRON_LOG,
    user: process.env.USER || "root",
  });
});

// GET /api/v1/cron/tasks — Built-in panel tasks for quick scheduling
router.get("/tasks", (req, res) => {
  res.json({ tasks: panelTasks() });
});

// POST /api/v1/cron/preview — Validate a schedule and show upcoming runs
router.post("/preview", (req, res) => {
  const { schedule } = req.body;
  try {
    CronManager.parseSchedule(schedule);
    res.json({
      valid: true,
      human: CronManager.toHuman(schedule),
      nextRuns: CronManager.nextRuns(schedule, 5).map((d) => d.toISOString()),
    });
  } catch (err) {
    res.json({ valid: false, error: err.message });
  }
});

// GET /api/v1/cron/log — Tail of the panel cron log
router.get("/log", (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 200, 2000);
  if (!existsSync(CRON_LOG))
    return res.json({ lines: [], path: CRON_LOG, exists: false });
  const size = statSync(CRON_LOG).size;
  const content = readFileSync(CRON_LOG, "utf-8");
  res.json({
    lines: content.split("\n").filter(Boolean).slice(-lines),
    path: CRON_LOG,
    exists: true,
    size,
  });
});

// POST /api/v1/cron/daemon/start — Install (if needed) and start the cron service
router.post("/daemon/start", async (req, res) => {
  const status = await cronDaemonStatus();
  if (!status.installed) {
    const job = JobRunner.start(
      "Install cron service",
      "apt_get update && apt_get install cron && svc_enable cron",
    );
    return res.json({ jobId: job.id });
  }
  const result = await serviceCtl("enable", "cron");
  if (result.code !== 0)
    throw httpError(500, result.stderr.trim() || "Could not start cron");
  res.json({ success: true });
});

// POST /api/v1/cron — Add a job: { schedule, task | command, label, enabled, logOutput }
router.post("/", async (req, res) => {
  const { command, label } = resolveCommand(req.body);
  try {
    await CronManager.add({
      schedule: req.body.schedule,
      command,
      label,
      enabled: req.body.enabled !== false,
    });
  } catch (err) {
    throw httpError(err.status || 400, err.message);
  }
  res.json({ success: true });
});

// PUT /api/v1/cron/:id — Update a job
router.put("/:id", async (req, res) => {
  const updates = {
    schedule: req.body.schedule,
    label: req.body.label,
    enabled: req.body.enabled,
  };
  if (req.body.task || req.body.command)
    Object.assign(updates, resolveCommand(req.body));
  try {
    await CronManager.update(req.params.id, updates);
  } catch (err) {
    throw httpError(err.status || 400, err.message);
  }
  res.json({ success: true });
});

// POST /api/v1/cron/:id/toggle — Enable/disable a job: { enabled }
router.post("/:id/toggle", async (req, res) => {
  try {
    await CronManager.setEnabled(req.params.id, req.body.enabled);
  } catch (err) {
    throw httpError(err.status || 400, err.message);
  }
  res.json({ success: true });
});

// POST /api/v1/cron/:id/run — Run a job's command right now as a background job
router.post("/:id/run", async (req, res) => {
  const job = await CronManager.get(req.params.id);
  // Show output in the dashboard instead of the log file the cron line redirects to;
  // cron turns an escaped \% into %, so do the same here
  const command = job.command
    .replace(/\s*>>?\s*\S+\s+2>&1\s*$/, "")
    .replace(/\\%/g, "%");
  const bg = JobRunner.start(
    `Run cron: ${job.label || command.slice(0, 60)}`,
    command,
    { preamble: false },
  );
  res.json({ jobId: bg.id });
});

// DELETE /api/v1/cron/:id — Delete a job
router.delete("/:id", async (req, res) => {
  try {
    await CronManager.remove(req.params.id);
  } catch (err) {
    throw httpError(err.status || 400, err.message);
  }
  res.json({ success: true });
});

export default router;
