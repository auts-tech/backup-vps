/**
 * Websites page — nginx virtual hosts, PHP version per site, Let's Encrypt SSL
 */
let websitesState = { sites: [], phpVersions: [], status: null, certs: [] };

const SITE_TYPE_INFO = {
  static: { label: 'Static HTML', desc: 'Plain HTML/CSS/JS files' },
  php: { label: 'PHP', desc: 'Any PHP app with index.php front controller' },
  laravel: { label: 'Laravel', desc: 'Serves the project\'s public/ folder' },
  wordpress: { label: 'WordPress', desc: 'Pretty permalinks + hardened uploads' },
  proxy: { label: 'Reverse proxy', desc: 'Node.js / Python / any app on a port' }
};

function renderWebsites(container) {
  const I = window.Icons;
  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Websites & Domains</h2>
          <p>Create nginx sites, choose the PHP version per site, and enable free HTTPS</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-secondary" onclick="nginxTestConfig()">${I.get('checkCircle', { size: 13 })}<span>Test Config</span></button>
          <button class="btn btn-secondary" onclick="nginxAction('reload')">${I.get('refresh', { size: 13 })}<span>Reload Nginx</span></button>
          <button class="btn btn-primary" onclick="showCreateSiteModal()">${I.get('plus', { size: 13, color: '#fff' })}<span>Create Website</span></button>
        </div>
      </div>

      <div id="nginx-status-area" style="margin-bottom:20px;"><div class="spinner"></div></div>

      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">${I.get('globe', { size: 16 })}<span>Sites</span></h3>
          <span class="badge badge-neutral" id="sites-count">0</span>
        </div>
        <div class="table-container" style="border:none;border-radius:0;">
          <table class="table">
            <thead>
              <tr>
                <th style="width:70px;">Enabled</th>
                <th>Domain</th>
                <th>Type</th>
                <th>PHP</th>
                <th>HTTPS</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody id="sites-body"><tr><td colspan="6" style="text-align:center;padding:30px;"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">${I.get('shieldCheck', { size: 16 })}<span>SSL Certificates (Let's Encrypt)</span></h3>
          <button class="btn btn-sm btn-secondary" onclick="JobConsole.run(api.renewCertificates(), 'Renew SSL certificates', { onDone: loadWebsites })">${I.get('refresh', { size: 12 })}<span>Renew All</span></button>
        </div>
        <div class="table-container" style="border:none;border-radius:0;">
          <table class="table">
            <thead><tr><th>Certificate</th><th>Domains</th><th>Expires</th><th style="text-align:right;">Actions</th></tr></thead>
            <tbody id="certs-body"><tr><td colspan="4" class="muted" style="padding:20px;">Loading…</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  loadWebsites();
}

