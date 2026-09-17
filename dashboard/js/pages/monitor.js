/**
 * Server Resource Monitor Page
 * Clean white theme with vector icons and deep black text
 */
let monitorInterval = null;

function renderMonitor(container) {
  const I = window.Icons;

  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Resource Monitor</h2>
          <p>Live hardware telemetry, memory, disk usage, and process inspection</p>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:#fafafa;font-size:12px;">
            <span class="badge-dot" style="background:var(--color-green);"></span>
            <span id="monitor-live-badge" style="color:var(--text-secondary);font-weight:500;">Live (3s)</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="loadMonitorStats()">
            ${I.get('refresh', { size: 12 })}
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- Live Resource Metrics Cards -->
      <div class="stats-grid" style="margin-bottom:24px;">
        <!-- CPU -->
        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">CPU Utilization</span>
            <div class="stat-icon-wrapper">
              ${I.get('cpu', { size: 16 })}
            </div>
          </div>
          <div class="stat-value" id="mon-cpu">—%</div>
          <div class="progress-bar">
            <div class="progress-bar-fill" id="mon-cpu-bar" style="width:0%;"></div>
          </div>
          <div class="stat-footer" id="mon-cpu-cores">Loading cores...</div>
        </div>

        <!-- RAM -->
        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Memory (RAM)</span>
            <div class="stat-icon-wrapper">
              ${I.get('activity', { size: 16 })}
            </div>
          </div>
          <div class="stat-value" id="mon-mem">—%</div>
          <div class="progress-bar">
            <div class="progress-bar-fill" id="mon-mem-bar" style="width:0%;"></div>
          </div>
          <div class="stat-footer" id="mon-mem-usage">— / — GB</div>
        </div>

        <!-- Disk -->
        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">Disk Storage</span>
            <div class="stat-icon-wrapper">
              ${I.get('hardDrive', { size: 16 })}
            </div>
          </div>
          <div class="stat-value" id="mon-disk">—%</div>
          <div class="progress-bar">
            <div class="progress-bar-fill" id="mon-disk-bar" style="width:0%;"></div>
          </div>
          <div class="stat-footer" id="mon-disk-usage">— / — GB</div>
        </div>

        <!-- System -->
        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-title">System Uptime</span>
            <div class="stat-icon-wrapper">
              ${I.get('clock', { size: 16 })}
            </div>
          </div>
          <div class="stat-value" id="mon-uptime" style="font-size:22px;">—</div>
          <div style="height:8px;"></div>
          <div class="stat-footer" id="mon-os-info">Linux VPS</div>
        </div>
      </div>

      <!-- System Details & Network -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:20px;margin-bottom:24px;">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">
              ${I.get('server', { size: 16 })}
              <span>System & Hardware Profile</span>
            </h3>
          </div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:12px;font-size:13px;">
            <div style="display:flex;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid var(--border-secondary);">
              <span style="color:var(--text-secondary);">Server Hostname</span>
              <span style="font-weight:600;font-family:var(--font-mono);" id="mon-hostname">—</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid var(--border-secondary);">
              <span style="color:var(--text-secondary);">Operating System</span>
              <span style="font-weight:500;" id="mon-os">—</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid var(--border-secondary);">
              <span style="color:var(--text-secondary);">Architecture & Cores</span>
              <span style="font-weight:500;" id="mon-kernel">—</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-secondary);">Load Average (1m, 5m, 15m)</span>
              <span style="font-family:var(--font-mono);font-weight:700;" id="mon-load">—</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">
              ${I.get('globe', { size: 16 })}
              <span>Network Interfaces & I/O</span>
            </h3>
          </div>
          <div class="card-body" id="mon-network-area">
            <div style="text-align:center;padding:24px;"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Process Table -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get('terminal', { size: 16 })}
            <span>Top Active Server Processes</span>
          </h3>
          <span class="badge badge-neutral">Top 15 by Memory/CPU</span>
        </div>
        <div class="table-container" style="border:none;border-radius:0;">
          <table class="table">
            <thead>
              <tr>
                <th style="width:80px;">PID</th>
                <th>Process Command</th>
                <th>User</th>
                <th>CPU %</th>
                <th>MEM %</th>
              </tr>
            </thead>
            <tbody id="mon-processes-tbody">
              <tr>
                <td colspan="5" style="text-align:center;padding:30px;">
                  <div class="spinner spinner-lg" style="margin:0 auto 8px;"></div>
                  <div style="color:var(--text-tertiary);font-size:13px;">Reading process table...</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Start polling
  loadMonitorStats();
  if (monitorInterval) clearInterval(monitorInterval);
  monitorInterval = setInterval(loadMonitorStats, 3000);
}

// Clean up interval when user changes page
window.addEventListener('hashchange', () => {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
});

