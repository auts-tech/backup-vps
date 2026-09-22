import { Router } from 'express';
import { createWriteStream, existsSync, readFileSync, statSync } from 'fs';
import { readdir, lstat, stat, readFile, writeFile, mkdir, rename, rm, cp, open, chown } from 'fs/promises';
import { spawn } from 'child_process';
import { join, dirname, basename, resolve } from 'path';
import { pipeline } from 'stream/promises';
import { httpError } from '../lib/config.js';
import { run } from '../lib/shell.js';

const router = Router();

const MAX_EDIT_SIZE = 5 * 1024 * 1024;
const PROTECTED = new Set(['/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib32', '/lib64', '/libx32', '/media', '/mnt', '/opt', '/proc', '/root', '/run', '/sbin', '/snap', '/srv', '/sys', '/tmp', '/usr', '/var', '/var/www', '/var/lib', '/var/log', '/etc/nginx']);
const ARCHIVE = /\.(zip|tar|tar\.gz|tgz|tar\.bz2|tbz2?|tar\.xz|txz|gz)$/i;

/**
 * Resolve and validate a user supplied absolute path.
 */
function absPath(p, field = 'path') {
  if (typeof p !== 'string' || !p.startsWith('/')) throw httpError(400, `${field} must be an absolute path`);
  if (p.includes('\0')) throw httpError(400, `Invalid ${field}`);
  return resolve(p);
}

function assertNotProtected(p, action) {
  if (PROTECTED.has(p)) throw httpError(400, `Refusing to ${action} the system path ${p}`);
}

function assertName(name) {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw httpError(400, `Invalid file name "${name}"`);
  }
  return name;
}

// ── uid/gid → name lookups (cached briefly) ───────────────────
let idCache = { at: 0, users: new Map(), groups: new Map() };
function idNames() {
  if (Date.now() - idCache.at < 60000) return idCache;
  const parse = (file) => {
    const map = new Map();
    try {
      for (const line of readFileSync(file, 'utf-8').split('\n')) {
        const [name, , id] = line.split(':');
        if (name && id) map.set(parseInt(id), name);
      }
    } catch {}
    return map;
  };
  idCache = { at: Date.now(), users: parse('/etc/passwd'), groups: parse('/etc/group') };
  return idCache;
}

function modeString(mode, isDir, isLink) {
  const chars = 'rwxrwxrwx';
  let s = isLink ? 'l' : isDir ? 'd' : '-';
  for (let i = 0; i < 9; i++) s += (mode & (1 << (8 - i))) ? chars[i] : '-';
  return s;
}

/**
 * New files/folders take the parent folder's owner (e.g. www-data under /var/www).
 */
async function inheritOwner(target) {
  try {
    const parent = await stat(dirname(target));
    if (parent.uid !== 0 || parent.gid !== 0) await chown(target, parent.uid, parent.gid);
  } catch {}
}

