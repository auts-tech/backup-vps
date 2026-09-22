/**
 * Databases — MySQL/MariaDB databases, users, privileges, table browser, SQL console
 */
let dbState = { tab: 'databases', databases: [], users: [], browse: null, consoleDb: '' };

function renderDatabases(container) {
  const I = window.Icons;
  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Databases</h2>
          <p>MySQL / MariaDB databases, users and privileges — plus a table browser and SQL console</p>
        </div>
        <div style="display:flex;gap:8px;" id="db-header-actions"></div>
      </div>
      <div id="db-status-area"><div class="spinner"></div></div>
      <div id="db-main" style="display:none;">
        <div class="tabs">
          <button class="tab" data-tab="databases" onclick="dbSwitchTab('databases')">${I.get('database', { size: 14 })}Databases</button>
          <button class="tab" data-tab="users" onclick="dbSwitchTab('users')">${I.get('users', { size: 14 })}Users</button>
          <button class="tab" data-tab="browse" onclick="dbSwitchTab('browse')">${I.get('table', { size: 14 })}Browse</button>
          <button class="tab" data-tab="console" onclick="dbSwitchTab('console')">${I.get('terminal', { size: 14 })}SQL Console</button>
        </div>
        <div id="db-tab-content"></div>
      </div>
    </div>
  `;
  loadDbStatus();
}

async function loadDbStatus() {
  const area = document.getElementById('db-status-area');
  if (!area) return;
  const I = window.Icons;
  try {
    const s = await api.getDbStatus();
    const main = document.getElementById('db-main');
    if (!s.installed && !s.clientInstalled) {
      area.innerHTML = `
        <div class="card"><div class="card-body">
          <div class="empty-state" style="padding:20px;">
            <div class="empty-state-icon">${I.get('database', { size: 20 })}</div>
            <div class="empty-state-title">No database server installed</div>
            <div class="empty-state-desc">Install MariaDB (a drop-in MySQL replacement) to create databases for your sites.</div>
            <button class="btn btn-primary" onclick="JobConsole.run(api.installDbServer(), 'Install MariaDB', { onDone: loadDbStatus })">Install MariaDB</button>
          </div>
        </div></div>`;
      main.style.display = 'none';
      return;
    }
    if (!s.connected) {
      area.innerHTML = `
        <div class="card" style="margin-bottom:20px;"><div class="card-body">
          <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">
            <div style="flex:1;min-width:260px;">
              <h3 style="font-size:15px;margin-bottom:6px;">Connect the panel to ${escapeHtml(s.service === 'mariadb' ? 'MariaDB' : 'MySQL')}</h3>
              <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
                The panel creates its own admin account (<code>vpspanel</code>) using root socket login — the Ubuntu default, no password needed.
                ${s.running ? '' : '<br><strong style="color:var(--color-red);">The database service is not running.</strong>'}
              </p>
              ${s.error ? `<div class="alert alert-danger" style="margin-bottom:12px;font-size:12px;">${escapeHtml(s.error)}</div>` : ''}
              <button class="btn btn-primary" id="db-auto-connect" onclick="dbAutoConnect()">${I.get('zap', { size: 13, color: '#fff' })}<span>Connect automatically</span></button>
            </div>
            <div style="flex:1;min-width:260px;border-left:1px solid var(--border-primary);padding-left:16px;">
              <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Or use existing credentials</div>
              <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;">
                <input class="form-input" id="db-cred-host" placeholder="localhost">
                <input class="form-input" id="db-cred-port" placeholder="3306">
              </div>
              <input class="form-input" id="db-cred-user" placeholder="root" style="margin-top:8px;">
              <input class="form-input" id="db-cred-pass" type="password" placeholder="Password" style="margin-top:8px;">
              <button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="dbSaveCredentials()">Connect</button>
            </div>
          </div>
        </div></div>`;
      main.style.display = 'none';
      return;
    }
    area.innerHTML = `
      <div class="status-row" style="margin-bottom:16px;">
        <span class="badge ${s.running ? 'badge-success' : 'badge-danger'}"><span class="badge-dot"></span>${s.running ? 'Running' : 'Stopped'}</span>
        <span class="badge badge-neutral">${escapeHtml(s.version || '')}</span>
        <span class="badge badge-neutral">Panel user: ${escapeHtml(s.user)}</span>
      </div>`;
    document.getElementById('db-header-actions').innerHTML = `
      <button class="btn btn-secondary" onclick="showCreateDbUserModal()">${I.get('user', { size: 13 })}<span>New User</span></button>
      <button class="btn btn-primary" onclick="showCreateDbModal()">${I.get('plus', { size: 13, color: '#fff' })}<span>New Database</span></button>`;
    main.style.display = 'block';
    await dbLoadOverview();
    dbSwitchTab(dbState.tab);
  } catch (err) {
    area.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

async function dbAutoConnect() {
  const btn = document.getElementById('db-auto-connect');
  btn.disabled = true;
  try {
    await api.connectDb();
    toast.success('Connected', 'Panel database account created');
    loadDbStatus();
  } catch (err) {
    btn.disabled = false;
    Modal.show('Automatic setup failed', `<p style="font-size:13px;">${escapeHtml(err.message)}</p>`);
  }
}

async function dbSaveCredentials() {
  try {
    await api.setDbCredentials({
      host: document.getElementById('db-cred-host').value.trim() || 'localhost',
      port: document.getElementById('db-cred-port').value.trim() || 3306,
      user: document.getElementById('db-cred-user').value.trim() || 'root',
      password: document.getElementById('db-cred-pass').value
    });
    toast.success('Connected', 'Credentials saved');
    loadDbStatus();
  } catch (err) {
    toast.error('Connection failed', err.message);
  }
}

async function dbLoadOverview() {
  const res = await api.getDatabases();
  dbState.databases = res.databases;
  dbState.users = res.users;
}

function dbSwitchTab(tab) {
  dbState.tab = tab;
  document.querySelectorAll('#db-main .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const el = document.getElementById('db-tab-content');
  if (!el) return;
  if (tab === 'databases') dbRenderDatabases(el);
  else if (tab === 'users') dbRenderUsers(el);
  else if (tab === 'browse') dbRenderBrowse(el);
  else dbRenderConsole(el);
}

function dbRenderDatabases(el) {
  const I = window.Icons;
  const rows = dbState.databases;
  el.innerHTML = `
    <div class="card"><div class="table-container" style="border:none;border-radius:0;">
      <table class="table">
        <thead><tr><th>Database</th><th>Size</th><th>Tables</th><th>Users</th><th>Collation</th><th style="text-align:right;">Actions</th></tr></thead>
        <tbody>
          ${rows.map((d, i) => `
            <tr>
              <td><strong>${escapeHtml(d.name)}</strong> ${d.system ? '<span class="badge badge-neutral">system</span>' : ''}</td>
              <td>${formatBytes(d.size)}</td>
              <td>${d.tables}</td>
              <td class="mono-sm">${d.users.length ? escapeHtml(d.users.join(', ')) : '<span class="muted">—</span>'}</td>
              <td class="mono-sm">${escapeHtml(d.collation)}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="btn btn-sm btn-secondary" onclick="dbBrowse(${jsArg(d.name)})">${I.get('table', { size: 12 })}<span>Browse</span></button>
                ${d.system ? '' : `
                  <a class="btn btn-sm btn-secondary" href="${escapeHtml(api.exportDbUrl(d.name))}" title="Download .sql.gz">${I.get('download', { size: 12 })}</a>
                  <button class="btn btn-sm btn-secondary" onclick="dbImport(${jsArg(d.name)})" title="Import .sql / .sql.gz">${I.get('upload', { size: 12 })}</button>
                  <button class="btn btn-sm btn-danger" onclick="dbDrop(${jsArg(d.name)})" title="Drop">${I.get('trash', { size: 12 })}</button>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div></div>`;
}

function dbRenderUsers(el) {
  const I = window.Icons;
  el.innerHTML = `
    <div class="card"><div class="table-container" style="border:none;border-radius:0;">
      <table class="table">
        <thead><tr><th>User</th><th>Host</th><th>Databases</th><th>Auth</th><th style="text-align:right;">Actions</th></tr></thead>
        <tbody>
          ${dbState.users.map(u => `
            <tr>
              <td><strong>${escapeHtml(u.user || '(anonymous)')}</strong> ${u.system ? '<span class="badge badge-neutral">system</span>' : ''}</td>
              <td class="mono-sm">${escapeHtml(u.host)}</td>
              <td class="mono-sm">${u.databases.length ? escapeHtml(u.databases.join(', ')) : '<span class="muted">—</span>'}</td>
              <td class="mono-sm">${escapeHtml(u.plugin || '')}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="btn btn-sm btn-secondary" onclick="dbShowGrants(${jsArg(u.user)}, ${jsArg(u.host)})">${I.get('key', { size: 12 })}<span>Privileges</span></button>
                ${u.system ? '' : `
                  <button class="btn btn-sm btn-secondary" onclick="dbChangePassword(${jsArg(u.user)}, ${jsArg(u.host)})" title="Change password">${I.get('lock', { size: 12 })}</button>
                  <button class="btn btn-sm btn-danger" onclick="dbDropUser(${jsArg(u.user)}, ${jsArg(u.host)})" title="Delete user">${I.get('trash', { size: 12 })}</button>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div></div>`;
}

function showCreateDbModal() {
  const pw = generatePassword();
  Modal.show('Create Database', `
    <div class="form-group">
      <label class="form-label">Database name *</label>
      <input type="text" id="newdb-name" class="form-input mono-input" placeholder="myapp" oninput="document.getElementById('newdb-user').placeholder = this.value ? this.value + '_user' : 'myapp_user'">
    </div>
    <div class="form-group">
      <label class="form-label">Collation</label>
      <select id="newdb-collation" class="form-select">
        <option value="utf8mb4|utf8mb4_unicode_ci">utf8mb4_unicode_ci (recommended)</option>
        <option value="utf8mb4|utf8mb4_general_ci">utf8mb4_general_ci</option>
        <option value="utf8mb4|utf8mb4_bin">utf8mb4_bin</option>
        <option value="latin1|latin1_swedish_ci">latin1_swedish_ci (legacy)</option>
      </select>
    </div>
    <label class="form-check" style="margin-bottom:12px;"><input type="checkbox" id="newdb-with-user" checked onchange="document.getElementById('newdb-user-fields').style.display=this.checked?'block':'none'"><span style="font-size:13px;">Create a user with full access to this database</span></label>
    <div id="newdb-user-fields">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group"><label class="form-label">Username</label><input type="text" id="newdb-user" class="form-input mono-input" placeholder="myapp_user"></div>
        <div class="form-group"><label class="form-label">Host</label><input type="text" id="newdb-host" class="form-input mono-input" value="localhost"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <div style="display:flex;gap:6px;"><input type="text" id="newdb-pass" class="form-input mono-input" value="${pw}"><button type="button" class="btn btn-secondary btn-icon-only" title="Copy" onclick="navigator.clipboard.writeText(document.getElementById('newdb-pass').value); toast.success('Copied','')">${window.Icons.get('copy', { size: 13 })}</button></div>
        <div class="form-hint">Save this password now — use it in your app's .env (DB_PASSWORD).</div>
      </div>
    </div>
  `, {
    submitText: 'Create',
    onSubmit: async () => {
      const name = document.getElementById('newdb-name').value.trim();
      if (!name) throw new Error('Enter a database name');
      const [charset, collation] = document.getElementById('newdb-collation').value.split('|');
      const payload = { name, charset, collation };
      if (document.getElementById('newdb-with-user').checked) {
        payload.user = document.getElementById('newdb-user').value.trim() || `${name}_user`.slice(0, 32);
        payload.host = document.getElementById('newdb-host').value.trim() || 'localhost';
        payload.password = document.getElementById('newdb-pass').value;
      }
      await api.createDatabase(payload);
      toast.success('Database created', payload.user ? `${name} with user ${payload.user}` : name);
      await dbLoadOverview();
      dbSwitchTab('databases');
    }
  });
}

function showCreateDbUserModal() {
  const dbOptions = dbState.databases.filter(d => !d.system).map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('');
  Modal.show('Create Database User', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label class="form-label">Username *</label><input type="text" id="newuser-name" class="form-input mono-input"></div>
      <div class="form-group"><label class="form-label">Host</label><input type="text" id="newuser-host" class="form-input mono-input" value="localhost"><div class="form-hint">% = any host (remote access)</div></div>
    </div>
    <div class="form-group"><label class="form-label">Password *</label><input type="text" id="newuser-pass" class="form-input mono-input" value="${generatePassword()}"></div>
    <div class="form-group"><label class="form-label">Grant all privileges on</label><select id="newuser-db" class="form-select"><option value="">(no database yet)</option>${dbOptions}</select></div>
  `, {
    submitText: 'Create User',
    onSubmit: async () => {
      await api.createDbUser({
        user: document.getElementById('newuser-name').value.trim(),
        host: document.getElementById('newuser-host').value.trim() || 'localhost',
        password: document.getElementById('newuser-pass').value,
        database: document.getElementById('newuser-db').value || undefined
      });
      toast.success('User created', '');
      await dbLoadOverview();
      dbSwitchTab('users');
    }
  });
}

async function dbShowGrants(user, host) {
  try {
    const { grants } = await api.getDbUserGrants(user, host);
    const u = dbState.users.find(x => x.user === user && x.host === host);
    const dbOptions = dbState.databases.filter(d => !d.system).map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('');
    Modal.show(`Privileges — ${escapeHtml(user)}@${escapeHtml(host)}`, `
      <pre class="job-output" style="min-height:0;max-height:220px;margin-bottom:16px;">${escapeHtml(grants.join('\n'))}</pre>
      ${u?.system ? '' : `
        <div class="form-group">
          <label class="form-label">Grant full access to a database</label>
          <div style="display:flex;gap:8px;"><select id="grant-db" class="form-select">${dbOptions}</select><button class="btn btn-primary" onclick="dbGrant(${jsArg(user)}, ${jsArg(host)})">Grant</button></div>
        </div>
        ${u?.databases.length ? `<div class="form-group"><label class="form-label">Revoke access</label>${u.databases.map(db => `<button class="btn btn-sm btn-danger" style="margin:0 6px 6px 0;" onclick="dbRevoke(${jsArg(user)}, ${jsArg(host)}, ${jsArg(db)})">${escapeHtml(db)} ×</button>`).join('')}</div>` : ''}`}
    `, { width: 680 });
  } catch (err) {
    toast.error('Failed', err.message);
  }
}

async function dbGrant(user, host) {
  const db = document.getElementById('grant-db')?.value;
  if (!db) return;
  try {
    await api.grantDbUser(user, host, db, 'ALL');
    toast.success('Granted', `${user} → ${db}`);
    Modal.closeAll();
    await dbLoadOverview();
    dbSwitchTab('users');
  } catch (err) {
    toast.error('Failed', err.message);
  }
}

async function dbRevoke(user, host, db) {
  try {
    await api.revokeDbUser(user, host, db);
    toast.success('Revoked', `${user} × ${db}`);
    Modal.closeAll();
    await dbLoadOverview();
    dbSwitchTab('users');
  } catch (err) {
    toast.error('Failed', err.message);
  }
}

function dbChangePassword(user, host) {
  Modal.show(`Change password — ${escapeHtml(user)}@${escapeHtml(host)}`, `
    <div class="form-group"><label class="form-label">New password</label><input type="text" id="dbpw-new" class="form-input mono-input" value="${generatePassword()}"></div>
    <div class="form-hint">Remember to update the application's config with the new password.</div>
  `, {
    submitText: 'Change Password',
    onSubmit: async () => {
      await api.setDbUserPassword(user, host, document.getElementById('dbpw-new').value);
      toast.success('Password changed', user);
    }
  });
}

function dbDropUser(user, host) {
  Modal.confirm('Delete database user', `Delete <strong>${escapeHtml(user)}@${escapeHtml(host)}</strong>? Applications using it will lose database access.`, async () => {
    await api.dropDbUser(user, host);
    toast.success('User deleted', user);
    await dbLoadOverview();
    dbSwitchTab('users');
  });
}

function dbDrop(name) {
  Modal.show('Drop database', `
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">This permanently deletes <strong>${escapeHtml(name)}</strong> and all its tables. Download an export first if you might need it.</p>
    <div class="form-group"><label class="form-label">Type the database name to confirm</label><input type="text" id="drop-confirm" class="form-input mono-input"></div>
  `, {
    submitText: 'Drop Database',
    submitClass: 'btn-danger-solid',
    onSubmit: async () => {
      if (document.getElementById('drop-confirm').value !== name) throw new Error('Name does not match');
      await api.dropDatabase(name);
      toast.success('Database dropped', name);
      await dbLoadOverview();
      dbSwitchTab('databases');
    }
  });
}

function dbImport(name) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.sql,.gz,.zip';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    toast.info('Uploading…', `${file.name} (${formatBytes(file.size)})`);
    try {
      const res = await api.importDb(name, file);
      JobConsole.open(res.jobId, `Import ${file.name} → ${name}`, { onDone: dbLoadOverview });
    } catch (err) {
      toast.error('Import failed', err.message);
    }
  };
  input.click();
}

// ── Browse ──────────────────────────────────────────────────

function dbBrowse(db) {
  dbState.browse = { db, table: null, page: 1, view: 'data' };
  dbSwitchTab('browse');
}

async function dbRenderBrowse(el) {
  const I = window.Icons;
  const b = dbState.browse;
  const dbOptions = dbState.databases.map(d => `<option value="${escapeHtml(d.name)}" ${b?.db === d.name ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:260px 1fr;gap:16px;align-items:start;">
      <div class="card">
        <div class="card-body" style="padding:12px;">
          <select class="form-select" onchange="dbBrowse(this.value)"><option value="">Select database…</option>${dbOptions}</select>
          <div id="db-table-list" style="margin-top:10px;max-height:60vh;overflow:auto;"></div>
        </div>
      </div>
      <div id="db-table-view">${b?.table ? '' : `<div class="empty-state"><div class="empty-state-icon">${I.get('table', { size: 20 })}</div><div class="empty-state-title">Pick a table</div></div>`}</div>
    </div>`;
  if (!b?.db) return;
  try {
    const { tables } = await api.getTables(b.db);
    document.getElementById('db-table-list').innerHTML = tables.length
      ? tables.map(t => `<a class="sidebar-link ${b.table === t.name ? 'active' : ''}" style="cursor:pointer;justify-content:space-between;" onclick="dbOpenTable(${jsArg(t.name)})"><span class="truncate">${escapeHtml(t.name)}</span><span class="muted" style="font-size:11px;">${t.rows}</span></a>`).join('')
      : '<div class="muted" style="font-size:12px;padding:6px;">No tables</div>';
    if (b.table) dbRenderTable();
  } catch (err) {
    document.getElementById('db-table-list').innerHTML = `<div style="color:var(--color-red);font-size:12px;">${escapeHtml(err.message)}</div>`;
  }
}

function dbOpenTable(table) {
  dbState.browse.table = table;
  dbState.browse.page = 1;
  dbState.browse.view = 'data';
  dbRenderBrowse(document.getElementById('db-tab-content'));
}

function dbCell(v) {
  if (v === null) return '<td class="null">NULL</td>';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `<td title="${escapeHtml(s.slice(0, 2000))}">${escapeHtml(s.slice(0, 300))}</td>`;
}

async function dbRenderTable() {
  const I = window.Icons;
  const b = dbState.browse;
  const view = document.getElementById('db-table-view');
  view.innerHTML = '<div class="spinner"></div>';
  const header = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <strong style="font-size:15px;">${escapeHtml(b.db)}.${escapeHtml(b.table)}</strong>
      <div class="tabs" style="margin:0 0 0 12px;border:none;">
        <button class="tab ${b.view === 'data' ? 'active' : ''}" onclick="dbState.browse.view='data'; dbRenderTable()">Data</button>
        <button class="tab ${b.view === 'structure' ? 'active' : ''}" onclick="dbState.browse.view='structure'; dbRenderTable()">Structure</button>
      </div>
      <div style="flex:1;"></div>
      <button class="btn btn-sm btn-secondary" onclick="dbQueryTable()">${I.get('terminal', { size: 12 })}<span>Query</span></button>
    </div>`;
  try {
    if (b.view === 'structure') {
      const { columns, indexes } = await api.getTableStructure(b.db, b.table);
      view.innerHTML = header + `
        <div class="data-grid" style="margin-bottom:16px;"><table>
          <thead><tr><th>Column</th><th>Type</th><th>Null</th><th>Key</th><th>Default</th><th>Extra</th><th>Collation</th></tr></thead>
          <tbody>${columns.map(c => `<tr><td><strong>${escapeHtml(c.Field)}</strong></td><td>${escapeHtml(c.Type)}</td><td>${escapeHtml(c.Null)}</td><td>${escapeHtml(c.Key)}</td>${dbCell(c.Default)}<td>${escapeHtml(c.Extra)}</td>${dbCell(c.Collation)}</tr>`).join('')}</tbody>
        </table></div>
        <div style="font-weight:600;font-size:13px;margin-bottom:8px;">Indexes</div>
        <div class="data-grid"><table>
          <thead><tr><th>Name</th><th>Column</th><th>Unique</th><th>Type</th></tr></thead>
          <tbody>${indexes.map(x => `<tr><td>${escapeHtml(x.Key_name)}</td><td>${escapeHtml(x.Column_name)}</td><td>${x.Non_unique === 0 || x.Non_unique === '0' ? 'yes' : 'no'}</td><td>${escapeHtml(x.Index_type)}</td></tr>`).join('') || '<tr><td colspan="4" class="null">none</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    const res = await api.getTableRows(b.db, b.table, b.page, 50);
    const pages = Math.max(1, Math.ceil(res.total / res.perPage));
    view.innerHTML = header + `
      <div class="data-grid"><table>
        <thead><tr>${res.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${res.rows.map(r => `<tr>${r.map(dbCell).join('')}</tr>`).join('') || `<tr><td colspan="${res.columns.length}" class="null">No rows</td></tr>`}</tbody>
      </table></div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px;font-size:12px;color:var(--text-secondary);">
        <button class="btn btn-sm btn-secondary" ${b.page <= 1 ? 'disabled' : ''} onclick="dbState.browse.page--; dbRenderTable()">${I.get('arrowLeft', { size: 12 })}</button>
        <span>Page ${b.page} of ${pages} · ${res.exact ? '' : '~'}${res.total.toLocaleString()} rows</span>
        <button class="btn btn-sm btn-secondary" ${b.page >= pages ? 'disabled' : ''} onclick="dbState.browse.page++; dbRenderTable()">${I.get('arrowRight', { size: 12 })}</button>
      </div>`;
  } catch (err) {
    view.innerHTML = header + `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

function dbQueryTable() {
  const b = dbState.browse;
  dbState.consoleDb = b.db;
  dbState.consoleSql = `SELECT * FROM \`${b.table.replace(/`/g, '``')}\` LIMIT 100;`;
  dbSwitchTab('console');
}

// ── SQL console ─────────────────────────────────────────────

function dbRenderConsole(el) {
  const I = window.Icons;
  const dbOptions = dbState.databases.map(d => `<option value="${escapeHtml(d.name)}" ${dbState.consoleDb === d.name ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-body">
        <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;">
          <select id="sql-db" class="form-select" style="max-width:260px;" onchange="dbState.consoleDb=this.value"><option value="">(no default database)</option>${dbOptions}</select>
          <div style="flex:1;"></div>
          <span class="form-hint">Ctrl/Cmd + Enter to run · max 1000 rows per result</span>
          <button class="btn btn-primary" onclick="dbRunSql()">${I.get('play', { size: 13, color: '#fff' })}<span>Run</span></button>
        </div>
        <textarea id="sql-input" class="form-textarea mono-input" rows="8" spellcheck="false" placeholder="SELECT * FROM users LIMIT 10;">${escapeHtml(dbState.consoleSql || '')}</textarea>
      </div>
    </div>
    <div id="sql-results"></div>`;
  const ta = document.getElementById('sql-input');
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); dbRunSql(); }
  });
  ta.addEventListener('input', () => { dbState.consoleSql = ta.value; });
  ta.focus();
}

