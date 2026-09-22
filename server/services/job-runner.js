import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { cleanEnv, JOB_PREAMBLE } from '../lib/shell.js';
import { BackupEngine } from './backup-engine.js';

const MAX_OUTPUT = 512 * 1024; // keep the last 512 KB of output per job
const MAX_JOBS = 40;

/**
 * Background job runner for long operations (package installs, certbot,
 * database imports, "run now" cron tasks). Output is buffered so the
 * dashboard can poll it incrementally with an offset.
 */
export class JobRunner {
  static jobs = new Map();

  /**
   * Start a bash script as a background job.
   * @param {string} title   Human readable title
   * @param {string} script  Bash script body
   * @param {object} opts    { preamble: true, env: {}, onExit: (job) => {} }
   */
  static start(title, script, { preamble = true, env = {}, onExit } = {}) {
    const id = randomUUID();
    const job = {
      id,
      title,
      status: 'running',
      exitCode: null,
      output: '',
      dropped: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null
    };
    JobRunner.jobs.set(id, job);
    JobRunner._prune();

    const body = preamble ? `${JOB_PREAMBLE}\n${script}` : script;
    const child = spawn('bash', ['-c', body], {
      env: cleanEnv({ DEBIAN_FRONTEND: 'noninteractive', ...env }),
      detached: true
    });
    job.pid = child.pid;
    JobRunner.jobs.get(id)._child = child;

    const append = (chunk) => {
      job.output += chunk.toString();
      if (job.output.length > MAX_OUTPUT) {
        const cut = job.output.length - MAX_OUTPUT;
        job.output = job.output.slice(cut);
        job.dropped += cut;
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    BackupEngine.log(`[Job] Started: ${title}`);

    const done = (code) => {
      if (job.status !== 'running') return;
      job.exitCode = code;
      job.status = code === 0 ? 'completed' : (job.cancelled ? 'cancelled' : 'failed');
      job.finishedAt = new Date().toISOString();
      delete job._child;
      BackupEngine.log(`[Job] ${job.status === 'completed' ? 'Success' : 'FAILED'}: ${title}${code ? ` (exit ${code})` : ''}`);
      if (onExit) {
        Promise.resolve().then(() => onExit(job)).catch(err => append(`\n[post-job error] ${err.message}\n`));
      }
    };
    child.on('error', (err) => { append(`\n${err.message}\n`); done(-1); });
    child.on('close', (code) => done(code ?? -1));

    return job;
  }

  /**
   * Return a job's state and any output after `offset` (absolute character index).
   */
  static get(id, offset = 0) {
    const job = JobRunner.jobs.get(id);
    if (!job) return null;
    const total = job.dropped + job.output.length;
    const from = Math.max(0, offset - job.dropped);
    return {
      id: job.id,
      title: job.title,
      status: job.status,
      exitCode: job.exitCode,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      output: job.output.slice(from),
      nextOffset: total
    };
  }

  static list() {
    return [...JobRunner.jobs.values()]
      .map(({ id, title, status, exitCode, startedAt, finishedAt }) => ({ id, title, status, exitCode, startedAt, finishedAt }))
      .reverse();
  }

  static cancel(id) {
    const job = JobRunner.jobs.get(id);
    if (!job || job.status !== 'running' || !job._child) return false;
    job.cancelled = true;
    try {
      process.kill(-job._child.pid, 'SIGTERM'); // whole process group (apt, certbot, ...)
    } catch {
      job._child.kill('SIGTERM');
    }
    return true;
  }

  static _prune() {
    if (JobRunner.jobs.size <= MAX_JOBS) return;
    for (const [id, job] of JobRunner.jobs) {
      if (JobRunner.jobs.size <= MAX_JOBS) break;
      if (job.status !== 'running') JobRunner.jobs.delete(id);
    }
  }
}
