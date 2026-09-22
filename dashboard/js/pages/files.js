/**
 * File Manager — browse, edit, upload, download, permissions, archives
 * Entries are referenced by index (never by name inside inline handlers).
 */
let fmState = { path: '/var/www', entries: [], selected: new Set(), showHidden: false, filter: '' };

function fmLoadPrefs() {
  try {
    const saved = localStorage.getItem('fm_path');
    if (saved) fmState.path = saved;
    fmState.showHidden = localStorage.getItem('fm_hidden') === '1';
  } catch { }
}

function fmSavePrefs() {
  try {
    localStorage.setItem('fm_path', fmState.path);
    localStorage.setItem('fm_hidden', fmState.showHidden ? '1' : '0');
  } catch { }
}

function renderFiles(container) {
  const I = window.Icons;
  fmLoadPrefs();
  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>File Manager</h2>
          <p>Browse and edit files on the server. Changes apply immediately — actions run as root.</p>
        </div>
      </div>

      <div class="card fm-dropzone" id="fm-card">
        <div class="fm-toolbar">
          <button class="btn btn-sm btn-secondary btn-icon-only" onclick="fmUp()" title="Up one level">${I.get('arrowUp', { size: 14 })}</button>
          <button class="btn btn-sm btn-secondary btn-icon-only" onclick="fmGo('/var/www')" title="/var/www">${I.get('home', { size: 14 })}</button>
          <button class="btn btn-sm btn-secondary btn-icon-only" onclick="fmRefresh()" title="Refresh">${I.get('refresh', { size: 14 })}</button>
          <form class="fm-path" onsubmit="event.preventDefault(); fmGo(document.getElementById('fm-path-input').value.trim())">
            <input type="text" id="fm-path-input" class="form-input mono-input" spellcheck="false">
          </form>
          <input type="text" id="fm-filter" class="form-input" placeholder="Filter…" style="width:150px;" oninput="fmState.filter=this.value.toLowerCase(); fmRenderTable()">
          <button class="btn btn-sm btn-secondary" onclick="fmSearch()" title="Search by name below this folder">${I.get('search', { size: 13 })}<span>Search</span></button>
        </div>
        <div class="fm-toolbar" style="background:#fff;">
          <button class="btn btn-sm btn-secondary" onclick="fmNewFile()">${I.get('filePlus', { size: 13 })}<span>New File</span></button>
          <button class="btn btn-sm btn-secondary" onclick="fmNewFolder()">${I.get('folderPlus', { size: 13 })}<span>New Folder</span></button>
          <button class="btn btn-sm btn-secondary" onclick="document.getElementById('fm-upload-input').click()">${I.get('upload', { size: 13 })}<span>Upload</span></button>
          <input type="file" id="fm-upload-input" multiple style="display:none;" onchange="fmUpload(this.files); this.value='';">
          <button class="btn btn-sm btn-secondary" onclick="fmOpenTerminalHere()">${I.get('terminal', { size: 13 })}<span>Terminal Here</span></button>
          <div style="flex:1;"></div>
          <span id="fm-selection-actions" style="display:none;gap:6px;align-items:center;">
            <span class="badge badge-info" id="fm-selected-count"></span>
            <button class="btn btn-sm btn-secondary" onclick="fmCompressSelected()">${I.get('archive', { size: 13 })}<span>Compress</span></button>
            <button class="btn btn-sm btn-secondary" onclick="fmCopyMoveSelected('copy')">${I.get('copy', { size: 13 })}<span>Copy</span></button>
            <button class="btn btn-sm btn-secondary" onclick="fmCopyMoveSelected('move')">${I.get('move', { size: 13 })}<span>Move</span></button>
            <button class="btn btn-sm btn-danger" onclick="fmDeleteSelected()">${I.get('trash', { size: 13 })}<span>Delete</span></button>
          </span>
          <label class="form-check" style="margin-left:8px;"><input type="checkbox" id="fm-hidden" onchange="fmState.showHidden=this.checked; fmSavePrefs(); fmRenderTable()"><span style="font-size:12px;color:var(--text-secondary);">Show hidden</span></label>
        </div>
        <div id="fm-uploads"></div>
        <div class="fm-breadcrumb" id="fm-breadcrumb"></div>
        <div class="table-container" style="border:none;border-radius:0;">
          <table class="table fm-table">
            <thead>
              <tr>
                <th style="width:36px;"><input type="checkbox" id="fm-select-all" onchange="fmSelectAll(this.checked)"></th>
                <th>Name</th>
                <th style="width:110px;">Size</th>
                <th style="width:170px;">Modified</th>
                <th style="width:130px;">Permissions</th>
                <th style="width:150px;">Owner</th>
                <th style="width:170px;text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody id="fm-body"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('fm-hidden').checked = fmState.showHidden;
  fmSetupDropzone();
  fmGo(fmState.path);
}

