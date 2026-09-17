import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { authMiddleware } from './middleware/auth.js';

// Routes
import projectsRouter from './routes/projects.js';
import backupsRouter from './routes/backups.js';
import deployRouter from './routes/deploy.js';
import cronRouter from './routes/cron.js';
import monitorRouter from './routes/monitor.js';
import logsRouter from './routes/logs.js';
import settingsRouter from './routes/settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load dotenv from project root (one level up from server/)
import dotenv from 'dotenv';
dotenv.config({ path: join(__dirname, '..', '.env') });

const configPath = join(__dirname, 'data', 'config.json');

function getConfig() {
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

const app = express();
const config = getConfig();
const PORT = process.env.PORT || config.server?.port || 9090;
const HOST = process.env.HOST || config.server?.host || '0.0.0.0';
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-dev-secret';

// In-memory session token store (survives until server restarts)
// Maps token -> { email, createdAt }
const activeSessions = new Map();

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    return res.status(500).json({
      error: 'Server misconfigured',
      message: 'ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env file'
    });
  }

  if (email !== adminEmail || password !== adminPassword) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Generate a secure session token
  const token = crypto.randomBytes(48).toString('hex');
  activeSessions.set(token, {
    email,
    createdAt: Date.now()
  });

  // Cleanup tokens older than 24 hours
  const DAY = 24 * 60 * 60 * 1000;
  for (const [t, s] of activeSessions.entries()) {
    if (Date.now() - s.createdAt > DAY) activeSessions.delete(t);
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
app.use('/api/v1/projects', (req, res, next) => { req.activeSessions = activeSessions; next(); }, authMiddleware, projectsRouter);
app.use('/api/v1/backups', (req, res, next) => { req.activeSessions = activeSessions; next(); }, authMiddleware, backupsRouter);
app.use('/api/v1/deploy', (req, res, next) => { req.activeSessions = activeSessions; next(); }, authMiddleware, deployRouter);
app.use('/api/v1/cron', (req, res, next) => { req.activeSessions = activeSessions; next(); }, authMiddleware, cronRouter);
app.use('/api/v1/monitor', (req, res, next) => { req.activeSessions = activeSessions; next(); }, authMiddleware, monitorRouter);
app.use('/api/v1/logs', (req, res, next) => { req.activeSessions = activeSessions; next(); }, authMiddleware, logsRouter);
app.use('/api/v1/settings', (req, res, next) => { req.activeSessions = activeSessions; next(); }, authMiddleware, settingsRouter);

// SPA fallback — serve index.html for all non-API routes
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    res.sendFile(join(__dirname, '..', 'dashboard', 'index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, HOST, () => {
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

export default app;
