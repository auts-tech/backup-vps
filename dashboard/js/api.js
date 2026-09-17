/**
 * API Client — Handles all HTTP communication with the backend
 * Supports Bearer token authentication (login-based)
 */
class API {
  constructor() {
    this.baseUrl = '/api/v1';
    this.token = localStorage.getItem('vps_auth_token') || '';
  }

  // ── Auth Token Management ────────────────────────────────
  setToken(token) {
    this.token = token;
    localStorage.setItem('vps_auth_token', token);
  }

  getToken() {
    return this.token;
  }

  clearToken() {
    this.token = '';
    localStorage.removeItem('vps_auth_token');
  }

  isLoggedIn() {
    return !!this.token;
  }

  // Keep legacy API key support for backwards compat
  setApiKey(key) {
    this.setToken(key);
  }

  getApiKey() {
    return this.getToken();
  }

  // ── HTTP Request Layer ───────────────────────────────────
  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (response.status === 401 || response.status === 403) {
        // Auth failed — redirect to login
        this.clearToken();
        window.app?.showLogin?.();
        throw new Error('Authentication required — please login');
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || `HTTP ${response.status}`);
      }

      return data;
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Cannot connect to server');
      }
      throw err;
    }
  }

  get(path) {
    return this.request(path);
  }

  post(path, body) {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) });
  }

  put(path, body) {
    return this.request(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  }

  // ── Auth ─────────────────────────────────────────────────
  async login(email, password) {
    // Login endpoint is public — no token needed
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || 'Login failed');
    if (data.token) this.setToken(data.token);
    return data;
  }

  async logout() {
    try {
      await this.post('/auth/logout', {});
    } catch { }
    this.clearToken();
  }

  async checkAuth() {
    try {
      const res = await fetch(`${this.baseUrl}/auth/status`, {
        headers: this.token ? { 'Authorization': `Bearer ${this.token}` } : {}
      });
      const data = await res.json();
      return data;
    } catch {
      return { authenticated: false };
    }
  }

  // ── Projects ────────────────────────────────────────────
  getProjects() { return this.get('/projects'); }
  getProject(id) { return this.get(`/projects/${id}`); }
  createProject(data) { return this.post('/projects', data); }
  updateProject(id, data) { return this.put(`/projects/${id}`, data); }
  deleteProject(id) { return this.delete(`/projects/${id}`); }

  // ── Backups ─────────────────────────────────────────────
  getBackups(project) { return this.get(`/backups${project ? `?project=${project}` : ''}`); }
  triggerBackup(projectId, target) { return this.post('/backups/trigger', { projectId, target }); }
  triggerBackupAll(target) { return this.post('/backups/trigger', { target }); }
  triggerVPSSnapshot(target) { return this.post('/backups/trigger-vps', { target }); }
  restoreBackup(projectId, backupDate, options) { return this.post('/backups/restore', { projectId, backupDate, ...options }); }
  getBackupStatus() { return this.get('/backups/status'); }
  cleanupBackups(project) { return this.post('/backups/cleanup', { project }); }

  // ── Deploy ──────────────────────────────────────────────
  cloneRepo(gitUrl, branch, deployPath) { return this.post('/deploy/clone', { gitUrl, branch, deployPath }); }
  pullLatest(projectId) { return this.post('/deploy/pull', { projectId }); }
  configureProject(projectId, envVars) { return this.post('/deploy/configure', { projectId, envVars }); }
  startProject(projectId) { return this.post('/deploy/start', { projectId }); }
  stopProject(projectId) { return this.post('/deploy/stop', { projectId }); }
  restartProject(projectId) { return this.post('/deploy/restart', { projectId }); }
  getDeployStatus(id) { return this.get(`/deploy/status/${id}`); }
  getAllDeployStatuses() { return this.get('/deploy/status'); }

  // ── Cron ────────────────────────────────────────────────
  getCronJobs() { return this.get('/cron'); }
  addCronJob(schedule, command) { return this.post('/cron', { schedule, command }); }
  updateCronJob(id, schedule, command) { return this.put(`/cron/${id}`, { schedule, command }); }
  deleteCronJob(id) { return this.delete(`/cron/${id}`); }

  // ── Monitor ─────────────────────────────────────────────
  getStats() { return this.get('/monitor/stats'); }
  getProcesses(limit) { return this.get(`/monitor/processes${limit ? `?limit=${limit}` : ''}`); }
  getHistory() { return this.get('/monitor/history'); }

  // ── Logs ────────────────────────────────────────────────
  getLogs(page, limit, search) {
    const params = new URLSearchParams();
    if (page) params.set('page', page);
    if (limit) params.set('limit', limit);
    if (search) params.set('search', search);
    return this.get(`/logs?${params}`);
  }
  getLogInfo() { return this.get('/logs/info'); }

  // ── Settings ────────────────────────────────────────────
  getSettings() { return this.get('/settings'); }
  updateSettings(data) { return this.put('/settings', data); }
  testNotification(type, emailTo, emailFrom) { return this.post('/settings/test-notification', { type, emailTo, emailFrom }); }
  testStorage(target) { return this.post('/settings/test-storage', { target }); }
  saveServiceAccount(serviceAccountJson) { return this.post('/settings/service-account', { serviceAccountJson }); }
  runSystemCheck() { return this.get('/settings/system-check'); }
  generateApiKey(apiKey) { return this.post('/settings/api-key', { apiKey }); }
  setupInitial(data) { return this.post('/settings/setup', data); }

  // ── Health ──────────────────────────────────────────────
  healthCheck() { return this.get('/health'); }
  setupStatus() { return this.get('/setup-status'); }
}

window.api = new API();