function fmSetupDropzone() {
  const card = document.getElementById('fm-card');
  let depth = 0;
  card.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { depth++; card.classList.add('dragover'); } });
  card.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) card.classList.remove('dragover'); });
  card.addEventListener('dragover', (e) => e.preventDefault());
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    card.classList.remove('dragover');
    if (e.dataTransfer.files.length) fmUpload(e.dataTransfer.files);
  });
}

async function fmGo(path) {
  if (!path) return;
  const body = document.getElementById('fm-body');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;"><div class="spinner"></div></td></tr>';
  try {
    const res = await api.listFiles(path);
    fmState.path = res.path;
    fmState.entries = res.entries;
    fmState.selected.clear();
    fmSavePrefs();
    document.getElementById('fm-path-input').value = res.path;
    fmRenderBreadcrumb();
    fmRenderTable();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7" style="color:var(--color-red);padding:20px;">${escapeHtml(err.message)}</td></tr>`;
    if (path !== '/') document.getElementById('fm-path-input').value = path;
  }
}

function fmRefresh() { fmGo(fmState.path); }
function fmUp() { if (fmState.path !== '/') fmGo(fmState.path.replace(/\/[^/]+\/?$/, '') || '/'); }
function fmJoin(dir, name) { return (dir === '/' ? '' : dir) + '/' + name; }

function fmRenderBreadcrumb() {
  const parts = fmState.path.split('/').filter(Boolean);
  const crumbs = [`<a onclick="fmGo('/')">/</a>`];
  parts.forEach((p, i) => {
    const target = '/' + parts.slice(0, i + 1).join('/');
    crumbs.push(`<span class="muted">›</span><a onclick="fmGo(${jsArg(target)})">${escapeHtml(p)}</a>`);
  });
  document.getElementById('fm-breadcrumb').innerHTML = crumbs.join('');
}

function fmVisible() {
  return fmState.entries
    .map((e, i) => ({ ...e, i }))
    .filter(e => (fmState.showHidden || !e.name.startsWith('.')) && (!fmState.filter || e.name.toLowerCase().includes(fmState.filter)));
}

function fmIcon(e) {
  const I = window.Icons;
  if (e.type === 'dir') return I.get('folder', { size: 16, color: '#ca8a04' });
  if (e.archive) return I.get('archive', { size: 16, color: 'var(--text-secondary)' });
  if (/\.(php|js|ts|py|rb|go|sh|json|html?|css|vue|jsx|tsx|sql|conf|ya?ml|env)$/i.test(e.name) || e.name.startsWith('.env')) return I.get('code', { size: 16, color: 'var(--color-blue)' });
  return I.get('file', { size: 16, color: 'var(--text-tertiary)' });
}

