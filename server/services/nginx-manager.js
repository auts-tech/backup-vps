import { existsSync, readFileSync, writeFileSync, readdirSync, lstatSync, symlinkSync, unlinkSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join } from 'path';
import { X509Certificate } from 'crypto';
import { run, which, serviceCtl, serviceActive } from '../lib/shell.js';
import { httpError } from '../lib/config.js';

export const NGINX_DIR = '/etc/nginx';
export const SITES_AVAILABLE = join(NGINX_DIR, 'sites-available');
export const SITES_ENABLED = join(NGINX_DIR, 'sites-enabled');
const UPGRADE_MAP_FILE = join(NGINX_DIR, 'conf.d', 'vps-panel-websocket.conf');
const LE_LIVE = '/etc/letsencrypt/live';

const SITE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const DOMAIN = /^(\*\.)?([A-Za-z0-9-_]{1,63}\.)*[A-Za-z0-9-]{1,63}$/;

export const SITE_TYPES = ['static', 'php', 'laravel', 'wordpress', 'proxy'];

export function assertSiteName(name) {
  if (!SITE_NAME.test(name || '') || name.includes('..')) throw httpError(400, `Invalid site name "${name}"`);
}

export function normalizeDomains(input) {
  const list = (Array.isArray(input) ? input : String(input || '').split(/[\s,]+/))
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) throw httpError(400, 'At least one domain is required');
  for (const d of list) {
    if (d !== '_' && !DOMAIN.test(d)) throw httpError(400, `Invalid domain "${d}"`);
  }
  return [...new Set(list)];
}

export function phpSocket(version) {
  return `/run/php/php${version}-fpm.sock`;
}

/**
 * Nginx manager — Debian/Ubuntu layout (sites-available + sites-enabled symlinks).
 */
export class NginxManager {

  static async status() {
    const bin = await which('nginx');
    if (!bin) return { installed: false };
    const [{ stderr: versionOut }, running, test] = await Promise.all([
      run('nginx', ['-v'], { timeout: 5000 }),
      serviceActive('nginx'),
      NginxManager.test()
    ]);
    return {
      installed: true,
      version: (versionOut.match(/nginx\/([\d.]+)/) || [])[1] || versionOut.trim(),
      running,
      configOk: test.ok,
      configOutput: test.output,
      certbot: !!(await which('certbot'))
    };
  }

  static async test() {
    const { code, stdout, stderr } = await run('nginx', ['-t'], { timeout: 15000 });
    return { ok: code === 0, output: (stderr || stdout).trim() };
  }

  static async control(action) {
    if (!['start', 'stop', 'restart', 'reload'].includes(action)) throw httpError(400, 'Invalid action');
    if (action === 'reload' || action === 'restart' || action === 'start') {
      const test = await NginxManager.test();
      if (!test.ok) throw httpError(400, `Configuration test failed — not applying:\n${test.output}`);
    }
    // reload on a stopped nginx fails; start it instead
    if (action === 'reload' && !(await serviceActive('nginx'))) action = 'start';
    const result = await serviceCtl(action, 'nginx');
    if (result.code !== 0) throw httpError(500, (result.stderr || result.stdout).trim() || `nginx ${action} failed`);
    return { success: true, action };
  }

  // ── Sites ──────────────────────────────────────────────────

  static sitePath(name) {
    assertSiteName(name);
    return join(SITES_AVAILABLE, name);
  }

  static isEnabled(name) {
    const link = join(SITES_ENABLED, name);
    try {
      lstatSync(link);
      return true;
    } catch {
      return false;
    }
  }

