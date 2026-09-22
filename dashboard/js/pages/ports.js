/**
 * Ports & Processes — every listening port, its process, and the project/site/service it belongs to
 */
let portsState = { data: null, filter: 'all', search: '' };

const OWNER_STYLE = {
  project: { icon: 'package', cls: 'owner-project', prefix: 'Project' },
  pm2: { icon: 'rocket', cls: 'owner-project', prefix: 'PM2' },
  docker: { icon: 'box', cls: 'owner-docker', prefix: 'Docker' },
  sites: { icon: 'globe', cls: 'owner-site', prefix: 'nginx' },
  proxied: { icon: 'globe', cls: 'owner-site', prefix: 'Site' },
  service: { icon: 'settings', cls: 'owner-service', prefix: 'Service' },
  panel: { icon: 'shield', cls: 'owner-panel', prefix: '' }
};
const CRITICAL_UNITS = ['ssh.service', 'sshd.service', 'vps-backup-manager.service'];

function renderPorts(container) {
  const I = window.Icons;
  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Ports & Processes</h2>
          <p>Everything listening on this server — and which project, website or service is behind each port</p>
        </div>
        <button class="btn btn-secondary" onclick="loadPorts()">${I.get('refresh', { size: 13 })}<span>Refresh</span></button>
      </div>

      <div class="stats-grid" id="ports-stats"></div>

      <div class="card">
        <div class="fm-toolbar" style="background:#fff;">
          <div class="chip-group" id="ports-filters">
            ${[['all', 'All'], ['public', 'Public'], ['local', 'Local only'], ['tcp', 'TCP'], ['udp', 'UDP']].map(([k, l]) => `<button class="chip ${portsState.filter === k ? 'active' : ''}" data-filter="${k}" onclick="setPortsFilter('${k}')">${l}</button>`).join('')}
          </div>
          <div style="flex:1;"></div>
          <input type="text" class="form-input" id="ports-search" placeholder="Search port, process, project…" style="max-width:280px;" oninput="portsState.search=this.value.toLowerCase(); renderPortsTable()" value="${escapeHtml(portsState.search)}">
        </div>
        <div class="table-container" style="border:none;border-radius:0;">
          <table class="table">
            <thead>
              <tr>
                <th style="width:120px;">Port</th>
                <th style="width:170px;">Exposure</th>
                <th>Process</th>
                <th>Belongs to</th>
                <th>Command</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody id="ports-body"><tr><td colspan="6" style="text-align:center;padding:30px;"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>
      <div class="form-hint" style="margin-top:10px;">“Public” means the port accepts connections from outside (bound to all interfaces). With UFW active, blocked public ports are still unreachable from the internet — except Docker-published ports, which bypass UFW.</div>
    </div>
  `;
  loadPorts();
}

async function loadPorts() {
  const body = document.getElementById('ports-body');
  if (!body) return;
  try {
    portsState.data = await api.getPorts();
    renderPortsStats();
    renderPortsTable();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" style="color:var(--color-red);padding:20px;">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderPortsStats() {
  const I = window.Icons;
  const { ports, firewallActive } = portsState.data;
  const tcp = ports.filter(p => p.proto.startsWith('tcp'));
  const exposed = tcp.filter(p => p.exposure === 'public' && ['allowed', 'none', 'docker'].includes(p.firewall));
  const unknown = tcp.filter(p => !p.owners.length && !p.label);
  const stat = (title, value, footer, icon, color) => `
    <div class="stat-card">
      <div class="stat-header"><span class="stat-title">${title}</span><div class="stat-icon-wrapper">${I.get(icon, { size: 16, color: color || 'currentColor' })}</div></div>
      <div class="stat-value">${value}</div>
      <div class="stat-footer">${footer}</div>
    </div>`;
  document.getElementById('ports-stats').innerHTML = [
    stat('Listening (TCP)', tcp.length, `${ports.length - tcp.length} UDP sockets`, 'activity'),
    stat('Reachable from internet', exposed.length, exposed.map(p => p.port).slice(0, 8).join(', ') || 'none', 'globe', exposed.length ? 'var(--color-amber)' : 'var(--color-green)'),
    stat('Local only', tcp.filter(p => p.exposure === 'local').length, 'Bound to 127.0.0.1 / ::1', 'lock', 'var(--color-green)'),
    stat('Firewall (UFW)', firewallActive ? 'Active' : 'Off', firewallActive ? 'Unlisted ports are blocked' : 'All public ports are open', 'shieldCheck', firewallActive ? 'var(--color-green)' : 'var(--color-red)'),
    unknown.length ? stat('Unidentified', unknown.length, 'Ports with no known owner', 'alertTriangle', 'var(--color-amber)') : ''
  ].join('');
}

function setPortsFilter(filter) {
  portsState.filter = filter;
  document.querySelectorAll('#ports-filters .chip').forEach(c => c.classList.toggle('active', c.dataset.filter === filter));
  renderPortsTable();
}

function portOwnerChips(port) {
  const I = window.Icons;
  if (!port.owners.length) return port.label ? `<span class="muted">${escapeHtml(port.label)}</span>` : '<span class="badge badge-warning">Unknown</span>';
  return port.owners.map(o => {
    const s = OWNER_STYLE[o.type] || OWNER_STYLE.service;
    const title = o.type === 'panel' ? 'VPS Panel (this dashboard)' : `${s.prefix}: ${o.name}`;
    const click = o.type === 'project' ? ` onclick="window.app.navigate('projects')" style="cursor:pointer;"` : o.type === 'sites' || o.type === 'proxied' ? ` onclick="window.app.navigate('websites')" style="cursor:pointer;"` : '';
    return `<span class="owner-chip ${s.cls}" title="${escapeHtml(o.detail ? `${title} — ${o.detail}` : title)}"${click}>${I.get(s.icon, { size: 11 })}<span>${escapeHtml(o.type === 'panel' ? 'VPS Panel' : o.type === 'sites' ? `nginx: ${o.detail}` : o.type === 'proxied' ? `${o.name} (via nginx)` : `${s.prefix ? s.prefix + ': ' : ''}${o.name}`)}</span></span>`;
  }).join('');
}

function portExposure(port) {
  const addr = escapeHtml(port.addresses.join(', '));
  if (port.exposure === 'local') return `<span class="badge badge-success" title="${addr}">${window.Icons.get('lock', { size: 11 })} Local only</span>`;
  const fw = {
    allowed: '<span class="fw-note" style="color:var(--color-amber);">UFW: allowed</span>',
    blocked: '<span class="fw-note" style="color:var(--color-green);">UFW: blocked</span>',
    docker: '<span class="fw-note" style="color:var(--color-amber);">Docker (bypasses UFW)</span>',
    none: '<span class="fw-note" style="color:var(--color-red);">No firewall</span>'
  }[port.firewall] || '';
  return `<span class="badge badge-warning" title="${addr}">${window.Icons.get('globe', { size: 11 })} Public</span>${fw}`;
}

function renderPortsTable() {
  const I = window.Icons;
  const body = document.getElementById('ports-body');
  if (!body || !portsState.data) return;
  const q = portsState.search;
  const rows = portsState.data.ports.filter(p => {
    const f = portsState.filter;
    if (f === 'public' && p.exposure !== 'public') return false;
    if (f === 'local' && p.exposure !== 'local') return false;
    if (f === 'tcp' && !p.proto.startsWith('tcp')) return false;
    if (f === 'udp' && !p.proto.startsWith('udp')) return false;
    if (!q) return true;
    const hay = [p.port, p.label, ...p.processes.map(x => `${x.name} ${x.cmdline} ${x.unit || ''}`), ...p.owners.map(o => `${o.name} ${o.detail}`)].join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="muted" style="padding:24px;text-align:center;">No ports match this filter.</td></tr>';
    return;
  }

  body.innerHTML = rows.map(p => {
    const proc = p.processes[0];
    const httpish = p.proto.startsWith('tcp') && p.exposure === 'public' && ![22, 25, 465, 587, 993, 995, 110, 143, 3306, 5432, 6379].includes(p.port);
    const url = `${p.port === 443 ? 'https' : 'http'}://${location.hostname}${[80, 443].includes(p.port) ? '' : `:${p.port}`}`;
    const unit = proc?.unit;
    const isPanel = p.owners.some(o => o.type === 'panel');
    return `
      <tr>
        <td>
          <div style="font-family:var(--font-mono);font-size:15px;font-weight:700;">${p.port}</div>
          <div style="display:flex;gap:4px;align-items:center;margin-top:2px;"><span class="badge badge-neutral" style="font-size:10px;">${escapeHtml(p.proto.toUpperCase())}</span>${p.label ? `<span class="muted" style="font-size:11px;">${escapeHtml(p.label)}</span>` : ''}</div>
        </td>
        <td><div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start;">${portExposure(p)}</div></td>
        <td>
          ${proc ? `
            <div style="font-weight:600;">${escapeHtml(proc.name)}</div>
            <div class="muted" style="font-size:11px;">pid ${proc.pid}${proc.user ? ` · ${escapeHtml(proc.user)}` : ''}${proc.rssBytes ? ` · ${formatBytes(proc.rssBytes)}` : ''}${p.workerCount > p.processes.length ? ` · +${p.workerCount - p.processes.length} workers` : ''}</div>`
            : '<span class="muted">—</span>'}
        </td>
        <td><div class="owner-list">${portOwnerChips(p)}</div></td>
        <td style="max-width:320px;">
          ${proc ? `<div class="mono-sm truncate" title="${escapeHtml(proc.cmdline)}">${escapeHtml(proc.cmdline || proc.name)}</div>${proc.cwd && proc.cwd !== '/' ? `<div class="muted truncate" style="font-size:11px;" title="${escapeHtml(proc.cwd)}">in ${escapeHtml(proc.cwd)}</div>` : ''}` : ''}
        </td>
        <td style="text-align:right;white-space:nowrap;">
          ${httpish ? `<a class="btn btn-sm btn-secondary" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open ${escapeHtml(url)}">${I.get('externalLink', { size: 12 })}</a>` : ''}
          ${unit && !CRITICAL_UNITS.includes(unit) && !isPanel ? `<button class="btn btn-sm btn-secondary" onclick="restartPortService(${jsArg(unit)})" title="Restart ${escapeHtml(unit)}">${I.get('refresh', { size: 12 })}</button>` : ''}
          ${proc && !isPanel && proc.name !== 'sshd' ? `<button class="btn btn-sm btn-danger" onclick="stopPortProcess(${proc.pid}, ${jsArg(proc.name)}, ${p.port}, ${jsArg(unit || '')})" title="Stop process">${I.get('power', { size: 12 })}</button>` : ''}
        </td>
      </tr>`;
  }).join('');
}

function stopPortProcess(pid, name, port, unit) {
  Modal.show(`Stop ${escapeHtml(name)} (pid ${pid})?`, `
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">This frees port <strong>${port}</strong>. ${unit ? `It is managed by <code>${escapeHtml(unit)}</code>, which may start it again automatically — use restart instead if you just want to reload it.` : 'Projects managed by PM2 are restarted automatically by PM2 — stop them from the Deploy page instead.'}</p>
    <label class="form-check"><input type="checkbox" id="kill-force"><span style="font-size:13px;">Force kill (SIGKILL) — only if it ignores a normal stop</span></label>
  `, {
    submitText: 'Stop Process',
    submitClass: 'btn-danger-solid',
    onSubmit: async () => {
      await api.killProcess(pid, document.getElementById('kill-force').checked ? 'KILL' : 'TERM');
      toast.success('Signal sent', `${name} (pid ${pid})`);
      setTimeout(loadPorts, 800);
    }
  });
}

async function restartPortService(unit) {
  try {
    toast.info('Restarting…', unit);
    await api.restartService(unit);
    toast.success('Restarted', unit);
  } catch (err) {
    toast.error('Restart failed', err.message);
  }
  setTimeout(loadPorts, 800);
}

window.renderPorts = renderPorts;
