/**
 * Dashboard (Overview) page
 */
function renderDashboard(container) {
  container.innerHTML = `
    <div class="animate-in">
      <!-- Stat Cards -->
      <div class="stat-grid">
        <div class="stat-card cyan animate-in stagger-1">
          <div class="stat-card-icon">📦</div>
          <div class="stat-card-value" id="dash-project-count">—</div>
          <div class="stat-card-label">Projects</div>
        </div>
        <div class="stat-card green animate-in stagger-2">
          <div class="stat-card-icon">✅</div>
          <div class="stat-card-value" id="dash-last-backup">—</div>
          <div class="stat-card-label">Last Backup</div>
        </div>
        <div class="stat-card purple animate-in stagger-3">
          <div class="stat-card-icon">💾</div>
          <div class="stat-card-value" id="dash-disk-usage">—</div>
          <div class="stat-card-label">Disk Used</div>
        </div>
        <div class="stat-card orange animate-in stagger-4">
          <div class="stat-card-icon">⏱️</div>
          <div class="stat-card-value" id="dash-uptime">—</div>
          <div class="stat-card-label">Uptime</div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="card mb-6 animate-in stagger-3">
        <div class="card-header">
          <h3 class="card-title">Quick Actions</h3>
        </div>
        <div class="quick-actions">
          <div class="quick-action" onclick="window.app.navigate('backups'); setTimeout(() => document.getElementById('backup-all-btn')?.click(), 100)">
            <div class="quick-action-icon" style="background:rgba(6,182,212,0.1);color:var(--color-cyan)">🚀</div>
            <div>
              <div class="quick-action-text">Backup All</div>
              <div class="quick-action-sub">Backup all projects now</div>
            </div>
          </div>
          <div class="quick-action" onclick="window.app.navigate('projects')">
            <div class="quick-action-icon" style="background:rgba(139,92,246,0.1);color:var(--color-purple)">➕</div>
            <div>
              <div class="quick-action-text">Add Project</div>
              <div class="quick-action-sub">Register a new project</div>
            </div>
          </div>
          <div class="quick-action" onclick="window.app.navigate('deploy')">
            <div class="quick-action-icon" style="background:rgba(16,185,129,0.1);color:var(--color-green)">🔄</div>
            <div>
              <div class="quick-action-text">Deploy</div>
              <div class="quick-action-sub">Clone & deploy a repo</div>
            </div>
          </div>
          <div class="quick-action" onclick="window.app.navigate('monitor')">
            <div class="quick-action-icon" style="background:rgba(249,115,22,0.1);color:var(--color-orange)">📊</div>
            <div>
              <div class="quick-action-text">Monitor</div>
              <div class="quick-action-sub">View server stats</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Two column layout -->
      <div class="grid-2">
        <!-- Server Stats -->
        <div class="card animate-in stagger-4">
          <div class="card-header">
            <h3 class="card-title">Server Resources</h3>
            <span class="badge badge-success"><span class="badge-dot"></span> Online</span>
          </div>
          <div id="dash-server-stats">
            <div class="loading-overlay"><div class="spinner"></div></div>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="card animate-in stagger-5">
          <div class="card-header">
            <h3 class="card-title">Recent Activity</h3>
            <button class="btn btn-sm btn-secondary" onclick="window.app.navigate('logs')">View All</button>
          </div>
          <div id="dash-activity">
            <div class="loading-overlay"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    </div>
  `;

  loadDashboardData();
}

async function loadDashboardData() {
  try {
    // Load projects count
    const { projects } = await api.getProjects();
    document.getElementById('dash-project-count').textContent = projects.length;

    // Load server stats
    const stats = await api.getStats();
    document.getElementById('dash-disk-usage').textContent = stats.disk?.percent + '%' || '—';
    document.getElementById('dash-uptime').textContent = stats.uptime?.human || '—';

    // Server stats mini bars
    const statsEl = document.getElementById('dash-server-stats');
    statsEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:18px;">
        ${renderMiniBar('CPU', stats.cpu?.percent || 0, 'var(--color-cyan)')}
        ${renderMiniBar('Memory', stats.memory?.percent || 0, 'var(--color-purple)', stats.memory?.usedHuman + ' / ' + stats.memory?.totalHuman)}
        ${renderMiniBar('Disk', stats.disk?.percent || 0, stats.disk?.percent > 80 ? 'var(--color-red)' : 'var(--color-green)', stats.disk?.usedHuman + ' / ' + stats.disk?.totalHuman)}
      </div>
      <div style="margin-top:18px;display:flex;gap:16px;font-size:12px;color:var(--text-tertiary);">
        <span>🖥️ ${stats.hostname || 'Unknown'}</span>
        <span>🐧 ${stats.os?.substring(0, 30) || 'Unknown'}</span>
      </div>
    `;

    // Load recent logs
    const { logs } = await api.getLogs(1, 6);
    const activityEl = document.getElementById('dash-activity');
    if (logs.length === 0) {
      activityEl.innerHTML = `
        <div class="empty-state" style="padding:30px 20px;">
          <div class="empty-state-icon">📝</div>
          <div class="empty-state-desc">No activity yet. Trigger a backup to get started.</div>
        </div>
      `;
    } else {
      activityEl.innerHTML = `<div class="activity-list">${logs.map(log => `
        <div class="activity-item">
          <div class="activity-icon ${log.level}">${log.level === 'success' ? '✅' : log.level === 'error' ? '❌' : log.level === 'warning' ? '⚠️' : 'ℹ️'}</div>
          <div class="activity-body">
            <div class="activity-title">${escapeHtml(log.message.substring(0, 80))}</div>
            <div class="activity-time">${log.timestamp || 'Unknown time'}</div>
          </div>
        </div>
      `).join('')}</div>`;
    }

    // Last backup
    document.getElementById('dash-last-backup').textContent = logs.find(l => l.level === 'success')?.timestamp?.substring(0, 10) || 'Never';

  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

function renderMiniBar(label, percent, color, detail) {
  return `
    <div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:12px;font-weight:600;color:var(--text-secondary)">${label}</span>
        <span style="font-size:12px;font-weight:700;color:${color}">${percent}%</span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${percent}%;background:${color};border-radius:3px;transition:width 1s ease;"></div>
      </div>
      ${detail ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:3px;">${detail}</div>` : ''}
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.renderDashboard = renderDashboard;