function fmRenderTable() {
  const I = window.Icons;
  const body = document.getElementById('fm-body');
  const rows = fmVisible();
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:30px;"><div class="empty-state-icon">${I.get('folder', { size: 20 })}</div><div class="empty-state-title">${fmState.entries.length ? 'No matching files' : 'Empty folder'}</div><div class="empty-state-desc">Drag files here to upload.</div></div></td></tr>`;
    fmUpdateSelection();
    return;
  }
  body.innerHTML = rows.map(e => `
    <tr class="fm-row ${fmState.selected.has(e.i) ? 'selected' : ''}">
      <td><input type="checkbox" ${fmState.selected.has(e.i) ? 'checked' : ''} onchange="fmToggleSelect(${e.i}, this.checked)"></td>
      <td style="max-width:420px;">
        <div class="fm-name" onclick="fmOpen(${e.i})" title="${escapeHtml(e.path)}">
          ${fmIcon(e)}
          <span class="fm-name-text">${escapeHtml(e.name)}</span>
          ${e.isLink ? `<span class="badge badge-neutral" title="Symbolic link">${e.broken ? 'broken link' : 'link'}</span>` : ''}
        </div>
      </td>
      <td class="mono-sm">${e.type === 'dir' ? `<a style="cursor:pointer;color:var(--text-tertiary);" onclick="fmCalcSize(${e.i}, this)">calc</a>` : formatBytes(e.size)}</td>
      <td style="font-size:12px;color:var(--text-secondary);">${escapeHtml(formatDate(e.modified))}</td>
      <td><a style="cursor:pointer;" onclick="fmChmod(${e.i})" title="Change permissions"><code>${escapeHtml(e.mode)}</code> <span class="mono-sm">${escapeHtml(e.perms)}</span></a></td>
      <td><a style="cursor:pointer;" class="mono-sm" onclick="fmChown(${e.i})" title="Change owner">${escapeHtml(e.owner)}:${escapeHtml(e.group)}</a></td>
      <td style="text-align:right;">
        <span class="row-actions">
          ${e.type === 'file' ? `<button class="btn btn-sm btn-secondary" onclick="fmEdit(${e.i})" title="Edit">${I.get('edit', { size: 12 })}</button>` : ''}
          ${e.archive ? `<button class="btn btn-sm btn-secondary" onclick="fmExtract(${e.i})" title="Extract here">${I.get('archive', { size: 12 })}</button>` : ''}
          <a class="btn btn-sm btn-secondary" href="${escapeHtml(api.downloadUrl(e.path))}" title="${e.type === 'dir' ? 'Download as .tar.gz' : 'Download'}">${I.get('download', { size: 12 })}</a>
          <button class="btn btn-sm btn-secondary" onclick="fmRename(${e.i})" title="Rename">${I.get('fileText', { size: 12 })}</button>
          <button class="btn btn-sm btn-danger" onclick="fmDelete([${e.i}])" title="Delete">${I.get('trash', { size: 12 })}</button>
        </span>
      </td>
    </tr>
  `).join('');
  fmUpdateSelection();
}

function fmToggleSelect(i, on) {
  if (on) fmState.selected.add(i); else fmState.selected.delete(i);
  fmRenderTable();
}

function fmSelectAll(on) {
  fmState.selected = on ? new Set(fmVisible().map(e => e.i)) : new Set();
  fmRenderTable();
}

function fmUpdateSelection() {
  const n = fmState.selected.size;
  const bar = document.getElementById('fm-selection-actions');
  if (!bar) return;
  bar.style.display = n ? 'inline-flex' : 'none';
  document.getElementById('fm-selected-count').textContent = `${n} selected`;
  const all = document.getElementById('fm-select-all');
  const visible = fmVisible();
  all.checked = visible.length > 0 && visible.every(e => fmState.selected.has(e.i));
}

function fmOpen(i) {
  const e = fmState.entries[i];
  if (e.type === 'dir') return fmGo(e.path);
  if (e.archive) return fmExtract(i);
  fmEdit(i);
}

async function fmEdit(i) {
  const e = fmState.entries[i];
  try {
    const file = await api.readFile(e.path);
    CodeEditor.open({
      title: e.name,
      subtitle: e.path,
      path: e.path,
      content: file.content,
      onSave: async (content) => {
        await api.writeFile(e.path, content);
        toast.success('Saved', e.name);
      }
    });
  } catch (err) {
    Modal.show('Cannot open in editor', `<p style="font-size:13px;margin-bottom:14px;">${escapeHtml(err.message)}</p><a class="btn btn-primary" href="${escapeHtml(api.downloadUrl(e.path))}">${window.Icons.get('download', { size: 13, color: '#fff' })}<span>Download instead</span></a>`);
  }
}

function fmPrompt(title, label, value, onSubmit, hint = '') {
  Modal.show(title, `
    <div class="form-group">
      <label class="form-label">${label}</label>
      <input type="text" id="fm-prompt-input" class="form-input mono-input" value="${escapeHtml(value)}" spellcheck="false">
      ${hint ? `<div class="form-hint">${hint}</div>` : ''}
    </div>
  `, {
    submitText: 'OK',
    onSubmit: async () => {
      const v = document.getElementById('fm-prompt-input').value.trim();
      if (!v) throw new Error(`${label} is required`);
      await onSubmit(v);
    }
  });
  const input = document.getElementById('fm-prompt-input');
  input.focus();
  const dot = value.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : value.length);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('modal-submit-btn')?.click(); });
}

function fmNewFile() {
  fmPrompt('New File', 'File name', '', async (name) => {
    const path = fmJoin(fmState.path, name);
    await api.createFile(path);
    toast.success('Created', name);
    await fmGo(fmState.path);
    const i = fmState.entries.findIndex(e => e.path === path);
    if (i >= 0) fmEdit(i);
  });
}