async function dbRunSql() {
  const sql = document.getElementById('sql-input').value;
  const out = document.getElementById('sql-results');
  if (!sql.trim()) return;
  out.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await api.runQuery(sql, document.getElementById('sql-db').value || undefined);
    out.innerHTML = `<div class="form-hint" style="margin-bottom:8px;">${res.results.length} result(s) in ${res.duration} ms${res.truncated ? ' — output truncated to 1000 rows' : ''}</div>` +
      (res.results.map(r => r.type === 'ok'
        ? `<div class="alert alert-success" style="margin-bottom:12px;">Query OK — ${r.affectedRows} row(s) affected${r.insertId ? `, insert id ${r.insertId}` : ''}${r.info ? ` · ${escapeHtml(r.info)}` : ''}</div>`
        : `<div class="data-grid" style="margin-bottom:12px;"><table><thead><tr>${r.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${r.rows.map(row => `<tr>${row.map(dbCell).join('')}</tr>`).join('') || `<tr><td colspan="${r.columns.length}" class="null">Empty set</td></tr>`}</tbody></table></div>`
      ).join('') || '<div class="alert alert-success">Query OK</div>');
    if (/^\s*(create|drop|alter|rename)\s/i.test(sql)) dbLoadOverview();
  } catch (err) {
    out.innerHTML = `<div class="alert alert-danger" style="font-family:var(--font-mono);font-size:12px;">${escapeHtml(err.message)}</div>`;
  }
}

window.renderDatabases = renderDatabases;
