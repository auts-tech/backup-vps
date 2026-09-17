/**
 * Deploy & Git Management Page
 */
function renderDeploy(container) {
  container.innerHTML = `
    <div class="animate-in">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h2 style="font-size:20px;font-weight:700;">Deploy & Git Manager</h2>
          <p style="font-size:13px;color:var(--text-tertiary);margin-top:4px;">Clone repositories, configure builds, and control application processes</p>
        </div>
        <div class="btn-group">
          <button class="btn btn-secondary" onclick="loadDeployStatuses()">🔄 Refresh Status</button>
          <button class="btn btn-primary" onclick="showCloneModal()">⚡ Clone & Deploy</button>
        </div>
      </div>

      <!-- Quick Deploy Card -->
      <div class="card mb-6 animate-in stagger-1">
        <div class="card-header">
          <h3 class="card-title">🚀 Git Clone & Auto Deploy</h3>
        </div>
        <form id="clone-form" onsubmit="handleCloneSubmit(event)" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:16px;align-items:end;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Git Repository URL</label>
            <input type="text" class="form-input" id="git-url" placeholder="https://github.com/org/repo.git" required>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Branch</label>
            <input type="text" class="form-input" id="git-branch" placeholder="main" value="main">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Destination Path</label>
            <input type="text" class="form-input" id="git-path" placeholder="/var/www/my-app" required>
          </div>
          <div>
            <button type="submit" class="btn btn-primary" id="clone-btn" style="width:100%;height:38px;">
              <span>📥</span> Clone Repository
            </button>
          </div>
        </form>
      </div>

      <!-- Deployed Applications Process Table -->
      <div class="card animate-in stagger-2">
        <div class="card-header">
          <h3 class="card-title">Managed Processes & Applications</h3>
          <span class="badge badge-neutral" id="deploy-count-badge">0 Projects</span>
        </div>
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Type</th>
                <th>Branch</th>
                <th>Deploy Path</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="deploy-table-body">
              <tr>
                <td colspan="6" style="text-align:center;padding:40px;">
                  <div class="spinner spinner-lg" style="margin:0 auto 12px;"></div>
                  <div style="color:var(--text-tertiary);">Loading project statuses...</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  loadDeployStatuses();
}

async function loadDeployStatuses() {
  const tbody = document.getElementById('deploy-table-body');
  const countBadge = document.getElementById('deploy-count-badge');
  if (!tbody) return;

  try {
    const [projectsRes, deployRes] = await Promise.all([
      api.getProjects().catch(() => ({ projects: [] })),
      api.getAllDeployStatuses().catch(() => ({ statuses: [] }))
    ]);

    const projects = projectsRes.projects || [];
    const statuses = deployRes.statuses || [];

    if (countBadge) countBadge.textContent = `${projects.length} Project${projects.length === 1 ? '' : 's'}`;

    if (projects.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;padding:40px;color:var(--text-tertiary);">
            No projects registered yet. Go to <a href="#projects" onclick="window.app.navigate('projects')">Projects</a> to add one, or use Clone above.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = projects.map(p => {
      const pStatus = statuses.find(s => s.name === p.name || s.id === p.id);
      const isOnline = pStatus?.status === 'online' || pStatus?.status === 'active';
      const statusBadge = isOnline
        ? '<span class="badge badge-success"><span class="badge-dot"></span> Online</span>'
        : (pStatus ? '<span class="badge badge-danger"><span class="badge-dot"></span> Stopped</span>' : '<span class="badge badge-neutral">Inactive</span>');

      return `
        <tr>
          <td>
            <strong>${escapeHtml(p.name)}</strong>
            <div style="font-size:11px;color:var(--text-tertiary);">${escapeHtml(p.description || '')}</div>
          </td>
          <td><span class="badge badge-purple">${p.type || 'node'}</span></td>
          <td><code>${escapeHtml(p.branch || 'main')}</code></td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(p.deployPath || '')}">
            <span style="font-family:var(--font-mono);font-size:12px;">${escapeHtml(p.deployPath || '—')}</span>
          </td>
          <td>${statusBadge}</td>
          <td>
            <div class="btn-group">
              <button class="btn btn-sm btn-secondary" onclick="pullProject('${p.id}')" title="Git Pull Latest">⬇️ Pull</button>
              <button class="btn btn-sm btn-secondary" onclick="configureProject('${p.id}')" title="Install Deps & Build">⚙️ Build</button>
              ${isOnline
          ? `<button class="btn btn-sm btn-danger" onclick="stopProject('${p.id}')" title="Stop Process">⏹️ Stop</button>
                   <button class="btn btn-sm btn-secondary" onclick="restartProject('${p.id}')" title="Restart">🔄 Restart</button>`
          : `<button class="btn btn-sm btn-primary" onclick="startProject('${p.id}')" title="Start Process">▶️ Start</button>`
        }
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-red);padding:24px;">Failed to load deploy status: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

