/**
 * Server Resource Monitor Page
 */
let monitorInterval = null;

function renderMonitor(container) {
  container.innerHTML = `
    <div class="animate-in">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h2 style="font-size:20px;font-weight:700;">VPS Resource Monitor</h2>
          <p style="font-size:13px;color:var(--text-tertiary);margin-top:4px;">Live hardware metrics, memory, disk usage, and process inspection</p>
        </div>
        <div class="flex items-center gap-3">
          <div class="header-status">
            <span class="header-status-dot"></span>
            <span id="monitor-live-badge" style="font-size:12px;color:var(--text-secondary);">Live (3s)</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="loadMonitorStats()">🔄 Refresh</button>
        </div>
      </div>

      <!-- Live Resource Metrics Cards -->
      <div class="stat-grid mb-6">
        <!-- CPU -->
        <div class="stat-card cyan animate-in stagger-1">
          <div class="flex justify-between items-center mb-2">
            <div class="stat-card-label">CPU Load</div>
            <span style="font-size:18px;">⚡</span>
          </div>
          <div class="stat-card-value" id="mon-cpu">—%</div>
          <div class="progress-bar mt-2">
            <div class="progress-fill cyan" id="mon-cpu-bar" style="width:0%;"></div>
          </div>
          <div class="stat-card-sub" id="mon-cpu-cores">Loading cores...</div>
        </div>

        <!-- RAM -->
        <div class="stat-card purple animate-in stagger-2">
          <div class="flex justify-between items-center mb-2">
            <div class="stat-card-label">Memory (RAM)</div>
            <span style="font-size:18px;">🧠</span>
          </div>
          <div class="stat-card-value" id="mon-mem">—%</div>
          <div class="progress-bar mt-2">
            <div class="progress-fill purple" id="mon-mem-bar" style="width:0%;"></div>
          </div>
          <div class="stat-card-sub" id="mon-mem-usage">— / — GB</div>
        </div>

        <!-- Disk -->
        <div class="stat-card green animate-in stagger-3">
          <div class="flex justify-between items-center mb-2">
            <div class="stat-card-label">Disk Storage</div>
            <span style="font-size:18px;">💾</span>
          </div>
          <div class="stat-card-value" id="mon-disk">—%</div>
          <div class="progress-bar mt-2">
            <div class="progress-fill green" id="mon-disk-bar" style="width:0%;"></div>
          </div>
          <div class="stat-card-sub" id="mon-disk-usage">— / — GB</div>
        </div>

        <!-- System -->
        <div class="stat-card orange animate-in stagger-4">
          <div class="flex justify-between items-center mb-2">
            <div class="stat-card-label">VPS Uptime</div>
            <span style="font-size:18px;">⏱️</span>
          </div>
          <div class="stat-card-value" id="mon-uptime">—</div>
          <div class="stat-card-sub" id="mon-os-info" style="margin-top:14px;">Linux VPS</div>
        </div>
      </div>

      <!-- Additional Details & Load Averages -->
      <div class="grid-2 mb-6">
        <div class="card animate-in stagger-3">
          <div class="card-header">
            <h3 class="card-title">🖥️ System & Hardware Details</h3>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px;font-size:13px;">
            <div class="flex justify-between" style="border-bottom:1px solid var(--border-primary);padding-bottom:8px;">
              <span style="color:var(--text-tertiary);">Hostname</span>
              <span style="font-weight:600;font-family:var(--font-mono);" id="mon-hostname">—</span>
            </div>
            <div class="flex justify-between" style="border-bottom:1px solid var(--border-primary);padding-bottom:8px;">
              <span style="color:var(--text-tertiary);">Operating System</span>
              <span style="font-weight:500;" id="mon-os">—</span>
            </div>
            <div class="flex justify-between" style="border-bottom:1px solid var(--border-primary);padding-bottom:8px;">
              <span style="color:var(--text-tertiary);">Kernel / Arch</span>
              <span style="font-weight:500;" id="mon-kernel">—</span>
            </div>
            <div class="flex justify-between">
              <span style="color:var(--text-tertiary);">Load Average (1m, 5m, 15m)</span>
              <span style="font-family:var(--font-mono);font-weight:600;color:var(--color-cyan);" id="mon-load">—</span>
            </div>
          </div>
        </div>

        <div class="card animate-in stagger-4">
          <div class="card-header">
            <h3 class="card-title">🌐 Network Interfaces & I/O</h3>
          </div>
          <div id="mon-network-area">
            <div class="loading-overlay"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Process Table -->
      <div class="card animate-in stagger-4">
        <div class="card-header">
          <h3 class="card-title">Top Active Processes</h3>
          <span class="badge badge-neutral">Top 15 by CPU/Memory</span>
        </div>
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>PID</th>
                <th>Process Name</th>
                <th>User</th>
                <th>CPU %</th>
                <th>MEM %</th>
              </tr>
            </thead>
            <tbody id="mon-processes-tbody">
              <tr>
                <td colspan="5" style="text-align:center;padding:30px;">
                  <div class="spinner spinner-lg" style="margin:0 auto 8px;"></div>
                  <div style="color:var(--text-tertiary);">Fetching processes...</div>
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
    if (cpuBar) cpuBar.style.width = `${Math.min(cpuPercent, 100)}%`;
    const cpuCores = document.getElementById('mon-cpu-cores');
    if (cpuCores) cpuCores.textContent = `${stats.cpu?.cores || 1} Cores | ${stats.hostname || 'VPS'}`;

    // Update Memory
    if (stats.memory) {
      const memPercent = Math.round(stats.memory.percent || 0);
      const memEl = document.getElementById('mon-mem');
      if (memEl) memEl.textContent = `${memPercent}%`;
      const memBar = document.getElementById('mon-mem-bar');
      if (memBar) memBar.style.width = `${Math.min(memPercent, 100)}%`;
      const memUsage = document.getElementById('mon-mem-usage');
      if (memUsage) memUsage.textContent = `${stats.memory.usedHuman || '0 B'} / ${stats.memory.totalHuman || '—'}`;
    }

    // Update Disk
    if (stats.disk) {
      const diskPercent = Math.round(stats.disk.percent || 0);
      const diskEl = document.getElementById('mon-disk');
      if (diskEl) diskEl.textContent = `${diskPercent}%`;
      const diskBar = document.getElementById('mon-disk-bar');
      if (diskBar) diskBar.style.width = `${Math.min(diskPercent, 100)}%`;
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
    if (kernelEl) kernelEl.textContent = `${stats.cpu?.cores || 1} CPU Cores`;
    const loadEl = document.getElementById('mon-load');
    if (loadEl && stats.cpu?.load) {
      loadEl.textContent = Array.isArray(stats.cpu.load) ? stats.cpu.load.map(l => Number(l).toFixed(2)).join(', ') : String(stats.cpu.load);
    }

    // Update Network
    const netArea = document.getElementById('mon-network-area');
    if (netArea && stats.network) {
      const ifaces = Array.isArray(stats.network) ? stats.network : [stats.network];
      netArea.innerHTML = ifaces.slice(0, 3).map(iface => `
        <div style="margin-bottom:12px;">
          <div class="flex justify-between" style="font-size:12px;margin-bottom:4px;">
            <span style="font-weight:600;color:var(--text-primary);">${escapeHtml(iface.iface || 'eth0')}</span>
            <span style="color:var(--text-tertiary);">TX: ${formatBytes(iface.tx_sec || 0)}/s | RX: ${formatBytes(iface.rx_sec || 0)}/s</span>
          </div>
          <div class="flex justify-between" style="font-size:11px;color:var(--text-tertiary);">
            <span>Total Sent: ${formatBytes(iface.tx_bytes || 0)}</span>
            <span>Total Recv: ${formatBytes(iface.rx_bytes || 0)}</span>
          </div>
        </div>
      `).join('') || '<div style="color:var(--text-tertiary);font-size:12px;">Network stats active</div>';
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
            <td><code style="color:var(--color-cyan);">${proc.pid}</code></td>
            <td><strong>${escapeHtml(proc.name || proc.command || 'unknown')}</strong></td>
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

function formatUptime(seconds) {
  if (!seconds) return '—';
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
