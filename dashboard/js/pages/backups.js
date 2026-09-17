/**
 * Backups management page
 */
function renderBackups(container) {
  container.innerHTML = `
    <div class="animate-in">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h2 style="font-size:20px;font-weight:700;">Backups</h2>
          <p style="font-size:13px;color:var(--text-tertiary);margin-top:4px;">Trigger, manage, and restore backups</p>
        </div>
        <div class="btn-group">
          <button class="btn btn-secondary" onclick="triggerBackupAll()" id="backup-all-btn">💾 Backup All</button>
          <button class="btn btn-primary" onclick="triggerVPSSnapshot()">📸 VPS Snapshot</button>
        </div>
      </div>

      <!-- Backup Status -->
      <div class="card mb-6 animate-in stagger-1">
        <div class="card-header">
          <h3 class="card-title">Backup Status</h3>
          <button class="btn btn-sm btn-secondary" onclick="refreshBackupStatus()">🔄 Refresh</button>
        </div>
        <div id="backup-status-area">
          <div style="font-size:13px;color:var(--text-tertiary);">No active backups</div>
        </div>
      </div>

      <!-- Per-project backup -->
      <div class="card mb-6 animate-in stagger-2">
        <div class="card-header">
          <h3 class="card-title">Backup by Project</h3>
        </div>
        <div id="backup-projects-list">
          <div class="loading-overlay"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Backup History -->
      <div class="card animate-in stagger-3">
        <div class="card-header">
          <h3 class="card-title">Backup History</h3>
          <button class="btn btn-sm btn-danger" onclick="cleanupAllBackups()">🗑️ Cleanup Old</button>
        </div>
        <div id="backup-history">
          <div class="loading-overlay"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;
  loadBackupPage();
}

async function loadBackupPage() {
  await Promise.all([loadBackupProjects(), loadBackupHistory(), refreshBackupStatus()]);
}

async function loadBackupProjects() {
  const el = document.getElementById('backup-projects-list');
  try {
    const { projects } = await api.getProjects();
    if (projects.length === 0) {
      el.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);">No projects configured. Add a project first.</div>';
      return;
    }

    el.innerHTML = `
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Type</th>
              <th>Database</th>
              <th>Directories</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${projects.map(p => `
              <tr>
                <td><strong style="color:var(--text-primary)">${p.name}</strong></td>
                <td><span class="badge badge-info">${p.type || 'node'}</span></td>
                <td>${p.database?.name || '<span style="color:var(--text-tertiary)">None</span>'}</td>
                <td>${p.backupDirs?.length || 0} dirs</td>
                <td style="text-align:right">
                  <div class="btn-group" style="justify-content:flex-end;">
                    <button class="btn btn-sm btn-primary" onclick="triggerProjectBackup('${p.id}', '${p.name}')">💾 Backup</button>
                    <button class="btn btn-sm btn-secondary" onclick="showRestoreModal('${p.id}', '${p.name}')">⏮️ Restore</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div style="color:var(--color-red)">${err.message}</div>`;
  }
}

async function loadBackupHistory() {
  const el = document.getElementById('backup-history');
  try {
    const { backups } = await api.getBackups();
    if (backups.length === 0) {
      el.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);">No backups found in remote storage.</div>';
      return;
    }
    el.innerHTML = `
      <div class="table-container">
        <table class="table">
          <thead><tr><th>Backup</th><th>Date</th></tr></thead>
          <tbody>
            ${backups.slice(0, 20).map(b => `
              <tr>
                <td><span class="mono">${b.name}</span></td>
                <td>${b.date ? new Date(b.date).toLocaleString() : b.name}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div style="font-size:13px;color:var(--text-tertiary);">Could not load backup history: ${err.message}</div>`;
  }
}

async function refreshBackupStatus() {
  const el = document.getElementById('backup-status-area');
  try {
    const { status } = await api.getBackupStatus();
    const entries = Object.entries(status);
    if (entries.length === 0) {
      el.innerHTML = '<div style="font-size:13px;color:var(--text-tertiary);">No active backups</div>';
      return;
    }
    el.innerHTML = entries.map(([key, val]) => `
      <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-primary);">
        <div class="spinner" style="${val.status === 'running' ? '' : 'display:none'}"></div>
        <span style="font-weight:600;color:var(--text-primary)">${val.project || key}</span>
        <span class="badge ${val.status === 'running' ? 'badge-warning' : val.status === 'completed' ? 'badge-success' : 'badge-danger'}">
          ${val.status}
        </span>
        <span style="font-size:12px;color:var(--text-tertiary)">${val.progress || ''}</span>
      </div>
    `).join('');
  } catch {}
}

async function triggerProjectBackup(id, name) {
  try {
    toast.info('Backup Started', `Backing up ${name}...`);
    await api.triggerBackup(id);
    toast.success('Backup Triggered', `${name} backup is running`);
    setTimeout(refreshBackupStatus, 1000);
  } catch (err) {
    toast.error('Backup Failed', err.message);
  }
}

async function triggerBackupAll() {
  try {
    toast.info('Backup All', 'Starting backup for all projects...');
    await api.triggerBackupAll();
    toast.success('Backups Triggered', 'All project backups are running');
    setTimeout(refreshBackupStatus, 1000);
  } catch (err) {
    toast.error('Backup Failed', err.message);
  }
}

async function triggerVPSSnapshot() {
  Modal.confirm('VPS Snapshot', 'This will create a full VPS filesystem backup. This may take a long time and use significant storage. Continue?', async () => {
    try {
      toast.info('VPS Snapshot', 'Creating full VPS snapshot...');
      await api.triggerVPSSnapshot();
      toast.success('Snapshot Started', 'VPS snapshot is running in the background');
      setTimeout(refreshBackupStatus, 1000);
    } catch (err) {
      toast.error('Snapshot Failed', err.message);
    }
  });
}

function showRestoreModal(projectId, projectName) {
  Modal.show('Restore Backup', `
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Restore a backup for <strong>${projectName}</strong></p>
    <div class="form-group">
      <label class="form-label">Backup Date (folder name)</label>
      <input class="form-input" id="restore-date" placeholder="2026-09-17">
    </div>
    <div class="form-group">
      <div class="form-toggle"><div class="toggle-switch active" id="restore-db-toggle" onclick="this.classList.toggle('active')"></div><span style="font-size:13px">Restore Database</span></div>
    </div>
    <div class="form-group">
      <div class="form-toggle"><div class="toggle-switch active" id="restore-files-toggle" onclick="this.classList.toggle('active')"></div><span style="font-size:13px">Restore Files</span></div>
    </div>
    <div class="form-group">
      <div class="form-toggle"><div class="toggle-switch active" id="restore-env-toggle" onclick="this.classList.toggle('active')"></div><span style="font-size:13px">Restore .env</span></div>
    </div>
  `, {
    submitText: 'Restore',
    submitClass: 'btn-danger',
    onSubmit: async (overlay) => {
      const date = overlay.querySelector('#restore-date').value.trim();
      if (!date) throw new Error('Backup date is required');
      const result = await api.restoreBackup(projectId, date, {
        restoreDb: overlay.querySelector('#restore-db-toggle').classList.contains('active'),
        restoreFiles: overlay.querySelector('#restore-files-toggle').classList.contains('active'),
        restoreEnv: overlay.querySelector('#restore-env-toggle').classList.contains('active')
      });
      if (result.success) toast.success('Restore Complete', result.message);
      else throw new Error(result.error);
    }
  });
}

async function cleanupAllBackups() {
  Modal.confirm('Cleanup Old Backups', 'This will delete backups older than the retention period from remote storage. Continue?', async () => {
    await api.cleanupBackups();
    toast.success('Cleanup Complete', 'Old backups have been removed');
    loadBackupHistory();
  });
}

window.renderBackups = renderBackups;
