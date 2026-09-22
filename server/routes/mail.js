import { Router } from 'express';
import { existsSync } from 'fs';
import { MailManager, MAIL_DIR, assertEmail, assertDomain } from '../services/mail-manager.js';
import { NginxManager } from '../services/nginx-manager.js';
import { JobRunner } from '../services/job-runner.js';
import { httpError } from '../lib/config.js';
import { which } from '../lib/shell.js';

const router = Router();

// GET /api/v1/mail/status — Stack installed/running + settings
router.get('/status', async (req, res) => {
  res.json({ ...(await MailManager.status()), domains: MailManager.domains() });
});

// GET /api/v1/mail/checks — Pre-flight checks (port 25, PTR, RAM, conflicts)
router.get('/checks', async (req, res) => {
  res.json(await MailManager.checks());
});

// POST /api/v1/mail/install — { hostname, domain, email, firstMailbox, password, webmail }
router.post('/install', async (req, res) => {
  const hostname = assertDomain(req.body.hostname);
  const domain = assertDomain(req.body.domain);
  const email = assertEmail(req.body.email, 'contact email');
  const firstMailbox = assertEmail(req.body.firstMailbox || `postmaster@${domain}`, 'first mailbox');
  const password = String(req.body.password || '');
  if (password.length < 8) throw httpError(400, 'Mailbox password must be at least 8 characters');
  if (!hostname.endsWith(`.${domain}`) && hostname !== domain) throw httpError(400, `The mail hostname should be a subdomain of ${domain} (e.g. mail.${domain})`);
  if (!(await which('nginx'))) throw httpError(400, 'Install nginx first (Websites page) — it is used to obtain the TLS certificate and serve webmail');
  const webmail = req.body.webmail !== false;

  // nginx site for the mail hostname: webmail proxy, or a placeholder for the certificate challenge
  if (!existsSync(NginxManager.sitePath(hostname))) {
    await NginxManager.createSite(webmail
      ? { name: hostname, domains: [hostname], type: 'proxy', proxyTarget: `http://127.0.0.1:${MailManager.webmailPort()}`, maxBodySize: '30M' }
      : { name: hostname, domains: [hostname], type: 'static' });
  }

  MailManager.writeStack({ hostname, domain, webmail, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  MailManager.saveSettings({ hostname, domain, email, webmail, dir: MAIL_DIR, installedAt: new Date().toISOString() });

  const job = JobRunner.start(`Install email server (${hostname})`, MailManager.installScript({ hostname, domain, email, firstMailbox }), {
    env: { FIRST_MAILBOX_PASSWORD: password },
    onExit: (j) => j.status === 'completed' && MailManager.writeDkimSigningConfig()
  });
  res.json({ jobId: job.id });
});

// POST /api/v1/mail/control — { action: start|stop|restart }
router.post('/control', async (req, res) => {
  res.json(await MailManager.control(req.body.action));
});

// GET /api/v1/mail/logs
router.get('/logs', async (req, res) => {
  res.json({ lines: await MailManager.logs() });
});

// ── Mailboxes ──────────────────────────────────────────────
router.get('/accounts', async (req, res) => {
  res.json({ accounts: await MailManager.accounts(), domains: MailManager.domains() });
});

router.post('/accounts', async (req, res) => {
  res.status(201).json(await MailManager.addAccount(req.body.email, req.body.password));
});

router.post('/accounts/:email/password', async (req, res) => {
  res.json(await MailManager.setPassword(req.params.email, req.body.password));
});

router.post('/accounts/:email/quota', async (req, res) => {
  res.json(await MailManager.setQuota(req.params.email, String(req.body.quota || '')));
});

router.delete('/accounts/:email', async (req, res) => {
  res.json(await MailManager.deleteAccount(req.params.email));
});

// ── Aliases / forwarders ───────────────────────────────────
router.get('/aliases', (req, res) => {
  res.json({ aliases: MailManager.aliases() });
});

router.post('/aliases', async (req, res) => {
  res.status(201).json(await MailManager.addAlias(req.body.alias, req.body.target));
});

router.post('/aliases/delete', async (req, res) => {
  res.json(await MailManager.deleteAlias(req.body.alias, req.body.target));
});

// ── DNS & DKIM ─────────────────────────────────────────────
router.get('/dns/:domain', async (req, res) => {
  res.json(await MailManager.dnsReport(req.params.domain));
});

router.post('/dkim/:domain', async (req, res) => {
  res.json(await MailManager.generateDkim(req.params.domain));
});

export default router;