async function loadWebsites() {
  const statusArea = document.getElementById('nginx-status-area');
  if (!statusArea) return;
  const I = window.Icons;
  try {
    const [status, php] = await Promise.all([api.getNginxStatus(), api.getPhp().catch(() => ({ versions: [] }))]);
    websitesState.status = status;
    websitesState.phpVersions = (php.versions || []).filter(v => v.fpmInstalled).map(v => v.version);

    if (!status.installed) {
      statusArea.innerHTML = `
        <div class="alert alert-warning">
          ${I.get('alertTriangle', { size: 16 })}
          <div style="flex:1;"><strong>nginx is not installed.</strong> Install it to host websites on this server.</div>
          <button class="btn btn-sm btn-primary" onclick="JobConsole.run(api.installNginx(), 'Install nginx', { onDone: loadWebsites })">Install nginx</button>
        </div>`;
      document.getElementById('sites-body').innerHTML = '<tr><td colspan="6" class="muted" style="padding:20px;">No sites — nginx is not installed.</td></tr>';
      document.getElementById('certs-body').innerHTML = '<tr><td colspan="4" class="muted" style="padding:20px;">—</td></tr>';
      return;
    }

    statusArea.innerHTML = `
      <div class="card"><div class="card-body status-row" style="padding:12px 18px;">
        <span class="badge ${status.running ? 'badge-success' : 'badge-danger'}"><span class="badge-dot"></span>${status.running ? 'Running' : 'Stopped'}</span>
        <span class="badge badge-neutral">nginx ${escapeHtml(status.version)}</span>
        <span class="badge ${status.configOk ? 'badge-success' : 'badge-danger'}">${status.configOk ? 'Config OK' : 'Config has errors'}</span>
        <span class="badge ${status.certbot ? 'badge-success' : 'badge-neutral'}">${status.certbot ? 'certbot ready' : 'certbot installs on first SSL request'}</span>
        <div style="flex:1;"></div>
        ${status.running
          ? `<button class="btn btn-sm btn-secondary" onclick="nginxAction('restart')">${I.get('refresh', { size: 12 })}<span>Restart</span></button>
             <button class="btn btn-sm btn-danger" onclick="nginxAction('stop')">${I.get('pause', { size: 12 })}<span>Stop</span></button>`
          : `<button class="btn btn-sm btn-primary" onclick="nginxAction('start')">${I.get('play', { size: 12, color: '#fff' })}<span>Start</span></button>`}
      </div></div>
      ${status.configOk ? '' : `<pre class="job-output" style="margin-top:10px;min-height:0;">${escapeHtml(status.configOutput)}</pre>`}
    `;

    const [{ sites }, { certificates }] = await Promise.all([api.getSites(), api.getCertificates()]);
    websitesState.sites = sites;
    websitesState.certs = certificates;
    renderSitesTable();
    renderCertsTable();
  } catch (err) {
    statusArea.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

function renderSitesTable() {
  const I = window.Icons;
  const tbody = document.getElementById('sites-body');
  const sites = websitesState.sites;
  document.getElementById('sites-count').textContent = sites.length;
  if (!sites.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:30px;"><div class="empty-state-icon">${I.get('globe', { size: 20 })}</div><div class="empty-state-title">No websites yet</div><div class="empty-state-desc">Create your first site — static, PHP, Laravel, WordPress or a reverse proxy for a Node app.</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = sites.map(site => {
    const names = site.serverNames.filter(n => n !== '_');
    const primary = names[0] || site.name;
    const target = site.type === 'proxy' ? `→ ${site.proxyPass}` : (site.root || '');
    const phpCell = site.phpVersion
      ? `<select class="form-select" style="width:auto;padding:3px 8px;font-size:12px;" onchange="changeSitePhp(${jsArg(site.name)}, this.value)">
           ${[...new Set([site.phpVersion, ...websitesState.phpVersions])].map(v => `<option value="${v}" ${v === site.phpVersion ? 'selected' : ''}>PHP ${v}</option>`).join('')}
         </select>`
      : '<span class="muted">—</span>';
    const catchAll = names.length === 0;
    let sslCell;
    if (catchAll) {
      sslCell = '<span class="muted" title="Catch-all site without a domain">—</span>';
    } else if (site.ssl) {
      const days = site.sslExpires ? Math.floor((new Date(site.sslExpires) - Date.now()) / 86400000) : null;
      sslCell = `<span class="badge ${days !== null && days < 14 ? 'badge-warning' : 'badge-success'}">${I.get('lock', { size: 11 })} HTTPS${days !== null ? ` · ${days}d` : ''}</span>`;
    } else {
      sslCell = `<button class="btn btn-sm btn-secondary" onclick="showIssueSslModal(${jsArg(site.name)})">${I.get('unlock', { size: 12 })}<span>Enable SSL</span></button>`;
    }
    const url = `${site.ssl ? 'https' : 'http'}://${primary}`;
    return `
      <tr style="${site.enabled ? '' : 'opacity:0.6;'}">
        <td><label class="switch"><input type="checkbox" ${site.enabled ? 'checked' : ''} onchange="toggleSite(${jsArg(site.name)}, this.checked)"><span class="switch-slider"></span></label></td>
        <td style="max-width:340px;">
          <div style="font-weight:600;display:flex;align-items:center;gap:6px;">
            <span class="truncate">${escapeHtml(primary)}</span>
            ${catchAll || primary.includes('*') ? '<span class="badge badge-neutral">catch-all</span>' : `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open site">${I.get('externalLink', { size: 12, color: 'var(--text-tertiary)' })}</a>`}
          </div>
          ${names.length > 1 ? `<div class="muted" style="font-size:11px;">+ ${escapeHtml(names.slice(1).join(', '))}</div>` : ''}
          <div class="mono-sm truncate" title="${escapeHtml(target)}">${escapeHtml(target)}</div>
        </td>
        <td><span class="badge badge-neutral">${escapeHtml(SITE_TYPE_INFO[site.type]?.label || site.type)}</span></td>
        <td>${phpCell}</td>
        <td>${sslCell}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn btn-sm btn-secondary" onclick="editSiteConfig(${jsArg(site.name)})" title="Edit nginx config">${I.get('code', { size: 12 })}<span>Config</span></button>
          ${site.root ? `<button class="btn btn-sm btn-secondary" onclick="openInFileManager(${jsArg(site.root)})" title="Open document root">${I.get('folder', { size: 12 })}</button>` : ''}
          <button class="btn btn-sm btn-secondary" onclick="showSiteLogs(${jsArg(site.name)})" title="Access & error logs">${I.get('fileText', { size: 12 })}</button>
          <button class="btn btn-sm btn-danger" onclick="deleteSite(${jsArg(site.name)})" title="Delete">${I.get('trash', { size: 12 })}</button>
        </td>
      </tr>`;
  }).join('');
}

function renderCertsTable() {
  const I = window.Icons;
  const tbody = document.getElementById('certs-body');
  if (!websitesState.certs.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted" style="padding:20px;">No certificates yet. Use "Enable SSL" on a site.</td></tr>';
    return;
  }
  tbody.innerHTML = websitesState.certs.map(c => `
    <tr>
      <td style="font-weight:600;">${escapeHtml(c.name)}</td>
      <td class="mono-sm">${escapeHtml(c.domains.join(', '))}</td>
      <td><span class="badge ${c.daysLeft < 14 ? 'badge-warning' : 'badge-success'}">${c.daysLeft} days</span> <span class="muted" style="font-size:12px;">${escapeHtml(new Date(c.expires).toLocaleDateString())}</span></td>
      <td style="text-align:right;"><button class="btn btn-sm btn-danger" onclick="deleteCertificate(${jsArg(c.name)})">${I.get('trash', { size: 12 })}</button></td>
    </tr>`).join('');
}

async function nginxAction(action) {
  try {
    await api.nginxControl(action);
    toast.success('nginx', `${action} completed`);
  } catch (err) {
    Modal.show('nginx', `<pre class="job-output">${escapeHtml(err.message)}</pre>`);
  }
  loadWebsites();
}

async function nginxTestConfig() {
  try {
    const res = await api.nginxTest();
    Modal.show(res.ok ? 'Configuration OK' : 'Configuration errors', `<pre class="job-output">${escapeHtml(res.output)}</pre>`);
  } catch (err) {
    toast.error('Failed', err.message);
  }
}

function showCreateSiteModal() {
  if (websitesState.status && !websitesState.status.installed) {
    toast.warning('nginx not installed', 'Install nginx first');
    return;
  }
  const phpOptions = websitesState.phpVersions.map(v => `<option value="${v}">PHP ${v}</option>`).join('');
  Modal.show('Create Website', `
    <div class="form-group">
      <label class="form-label">Domain *</label>
      <input type="text" id="site-domain" class="form-input" placeholder="example.com" oninput="updateSiteRootHint()">
      <label class="form-check" style="margin-top:8px;"><input type="checkbox" id="site-www" checked><span style="font-size:12px;color:var(--text-secondary);">Also answer on www.<span id="site-www-name">example.com</span></span></label>
      <div class="form-hint">Extra domains (space separated): <input type="text" id="site-aliases" class="form-input" style="margin-top:4px;" placeholder="shop.example.com example.net"></div>
    </div>
    <div class="form-group">
      <label class="form-label">Site Type</label>
      <select id="site-type" class="form-select" onchange="updateSiteTypeFields()">
        ${Object.entries(SITE_TYPE_INFO).map(([k, v]) => `<option value="${k}">${v.label} — ${v.desc}</option>`).join('')}
      </select>
    </div>
    <div class="form-group" id="site-root-group">
      <label class="form-label">Document Root</label>
      <input type="text" id="site-root" class="form-input mono-input" placeholder="/var/www/example.com/public_html">
      <div class="form-hint" id="site-root-hint">Created automatically (owned by www-data) if it doesn't exist.</div>
    </div>
    <div class="form-group" id="site-php-group" style="display:none;">
      <label class="form-label">PHP Version</label>
      ${phpOptions
        ? `<select id="site-php" class="form-select">${phpOptions}</select>`
        : `<div class="alert alert-warning" style="font-size:12px;">No PHP-FPM version installed. <a href="#php" style="text-decoration:underline;margin-left:4px;">Install PHP first</a></div><input type="hidden" id="site-php" value="">`}
    </div>
    <div class="form-group" id="site-proxy-group" style="display:none;">
      <label class="form-label">App Port or URL *</label>
      <input type="text" id="site-proxy" class="form-input mono-input" placeholder="3000 or http://127.0.0.1:3000">
      <div class="form-hint">WebSockets and streaming responses are supported.</div>
    </div>
    <div class="form-group">
      <label class="form-label">Max Upload Size</label>
      <input type="text" id="site-body" class="form-input" value="64M" style="max-width:120px;">
    </div>
    <label class="form-check"><input type="checkbox" id="site-ssl"><span style="font-size:13px;">Enable HTTPS right away (DNS must already point to this server)</span></label>
  `, {
    submitText: 'Create Website',
    width: 620,
    onSubmit: async () => {
      const domain = document.getElementById('site-domain').value.trim().toLowerCase();
      if (!domain) throw new Error('Enter a domain');
      const domains = [domain];
      if (document.getElementById('site-www').checked && !domain.startsWith('www.')) domains.push(`www.${domain}`);
      domains.push(...document.getElementById('site-aliases').value.split(/[\s,]+/).filter(Boolean));
      const type = document.getElementById('site-type').value;
      const payload = {
        domains,
        type,
        root: document.getElementById('site-root').value.trim() || undefined,
        phpVersion: document.getElementById('site-php')?.value,
        proxyTarget: document.getElementById('site-proxy').value.trim(),
        maxBodySize: document.getElementById('site-body').value.trim()
      };
      const res = await api.createSite(payload);
      toast.success('Website created', `${domain} is live on HTTP`);
      loadWebsites();
      if (document.getElementById('site-ssl').checked) {
        JobConsole.run(api.issueSsl(res.name, {}), `SSL for ${domain}`, { onDone: loadWebsites });
      }
    }
  });
  updateSiteTypeFields();
}

function updateSiteRootHint() {
  const domain = document.getElementById('site-domain')?.value.trim().toLowerCase() || 'example.com';
  const wwwName = document.getElementById('site-www-name');
  if (wwwName) wwwName.textContent = domain.replace(/^www\./, '');
  const type = document.getElementById('site-type')?.value;
  const root = document.getElementById('site-root');
  if (root) root.placeholder = type === 'laravel' ? `/var/www/${domain}` : `/var/www/${domain}/public_html`;
}

function updateSiteTypeFields() {
  const type = document.getElementById('site-type').value;
  document.getElementById('site-root-group').style.display = type === 'proxy' ? 'none' : 'block';
  document.getElementById('site-php-group').style.display = ['php', 'laravel', 'wordpress'].includes(type) ? 'block' : 'none';
  document.getElementById('site-proxy-group').style.display = type === 'proxy' ? 'block' : 'none';
  document.getElementById('site-root-hint').textContent = type === 'laravel'
    ? 'Laravel project folder — nginx serves its public/ subfolder.'
    : 'Created automatically (owned by www-data) if it doesn\'t exist.';
  updateSiteRootHint();
}

async function toggleSite(name, enabled) {
  try {
    await api.enableSite(name, enabled);
    toast.success(enabled ? 'Site enabled' : 'Site disabled', name);
  } catch (err) {
    Modal.show('Could not change site', `<pre class="job-output">${escapeHtml(err.message)}</pre>`);
  }
  loadWebsites();
}

async function changeSitePhp(name, version) {
  try {
    await api.setSitePhp(name, version);
    toast.success('PHP version changed', `${name} now uses PHP ${version}`);
  } catch (err) {
    Modal.show('Could not switch PHP', `<pre class="job-output">${escapeHtml(err.message)}</pre>`);
  }
  loadWebsites();
}

async function editSiteConfig(name) {
  try {
    const site = await api.getSite(name);
    CodeEditor.open({
      title: `nginx: ${name}`,
      subtitle: `${site.path} — tested with nginx -t before applying; rolled back if invalid`,
      content: site.content,
      mode: 'nginx',
      onSave: async (content) => {
        await api.saveSite(name, content);
        toast.success('Saved & reloaded', name);
        loadWebsites();
      }
    });
  } catch (err) {
    toast.error('Failed', err.message);
  }
}

async function showSiteLogs(name) {
  const load = async (type) => {
    const el = document.getElementById('site-log-output');
    el.textContent = 'Loading…';
    document.querySelectorAll('.site-log-tab').forEach(t => t.classList.toggle('active', t.dataset.type === type));
    try {
      const res = await api.getSiteLogs(name, type);
      el.textContent = res.lines.length ? res.lines.join('\n') : `No entries in ${res.path}`;
      el.scrollTop = el.scrollHeight;
    } catch (err) {
      el.textContent = err.message;
    }
  };
  Modal.show(`Logs: ${escapeHtml(name)}`, `
    <div class="tabs" style="margin-bottom:12px;">
      <button class="tab site-log-tab active" data-type="error">Error log</button>
      <button class="tab site-log-tab" data-type="access">Access log</button>
    </div>
    <pre class="job-output" id="site-log-output" style="max-height:60vh;"></pre>
  `, { width: 1000 });
  document.querySelectorAll('.site-log-tab').forEach(t => t.addEventListener('click', () => load(t.dataset.type)));
  load('error');
}

function showIssueSslModal(name) {
  const site = websitesState.sites.find(s => s.name === name);
  const domains = (site?.serverNames || []).filter(d => d !== '_' && !d.startsWith('*.'));
  Modal.show(`Enable HTTPS — ${escapeHtml(name)}`, `
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">
      A free Let's Encrypt certificate will be issued for the domains below and renewed automatically.
      Each domain's DNS <strong>A record must already point to this server</strong>, and port 80 must be reachable.
    </p>
    <div class="form-group">
      <label class="form-label">Domains</label>
      ${domains.map(d => `<label class="form-check" style="margin-bottom:6px;"><input type="checkbox" class="ssl-domain" value="${escapeHtml(d)}" checked><span class="mono-sm">${escapeHtml(d)}</span></label>`).join('')}
    </div>
    <div class="form-group">
      <label class="form-label">Contact email (expiry notices)</label>
      <input type="email" id="ssl-email" class="form-input" placeholder="you@example.com">
    </div>
    <label class="form-check"><input type="checkbox" id="ssl-redirect" checked><span style="font-size:13px;">Redirect all HTTP traffic to HTTPS</span></label>
  `, {
    submitText: 'Issue Certificate',
    onSubmit: async () => {
      const selected = [...document.querySelectorAll('.ssl-domain:checked')].map(c => c.value);
      if (!selected.length) throw new Error('Select at least one domain');
      const email = document.getElementById('ssl-email').value.trim();
      const redirect = document.getElementById('ssl-redirect').checked;
      JobConsole.run(api.issueSsl(name, { domains: selected, email: email || undefined, redirect }), `SSL for ${selected[0]}`, { onDone: loadWebsites });
    }
  });
}

function deleteSite(name) {
  Modal.confirm('Delete Website', `Remove the nginx site <strong>${escapeHtml(name)}</strong>? Its files and certificate are kept — delete those separately if you no longer need them.`, async () => {
    await api.deleteSite(name);
    toast.success('Site deleted', name);
    loadWebsites();
  });
}

function deleteCertificate(name) {
  Modal.confirm('Delete Certificate', `Delete the certificate <strong>${escapeHtml(name)}</strong>? Sites still referencing it will fail the nginx config test until updated.`, async () => {
    await api.deleteCertificate(name);
    toast.success('Certificate deleted', name);
    loadWebsites();
  });
}

function openInFileManager(path) {
  try { localStorage.setItem('fm_path', path); } catch { }
  window.app.navigate('files');
}

window.renderWebsites = renderWebsites;
window.openInFileManager = openInFileManager;
