/**
 * System Settings & Configuration Page
 */
function renderSettings(container) {
  container.innerHTML = `
    <div class="animate-in">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h2 style="font-size:20px;font-weight:700;">System Settings</h2>
          <p style="font-size:13px;color:var(--text-tertiary);margin-top:4px;">Configure notifications, cloud backup remotes, and API security</p>
        </div>
        <button class="btn btn-primary" onclick="saveAllSettings()">💾 Save Settings</button>
      </div>

      <div class="grid-2">
        <!-- Notifications Card -->
        <div class="card animate-in stagger-1">
          <div class="card-header">
            <h3 class="card-title">🔔 Notifications</h3>
          </div>

          <!-- Discord -->
          <div style="margin-bottom:24px;border-bottom:1px solid var(--border-primary);padding-bottom:20px;">
            <div class="flex justify-between items-center mb-3">
              <div class="flex items-center gap-2">
                <span style="font-size:18px;">💬</span>
                <strong>Discord Webhook</strong>
              </div>
              <label class="switch">
                <input type="checkbox" id="discord-enabled">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group mb-2">
              <label class="form-label">Webhook URL</label>
              <input type="url" id="discord-webhook" class="form-input" placeholder="https://discord.com/api/webhooks/...">
            </div>
            <button class="btn btn-sm btn-secondary" onclick="testNotification('discord')">🧪 Test Discord</button>
          </div>

          <!-- Email / msmtp -->
          <div>
            <div class="flex justify-between items-center mb-3">
              <div class="flex items-center gap-2">
                <span style="font-size:18px;">📧</span>
                <strong>Email Alert (msmtp)</strong>
              </div>
              <label class="switch">
                <input type="checkbox" id="email-enabled">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Recipient Email (To)</label>
                <input type="email" id="email-to" class="form-input" placeholder="alerts@example.com">
              </div>
              <div class="form-group">
                <label class="form-label">Sender Email (From)</label>
                <input type="email" id="email-from" class="form-input" placeholder="vps-backup@example.com">
              </div>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="testNotification('email')">🧪 Test Email</button>
          </div>
        </div>

        <!-- Security / API Key -->
        <div class="card animate-in stagger-2">
          <div class="card-header">
            <h3 class="card-title">🔐 Authentication & API Key</h3>
          </div>
          <p style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px;">
            Your API key secures dashboard management endpoints. It must be provided in the <code>X-API-Key</code> HTTP header or saved in your browser session.
          </p>

          <div class="form-group">
            <label class="form-label">Current API Key</label>
            <div class="flex gap-2">
              <input type="password" id="current-api-key" class="form-input" readonly>
              <button class="btn btn-secondary" onclick="toggleApiKeyVisibility()" id="toggle-key-btn">👁️</button>
              <button class="btn btn-secondary" onclick="copyCurrentApiKey()">📋</button>
            </div>
          </div>

          <div class="btn-group mt-4">
            <button class="btn btn-sm btn-secondary" onclick="regenerateApiKey()">🔑 Generate New Key</button>
            <button class="btn btn-sm btn-primary" onclick="applyApiKeyFromInput()">💾 Apply to Session</button>
          </div>
        </div>

        <!-- Backup Retention & Targets -->
        <div class="card animate-in stagger-3" style="grid-column:1/-1;">
          <div class="card-header">
            <h3 class="card-title">☁️ Backup Targets & Cloud Remotes</h3>
          </div>

          <div class="form-row mb-4">
            <div class="form-group">
              <label class="form-label">Retention Policy (Days)</label>
              <input type="number" id="retention-days" class="form-input" min="1" max="365" value="30">
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">Backups older than this will be pruned on cleanup</div>
            </div>
            <div class="form-group">
              <label class="form-label">Default Target Remote</label>
              <select id="default-target" class="form-select">
                <option value="gdrive">Google Drive (rclone)</option>
                <option value="s3">Amazon S3</option>
                <option value="sftp">SFTP Server</option>
              </select>
            </div>
          </div>

          <!-- Tabs for Cloud Remotes -->
          <div style="display:flex;gap:8px;border-bottom:1px solid var(--border-primary);margin-bottom:16px;padding-bottom:8px;">
            <button class="btn btn-sm btn-secondary active" id="tab-btn-gdrive" onclick="switchTargetTab('gdrive')">Google Drive</button>
            <button class="btn btn-sm btn-secondary" id="tab-btn-s3" onclick="switchTargetTab('s3')">Amazon S3</button>
            <button class="btn btn-sm btn-secondary" id="tab-btn-sftp" onclick="switchTargetTab('sftp')">SFTP Remote</button>
          </div>

          <!-- GDrive Tab -->
          <div id="target-tab-gdrive">
            <div class="flex justify-between items-center mb-3">
              <strong>Google Drive (via rclone)</strong>
              <label class="switch">
                <input type="checkbox" id="gdrive-enabled" checked>
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">rclone Remote Name</label>
                <input type="text" id="gdrive-remote" class="form-input" placeholder="gdrive-backup" value="gdrive-backup">
              </div>
              <div class="form-group">
                <label class="form-label">Base Path in Drive</label>
                <input type="text" id="gdrive-base-path" class="form-input" placeholder="backups" value="backups">
              </div>
            </div>
          </div>

          <!-- S3 Tab -->
          <div id="target-tab-s3" style="display:none;">
            <div class="flex justify-between items-center mb-3">
              <strong>Amazon S3 Bucket</strong>
              <label class="switch">
                <input type="checkbox" id="s3-enabled">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">S3 Bucket</label>
                <input type="text" id="s3-bucket" class="form-input" placeholder="my-vps-backups">
              </div>
              <div class="form-group">
                <label class="form-label">AWS Region</label>
                <input type="text" id="s3-region" class="form-input" placeholder="eu-west-2">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Access Key ID</label>
                <input type="text" id="s3-access-key" class="form-input" placeholder="AKIA...">
              </div>
              <div class="form-group">
                <label class="form-label">Secret Access Key</label>
                <input type="password" id="s3-secret-key" class="form-input" placeholder="Secret Key">
              </div>
            </div>
          </div>

          <!-- SFTP Tab -->
          <div id="target-tab-sftp" style="display:none;">
            <div class="flex justify-between items-center mb-3">
              <strong>SFTP Server Remote</strong>
              <label class="switch">
                <input type="checkbox" id="sftp-enabled">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Host / IP</label>
                <input type="text" id="sftp-host" class="form-input" placeholder="backup.myserver.com">
              </div>
              <div class="form-group">
                <label class="form-label">Port</label>
                <input type="number" id="sftp-port" class="form-input" value="22">
              </div>
              <div class="form-group">
                <label class="form-label">Username</label>
                <input type="text" id="sftp-user" class="form-input" placeholder="backupuser">
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  loadSettings();
}

async function loadSettings() {
  try {
    const s = await api.getSettings();

    // Notifications
    if (s.notifications?.discord) {
      document.getElementById('discord-enabled').checked = !!s.notifications.discord.enabled;
      document.getElementById('discord-webhook').value = s.notifications.discord.webhookUrl || '';
    }
    if (s.notifications?.email) {
      document.getElementById('email-enabled').checked = !!s.notifications.email.enabled;
      document.getElementById('email-to').value = s.notifications.email.to || '';
      document.getElementById('email-from').value = s.notifications.email.from || '';
    }

    // Retention & Target
    if (s.backup) {
      document.getElementById('retention-days').value = s.backup.retentionDays || 30;
      document.getElementById('default-target').value = s.backup.defaultTarget || 'gdrive';

      const targets = s.backup.targets || {};
      if (targets.gdrive) {
        document.getElementById('gdrive-enabled').checked = !!targets.gdrive.enabled;
        document.getElementById('gdrive-remote').value = targets.gdrive.remoteName || 'gdrive-backup';
        document.getElementById('gdrive-base-path').value = targets.gdrive.basePath || 'backups';
      }
      if (targets.s3) {
        document.getElementById('s3-enabled').checked = !!targets.s3.enabled;
        document.getElementById('s3-bucket').value = targets.s3.bucket || '';
        document.getElementById('s3-region').value = targets.s3.region || '';
      }
      if (targets.sftp) {
        document.getElementById('sftp-enabled').checked = !!targets.sftp.enabled;
        document.getElementById('sftp-host').value = targets.sftp.host || '';
        document.getElementById('sftp-port').value = targets.sftp.port || 22;
        document.getElementById('sftp-user').value = targets.sftp.user || '';
      }
    }

    // API Key
    const keyInput = document.getElementById('current-api-key');
    const storedKey = api.getApiKey();
    if (keyInput) {
      keyInput.value = storedKey || '(no key configured)';
    }

  } catch (err) {
    Toast.error('Failed to load settings: ' + err.message);
  }
}

async function saveAllSettings() {
  try {
    const payload = {
      notifications: {
        discord: {
          enabled: document.getElementById('discord-enabled').checked,
          webhookUrl: document.getElementById('discord-webhook').value.trim()
        },
        email: {
          enabled: document.getElementById('email-enabled').checked,
          to: document.getElementById('email-to').value.trim(),
          from: document.getElementById('email-from').value.trim(),
          msmtpConfigured: true
        }
      },
      backup: {
        retentionDays: parseInt(document.getElementById('retention-days').value) || 30,
        defaultTarget: document.getElementById('default-target').value,
        targets: {
          gdrive: {
            enabled: document.getElementById('gdrive-enabled').checked,
            remoteName: document.getElementById('gdrive-remote').value.trim(),
            basePath: document.getElementById('gdrive-base-path').value.trim()
          },
          s3: {
            enabled: document.getElementById('s3-enabled').checked,
            bucket: document.getElementById('s3-bucket').value.trim(),
            region: document.getElementById('s3-region').value.trim(),
            accessKey: document.getElementById('s3-access-key').value.trim(),
            secretKey: document.getElementById('s3-secret-key').value.trim()
          },
          sftp: {
            enabled: document.getElementById('sftp-enabled').checked,
            host: document.getElementById('sftp-host').value.trim(),
            port: parseInt(document.getElementById('sftp-port').value) || 22,
            user: document.getElementById('sftp-user').value.trim()
          }
        }
      }
    };

    await api.updateSettings(payload);
    Toast.success('Settings saved successfully!');
  } catch (err) {
    Toast.error(err.message || 'Failed to save settings');
  }
}

async function testNotification(type) {
  Toast.info(`Sending test ${type} alert...`);
  try {
    const res = await api.testNotification(type);
    Toast.success(res.results?.[type]?.message || 'Test notification dispatched!');
  } catch (err) {
    Toast.error(err.message || `Test ${type} notification failed`);
  }
}

function switchTargetTab(target) {
  ['gdrive', 's3', 'sftp'].forEach(t => {
    const el = document.getElementById(`target-tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (el) el.style.display = t === target ? 'block' : 'none';
    if (btn) {
      if (t === target) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
}

function toggleApiKeyVisibility() {
  const el = document.getElementById('current-api-key');
  const btn = document.getElementById('toggle-key-btn');
  if (!el) return;
  if (el.type === 'password') {
    el.type = 'text';
    btn.textContent = '🔒';
  } else {
    el.type = 'password';
    btn.textContent = '👁️';
  }
}

function copyCurrentApiKey() {
  const el = document.getElementById('current-api-key');
  if (!el || !el.value) return;
  navigator.clipboard.writeText(el.value).then(() => {
    Toast.success('API Key copied!');
  });
}

async function regenerateApiKey() {
  if (!confirm('Generating a new API key will require all clients to re-authenticate. Proceed?')) return;
  try {
    const res = await api.generateApiKey();
    api.setApiKey(res.apiKey);
    document.getElementById('current-api-key').value = res.apiKey;
    Toast.success('New API key generated and stored in session!');
  } catch (err) {
    Toast.error(err.message || 'Failed to generate key');
  }
}

function applyApiKeyFromInput() {
  const el = document.getElementById('current-api-key');
  if (el && el.value) {
    api.setApiKey(el.value);
    Toast.success('API key saved to browser session');
  }
}