  static parseConfig(raw) {
    // Ignore commented-out directives (e.g. the stock default site's "#fastcgi_pass ...")
    const text = raw.replace(/#.*$/gm, '');
    const serverNames = new Set();
    for (const m of text.matchAll(/^\s*server_name\s+([^;]+);/gm)) {
      m[1].split(/\s+/).filter(Boolean).forEach(n => serverNames.add(n));
    }
    const listens = [...text.matchAll(/^\s*listen\s+([^;]+);/gm)].map(m => m[1].trim());
    const root = (text.match(/^\s*root\s+([^;]+);/m) || [])[1]?.trim() || null;
    const php = (text.match(/fastcgi_pass\s+unix:\/(?:var\/)?run\/php\/php([\d.]+)-fpm\.sock/) || [])[1] || null;
    const proxy = (text.match(/^\s*proxy_pass\s+([^;]+);/m) || [])[1]?.trim() || null;
    const ssl = /^\s*ssl_certificate\s+/m.test(text);
    const certPath = (text.match(/^\s*ssl_certificate\s+([^;]+);/m) || [])[1]?.trim() || null;
    let type = 'static';
    if (proxy) type = 'proxy';
    else if (php) type = 'php';
    // Sites created by the panel record their template in the header comment
    const managed = (raw.match(/^# Managed by VPS Panel — (\w+) site/m) || [])[1];
    if (managed && SITE_TYPES.includes(managed)) type = managed;
    return { serverNames: [...serverNames], listens, root, phpVersion: php, proxyPass: proxy, ssl, certPath, type };
  }

  static listSites() {
    if (!existsSync(SITES_AVAILABLE)) return [];
    return readdirSync(SITES_AVAILABLE)
      .filter(name => SITE_NAME.test(name) && !name.endsWith('.bak') && !name.endsWith('~'))
      .filter(name => {
        try { return statSync(join(SITES_AVAILABLE, name)).isFile(); } catch { return false; }
      })
      .map(name => {
        const file = join(SITES_AVAILABLE, name);
        let text = '';
        try { text = readFileSync(file, 'utf-8'); } catch {}
        const info = NginxManager.parseConfig(text);
        return {
          name,
          enabled: NginxManager.isEnabled(name),
          ...info,
          sslExpires: info.certPath ? NginxManager.certExpiry(info.certPath) : null,
          modified: statSync(file).mtime
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  static readSite(name) {
    const file = NginxManager.sitePath(name);
    if (!existsSync(file)) throw httpError(404, `Site "${name}" not found`);
    return readFileSync(file, 'utf-8');
  }

  /**
   * Write a site file, then run `nginx -t`. If the test fails the previous
   * version is restored and the error is returned — nginx is never left broken.
   */
  static async writeSite(name, content, { reload = true } = {}) {
    const file = NginxManager.sitePath(name);
    const existed = existsSync(file);
    const backup = `${file}.bak`;
    if (existed) copyFileSync(file, backup);

    writeFileSync(file, content.endsWith('\n') ? content : content + '\n');
    const test = await NginxManager.test();
    if (!test.ok) {
      if (existed) copyFileSync(backup, file);
      else {
        unlinkSync(file);
        NginxManager._removeLink(name);
      }
      throw httpError(400, `nginx rejected the configuration, changes were rolled back:\n${test.output}`);
    }
    if (reload) await NginxManager.reloadIfRunning();
    return { success: true, test: test.output };
  }

  static async reloadIfRunning() {
    if (await serviceActive('nginx')) {
      const r = await serviceCtl('reload', 'nginx');
      if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim() || 'nginx reload failed');
    }
  }

  static _removeLink(name) {
    try { unlinkSync(join(SITES_ENABLED, name)); } catch {}
  }

  static async setEnabled(name, enabled) {
    const file = NginxManager.sitePath(name);
    if (!existsSync(file)) throw httpError(404, `Site "${name}" not found`);
    if (enabled) {
      if (!NginxManager.isEnabled(name)) symlinkSync(file, join(SITES_ENABLED, name));
      const test = await NginxManager.test();
      if (!test.ok) {
        NginxManager._removeLink(name);
        throw httpError(400, `Enabling this site breaks the nginx configuration, so it was left disabled:\n${test.output}`);
      }
    } else {
      NginxManager._removeLink(name);
    }
    await NginxManager.reloadIfRunning();
    return { success: true };
  }

  static async deleteSite(name) {
    const file = NginxManager.sitePath(name);
    if (!existsSync(file)) throw httpError(404, `Site "${name}" not found`);
    NginxManager._removeLink(name);
    unlinkSync(file);
    try { unlinkSync(`${file}.bak`); } catch {}
    await NginxManager.reloadIfRunning();
    return { success: true };
  }

  /**
   * Create a site from a template, its document root, and enable it.
   */
  static async createSite(opts) {
    const domains = normalizeDomains(opts.domains);
    const name = opts.name || domains[0].replace(/^\*\./, 'wildcard.');
    assertSiteName(name);
    const type = opts.type || 'static';
    if (!SITE_TYPES.includes(type)) throw httpError(400, `Unknown site type "${type}"`);
    if (existsSync(NginxManager.sitePath(name))) throw httpError(409, `A site named "${name}" already exists`);
    if (!existsSync(SITES_AVAILABLE)) throw httpError(400, 'nginx is not installed (sites-available missing)');

    const needsPhp = ['php', 'laravel', 'wordpress'].includes(type);
    if (needsPhp) {
      if (!/^\d+\.\d+$/.test(opts.phpVersion || '')) throw httpError(400, 'Choose a PHP version for this site');
      if (!existsSync(`/etc/php/${opts.phpVersion}/fpm`)) throw httpError(400, `PHP ${opts.phpVersion} FPM is not installed — install it on the PHP page first`);
    }

    let root = null;
    if (type !== 'proxy') {
      // Laravel: root is the project folder, nginx serves its public/ subfolder
      root = (opts.root || (type === 'laravel' ? `/var/www/${name}` : `/var/www/${name}/public_html`)).trim().replace(/\/+$/, '');
      if (!root.startsWith('/') || root.includes('..') || /[;{}\s'"]/.test(root)) throw httpError(400, 'Document root must be an absolute path without spaces or quotes');
      await NginxManager._createDocRoot(type === 'laravel' ? join(root, 'public') : root, type, domains[0]);
    }

    let proxyTarget = null;
    if (type === 'proxy') {
      proxyTarget = String(opts.proxyTarget || '').trim();
      if (/^\d+$/.test(proxyTarget)) proxyTarget = `http://127.0.0.1:${proxyTarget}`;
      if (!/^https?:\/\/[A-Za-z0-9.\-:[\]]+(\/[^\s;{}]*)?$/.test(proxyTarget)) throw httpError(400, 'Proxy target must be a port (3000) or URL (http://127.0.0.1:3000)');
      NginxManager._ensureUpgradeMap();
    }

    const content = NginxManager.template({
      type, domains, root, name, proxyTarget,
      phpVersion: opts.phpVersion,
      maxBodySize: /^\d+[kKmMgG]?$/.test(opts.maxBodySize || '') ? opts.maxBodySize : '64M'
    });

    // Write, link, test; roll back everything if nginx rejects it
    writeFileSync(NginxManager.sitePath(name), content);
    if (!NginxManager.isEnabled(name)) symlinkSync(NginxManager.sitePath(name), join(SITES_ENABLED, name));
    const test = await NginxManager.test();
    if (!test.ok) {
      NginxManager._removeLink(name);
      unlinkSync(NginxManager.sitePath(name));
      throw httpError(400, `nginx rejected the new site, nothing was changed:\n${test.output}`);
    }
    await NginxManager.reloadIfRunning();
    return { success: true, name, root, config: content };
  }

  static async _createDocRoot(dir, type, domain) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (readdirSync(dir).length === 0) {
      if (type === 'static') {
        writeFileSync(join(dir, 'index.html'), `<!doctype html>\n<html><head><meta charset="utf-8"><title>${domain}</title></head>\n<body style="font-family:sans-serif;text-align:center;padding-top:15vh"><h1>${domain}</h1><p>This site is live. Upload your files to <code>${dir}</code>.</p></body></html>\n`);
      } else {
        writeFileSync(join(dir, 'index.php'), `<?php\necho '<h1>' . htmlspecialchars($_SERVER['HTTP_HOST']) . '</h1>';\necho '<p>PHP ' . PHP_VERSION . ' is working. Upload your application to ${dir}.</p>';\n`);
      }
    }
    // Web server user owns the site so PHP apps can write uploads/cache
    await run('chown', ['-R', 'www-data:www-data', type === 'laravel' ? join(dir, '..') : dir]);
  }

  /**
   * Shared `map` for WebSocket upgrades, defined once for all proxy sites.
   */
  static _ensureUpgradeMap() {
    if (existsSync(UPGRADE_MAP_FILE)) return;
    // Don't define it twice if the admin already has one
    const definesMap = /map\s+\$http_upgrade\s+\$connection_upgrade/;
    for (const dir of [NGINX_DIR, join(NGINX_DIR, 'conf.d'), SITES_AVAILABLE]) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        try {
          if (definesMap.test(readFileSync(join(dir, f), 'utf-8'))) return;
        } catch {}
      }
    }
    mkdirSync(join(NGINX_DIR, 'conf.d'), { recursive: true });
    writeFileSync(UPGRADE_MAP_FILE, `# Managed by VPS Panel — WebSocket upgrade support for reverse proxy sites\nmap $http_upgrade $connection_upgrade {\n    default upgrade;\n    ''      close;\n}\n`);
  }

  static template({ type, domains, root, name, phpVersion, proxyTarget, maxBodySize }) {
    const head = [
      `# Managed by VPS Panel — ${type} site`,
      'server {',
      '    listen 80;',
      '    listen [::]:80;',
      `    server_name ${domains.join(' ')};`,
      ''
    ];
    const logs = [
      `    access_log /var/log/nginx/${name}.access.log;`,
      `    error_log /var/log/nginx/${name}.error.log;`,
      '',
      `    client_max_body_size ${maxBodySize};`,
      ''
    ];
    const hidden = [
      '    # Block dotfiles (.env, .git) but allow ACME challenges',
      '    location ~ /\\.(?!well-known) {',
      '        deny all;',
      '    }'
    ];
    const phpBlock = [
      '    location ~ \\.php$ {',
      '        include snippets/fastcgi-php.conf;',
      `        fastcgi_pass unix:${phpSocket(phpVersion)};`,
      '        fastcgi_read_timeout 300;',
      '    }',
      ''
    ];
    const assets = [
      '    location ~* \\.(?:css|js|mjs|jpg|jpeg|gif|png|webp|avif|svg|ico|woff2?|ttf|eot)$ {',
      '        expires 30d;',
      '        access_log off;',
      '        try_files $uri =404;',
      '    }',
      ''
    ];

    let body = [];
    switch (type) {
      case 'static':
        body = [
          `    root ${root};`,
          '    index index.html index.htm;',
          '',
          ...logs,
          '    location / {',
          '        try_files $uri $uri/ =404;',
          '    }',
          '',
          ...assets,
          ...hidden
        ];
        break;
      case 'php':
        body = [
          `    root ${root};`,
          '    index index.php index.html;',
          '',
          ...logs,
          '    location / {',
          '        try_files $uri $uri/ /index.php?$query_string;',
          '    }',
          '',
          ...phpBlock,
          ...assets,
          ...hidden
        ];
        break;
      case 'laravel':
        body = [
          `    root ${join(root, 'public')};`,
          '    index index.php;',
          '',
          ...logs,
          '    add_header X-Frame-Options "SAMEORIGIN";',
          '    add_header X-Content-Type-Options "nosniff";',
          '',
          '    location / {',
          '        try_files $uri $uri/ /index.php?$query_string;',
          '    }',
          '',
          '    location = /favicon.ico { access_log off; log_not_found off; }',
          '    location = /robots.txt  { access_log off; log_not_found off; }',
          '',
          ...phpBlock,
          ...hidden
        ];
        break;
      case 'wordpress':
        body = [
          `    root ${root};`,
          '    index index.php index.html;',
          '',
          ...logs,
          '    location / {',
          '        try_files $uri $uri/ /index.php?$args;',
          '    }',
          '',
          '    # No PHP execution inside uploads',
          '    location ~* /wp-content/uploads/.*\\.php$ {',
          '        deny all;',
          '    }',
          '',
          '    location = /xmlrpc.php {',
          '        deny all;',
          '    }',
          '',
          ...phpBlock,
          ...assets,
          ...hidden
        ];
        break;
      case 'proxy':
        body = [
          ...logs,
          '    location / {',
          `        proxy_pass ${proxyTarget};`,
          '        proxy_http_version 1.1;',
          '        proxy_set_header Upgrade $http_upgrade;',
          '        proxy_set_header Connection $connection_upgrade;',
          '        proxy_set_header Host $host;',
          '        proxy_set_header X-Real-IP $remote_addr;',
          '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
          '        proxy_set_header X-Forwarded-Proto $scheme;',
          '        # Streaming responses (SSE, WebSockets, long polling)',
          '        proxy_buffering off;',
          '        proxy_read_timeout 86400s;',
          '    }'
        ];
        break;
    }
    return [...head, ...body, '}', ''].join('\n');
  }

  /**
   * Point an existing PHP site at a different PHP-FPM version.
   */
  static async setPhpVersion(name, version) {
    if (!/^\d+\.\d+$/.test(version || '')) throw httpError(400, 'Invalid PHP version');
    if (!existsSync(`/etc/php/${version}/fpm`)) throw httpError(400, `PHP ${version} FPM is not installed`);
    const text = NginxManager.readSite(name);
    const re = /^(\s*fastcgi_pass\s+unix:)\/(?:var\/)?run\/php\/php[\d.]+-fpm\.sock/gm;
    if (!re.test(text)) throw httpError(400, 'This site does not use PHP-FPM (no fastcgi_pass found)');
    const updated = text.replace(re, `$1${phpSocket(version)}`);
    return NginxManager.writeSite(name, updated);
  }

  // ── SSL certificates ───────────────────────────────────────

  static certExpiry(certPath) {
    try {
      const cert = new X509Certificate(readFileSync(certPath));
      return new Date(cert.validTo).toISOString();
    } catch {
      return null;
    }
  }

  static listCertificates() {
    if (!existsSync(LE_LIVE)) return [];
    const out = [];
    for (const name of readdirSync(LE_LIVE)) {
      const certFile = join(LE_LIVE, name, 'cert.pem');
      if (!existsSync(certFile)) continue;
      try {
        const cert = new X509Certificate(readFileSync(certFile));
        const expires = new Date(cert.validTo);
        out.push({
          name,
          domains: (cert.subjectAltName || '').split(',').map(s => s.trim().replace(/^DNS:/, '')).filter(Boolean),
          expires: expires.toISOString(),
          daysLeft: Math.floor((expires - Date.now()) / 86400000),
          issuer: (cert.issuer.match(/O=([^\n]+)/) || [])[1] || cert.issuer
        });
      } catch {}
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft);
  }

  static logPath(name, type) {
    assertSiteName(name);
    return `/var/log/nginx/${name}.${type === 'access' ? 'access' : 'error'}.log`;
  }
}
