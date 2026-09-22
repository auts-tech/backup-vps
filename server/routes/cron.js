import { Router } from 'express';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { CronManager } from '../services/cron-manager.js';
import { JobRunner } from '../services/job-runner.js';
import { getConfig, httpError, SERVER_DIR } from '../lib/config.js';
import { run, serviceCtl, which } from '../lib/shell.js';

const router = Router();
const CRON_LOG = '/var/log/vps-panel-cron.log';

/**
 * Built-in panel tasks. Commands use absolute paths because cron runs with a minimal PATH.
 */
function panelTasks() {
  const cli = `"${process.execPath}" "${join(SERVER_DIR, 'cli.js')}"`;
  const logSuffix = ` >> ${CRON_LOG} 2>&1`;
  const config = getConfig();

  const tasks = [
    { id: 'backup-all', label: 'Backup all projects', description: 'Database + files + .env of every project', command: `${cli} backup-all${logSuffix}` },
    { id: 'vps-snapshot', label: 'Full VPS snapshot', description: 'Archive the whole server to the default target', command: `${cli} vps-snapshot${logSuffix}` },
    { id: 'cleanup', label: 'Prune expired backups', description: `Delete backups older than ${config.backup?.retentionDays || 30} days`, command: `${cli} cleanup${logSuffix}` }
  ];
  for (const p of config.projects || []) {
    tasks.push({ id: `backup:${p.id}`, label: `Backup ${p.name}`, description: 'Backup a single project', command: `${cli} backup ${p.id}${logSuffix}` });
  }
  return tasks;
}

async function cronDaemonStatus() {
  const { code } = await run('sh', ['-c', 'pgrep -x cron || pgrep -x crond || pgrep -x cronie'], { timeout: 5000 });
  const installed = !!(await which('crontab'));
  return { running: code === 0, installed };
}

/**
 * Resolve { task | command, logOutput } from a request body into the final command line.
 */
function resolveCommand(body) {
  if (body.task) {
    const task = panelTasks().find(t => t.id === body.task);
    if (!task) throw httpError(400, `Unknown task "${body.task}"`);
    return { command: task.command, label: body.label || task.label };
  }
  let command = (body.command || '').trim();
  if (body.logOutput && command && !command.includes('>')) {
    // Subshell so every part of `a && b` is logged, not just the last command
    command = `( ${command} ) >> ${CRON_LOG} 2>&1`;
  }
  return { command, label: body.label || '' };
}

// GET /api/v1/cron — List jobs + cron daemon status
router.get('/', async (req, res) => {
  const [jobs, daemon] = await Promise.all([CronManager.list(), cronDaemonStatus()]);
  res.json({ jobs, daemon, logFile: CRON_LOG, user: process.env.USER || 'root' });
});

// GET /api/v1/cron/tasks — Built-in panel tasks for quick scheduling
router.get('/tasks', (req, res) => {
  res.json({ tasks: panelTasks() });
});

// POST /api/v1/cron/preview — Validate a schedule and show upcoming runs
router.post('/preview', (req, res) => {
  const { schedule } = req.body;
  try {
    CronManager.parseSchedule(schedule);
    res.json({
      valid: true,
      human: CronManager.toHuman(schedule),
      nextRuns: CronManager.nextRuns(schedule, 5).map(d => d.toISOString())
    });
  } catch (err) {
    res.json({ valid: false, error: err.message });
  }
});

// GET /api/v1/cron/log — Tail of the panel cron log
router.get('/log', (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 200, 2000);
  if (!existsSync(CRON_LOG)) return res.json({ lines: [], path: CRON_LOG, exists: false });
  const size = statSync(CRON_LOG).size;
  const content = readFileSync(CRON_LOG, 'utf-8');
  res.json({ lines: content.split('\n').filter(Boolean).slice(-lines), path: CRON_LOG, exists: true, size });
});

// POST /api/v1/cron/daemon/start — Install (if needed) and start the cron service
router.post('/daemon/start', async (req, res) => {
  const status = await cronDaemonStatus();
  if (!status.installed) {
    const job = JobRunner.start('Install cron service', 'apt_get update && apt_get install cron && svc_enable cron');
    return res.json({ jobId: job.id });
  }
  const result = await serviceCtl('enable', 'cron');
  if (result.code !== 0) throw httpError(500, result.stderr.trim() || 'Could not start cron');
  res.json({ success: true });
});

// POST /api/v1/cron — Add a job: { schedule, task | command, label, enabled, logOutput }
router.post('/', async (req, res) => {
  const { command, label } = resolveCommand(req.body);
  try {
    await CronManager.add({ schedule: req.body.schedule, command, label, enabled: req.body.enabled !== false });
  } catch (err) {
    throw httpError(err.status || 400, err.message);
  }
  res.json({ success: true });
});

// PUT /api/v1/cron/:id — Update a job
router.put('/:id', async (req, res) => {
  const updates = { schedule: req.body.schedule, label: req.body.label, enabled: req.body.enabled };
  if (req.body.task || req.body.command) Object.assign(updates, resolveCommand(req.body));
  try {
    await CronManager.update(req.params.id, updates);
  } catch (err) {
    throw httpError(err.status || 400, err.message);
  }
  res.json({ success: true });
});

// POST /api/v1/cron/:id/toggle — Enable/disable a job: { enabled }
router.post('/:id/toggle', async (req, res) => {
  try {
    await CronManager.setEnabled(req.params.id, req.body.enabled);
  } catch (err) {
    throw httpError(err.status || 400, err.message);
  }
  res.json({ success: true });
});

// POST /api/v1/cron/:id/run — Run a job's command right now as a background job
router.post('/:id/run', async (req, res) => {
  const job = await CronManager.get(req.params.id);
  // Show output in the dashboard instead of the log file the cron line redirects to;
  // cron turns an escaped \% into %, so do the same here
  const command = job.command.replace(/\s*>>?\s*\S+\s+2>&1\s*$/, '').replace(/\\%/g, '%');
  const bg = JobRunner.start(`Run cron: ${job.label || command.slice(0, 60)}`, command, { preamble: false });
  res.json({ jobId: bg.id });
});

// DELETE /api/v1/cron/:id — Delete a job
router.delete('/:id', async (req, res) => {
  try {
    await CronManager.remove(req.params.id);
  } catch (err) {
    throw httpError(err.status || 400, err.message);
  }
  res.json({ success: true });
});

export default router;
