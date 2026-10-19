/**
 * Backups management page
 * Clean white theme with vector icons and deep black text
 */
function renderBackups(container) {
  const I = window.Icons;

  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Backups</h2>
          <p>Each website's database, files and .env — plus whole-server snapshots. Schedule and restore per website on its Backups tab.</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="triggerBackupAll()" id="backup-all-btn">
            ${I.get("database", { size: 14 })}
            <span>Backup All Websites</span>
          </button>
          <button class="btn btn-primary" onclick="triggerVPSSnapshot()">
            ${I.get("server", { size: 14, color: "#ffffff" })}
            <span>Full VPS Snapshot</span>
          </button>
        </div>
      </div>

      <!-- Backup Status -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get("activity", { size: 16 })}
            <span>Active Backup Tasks</span>
          </h3>
          <button class="btn btn-sm btn-secondary" onclick="refreshBackupStatus()">
            ${I.get("refresh", { size: 12 })}
            <span>Refresh</span>
          </button>
        </div>
        <div class="card-body" id="backup-status-area">
          <div style="font-size:13px;color:var(--text-tertiary);">No active backups running.</div>
        </div>
      </div>

      <!-- Per-project backup -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get("globe", { size: 16 })}
            <span>Websites</span>
          </h3>
        </div>
        <div id="backup-projects-list">
          <div style="text-align:center;padding:32px;"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Backup History -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get("clock", { size: 16 })}
            <span>Remote Backup Archives</span>
          </h3>
          <button class="btn btn-sm btn-danger" onclick="cleanupAllBackups()">
            ${I.get("trash", { size: 12 })}
            <span>Cleanup Old</span>
          </button>
        </div>
        <div id="backup-history">
          <div style="text-align:center;padding:32px;"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;
  loadBackupPage();
}

async function loadBackupPage() {
  await Promise.all([
    loadBackupProjects(),
    loadBackupHistory(),
    refreshBackupStatus(),
  ]);
}

