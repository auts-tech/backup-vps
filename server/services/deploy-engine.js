import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "fs";
import { join, dirname } from "path";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { DATA_DIR, getConfig, httpError } from "../lib/config.js";
import { run, toolEnv, serviceCtl, which } from "../lib/shell.js";
import { assertGitUrl, maskGitUrl } from "../lib/validate.js";
import { STACKS, normalizeStack, hasCommands } from "../lib/stacks.js";
import { JobRunner } from "./job-runner.js";
import { ProcessManager } from "./process-manager.js";
import { ComposerManager, phpShimDir } from "./composer-manager.js";
import { Notifier } from "./notifier.js";
import { BackupEngine } from "./backup-engine.js";

const HISTORY_DIR = join(DATA_DIR, "deploys");
const MAX_HISTORY = 30;
const MAX_LOG = 256 * 1024;
const GIT_BASE = ["-c", "safe.directory=*"];

/**
 * Run git (never through a shell). `cwd` null runs outside a repository.
 */
export function git(cwd, args, { timeout = 60000 } = {}) {
  return run("git", [...GIT_BASE, ...(cwd ? ["-C", cwd] : []), ...args], {
    timeout,
    env: toolEnv(),
  });
}

function parseCommit(line) {
  if (!line) return null;
  const [hash, short, time, author, subject] = line.split("\x1f");
  if (!hash) return null;
  return {
    hash,
    short,
    date: time ? new Date(parseInt(time) * 1000).toISOString() : null,
    author,
    subject,
  };
}

const COMMIT_FORMAT = "--format=%H%x1f%h%x1f%ct%x1f%an%x1f%s";

/**
 * Turn git's error output into something a person can act on.
 */
