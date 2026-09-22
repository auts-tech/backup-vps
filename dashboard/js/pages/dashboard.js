/**
 * Dashboard (Overview) page
 * Clean white background with full black text and vector icons
 */
function renderDashboard(container) {
  const I = window.Icons;

  container.innerHTML = `
    <div>
      <!-- Stat Cards -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Total Projects</span>
            <div class="stat-icon-wrapper">
              ${I.get('package', { size: 16 })}
            </div>
          </div>
          <div class="stat-value" id="dash-project-count">—</div>
          <div class="stat-footer">Registered applications</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Last Backup</span>
            <div class="stat-icon-wrapper">
              ${I.get('checkCircle', { size: 16, color: 'var(--color-green)' })}
            </div>
          </div>
          <div class="stat-value" id="dash-last-backup" style="font-size:20px;">—</div>
          <div class="stat-footer">Latest snapshot status</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Disk Usage</span>
            <div class="stat-icon-wrapper">
              ${I.get('hardDrive', { size: 16 })}
            </div>
          </div>
          <div class="stat-value" id="dash-disk-usage">—</div>
          <div class="stat-footer">Storage capacity used</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">System Uptime</span>
            <div class="stat-icon-wrapper">
              ${I.get('clock', { size: 16 })}
            </div>
          </div>
          <div class="stat-value" id="dash-uptime" style="font-size:20px;">—</div>
          <div class="stat-footer">Continuous server run time</div>
        </div>
      </div>

      <!-- cPanel-style tools -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get('grid', { size: 16 })}
            <span>Hosting Tools</span>
          </h3>
        </div>
        <div class="card-body">
          ${renderToolGroups()}
        </div>
      </div>

      <!-- Quick Actions Bar -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get('zap', { size: 16 })}
            <span>Quick Actions</span>
          </h3>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;padding:16px;">
          <button class="btn btn-secondary" onclick="window.app.navigate('backups'); setTimeout(() => document.getElementById('backup-all-btn')?.click(), 100)" style="justify-content:flex-start;padding:12px 16px;height:auto;">
            <div style="width:32px;height:32px;border-radius:6px;background:#f4f4f5;display:flex;align-items:center;justify-content:center;margin-right:10px;flex-shrink:0;">
              ${I.get('database', { size: 16 })}
            </div>
            <div style="text-align:left;">
              <div style="font-weight:600;color:var(--text-primary);">Backup All</div>
              <div style="font-size:11px;color:var(--text-tertiary);">Backup all projects now</div>
            </div>
          </button>

          <button class="btn btn-secondary" onclick="window.app.navigate('projects')" style="justify-content:flex-start;padding:12px 16px;height:auto;">
            <div style="width:32px;height:32px;border-radius:6px;background:#f4f4f5;display:flex;align-items:center;justify-content:center;margin-right:10px;flex-shrink:0;">
              ${I.get('plus', { size: 16 })}
            </div>
            <div style="text-align:left;">
              <div style="font-weight:600;color:var(--text-primary);">Add Project</div>
              <div style="font-size:11px;color:var(--text-tertiary);">Register new app</div>
            </div>
          </button>

          <button class="btn btn-secondary" onclick="window.app.navigate('deploy')" style="justify-content:flex-start;padding:12px 16px;height:auto;">
            <div style="width:32px;height:32px;border-radius:6px;background:#f4f4f5;display:flex;align-items:center;justify-content:center;margin-right:10px;flex-shrink:0;">
              ${I.get('rocket', { size: 16 })}
            </div>
            <div style="text-align:left;">
              <div style="font-weight:600;color:var(--text-primary);">Deploy Git</div>
              <div style="font-size:11px;color:var(--text-tertiary);">Pull & restart app</div>
            </div>
          </button>

          <button class="btn btn-secondary" onclick="window.app.navigate('monitor')" style="justify-content:flex-start;padding:12px 16px;height:auto;">
            <div style="width:32px;height:32px;border-radius:6px;background:#f4f4f5;display:flex;align-items:center;justify-content:center;margin-right:10px;flex-shrink:0;">
              ${I.get('activity', { size: 16 })}
            </div>
            <div style="text-align:left;">
              <div style="font-weight:600;color:var(--text-primary);">Monitor</div>
              <div style="font-size:11px;color:var(--text-tertiary);">Live system telemetry</div>
            </div>
          </button>
        </div>
      </div>

      <!-- Two column layout -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(360px, 1fr));gap:20px;">
        <!-- Server Stats -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">
              ${I.get('server', { size: 16 })}
              <span>Server Resources</span>
            </h3>
            <span class="badge badge-success"><span class="badge-dot"></span> Online</span>
          </div>
          <div class="card-body" id="dash-server-stats">
            <div style="text-align:center;padding:24px;"><div class="spinner"></div></div>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">
              ${I.get('fileText', { size: 16 })}
              <span>Recent Activity</span>
            </h3>
            <button class="btn btn-sm btn-secondary" onclick="window.app.navigate('logs')">View All</button>
          </div>
          <div class="card-body" style="padding:0;" id="dash-activity">
            <div style="text-align:center;padding:24px;"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    </div>
  `;

  loadDashboardData();
}

