/**
 * Projects management page
 */
function renderProjects(container) {
  container.innerHTML = `
    <div class="animate-in">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h2 style="font-size:20px;font-weight:700;">Projects</h2>
          <p style="font-size:13px;color:var(--text-tertiary);margin-top:4px;">Manage your VPS projects</p>
        </div>
        <button class="btn btn-primary" onclick="showAddProjectModal()">
          <span>➕</span> Add Project
        </button>
      </div>
      <div id="projects-grid" class="grid-auto">
        <div class="loading-overlay"><div class="spinner spinner-lg"></div></div>
      </div>
    </div>
  `;
  loadProjects();
}

async function loadProjects() {
  const grid = document.getElementById('projects-grid');
  try {
    const { projects } = await api.getProjects();

    if (projects.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <div class="empty-state-icon">📦</div>
          <div class="empty-state-title">No projects yet</div>
          <div class="empty-state-desc">Add your first project to start managing backups and deployments.</div>
          <button class="btn btn-primary" onclick="showAddProjectModal()">➕ Add Project</button>
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

    grid.innerHTML = projects.map((p, i) => {
      const status = statuses.find(s => s.name === p.name);
      const statusBadge = status
        ? (status.status === 'online'
          ? '<span class="badge badge-success"><span class="badge-dot"></span> Online</span>'
          : '<span class="badge badge-danger"><span class="badge-dot"></span> Stopped</span>')
        : '<span class="badge badge-neutral">Unknown</span>';

      return `
        <div class="project-card animate-in stagger-${Math.min(i + 1, 6)}">
          <div class="project-card-header">
            <span class="project-card-name">${escapeHtml(p.name)}</span>
            <span class="project-card-type">${p.type || 'node'}</span>
          </div>
          <div class="project-card-desc">${escapeHtml(p.description || 'No description')}</div>
          <div class="project-card-meta">
            ${statusBadge}
            <span>📁 ${p.deployPath || '—'}</span>
          </div>
          <div class="project-card-meta" style="margin-top:6px;">
            <span>🔗 ${p.gitUrl ? p.gitUrl.replace('https://github.com/', '') : 'No repo'}</span>
            <span>🌿 ${p.branch || 'main'}</span>
          </div>
          <div class="project-card-actions">
            <button class="btn btn-sm btn-secondary" onclick="showEditProjectModal('${p.id}')">✏️ Edit</button>
            <button class="btn btn-sm btn-success" onclick="backupProject('${p.id}', '${p.name}')">💾 Backup</button>
            <button class="btn btn-sm btn-danger" onclick="deleteProject('${p.id}', '${escapeHtml(p.name)}')">🗑️</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon">⚠️</div><div class="empty-state-desc">${err.message}</div></div>`;
  }
}

function showAddProjectModal() {
  Modal.show('Add Project', projectFormHtml(), {
    submitText: 'Create Project',
    width: 600,
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
    submitText: 'Update Project',
    width: 600,
    onSubmit: async (overlay) => {
      const data = getProjectFormData(overlay);
      await api.updateProject(id, data);
      toast.success('Project Updated', `${data.name} has been updated`);
      loadProjects();
    }
  });
}

async function deleteProject(id, name) {
  Modal.confirm('Delete Project', `Are you sure you want to delete <strong>${name}</strong>? This only removes it from the manager — no files are deleted from the server.`, async () => {
    await api.deleteProject(id);
    toast.success('Project Deleted', `${name} has been removed`);
    loadProjects();
  });
}

async function backupProject(id, name) {
  try {
    toast.info('Backup Started', `Backing up ${name}...`);
    await api.triggerBackup(id);
    toast.success('Backup Triggered', `${name} backup is running in the background`);
  } catch (err) {
    toast.error('Backup Failed', err.message);
  }
}

function projectFormHtml(project = {}) {
  return `
    <div class="form-group">
      <label class="form-label">Project Name *</label>
      <input class="form-input" id="pf-name" placeholder="my-app" value="${project.name || ''}" required>
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <input class="form-input" id="pf-desc" placeholder="Short description" value="${project.description || ''}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Git URL</label>
        <input class="form-input" id="pf-git" placeholder="https://github.com/user/repo.git" value="${project.gitUrl || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Branch</label>
        <input class="form-input" id="pf-branch" placeholder="main" value="${project.branch || 'main'}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Deploy Path</label>
        <input class="form-input" id="pf-path" placeholder="/var/www/my-app" value="${project.deployPath || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Type</label>
        <select class="form-select" id="pf-type">
          <option value="node" ${project.type === 'node' ? 'selected' : ''}>Node.js</option>
          <option value="php" ${project.type === 'php' ? 'selected' : ''}>PHP</option>
          <option value="static" ${project.type === 'static' ? 'selected' : ''}>Static</option>
        </select>
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border-primary);margin:16px 0;">
    <h4 style="font-size:13px;font-weight:600;margin-bottom:12px;color:var(--text-secondary);">Database Configuration</h4>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">DB Type</label>
        <select class="form-select" id="pf-dbtype">
          <option value="mysql" ${project.database?.type === 'mysql' ? 'selected' : ''}>MySQL / MariaDB</option>
          <option value="postgres" ${project.database?.type === 'postgres' ? 'selected' : ''}>PostgreSQL</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">DB Name</label>
        <input class="form-input" id="pf-dbname" placeholder="my_db" value="${project.database?.name || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">DB User</label>
        <input class="form-input" id="pf-dbuser" placeholder="db_user" value="${project.database?.user || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">DB Password</label>
        <input class="form-input" id="pf-dbpass" type="password" placeholder="••••••" value="${project.database?.password || ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Backup Directories</label>
      <textarea class="form-textarea" id="pf-dirs" placeholder="One path per line, e.g.:\n/var/www/my-app/uploads\n/var/www/my-app/storage">${(project.backupDirs || []).join('\n')}</textarea>
      <div class="form-hint">One directory path per line</div>
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.renderProjects = renderProjects;
