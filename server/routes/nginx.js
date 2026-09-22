import { Router } from 'express';
import { existsSync } from 'fs';
import { NginxManager, normalizeDomains, assertSiteName } from '../services/nginx-manager.js';
import { JobRunner } from '../services/job-runner.js';
import { getConfig, httpError } from '../lib/config.js';
import { run } from '../lib/shell.js';

const router = Router();
const EMAIL = /^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/;

// GET /api/v1/nginx/status — Installation, service and config-test status
router.get('/status', async (req, res) => {
  res.json(await NginxManager.status());
});

// POST /api/v1/nginx/install — Install nginx (background job)
router.post('/install', (req, res) => {
  const job = JobRunner.start('Install nginx', `
apt_get update
apt_get install nginx
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
svc_enable nginx
ufw_allow 'Nginx Full'
nginx -v
echo "nginx installed and running."
`);
  res.json({ jobId: job.id });
});

// POST /api/v1/nginx/control — { action: start|stop|restart|reload }
router.post('/control', async (req, res) => {
  res.json(await NginxManager.control(req.body.action));
});

// POST /api/v1/nginx/test — Run nginx -t
router.post('/test', async (req, res) => {
  res.json(await NginxManager.test());
});

// GET /api/v1/nginx/sites — All sites with parsed details
router.get('/sites', (req, res) => {
  res.json({ sites: NginxManager.listSites() });
});

// POST /api/v1/nginx/sites — Create a site from a template
router.post('/sites', async (req, res) => {
  res.status(201).json(await NginxManager.createSite(req.body));
});

// GET /api/v1/nginx/sites/:name — Raw configuration
router.get('/sites/:name', (req, res) => {
  const content = NginxManager.readSite(req.params.name);
  res.json({ name: req.params.name, content, enabled: NginxManager.isEnabled(req.params.name), path: NginxManager.sitePath(req.params.name) });
});

// PUT /api/v1/nginx/sites/:name — Save raw configuration (tested, rolled back on failure)
router.put('/sites/:name', async (req, res) => {
  if (typeof req.body.content !== 'string') throw httpError(400, 'content is required');
  res.json(await NginxManager.writeSite(req.params.name, req.body.content));
});

// POST /api/v1/nginx/sites/:name/enable — { enabled: true|false }
router.post('/sites/:name/enable', async (req, res) => {
  res.json(await NginxManager.setEnabled(req.params.name, req.body.enabled !== false));
});

// POST /api/v1/nginx/sites/:name/php — { version } switch PHP-FPM version
router.post('/sites/:name/php', async (req, res) => {
  res.json(await NginxManager.setPhpVersion(req.params.name, req.body.version));
});

// DELETE /api/v1/nginx/sites/:name — Remove site config (document root is kept)
router.delete('/sites/:name', async (req, res) => {
  res.json(await NginxManager.deleteSite(req.params.name));
});

// GET /api/v1/nginx/sites/:name/logs?type=access|error&lines=200
router.get('/sites/:name/logs', async (req, res) => {
  const file = NginxManager.logPath(req.params.name, req.query.type);
  if (!existsSync(file)) return res.json({ path: file, lines: [] });
  const lines = String(Math.min(parseInt(req.query.lines) || 200, 2000));
  const { stdout } = await run('tail', ['-n', lines, file]);
  res.json({ path: file, lines: stdout.split('\n').filter(Boolean) });
});

// POST /api/v1/nginx/sites/:name/ssl — Issue a Let's Encrypt certificate with certbot
router.post('/sites/:name/ssl', (req, res) => {
  assertSiteName(req.params.name);
  const info = NginxManager.parseConfig(NginxManager.readSite(req.params.name));
  const domains = normalizeDomains(req.body.domains || info.serverNames.filter(d => d !== '_' && !d.startsWith('*.')));
  const config = getConfig();
  const email = (req.body.email || config.notifications?.email?.to || process.env.ADMIN_EMAIL || '').trim();
  if (email && !EMAIL.test(email)) throw httpError(400, 'Invalid email address');
  const emailArgs = email ? `-m '${email}'` : '--register-unsafely-without-email';
  const redirect = req.body.redirect === false ? '--no-redirect' : '--redirect';

  const job = JobRunner.start(`SSL certificate for ${domains.join(', ')}`, `
if ! command -v certbot >/dev/null 2>&1; then
  echo "Installing certbot..."
  apt_get update
  apt_get install certbot python3-certbot-nginx
fi
ufw_allow 'Nginx Full'
echo "Requesting certificate for: ${domains.join(' ')}"
echo "(Each domain's DNS A record must already point to this server.)"
certbot --nginx --non-interactive --agree-tos ${emailArgs} ${redirect} --cert-name '${req.params.name}' ${domains.map(d => `-d '${d}'`).join(' ')}
echo ""
echo "HTTPS is active. Certificates renew automatically (certbot timer)."
`);
  res.json({ jobId: job.id });
});

// GET /api/v1/nginx/certificates — Let's Encrypt certificates on this server
router.get('/certificates', (req, res) => {
  res.json({ certificates: NginxManager.listCertificates() });
});

// POST /api/v1/nginx/certificates/renew — certbot renew
router.post('/certificates/renew', (req, res) => {
  const job = JobRunner.start('Renew SSL certificates', 'certbot renew --no-random-sleep-on-renew && svc_reload nginx');
  res.json({ jobId: job.id });
});

// DELETE /api/v1/nginx/certificates/:name — certbot delete
router.delete('/certificates/:name', async (req, res) => {
  assertSiteName(req.params.name);
  const result = await run('certbot', ['delete', '--non-interactive', '--cert-name', req.params.name], { timeout: 60000 });
  if (result.code !== 0) throw httpError(500, (result.stderr || result.stdout).trim());
  res.json({ success: true });
});

export default router;