function fmNewFolder() {
  fmPrompt('New Folder', 'Folder name', '', async (name) => {
    await api.mkdir(fmJoin(fmState.path, name));
    toast.success('Created', name);
    fmRefresh();
  });
}

function fmRename(i) {
  const e = fmState.entries[i];
  fmPrompt('Rename', 'New name', e.name, async (name) => {
    await api.renameFile(e.path, name.startsWith('/') ? name : fmJoin(fmState.path, name));
    toast.success('Renamed', name);
    fmRefresh();
  }, 'Enter a full path (starting with /) to move it elsewhere.');
}

function fmDelete(indexes) {
  const items = indexes.map(i => fmState.entries[i]);
  const list = items.slice(0, 8).map(e => `<li class="mono-sm">${escapeHtml(e.path)}</li>`).join('') + (items.length > 8 ? `<li class="muted">…and ${items.length - 8} more</li>` : '');
  Modal.confirm('Delete permanently?', `This cannot be undone. Folders are deleted with everything inside.<ul style="margin:10px 0 0 18px;">${list}</ul>`, async () => {
    await api.deleteFiles(items.map(e => e.path));
    toast.success('Deleted', `${items.length} item${items.length === 1 ? '' : 's'}`);
    fmRefresh();
  });
}

function fmDeleteSelected() { fmDelete([...fmState.selected]); }

function fmChmod(i) {
  const e = fmState.entries[i];
  Modal.show(`Permissions — ${escapeHtml(e.name)}`, `
    <div class="form-group">
      <label class="form-label">Mode (octal)</label>
      <input type="text" id="fm-mode" class="form-input mono-input" value="${escapeHtml(e.mode.slice(-3))}" maxlength="4" style="max-width:120px;">
      <div class="form-hint">Common: 644 files · 755 folders & scripts · 600 secrets (.env)</div>
    </div>
    ${e.type === 'dir' ? '<label class="form-check"><input type="checkbox" id="fm-mode-recursive"><span style="font-size:13px;">Apply to everything inside</span></label>' : ''}
  `, {
    submitText: 'Apply',
    onSubmit: async () => {
      await api.chmodFile(e.path, document.getElementById('fm-mode').value.trim(), document.getElementById('fm-mode-recursive')?.checked);
      toast.success('Permissions updated', e.name);
      fmRefresh();
    }
  });
}

function fmChown(i) {
  const e = fmState.entries[i];
  Modal.show(`Owner — ${escapeHtml(e.name)}`, `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label class="form-label">User</label><input type="text" id="fm-owner" class="form-input mono-input" value="${escapeHtml(e.owner)}"></div>
      <div class="form-group"><label class="form-label">Group</label><input type="text" id="fm-group" class="form-input mono-input" value="${escapeHtml(e.group)}"></div>
    </div>
    <div class="form-hint" style="margin-bottom:10px;">Web files are usually owned by <code>www-data:www-data</code>.</div>
    ${e.type === 'dir' ? '<label class="form-check"><input type="checkbox" id="fm-owner-recursive" checked><span style="font-size:13px;">Apply to everything inside</span></label>' : ''}
  `, {
    submitText: 'Apply',
    onSubmit: async () => {
      await api.chownFile(e.path, document.getElementById('fm-owner').value.trim(), document.getElementById('fm-group').value.trim(), document.getElementById('fm-owner-recursive')?.checked);
      toast.success('Owner updated', e.name);
      fmRefresh();
    }
  });
}

function fmExtract(i) {
  const e = fmState.entries[i];
  fmPrompt(`Extract ${escapeHtml(e.name)}`, 'Extract into folder', fmState.path, async (dest) => {
    toast.info('Extracting…', e.name);
    await api.extractFile(e.path, dest);
    toast.success('Extracted', dest);
    fmRefresh();
  }, 'Existing files with the same names are overwritten.');
}

