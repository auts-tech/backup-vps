import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { cleanEnv, JOB_PREAMBLE } from "../lib/shell.js";
import { BackupEngine } from "./backup-engine.js";

const MAX_OUTPUT = 512 * 1024; // keep the last 512 KB of output per job
const MAX_JOBS = 40;

/**
 * Background job runner for long operations (package installs, certbot,
 * database imports, deployments, "run now" cron tasks). Output is buffered so
 * the dashboard can poll it incrementally with an offset.
 */
export class JobRunner {
  static jobs = new Map();

  static _create(title, meta = {}) {
    const job = {
      id: randomUUID(),
      title,
      meta,
      status: "running",
      exitCode: null,
      output: "",
      dropped: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    JobRunner.jobs.set(job.id, job);
    JobRunner._prune();
    BackupEngine.log(`[Job] Started: ${title}`);
    return job;
  }

  static _append(job, chunk) {
    job.output += chunk.toString();
    if (job.output.length > MAX_OUTPUT) {
      const cut = job.output.length - MAX_OUTPUT;
      job.output = job.output.slice(cut);
      job.dropped += cut;
    }
  }

  static _finish(job, status, exitCode) {
    job.status = status;
    job.exitCode = exitCode;
    job.finishedAt = new Date().toISOString();
    delete job._child;
    BackupEngine.log(
      `[Job] ${status === "completed" ? "Success" : status.toUpperCase()}: ${job.title}${exitCode ? ` (exit ${exitCode})` : ""}`,
    );
  }

  /**
   * Spawn a process whose output goes into the job log. Resolves with the exit code.
   */
  static _spawn(job, cmd, args, { env = {}, cwd } = {}) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(cmd, args, {
          cwd,
          env: cleanEnv({ DEBIAN_FRONTEND: "noninteractive", ...env }),
          detached: true, // own process group, so cancel stops apt/npm/certbot children too
        });
      } catch (err) {
        JobRunner._append(job, `\n${err.message}\n`);
        resolve(-1);
        return;
      }
      job._child = child;
      job.pid = child.pid;
      child.stdout.on("data", (d) => JobRunner._append(job, d));
      child.stderr.on("data", (d) => JobRunner._append(job, d));
      let settled = false;
      const done = (code) => {
        if (settled) return;
        settled = true;
        if (job._child === child) delete job._child;
        resolve(code);
      };
      child.on("error", (err) => {
        JobRunner._append(job, `\n${err.message}\n`);
        done(-1);
      });
      child.on("close", (code) => done(code ?? -1));
    });
  }

  /**
   * Start a bash script as a background job.
   * @param {string} title   Human readable title
   * @param {string} script  Bash script body
   * @param {object} opts    { preamble: true, env: {}, cwd, meta: {}, onExit: (job) => {} }
   */
  static start(
    title,
    script,
    { preamble = true, env = {}, cwd, meta, onExit } = {},
  ) {
    const job = JobRunner._create(title, meta);
    const body = preamble ? `${JOB_PREAMBLE}\n${script}` : script;
    JobRunner._spawn(job, "bash", ["-c", body], { env, cwd }).then((code) => {
      JobRunner._finish(
        job,
        code === 0 ? "completed" : job.cancelled ? "cancelled" : "failed",
        code,
      );
      if (onExit) {
        Promise.resolve()
          .then(() => onExit(job))
          .catch((err) =>
            JobRunner._append(job, `\n[post-job error] ${err.message}\n`),
          );
      }
    });
    return job;
  }

  /**
   * Run several steps as one job with a single log and a per-step status
   * the dashboard renders as a checklist.
   *
   * A step is either a bash script — { title, script, env, cwd, preamble } —
   * or JavaScript — { title, run: async (ctx) => {} }. Options per step:
   *   when: (ctx) => bool   skip the step when it returns false
   *   optional: true        a failure is logged as a warning and the job continues
   * ctx: { job, log(text), sh(script, opts), exec(cmd, args, opts), state, cancelled }
   *
   * Returns the job immediately; opts.onExit(job, ctx) runs after the last step.
   */
  static pipeline(title, steps, { meta, env = {}, onExit } = {}) {
    const job = JobRunner._create(title, meta);
    job.steps = steps.map((step, i) => ({
      id: step.id || `step-${i + 1}`,
      title: step.title,
      status: "pending",
    }));

    const ctx = {
      job,
      state: {},
      get cancelled() {
        return !!job.cancelled;
      },
      log: (text) =>
        JobRunner._append(job, text.endsWith("\n") ? text : `${text}\n`),
      sh: (script, opts = {}) =>
        JobRunner._spawn(
          job,
          "bash",
          [
            "-c",
            opts.preamble === false ? script : `${JOB_PREAMBLE}\n${script}`,
          ],
          { env: { ...env, ...opts.env }, cwd: opts.cwd },
        ),
      exec: (cmd, args, opts = {}) =>
        JobRunner._spawn(job, cmd, args, {
          env: { ...env, ...opts.env },
          cwd: opts.cwd,
        }),
    };

    (async () => {
      let failure = null;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const state = job.steps[i];
        if (failure || job.cancelled) {
          state.status = "skipped";
          continue;
        }
        try {
          if (step.when && !(await step.when(ctx))) {
            state.status = "skipped";
            continue;
          }
        } catch (err) {
          state.status = "skipped";
          continue;
        }
        state.status = "running";
        state.startedAt = new Date().toISOString();
        ctx.log(`\n━━ ${step.title}`);
        try {
          if (step.script) {
            const code = await ctx.sh(step.script, step);
            if (code !== 0)
              throw new Error(
                job.cancelled
                  ? "Cancelled"
                  : `Command failed (exit code ${code})`,
              );
          } else {
            await step.run(ctx);
          }
          if (job.cancelled) throw new Error("Cancelled");
          state.status = "done";
        } catch (err) {
          state.error = err.message;
          if (step.optional && !job.cancelled) {
            state.status = "warning";
            ctx.log(`⚠ ${err.message}`);
          } else {
            state.status = "failed";
            failure = err;
            ctx.log(`✖ ${err.message}`);
          }
        }
        state.finishedAt = new Date().toISOString();
      }
      const status = job.cancelled
        ? "cancelled"
        : failure
          ? "failed"
          : "completed";
      JobRunner._finish(job, status, status === "completed" ? 0 : 1);
      if (onExit) {
        try {
          await onExit(job, ctx);
        } catch (err) {
          JobRunner._append(job, `\n[post-job error] ${err.message}\n`);
        }
      }
    })();
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
      meta: job.meta,
      status: job.status,
      exitCode: job.exitCode,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      steps: job.steps,
      output: job.output.slice(from),
      nextOffset: total,
    };
  }

  /**
   * Full output of a job (for saving deployment logs).
   */
  static output(id) {
    const job = JobRunner.jobs.get(id);
    if (!job) return "";
    return (
      (job.dropped ? `[… ${job.dropped} earlier characters trimmed]\n` : "") +
      job.output
    );
  }

  static list() {
    return [...JobRunner.jobs.values()]
      .map(({ id, title, meta, status, exitCode, startedAt, finishedAt }) => ({
        id,
        title,
        meta,
        status,
        exitCode,
        startedAt,
        finishedAt,
      }))
      .reverse();
  }

  /**
   * The running job whose meta matches, e.g. findRunning({ kind: "deploy", siteId })
   */
  static findRunning(match) {
    for (const job of JobRunner.jobs.values()) {
      if (job.status !== "running") continue;
      if (Object.entries(match).every(([k, v]) => job.meta?.[k] === v))
        return job;
    }
    return null;
  }

  static cancel(id) {
    const job = JobRunner.jobs.get(id);
    if (!job || job.status !== "running") return false;
    job.cancelled = true;
    if (job._child) {
      try {
        process.kill(-job._child.pid, "SIGTERM"); // whole process group (apt, certbot, ...)
      } catch {
        job._child.kill("SIGTERM");
      }
    }
    return true;
  }

  static _prune() {
    if (JobRunner.jobs.size <= MAX_JOBS) return;
    for (const [id, job] of JobRunner.jobs) {
      if (JobRunner.jobs.size <= MAX_JOBS) break;
      if (job.status !== "running") JobRunner.jobs.delete(id);
    }
  }
}
