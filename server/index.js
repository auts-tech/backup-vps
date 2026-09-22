import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import { authMiddleware } from './middleware/auth.js';
import { attachTerminal } from './services/terminal.js';

// Routes
import projectsRouter from './routes/projects.js';
import backupsRouter from './routes/backups.js';
import deployRouter from './routes/deploy.js';
import cronRouter, { migrateLegacyCronJobs } from './routes/cron.js';
import monitorRouter from './routes/monitor.js';
import logsRouter from './routes/logs.js';
import settingsRouter from './routes/settings.js';
import jobsRouter from './routes/jobs.js';
import nginxRouter from './routes/nginx.js';
import filesRouter from './routes/files.js';
import databasesRouter from './routes/databases.js';
import phpRouter from './routes/php.js';
import mailRouter from './routes/mail.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load dotenv from project root (one level up from server/)
import dotenv from 'dotenv';
dotenv.config({ path: join(__dirname, '..', '.env') });

const configPath = join(__dirname, 'data', 'config.json');

function getConfig() {
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

const app = express();
// Behind an nginx reverse proxy on the same host, take the client IP from X-Forwarded-For
app.set('trust proxy', 'loopback');
const config = getConfig();

// Cron jobs and the CLI authenticate with the API key, so make sure one exists
if (!config.apiKey) {
  config.apiKey = crypto.randomBytes(24).toString('hex');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}
const PORT = process.env.PORT || config.server?.port || 9090;
const HOST = process.env.HOST || config.server?.host || '0.0.0.0';
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-dev-secret';

// In-memory session token store (survives until server restarts)
// Maps token -> { email, createdAt }
const activeSessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000;

function isValidSession(token) {
  const session = token && activeSessions.get(token);
  return !!session && Date.now() - session.createdAt < SESSION_TTL;
}

// Login brute-force protection: 10 failed attempts per IP per 15 minutes
const loginFailures = new Map(); // ip -> { count, first }
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
// Express 5 leaves req.body undefined when a request has no body (e.g. `curl -X POST`)
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

// Serve dashboard frontend as static files
app.use(express.static(join(__dirname, '..', 'dashboard')));

// ── Public endpoints (no auth) ──────────────────────────────

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Check auth status — tells the frontend whether user is logged in
app.get('/api/v1/auth/status', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  if (token && activeSessions.has(token)) {
    const session = activeSessions.get(token);
    return res.json({ authenticated: true, email: session.email });
  }
  res.json({ authenticated: false });
});

// Login endpoint — validates email + password from .env
app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip;

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    return res.status(500).json({
      error: 'Server misconfigured',
      message: 'ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env file'
    });
  }

  const failures = loginFailures.get(ip);
  if (failures && Date.now() - failures.first < LOGIN_WINDOW && failures.count >= LOGIN_MAX_FAILURES) {
    const minutes = Math.ceil((LOGIN_WINDOW - (Date.now() - failures.first)) / 60000);
    return res.status(429).json({ error: `Too many failed logins. Try again in ${minutes} minute(s).` });
  }

  if (!safeEqual(email, adminEmail) || !safeEqual(password, adminPassword)) {
    const entry = failures && Date.now() - failures.first < LOGIN_WINDOW ? failures : { count: 0, first: Date.now() };
    entry.count++;
    loginFailures.set(ip, entry);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  loginFailures.delete(ip);

  // Generate a secure session token
  const token = crypto.randomBytes(48).toString('hex');
  activeSessions.set(token, {
    email,
    createdAt: Date.now()
  });

  // Cleanup tokens older than 24 hours
  for (const [t, s] of activeSessions.entries()) {
    if (Date.now() - s.createdAt > SESSION_TTL) activeSessions.delete(t);
  }

  res.json({
    success: true,
    token,
    email,
    message: 'Login successful'
  });
});

// Logout
app.post('/api/v1/auth/logout', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) activeSessions.delete(token);
  res.json({ success: true, message: 'Logged out' });
});

// Setup status (public — needed before login)
app.get('/api/v1/setup-status', (req, res) => {
  const config = getConfig();
  res.json({
    needsSetup: !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD,
    projectCount: config.projects?.length || 0
  });
});

// ── Protected API routes ────────────────────────────────────
// Pass activeSessions to middleware so it can validate bearer tokens
const protect = (req, res, next) => { req.activeSessions = activeSessions; authMiddleware(req, res, next); };
app.use('/api/v1/projects', protect, projectsRouter);
app.use('/api/v1/backups', protect, backupsRouter);
app.use('/api/v1/deploy', protect, deployRouter);
app.use('/api/v1/cron', protect, cronRouter);
app.use('/api/v1/monitor', protect, monitorRouter);
app.use('/api/v1/logs', protect, logsRouter);
app.use('/api/v1/settings', protect, settingsRouter);
app.use('/api/v1/jobs', protect, jobsRouter);
app.use('/api/v1/nginx', protect, nginxRouter);
app.use('/api/v1/files', protect, filesRouter);
app.use('/api/v1/databases', protect, databasesRouter);
app.use('/api/v1/php', protect, phpRouter);
app.use('/api/v1/mail', protect, mailRouter);

// SPA fallback — serve index.html for all non-API routes
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    res.sendFile(join(__dirname, '..', 'dashboard', 'index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

// Error handler — errors may carry an HTTP status (see httpError in lib/config.js)
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[Server Error]', err.message);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const server = app.listen(PORT, HOST, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   VPS Deploy & Backup Manager                ║');
  console.log('║   ─────────────────────────────────           ║');
  console.log(`║   🌐 Dashboard: http://${HOST}:${PORT}           ║`);
  console.log(`║   📡 API:       http://${HOST}:${PORT}/api/v1    ║`);
  console.log('║                                               ║');
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.log('║   ⚠️  No .env found — copy .env.example       ║');
  } else {
    console.log(`║   👤 Admin:     ${process.env.ADMIN_EMAIL.substring(0, 28).padEnd(28)}║`);
  }
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('');
});

// Web terminal over WebSocket (authenticated with the session token)
attachTerminal(server, isValidSession);

// Fix backup cron jobs created by older versions (they called the API without a key)
migrateLegacyCronJobs()
  .then(n => n && console.log(`[Cron] Migrated ${n} legacy backup job(s) to the authenticated task runner`))
  .catch(err => console.error('[Cron] Legacy job migration skipped:', err.message));

export default app;