async function loadDashboardData() {
  const I = window.Icons;
  try {
    const { projects } = await api.getProjects();
    const countEl = document.getElementById('dash-project-count');
    if (countEl) countEl.textContent = projects.length;

    const stats = await api.getStats();
    const diskEl = document.getElementById('dash-disk-usage');
    if (diskEl) diskEl.textContent = (stats.disk?.percent || '0') + '%';

    const uptimeEl = document.getElementById('dash-uptime');
    if (uptimeEl) uptimeEl.textContent = stats.uptime?.human || '—';

    // Server stats mini bars
    const statsEl = document.getElementById('dash-server-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:16px;">
          ${renderMiniBar('CPU Load', stats.cpu?.percent || 0)}
          ${renderMiniBar('Memory Usage', stats.memory?.percent || 0, stats.memory?.usedHuman + ' / ' + stats.memory?.totalHuman)}
          ${renderMiniBar('Primary Disk', stats.disk?.percent || 0, stats.disk?.usedHuman + ' / ' + stats.disk?.totalHuman)}
        </div>
        <div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border-primary);display:flex;gap:20px;font-size:12px;color:var(--text-secondary);">
          <div style="display:flex;align-items:center;gap:6px;">
            ${I.get('terminal', { size: 14, color: 'var(--text-tertiary)' })}
            <span><strong>Host:</strong> ${escapeHtml(stats.hostname || 'localhost')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${I.get('server', { size: 14, color: 'var(--text-tertiary)' })}
            <span><strong>OS:</strong> ${escapeHtml(stats.os?.substring(0, 30) || 'Linux')}</span>
          </div>
        </div>
      `;
    }

    // Load recent logs
    const { logs } = await api.getLogs(1, 6);
    const activityEl = document.getElementById('dash-activity');
    if (activityEl) {
      if (logs.length === 0) {
        activityEl.innerHTML = `
          <div class="empty-state" style="padding:32px 20px;">
            <div class="empty-state-icon">${I.get('fileText', { size: 20 })}</div>
            <div class="empty-state-title">No Activity Yet</div>
            <div class="empty-state-desc">Trigger a backup or deployment to see live events.</div>
          </div>
        `;
      } else {
        activityEl.innerHTML = `
          <div style="display:flex;flex-direction:column;">
            ${logs.map(log => {
              const iconType = log.level === 'error' ? 'alertCircle' : log.level === 'warning' ? 'alertTriangle' : 'checkCircle';
              const color = log.level === 'error' ? 'var(--color-red)' : log.level === 'warning' ? 'var(--color-amber)' : 'var(--color-green)';
              return `
                <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 18px;border-bottom:1px solid var(--border-secondary);">
                  <div style="margin-top:2px;">${I.get(iconType, { size: 16, color })}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:500;color:var(--text-primary);word-break:break-word;">${escapeHtml(log.message.substring(0, 90))}</div>
                    <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${escapeHtml(log.timestamp || 'Just now')}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }
    }

    const lastBackupEl = document.getElementById('dash-last-backup');
    if (lastBackupEl) {
      const lastSuccess = logs.find(l => l.level === 'success');
      lastBackupEl.textContent = lastSuccess?.timestamp?.substring(0, 10) || 'Never';
    }

  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

const TOOL_GROUPS = [
  {
    title: 'Domains & Files',
    tools: [
      ['websites', 'globe', 'Websites', 'Domains, nginx sites & reverse proxies'],
      ['websites', 'shieldCheck', 'SSL / HTTPS', 'Free Let\'s Encrypt certificates'],
      ['files', 'folder', 'File Manager', 'Browse, edit, upload & extract'],
      ['backups', 'archive', 'Backups', 'Cloud backups & restores']
    ]
  },
  {
    title: 'Databases & Software',
    tools: [
      ['databases', 'database', 'MySQL Databases', 'Databases, users & privileges'],
      ['databases', 'table', 'Database Browser', 'Tables and SQL console'],
      ['php', 'code', 'PHP Versions', 'Multiple PHP-FPM versions & php.ini'],
      ['deploy', 'rocket', 'Git Deploy', 'Clone, pull & restart apps']
    ]
  },
  {
    title: 'Email',
    tools: [
      ['mail', 'inbox', 'Email Accounts', 'Mailboxes on your domains'],
      ['mail', 'send', 'Forwarders', 'Aliases & forwarding'],
      ['mail', 'key', 'Email Deliverability', 'SPF, DKIM, DMARC & PTR checks']
    ]
  },
  {
    title: 'Advanced',
    tools: [
      ['terminal', 'terminal', 'Terminal', 'Root shell in the browser'],
      ['ports', 'server', 'Ports & Processes', 'Which app runs on which port'],
      ['cron', 'clock', 'Cron Jobs', 'Scheduled tasks'],
      ['monitor', 'activity', 'Resource Monitor', 'CPU, RAM, disk & processes'],
      ['logs', 'fileText', 'Logs', 'Panel & backup activity']
    ]
  }
];

function renderToolGroups() {
  const I = window.Icons;
  return TOOL_GROUPS.map(group => `
    <div class="tool-group">
      <div class="tool-group-title">${group.title}</div>
      <div class="tool-grid">
        ${group.tools.map(([page, icon, name, desc]) => `
          <button class="tool-tile" onclick="window.app.navigate('${page}')">
            <span class="tool-tile-icon">${I.get(icon, { size: 17 })}</span>
            <span>
              <span class="tool-tile-name" style="display:block;">${name}</span>
              <span class="tool-tile-desc" style="display:block;margin-top:2px;">${desc}</span>
            </span>
          </button>`).join('')}
      </div>
    </div>`).join('');
}

function renderMiniBar(label, percent, detail) {
  let barColor = 'var(--accent-black)';
  if (percent > 85) barColor = 'var(--color-red)';
  else if (percent > 70) barColor = 'var(--color-amber)';

  return `
    <div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px;">
        <span style="font-weight:600;color:var(--text-primary);">${label}</span>
        <span style="font-weight:700;color:var(--text-primary);">${percent}%</span>
      </div>
      <div style="height:7px;background:#f4f4f5;border:1px solid var(--border-primary);border-radius:9999px;overflow:hidden;">
        <div style="height:100%;width:${Math.min(percent, 100)}%;background:${barColor};border-radius:9999px;transition:width 0.6s ease;"></div>
      </div>
      ${detail ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">${detail}</div>` : ''}
    </div>
  `;
}

window.renderDashboard = renderDashboard;
