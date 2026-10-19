/**
 * VPS Deploy & Backup Manager — Main Application Router & Controller
 * Includes login gate — all pages require authentication
 * Clean light theme with vector icons
 */

// Product links (login screen, help)
const DOCS_URL = "https://auts-tech.github.io/autspanel/docs/";
const REPO_URL = "https://github.com/auts-tech/backup-vps";

// Global Utility Functions
function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Safe value for an inline handler argument: onclick="fn(${jsArg(name)})"
function jsArg(value) {
  return escapeHtml(JSON.stringify(value));
}

// Random password without look-alike characters (for DB users, mailboxes)
function generatePassword(length = 20) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDate(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

class App {
  constructor() {
    this.currentPage = "dashboard";
    this.isAuthenticated = false;
    this.userEmail = "";

    this.leaveHandlers = [];

    // nav: which sidebar entry is highlighted for pages without their own entry
    this.routes = {
      dashboard: { title: "Dashboard", render: renderDashboard },
      sites: { title: "Websites", render: renderSites },
      "new-site": { title: "New website", render: renderSiteNew, nav: "sites" },
      site: { title: "Website", render: renderSiteDetail, nav: "sites" },
      ssl: { title: "SSL / TLS", render: renderSsl },
      files: { title: "File Manager", render: renderFiles },
      databases: { title: "Databases", render: renderDatabases },
      php: { title: "PHP & Composer", render: renderPhp },
      mail: { title: "Email Hosting", render: renderMail },
      backups: { title: "Backups", render: renderBackups },
      cron: { title: "Cron Jobs", render: renderCron },
      firewall: { title: "Firewall", render: renderFirewall },
      "ssh-keys": { title: "SSH Keys", render: renderSshKeys },
      terminal: { title: "Terminal", render: renderTerminal },
      services: { title: "Services", render: renderServices },
      ports: { title: "Ports & Processes", render: renderPorts },
      monitor: { title: "Resource Monitor", render: renderMonitor },
      logs: { title: "System Logs", render: renderLogs },
      settings: { title: "Settings", render: renderSettings },
    };
    // Old pages that are now part of Websites
    this.aliases = { projects: "sites", deploy: "sites", websites: "sites" };
  }

  /**
   * Set the top bar title (pages with a dynamic name, e.g. a website).
   */
  setTitle(text) {
    if (this.pageTitleEl) this.pageTitleEl.textContent = text;
    document.title = `${text} · AutsPanel`;
  }

  /**
   * Register cleanup to run when the user navigates away from the current page
   * (closing WebSockets, timers, ...).
   */
  onLeave(fn) {
    this.leaveHandlers.push(fn);
  }

  runLeaveHandlers() {
    const handlers = this.leaveHandlers;
    this.leaveHandlers = [];
    handlers.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    });
  }

  async init() {
    if (api.isLoggedIn()) {
      const authStatus = await api.checkAuth();
      if (authStatus.authenticated) {
        this.isAuthenticated = true;
        this.userEmail = authStatus.email || "";
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
    const appEl = document.getElementById("app-root");
    const shieldIcon = window.Icons
      ? window.Icons.get("shield", {
          size: 28,
          color: "#09090b",
          strokeWidth: 2,
        })
      : "";

    appEl.innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <div class="login-logo">
            <div style="width:52px;height:52px;margin:0 auto 16px;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:10px;display:flex;align-items:center;justify-content:center;">
              ${shieldIcon}
            </div>
            <h1 style="font-size:20px;font-weight:700;color:var(--text-primary);margin:0;letter-spacing:-0.02em;">AutsPanel</h1>
            <p style="font-size:13px;color:var(--text-secondary);margin-top:4px;">Open-source hosting control panel</p>
          </div>

          ${this.updatedBanner()}
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

          <div class="login-links">
            <a href="${DOCS_URL}" target="_blank" rel="noopener">${Icons.get("fileText", { size: 12 })}Documentation</a>
            <span>·</span>
            <a href="${REPO_URL}" target="_blank" rel="noopener">${Icons.get("code", { size: 12 })}GitHub</a>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Shown once on the login screen right after a panel update.
   */
  updatedBanner() {
    let info = null;
    try {
      info = JSON.parse(sessionStorage.getItem("panel_updated") || "null");
      sessionStorage.removeItem("panel_updated");
    } catch {}
    if (!info) return "";
    return `
      <div class="login-updated">
        ${window.Icons.get("checkCircle", { size: 18, color: "var(--color-green)" })}
        <div>
          <div style="font-weight:600;">Panel updated${info.short ? ` to ${escapeHtml(info.short)}` : ""}</div>
          <div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(info.subject || "Sign in to continue with the new version.")}</div>
        </div>
      </div>`;
  }

  async handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const btn = document.getElementById("login-btn");
    const errorEl = document.getElementById("login-error");

    if (!email || !password) return;

    btn.disabled = true;
    btn.innerHTML =
      '<span class="spinner spinner-sm" style="margin-right:8px;"></span> Signing in...';
    errorEl.style.display = "none";

    try {
      const res = await api.login(email, password);
      this.isAuthenticated = true;
      this.userEmail = res.email || email;
      this.showApp();
    } catch (err) {
      errorEl.textContent = err.message || "Invalid email or password";
      errorEl.style.display = "block";
      btn.disabled = false;
      btn.innerHTML = "Sign In";
    }
  }

  navLink(page, icon, label) {
    return `
      <a class="sidebar-link" data-page="${page}" href="#${page}">
        <span class="sidebar-link-icon">${window.Icons.get(icon, { size: 16 })}</span>
        <span>${label}</span>
      </a>`;
  }

  // ── Main App Shell ────────────────────────────────────────
  showApp() {
    const appEl = document.getElementById("app-root");
    const I = window.Icons;

    appEl.innerHTML = `
      <div class="app">
        <!-- Sidebar -->
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-logo">
            <div class="sidebar-logo-icon">
              ${I.get("shield", { size: 16, color: "#ffffff" })}
            </div>
            <div class="sidebar-logo-text">
              <h1>AutsPanel</h1>
              <span>Hosting Control Panel</span>
            </div>
          </div>

          <nav class="sidebar-nav">
            <div class="sidebar-section">
              <div class="sidebar-section-title">Overview</div>
              ${this.navLink("dashboard", "dashboard", "Dashboard")}
            </div>

            <div class="sidebar-section">
              <div class="sidebar-section-title">Hosting</div>
              ${this.navLink("sites", "globe", "Websites")}
              ${this.navLink("ssl", "shieldCheck", "SSL / TLS")}
              ${this.navLink("databases", "database", "Databases")}
              ${this.navLink("files", "folder", "File Manager")}
              ${this.navLink("php", "code", "PHP & Composer")}
              ${this.navLink("mail", "mail", "Email")}
            </div>

            <div class="sidebar-section">
              <div class="sidebar-section-title">Automation</div>
              ${this.navLink("backups", "archive", "Backups")}
              ${this.navLink("cron", "clock", "Cron Jobs")}
            </div>

            <div class="sidebar-section">
              <div class="sidebar-section-title">Security</div>
              ${this.navLink("firewall", "flame", "Firewall")}
              ${this.navLink("ssh-keys", "key", "SSH Keys")}
            </div>

            <div class="sidebar-section">
              <div class="sidebar-section-title">System</div>
              ${this.navLink("terminal", "terminal", "Terminal")}
              ${this.navLink("services", "layers", "Services")}
              ${this.navLink("ports", "server", "Ports & Processes")}
              ${this.navLink("monitor", "activity", "Resource Monitor")}
              ${this.navLink("logs", "fileText", "Logs")}
              ${this.navLink("settings", "settings", "Settings")}
            </div>
          </nav>

          <div class="sidebar-footer">
            <div class="sidebar-footer-info">
              <div style="font-size:12px;color:var(--text-primary);font-weight:500;display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${I.get("user", { size: 14, color: "var(--text-secondary)" })}
                <span>${escapeHtml(this.userEmail)}</span>
              </div>
              <button class="btn btn-ghost btn-sm" onclick="window.app.handleLogout()" style="font-size:12px;color:var(--color-red);padding:4px 6px;justify-content:flex-start;margin-top:2px;">
                ${I.get("logOut", { size: 13, color: "var(--color-red)" })}
                <span>Sign Out</span>
              </button>
              <button class="sidebar-version" id="sidebar-version" onclick="PanelUpdater.check({ force: true })" title="Check for updates">v…</button>
            </div>
          </div>
        </aside>

        <!-- Main Content Area -->
        <div class="main-wrapper">
          <header class="topbar">
            <div class="topbar-title">
              <button class="btn btn-ghost btn-icon-only" onclick="window.app.toggleSidebar()" style="display:none;" id="mobile-menu-btn">
                ${I.get("layers", { size: 16 })}
              </button>
              <div>
                <h2 id="header-title">Dashboard</h2>
              </div>
            </div>

            <div class="topbar-actions">
              <button class="btn btn-sm update-pill" id="topbar-update-btn" onclick="PanelUpdater.handleClick()" title="Check for panel updates">
                <span class="update-pill-dot"></span>
                <span>Update AutsPanel</span>
              </button>
              <button class="btn btn-secondary btn-sm" id="topbar-instant-backup-btn" onclick="window.app.handleInstantBackup()" title="Back up every website now">
                ${I.get("archive", { size: 13 })}
                <span>Instant Backup</span>
              </button>
              <button class="btn btn-primary btn-sm" onclick="window.app.navigate('new-site')" title="Create a website or deploy an app">
                ${I.get("plus", { size: 13, color: "#ffffff" })}
                <span>New Website</span>
              </button>
              <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:#fafafa;font-size:12px;">
                <span class="badge-dot" id="server-status-dot" style="background:var(--color-green);"></span>
                <span id="server-status-text" style="color:var(--text-secondary);font-weight:500;">VPS Online</span>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="window.app.handleLogout()">
                ${I.get("logOut", { size: 13 })}
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
    this.contentEl = document.getElementById("app-content");
    this.pageTitleEl = document.getElementById("header-title");
    this.statusDotEl = document.getElementById("server-status-dot");
    this.statusTextEl = document.getElementById("server-status-text");

    // Setup sidebar click handlers
    document.querySelectorAll(".sidebar-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const page = link.getAttribute("data-page");
        if (page) this.navigate(page);
      });
    });

    // Setup route listener
    window.addEventListener("hashchange", () => this.handleHashChange());

    // Initial route
    this.handleHashChange();

    // Health check polling
    this.checkHealth();
    clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => this.checkHealth(), 10000);

    // New-version popup (checks the git remote in the background)
    PanelUpdater.init();
  }

  handleHashChange() {
    const hash = window.location.hash.replace("#", "") || "dashboard";
    this.navigate(hash, false);
  }

  /**
   * path: "page" or "page/param/param", e.g. "site/<id>/deployments"
   */
  navigate(path, updateHash = true) {
    if (!this.isAuthenticated) return this.showLogin();
    let [page, ...params] = String(path || "dashboard").split("/");
    page = this.aliases[page] || page;
    if (!this.routes[page]) {
      page = "dashboard";
      params = [];
    }
    const full = [page, ...params.map(decodeURIComponent)]
      .map(encodeURIComponent)
      .join("/");

    if (updateHash && window.location.hash !== `#${full}`) {
      window.location.hash = `#${full}`;
      return;
    }
    this.currentPage = page;
    this.params = params.map(decodeURIComponent);

    // Update active state in sidebar
    const route = this.routes[page];
    document.querySelectorAll(".sidebar-link").forEach((link) => {
      const linkPage = link.getAttribute("data-page");
      link.classList.toggle("active", linkPage === (route.nav || page));
    });

    // Update Header
    this.setTitle(route.title);

    // Leave the previous page cleanly
    this.runLeaveHandlers();
    Modal.closeAll();

    // Render Page
    if (this.contentEl && typeof route.render === "function") {
      route.render(this.contentEl, this.params);
    }

    // Close mobile sidebar if open
    document.querySelector(".sidebar")?.classList.remove("open");
  }

  async handleLogout() {
    await api.logout();
    this.isAuthenticated = false;
    this.userEmail = "";
    window.location.hash = "";
    this.showLogin();
  }

  async checkHealth() {
    try {
      const res = await fetch("/api/v1/health");
      if (res.ok) {
        if (this.statusDotEl)
          this.statusDotEl.style.background = "var(--color-green)";
        if (this.statusTextEl) this.statusTextEl.textContent = "VPS Online";
      }
    } catch {
      if (this.statusDotEl)
        this.statusDotEl.style.background = "var(--color-red)";
      if (this.statusTextEl) this.statusTextEl.textContent = "Server Offline";
    }
  }

  async handleInstantBackup() {
    const btn = document.getElementById("topbar-instant-backup-btn");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML =
        '<span class="spinner spinner-sm" style="margin-right:6px;"></span> <span>Running...</span>';
    }
    toast.info("Instant Backup", "Backing up every website...");

    try {
      const res = await api.triggerBackupAll();
      toast.success(
        "Backup Started",
        res.message || "All website backups are running",
      );

      // If already on backups page, reload view to see running task
      if (
        this.currentPage === "backups" &&
        typeof loadBackupPage === "function"
      ) {
        setTimeout(loadBackupPage, 1000);
      }
    } catch (err) {
      toast.error("Backup Failed", err.message || "Failed to trigger backup");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${window.Icons.get("archive", { size: 13 })} <span>Instant Backup</span>`;
      }
    }
  }

  toggleSidebar() {
    document.querySelector(".sidebar")?.classList.toggle("open");
  }
}

// Instantiate and export app to window
window.app = new App();

document.addEventListener("DOMContentLoaded", () => {
  window.app.init();
});