function fmCompressSelected() {
  const items = [...fmState.selected].map(i => fmState.entries[i]);
  const base = items.length === 1 ? items[0].name : 'archive';
  Modal.show('Compress', `
    <div class="form-group">
      <label class="form-label">Archive name</label>
      <input type="text" id="fm-archive-name" class="form-input mono-input" value="${escapeHtml(base)}">
    </div>
    <div class="form-group">
      <label class="form-label">Format</label>
      <select id="fm-archive-format" class="form-select"><option value="zip">.zip</option><option value="tar.gz">.tar.gz</option></select>
    </div>
  `, {
    submitText: 'Compress',
    onSubmit: async () => {
      const format = document.getElementById('fm-archive-format').value;
      const name = document.getElementById('fm-archive-name').value.trim().replace(/\.(zip|tar\.gz)$/, '');
      await api.compressFiles(items.map(e => e.path), fmJoin(fmState.path, `${name}.${format}`), format);
      toast.success('Archive created', `${name}.${format}`);
      fmRefresh();
    }
  });
}

function fmCopyMoveSelected(mode) {
  const items = [...fmState.selected].map(i => fmState.entries[i]);
  fmPrompt(mode === 'copy' ? 'Copy to…' : 'Move to…', 'Destination folder', fmState.path, async (dest) => {
    for (const e of items) {
      const to = fmJoin(dest.replace(/\/+$/, '') || '/', e.name);
      if (mode === 'copy') await api.copyFile(e.path, to);
      else await api.renameFile(e.path, to);
    }
    toast.success(mode === 'copy' ? 'Copied' : 'Moved', `${items.length} item(s) to ${dest}`);
    fmRefresh();
  });
}

async function fmCalcSize(i, el) {
  el.textContent = '…';
  try {
    const res = await api.folderSize(fmState.entries[i].path);
    el.textContent = formatBytes(res.bytes);
  } catch (err) {
    el.textContent = 'error';
    toast.error('Size failed', err.message);
  }
}

async function fmUpload(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const wrap = document.getElementById('fm-uploads');
  const dir = fmState.path;
  const existing = new Set(fmState.entries.map(e => e.name));
  const clashes = files.filter(f => existing.has(f.name));
  let overwrite = false;
  if (clashes.length) {
    overwrite = confirm(`${clashes.length} file(s) already exist here (${clashes.slice(0, 3).map(f => f.name).join(', ')}${clashes.length > 3 ? '…' : ''}). Overwrite?`);
    if (!overwrite) {
      files.splice(0, files.length, ...files.filter(f => !existing.has(f.name)));
      if (!files.length) return;
    }
  }

  for (const file of files) {
    const row = document.createElement('div');
    row.style.cssText = 'padding:6px 16px;border-bottom:1px solid var(--border-secondary);font-size:12px;';
    row.innerHTML = `<div style="display:flex;justify-content:space-between;"><span class="mono-sm">${escapeHtml(file.name)}</span><span class="pct muted">0%</span></div><div style="background:var(--bg-subtle);border-radius:2px;margin-top:4px;"><div class="upload-progress" style="width:0%;"></div></div>`;
    wrap.appendChild(row);
    try {
      await api.uploadFile(dir, file, overwrite, (p) => {
        row.querySelector('.upload-progress').style.width = `${Math.round(p * 100)}%`;
        row.querySelector('.pct').textContent = `${Math.round(p * 100)}%`;
      });
      row.remove();
    } catch (err) {
      row.querySelector('.pct').textContent = err.message;
      row.querySelector('.pct').style.color = 'var(--color-red)';
      setTimeout(() => row.remove(), 8000);
    }
  }
  toast.success('Upload complete', `${files.length} file(s) to ${dir}`);
  if (fmState.path === dir) fmRefresh();
}

async function fmSearch() {
  const q = prompt(`Search file names below ${fmState.path}:`);
  if (!q) return;
  try {
    const res = await api.searchFiles(fmState.path, q);
    const items = res.results.map(p => {
      const dir = p.replace(/\/[^/]+$/, '') || '/';
      return `<div style="padding:6px 0;border-bottom:1px solid var(--border-secondary);"><a style="cursor:pointer;" class="mono-sm" onclick="Modal.closeAll(); fmGo(${jsArg(dir)})">${escapeHtml(p)}</a></div>`;
    }).join('');
    Modal.show(`Search: ${escapeHtml(q)}`, res.results.length ? `${items}${res.truncated ? '<div class="form-hint">Showing the first 300 matches.</div>' : ''}` : '<p class="muted">No matches.</p>', { width: 760 });
  } catch (err) {
    toast.error('Search failed', err.message);
  }
}

function fmOpenTerminalHere() {
  try { localStorage.setItem('terminal_cwd', fmState.path); } catch { }
  window.app.navigate('terminal');
}

window.renderFiles = renderFiles;
