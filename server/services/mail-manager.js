import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, chmodSync } from 'fs';
import { join } from 'path';
import net from 'net';
import { Resolver } from 'dns/promises';
import { DATA_DIR, httpError } from '../lib/config.js';
import { run, which } from '../lib/shell.js';

/**
 * Email hosting on top of docker-mailserver (Postfix + Dovecot + Rspamd + Fail2ban)
 * with optional Roundcube webmail. Accounts and aliases are managed through the
 * container's `setup` CLI; state is read from the mounted config files.
 */
export const MAIL_DIR = '/opt/vps-mail';
const CONFIG_DIR = join(MAIL_DIR, 'docker-data', 'dms', 'config');
const SETTINGS_FILE = join(DATA_DIR, 'mail.json');
const CONTAINER = 'mailserver';
const WEBMAIL_CONTAINER = 'roundcube';
const WEBMAIL_PORT = 8025;
const MAIL_NET = { subnet: '172.30.53.0/24', mailserver: '172.30.53.10' };

const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}$/;
const DOMAIN = /^([A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}$/;

export function assertEmail(e, field = 'email') {
  if (!EMAIL.test(e || '')) throw httpError(400, `Invalid ${field} "${e}"`);
  return e.toLowerCase();
}
export function assertDomain(d) {
  if (!DOMAIN.test(d || '')) throw httpError(400, `Invalid domain "${d}"`);
  return d.toLowerCase();
}
function assertPassword(p) {
  if (!p || p.length < 8) throw httpError(400, 'Password must be at least 8 characters');
  if (/[\r\n]/.test(p)) throw httpError(400, 'Password cannot contain line breaks');
}

function readLines(file) {
  try {
    return readFileSync(file, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

export class MailManager {

  static settings() {
    try {
      return JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    } catch {
      return null;
    }
  }

  static saveSettings(s) {
    writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
  }

  static async containerState(name) {
    const r = await run('docker', ['inspect', '-f', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}', name], { timeout: 10000 });
    if (r.code !== 0) return null;
    const [status, health] = r.stdout.trim().split('|');
    return { status, health: health || null };
  }

  static async status() {
    const docker = await which('docker');
    const settings = MailManager.settings();
    const result = { docker: !!docker, settings, installed: false };
    if (!docker) return result;
    const [mail, webmail] = await Promise.all([MailManager.containerState(CONTAINER), MailManager.containerState(WEBMAIL_CONTAINER)]);
    result.installed = !!mail && existsSync(join(MAIL_DIR, 'compose.yaml'));
    result.container = mail;
    result.webmail = webmail;
    return result;
  }

  static async exec(args, { timeout = 60000 } = {}) {
    const r = await run('docker', ['exec', CONTAINER, ...args], { timeout });
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    if (r.code !== 0 || /\bERROR\b/.test(out)) {
      const msg = out.split('\n').filter(l => /ERROR/.test(l)).map(l => l.replace(/^.*ERROR\s+[\w-]+:\s*/, '')).join(' ') || out.trim();
      throw httpError(400, msg || 'Mail server command failed');
    }
    return out;
  }

  static async assertRunning() {
    const state = await MailManager.containerState(CONTAINER);
    if (!state || state.status !== 'running') throw httpError(409, 'The mail server container is not running');
  }

  // ── Accounts & aliases ─────────────────────────────────────

  static async accounts() {
    const quotas = new Map(readLines(join(CONFIG_DIR, 'dovecot-quotas.cf')).map(l => l.split(':')));
    const usage = new Map();
    try {
      const out = await MailManager.exec(['doveadm', '-f', 'tab', 'quota', 'get', '-A'], { timeout: 20000 });
      for (const line of out.split('\n')) {
        const [user, , type, value, limit] = line.split('\t');
        if (type === 'STORAGE') usage.set(user, { usedKb: parseInt(value) || 0, limitKb: parseInt(limit) || null });
      }
    } catch { }
    const aliases = MailManager.aliases();

    return readLines(join(CONFIG_DIR, 'postfix-accounts.cf')).map(line => {
      const email = line.split('|')[0];
      const u = usage.get(email);
      return {
        email,
        domain: email.split('@')[1],
        quota: quotas.get(email) || null,
        usedBytes: u ? u.usedKb * 1024 : null,
        limitBytes: u?.limitKb ? u.limitKb * 1024 : null,
        aliases: aliases.filter(a => a.targets.includes(email)).map(a => a.alias)
      };
    }).sort((a, b) => a.email.localeCompare(b.email));
  }

  static aliases() {
    return readLines(join(CONFIG_DIR, 'postfix-virtual.cf')).map(line => {
      const [alias, ...rest] = line.split(/\s+/);
      return { alias, targets: rest.join(' ').split(',').map(t => t.trim()).filter(Boolean) };
    });
  }

  static async addAccount(email, password) {
    email = assertEmail(email);
    assertPassword(password);
    await MailManager.assertRunning();
    await MailManager.exec(['setup', 'email', 'add', email, password]);
    // New domain? Give it a DKIM key so its mail is signed from the start
    const domain = email.split('@')[1];
    if (!MailManager.dkimRecord(domain)) {
      try { await MailManager.generateDkim(domain); } catch { }
    }
    return { success: true };
  }

  static async setPassword(email, password) {
    email = assertEmail(email);
    assertPassword(password);
    await MailManager.exec(['setup', 'email', 'update', email, password]);
    return { success: true };
  }

  static async deleteAccount(email) {
    email = assertEmail(email);
    await MailManager.exec(['setup', 'email', 'del', '-y', email]);
    return { success: true };
  }

  static async setQuota(email, quota) {
    email = assertEmail(email);
    if (!quota || quota === '0') {
      await MailManager.exec(['setup', 'quota', 'del', email]);
    } else {
      if (!/^\d+[KMGT]?$/i.test(quota)) throw httpError(400, 'Quota must look like 500M or 2G (0 for unlimited)');
      await MailManager.exec(['setup', 'quota', 'set', email, quota.toUpperCase()]);
    }
    return { success: true };
  }

  static async addAlias(alias, target) {
    alias = assertEmail(alias, 'alias');
    target = assertEmail(target, 'destination');
    await MailManager.exec(['setup', 'alias', 'add', alias, target]);
    return { success: true };
  }

  static async deleteAlias(alias, target) {
    alias = assertEmail(alias, 'alias');
    target = assertEmail(target, 'destination');
    await MailManager.exec(['setup', 'alias', 'del', alias, target]);
    return { success: true };
  }

  static domains() {
    const set = new Set();
    const s = MailManager.settings();
    if (s?.domain) set.add(s.domain);
    readLines(join(CONFIG_DIR, 'postfix-accounts.cf')).forEach(l => set.add(l.split('|')[0].split('@')[1]));
    MailManager.aliases().forEach(a => set.add(a.alias.split('@')[1]));
    return [...set].filter(Boolean).sort();
  }

  // ── DKIM ───────────────────────────────────────────────────

  static dkimRecord(domain) {
    const file = join(CONFIG_DIR, 'rspamd', 'dkim', `rsa-2048-mail-${domain}.public.dns.txt`);
    return existsSync(file) ? readFileSync(file, 'utf-8').trim() : null;
  }

  static async generateDkim(domain) {
    domain = assertDomain(domain);
    await MailManager.assertRunning();
    if (!MailManager.dkimRecord(domain)) {
      await MailManager.exec(['setup', 'config', 'dkim', 'keysize', '2048', 'domain', domain]);
    }
    await MailManager.writeDkimSigningConfig();
    return { success: true, record: MailManager.dkimRecord(domain) };
  }

  /**
   * docker-mailserver only writes dkim_signing.conf for the first domain.
   * Rebuild it so every domain with a key is signed, then reload rspamd.
   */
  static async writeDkimSigningConfig() {
    const dkimDir = join(CONFIG_DIR, 'rspamd', 'dkim');
    if (!existsSync(dkimDir)) return;
    const domains = readdirSync(dkimDir)
      .map(f => f.match(/^rsa-2048-mail-(.+)\.private\.txt$/))
      .filter(Boolean)
      .map(m => m[1]);
    const blocks = domains.map(d => `    ${d} {\n        path = "/tmp/docker-mailserver/rspamd/dkim/rsa-2048-mail-${d}.private.txt";\n        selector = "mail";\n    }`).join('\n');
    const conf = `# Managed by VPS Panel — regenerated whenever a DKIM key is added
# documentation: https://rspamd.com/doc/modules/dkim_signing.html

enabled = true;

sign_authenticated = true;
sign_local = false;
try_fallback = false;

use_domain = "header";
use_redis = false;
use_esld = true;
allow_username_mismatch = true;

check_pubkey = true;

domain {
${blocks}
}
`;
    const overrideDir = join(CONFIG_DIR, 'rspamd', 'override.d');
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(join(overrideDir, 'dkim_signing.conf'), conf);
    await run('docker', ['exec', CONTAINER, 'supervisorctl', 'restart', 'rspamd'], { timeout: 60000 });
  }

  // ── Server checks & DNS ────────────────────────────────────

  static resolver() {
    const r = new Resolver({ timeout: 4000, tries: 2 });
    r.setServers(['1.1.1.1', '8.8.8.8']);
    return r;
  }

  static async publicIp() {
    for (const url of ['https://api.ipify.org', 'https://ifconfig.me/ip']) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const ip = (await res.text()).trim();
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
      } catch { }
    }
    const { stdout } = await run('hostname', ['-I'], { timeout: 5000 });
    return stdout.trim().split(/\s+/)[0] || null;
  }

  /**
   * Can this server open outbound connections on port 25? Many VPS providers block it.
   */
  static checkPort25() {
    return new Promise((resolve) => {
      const socket = net.connect({ host: 'gmail-smtp-in.l.google.com', port: 25 });
      let banner = '';
      const finish = (open, detail) => {
        socket.destroy();
        resolve({ open, detail });
      };
      socket.setTimeout(8000, () => finish(false, 'Timed out — outbound port 25 is probably blocked by your provider'));
      socket.on('data', d => {
        banner += d;
        if (banner.startsWith('220')) finish(true, 'Connected to Gmail on port 25');
      });
      socket.on('error', err => finish(false, err.message));
    });
  }

  static async checks() {
    const settings = MailManager.settings();
    const ip = await MailManager.publicIp();
    const resolver = MailManager.resolver();
    const [port25, ptr, port25Local] = await Promise.all([
      MailManager.checkPort25(),
      ip ? resolver.reverse(ip).catch(() => []) : [],
      run('sh', ['-c', "ss -ltnp '( sport = :25 )' 2>/dev/null | tail -n +2"], { timeout: 5000 })
    ]);
    const mem = (() => {
      try { return parseInt(readFileSync('/proc/meminfo', 'utf-8').match(/MemTotal:\s+(\d+)/)[1]) * 1024; } catch { return null; }
    })();
    return {
      ip,
      port25,
      ptr: { values: ptr, ok: !!settings?.hostname && ptr.includes(settings.hostname) },
      port25InUse: port25Local.stdout.trim() && !port25Local.stdout.includes('docker') ? port25Local.stdout.trim() : null,
      memory: mem,
      docker: !!(await which('docker'))
    };
  }

  static async dnsReport(domain) {
    domain = assertDomain(domain);
    const settings = MailManager.settings();
    const hostname = settings?.hostname || `mail.${domain}`;
    const ip = await MailManager.publicIp();
    const r = MailManager.resolver();
    const txt = async (name) => (await r.resolveTxt(name).catch(() => [])).map(parts => parts.join(''));

    const [mx, a, spfTxt, dkimTxt, dmarcTxt, ptr] = await Promise.all([
      r.resolveMx(domain).catch(() => []),
      r.resolve4(hostname).catch(() => []),
      txt(domain),
      txt(`mail._domainkey.${domain}`),
      txt(`_dmarc.${domain}`),
      ip ? r.reverse(ip).catch(() => []) : []
    ]);

    const dkim = MailManager.dkimRecord(domain);
    const dkimKey = dkim ? (dkim.match(/p=([A-Za-z0-9+/=]+)/) || [])[1] : null;
    const liveSpf = spfTxt.find(t => t.startsWith('v=spf1')) || null;
    const liveDkim = dkimTxt.find(t => t.includes('v=DKIM1')) || null;
    const liveDmarc = dmarcTxt.find(t => t.startsWith('v=DMARC1')) || null;

    return {
      domain,
      hostname,
      ip,
      records: [
        { type: 'A', name: hostname, value: ip || '<server IP>', live: a.join(', ') || null, ok: !!ip && a.includes(ip) },
        { type: 'MX', name: domain, value: `10 ${hostname}`, live: mx.map(m => `${m.priority} ${m.exchange}`).join(', ') || null, ok: mx.some(m => m.exchange.toLowerCase() === hostname) },
        { type: 'TXT', name: domain, value: 'v=spf1 mx ~all', live: liveSpf, ok: !!liveSpf && (/\bmx\b/.test(liveSpf) || (ip && liveSpf.includes(ip)) || liveSpf.includes(hostname)), note: 'SPF — only one v=spf1 record allowed per domain' },
        { type: 'TXT', name: `mail._domainkey.${domain}`, value: dkim || 'Generate the DKIM key first', live: liveDkim, ok: !!liveDkim && !!dkimKey && liveDkim.replace(/\s/g, '').includes(dkimKey), note: 'DKIM signature key' },
        { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${domain}`, live: liveDmarc, ok: !!liveDmarc, note: 'DMARC policy' },
        { type: 'PTR', name: ip || '<server IP>', value: hostname, live: ptr.join(', ') || null, ok: ptr.includes(hostname), note: 'Reverse DNS — set this in your VPS provider\'s control panel, not at your DNS host' }
      ],
      dkimGenerated: !!dkim
    };
  }

  // ── Install ────────────────────────────────────────────────

  /**
   * Write compose.yaml + mailserver.env for the given settings.
   */
  static writeStack({ hostname, domain, webmail, timezone }) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const tz = /^[A-Za-z_+\-/0-9]+$/.test(timezone || '') ? timezone : 'UTC';

    const env = `# Managed by VPS Panel — docker-mailserver settings
# Reference: https://docker-mailserver.github.io/docker-mailserver/latest/config/environment/
OVERRIDE_HOSTNAME=${hostname}
POSTMASTER_ADDRESS=postmaster@${domain}
TZ=${tz}
LOG_LEVEL=info
ONE_DIR=1
PERMIT_DOCKER=none
SPOOF_PROTECTION=1

SSL_TYPE=letsencrypt

# Spam filtering & signing: Rspamd replaces OpenDKIM/OpenDMARC/SPF policy/Amavis
ENABLE_RSPAMD=1
ENABLE_RSPAMD_REDIS=1
RSPAMD_LEARN=1
RSPAMD_GREYLISTING=0
ENABLE_OPENDKIM=0
ENABLE_OPENDMARC=0
ENABLE_POLICYD_SPF=0
ENABLE_AMAVIS=0
ENABLE_SPAMASSASSIN=0
MOVE_SPAM_TO_JUNK=1

# ClamAV needs ~1.5 GB RAM; enable on larger servers
ENABLE_CLAMAV=0
ENABLE_FAIL2BAN=1
ENABLE_POP3=0
ENABLE_MANAGESIEVE=1
POSTFIX_MESSAGE_SIZE_LIMIT=52428800
`;

    const webmailService = webmail ? `
  roundcube:
    image: roundcube/roundcubemail:latest
    container_name: ${WEBMAIL_CONTAINER}
    restart: always
    depends_on:
      - mailserver
    ports:
      - "127.0.0.1:${WEBMAIL_PORT}:80"
    volumes:
      - ./docker-data/roundcube/db:/var/roundcube/db
      - ./docker-data/roundcube/config:/var/roundcube/config
    extra_hosts:
      - "${hostname}:${MAIL_NET.mailserver}"
    environment:
      ROUNDCUBEMAIL_DB_TYPE: sqlite
      ROUNDCUBEMAIL_DEFAULT_HOST: ssl://${hostname}
      ROUNDCUBEMAIL_DEFAULT_PORT: "993"
      ROUNDCUBEMAIL_SMTP_SERVER: tls://${hostname}
      ROUNDCUBEMAIL_SMTP_PORT: "587"
      ROUNDCUBEMAIL_SKIN: elastic
      ROUNDCUBEMAIL_UPLOAD_MAX_FILESIZE: 25M
    networks:
      - mail
` : '';

    const compose = `# Managed by VPS Panel — email hosting stack
services:
  mailserver:
    image: ghcr.io/docker-mailserver/docker-mailserver:latest
    container_name: ${CONTAINER}
    hostname: ${hostname}
    env_file: mailserver.env
    ports:
      - "25:25"
      - "465:465"
      - "587:587"
      - "993:993"
    volumes:
      - ./docker-data/dms/mail-data/:/var/mail/
      - ./docker-data/dms/mail-state/:/var/mail-state/
      - ./docker-data/dms/mail-logs/:/var/log/mail/
      - ./docker-data/dms/config/:/tmp/docker-mailserver/
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - /etc/localtime:/etc/localtime:ro
    restart: always
    stop_grace_period: 1m
    cap_add:
      - NET_ADMIN
    healthcheck:
      test: "ss --listening --tcp | grep -P 'LISTEN.+:smtp' || exit 1"
      timeout: 3s
      retries: 0
    networks:
      mail:
        ipv4_address: ${MAIL_NET.mailserver}
${webmailService}
networks:
  mail:
    ipam:
      config:
        - subnet: ${MAIL_NET.subnet}
`;
    writeFileSync(join(MAIL_DIR, 'mailserver.env'), env);
    writeFileSync(join(MAIL_DIR, 'compose.yaml'), compose);
    chmodSync(join(MAIL_DIR, 'mailserver.env'), 0o600);
  }

  static installScript({ hostname, domain, email, firstMailbox }) {
    return `
cd '${MAIL_DIR}'

echo "==> 1/5 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
svc_enable docker
docker compose version

echo "==> 2/5 Checking port 25"
if [ -z "$(docker ps -q -f name=^${CONTAINER}$)" ] && ss -ltn '( sport = :25 )' | grep -q LISTEN; then
  echo "Another mail server already listens on port 25:"
  ss -ltnp '( sport = :25 )' || true
  echo "Remove it first (for example: apt purge postfix exim4) and run the setup again."
  exit 1
fi

echo "==> 3/5 TLS certificate for ${hostname}"
if [ ! -f '/etc/letsencrypt/live/${hostname}/fullchain.pem' ]; then
  if ! command -v certbot >/dev/null 2>&1; then
    apt_get update
    apt_get install certbot python3-certbot-nginx
  fi
  ufw_allow 'Nginx Full'
  certbot --nginx --non-interactive --agree-tos -m '${email}' --redirect --cert-name '${hostname}' -d '${hostname}'
fi
test -f '/etc/letsencrypt/live/${hostname}/fullchain.pem'

echo "==> 4/5 Starting mail containers"
docker compose pull
docker compose up -d
for i in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Running}}' ${CONTAINER} 2>/dev/null)" = "true" ] && break
  sleep 2
done
sleep 5

echo "==> 5/5 First mailbox and DKIM key"
if ! grep -q "^${firstMailbox}|" '${CONFIG_DIR}/postfix-accounts.cf' 2>/dev/null; then
  docker exec ${CONTAINER} setup email add '${firstMailbox}' "$FIRST_MAILBOX_PASSWORD"
fi
if [ ! -f '${CONFIG_DIR}/rspamd/dkim/rsa-2048-mail-${domain}.private.txt' ]; then
  docker exec ${CONTAINER} setup config dkim keysize 2048 domain '${domain}'
fi
ufw_allow 25/tcp 465/tcp 587/tcp 993/tcp

echo ""
echo "Mail server is running. Next: add the DNS records shown on the Email page."
`;
  }

  static webmailPort() {
    return WEBMAIL_PORT;
  }

  static async control(action) {
    if (!['start', 'stop', 'restart'].includes(action)) throw httpError(400, 'Invalid action');
    const r = await run('docker', ['compose', action], { cwd: MAIL_DIR, timeout: 180000 });
    if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim());
    return { success: true };
  }

  static async logs() {
    const r = await run('docker', ['logs', '--tail', '300', CONTAINER], { timeout: 20000 });
    return (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean).slice(-300);
  }
}
