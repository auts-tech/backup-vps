/**
 * Projects management page
 * Clean white theme with vector icons and deep black text
 */
function renderProjects(container) {
  const I = window.Icons;

  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Projects</h2>
          <p>Manage and configure multi-tenant applications on this VPS</p>
        </div>
        <button class="btn btn-primary" onclick="showAddProjectModal()">
          ${I.get('plus', { size: 14 })}
          <span>Add Project</span>
        </button>
      </div>
      <div id="projects-grid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:16px;">
        <div style="text-align:center;padding:40px;grid-column:1/-1;"><div class="spinner spinner-lg"></div></div>
      </div>
    </div>
  `;
  loadProjects();
}

async function loadProjects() {
  const grid = document.getElementById('projects-grid');
  const I = window.Icons;

  try {
    const { projects } = await api.getProjects();

    if (projects.length === 0) {
      grid.innerHTML = `
        <div class="card" style="grid-column:1/-1;">
          <div class="empty-state">
            <div class="empty-state-icon">${I.get('package', { size: 22 })}</div>
            <div class="empty-state-title">No Projects Configured</div>
            <div class="empty-state-desc">Add your first project to start managing automated backups and Git deployments.</div>
            <button class="btn btn-primary" onclick="showAddProjectModal()">
              ${I.get('plus', { size: 14 })}
              <span>Add Project</span>
            </button>
          </div>
        </div>
      `;
      return;
    }

    // Get deploy statuses
    let statuses = [];
    try {
      const result = await api.getAllDeployStatuses();
      statuses = result.statuses || [];
    } catch {}

    grid.innerHTML = projects.map(p => {
      const status = statuses.find(s => s.name === p.name);
      const statusBadge = status
        ? (status.status === 'online'
          ? '<span class="badge badge-success"><span class="badge-dot"></span> Online</span>'
          : '<span class="badge badge-danger"><span class="badge-dot"></span> Stopped</span>')
        : '<span class="badge badge-neutral"><span class="badge-dot"></span> Inactive</span>';

      return `
        <div class="card" style="display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div class="card-header" style="background:#fafafa;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-weight:700;color:var(--text-primary);font-size:14px;">${escapeHtml(p.name)}</span>
                <span class="badge badge-neutral" style="text-transform:uppercase;font-size:10px;">${escapeHtml(p.type || 'node')}</span>
              </div>
              ${statusBadge}
            </div>

            <div class="card-body" style="padding:16px;">
              <p style="font-size:13px;color:var(--text-secondary);min-height:36px;margin-bottom:14px;">
                ${escapeHtml(p.description || 'No description provided')}
              </p>

              <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--text-secondary);padding:10px 12px;background:#f8fafc;border-radius:var(--radius-sm);border:1px solid var(--border-primary);">
                <div style="display:flex;align-items:center;gap:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${I.get('folder', { size: 14, color: 'var(--text-tertiary)' })}
                  <span style="font-family:var(--font-mono);">${escapeHtml(p.deployPath || '—')}</span>
                </div>

                <div style="display:flex;align-items:center;justify-content:space-between;">
                  <div style="display:flex;align-items:center;gap:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${I.get('gitBranch', { size: 14, color: 'var(--text-tertiary)' })}
                    <span>${escapeHtml(p.branch || 'main')}</span>
                  </div>
                  ${p.gitUrl ? `
                    <a href="${p.gitUrl.replace('.git', '')}" target="_blank" style="display:flex;align-items:center;gap:4px;color:var(--text-primary);font-size:11px;">
                      ${I.get('externalLink', { size: 12 })}
                      <span>Repo</span>
                    </a>
                  ` : ''}
                </div>
              </div>
            </div>
          </div>

          <div style="padding:12px 16px;border-top:1px solid var(--border-primary);display:flex;justify-content:space-between;align-items:center;background:#ffffff;">
            <div style="display:flex;gap:6px;">
              <button class="btn btn-sm btn-secondary" onclick="showEditProjectModal('${p.id}')">
                ${I.get('edit', { size: 12 })}
                <span>Edit</span>
              </button>
              <button class="btn btn-sm btn-secondary" onclick="backupProject('${p.id}', '${escapeHtml(p.name)}')">
                ${I.get('database', { size: 12 })}
                <span>Backup</span>
              </button>
            </div>
            <button class="btn btn-sm btn-danger" onclick="deleteProject('${p.id}', '${escapeHtml(p.name)}')" title="Delete Project">
              ${I.get('trash', { size: 12 })}
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    grid.innerHTML = `
      <div class="card" style="grid-column:1/-1;">
        <div class="empty-state">
          <div class="empty-state-icon" style="color:var(--color-red);">${I.get('alertTriangle', { size: 22 })}</div>
          <div class="empty-state-title">Failed to load projects</div>
          <div class="empty-state-desc">${escapeHtml(err.message)}</div>
        </div>
      </div>
    `;
  }
}

