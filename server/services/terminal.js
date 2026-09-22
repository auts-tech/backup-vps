import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { WebSocketServer } from 'ws';
import { cleanEnv } from '../lib/shell.js';
import { BackupEngine } from './backup-engine.js';

const WS_PATH = '/api/v1/terminal/ws';
const MAX_SESSIONS = 10;

// node-pty gives a real PTY (resizing, full-screen apps like nano/htop).
// It is an optional native dependency; without it we fall back to util-linux `script`.
let pty = null;
try {
  const mod = await import('node-pty');
  pty = mod.default || mod;
} catch {
  pty = null;
}

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function pickShell() {
  for (const sh of [process.env.SHELL, '/bin/bash', '/bin/zsh', '/bin/sh']) {
    if (sh && existsSync(sh)) return sh;
  }
  return '/bin/sh';
}

function pickCwd(requested) {
  try {
    if (requested && statSync(requested).isDirectory()) return requested;
  } catch {}
  return process.env.HOME && existsSync(process.env.HOME) ? process.env.HOME : '/';
}

/**
 * Spawn a shell attached to a terminal. Returns a small uniform interface.
 */
function spawnShell({ cols, rows, cwd }) {
  const shell = pickShell();
  const env = cleanEnv({ TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'C.UTF-8' });

  if (pty) {
    const p = pty.spawn(shell, ['-l'], { name: 'xterm-256color', cols, rows, cwd, env });
    return {
      mode: 'pty',
      onData: (fn) => p.onData(fn),
      onExit: (fn) => p.onExit(({ exitCode }) => fn(exitCode)),
      write: (d) => p.write(d),
      resize: (c, r) => { try { p.resize(c, r); } catch {} },
      kill: () => { try { p.kill(); } catch {} }
    };
  }

  // Fallback: `script` allocates a PTY for the shell. No live resize, so set the size once.
  const child = spawn('script', ['-qfc', `stty cols ${cols} rows ${rows} 2>/dev/null; exec ${shell} -l`, '/dev/null'], { cwd, env });
  return {
    mode: 'script',
    onData: (fn) => { child.stdout.on('data', d => fn(d.toString())); child.stderr.on('data', d => fn(d.toString())); },
    onExit: (fn) => child.on('close', code => fn(code)),
    write: (d) => child.stdin.write(d),
    resize: () => {},
    kill: () => child.kill('SIGHUP')
  };
}

/**
 * Attach the terminal WebSocket endpoint to the HTTP server.
 * Protocol (JSON text frames):
 *   client → server  { t: 'i', d: '<input>' } | { t: 'r', c: cols, r: rows }
 *   server → client  { t: 'o', d: '<output>' } | { t: 'x', code } | { t: 'm', mode }
 */
export function attachTerminal(server, isAuthorized) {
  const wss = new WebSocketServer({ noServer: true });
  let sessions = 0;

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    if (!isAuthorized(url.searchParams.get('token'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (sessions >= MAX_SESSIONS) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => startSession(ws, url.searchParams, req));
  });

  function startSession(ws, params, req) {
    sessions++;
    const cols = clamp(parseInt(params.get('cols')) || 100, 20, 500);
    const rows = clamp(parseInt(params.get('rows')) || 30, 5, 200);
    const cwd = pickCwd(params.get('cwd'));
    const send = (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };

    let term;
    try {
      term = spawnShell({ cols, rows, cwd });
    } catch (err) {
      send({ t: 'o', d: `\r\nFailed to start shell: ${err.message}\r\n` });
      ws.close();
      sessions--;
      return;
    }
    BackupEngine.log(`[Terminal] Session opened from ${req.socket.remoteAddress} (${term.mode})`);
    send({ t: 'm', mode: term.mode });

    term.onData(d => send({ t: 'o', d }));
    term.onExit(code => {
      send({ t: 'x', code });
      ws.close();
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.t === 'i' && typeof msg.d === 'string') term.write(msg.d);
      else if (msg.t === 'r') term.resize(clamp(parseInt(msg.c) || cols, 20, 500), clamp(parseInt(msg.r) || rows, 5, 200));
    });

    // Keep proxies from closing idle sessions
    const ping = setInterval(() => { if (ws.readyState === ws.OPEN) ws.ping(); }, 30000);

    ws.on('close', () => {
      clearInterval(ping);
      term.kill();
      sessions--;
    });
  }
}