async function loadMonitorStats() {
  const cpuEl = document.getElementById('mon-cpu');
  if (!cpuEl) {
    if (monitorInterval) clearInterval(monitorInterval);
    return;
  }

  try {
    const [stats, procRes] = await Promise.all([
      api.getStats(),
      api.getProcesses(15).catch(() => ({ processes: [] }))
    ]);

    // Update CPU
    const cpuPercent = stats.cpu?.percent !== undefined ? stats.cpu.percent : (stats.cpu?.load?.[0] ? Math.round(stats.cpu.load[0] * 10) : 0);
    cpuEl.textContent = `${cpuPercent}%`;
    const cpuBar = document.getElementById('mon-cpu-bar');
    if (cpuBar) {
      cpuBar.style.width = `${Math.min(cpuPercent, 100)}%`;
      cpuBar.className = `progress-bar-fill ${cpuPercent > 80 ? 'danger' : cpuPercent > 60 ? 'warning' : ''}`;
    }
    const cpuCores = document.getElementById('mon-cpu-cores');
    if (cpuCores) cpuCores.textContent = `${stats.cpu?.cores || 1} CPU Cores | ${stats.hostname || 'VPS'}`;

    // Update Memory
    if (stats.memory) {
      const memPercent = Math.round(stats.memory.percent || 0);
      const memEl = document.getElementById('mon-mem');
      if (memEl) memEl.textContent = `${memPercent}%`;
      const memBar = document.getElementById('mon-mem-bar');
      if (memBar) {
        memBar.style.width = `${Math.min(memPercent, 100)}%`;
        memBar.className = `progress-bar-fill ${memPercent > 85 ? 'danger' : memPercent > 70 ? 'warning' : ''}`;
      }
      const memUsage = document.getElementById('mon-mem-usage');
      if (memUsage) memUsage.textContent = `${stats.memory.usedHuman || '0 B'} / ${stats.memory.totalHuman || '—'}`;
    }

    // Update Disk
    if (stats.disk) {
      const diskPercent = Math.round(stats.disk.percent || 0);
      const diskEl = document.getElementById('mon-disk');
      if (diskEl) diskEl.textContent = `${diskPercent}%`;
      const diskBar = document.getElementById('mon-disk-bar');
      if (diskBar) {
        diskBar.style.width = `${Math.min(diskPercent, 100)}%`;
        diskBar.className = `progress-bar-fill ${diskPercent > 85 ? 'danger' : ''}`;
      }
      const diskUsage = document.getElementById('mon-disk-usage');
      if (diskUsage) diskUsage.textContent = `${stats.disk.usedHuman || '0 B'} / ${stats.disk.totalHuman || '—'}`;
    }

    // Update Uptime & System info
    const uptimeEl = document.getElementById('mon-uptime');
    if (uptimeEl) {
      uptimeEl.textContent = stats.uptime?.human || '—';
    }
    const hostEl = document.getElementById('mon-hostname');
    if (hostEl) hostEl.textContent = stats.hostname || 'localhost';
    const osEl = document.getElementById('mon-os');
    if (osEl) osEl.textContent = stats.os || 'Linux VPS';
    const kernelEl = document.getElementById('mon-kernel');
    if (kernelEl) kernelEl.textContent = `${stats.cpu?.cores || 1} Cores (${stats.arch || 'x64'})`;
    const loadEl = document.getElementById('mon-load');
    if (loadEl && stats.cpu?.load) {
      loadEl.textContent = Array.isArray(stats.cpu.load) ? stats.cpu.load.map(l => Number(l).toFixed(2)).join(', ') : String(stats.cpu.load);
    }

    // Update Network
    const netArea = document.getElementById('mon-network-area');
    if (netArea && stats.network) {
      const ifaces = Array.isArray(stats.network) ? stats.network : [stats.network];
      netArea.innerHTML = ifaces.slice(0, 3).map(iface => `
        <div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border-secondary);">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
            <span style="font-weight:600;color:var(--text-primary);">${escapeHtml(iface.iface || 'eth0')}</span>
            <span style="color:var(--text-secondary);font-family:var(--font-mono);">TX: ${formatBytes(iface.tx_sec || 0)}/s | RX: ${formatBytes(iface.rx_sec || 0)}/s</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-tertiary);">
            <span>Sent: ${formatBytes(iface.tx_bytes || 0)}</span>
            <span>Recv: ${formatBytes(iface.rx_bytes || 0)}</span>
          </div>
        </div>
      `).join('') || '<div style="color:var(--text-tertiary);font-size:12px;">Network telemetry active</div>';
    }

    // Update Processes
    const procTbody = document.getElementById('mon-processes-tbody');
    if (procTbody) {
      const list = procRes.processes?.list || procRes.processes || [];
      if (list.length === 0) {
        procTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:20px;">No process list available</td></tr>`;
      } else {
        procTbody.innerHTML = list.slice(0, 15).map(proc => `
          <tr>
            <td><code>${proc.pid}</code></td>
            <td><strong style="font-size:12px;">${escapeHtml(proc.name || proc.command || 'unknown')}</strong></td>
            <td><span style="color:var(--text-secondary);font-size:12px;">${escapeHtml(proc.user || 'root')}</span></td>
            <td><span class="badge ${proc.cpu > 50 ? 'badge-danger' : 'badge-neutral'}">${(proc.cpu || 0).toFixed(1)}%</span></td>
            <td><span class="badge ${proc.mem > 50 ? 'badge-danger' : 'badge-neutral'}">${(proc.mem || 0).toFixed(1)}%</span></td>
          </tr>
        `).join('');
      }
    }

  } catch (err) {
    console.error('Monitor poll error:', err);
  }
}

window.renderMonitor = renderMonitor;