function showAddProjectModal() {
  Modal.show('Add Project', projectFormHtml(), {
    submitText: 'Create Project',
    width: 580,
    onSubmit: async (overlay) => {
      const data = getProjectFormData(overlay);
      await api.createProject(data);
      toast.success('Project Created', `${data.name} has been added`);
      loadProjects();
    }
  });
}

async function showEditProjectModal(id) {
  const project = await api.getProject(id);
  Modal.show('Edit Project', projectFormHtml(project), {
    submitText: 'Save Changes',
    width: 580,
    onSubmit: async (overlay) => {
      const data = getProjectFormData(overlay);
      await api.updateProject(id, data);
      toast.success('Project Updated', `${data.name} has been updated`);
      loadProjects();
    }
  });
}

async function deleteProject(id, name) {
  Modal.confirm('Delete Project', `Are you sure you want to delete <strong>${name}</strong>? This only removes it from the manager registry — no server files are deleted.`, async () => {
    await api.deleteProject(id);
    toast.success('Project Deleted', `${name} has been removed`);
    loadProjects();
  });
}

async function backupProject(id, name) {
  try {
    toast.info('Backup Queued', `Starting backup for ${name}...`);
    await api.triggerBackup(id);
    toast.success('Backup Running', `${name} snapshot is in progress`);
  } catch (err) {
    toast.error('Backup Failed', err.message);
  }
}

function projectFormHtml(project = {}) {
  return `
    <div class="form-group">
      <label class="form-label">Project Name *</label>
      <input class="form-input" id="pf-name" placeholder="e.g. store-backend" value="${escapeHtml(project.name || '')}" required>
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <input class="form-input" id="pf-desc" placeholder="Production API service" value="${escapeHtml(project.description || '')}">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label class="form-label">Git URL</label>
        <input class="form-input" id="pf-git" placeholder="https://github.com/org/repo.git" value="${escapeHtml(project.gitUrl || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Branch</label>
        <input class="form-input" id="pf-branch" placeholder="main" value="${escapeHtml(project.branch || 'main')}">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label class="form-label">Deploy Path</label>
        <input class="form-input" id="pf-path" placeholder="/var/www/my-app" value="${escapeHtml(project.deployPath || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Application Stack</label>
        <select class="form-select" id="pf-type">
          <option value="node" ${project.type === 'node' ? 'selected' : ''}>Node.js / Express / Nest</option>
          <option value="php" ${project.type === 'php' ? 'selected' : ''}>PHP / Laravel / WordPress</option>
          <option value="static" ${project.type === 'static' ? 'selected' : ''}>Static HTML / Nginx</option>
        </select>
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border-primary);margin:16px 0;">
    <h4 style="font-size:13px;font-weight:700;margin-bottom:12px;color:var(--text-primary);">Database Configuration</h4>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label class="form-label">DB Engine</label>
        <select class="form-select" id="pf-dbtype">
          <option value="mysql" ${project.database?.type === 'mysql' ? 'selected' : ''}>MySQL / MariaDB</option>
          <option value="postgres" ${project.database?.type === 'postgres' ? 'selected' : ''}>PostgreSQL</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Database Name</label>
        <input class="form-input" id="pf-dbname" placeholder="app_db" value="${escapeHtml(project.database?.name || '')}">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label class="form-label">DB Username</label>
        <input class="form-input" id="pf-dbuser" placeholder="app_user" value="${escapeHtml(project.database?.user || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">DB Password</label>
        <input class="form-input" id="pf-dbpass" type="password" placeholder="••••••••" value="${escapeHtml(project.database?.password || '')}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Directory Paths to Backup</label>
      <textarea class="form-textarea" id="pf-dirs" rows="3" placeholder="/var/www/my-app/uploads&#10;/var/www/my-app/storage">${(project.backupDirs || []).join('\n')}</textarea>
      <div class="form-hint">One absolute directory path per line</div>
    </div>
  `;
}

function getProjectFormData(overlay) {
  return {
    name: overlay.querySelector('#pf-name').value.trim(),
    description: overlay.querySelector('#pf-desc').value.trim(),
    gitUrl: overlay.querySelector('#pf-git').value.trim(),
    branch: overlay.querySelector('#pf-branch').value.trim() || 'main',
    deployPath: overlay.querySelector('#pf-path').value.trim(),
    type: overlay.querySelector('#pf-type').value,
    database: {
      type: overlay.querySelector('#pf-dbtype').value,
      name: overlay.querySelector('#pf-dbname').value.trim(),
      user: overlay.querySelector('#pf-dbuser').value.trim(),
      password: overlay.querySelector('#pf-dbpass').value
    },
    backupDirs: overlay.querySelector('#pf-dirs').value.split('\n').map(d => d.trim()).filter(Boolean)
  };
}

window.renderProjects = renderProjects;