async function isBinaryFile(path) {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(8000);
    const { bytesRead } = await fh.read(buf, 0, 8000, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

// GET /api/v1/files/list?path=/var/www
router.get('/list', async (req, res) => {
  const dir = absPath(req.query.path || '/');
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw httpError(err.code === 'ENOENT' ? 404 : 400, `Cannot open ${dir}: ${err.code || err.message}`);
  }
  const { users, groups } = idNames();

  const items = await Promise.all(entries.map(async (ent) => {
    const full = join(dir, ent.name);
    try {
      const l = await lstat(full);
      const isLink = l.isSymbolicLink();
      let s = l;
      let broken = false;
      if (isLink) {
        try { s = await stat(full); } catch { broken = true; }
      }
      const isDir = !broken && s.isDirectory();
      return {
        name: ent.name,
        path: full,
        type: isDir ? 'dir' : 'file',
        isLink,
        broken,
        size: isDir ? null : s.size,
        mode: (l.mode & 0o7777).toString(8).padStart(3, '0'),
        perms: modeString(isLink ? s.mode : l.mode, isDir, isLink),
        owner: users.get(l.uid) || String(l.uid),
        group: groups.get(l.gid) || String(l.gid),
        modified: l.mtime,
        archive: !isDir && ARCHIVE.test(ent.name)
      };
    } catch {
      return null;
    }
  }));

  res.json({
    path: dir,
    parent: dir === '/' ? null : dirname(dir),
    entries: items.filter(Boolean).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  });
});

// GET /api/v1/files/read?path= — Text content for the editor
router.get('/read', async (req, res) => {
  const file = absPath(req.query.path);
  const s = await stat(file).catch(() => { throw httpError(404, 'File not found'); });
  if (s.isDirectory()) throw httpError(400, 'That is a directory');
  if (s.size > MAX_EDIT_SIZE) throw httpError(413, `File is too large to edit in the browser (${Math.round(s.size / 1024 / 1024)} MB). Download it instead.`);
  if (await isBinaryFile(file)) throw httpError(415, 'This looks like a binary file. Download it instead.');
  res.json({ path: file, content: await readFile(file, 'utf-8'), size: s.size, modified: s.mtime });
});

// PUT /api/v1/files/write — { path, content } create or overwrite a text file
router.put('/write', async (req, res) => {
  const file = absPath(req.body.path);
  if (typeof req.body.content !== 'string') throw httpError(400, 'content is required');
  const existed = existsSync(file);
  await writeFile(file, req.body.content);
  if (!existed) await inheritOwner(file);
  res.json({ success: true, path: file, size: Buffer.byteLength(req.body.content) });
});

// POST /api/v1/files/mkdir — { path }
router.post('/mkdir', async (req, res) => {
  const dir = absPath(req.body.path);
  if (existsSync(dir)) throw httpError(409, 'A file or folder with that name already exists');
  await mkdir(dir, { recursive: true });
  await inheritOwner(dir);
  res.json({ success: true, path: dir });
});

// POST /api/v1/files/create — { path } new empty file
router.post('/create', async (req, res) => {
  const file = absPath(req.body.path);
  if (existsSync(file)) throw httpError(409, 'A file or folder with that name already exists');
  await writeFile(file, '');
  await inheritOwner(file);
  res.json({ success: true, path: file });
});

// POST /api/v1/files/rename — { from, to } rename or move
router.post('/rename', async (req, res) => {
  const from = absPath(req.body.from, 'from');
  const to = absPath(req.body.to, 'to');
  assertNotProtected(from, 'move');
  if (existsSync(to)) throw httpError(409, `${to} already exists`);
  try {
    await rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await cp(from, to, { recursive: true, preserveTimestamps: true }); // across filesystems
    await rm(from, { recursive: true, force: true });
  }
  res.json({ success: true });
});

// POST /api/v1/files/copy — { from, to }
router.post('/copy', async (req, res) => {
  const from = absPath(req.body.from, 'from');
  const to = absPath(req.body.to, 'to');
  if (existsSync(to)) throw httpError(409, `${to} already exists`);
  if ((to + '/').startsWith(from + '/')) throw httpError(400, 'Cannot copy a folder into itself');
  await cp(from, to, { recursive: true, preserveTimestamps: true });
  res.json({ success: true });
});

// POST /api/v1/files/delete — { paths: [] }
router.post('/delete', async (req, res) => {
  const paths = (req.body.paths || []).map(p => absPath(p));
  if (!paths.length) throw httpError(400, 'Nothing to delete');
  paths.forEach(p => assertNotProtected(p, 'delete'));
  for (const p of paths) await rm(p, { recursive: true, force: true });
  res.json({ success: true, deleted: paths.length });
});

// POST /api/v1/files/chmod — { path, mode: "755", recursive }
router.post('/chmod', async (req, res) => {
  const target = absPath(req.body.path);
  const mode = String(req.body.mode || '');
  if (!/^[0-7]{3,4}$/.test(mode)) throw httpError(400, 'Mode must be octal, e.g. 644 or 755');
  if (req.body.recursive) assertNotProtected(target, 'recursively change permissions of');
  const args = req.body.recursive ? ['-R', mode, target] : [mode, target];
  const r = await run('chmod', args, { timeout: 300000 });
  if (r.code !== 0) throw httpError(500, r.stderr.trim());
  res.json({ success: true });
});

// POST /api/v1/files/chown — { path, owner, group, recursive }
router.post('/chown', async (req, res) => {
  const target = absPath(req.body.path);
  const valid = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\$?$/;
  const { owner, group } = req.body;
  if (!owner || !valid.test(owner) || (group && !valid.test(group))) throw httpError(400, 'Invalid owner or group');
  if (req.body.recursive) assertNotProtected(target, 'recursively change the owner of');
  const spec = group ? `${owner}:${group}` : owner;
  const r = await run('chown', req.body.recursive ? ['-R', spec, target] : [spec, target], { timeout: 300000 });
  if (r.code !== 0) throw httpError(500, r.stderr.trim());
  res.json({ success: true });
});

// POST /api/v1/files/upload?dir=/var/www&name=file.zip&overwrite=1 — raw body stream
router.post('/upload', async (req, res) => {
  const dir = absPath(req.query.dir, 'dir');
  const name = assertName(String(req.query.name || ''));
  const target = join(dir, name);
  if (existsSync(target) && req.query.overwrite !== '1') throw httpError(409, `${name} already exists`);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  const tmp = join(dir, `.${name}.uploading-${Date.now()}`);
  try {
    await pipeline(req, createWriteStream(tmp));
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw httpError(500, `Upload failed: ${err.message}`);
  }
  await inheritOwner(target);
  res.json({ success: true, path: target, size: statSync(target).size });
});

// GET /api/v1/files/download?path=&token= — file, or folder as .tar.gz
router.get('/download', async (req, res) => {
  const target = absPath(req.query.path);
  const s = await stat(target).catch(() => { throw httpError(404, 'Not found'); });
  if (s.isDirectory()) {
    const name = `${basename(target) || 'root'}.tar.gz`;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
    const tar = spawn('tar', ['-czf', '-', '-C', dirname(target), basename(target)]);
    tar.stdout.pipe(res);
    req.on('close', () => tar.kill());
    return;
  }
  res.download(target, basename(target), { dotfiles: 'allow' });
});

// POST /api/v1/files/extract — { path, dest }
router.post('/extract', async (req, res) => {
  const archive = absPath(req.body.path);
  const dest = absPath(req.body.dest || dirname(archive), 'dest');
  if (!existsSync(dest)) await mkdir(dest, { recursive: true });
  const lower = archive.toLowerCase();
  let r;
  if (lower.endsWith('.zip')) {
    r = await run('unzip', ['-o', '-q', archive, '-d', dest], { timeout: 1800000 });
  } else if (/\.(tar|tar\.gz|tgz|tar\.bz2|tbz2?|tar\.xz|txz)$/.test(lower)) {
    r = await run('tar', ['-xf', archive, '-C', dest], { timeout: 1800000 });
  } else if (lower.endsWith('.gz')) {
    const out = join(dest, basename(archive).slice(0, -3));
    r = await run('sh', ['-c', 'gunzip -c "$1" > "$2"', 'sh', archive, out], { timeout: 1800000 });
  } else {
    throw httpError(400, 'Unsupported archive type (zip, tar, tar.gz, tar.bz2, tar.xz, gz)');
  }
  if (r.code === -1 && /ENOENT/.test(r.stderr)) throw httpError(500, 'unzip is not installed (apt install unzip)');
  if (r.code !== 0) throw httpError(500, r.stderr.trim() || r.stdout.trim());
  res.json({ success: true, dest });
});

// POST /api/v1/files/compress — { paths: [], dest: "/path/archive.zip", format: zip|tar.gz }
router.post('/compress', async (req, res) => {
  const paths = (req.body.paths || []).map(p => absPath(p));
  if (!paths.length) throw httpError(400, 'Select files to compress');
  const parent = dirname(paths[0]);
  if (!paths.every(p => dirname(p) === parent)) throw httpError(400, 'All items must be in the same folder');
  const format = req.body.format === 'zip' ? 'zip' : 'tar.gz';
  const dest = absPath(req.body.dest || join(parent, `archive-${Date.now()}.${format}`), 'dest');
  if (existsSync(dest)) throw httpError(409, `${dest} already exists`);
  const names = paths.map(p => basename(p));

  const r = format === 'zip'
    ? await run('zip', ['-r', '-q', dest, '--', ...names], { cwd: parent, timeout: 1800000 })
    : await run('tar', ['-czf', dest, '-C', parent, '--', ...names], { timeout: 1800000 });
  if (r.code === -1 && /ENOENT/.test(r.stderr)) throw httpError(500, `${format === 'zip' ? 'zip' : 'tar'} is not installed`);
  if (r.code !== 0) throw httpError(500, r.stderr.trim());
  await inheritOwner(dest);
  res.json({ success: true, path: dest });
});

// GET /api/v1/files/size?path= — Folder size (du)
router.get('/size', async (req, res) => {
  const target = absPath(req.query.path);
  const r = await run('du', ['-sb', target], { timeout: 120000 });
  const bytes = parseInt(r.stdout.split('\t')[0]);
  if (Number.isNaN(bytes)) throw httpError(500, r.stderr.trim() || 'Could not calculate size');
  res.json({ path: target, bytes });
});

// GET /api/v1/files/search?path=&q= — Find by name (max 300 results)
router.get('/search', async (req, res) => {
  const base = absPath(req.query.path || '/');
  const q = String(req.query.q || '').trim();
  if (q.length < 2) throw httpError(400, 'Search term must be at least 2 characters');
  const r = await run('find', [base, '-xdev', '-maxdepth', '8', '-iname', `*${q.replace(/[[\]*?\\]/g, '\\$&')}*`, '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*'], { timeout: 30000 });
  const results = r.stdout.split('\n').filter(Boolean).slice(0, 300);
  res.json({ results, truncated: r.stdout.split('\n').filter(Boolean).length > 300 });
});

export default router;