export function explainGitError(text) {
  const t = String(text || "");
  if (/Permission denied \(publickey\)|Host key verification failed/i.test(t))
    return "The server has no access to this repository. Add the server's deploy key (Security → SSH Keys) to the repository, or use an https URL with a token.";
  if (/Authentication failed|could not read Username|403/i.test(t))
    return "Authentication failed. For a private repository use an SSH URL with the server's deploy key, or https://<token>@github.com/org/repo.git.";
  if (/Repository not found|not found|does not appear to be a git repository/i.test(t))
    return "Repository not found — check the URL (private repositories need the deploy key).";
  if (/Remote branch .* not found|couldn't find remote ref/i.test(t))
    return "That branch does not exist in the repository.";
  if (/Could not resolve host|unable to access/i.test(t))
    return "The server could not reach the Git host — check the URL and the server's internet access.";
  return t.trim().split("\n").filter(Boolean).slice(-3).join(" ") || "git failed";
}

/**
 * Deployments: pull the code, run the website's deploy script, restart the
 * app — one background job with a step list, recorded in the history.
 */
export class DeployEngine {
  static queued = new Set(); // website ids with a webhook deploy waiting for the running one

  // ── Git information ────────────────────────────────────────

  static async gitInfo(path) {
    if (!path || !existsSync(join(path, ".git"))) return null;
    const [branch, remote, last, status] = await Promise.all([
      git(path, ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 10000 }),
      git(path, ["remote", "get-url", "origin"], { timeout: 10000 }),
      git(path, ["log", "-1", COMMIT_FORMAT], { timeout: 10000 }),
      git(path, ["status", "--porcelain", "--untracked-files=no"], {
        timeout: 15000,
      }),
    ]);
    return {
      branch: branch.code === 0 ? branch.stdout.trim() : null,
      remote: remote.code === 0 ? maskGitUrl(remote.stdout.trim()) : null,
      commit: last.code === 0 ? parseCommit(last.stdout.trim()) : null,
      localChanges: status.stdout.split("\n").filter(Boolean).length,
    };
  }

  /**
   * Fetch the remote branch and list commits that are not deployed yet.
   */
  static async pendingCommits(site) {
    if (!existsSync(join(site.deployPath, ".git")))
      throw httpError(409, "This website is not a Git checkout");
    const fetch = await git(
      site.deployPath,
      ["fetch", "--prune", "origin", `+refs/heads/${site.branch}:refs/remotes/origin/${site.branch}`],
      { timeout: 120000 },
    );
    if (fetch.code !== 0) throw httpError(502, explainGitError(fetch.stderr || fetch.stdout));
    const [log, ahead] = await Promise.all([
      git(site.deployPath, ["log", COMMIT_FORMAT, "-n", "30", `HEAD..origin/${site.branch}`]),
      git(site.deployPath, ["rev-list", "--count", `origin/${site.branch}..HEAD`]),
    ]);
    return {
      branch: site.branch,
      commits: log.stdout.split("\n").filter(Boolean).map(parseCommit),
      localOnly: parseInt(ahead.stdout.trim()) || 0,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Branches of a remote repository (and its default branch), without cloning.
   */
  static async remoteBranches(url) {
    const repo = assertGitUrl(url);
    const [head, heads] = await Promise.all([
      git(null, ["ls-remote", "--symref", "--", repo, "HEAD"], { timeout: 30000 }),
      git(null, ["ls-remote", "--heads", "--", repo], { timeout: 30000 }),
    ]);
    if (heads.code !== 0) throw httpError(400, explainGitError(heads.stderr || heads.stdout));
    const branches = heads.stdout
      .split("\n")
      .map((l) => (l.split("\t")[1] || "").replace(/^refs\/heads\//, ""))
      .filter(Boolean)
      .sort();
    const def = (head.stdout.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m) || [])[1] || null;
    return { branches, defaultBranch: def || (branches.includes("main") ? "main" : branches[0] || "main") };
  }

  // ── History ────────────────────────────────────────────────

  static historyFile(siteId) {
    return join(HISTORY_DIR, `${siteId}.json`);
  }

  static logFile(siteId, deployId) {
    if (!/^[a-z0-9-]{4,40}$/.test(deployId)) throw httpError(400, "Invalid deployment id");
    return join(HISTORY_DIR, siteId, `${deployId}.log`);
  }

  static history(siteId) {
    try {
      return JSON.parse(readFileSync(DeployEngine.historyFile(siteId), "utf-8"));
    } catch {
      return [];
    }
  }

  static _record(siteId, entry) {
    mkdirSync(HISTORY_DIR, { recursive: true });
    const list = DeployEngine.history(siteId).filter((d) => d.id !== entry.id);
    list.unshift(entry);
    for (const old of list.splice(MAX_HISTORY)) {
      try {
        rmSync(DeployEngine.logFile(siteId, old.id), { force: true });
      } catch {}
    }
    writeFileSync(DeployEngine.historyFile(siteId), JSON.stringify(list, null, 2));
  }

  static readLog(siteId, deployId) {
    const entry = DeployEngine.history(siteId).find((d) => d.id === deployId);
    if (!entry) throw httpError(404, "Deployment not found");
    if (entry.status === "running" && entry.jobId) {
      const live = JobRunner.output(entry.jobId);
      if (live) return { entry, log: live };
    }
    try {
      return { entry, log: readFileSync(DeployEngine.logFile(siteId, deployId), "utf-8") };
    } catch {
      return { entry, log: "(The log for this deployment is no longer available.)" };
    }
  }

  static lastDeploy(siteId) {
    return DeployEngine.history(siteId)[0] || null;
  }

  /**
   * Remove a website's whole deployment history (when it is deleted).
   */
  static clearHistory(siteId) {
    rmSync(DeployEngine.historyFile(siteId), { force: true });
    rmSync(join(HISTORY_DIR, siteId), { recursive: true, force: true });
  }

  /**
   * Mark deployments still "running" from before a panel restart as interrupted.
   */
  static recoverInterrupted(siteIds) {
    for (const id of siteIds) {
      const list = DeployEngine.history(id);
      let changed = false;
      for (const entry of list) {
        if (entry.status === "running" && !JobRunner.jobs.has(entry.jobId)) {
          entry.status = "failed";
          entry.error = "Interrupted (the panel restarted)";
          changed = true;
        }
      }
      if (changed) writeFileSync(DeployEngine.historyFile(id), JSON.stringify(list, null, 2));
    }
  }

  // ── Deploy ─────────────────────────────────────────────────

  static running(siteId) {
    return JobRunner.findRunning({ kind: "deploy", siteId }) || JobRunner.findRunning({ kind: "provision", siteId });
  }

  /**
   * Environment for a website's deploy script.
   */
  static scriptEnv(site) {
    const env = toolEnv({
      SITE_NAME: site.name,
      SITE_PATH: site.deployPath,
      BRANCH: site.branch || "",
      ...(site.port ? { PORT: String(site.port) } : {}),
    });
    const stack = STACKS[normalizeStack(site.type)];
    if (stack.php && site.phpVersion) {
      const shim = phpShimDir(site.phpVersion);
      if (shim) env.PATH = `${shim}:${env.PATH}`;
    }
    return env;
  }

  /**
   * Steps shared by deployments and new-site setup: tools, build, permissions, restart, health.
   */
  static buildSteps(site) {
    const stack = STACKS[normalizeStack(site.type)];
    const script = site.deploy?.script || "";
    return [
      {
        id: "composer",
        title: "Install Composer",
        when: async () => stack.php && /\bcomposer\b/.test(script) && !(await which("composer")),
        script: ComposerManager.installScript(),
      },
      {
        id: "build",
        title: "Run deploy script",
        when: () => hasCommands(script),
        cwd: site.deployPath,
        env: DeployEngine.scriptEnv(site),
        // Echo each command (PS4) so the log reads like a terminal session
        script: `export PS4='$ '\nset -x\n${script}`,
      },
      {
        id: "permissions",
        title: "Fix file permissions",
        when: () => stack.php && existsSync(site.deployPath),
        run: async (ctx) => {
          const r = await run("chown", ["-R", "www-data:www-data", site.deployPath], { timeout: 600000 });
          if (r.code !== 0) throw new Error(r.stderr.trim() || "chown failed");
          ctx.log(`Files in ${site.deployPath} belong to www-data (PHP can write uploads and cache).`);
        },
        optional: true,
      },
      {
        id: "pm2",
        title: "Install PM2 (process manager)",
        when: async () => stack.process && !(await ProcessManager.installed()),
        script: ProcessManager.installScript(),
      },
      {
        id: "restart",
        title: stack.process ? "Start app" : "Reload PHP",
        when: () => stack.process || (stack.php && site.phpVersion),
        optional: !stack.process,
        run: async (ctx) => {
          if (stack.process) {
            await ProcessManager.startOrReload(site);
            ctx.log(`pm2: ${site.name} is (re)started with: ${site.startCommand}`);
            return;
          }
          const r = await serviceCtl("reload", `php${site.phpVersion}-fpm`);
          if (r.code !== 0) throw new Error(`Could not reload PHP ${site.phpVersion}-FPM: ${(r.stderr || r.stdout).trim()}`);
          ctx.log(`PHP ${site.phpVersion}-FPM reloaded (fresh OPcache).`);
        },
      },
      {
        id: "health",
        title: site.port ? `Check the app answers on port ${site.port}` : "Check the app is running",
        when: () => stack.process,
        run: async (ctx) => {
          await new Promise((r) => setTimeout(r, 3000));
          const proc = await ProcessManager.status(site.name);
          if (proc.status !== "online") {
            const tail = await ProcessManager.logs(site, "err", 25).catch(() => ({ lines: [] }));
            if (tail.lines.length) ctx.log(`Last error output:\n${tail.lines.join("\n")}`);
            throw new Error(`The app is ${proc.status} — it crashed while starting. See the error output above or the App tab.`);
          }
          if (site.port && !(await ProcessManager.waitForPort(site.port, 30000))) {
            const err = new Error(
              `The app runs but nothing answers on port ${site.port}. Make sure it listens on process.env.PORT (currently ${site.port}).`,
            );
            err.optional = true;
            throw err;
          }
          ctx.log(site.port ? `The app answers on 127.0.0.1:${site.port}.` : "The app is online.");
        },
      },
    ];
  }

  /**
   * Start a deployment. Returns { jobId, deployId } at once; the job does the work.
   *   trigger: manual | webhook | rollback | setup
   *   commit:  roll back to this commit instead of pulling the branch
   */
  static deploy(site, { trigger = "manual", commit = null, by = null } = {}) {
    const running = DeployEngine.running(site.id);
    if (running) {
      if (trigger === "webhook") {
        DeployEngine.queued.add(site.id);
        return { queued: true, jobId: running.id };
      }
      const err = httpError(409, "A deployment is already running for this website");
      err.jobId = running.id;
      throw err;
    }
    if (!existsSync(site.deployPath)) throw httpError(409, `${site.deployPath} does not exist`);
    if (commit && !/^[0-9a-f]{7,40}$/.test(commit)) throw httpError(400, "Invalid commit");

    const deployId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    const hasGit = existsSync(join(site.deployPath, ".git"));
    if (commit && !hasGit) throw httpError(409, "Rollback needs a Git checkout");
    const startedAt = new Date().toISOString();
    const entry = {
      id: deployId,
      trigger,
      by,
      status: "running",
      branch: site.branch || null,
      rollbackTo: commit,
      startedAt,
    };

    const pull = {
      id: "pull",
      title: commit ? `Roll back to ${commit.slice(0, 7)}` : `Pull latest code from ${site.branch}`,
      when: () => hasGit && !!site.branch,
      run: async (ctx) => {
        const cwd = site.deployPath;
        const gitArgs = (args) => [...GIT_BASE, "-C", cwd, ...args];
        ctx.state.before = (await git(cwd, ["rev-parse", "HEAD"])).stdout.trim() || null;

        // Settings may have changed the repository URL since the clone
        if (site.gitUrl) {
          const remote = (await git(cwd, ["remote", "get-url", "origin"])).stdout.trim();
          if (remote && remote !== site.gitUrl) await git(cwd, ["remote", "set-url", "origin", site.gitUrl]);
        }

        ctx.log(`$ git fetch origin ${site.branch}`);
        let code = await ctx.exec(
          "git",
          gitArgs(["fetch", "--prune", "origin", `+refs/heads/${site.branch}:refs/remotes/origin/${site.branch}`]),
        );
        if (code !== 0) throw new Error("git fetch failed — check the repository URL and that the server can access it (deploy key).");

        const current = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
        if (commit) {
          ctx.log(`$ git reset --hard ${commit}`);
          code = await ctx.exec("git", gitArgs(["reset", "--hard", commit]));
        } else if (site.deploy?.resetHard) {
          ctx.log(`$ git checkout -B ${site.branch} origin/${site.branch} --force   (discarding server changes)`);
          code = await ctx.exec("git", gitArgs(["checkout", "-f", "-B", site.branch, `origin/${site.branch}`]));
        } else if (current !== site.branch) {
          ctx.log(`$ git checkout -B ${site.branch} origin/${site.branch}`);
          code = await ctx.exec("git", gitArgs(["checkout", "-B", site.branch, `origin/${site.branch}`]));
        } else {
          ctx.log(`$ git merge --ff-only origin/${site.branch}`);
          code = await ctx.exec("git", gitArgs(["merge", "--ff-only", `origin/${site.branch}`]));
        }
        if (code !== 0)
          throw new Error(
            commit
              ? "Could not check out that commit."
              : 'Could not update the code: files were changed on the server or the history diverged. Enable "Discard server changes on deploy" in Settings, or fix it in the Terminal.',
          );

        const after = await git(cwd, ["log", "-1", COMMIT_FORMAT]);
        ctx.state.commit = parseCommit(after.stdout.trim());
        if (ctx.state.before && ctx.state.commit?.hash === ctx.state.before) {
          ctx.log("Already up to date.");
        } else if (ctx.state.before) {
          const range = await git(cwd, ["log", "--format=  %h %s (%an)", "-n", "20", `${ctx.state.before}..HEAD`]);
          if (range.stdout.trim()) ctx.log(`New commits:\n${range.stdout.trimEnd()}`);
        }
      },
    };

    const steps = [pull, ...DeployEngine.buildSteps(site)];
    // A health warning must not fail the deploy
    const health = steps.find((s) => s.id === "health");
    const runHealth = health.run;
    health.run = async (ctx) => {
      try {
        await runHealth(ctx);
      } catch (err) {
        if (!err.optional) throw err;
        ctx.state.healthWarning = err.message;
        ctx.log(`⚠ ${err.message}`);
      }
    };

    const job = JobRunner.pipeline(
      commit ? `Roll back ${site.name}` : `Deploy ${site.name}`,
      steps,
      {
        meta: { kind: "deploy", siteId: site.id, deployId },
        env: toolEnv(),
        onExit: (job, ctx) => DeployEngine._finished(site, entry, job, ctx),
      },
    );
    entry.jobId = job.id;
    DeployEngine._record(site.id, entry);
    return { jobId: job.id, deployId };
  }

  static async _finished(site, entry, job, ctx) {
    const finishedAt = new Date();
    const warned = job.steps.some((s) => s.status === "warning") || !!ctx.state.healthWarning;
    entry.status = job.status === "completed" ? (warned ? "warning" : "success") : job.status;
    entry.finishedAt = finishedAt.toISOString();
    entry.duration = Math.round((finishedAt - new Date(entry.startedAt)) / 1000);
    entry.commitBefore = ctx.state.before || null;
    entry.commit = ctx.state.commit || (await DeployEngine.gitInfo(site.deployPath).catch(() => null))?.commit || null;
    const failedStep = job.steps.find((s) => s.status === "failed");
    if (failedStep) entry.error = `${failedStep.title}: ${failedStep.error}`;
    else if (ctx.state.healthWarning) entry.error = ctx.state.healthWarning;

    try {
      mkdirSync(join(HISTORY_DIR, site.id), { recursive: true });
      const log = JobRunner.output(job.id);
      writeFileSync(
        DeployEngine.logFile(site.id, entry.id),
        log.length > MAX_LOG ? `[… trimmed]\n${log.slice(-MAX_LOG)}` : log,
      );
    } catch {}
    DeployEngine._record(site.id, entry);

    const ok = entry.status === "success" || entry.status === "warning";
    BackupEngine.log(`[Deploy] ${site.name}: ${entry.status}${entry.commit ? ` @ ${entry.commit.short}` : ""}`);
    if (entry.status !== "cancelled") {
      const commitText = entry.commit ? `${entry.commit.short} — ${entry.commit.subject}` : "no commit";
      const results = await Notifier.notifyAll(getConfig(), {
        title: ok ? `🚀 ${site.name} deployed` : `❌ ${site.name} deploy failed`,
        message: `${commitText}\nTrigger: ${entry.trigger}\nDuration: ${entry.duration}s${entry.error ? `\n${ok ? "Warning" : "Error"}: ${entry.error}` : ""}`,
        color: ok ? 3066993 : 15158332,
      }).catch(() => ({}));
      BackupEngine.logNotificationResults(results);
    }

    if (DeployEngine.queued.delete(site.id)) {
      const fresh = (getConfig().projects || []).find((p) => p.id === site.id);
      if (fresh) {
        try {
          DeployEngine.deploy(fresh, { trigger: "webhook" });
        } catch {}
      }
    }
  }

  // ── Webhooks (push to deploy) ──────────────────────────────

  static newWebhookSecret() {
    return randomBytes(24).toString("hex");
  }

  /**
   * Check a push webhook from GitHub, GitLab, Gitea or Bitbucket.
   * Returns { status, message, branch?, deploy: bool }.
   */
  static checkWebhook(site, { headers, query, rawBody }) {
    const secret = site.deploy?.webhookSecret;
    if (!site.deploy?.autoDeploy || !secret) return { status: 404, message: "Auto-deploy is not enabled for this website" };

    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
    const equal = (a, b) => {
      const ba = Buffer.from(String(a || ""));
      const bb = Buffer.from(String(b || ""));
      return ba.length === bb.length && timingSafeEqual(ba, bb);
    };
    const signature = headers["x-hub-signature-256"];
    let valid = false;
    if (signature) valid = equal(signature, `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
    else if (headers["x-gitlab-token"]) valid = equal(headers["x-gitlab-token"], secret);
    else if (query.token) valid = equal(query.token, secret);
    if (!valid) return { status: 401, message: "Invalid webhook signature or token" };

    const event = headers["x-github-event"] || headers["x-gitea-event"] || headers["x-gitlab-event"] || headers["x-event-key"] || "push";
    if (event === "ping") return { status: 200, message: "pong — webhook is connected" };

    let payload = {};
    try {
      let text = body.toString("utf-8");
      if (text.startsWith("payload=")) text = decodeURIComponent(text.slice(8).replace(/\+/g, " "));
      payload = text ? JSON.parse(text) : {};
    } catch {}
    const ref = payload.ref || payload.push?.changes?.[0]?.new?.name || null;
    const branch = ref ? String(ref).replace(/^refs\/heads\//, "") : null;
    if (branch && site.branch && branch !== site.branch)
      return { status: 200, message: `Ignored: push to ${branch}, this website deploys ${site.branch}` };
    if (/tag/i.test(event) || String(ref || "").startsWith("refs/tags/"))
      return { status: 200, message: "Ignored: tag push" };
    return { status: 202, deploy: true, branch, message: "Deployment started", pusher: payload.pusher?.name || payload.user_name || payload.actor?.display_name || null };
  }

  /**
   * Clone a repository into a new website folder (used by website setup).
   */
  static cloneStep(site) {
    return {
      id: "clone",
      title: `Clone ${maskGitUrl(site.gitUrl)} (${site.branch})`,
      run: async (ctx) => {
        if (existsSync(join(site.deployPath, ".git"))) {
          ctx.log(`${site.deployPath} is already a Git checkout — skipping clone.`);
          return;
        }
        mkdirSync(dirname(site.deployPath), { recursive: true });
        ctx.log(`$ git clone --branch ${site.branch} ${maskGitUrl(site.gitUrl)} ${site.deployPath}`);
        const code = await ctx.exec("git", [...GIT_BASE, "clone", "--branch", site.branch, "--", site.gitUrl, site.deployPath]);
        if (code !== 0) {
          const tail = JobRunner.output(ctx.job.id).split("\n").slice(-6).join("\n");
          throw new Error(explainGitError(tail));
        }
        const head = await git(site.deployPath, ["log", "-1", COMMIT_FORMAT]);
        ctx.state.commit = parseCommit(head.stdout.trim());
        if (ctx.state.commit) ctx.log(`Checked out ${ctx.state.commit.short} — ${ctx.state.commit.subject}`);
      },
    };
  }
}
