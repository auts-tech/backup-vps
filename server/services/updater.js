import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { PROJECT_ROOT, SERVER_DIR, httpError } from '../lib/config.js';
import { run, hasSystemd } from '../lib/shell.js';
import { JobRunner } from './job-runner.js';
import { BackupEngine } from './backup-engine.js';

// Files that hold this server's own state: local copies always win over upstream
const STATE_FILES = ['server/data/config.json'];
// Generated files that older installs may have rewritten locally: upstream always wins
const GENERATED_FILES = ['server/package-lock.json'];
const CHECK_TTL = 10 * 60 * 1000;
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15' };

export const BOOT_ID = randomBytes(8).toString('hex');

function git(args, timeout = 30000) {
  // safe.directory: the repo may be owned by another user than the one running the panel
  return run('git', ['-c', `safe.directory=${PROJECT_ROOT}`, '-C', PROJECT_ROOT, ...args], { timeout, env: GIT_ENV });
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(SERVER_DIR, 'package.json'), 'utf-8')).version;
  } catch {
    return '0.0.0';
  }
}

function sanitizeRemote(url) {
  return (url || '').replace(/\/\/[^@/]+@/, '//');
}

function parseCommit(line) {
  const [hash, short, time, author, subject] = line.split('\x1f');
  return { hash, short, date: time ? new Date(parseInt(time) * 1000).toISOString() : null, author, subject };
}

/**
 * Self-update from the git remote this panel was cloned from.
 */
export class Updater {
  static cache = null;
  static job = null;

  static async version() {
    const isRepo = existsSync(join(PROJECT_ROOT, '.git'));
    const head = isRepo ? (await git(['log', '-1', '--format=%H%x1f%h%x1f%ct%x1f%an%x1f%s'])).stdout.trim() : '';
    return { version: packageVersion(), commit: head ? parseCommit(head) : null, bootId: BOOT_ID, gitCheckout: isRepo };
  }

  static async upstream() {
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    const up = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const ref = up.code === 0 ? up.stdout.trim() : `origin/${branch}`;
    const slash = ref.indexOf('/');
    return { branch, ref, remote: ref.slice(0, slash), remoteBranch: ref.slice(slash + 1) };
  }

  static async check({ force = false } = {}) {
    if (!force && Updater.cache && Date.now() - Updater.cache.at < CHECK_TTL) return Updater.cache.data;
    const base = await Updater.version();
    if (!base.gitCheckout) {
      return { ...base, supported: false, reason: 'This panel was not installed with git clone, so it cannot update itself. Re-install with git clone to enable updates.' };
    }

    const { branch, ref, remote, remoteBranch } = await Updater.upstream();
    if (branch === 'HEAD') return { ...base, supported: false, reason: 'The checkout is on a detached HEAD — switch to a branch (e.g. git checkout main) to enable updates.' };
    const remoteUrl = sanitizeRemote((await git(['remote', 'get-url', remote])).stdout.trim());

    const fetch = await git(['fetch', '--quiet', remote, remoteBranch], 60000);
    if (fetch.code !== 0) {
      const data = { ...base, supported: true, branch, upstream: ref, remoteUrl, error: `Could not reach ${remoteUrl || remote}: ${(fetch.stderr || fetch.stdout).trim().split('\n').pop()}`, checkedAt: new Date().toISOString() };
      Updater.cache = { at: Date.now(), data };
      return data;
    }

    const count = async (range) => parseInt((await git(['rev-list', '--count', range])).stdout.trim()) || 0;
    const [behind, ahead, latestLine] = await Promise.all([
      count(`HEAD..${ref}`),
      count(`${ref}..HEAD`),
      git(['log', '-1', '--format=%H%x1f%h%x1f%ct%x1f%an%x1f%s', ref]).then(r => r.stdout.trim())
    ]);

    let commits = [];
    let changedFiles = [];
    if (behind > 0) {
      const [log, diff] = await Promise.all([
        git(['log', '--format=%H%x1f%h%x1f%ct%x1f%an%x1f%s', '-n', '50', `HEAD..${ref}`]),
        git(['diff', '--name-only', 'HEAD', ref])
      ]);
      commits = log.stdout.split('\n').filter(Boolean).map(parseCommit);
      changedFiles = diff.stdout.split('\n').filter(Boolean);
    }

    // Tracked files edited on this server that the update would also change
    const status = await git(['status', '--porcelain', '--untracked-files=no']);
    const localChanges = status.stdout.split('\n').filter(Boolean).map(l => l.slice(3).trim());
    const conflicts = localChanges.filter(f => changedFiles.includes(f) && !STATE_FILES.includes(f) && !GENERATED_FILES.includes(f));

    let blocked = null;
    if (ahead > 0) blocked = `This server has ${ahead} local commit(s) that are not on ${ref}. Update manually with git.`;
    else if (conflicts.length) blocked = `These files were edited on the server and are also changed by the update: ${conflicts.join(', ')}. Commit or revert them first.`;

    const data = {
      ...base,
      supported: true,
      branch,
      upstream: ref,
      remoteUrl,
      latest: latestLine ? parseCommit(latestLine) : null,
      behind,
      ahead,
      commits,
      changedFiles: changedFiles.slice(0, 200),
      depsChanged: changedFiles.some(f => /^server\/package(-lock)?\.json$/.test(f)),
      setupChanged: changedFiles.includes('setup.sh'),
      updateAvailable: behind > 0,
      canUpdate: behind > 0 && !blocked,
      blocked,
      running: !!(Updater.job && JobRunner.get(Updater.job)?.status === 'running'),
      checkedAt: new Date().toISOString()
    };
    Updater.cache = { at: Date.now(), data };
    return data;
  }

