import { Router } from 'express';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { rm } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { MysqlManager, assertDbName } from '../services/mysql-manager.js';
import { JobRunner } from '../services/job-runner.js';
import { httpError } from '../lib/config.js';
import { cleanEnv } from '../lib/shell.js';

const router = Router();

// GET /api/v1/databases/status — Server installed/running/connected
router.get('/status', async (req, res) => {
  res.json(await MysqlManager.status());
});

// POST /api/v1/databases/install — Install MariaDB server (background job)
router.post('/install', (req, res) => {
  const job = JobRunner.start('Install MariaDB server', `
apt_get update
apt_get install mariadb-server mariadb-client
svc_enable mariadb
mariadb --version
echo "MariaDB installed. Root uses unix-socket authentication (no password needed from this server)."
`);
  res.json({ jobId: job.id });
});

// POST /api/v1/databases/connect — Auto-setup the panel account via root socket auth
router.post('/connect', async (req, res) => {
  res.json(await MysqlManager.bootstrap());
});

// POST /api/v1/databases/credentials — Use explicit credentials { host, port, user, password }
router.post('/credentials', async (req, res) => {
  res.json(await MysqlManager.setCredentials(req.body));
});

// GET /api/v1/databases — Databases and users overview
router.get('/', async (req, res) => {
  res.json(await MysqlManager.overview());
});

// POST /api/v1/databases — Create database (optionally with a user)
router.post('/', async (req, res) => {
  res.status(201).json(await MysqlManager.createDatabase(req.body));
});

// POST /api/v1/databases/query — SQL console { sql, database }
router.post('/query', async (req, res) => {
  res.json(await MysqlManager.execute(req.body.sql, req.body.database));
});

// ── Users ──────────────────────────────────────────────────
router.post('/users', async (req, res) => {
  res.status(201).json(await MysqlManager.createUser(req.body));
});

router.get('/users/:user/:host/grants', async (req, res) => {
  res.json(await MysqlManager.showGrants(req.params.user, req.params.host));
});

router.post('/users/:user/:host/password', async (req, res) => {
  res.json(await MysqlManager.setPassword(req.params.user, req.params.host, req.body.password));
});

router.post('/users/:user/:host/grant', async (req, res) => {
  res.json(await MysqlManager.grant(req.params.user, req.params.host, req.body.database, req.body.privileges));
});

router.post('/users/:user/:host/revoke', async (req, res) => {
  res.json(await MysqlManager.revoke(req.params.user, req.params.host, req.body.database));
});

router.delete('/users/:user/:host', async (req, res) => {
  res.json(await MysqlManager.dropUser(req.params.user, req.params.host));
});

// ── Per-database ───────────────────────────────────────────
router.delete('/:db', async (req, res) => {
  res.json(await MysqlManager.dropDatabase(req.params.db));
});

router.get('/:db/tables', async (req, res) => {
  res.json(await MysqlManager.tables(req.params.db));
});

router.get('/:db/tables/:table/structure', async (req, res) => {
  res.json(await MysqlManager.structure(req.params.db, req.params.table));
});

router.get('/:db/tables/:table/rows', async (req, res) => {
  res.json(await MysqlManager.rows(req.params.db, req.params.table, req.query));
});

// GET /api/v1/databases/:db/export?token= — Streams a gzipped mysqldump
router.get('/:db/export', async (req, res) => {
  const db = req.params.db;
  assertDbName(db);
  const { dump } = await MysqlManager.binaries();
  if (!dump) throw httpError(400, 'mysqldump is not installed');
  const defaults = MysqlManager.defaultsFile();

  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${db}-${stamp}.sql.gz"`);

  const child = spawn(dump, [`--defaults-extra-file=${defaults}`, '--single-transaction', '--quick', '--routines', '--triggers', '--events', db], { env: cleanEnv() });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  child.on('close', code => { if (code !== 0) console.error(`[DB Export] ${db} failed: ${stderr.trim()}`); });
  req.on('close', () => child.kill());
  child.stdout.pipe(createGzip()).pipe(res);
});

// POST /api/v1/databases/:db/import?name=dump.sql.gz — raw upload, imported as a background job
router.post('/:db/import', async (req, res) => {
  const db = req.params.db;
  assertDbName(db);
  const name = String(req.query.name || 'import.sql');
  if (!/\.(sql|sql\.gz|gz|zip)$/i.test(name)) throw httpError(400, 'Upload a .sql, .sql.gz or .zip file');
  const { client } = await MysqlManager.binaries();
  if (!client) throw httpError(400, 'The mysql client is not installed');
  const defaults = MysqlManager.defaultsFile();

  const tmp = `/tmp/vps-panel-import-${Date.now()}${name.toLowerCase().endsWith('.zip') ? '.zip' : name.toLowerCase().endsWith('gz') ? '.sql.gz' : '.sql'}`;
  try {
    await pipeline(req, createWriteStream(tmp, { mode: 0o600 }));
  } catch (err) {
    await rm(tmp, { force: true });
    throw httpError(500, `Upload failed: ${err.message}`);
  }

  const reader = tmp.endsWith('.zip') ? `unzip -p '${tmp}'` : tmp.endsWith('.gz') ? `gunzip -c '${tmp}'` : `cat '${tmp}'`;
  const job = JobRunner.start(`Import into ${db}`, `
trap "rm -f '${tmp}'" EXIT
echo "Importing $(du -h '${tmp}' | cut -f1) into database ${db}..."
${reader} | '${client}' --defaults-extra-file='${defaults}' '${db}'
echo "Import finished."
`);
  res.json({ jobId: job.id });
});

export default router;