async function handleCloneSubmit(e) {
  e.preventDefault();
  const gitUrl = document.getElementById('git-url').value.trim();
  const branch = document.getElementById('git-branch').value.trim() || 'main';
  const deployPath = document.getElementById('git-path').value.trim();
  const btn = document.getElementById('clone-btn');

  if (!gitUrl || !deployPath) return;

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner spinner-sm"></span> Cloning...`;

  try {
    const res = await api.cloneRepo(gitUrl, branch, deployPath);
    Toast.success(res.message || 'Repository cloned successfully!');
    document.getElementById('clone-form').reset();
    loadDeployStatuses();
  } catch (err) {
    Toast.error(err.message || 'Failed to clone repository');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>📥</span> Clone Repository`;
  }
}

async function pullProject(projectId) {
  Toast.info('Pulling latest git changes...');
  try {
    const res = await api.pullLatest(projectId);
    Toast.success(res.output || 'Latest changes pulled!');
    loadDeployStatuses();
  } catch (err) {
    Toast.error(err.message || 'Git pull failed');
  }
}

async function configureProject(projectId) {
  Toast.info('Running build / dependency install...');
  try {
    const res = await api.configureProject(projectId, {});
    Toast.success(res.message || 'Build and configuration completed!');
    loadDeployStatuses();
  } catch (err) {
    Toast.error(err.message || 'Configuration failed');
  }
}

async function startProject(projectId) {
  try {
    const res = await api.startProject(projectId);
    Toast.success(res.message || 'Project started!');
    loadDeployStatuses();
  } catch (err) {
    Toast.error(err.message || 'Start failed');
  }
}

async function stopProject(projectId) {
  try {
    const res = await api.stopProject(projectId);
    Toast.success(res.message || 'Project stopped');
    loadDeployStatuses();
  } catch (err) {
    Toast.error(err.message || 'Stop failed');
  }
}

async function restartProject(projectId) {
  try {
    const res = await api.restartProject(projectId);
    Toast.success(res.message || 'Project restarted');
    loadDeployStatuses();
  } catch (err) {
    Toast.error(err.message || 'Restart failed');
  }
}

function showCloneModal() {
  Modal.show('Clone & Register New Project', `
    <div class="form-group">
      <label class="form-label">Project Name</label>
      <input type="text" id="modal-project-name" class="form-input" placeholder="e.g. nhs-patient-portal" required>
    </div>
    <div class="form-group">
      <label class="form-label">Git URL</label>
      <input type="text" id="modal-project-git" class="form-input" placeholder="https://github.com/user/repo.git" required>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Branch</label>
        <input type="text" id="modal-project-branch" class="form-input" value="main">
      </div>
      <div class="form-group">
        <label class="form-label">Project Type</label>
        <select id="modal-project-type" class="form-select">
          <option value="node">Node.js</option>
          <option value="php">PHP / Apache / Nginx</option>
          <option value="static">Static Web</option>
          <option value="python">Python</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Deploy Path on Server</label>
      <input type="text" id="modal-project-path" class="form-input" placeholder="/var/www/my-app" required>
    </div>
  `, {
    submitText: 'Clone & Register',
    onSubmit: async () => {
      const name = document.getElementById('modal-project-name').value.trim();
      const gitUrl = document.getElementById('modal-project-git').value.trim();
      const branch = document.getElementById('modal-project-branch').value.trim() || 'main';
      const type = document.getElementById('modal-project-type').value;
      const deployPath = document.getElementById('modal-project-path').value.trim();

      if (!name || !gitUrl || !deployPath) {
        Toast.error('Please fill in all required fields');
        return false;
      }

      Toast.info('Cloning and creating project...');
      try {
        await api.cloneRepo(gitUrl, branch, deployPath);
        await api.createProject({
          name,
          gitUrl,
          branch,
          type,
          deployPath,
          backupDirs: [deployPath]
        });
        Toast.success(`Project ${name} created and cloned!`);
        loadDeployStatuses();
        return true;
      } catch (err) {
        Toast.error(err.message || 'Clone failed');
        return false;
      }
    }
  });
}
