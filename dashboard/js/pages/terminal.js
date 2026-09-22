/**
 * Web Terminal — xterm.js over an authenticated WebSocket to a server-side PTY
 */
const XTERM_BASE = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0';
const XTERM_FIT = 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.11.0/lib/addon-fit.min.js';
let termSession = null;

function loadXterm() {
  if (window.Terminal && window.FitAddon) return Promise.resolve();
  if (loadXterm._p) return loadXterm._p;
  const script = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = `${XTERM_BASE}/css/xterm.min.css`;
  document.head.appendChild(css);
  loadXterm._p = script(`${XTERM_BASE}/lib/xterm.min.js`).then(() => script(XTERM_FIT)).catch(err => {
    loadXterm._p = null;
    throw err;
  });
  return loadXterm._p;
}

function renderTerminal(container) {
  const I = window.Icons;
  container.innerHTML = `
    <div>
      <div class="page-header" style="margin-bottom:14px;">
        <div class="page-header-title">
          <h2>Terminal</h2>
          <p>Root shell on this server. Closing or leaving this page ends the session.</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="badge badge-neutral" id="term-status"><span class="badge-dot"></span>Connecting</span>
          <button class="btn btn-secondary btn-sm" onclick="termSession?.term?.clear()">${I.get('x', { size: 12 })}<span>Clear</span></button>
          <button class="btn btn-primary btn-sm" onclick="connectTerminal()">${I.get('refresh', { size: 12, color: '#fff' })}<span>New Session</span></button>
        </div>
      </div>
      <div class="terminal-wrap" id="terminal-host"></div>
      <div class="form-hint" style="margin-top:8px;">Tip: copy with selection, paste with Ctrl/Cmd+V. Use the File Manager's “Terminal Here” to open a shell in a specific folder.</div>
    </div>
  `;
  window.app.onLeave(disconnectTerminal);
  connectTerminal();
}

function setTermStatus(state, text) {
  const el = document.getElementById('term-status');
  if (!el) return;
  el.className = `badge ${state === 'ok' ? 'badge-success' : state === 'err' ? 'badge-danger' : 'badge-neutral'}`;
  el.innerHTML = `<span class="badge-dot"></span>${escapeHtml(text)}`;
}

function disconnectTerminal() {
  if (!termSession) return;
  termSession.closing = true;
  try { termSession.ws.close(); } catch { }
  window.removeEventListener('resize', termSession.onResize);
  termSession.term.dispose();
  termSession = null;
}

async function connectTerminal() {
  const host = document.getElementById('terminal-host');
  if (!host) return;
  disconnectTerminal();
  setTermStatus('wait', 'Loading');

  try {
    await loadXterm();
  } catch (err) {
    host.innerHTML = `<div style="color:#f87171;font-family:var(--font-mono);font-size:13px;padding:10px;">${escapeHtml(err.message)}. The terminal needs access to cdn.jsdelivr.net.</div>`;
    setTermStatus('err', 'Unavailable');
    return;
  }

  host.innerHTML = '';
  const term = new window.Terminal({
    cursorBlink: true,
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    scrollback: 5000,
    theme: { background: '#09090b', foreground: '#e4e4e7', cursor: '#e4e4e7', selectionBackground: '#3f3f46' }
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();

  let cwd = '';
  try {
    cwd = localStorage.getItem('terminal_cwd') || '';
    localStorage.removeItem('terminal_cwd');
  } catch { }

  const ws = new WebSocket(api.terminalUrl({ cols: term.cols, rows: term.rows, ...(cwd ? { cwd } : {}) }));
  const session = { term, fit, ws, closing: false };
  termSession = session;
  const send = (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

  ws.onopen = () => {
    setTermStatus('ok', 'Connected');
    term.focus();
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.t === 'o') term.write(msg.d);
    else if (msg.t === 'x') term.write(`\r\n\x1b[90m[session ended${msg.code ? ` with code ${msg.code}` : ''}]\x1b[0m\r\n`);
    else if (msg.t === 'm' && msg.mode !== 'pty') {
      term.write('\x1b[33m[basic terminal mode: install build tools and run `npm install` in server/ to enable node-pty for resizing & full-screen apps]\x1b[0m\r\n');
    }
  };
  ws.onclose = () => {
    if (session.closing) return;
    setTermStatus('err', 'Disconnected');
    term.write('\r\n\x1b[90m[disconnected — click New Session to reconnect]\x1b[0m\r\n');
  };
  ws.onerror = () => setTermStatus('err', 'Connection failed');

  term.onData(d => send({ t: 'i', d }));
  term.onResize(({ cols, rows }) => send({ t: 'r', c: cols, r: rows }));
  session.onResize = () => { try { fit.fit(); } catch { } };
  window.addEventListener('resize', session.onResize);
}

window.renderTerminal = renderTerminal;
