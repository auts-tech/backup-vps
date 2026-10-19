import { spawn } from "child_process";
import { existsSync } from "fs";

// Secrets from .env that must never leak into shells, jobs, or cron commands
const PRIVATE_ENV_KEYS = ["ADMIN_EMAIL", "ADMIN_PASSWORD", "SESSION_SECRET"];
// The panel's own listen address: an app that inherited PORT would try to bind the panel's port
const PANEL_ENV_KEYS = ["PORT", "HOST"];

/**
 * Copy of process.env without the panel's own secrets and listen settings
 * (values passed in `extra` are kept, e.g. a website's PORT).
 */
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of [...PRIVATE_ENV_KEYS, ...PANEL_ENV_KEYS]) delete env[key];
  Object.assign(env, extra);
  for (const key of PRIVATE_ENV_KEYS) delete env[key];
  return env;
}

/**
 * Environment for build tools (git, npm, composer, pm2) run by the panel:
 * systemd starts the panel without HOME and with a short PATH, and nothing
 * may ever wait for an interactive prompt.
 */
export function toolEnv(extra = {}) {
  const path = [
    ...(process.env.PATH || "").split(":"),
    "/usr/local/sbin",
    "/usr/local/bin",
    "/usr/sbin",
    "/usr/bin",
    "/sbin",
    "/bin",
  ].filter(Boolean);
  return {
    HOME: process.env.HOME || "/root",
    PATH: [...new Set(path)].join(":"),
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND:
      "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20",
    COMPOSER_ALLOW_SUPERUSER: "1",
    COMPOSER_NO_INTERACTION: "1",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_FUND: "false",
    ...extra,
  };
}

/**
 * Quote a value for safe use inside a bash script.
 */
export function shq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * Run a binary with an argument array (no shell interpolation).
 * Always resolves with { code, stdout, stderr } — never rejects on non-zero exit.
 * inheritEnv: false starts the command with only `env` (no panel environment).
 */
export function run(
  cmd,
  args = [],
  { input, timeout = 60000, env, cwd, inheritEnv = true } = {},
) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };

    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: inheritEnv ? cleanEnv(env) : { ...env },
      });
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: err.message });
      return;
    }

    const timer = timeout
      ? setTimeout(() => {
          stderr += `\nTimed out after ${Math.round(timeout / 1000)}s`;
          child.kill("SIGKILL");
        }, timeout)
      : null;

    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => {
      stderr += err.message;
      finish(-1);
    });
    child.on("close", (code) => finish(code));

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/**
 * Like run(), but throws an Error carrying stderr when the command fails.
 */
export async function runOrThrow(cmd, args = [], opts = {}) {
  const result = await run(cmd, args, opts);
  if (result.code !== 0) {
    const msg = (
      result.stderr ||
      result.stdout ||
      `${cmd} exited with code ${result.code}`
    ).trim();
    const err = new Error(msg);
    err.result = result;
    throw err;
  }
  return result;
}

/**
 * Run a trusted bash script (only ever built from validated values).
 */
export function bash(script, opts = {}) {
  return run("bash", ["-c", script], opts);
}

export async function which(bin) {
  const { code, stdout } = await run("sh", ["-c", `command -v ${bin}`], {
    timeout: 5000,
    env: { PATH: toolEnv().PATH },
  });
  return code === 0 ? stdout.trim() : null;
}

export function hasSystemd() {
  return existsSync("/run/systemd/system");
}

export function isDebianLike() {
  return existsSync("/etc/debian_version");
}

/**
 * Start/stop/restart/reload/enable a system service via systemd, or the
 * SysV `service` wrapper on hosts without systemd (containers).
 */
export function serviceCtl(action, name) {
  if (hasSystemd()) {
    const args =
      action === "enable" ? ["enable", "--now", name] : [action, name];
    return run("systemctl", args, { timeout: 120000 });
  }
  return run("service", [name, action === "enable" ? "start" : action], {
    timeout: 120000,
  });
}

export async function serviceActive(name) {
  if (hasSystemd()) {
    const { stdout } = await run("systemctl", ["is-active", name], {
      timeout: 10000,
    });
    return stdout.trim() === "active";
  }
  const { code } = await run("service", [name, "status"], { timeout: 10000 });
  return code === 0;
}

/**
 * Bash preamble for install jobs: non-interactive apt that waits for the dpkg
 * lock, plus a service helper that works with and without systemd.
 */
export const JOB_PREAMBLE = `
set -eo pipefail
export DEBIAN_FRONTEND=noninteractive
apt_get() { apt-get -y -o DPkg::Lock::Timeout=300 "$@"; }
svc_enable() { if [ -d /run/systemd/system ]; then systemctl enable --now "$1"; else service "$1" start; fi; }
svc_restart() { if [ -d /run/systemd/system ]; then systemctl restart "$1"; else service "$1" restart; fi; }
svc_reload() { if [ -d /run/systemd/system ]; then systemctl reload "$1"; else service "$1" reload; fi; }
ufw_allow() { if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then for p in "$@"; do ufw allow "$p" >/dev/null && echo "Firewall: allowed $p"; done; fi; }
`;
