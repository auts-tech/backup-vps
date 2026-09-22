import { readFileSync, readlinkSync } from 'fs';
import { run, which } from '../lib/shell.js';
import { getConfig, httpError } from '../lib/config.js';
import { NginxManager } from './nginx-manager.js';

// Friendly names for ports that are usually obvious from the number alone
const WELL_KNOWN = {
  21: 'FTP', 22: 'SSH', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS',
  465: 'SMTPS', 587: 'SMTP submission', 993: 'IMAPS', 995: 'POP3S', 3000: 'Node.js (common)',
  3306: 'MySQL / MariaDB', 5432: 'PostgreSQL', 6379: 'Redis', 8025: 'Webmail (Roundcube)',
  9000: 'PHP-FPM / app', 11211: 'Memcached', 27017: 'MongoDB'
};

// UFW application profiles → ports
const UFW_PROFILES = {
  'nginx full': [80, 443], 'nginx http': [80], 'nginx https': [443], 'nginx quic': [443],
  openssh: [22], 'apache full': [80, 443], apache: [80], 'apache secure': [443]
};

const isLocalAddress = (a) => a === '127.0.0.1' || a === '::1' || a.startsWith('127.') || a === 'localhost' || a.startsWith('::ffff:127.');

/**
 * Parse one line of `ss -H -l -t -u -n -p` output.
 */
function parseSsLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [proto, , , , local, , ...rest] = parts;
  const idx = local.lastIndexOf(':');
  if (idx === -1) return null;
  const port = parseInt(local.slice(idx + 1));
  if (!port) return null;
  const address = local.slice(0, idx).replace(/^\[|\]$/g, '').replace(/%.*$/, '') || '*';
  const processes = [...rest.join(' ').matchAll(/\("([^"]+)",pid=(\d+),fd=\d+\)/g)].map(m => ({ name: m[1], pid: parseInt(m[2]) }));
  return { proto, port, address, processes };
}

function readProc(pid, file) {
  try { return readFileSync(`/proc/${pid}/${file}`, 'utf-8'); } catch { return ''; }
}

function usersById() {
  const map = new Map();
  try {
    for (const line of readFileSync('/etc/passwd', 'utf-8').split('\n')) {
      const [name, , uid] = line.split(':');
      if (name) map.set(parseInt(uid), name);
    }
  } catch { }
  return map;
}

/**
 * Details for a PID from /proc: command line, cwd, user, parent, systemd unit, memory.
 */
function processInfo(pid, users) {
  const status = readProc(pid, 'status');
  const uid = parseInt((status.match(/^Uid:\s+(\d+)/m) || [])[1]);
  const cgroup = readProc(pid, 'cgroup');
  let cwd = null;
  try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { }
  return {
    pid,
    user: Number.isNaN(uid) ? null : (users.get(uid) || String(uid)),
    ppid: parseInt((status.match(/^PPid:\s+(\d+)/m) || [])[1]) || null,
    rssBytes: (parseInt((status.match(/^VmRSS:\s+(\d+)/m) || [])[1]) || 0) * 1024,
    cmdline: readProc(pid, 'cmdline').split('\0').filter(Boolean).join(' '),
    cwd,
    unit: (cgroup.match(/\/([^/\n]+\.service)\s*$/m) || [])[1] || null
  };
}

function ancestors(pid, limit = 5) {
  const chain = [];
  let current = pid;
  for (let i = 0; i < limit && current > 1; i++) {
    const ppid = parseInt((readProc(current, 'status').match(/^PPid:\s+(\d+)/m) || [])[1]);
    if (!ppid) break;
    chain.push(ppid);
    current = ppid;
  }
  return chain;
}

async function dockerPortMap() {
  const map = new Map();
  if (!(await which('docker'))) return map;
  const r = await run('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}'], { timeout: 10000 });
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const [name, image, ports] = line.split('\t');
    for (const m of (ports || '').matchAll(/:(\d+)->(\d+)\/(tcp|udp)/g)) {
      map.set(`${m[3]}:${m[1]}`, { name, image, containerPort: parseInt(m[2]) });
    }
  }
  return map;
}

