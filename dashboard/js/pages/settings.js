/**
 * System Settings & Configuration Page
 * Clean white theme with vector icons and deep black text
 */
function renderSettings(container) {
  const I = window.Icons;

  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>System Settings</h2>
          <p>Configure automated alerts, cloud storage providers, and security keys</p>
        </div>
        <button class="btn btn-primary" onclick="saveAllSettings()">
          ${I.get('save', { size: 14, color: '#ffffff' })}
          <span>Save Changes</span>
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(340px, 1fr));gap:20px;margin-bottom:24px;">
        <!-- Notifications Card -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">
              ${I.get('bell', { size: 16 })}
              <span>Automated Alert Channels</span>
            </h3>
          </div>
          <div class="card-body">
            <!-- Discord -->
            <div style="margin-bottom:20px;border-bottom:1px solid var(--border-secondary);padding-bottom:18px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="display:flex;align-items:center;gap:8px;">
                  ${I.get('messageSquare', { size: 16, color: 'var(--text-secondary)' })}
                  <strong style="font-size:13px;">Discord Webhook</strong>
                </div>
                <label class="form-check">
                  <input type="checkbox" id="discord-enabled">
                  <span style="font-size:12px;color:var(--text-secondary);">Enabled</span>
                </label>
              </div>
              <div class="form-group" style="margin-bottom:10px;">
                <label class="form-label">Webhook URL</label>
                <input type="url" id="discord-webhook" class="form-input" placeholder="https://discord.com/api/webhooks/...">
              </div>
              <button class="btn btn-sm btn-secondary" onclick="testNotification('discord')">
                ${I.get('zap', { size: 12 })}
                <span>Send Test Ping</span>
              </button>
            </div>

            <!-- Email / msmtp -->
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="display:flex;align-items:center;gap:8px;">
                  ${I.get('mail', { size: 16, color: 'var(--text-secondary)' })}
                  <strong style="font-size:13px;">Email Alerts (msmtp)</strong>
                </div>
                <label class="form-check">
                  <input type="checkbox" id="email-enabled">
                  <span style="font-size:12px;color:var(--text-secondary);">Enabled</span>
                </label>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
                <div class="form-group" style="margin-bottom:0;">
                  <label class="form-label">Recipient (To)</label>
                  <input type="email" id="email-to" class="form-input" placeholder="alerts@domain.com">
                </div>
                <div class="form-group" style="margin-bottom:0;">
                  <label class="form-label">Sender (From)</label>
                  <input type="email" id="email-from" class="form-input" placeholder="vps@domain.com">
                </div>
              </div>
              <button class="btn btn-sm btn-secondary" onclick="testNotification('email')">
                ${I.get('zap', { size: 12 })}
                <span>Send Test Email</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Security / API Key -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">
              ${I.get('lock', { size: 16 })}
              <span>API Authentication & Keys</span>
            </h3>
          </div>
          <div class="card-body">
            <p style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;line-height:1.5;">
              API endpoints require authentication via Bearer token or the <code>X-API-Key</code> HTTP header.
            </p>

            <div class="form-group">
              <label class="form-label">Active API Key</label>
              <div style="display:flex;gap:6px;">
                <input type="password" id="current-api-key" class="form-input" readonly style="font-family:var(--font-mono);font-size:12px;">
                <button class="btn btn-secondary btn-icon-only" onclick="toggleApiKeyVisibility()" id="toggle-key-btn" title="Toggle visibility">
                  ${I.get('eye', { size: 14 })}
                </button>
                <button class="btn btn-secondary btn-icon-only" onclick="copyCurrentApiKey()" title="Copy API Key">
                  ${I.get('copy', { size: 14 })}
                </button>
              </div>
            </div>

            <div style="display:flex;gap:8px;margin-top:16px;">
              <button class="btn btn-sm btn-secondary" onclick="regenerateApiKey()">
                ${I.get('key', { size: 12 })}
                <span>Generate New Key</span>
              </button>
              <button class="btn btn-sm btn-primary" onclick="applyApiKeyFromInput()">
                ${I.get('check', { size: 12, color: '#ffffff' })}
                <span>Save to Session</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Backup Retention & Targets -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get('cloud', { size: 16 })}
            <span>Backup Retention & Cloud Targets</span>
          </h3>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:16px;margin-bottom:20px;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Retention Policy (Days)</label>
              <input type="number" id="retention-days" class="form-input" min="1" max="365" value="30">
              <div class="form-hint">Snapshots older than this limit are pruned on cleanup</div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Default Target Destination</label>
              <select id="default-target" class="form-select">
                <option value="gdrive">Google Drive (rclone)</option>
                <option value="s3">Amazon S3</option>
                <option value="sftp">SFTP Server</option>
              </select>
            </div>
          </div>

          <!-- Tabs for Cloud Remotes -->
          <div style="display:flex;gap:6px;border-bottom:1px solid var(--border-primary);margin-bottom:16px;padding-bottom:10px;">
            <button class="btn btn-sm btn-secondary" id="tab-btn-gdrive" onclick="switchTargetTab('gdrive')">Google Drive</button>
            <button class="btn btn-sm btn-secondary" id="tab-btn-s3" onclick="switchTargetTab('s3')">Amazon S3</button>
            <button class="btn btn-sm btn-secondary" id="tab-btn-sftp" onclick="switchTargetTab('sftp')">SFTP Server</button>
          </div>

          <!-- GDrive Tab -->
          <div id="target-tab-gdrive">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <strong style="font-size:13px;">Google Drive (rclone remote)</strong>
              <label class="form-check">
                <input type="checkbox" id="gdrive-enabled" checked>
                <span style="font-size:12px;color:var(--text-secondary);">Enabled</span>
              </label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">rclone Remote Name</label>
                <input type="text" id="gdrive-remote" class="form-input" placeholder="gdrive-backup" value="gdrive-backup">
              </div>
              <div class="form-group">
                <label class="form-label">Drive Folder Base Path</label>
                <input type="text" id="gdrive-base-path" class="form-input" placeholder="backups" value="backups">
              </div>
            </div>
          </div>

          <!-- S3 Tab -->
          <div id="target-tab-s3" style="display:none;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <strong style="font-size:13px;">Amazon S3 Bucket</strong>
              <label class="form-check">
                <input type="checkbox" id="s3-enabled">
                <span style="font-size:12px;color:var(--text-secondary);">Enabled</span>
              </label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">S3 Bucket Name</label>
                <input type="text" id="s3-bucket" class="form-input" placeholder="vps-backups-bucket">
              </div>
              <div class="form-group">
                <label class="form-label">AWS Region</label>
                <input type="text" id="s3-region" class="form-input" placeholder="us-east-1">
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Access Key ID</label>
                <input type="text" id="s3-access-key" class="form-input" placeholder="AKIA...">
              </div>
              <div class="form-group">
                <label class="form-label">Secret Access Key</label>
                <input type="password" id="s3-secret-key" class="form-input" placeholder="••••••••">
              </div>
            </div>
          </div>

          <!-- SFTP Tab -->
          <div id="target-tab-sftp" style="display:none;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <strong style="font-size:13px;">Remote SFTP Server</strong>
              <label class="form-check">
                <input type="checkbox" id="sftp-enabled">
                <span style="font-size:12px;color:var(--text-secondary);">Enabled</span>
              </label>
            </div>
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Host / IP Address</label>
                <input type="text" id="sftp-host" class="form-input" placeholder="backup.remote.com">
              </div>
              <div class="form-group">
                <label class="form-label">Port</label>
                <input type="number" id="sftp-port" class="form-input" value="22">
              </div>
              <div class="form-group">
                <label class="form-label">SSH Username</label>
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
    toast.error('Failed', 'Failed to load settings: ' + err.message);
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
    toast.success('Saved', 'Settings saved successfully');
  } catch (err) {
    toast.error('Failed', err.message || 'Failed to save settings');
  }
}

