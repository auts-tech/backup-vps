/**
 * VPS Deploy & Backup Manager — Main Application Router & Controller
 * Includes login gate — all pages require authentication
 * Clean light theme with vector icons
 */

// Global Utility Functions
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

class App {
  constructor() {
    this.currentPage = 'dashboard';
    this.isAuthenticated = false;
    this.userEmail = '';

    this.routes = {
      dashboard: { title: 'Dashboard', render: renderDashboard },
      projects: { title: 'Projects', render: renderProjects },
      backups: { title: 'Backups', render: renderBackups },
      deploy: { title: 'Deploy & Git', render: renderDeploy },
      cron: { title: 'Cron Automation', render: renderCron },
      monitor: { title: 'Resource Monitor', render: renderMonitor },
      logs: { title: 'System Logs', render: renderLogs },
      settings: { title: 'Settings', render: renderSettings }
    };
  }

  async init() {
    if (api.isLoggedIn()) {
      const authStatus = await api.checkAuth();
      if (authStatus.authenticated) {
        this.isAuthenticated = true;
        this.userEmail = authStatus.email || '';
        this.showApp();
        return;
      }
      api.clearToken();
    }

    this.showLogin();
  }

  // ── Login Screen ──────────────────────────────────────────
  showLogin() {
    this.isAuthenticated = false;
    const appEl = document.getElementById('app-root');
    const shieldIcon = window.Icons ? window.Icons.get('shield', { size: 28, color: '#09090b', strokeWidth: 2 }) : '';

    appEl.innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <div class="login-logo">
            <div style="width:52px;height:52px;margin:0 auto 16px;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:10px;display:flex;align-items:center;justify-content:center;">
              ${shieldIcon}
            </div>
            <h1 style="font-size:20px;font-weight:700;color:var(--text-primary);margin:0;letter-spacing:-0.02em;">VPS Manager</h1>
            <p style="font-size:13px;color:var(--text-secondary);margin-top:4px;">Deploy & Backup Suite</p>
          </div>

          <form id="login-form" onsubmit="window.app.handleLogin(event)" autocomplete="on">
            <div id="login-error" style="display:none;background:var(--color-red-bg);border:1px solid var(--color-red-border);color:var(--color-red);padding:10px 14px;border-radius:var(--radius-sm);font-size:13px;margin-bottom:16px;"></div>

            <div class="form-group">
              <label class="form-label">Email Address</label>
              <input
                type="email"
                id="login-email"
                class="form-input"
                placeholder="admin@example.com"
                required
                autocomplete="email"
                autofocus
              >
            </div>

            <div class="form-group">
              <label class="form-label">Password</label>
              <input
                type="password"
                id="login-password"
                class="form-input"
                placeholder="Enter your password"
                required
                autocomplete="current-password"
              >
            </div>

            <button type="submit" class="btn btn-primary" id="login-btn" style="width:100%;height:40px;font-size:14px;margin-top:8px;">
              Sign In
            </button>
          </form>

          <div style="text-align:center;margin-top:20px;font-size:12px;color:var(--text-tertiary);">
            Configured in the server's <code>.env</code> file
          </div>
        </div>
      </div>
    `;
  }

  async handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');
    const errorEl = document.getElementById('login-error');

    if (!email || !password) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm" style="margin-right:8px;"></span> Signing in...';
    errorEl.style.display = 'none';

    try {
      const res = await api.login(email, password);
      this.isAuthenticated = true;
      this.userEmail = res.email || email;
      this.showApp();
    } catch (err) {
      errorEl.textContent = err.message || 'Invalid email or password';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = 'Sign In';
    }
  }

  // ── Main App Shell ────────────────────────────────────────
  showApp() {
    const appEl = document.getElementById('app-root');
    const I = window.Icons;

    appEl.innerHTML = `
      <div class="app">
        <!-- Sidebar -->
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-logo">
            <div class="sidebar-logo-icon">
              ${I.get('shield', { size: 16, color: '#ffffff' })}
            </div>
            <div class="sidebar-logo-text">
              <h1>VPS Manager</h1>
              <span>Deploy & Backup Suite</span>
            </div>
          </div>

          <nav class="sidebar-nav">
            <div class="sidebar-section">
              <div class="sidebar-section-title">Overview</div>
              <a class="sidebar-link active" data-page="dashboard" href="#dashboard">
                <span class="sidebar-link-icon">${I.get('dashboard', { size: 16 })}</span>
                <span>Dashboard</span>
              </a>
            </div>

            <div class="sidebar-section">
              <div class="sidebar-section-title">Operations</div>
              <a class="sidebar-link" data-page="projects" href="#projects">
                <span class="sidebar-link-icon">${I.get('package', { size: 16 })}</span>
                <span>Projects</span>
              </a>
              <a class="sidebar-link" data-page="backups" href="#backups">
                <span class="sidebar-link-icon">${I.get('database', { size: 16 })}</span>
                <span>Backups</span>
              </a>
              <a class="sidebar-link" data-page="deploy" href="#deploy">
                <span class="sidebar-link-icon">${I.get('rocket', { size: 16 })}</span>
                <span>Deploy & Git</span>
              </a>
              <a class="sidebar-link" data-page="cron" href="#cron">
                <span class="sidebar-link-icon">${I.get('clock', { size: 16 })}</span>
                <span>Cron Automation</span>
              </a>
            </div>

            <div class="sidebar-section">
              <div class="sidebar-section-title">System</div>
              <a class="sidebar-link" data-page="monitor" href="#monitor">
                <span class="sidebar-link-icon">${I.get('activity', { size: 16 })}</span>
                <span>Resource Monitor</span>
              </a>
              <a class="sidebar-link" data-page="logs" href="#logs">
                <span class="sidebar-link-icon">${I.get('fileText', { size: 16 })}</span>
                <span>Logs</span>
              </a>
              <a class="sidebar-link" data-page="settings" href="#settings">
                <span class="sidebar-link-icon">${I.get('settings', { size: 16 })}</span>
                <span>Settings</span>
              </a>
            </div>
          </nav>

          <div class="sidebar-footer">
            <div class="sidebar-footer-info">
              <div style="font-size:12px;color:var(--text-primary);font-weight:500;display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${I.get('user', { size: 14, color: 'var(--text-secondary)' })}
                <span>${escapeHtml(this.userEmail)}</span>
              </div>
              <button class="btn btn-ghost btn-sm" onclick="window.app.handleLogout()" style="font-size:12px;color:var(--color-red);padding:4px 6px;justify-content:flex-start;margin-top:2px;">
                ${I.get('logOut', { size: 13, color: 'var(--color-red)' })}
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </aside>

        <!-- Main Content Area -->
        <div class="main-wrapper">
          <header class="topbar">
            <div class="topbar-title">
              <button class="btn btn-ghost btn-icon-only" onclick="window.app.toggleSidebar()" style="display:none;" id="mobile-menu-btn">
                ${I.get('layers', { size: 16 })}
              </button>
              <div>
                <h2 id="header-title">Dashboard</h2>
              </div>
            </div>

            <div class="topbar-actions">
              <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:#fafafa;font-size:12px;">
                <span class="badge-dot" id="server-status-dot" style="background:var(--color-green);"></span>
                <span id="server-status-text" style="color:var(--text-secondary);font-weight:500;">VPS Online</span>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="window.app.handleLogout()">
                ${I.get('logOut', { size: 13 })}
                <span>Logout</span>
              </button>
            </div>
          </header>

          <main class="page-content" id="app-content">
            <div style="display:flex;align-items:center;justify-content:center;height:300px;">
              <div class="spinner spinner-lg"></div>
            </div>
          </main>
        </div>
      </div>
    `;

    // Cache DOM refs
    this.contentEl = document.getElementById('app-content');
    this.pageTitleEl = document.getElementById('header-title');
    this.statusDotEl = document.getElementById('server-status-dot');
    this.statusTextEl = document.getElementById('server-status-text');

    // Setup sidebar click handlers
    document.querySelectorAll('.sidebar-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.getAttribute('data-page');
        if (page) this.navigate(page);
      });
    });

    // Setup route listener
    window.addEventListener('hashchange', () => this.handleHashChange());

    // Initial route
    this.handleHashChange();

    // Health check polling
    this.checkHealth();
    setInterval(() => this.checkHealth(), 10000);
  }

  handleHashChange() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    this.navigate(hash, false);
  }

  navigate(page, updateHash = true) {
    if (!this.isAuthenticated) return this.showLogin();
    if (!this.routes[page]) page = 'dashboard';

    this.currentPage = page;

    if (updateHash && window.location.hash !== `#${page}`) {
      window.location.hash = `#${page}`;
      return;
    }