async function pm2Map() {
  const map = new Map();
  if (!(await which('pm2'))) return map;
  const r = await run('pm2', ['jlist'], { timeout: 10000 });
  try {
    const start = r.stdout.indexOf('[');
    for (const p of JSON.parse(r.stdout.slice(start))) {
      if (p.pid) map.set(p.pid, { name: p.name, cwd: p.pm2_env?.pm_cwd, status: p.pm2_env?.status });
    }
  } catch { }
  return map;
}

/**
 * Ports allowed by UFW, or null when UFW is not active.
 */
async function ufwAllowed() {
  if (!(await which('ufw'))) return null;
  const r = await run('ufw', ['status'], { timeout: 10000 });
  if (!/Status:\s+active/.test(r.stdout)) return null;
  const allowed = new Set();
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(.+?)\s{2,}(ALLOW|LIMIT)(?:\s+IN)?\s{2,}/);
    if (!m) continue;
    const target = m[1].replace(/\s*\(v6\)\s*$/, '').trim();
    const profile = UFW_PROFILES[target.toLowerCase()];
    if (profile) { profile.forEach(p => allowed.add(p)); continue; }
    const spec = target.split('/')[0];
    for (const part of spec.split(',')) {
      const range = part.split(':').map(n => parseInt(n));
      if (range.length === 2 && range.every(Boolean)) for (let p = range[0]; p <= range[1] && p - range[0] < 10000; p++) allowed.add(p);
      else if (range[0]) allowed.add(range[0]);
    }
  }
  return allowed;
}

function nginxSitesByPort(sites) {
  const listening = new Map(); // port → site names nginx serves on that port
  const proxied = new Map();   // upstream port → site names proxying to it
  for (const site of sites.filter(s => s.enabled)) {
    const names = site.serverNames.filter(n => n !== '_');
    const label = names[0] || site.name;
    for (const l of site.listens) {
      const port = parseInt((l.match(/(?:^|:)(\d+)(?:\s|$)/) || [])[1]);
      if (port) {
        if (!listening.has(port)) listening.set(port, []);
        listening.get(port).push(label);
      }
    }
    const up = site.proxyPass && site.proxyPass.match(/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):(\d+)/);
    if (up) {
      const port = parseInt(up[1]);
      if (!proxied.has(port)) proxied.set(port, []);
      proxied.get(port).push(label);
    }
  }
  return { listening, proxied };
}

export class PortScanner {

