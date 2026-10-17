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
          <p>Create database dumps, file snapshots, and whole-server backups</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="triggerBackupAll()" id="backup-all-btn">
            ${I.get("database", { size: 14 })}
            <span>Backup All Projects</span>
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
            ${I.get("package", { size: 16 })}
            <span>Project Backup Targets</span>
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
    const { projects } = await api.getProjects();
    if (projects.length === 0) {
      el.innerHTML = `
        <div class="empty-state" style="padding:32px 20px;">
          <div class="empty-state-icon">${I.get("package", { size: 20 })}</div>
          <div class="empty-state-title">No Projects Configured</div>
          <div class="empty-state-desc">Add a project first to configure backups.</div>
        </div>
      `;
      return;
    }

    el.innerHTML = `
      <div class="table-container" style="border:none;border-radius:0;">
        <table class="table">
          <thead>
            <tr>
              <th>Project Name</th>
              <th>Stack</th>
              <th>Database</th>
              <th>Directories</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${projects
              .map(
                (p) => `
              <tr>
                <td>
                  <strong style="color:var(--text-primary);font-size:13px;">${escapeHtml(p.name)}</strong>
                </td>
                <td><span class="badge badge-neutral" style="text-transform:uppercase;font-size:10px;">${escapeHtml(p.type || "node")}</span></td>
                <td>
                  ${p.database?.name ? `<span style="font-family:var(--font-mono);font-size:12px;">${escapeHtml(p.database.name)}</span>` : '<span style="color:var(--text-tertiary);font-size:12px;">None</span>'}
                </td>
                <td style="font-size:12px;color:var(--text-secondary);">${p.backupDirs?.length || 0} paths</td>
                <td style="text-align:right">
                  <div style="display:inline-flex;gap:6px;">
                    <button class="btn btn-sm btn-primary" onclick="triggerProjectBackup('${p.id}', '${escapeHtml(p.name)}')">
                      ${I.get("database", { size: 12, color: "#ffffff" })}
                      <span>Backup</span>
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="showRestoreModal('${p.id}', '${escapeHtml(p.name)}')">
                      ${I.get("download", { size: 12 })}
                      <span>Restore</span>
                    </button>
                  </div>
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
    toast.info("Backup All", "Starting backups for all projects...");
    await api.triggerBackupAll();
    toast.success("Backups Started", "All project backups are in progress");
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

function showRestoreModal(projectId, projectName) {
  Modal.show(
    "Restore Backup",
    `
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
      Restore a point-in-time snapshot for <strong>${escapeHtml(projectName)}</strong>.
    </p>
    <div class="form-group">
      <label class="form-label">Snapshot Folder Date</label>
      <input class="form-input" id="restore-date" placeholder="e.g. 2026-09-17" required>
      <div class="form-hint">Enter the date folder name as listed in your backup storage</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px;padding:12px;background:#f8fafc;border-radius:var(--radius-sm);border:1px solid var(--border-primary);">
      <label class="form-check">
        <input type="checkbox" id="restore-db-check" checked>
        <span style="font-size:13px;font-weight:500;">Restore Database Dumps</span>
      </label>
      <label class="form-check">
        <input type="checkbox" id="restore-files-check" checked>
        <span style="font-size:13px;font-weight:500;">Restore File Directories</span>
      </label>
      <label class="form-check">
        <input type="checkbox" id="restore-env-check" checked>
        <span style="font-size:13px;font-weight:500;">Restore .env Configurations</span>
      </label>
    </div>
  `,
    {
      submitText: "Start Restore",
      submitClass: "btn-danger-solid",
      onSubmit: async (overlay) => {
        const date = overlay.querySelector("#restore-date").value.trim();
        if (!date) throw new Error("Backup date is required");
        const result = await api.restoreBackup(projectId, date, {
          restoreDb: overlay.querySelector("#restore-db-check").checked,
          restoreFiles: overlay.querySelector("#restore-files-check").checked,
          restoreEnv: overlay.querySelector("#restore-env-check").checked,
        });
        if (result.success) toast.success("Restore Complete", result.message);
        else throw new Error(result.error);
      },
    },
  );
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
