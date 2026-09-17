/**
 * Deploy & Git Management Page
 * Clean white theme with vector icons and deep black text
 */
function renderDeploy(container) {
  const I = window.Icons;

  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Deploy & Git</h2>
          <p>Clone repositories, pull latest commits, and manage live processes</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="loadDeployStatuses()">
            ${I.get('refresh', { size: 13 })}
            <span>Refresh Status</span>
          </button>
          <button class="btn btn-primary" onclick="showCloneModal()">
            ${I.get('rocket', { size: 13, color: '#ffffff' })}
            <span>Clone & Register</span>
          </button>
        </div>
      </div>

      <!-- Quick Deploy Card -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get('download', { size: 16 })}
            <span>Quick Git Clone</span>
          </h3>
        </div>
        <div class="card-body">
          <form id="clone-form" onsubmit="handleCloneSubmit(event)" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px;align-items:end;">
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
              <button type="submit" class="btn btn-primary" id="clone-btn" style="width:100%;height:37px;">
                ${I.get('download', { size: 14, color: '#ffffff' })}
                <span>Clone Repo</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Deployed Applications Process Table -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get('server', { size: 16 })}
            <span>Managed Applications & Daemons</span>
          </h3>
          <span class="badge badge-neutral" id="deploy-count-badge">0 Projects</span>
        </div>
        <div class="table-container" style="border:none;border-radius:0;">
          <table class="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Stack</th>
                <th>Branch</th>
                <th>Server Path</th>
                <th>Process State</th>
                <th style="text-align:right">Controls</th>
              </tr>
            </thead>
            <tbody id="deploy-table-body">
              <tr>
                <td colspan="6" style="text-align:center;padding:40px;">
                  <div class="spinner spinner-lg" style="margin:0 auto 12px;"></div>
                  <div style="color:var(--text-tertiary);font-size:13px;">Checking process status...</div>
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
  const I = window.Icons;
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
          <td colspan="6">
            <div class="empty-state" style="padding:36px 20px;">
              <div class="empty-state-icon">${I.get('package', { size: 20 })}</div>
              <div class="empty-state-title">No Applications Configured</div>
              <div class="empty-state-desc">Use the Quick Git Clone tool above or create a project to manage builds and services.</div>
            </div>
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
        : (pStatus ? '<span class="badge badge-danger"><span class="badge-dot"></span> Stopped</span>' : '<span class="badge badge-neutral"><span class="badge-dot"></span> Inactive</span>');

      return `
        <tr>
          <td>
            <div style="font-weight:600;color:var(--text-primary);font-size:13px;">${escapeHtml(p.name)}</div>
            <div style="font-size:11px;color:var(--text-tertiary);">${escapeHtml(p.description || '')}</div>
          </td>
          <td><span class="badge badge-neutral" style="text-transform:uppercase;font-size:10px;">${escapeHtml(p.type || 'node')}</span></td>
          <td>
            <div style="display:flex;align-items:center;gap:4px;font-size:12px;">
              ${I.get('gitBranch', { size: 13, color: 'var(--text-tertiary)' })}
              <code>${escapeHtml(p.branch || 'main')}</code>
            </div>
          </td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);">${escapeHtml(p.deployPath || '—')}</span>
          </td>
          <td>${statusBadge}</td>
          <td style="text-align:right">
            <div style="display:inline-flex;gap:6px;">
              <button class="btn btn-sm btn-secondary" onclick="pullProject('${p.id}')" title="Git Pull Latest">
                ${I.get('download', { size: 12 })}
                <span>Pull</span>
              </button>
              <button class="btn btn-sm btn-secondary" onclick="configureProject('${p.id}')" title="Run Build / Install">
                ${I.get('settings', { size: 12 })}
                <span>Build</span>
              </button>
              ${isOnline
                ? `
                  <button class="btn btn-sm btn-secondary" onclick="restartProject('${p.id}')" title="Restart Process">
                    ${I.get('refresh', { size: 12 })}
                    <span>Restart</span>
                  </button>
                  <button class="btn btn-sm btn-danger" onclick="stopProject('${p.id}')" title="Stop Process">
                    ${I.get('xCircle', { size: 12 })}
                    <span>Stop</span>
                  </button>
                `
                : `
                  <button class="btn btn-sm btn-primary" onclick="startProject('${p.id}')" title="Start Process">
                    ${I.get('play', { size: 12, color: '#ffffff' })}
                    <span>Start</span>
                  </button>
                `
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
  const I = window.Icons;
  const gitUrl = document.getElementById('git-url').value.trim();
  const branch = document.getElementById('git-branch').value.trim() || 'main';
  const deployPath = document.getElementById('git-path').value.trim();
  const btn = document.getElementById('clone-btn');

  if (!gitUrl || !deployPath) return;

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner spinner-sm" style="margin-right:6px;"></span> Cloning...`;

  try {
    const res = await api.cloneRepo(gitUrl, branch, deployPath);
    toast.success('Cloned', res.message || 'Repository cloned successfully');
    document.getElementById('clone-form').reset();
    loadDeployStatuses();
  } catch (err) {
    toast.error('Clone Failed', err.message || 'Failed to clone repository');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${I.get('download', { size: 14, color: '#ffffff' })} <span>Clone Repo</span>`;
  }
}

async function pullProject(projectId) {
  toast.info('Git Pull', 'Pulling latest git changes...');
  try {
    const res = await api.pullLatest(projectId);
    toast.success('Git Pulled', res.output || 'Latest commits pulled');
    loadDeployStatuses();
  } catch (err) {
    toast.error('Pull Failed', err.message || 'Git pull failed');
  }
}

async function configureProject(projectId) {
  toast.info('Build Started', 'Installing dependencies and compiling...');
  try {
    const res = await api.configureProject(projectId, {});
    toast.success('Build Complete', res.message || 'Project configured successfully');
    loadDeployStatuses();
  } catch (err) {
    toast.error('Build Failed', err.message || 'Configuration failed');
  }
}

async function startProject(projectId) {
  try {
    const res = await api.startProject(projectId);
    toast.success('Started', res.message || 'Application process started');
    loadDeployStatuses();
  } catch (err) {
    toast.error('Start Failed', err.message || 'Start failed');
  }
}

async function stopProject(projectId) {
  try {
    const res = await api.stopProject(projectId);
    toast.success('Stopped', res.message || 'Application process stopped');
    loadDeployStatuses();
  } catch (err) {
    toast.error('Stop Failed', err.message || 'Stop failed');
  }
}

async function restartProject(projectId) {
  try {
    const res = await api.restartProject(projectId);
    toast.success('Restarted', res.message || 'Application process restarted');
    loadDeployStatuses();
  } catch (err) {
    toast.error('Restart Failed', err.message || 'Restart failed');
  }
}

function showCloneModal() {
  Modal.show('Clone & Register New Project', `
    <div class="form-group">
      <label class="form-label">Project Name *</label>
      <input type="text" id="modal-project-name" class="form-input" placeholder="e.g. store-api" required>
    </div>
    <div class="form-group">
      <label class="form-label">Git URL *</label>
      <input type="text" id="modal-project-git" class="form-input" placeholder="https://github.com/org/repo.git" required>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label class="form-label">Branch</label>
        <input type="text" id="modal-project-branch" class="form-input" value="main">
      </div>
      <div class="form-group">
        <label class="form-label">Stack</label>
        <select id="modal-project-type" class="form-select">
          <option value="node">Node.js</option>
          <option value="php">PHP / Apache</option>
          <option value="static">Static Web</option>
          <option value="python">Python</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Deploy Path on Server *</label>
      <input type="text" id="modal-project-path" class="form-input" placeholder="/var/www/store-api" required>
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
        toast.error('Required', 'Please fill in all required fields');
        throw new Error('Please fill in all required fields');
      }

      toast.info('Cloning', 'Cloning repository to server...');
      await api.cloneRepo(gitUrl, branch, deployPath);
      await api.createProject({
        name,
        gitUrl,
        branch,
        type,
        deployPath,
        backupDirs: [deployPath]
      });
      toast.success('Project Created', `${name} cloned and registered`);
      loadDeployStatuses();
    }
  });
}

window.renderDeploy = renderDeploy;