async function testNotification(type) {
  toast.info('Testing', `Sending test ${type} alert...`);
  try {
    const res = await api.testNotification(type);
    toast.success('Dispatched', res.results?.[type]?.message || 'Test notification dispatched');
  } catch (err) {
    toast.error('Failed', err.message || `Test ${type} notification failed`);
  }
}

function switchTargetTab(target) {
  ['gdrive', 's3', 'sftp'].forEach(t => {
    const el = document.getElementById(`target-tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (el) el.style.display = t === target ? 'block' : 'none';
    if (btn) {
      if (t === target) {
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
      } else {
        btn.classList.add('btn-secondary');
        btn.classList.remove('btn-primary');
      }
    }
  });
}

function toggleApiKeyVisibility() {
  const I = window.Icons;
  const el = document.getElementById('current-api-key');
  const btn = document.getElementById('toggle-key-btn');
  if (!el || !btn) return;
  if (el.type === 'password') {
    el.type = 'text';
    btn.innerHTML = I.get('eyeOff', { size: 14 });
  } else {
    el.type = 'password';
    btn.innerHTML = I.get('eye', { size: 14 });
  }
}

function copyCurrentApiKey() {
  const el = document.getElementById('current-api-key');
  if (!el || !el.value) return;
  navigator.clipboard.writeText(el.value).then(() => {
    toast.success('Copied', 'API Key copied to clipboard');
  });
}

async function regenerateApiKey() {
  Modal.confirm('Regenerate API Key', 'Generating a new API key will replace your active key. Are you sure you want to proceed?', async () => {
    try {
      const res = await api.generateApiKey();
      api.setApiKey(res.apiKey);
      document.getElementById('current-api-key').value = res.apiKey;
      toast.success('Generated', 'New API key generated and applied to session');
    } catch (err) {
      toast.error('Failed', err.message || 'Failed to generate key');
    }
  });
}

function applyApiKeyFromInput() {
  const el = document.getElementById('current-api-key');
  if (el && el.value) {
    api.setApiKey(el.value);
    toast.success('Applied', 'API key saved to browser session');
  }
}

window.renderSettings = renderSettings;
