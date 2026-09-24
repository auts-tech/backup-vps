/**
 * API Client — Handles all HTTP communication with the backend
 * Supports Bearer token authentication (login-based)
 */
class API {
  constructor() {
    this.baseUrl = "/api/v1";
    this.token = localStorage.getItem("vps_auth_token") || "";
  }

  // ── Auth Token Management ────────────────────────────────
  setToken(token) {
    this.token = token;
    localStorage.setItem("vps_auth_token", token);
  }

  getToken() {
    return this.token;
  }

  clearToken() {
    this.token = "";
    localStorage.removeItem("vps_auth_token");
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
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (response.status === 401 || response.status === 403) {
        // Auth failed — redirect to login
        this.clearToken();
        window.app?.showLogin?.();
        throw new Error("Authentication required — please login");
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || data.message || `HTTP ${response.status}`,
        );
      }

      return data;
    } catch (err) {
      if (err.name === "TypeError" && err.message.includes("fetch")) {
        throw new Error("Cannot connect to server");
      }
      throw err;
    }
  }

  get(path) {
    return this.request(path);
  }

  post(path, body) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }

  put(path, body) {
    return this.request(path, { method: "PUT", body: JSON.stringify(body) });
  }

  delete(path) {
    return this.request(path, { method: "DELETE" });
  }

  // ── Auth ─────────────────────────────────────────────────
  async login(email, password) {
    // Login endpoint is public — no token needed
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || "Login failed");
    if (data.token) this.setToken(data.token);
    return data;
  }

  async logout() {
    try {
      await this.post("/auth/logout", {});
    } catch {}
    this.clearToken();
  }

  async checkAuth() {
    try {
      const res = await fetch(`${this.baseUrl}/auth/status`, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      const data = await res.json();
      return data;
    } catch {
      return { authenticated: false };
    }
  }

  // ── Projects ────────────────────────────────────────────
  getProjects() {
    return this.get("/projects");
  }
  getProject(id) {
    return this.get(`/projects/${id}`);
  }
  createProject(data) {
    return this.post("/projects", data);
  }
  updateProject(id, data) {
    return this.put(`/projects/${id}`, data);
  }
  deleteProject(id) {
    return this.delete(`/projects/${id}`);
  }

  // ── Backups ─────────────────────────────────────────────
  getBackups(project) {
    return this.get(`/backups${project ? `?project=${project}` : ""}`);
  }
  triggerBackup(projectId, target) {
    return this.post("/backups/trigger", { projectId, target });
  }
  triggerBackupAll(target) {
    return this.post("/backups/trigger", { target });
  }
  triggerVPSSnapshot(target) {
    return this.post("/backups/trigger-vps", { target });
  }
  restoreBackup(projectId, backupDate, options) {
    return this.post("/backups/restore", { projectId, backupDate, ...options });
  }
  getBackupStatus() {
    return this.get("/backups/status");
  }
  cleanupBackups(project) {
    return this.post("/backups/cleanup", { project });
  }

  // ── Deploy ──────────────────────────────────────────────
  cloneRepo(gitUrl, branch, deployPath, registration = {}) {
    return this.post("/deploy/clone", {
      gitUrl,
      branch,
      deployPath,
      ...registration,
    });
  }
  pullLatest(projectId) {
    return this.post("/deploy/pull", { projectId });
  }
  configureProject(projectId, envVars) {
    return this.post("/deploy/configure", { projectId, envVars });
  }
  startProject(projectId) {
    return this.post("/deploy/start", { projectId });
  }
  stopProject(projectId) {
    return this.post("/deploy/stop", { projectId });
  }
  restartProject(projectId) {
    return this.post("/deploy/restart", { projectId });
  }
  getDeployStatus(id) {
    return this.get(`/deploy/status/${id}`);
  }
  getAllDeployStatuses() {
    return this.get("/deploy/status");
  }

  // ── Cron ────────────────────────────────────────────────
  getCronJobs() {
    return this.get("/cron");
  }
  getCronTasks() {
    return this.get("/cron/tasks");
  }
  previewCron(schedule) {
    return this.post("/cron/preview", { schedule });
  }
  addCronJob(job) {
    return this.post("/cron", job);
  }
  updateCronJob(id, job) {
    return this.put(`/cron/${id}`, job);
  }
  toggleCronJob(id, enabled) {
    return this.post(`/cron/${id}/toggle`, { enabled });
  }
  runCronJob(id) {
    return this.post(`/cron/${id}/run`, {});
  }
  deleteCronJob(id) {
    return this.delete(`/cron/${id}`);
  }
  getCronLog(lines) {
    return this.get(`/cron/log?lines=${lines || 200}`);
  }
  startCronDaemon() {
    return this.post("/cron/daemon/start", {});
  }

  // ── Background jobs ─────────────────────────────────────
  getJob(id, offset) {
    return this.get(`/jobs/${id}?offset=${offset || 0}`);
  }
  getJobs() {
    return this.get("/jobs");
  }
  cancelJob(id) {
    return this.post(`/jobs/${id}/cancel`, {});
  }

  // ── Nginx / Websites ────────────────────────────────────
  getNginxStatus() {
    return this.get("/nginx/status");
  }
  installNginx() {
    return this.post("/nginx/install", {});
  }
  nginxControl(action) {
    return this.post("/nginx/control", { action });
  }
  nginxTest() {
    return this.post("/nginx/test", {});
  }
  getSites() {
    return this.get("/nginx/sites");
  }
  createSite(data) {
    return this.post("/nginx/sites", data);
  }
  getSite(name) {
    return this.get(`/nginx/sites/${encodeURIComponent(name)}`);
  }
  saveSite(name, content) {
    return this.put(`/nginx/sites/${encodeURIComponent(name)}`, { content });
  }
  enableSite(name, enabled) {
    return this.post(`/nginx/sites/${encodeURIComponent(name)}/enable`, {
      enabled,
    });
  }
  setSitePhp(name, version) {
    return this.post(`/nginx/sites/${encodeURIComponent(name)}/php`, {
      version,
    });
  }
  deleteSite(name) {
    return this.delete(`/nginx/sites/${encodeURIComponent(name)}`);
  }
  getSiteLogs(name, type) {
    return this.get(
      `/nginx/sites/${encodeURIComponent(name)}/logs?type=${type}&lines=300`,
    );
  }
  issueSsl(name, data) {
    return this.post(`/nginx/sites/${encodeURIComponent(name)}/ssl`, data);
  }
  getCertificates() {
    return this.get("/nginx/certificates");
  }
  getCertbot() {
    return this.get("/nginx/certbot");
  }
  installCertbot(email) {
    return this.post("/nginx/certbot/install", { email });
  }
  setCertbotEmail(email) {
    return this.put("/nginx/certbot/email", { email });
  }
  testCertbotRenewal() {
    return this.post("/nginx/certbot/test", {});
  }

  // ── System: ports, processes, updates ──────────────────
  getPorts() {
    return this.get("/system/ports");
  }
  killProcess(pid, signal) {
    return this.post(`/system/processes/${pid}/kill`, { signal });
  }
  restartService(unit) {
    return this.post(
      `/system/services/${encodeURIComponent(unit)}/restart`,
      {},
    );
  }
  getVersion() {
    return this.get("/system/version");
  }
  checkUpdate(force) {
    return this.get(`/system/update${force ? "?force=1" : ""}`);
  }
  applyUpdate() {
    return this.post("/system/update", {});
  }
  renewCertificates() {
    return this.post("/nginx/certificates/renew", {});
  }
  deleteCertificate(name) {
    return this.delete(`/nginx/certificates/${encodeURIComponent(name)}`);
  }

  // ── File manager ────────────────────────────────────────
  listFiles(path) {
    return this.get(`/files/list?path=${encodeURIComponent(path)}`);
  }
  readFile(path) {
    return this.get(`/files/read?path=${encodeURIComponent(path)}`);
  }
  writeFile(path, content) {
    return this.put("/files/write", { path, content });
  }
  mkdir(path) {
    return this.post("/files/mkdir", { path });
  }
  createFile(path) {
    return this.post("/files/create", { path });
  }
  renameFile(from, to) {
    return this.post("/files/rename", { from, to });
  }
  copyFile(from, to) {
    return this.post("/files/copy", { from, to });
  }
  deleteFiles(paths) {
    return this.post("/files/delete", { paths });
  }
  chmodFile(path, mode, recursive) {
    return this.post("/files/chmod", { path, mode, recursive });
  }
  chownFile(path, owner, group, recursive) {
    return this.post("/files/chown", { path, owner, group, recursive });
  }
  extractFile(path, dest) {
    return this.post("/files/extract", { path, dest });
  }
  compressFiles(paths, dest, format) {
    return this.post("/files/compress", { paths, dest, format });
  }
  folderSize(path) {
    return this.get(`/files/size?path=${encodeURIComponent(path)}`);
  }
  searchFiles(path, q) {
    return this.get(
      `/files/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}`,
    );
  }
  downloadUrl(path) {
    return `${this.baseUrl}/files/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(this.token)}`;
  }

  /**
   * Upload a File/Blob as a raw body with progress (XHR, so progress events work).
   */
  upload(path, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${this.baseUrl}${path}`);
      xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      if (onProgress)
        xhr.upload.onprogress = (e) =>
          e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else
          reject(new Error(data.error || `Upload failed (HTTP ${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Upload failed — connection lost"));
      xhr.send(file);
    });
  }
  uploadFile(dir, file, overwrite, onProgress) {
    return this.upload(
      `/files/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}${overwrite ? "&overwrite=1" : ""}`,
      file,
      onProgress,
    );
  }

  // ── Databases ───────────────────────────────────────────
  getDbStatus() {
    return this.get("/databases/status");
  }
  installDbServer() {
    return this.post("/databases/install", {});
  }
  connectDb() {
    return this.post("/databases/connect", {});
  }
  setDbCredentials(data) {
    return this.post("/databases/credentials", data);
  }
  getDatabases() {
    return this.get("/databases");
  }
  createDatabase(data) {
    return this.post("/databases", data);
  }
  dropDatabase(name) {
    return this.delete(`/databases/${encodeURIComponent(name)}`);
  }
  runQuery(sql, database) {
    return this.post("/databases/query", { sql, database });
  }
  getTables(db) {
    return this.get(`/databases/${encodeURIComponent(db)}/tables`);
  }
  getTableStructure(db, table) {
    return this.get(
      `/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/structure`,
    );
  }
  getTableRows(db, table, page, perPage) {
    return this.get(
      `/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/rows?page=${page || 1}&perPage=${perPage || 50}`,
    );
  }
  createDbUser(data) {
    return this.post("/databases/users", data);
  }
  dropDbUser(user, host) {
    return this.delete(
      `/databases/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}`,
    );
  }
  setDbUserPassword(user, host, password) {
    return this.post(
      `/databases/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}/password`,
      { password },
    );
  }
  grantDbUser(user, host, database, privileges) {
    return this.post(
      `/databases/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}/grant`,
      { database, privileges },
    );
  }
  revokeDbUser(user, host, database) {
    return this.post(
      `/databases/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}/revoke`,
      { database },
    );
  }
  getDbUserGrants(user, host) {
    return this.get(
      `/databases/users/${encodeURIComponent(user)}/${encodeURIComponent(host)}/grants`,
    );
  }
  exportDbUrl(db) {
    return `${this.baseUrl}/databases/${encodeURIComponent(db)}/export?token=${encodeURIComponent(this.token)}`;
  }
  importDb(db, file, onProgress) {
    return this.upload(
      `/databases/${encodeURIComponent(db)}/import?name=${encodeURIComponent(file.name)}`,
      file,
      onProgress,
    );
  }

  // ── PHP ─────────────────────────────────────────────────
  getPhp() {
    return this.get("/php");
  }
  getPhpAvailable() {
    return this.get("/php/available");
  }
  addPhpRepo() {
    return this.post("/php/repository", {});
  }
  installPhp(version, extensions) {
    return this.post("/php/install", { version, extensions });
  }
  uninstallPhp(version) {
    return this.post(`/php/${version}/uninstall`, {});
  }
  phpControl(version, action) {
    return this.post(`/php/${version}/control`, { action });
  }
  setPhpDefault(version) {
    return this.post(`/php/${version}/default`, {});
  }
  getPhpExtensions(version) {
    return this.get(`/php/${version}/extensions`);
  }
  phpExtension(version, name, action) {
    return this.post(`/php/${version}/extensions`, { name, action });
  }
  getPhpIni(version, sapi) {
    return this.get(`/php/${version}/ini?sapi=${sapi || "fpm"}`);
  }
  savePhpIni(version, sapi, settings) {
    return this.put(`/php/${version}/ini`, { sapi, settings });
  }

  // ── Email ───────────────────────────────────────────────
  getMailStatus() {
    return this.get("/mail/status");
  }
  getMailChecks() {
    return this.get("/mail/checks");
  }
  installMail(data) {
    return this.post("/mail/install", data);
  }
  mailControl(action) {
    return this.post("/mail/control", { action });
  }
  getMailLogs() {
    return this.get("/mail/logs");
  }
  getMailboxes() {
    return this.get("/mail/accounts");
  }
  addMailbox(email, password) {
    return this.post("/mail/accounts", { email, password });
  }
  setMailboxPassword(email, password) {
    return this.post(`/mail/accounts/${encodeURIComponent(email)}/password`, {
      password,
    });
  }
  setMailboxQuota(email, quota) {
    return this.post(`/mail/accounts/${encodeURIComponent(email)}/quota`, {
      quota,
    });
  }
  deleteMailbox(email) {
    return this.delete(`/mail/accounts/${encodeURIComponent(email)}`);
  }
  getMailAliases() {
    return this.get("/mail/aliases");
  }
  addMailAlias(alias, target) {
    return this.post("/mail/aliases", { alias, target });
  }
  deleteMailAlias(alias, target) {
    return this.post("/mail/aliases/delete", { alias, target });
  }
  getMailDns(domain) {
    return this.get(`/mail/dns/${encodeURIComponent(domain)}`);
  }
  generateDkim(domain) {
    return this.post(`/mail/dkim/${encodeURIComponent(domain)}`, {});
  }

  // ── Terminal ────────────────────────────────────────────
  terminalUrl(params = {}) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const q = new URLSearchParams({ token: this.token, ...params });
    return `${proto}//${location.host}${this.baseUrl}/terminal/ws?${q}`;
  }

  // ── Monitor ─────────────────────────────────────────────
  getStats() {
    return this.get("/monitor/stats");
  }
  getProcesses(limit) {
    return this.get(`/monitor/processes${limit ? `?limit=${limit}` : ""}`);
  }
  getHistory() {
    return this.get("/monitor/history");
  }

  // ── Logs ────────────────────────────────────────────────
  getLogs(page, limit, search) {
    const params = new URLSearchParams();
    if (page) params.set("page", page);
    if (limit) params.set("limit", limit);
    if (search) params.set("search", search);
    return this.get(`/logs?${params}`);
  }
  getLogInfo() {
    return this.get("/logs/info");
  }

  // ── Settings ────────────────────────────────────────────
  getSettings() {
    return this.get("/settings");
  }
  updateSettings(data) {
    return this.put("/settings", data);
  }
  testNotification(type, emailTo, emailFrom) {
    return this.post("/settings/test-notification", {
      type,
      emailTo,
      emailFrom,
    });
  }
  testStorage(target) {
    return this.post("/settings/test-storage", { target });
  }
  saveServiceAccount(serviceAccountJson) {
    return this.post("/settings/service-account", { serviceAccountJson });
  }
  runSystemCheck() {
    return this.get("/settings/system-check");
  }
  generateApiKey(apiKey) {
    return this.post("/settings/api-key", { apiKey });
  }
  setupInitial(data) {
    return this.post("/settings/setup", data);
  }

  // ── Health ──────────────────────────────────────────────
  healthCheck() {
    return this.get("/health");
  }
  setupStatus() {
    return this.get("/setup-status");
  }
}

window.api = new API();