    // Update active state in sidebar
    document.querySelectorAll('.sidebar-link').forEach(link => {
      const linkPage = link.getAttribute('data-page');
      link.classList.toggle('active', linkPage === page);
    });

    // Update Header
    const route = this.routes[page];
    if (this.pageTitleEl) this.pageTitleEl.textContent = route.title;

    // Render Page
    if (this.contentEl && typeof route.render === 'function') {
      route.render(this.contentEl);
    }

    // Close mobile sidebar if open
    document.querySelector('.sidebar')?.classList.remove('open');
  }

  async handleLogout() {
    await api.logout();
    this.isAuthenticated = false;
    this.userEmail = '';
    window.location.hash = '';
    this.showLogin();
  }

  async checkHealth() {
    try {
      const res = await fetch('/api/v1/health');
      if (res.ok) {
        if (this.statusDotEl) this.statusDotEl.style.background = 'var(--color-green)';
        if (this.statusTextEl) this.statusTextEl.textContent = 'VPS Online';
      }
    } catch {
      if (this.statusDotEl) this.statusDotEl.style.background = 'var(--color-red)';
      if (this.statusTextEl) this.statusTextEl.textContent = 'Server Offline';
    }
  }

  toggleSidebar() {
    document.querySelector('.sidebar')?.classList.toggle('open');
  }
}

// Instantiate and export app to window
window.app = new App();

document.addEventListener('DOMContentLoaded', () => {
  window.app.init();
});
