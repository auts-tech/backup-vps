/**
 * System & Backup Logs Page
 */
let logEventSource = null;
let currentLogPage = 1;
let currentLogSearch = '';
let currentLogLevel = 'all';

function renderLogs(container) {
  container.innerHTML = `
    <div class="animate-in">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h2 style="font-size:20px;font-weight:700;">System & Backup Logs</h2>
          <p style="font-size:13px;color:var(--text-tertiary);margin-top:4px;">Real-time logs for backup operations, cron executions, and deploy runs</p>
        </div>
        <div class="flex items-center gap-3">
          <button class="btn btn-secondary btn-sm" id="live-stream-btn" onclick="toggleLiveLogStream()">
            <span id="live-stream-dot" class="badge-dot" style="display:inline-block;margin-right:6px;background:var(--text-tertiary);"></span>
            <span id="live-stream-text">Live Stream: OFF</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="loadLogs(1)">🔄 Refresh</button>
        </div>
      </div>

      <!-- Log Info Bar & Controls -->
      <div class="card mb-6 animate-in stagger-1">
        <div class="flex justify-between items-center flex-wrap gap-4">
          <!-- Search & Filter -->
          <div class="flex items-center gap-3 flex-wrap" style="flex:1;">
            <div style="position:relative;min-width:240px;flex:1;">
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

          <!-- Metadata -->
          <div id="log-file-meta" style="font-size:12px;color:var(--text-tertiary);">
            Loading log file info...
          </div>
        </div>
      </div>

      <!-- Log Viewer Window -->
      <div class="card animate-in stagger-2" style="padding:0;overflow:hidden;background:#060911;">
        <div style="background:rgba(255,255,255,0.03);padding:10px 16px;border-bottom:1px solid var(--border-primary);display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:#ef4444;display:inline-block;"></span>
            <span style="width:10px;height:10px;border-radius:50%;background:#f59e0b;display:inline-block;"></span>
            <span style="width:10px;height:10px;border-radius:50%;background:#10b981;display:inline-block;"></span>
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);margin-left:8px;">/var/log/vps-backup-manager.log</span>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="copyLogContents()" style="padding:2px 8px;font-size:11px;">📋 Copy</button>
        </div>

        <div id="logs-container" style="font-family:var(--font-mono);font-size:12px;line-height:1.7;padding:16px;max-height:550px;overflow-y:auto;color:#d1d5db;">
          <div class="loading-overlay"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Pagination -->
      <div class="flex justify-between items-center mt-4">
        <div id="logs-pagination-info" style="font-size:12px;color:var(--text-tertiary);">Showing page 1</div>
        <div class="btn-group">
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
      metaEl.innerHTML = `Log file not created yet (will create on first backup)`;
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
      container.innerHTML = `<div style="color:var(--text-tertiary);text-align:center;padding:40px;">No log entries found.</div>`;
    } else {
      container.innerHTML = logs.map(l => {
        const color = l.level === 'error' ? 'var(--color-red)'
          : l.level === 'warning' ? 'var(--color-orange)'
          : l.level === 'success' ? 'var(--color-green)'
          : 'var(--color-cyan)';

        return `
          <div style="display:flex;gap:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.02);">
            <span style="color:var(--text-tertiary);white-space:nowrap;user-select:none;">${escapeHtml(l.timestamp || '')}</span>
            <span style="color:${color};font-weight:600;min-width:60px;">[${l.level.toUpperCase()}]</span>
            <span style="flex:1;word-break:break-all;">${escapeHtml(l.message || l.raw)}</span>
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
    container.innerHTML = `<div style="color:var(--color-red);padding:20px;">Failed to load logs: ${escapeHtml(err.message)}</div>`;
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
  const btn = document.getElementById('live-stream-btn');
  const dot = document.getElementById('live-stream-dot');
  const txt = document.getElementById('live-stream-text');
  const container = document.getElementById('logs-container');

  try {
    const apiKey = api.getApiKey();
    const url = `/api/v1/logs/stream${apiKey ? `?apiKey=${apiKey}` : ''}`;
    logEventSource = new EventSource(url);

    if (dot) dot.style.background = 'var(--color-green)';
    if (txt) txt.textContent = 'Live Stream: ON';
    if (btn) btn.classList.add('active');

    logEventSource.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        const color = log.level === 'error' ? 'var(--color-red)'
          : log.level === 'warning' ? 'var(--color-orange)'
          : log.level === 'success' ? 'var(--color-green)'
          : 'var(--color-cyan)';

        const lineHtml = `
          <div style="display:flex;gap:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.02);animation:fadeIn 0.3s ease;">
            <span style="color:var(--text-tertiary);white-space:nowrap;">${escapeHtml(log.timestamp || '')}</span>
            <span style="color:${color};font-weight:600;min-width:60px;">[${log.level.toUpperCase()}]</span>
            <span style="flex:1;word-break:break-all;">${escapeHtml(log.message)}</span>
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

    Toast.info('Connected to live log stream');
  } catch (err) {
    Toast.error('Could not start live stream');
  }
}

function stopLiveLogStream() {
  if (logEventSource) {
    logEventSource.close();
    logEventSource = null;
  }
  const dot = document.getElementById('live-stream-dot');
  const txt = document.getElementById('live-stream-text');
  const btn = document.getElementById('live-stream-btn');

  if (dot) dot.style.background = 'var(--text-tertiary)';
  if (txt) txt.textContent = 'Live Stream: OFF';
  if (btn) btn.classList.remove('active');
}

function copyLogContents() {
  const container = document.getElementById('logs-container');
  if (!container) return;
  navigator.clipboard.writeText(container.innerText).then(() => {
    Toast.success('Log text copied to clipboard!');
  }).catch(() => {
    Toast.error('Failed to copy');
  });
}
