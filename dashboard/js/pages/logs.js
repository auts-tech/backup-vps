/**
 * System & Backup Logs Page
 * Clean white theme with vector icons and deep black text
 */
let logEventSource = null;
let currentLogPage = 1;
let currentLogSearch = '';
let currentLogLevel = 'all';

function renderLogs(container) {
  const I = window.Icons;

  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>System & Backup Logs</h2>
          <p>Real-time audit log of backup snapshots, cron triggers, and Git operations</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn btn-secondary btn-sm" id="live-stream-btn" onclick="toggleLiveLogStream()">
            <span id="live-stream-dot" class="badge-dot" style="background:var(--text-tertiary);"></span>
            <span id="live-stream-text">Live SSE Stream</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="loadLogs(1)">
            ${I.get('refresh', { size: 12 })}
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- Log Info Bar & Controls -->
      <div class="card" style="margin-bottom:16px;">
        <div class="card-body" style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:gap;gap:12px;">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:260px;">
            <div style="position:relative;flex:1;">
              <input type="text" class="form-input" id="log-search-input" placeholder="Search log entries..." onkeyup="handleLogSearch(event)">
            </div>
            <select class="form-select" style="width:auto;" id="log-level-filter" onchange="handleLogLevelChange(this.value)">
              <option value="all">All Levels</option>
              <option value="success">Success Only</option>
              <option value="info">Info Only</option>
              <option value="warning">Warnings</option>
              <option value="error">Errors Only</option>
            </select>
          </div>

          <div id="log-file-meta" style="font-size:12px;color:var(--text-secondary);">
            Loading log file size...
          </div>
        </div>
      </div>

      <!-- High-Contrast Terminal Box -->
      <div class="card" style="border-radius:var(--radius-md);overflow:hidden;background:#09090b;border:1px solid #27272a;">
        <div style="background:#18181b;padding:10px 16px;border-bottom:1px solid #27272a;display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-family:var(--font-mono);font-size:12px;color:#a1a1aa;">/var/log/vps-backup-manager.log</span>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="copyLogContents()" style="color:#d4d4d8;font-size:11px;padding:2px 8px;">
            ${I.get('copy', { size: 12, color: '#d4d4d8' })}
            <span>Copy Log</span>
          </button>
        </div>

        <div id="logs-container" style="font-family:var(--font-mono);font-size:12px;line-height:1.7;padding:16px;max-height:540px;overflow-y:auto;color:#f4f4f5;">
          <div style="text-align:center;padding:32px;"><div class="spinner spinner-sm"></div></div>
        </div>
      </div>

      <!-- Pagination Controls -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;">
        <div id="logs-pagination-info" style="font-size:12px;color:var(--text-secondary);">Showing page 1</div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-secondary" id="log-prev-btn" onclick="changeLogPage(-1)" disabled>Previous</button>
          <button class="btn btn-sm btn-secondary" id="log-next-btn" onclick="changeLogPage(1)">Next</button>
        </div>
      </div>
    </div>
  `;

  loadLogMeta();
  loadLogs(1);
}

// Cleanup SSE on page navigation
window.addEventListener('hashchange', () => {
  stopLiveLogStream();
});

async function loadLogMeta() {
  const metaEl = document.getElementById('log-file-meta');
  if (!metaEl) return;
  try {
    const info = await api.getLogInfo();
    if (info.exists) {
      metaEl.innerHTML = `Size: <strong>${info.sizeHuman}</strong> | File: <code>${info.path}</code>`;
    } else {
      metaEl.innerHTML = `Log active in memory`;
    }
  } catch {}
}

async function loadLogs(page = 1) {
  const container = document.getElementById('logs-container');
  if (!container) return;

  currentLogPage = page;
  try {
    const res = await api.getLogs(page, 100, currentLogSearch);
    let logs = res.logs || [];

    if (currentLogLevel !== 'all') {
      logs = logs.filter(l => l.level === currentLogLevel);
    }

    if (logs.length === 0) {
      container.innerHTML = `<div style="color:#71717a;text-align:center;padding:40px;">No log entries found.</div>`;
    } else {
      container.innerHTML = logs.map(l => {
        const color = l.level === 'error' ? '#f87171'
          : l.level === 'warning' ? '#fbbf24'
          : l.level === 'success' ? '#4ade80'
          : '#38bdf8';

        return `
          <div style="display:flex;gap:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
            <span style="color:#71717a;white-space:nowrap;user-select:none;">${escapeHtml(l.timestamp || '')}</span>
            <span style="color:${color};font-weight:600;min-width:64px;">[${l.level.toUpperCase()}]</span>
            <span style="flex:1;word-break:break-all;color:#e4e4e7;">${escapeHtml(l.message || l.raw)}</span>
          </div>
        `;
      }).join('');
    }

    // Update pagination
    const pagInfo = document.getElementById('logs-pagination-info');
    if (pagInfo) pagInfo.textContent = `Page ${res.page || 1} of ${res.pages || 1} (${res.total || 0} entries)`;

    const prevBtn = document.getElementById('log-prev-btn');
    if (prevBtn) prevBtn.disabled = page <= 1;

    const nextBtn = document.getElementById('log-next-btn');
    if (nextBtn) nextBtn.disabled = page >= (res.pages || 1);

  } catch (err) {
    container.innerHTML = `<div style="color:#f87171;padding:20px;">Failed to load logs: ${escapeHtml(err.message)}</div>`;
  }
}

function handleLogSearch(e) {
  clearTimeout(window._logSearchTimeout);
  window._logSearchTimeout = setTimeout(() => {
    currentLogSearch = e.target.value.trim();
    loadLogs(1);
  }, 300);
}

function handleLogLevelChange(level) {
  currentLogLevel = level;
  loadLogs(1);
}

function changeLogPage(delta) {
  loadLogs(currentLogPage + delta);
}

function toggleLiveLogStream() {
  if (logEventSource) {
    stopLiveLogStream();
  } else {
    startLiveLogStream();
  }
}

function startLiveLogStream() {
  const dot = document.getElementById('live-stream-dot');
  const txt = document.getElementById('live-stream-text');
  const container = document.getElementById('logs-container');

  try {
    const token = api.token;
    const url = `/api/v1/logs/stream${token ? `?apiKey=${token}` : ''}`;
    logEventSource = new EventSource(url);

    if (dot) dot.style.background = 'var(--color-green)';
    if (txt) txt.textContent = 'Live Stream: ON';

    logEventSource.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        const color = log.level === 'error' ? '#f87171'
          : log.level === 'warning' ? '#fbbf24'
          : log.level === 'success' ? '#4ade80'
          : '#38bdf8';

        const lineHtml = `
          <div style="display:flex;gap:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
            <span style="color:#71717a;white-space:nowrap;">${escapeHtml(log.timestamp || '')}</span>
            <span style="color:${color};font-weight:600;min-width:64px;">[${log.level.toUpperCase()}]</span>
            <span style="flex:1;word-break:break-all;color:#e4e4e7;">${escapeHtml(log.message)}</span>
          </div>
        `;

        if (container) {
          container.insertAdjacentHTML('afterbegin', lineHtml);
        }
      } catch {}
    };

    logEventSource.onerror = () => {
      stopLiveLogStream();
    };

    toast.info('Connected', 'Live log stream active');
  } catch (err) {
    toast.error('Failed', 'Could not open live stream');
  }
}

function stopLiveLogStream() {
  if (logEventSource) {
    logEventSource.close();
    logEventSource = null;
  }
  const dot = document.getElementById('live-stream-dot');
  const txt = document.getElementById('live-stream-text');

  if (dot) dot.style.background = 'var(--text-tertiary)';
  if (txt) txt.textContent = 'Live SSE Stream';
}

function copyLogContents() {
  const container = document.getElementById('logs-container');
  if (!container) return;
  navigator.clipboard.writeText(container.innerText).then(() => {
    toast.success('Copied', 'Log output copied to clipboard');
  }).catch(() => {
    toast.error('Failed', 'Failed to copy text');
  });
}

window.renderLogs = renderLogs;