  static async list() {
    const r = await run('ss', ['-H', '-l', '-t', '-u', '-n', '-p'], { timeout: 15000 });
    if (r.code !== 0) throw httpError(500, `Could not list ports (ss): ${(r.stderr || r.stdout).trim() || 'ss not available'}`);

    const [docker, pm2, allowed] = await Promise.all([dockerPortMap(), pm2Map(), ufwAllowed()]);
    let sites = [];
    try { sites = NginxManager.listSites(); } catch { }
    const nginx = nginxSitesByPort(sites);
    const projects = getConfig().projects || [];
    const users = usersById();
    const procCache = new Map();
    const info = (pid) => {
      if (!procCache.has(pid)) procCache.set(pid, processInfo(pid, users));
      return procCache.get(pid);
    };

    // One entry per protocol + port (IPv4 and IPv6 listeners merged)
    const grouped = new Map();
    for (const s of r.stdout.split('\n').filter(Boolean).map(parseSsLine).filter(Boolean)) {
      const key = `${s.proto}:${s.port}`;
      if (!grouped.has(key)) grouped.set(key, { proto: s.proto, port: s.port, addresses: new Set(), pids: new Map() });
      const g = grouped.get(key);
      g.addresses.add(s.address);
      for (const p of s.processes) g.pids.set(p.pid, p.name);
    }

    const entries = [...grouped.values()].map(g => {
      const addresses = [...g.addresses];
      const local = addresses.every(isLocalAddress);
      const processes = [...g.pids.entries()].map(([pid, name]) => ({ ...info(pid), name }));
      // Collapse worker processes (nginx, php-fpm, apache) to their master for display
      const pidSet = new Set(processes.map(p => p.pid));
      const primary = processes.filter(p => !pidSet.has(p.ppid));
      const shown = (primary.length ? primary : processes).slice(0, 4);

      const owners = [];
      const add = (type, name, detail = '') => {
        if (!owners.some(o => o.type === type && o.name === name)) owners.push({ type, name, detail });
      };
      const dockerHit = docker.get(`${g.proto.replace('6', '')}:${g.port}`);

      for (const p of processes) {
        const chain = [p.pid, ...ancestors(p.pid)];
        if (chain.includes(process.pid)) add('panel', 'VPS Panel', 'this dashboard');
        for (const id of chain) {
          const app = pm2.get(id);
          if (app) {
            add('pm2', app.name, app.status || '');
            const project = projects.find(pr => pr.name === app.name);
            if (project) add('project', project.name, project.type || '');
          }
        }
        for (const project of projects) {
          const path = project.deployPath && project.deployPath !== '/' ? project.deployPath.replace(/\/+$/, '') : null;
          const inPath = path && ((p.cwd && (p.cwd === path || p.cwd.startsWith(path + '/'))) || p.cmdline.includes(path + '/'));
          if (inPath || (project.port && parseInt(project.port) === g.port)) add('project', project.name, project.type || '');
        }
        if (p.unit && p.unit !== 'docker.service' && !p.unit.startsWith('session-')) add('service', p.unit);
      }
      if (dockerHit) add('docker', dockerHit.name, `${dockerHit.image} → :${dockerHit.containerPort}`);
      if (processes.some(p => p.name === 'nginx') && nginx.listening.has(g.port)) {
        add('sites', 'nginx', nginx.listening.get(g.port).join(', '));
      }
      if (nginx.proxied.has(g.port)) add('proxied', nginx.proxied.get(g.port).join(', '), 'via nginx');

      let firewall = 'none';
      if (local) firewall = 'local';
      else if (dockerHit) firewall = 'docker';
      else if (allowed) firewall = allowed.has(g.port) ? 'allowed' : 'blocked';

      return {
        proto: g.proto,
        port: g.port,
        addresses,
        exposure: local ? 'local' : 'public',
        label: WELL_KNOWN[g.port] || null,
        processes: shown,
        workerCount: processes.length,
        owners,
        firewall
      };
    }).sort((a, b) => (a.proto === b.proto ? a.port - b.port : a.proto.startsWith('tcp') ? -1 : 1));

    return { ports: entries, firewallActive: !!allowed, panelPid: process.pid };
  }

  /**
   * Stop a process by PID, refusing the ones that would lock you out.
   */
  static async kill(pid, signal = 'TERM') {
    pid = parseInt(pid);
    if (!pid || pid <= 1) throw httpError(400, 'Invalid PID');
    if (!['TERM', 'KILL'].includes(signal)) throw httpError(400, 'Signal must be TERM or KILL');
    if (pid === process.pid || ancestors(process.pid).includes(pid)) throw httpError(400, 'That is the panel itself — restart it from the update menu or systemctl instead');
    const name = readProc(pid, 'comm').trim();
    if (!name) throw httpError(404, `Process ${pid} is not running`);
    if (/^sshd/.test(name)) throw httpError(400, 'Refusing to stop SSH — you could lock yourself out of the server');
    const unit = processInfo(pid, new Map()).unit;
    const r = await run('kill', [`-${signal}`, String(pid)], { timeout: 5000 });
    if (r.code !== 0) throw httpError(500, r.stderr.trim() || `Could not signal ${pid}`);
    return { success: true, name, unit };
  }
}