async function loadBackupProjects() {
  const el = document.getElementById("backup-projects-list");
  const I = window.Icons;

  try {
    const { sites } = await api.getSites();
    const withFiles = sites.filter((s) => s.deployPath);
    if (!withFiles.length) {
      el.innerHTML = UI.emptyState("globe", "No websites yet", "Create a website first — its database, files and .env are backed up together.", `<a class="btn btn-primary" href="#new-site">New website</a>`);
      return;
    }
    el.innerHTML = `
      <div class="table-container" style="border:none;border-radius:0;">
        <table class="table">
          <thead><tr><th>Website</th><th>Database</th><th>Folder</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${withFiles
              .map(
                (s) => `
              <tr>
                <td><div style="display:flex;align-items:center;gap:10px;">${UI.stackAvatar(s.type, "sm")}<a href="#site/${s.id}/backups" style="font-weight:600;">${escapeHtml(s.name)}</a></div></td>
                <td>${s.database?.name ? `<span class="mono-sm">${escapeHtml(s.database.name)}</span>` : '<span class="muted" style="font-size:12px;">None</span>'}</td>
                <td class="mono-sm truncate" style="max-width:280px;">${escapeHtml(s.deployPath)}</td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-primary" onclick="triggerProjectBackup('${s.id}', ${jsArg(s.name)})">${I.get("archive", { size: 12, color: "#ffffff" })}<span>Back up</span></button>
                  <a class="btn btn-sm btn-secondary" href="#site/${s.id}/backups">${I.get("rotateCcw", { size: 12 })}<span>Restore & schedule</span></a>
                </td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div style="padding:20px;color:var(--color-red);font-size:13px;">${escapeHtml(err.message)}</div>`;
  }
}

async function loadBackupHistory() {
  const el = document.getElementById("backup-history");
  const I = window.Icons;

  try {
    const { backups } = await api.getBackups();
    if (!backups || backups.length === 0) {
      el.innerHTML = `
        <div class="empty-state" style="padding:32px 20px;">
          <div class="empty-state-icon">${I.get("cloud", { size: 20 })}</div>
          <div class="empty-state-title">No Remote Archives Found</div>
          <div class="empty-state-desc">Backups uploaded to Google Drive or remote storage will appear here.</div>
        </div>
      `;
      return;
    }

    el.innerHTML = `
      <div class="table-container" style="border:none;border-radius:0;">
        <table class="table">
          <thead>
            <tr>
              <th>Archive Name</th>
              <th>Snapshot Date</th>
            </tr>
          </thead>
          <tbody>
            ${backups
              .slice(0, 20)
              .map(
                (b) => `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:8px;">
                    ${I.get("database", { size: 14, color: "var(--text-tertiary)" })}
                    <span style="font-family:var(--font-mono);font-size:12px;">${escapeHtml(b.name)}</span>
                  </div>
                </td>
                <td style="color:var(--text-secondary);font-size:12px;">
                  ${b.date ? new Date(b.date).toLocaleString() : escapeHtml(b.name)}
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div style="padding:20px;color:var(--text-tertiary);font-size:13px;">Could not load backup history: ${escapeHtml(err.message)}</div>`;
  }
}

async function refreshBackupStatus() {
  const el = document.getElementById("backup-status-area");
  try {
    const { status } = await api.getBackupStatus();
    const entries = Object.entries(status || {});
    if (entries.length === 0) {
      el.innerHTML =
        '<div style="font-size:13px;color:var(--text-tertiary);">No active backups currently running.</div>';
      return;
    }
    el.innerHTML = entries
      .map(
        ([key, val]) => `
      <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-secondary);">
        <div class="spinner spinner-sm" style="${val.status === "running" ? "" : "display:none"}"></div>
        <span style="font-weight:600;color:var(--text-primary);font-size:13px;">${escapeHtml(val.project || key)}</span>
        <span class="badge ${val.status === "running" ? "badge-warning" : val.status === "completed" ? "badge-success" : "badge-danger"}">
          ${escapeHtml(val.status)}
        </span>
        <span style="font-size:12px;color:var(--text-tertiary);">${escapeHtml(val.progress || "")}</span>
      </div>
    `,
      )
      .join("");
  } catch {}
}

async function triggerProjectBackup(id, name) {
  try {
    toast.info("Backup Queued", `Starting backup for ${name}...`);
    await api.triggerBackup(id);
    toast.success(
      "Backup Started",
      `${name} backup is running in the background`,
    );
    setTimeout(refreshBackupStatus, 1000);
  } catch (err) {
    toast.error("Backup Failed", err.message);
  }
}

async function triggerBackupAll() {
  try {
    toast.info("Backup All", "Starting backups for every website...");
    await api.triggerBackupAll();
    toast.success("Backups Started", "All website backups are running");
    setTimeout(refreshBackupStatus, 1000);
  } catch (err) {
    toast.error("Backup Failed", err.message);
  }
}

async function triggerVPSSnapshot() {
  Modal.confirm(
    "Full VPS Snapshot",
    "This will create a complete system snapshot (databases, configs, and web roots). Depending on size, this may take several minutes. Continue?",
    async () => {
      try {
        toast.info("Snapshot Queued", "Creating full VPS snapshot...");
        await api.triggerVPSSnapshot();
        toast.success(
          "Snapshot Started",
          "VPS snapshot is running in the background",
        );
        setTimeout(refreshBackupStatus, 1000);
      } catch (err) {
        toast.error("Snapshot Failed", err.message);
      }
    },
  );
}

// Restores pick a backup from the list on the website's Backups tab
function showRestoreModal(projectId) {
  window.app.navigate(`site/${projectId}/backups`);
}

async function cleanupAllBackups() {
  Modal.confirm(
    "Cleanup Old Backups",
    "This will delete backup archives exceeding your configured retention period (default 30 days) from remote storage. Continue?",
    async () => {
      await api.cleanupBackups();
      toast.success("Cleanup Complete", "Old backups have been cleared");
      loadBackupHistory();
    },
  );
}

window.renderBackups = renderBackups;