  /**
   * Pull the update as a background job; the panel restarts itself when it succeeds.
   */
  static async apply() {
    if (Updater.job && JobRunner.get(Updater.job)?.status === 'running') return { jobId: Updater.job };
    const info = await Updater.check({ force: true });
    if (!info.supported) throw httpError(400, info.reason);
    if (info.error) throw httpError(502, info.error);
    if (!info.updateAvailable) throw httpError(409, 'Already up to date');
    if (info.blocked) throw httpError(409, info.blocked);

    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const G = `git -c safe.directory=${q(PROJECT_ROOT)}`;
    const script = `
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=15'
cd ${q(PROJECT_ROOT)}
OLD=$(${G} rev-parse HEAD)
STATE_DIR=$(mktemp -d)

echo "::step download"
echo "Fetching ${info.upstream} from ${info.remoteUrl}..."
${G} fetch --quiet ${q(info.upstream.split('/')[0])} ${q(info.upstream.slice(info.upstream.indexOf('/') + 1))}
for f in ${STATE_FILES.map(q).join(' ')}; do
  if [ -f "$f" ] && ! ${G} diff --quiet -- "$f"; then
    mkdir -p "$STATE_DIR/$(dirname "$f")"; cp -p "$f" "$STATE_DIR/$f"; ${G} checkout -- "$f"
    echo "Keeping this server's copy of $f"
  fi
done
for f in ${GENERATED_FILES.map(q).join(' ')}; do ${G} checkout -- "$f" 2>/dev/null || true; done
restore_state() { (cd "$STATE_DIR" && find . -type f) | while read -r f; do cp -p "$STATE_DIR/$f" "$f"; done; rm -rf "$STATE_DIR"; }
if ! ${G} merge --ff-only ${q(info.upstream)}; then restore_state; echo "Update could not be applied cleanly."; exit 1; fi
restore_state
NEW=$(${G} rev-parse HEAD)
${G} log --format='  %h %s' "$OLD..$NEW"

rollback() {
  echo "Rolling back to $OLD..."
  ${G} reset --keep "$OLD"
  (cd server && npm ci --omit=dev --no-audit --no-fund) || true
  exit 1
}

echo "::step deps"
if ! ${G} diff --quiet "$OLD" "$NEW" -- server/package.json server/package-lock.json || [ ! -d server/node_modules ]; then
  echo "Dependencies changed — running npm ci..."
  (cd server && npm ci --omit=dev --no-audit --no-fund) || rollback
else
  echo "Dependencies unchanged."
fi

echo "::step verify"
for f in $(find server -name '*.js' -not -path '*/node_modules/*'); do
  node --check "$f" || { echo "Syntax check failed: $f"; rollback; }
done
echo "All files verified."
${info.setupChanged ? 'echo "Note: setup.sh changed in this update — run sudo bash setup.sh from the Terminal to apply system-level changes."' : ''}
echo "::step restart"
echo "Restarting the panel..."
`;
    const job = JobRunner.start(`Update panel to ${info.latest?.short || 'latest'}`, script, {
      onExit: (j) => {
        Updater.cache = null;
        if (j.status === 'completed') {
          BackupEngine.log(`[Update] Panel updated to ${info.latest?.short} — restarting`);
          setTimeout(() => Updater.restartSelf(), 1500);
        }
      }
    });
    Updater.job = job.id;
    return { jobId: job.id, target: info.latest };
  }

  /**
   * Restart this process under whatever supervises it (systemd, pm2, or nothing).
   */
  static restartSelf() {
    let unit = null;
    try { unit = (readFileSync('/proc/self/cgroup', 'utf-8').match(/\/([^/\n]+\.service)\s*$/m) || [])[1] || null; } catch { }

    if (unit && hasSystemd()) {
      spawn('systemctl', ['--no-block', 'restart', unit], { detached: true, stdio: 'ignore' }).unref();
      return 'systemd';
    }
    if (process.env.pm_id !== undefined) {
      setTimeout(() => process.exit(0), 300);
      return 'pm2';
    }
    // Not supervised: start a replacement once this process has released the port
    spawn('sh', ['-c', 'sleep 2; exec "$0" "$@"', process.execPath, ...process.argv.slice(1)], {
      cwd: process.cwd(), detached: true, stdio: 'inherit', env: process.env
    }).unref();
    setTimeout(() => process.exit(0), 300);
    return 'respawn';
  }
}
