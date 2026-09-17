/**
 * System Settings & Configuration Page
 * Full Dynamic Configuration for SMTP, Google Drive Service Account, Rclone, S3, and System Checks
 * All controllable directly from the Web UI without manual file editing.
 */
function renderSettings(container) {
  const I = window.Icons;

  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>System & Storage Settings</h2>
          <p>Manage SMTP email credentials, Google Drive service accounts, cloud targets, and security</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="runSystemCheckModal()">
            ${I.get('activity', { size: 13 })}
            <span>System Health Check</span>
          </button>
          <button class="btn btn-primary" onclick="saveAllSettings()">
            ${I.get('save', { size: 13, color: '#ffffff' })}
            <span>Save All Settings</span>
          </button>
        </div>
      </div>

      <!-- Settings Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(360px, 1fr));gap:20px;margin-bottom:24px;">

        <!-- 1. SMTP Email Configuration -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">
              ${I.get('mail', { size: 16 })}
              <span>SMTP & Email Alerts</span>
            </h3>
            <span class="badge badge-neutral" id="smtp-status-badge">Checking...</span>
          </div>
          <div class="card-body">
            <p style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">
              Configure outbound email for automated backup failure and success notifications. Automatically applies to the server's <code>msmtprc</code>.
            </p>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding:10px 12px;background:#f8fafc;border-radius:var(--radius-sm);border:1px solid var(--border-primary);">
              <div>
                <strong style="font-size:13px;color:var(--text-primary);">Enable Email Alerts</strong>
                <div style="font-size:11px;color:var(--text-tertiary);">Send notifications when scheduled backups run</div>
              </div>
              <label class="form-check">
                <input type="checkbox" id="email-enabled">
              </label>
            </div>

            <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">SMTP Host</label>
                <input type="text" id="smtp-host" class="form-input" placeholder="smtp.gmail.com" value="smtp.gmail.com">
              </div>
              <div class="form-group">
                <label class="form-label">Port</label>
                <input type="number" id="smtp-port" class="form-input" placeholder="587" value="587">
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">SMTP Username / Email</label>
                <input type="email" id="smtp-user" class="form-input" placeholder="you@gmail.com">
              </div>
              <div class="form-group">
                <label class="form-label">App Password / Auth Token</label>
                <div style="display:flex;gap:4px;">
                  <input type="password" id="smtp-pass" class="form-input" placeholder="••••••••••••••••">
                  <button type="button" class="btn btn-secondary btn-icon-only" onclick="toggleInputVisibility('smtp-pass')" title="Show/Hide password">
                    ${I.get('eye', { size: 13 })}
                  </button>
                </div>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Sender Address (From)</label>
                <input type="email" id="email-from" class="form-input" placeholder="alerts@domain.com">
              </div>
              <div class="form-group">
                <label class="form-label">Alert Recipient (To)</label>
                <input type="email" id="email-to" class="form-input" placeholder="admin@domain.com">
              </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;padding-top:12px;border-top:1px solid var(--border-secondary);">
              <label class="form-check">
                <input type="checkbox" id="smtp-tls" checked>
                <span style="font-size:12px;color:var(--text-secondary);">Enable TLS Encryption</span>
              </label>
              <button class="btn btn-sm btn-secondary" onclick="testSmtpFromForm()">
                ${I.get('zap', { size: 12 })}
                <span>Send Test Email</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 2. Discord Webhook & API Key -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">
              ${I.get('bell', { size: 16 })}
              <span>Discord Alerts & Security</span>
            </h3>
          </div>
          <div class="card-body">
            <!-- Discord -->
            <div style="margin-bottom:20px;border-bottom:1px solid var(--border-secondary);padding-bottom:18px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="display:flex;align-items:center;gap:8px;">
                  ${I.get('messageSquare', { size: 16, color: 'var(--text-secondary)' })}
                  <strong style="font-size:13px;">Discord Webhook Channel</strong>
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
                <span>Send Test Webhook</span>
              </button>
            </div>

            <!-- API Key -->
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                ${I.get('lock', { size: 16, color: 'var(--text-secondary)' })}
                <strong style="font-size:13px;">Admin API Key</strong>
              </div>
              <p style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;">
                Required when executing backup tasks via CLI, crontab, or external curl webhooks.
              </p>
              <div class="form-group" style="margin-bottom:12px;">
                <div style="display:flex;gap:6px;">
                  <input type="password" id="current-api-key" class="form-input" readonly style="font-family:var(--font-mono);font-size:12px;">
                  <button class="btn btn-secondary btn-icon-only" onclick="toggleInputVisibility('current-api-key')" title="Show/Hide key">
                    ${I.get('eye', { size: 14 })}
                  </button>
                  <button class="btn btn-secondary btn-icon-only" onclick="copyCurrentApiKey()" title="Copy API Key">
                    ${I.get('copy', { size: 14 })}
                  </button>
                </div>
              </div>
              <button class="btn btn-sm btn-secondary" onclick="regenerateApiKey()">
                ${I.get('key', { size: 12 })}
                <span>Regenerate Key</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Cloud Storage & Google Drive Service Account (Full Dynamic) -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get('cloud', { size: 16 })}
            <span>Cloud Storage Providers & Service Account</span>
          </h3>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-sm btn-secondary" onclick="testActiveStorage()">
              ${I.get('zap', { size: 12 })}
              <span>Test Active Connection</span>
            </button>
          </div>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:16px;margin-bottom:20px;">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Retention Policy (Days)</label>
              <input type="number" id="retention-days" class="form-input" min="1" max="365" value="30">
              <div class="form-hint">Snapshots older than this are purged on cleanup</div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Default Target Remote</label>
              <select id="default-target" class="form-select">
                <option value="gdrive">Google Drive (rclone)</option>
                <option value="s3">Amazon S3</option>
                <option value="sftp">SFTP Server</option>
              </select>
            </div>
          </div>

          <!-- Target Tabs -->
          <div style="display:flex;gap:6px;border-bottom:1px solid var(--border-primary);margin-bottom:16px;padding-bottom:10px;">
            <button class="btn btn-sm btn-primary" id="tab-btn-gdrive" onclick="switchTargetTab('gdrive')">Google Drive</button>
            <button class="btn btn-sm btn-secondary" id="tab-btn-s3" onclick="switchTargetTab('s3')">Amazon S3</button>
            <button class="btn btn-sm btn-secondary" id="tab-btn-sftp" onclick="switchTargetTab('sftp')">SFTP Server</button>
          </div>

          <!-- Google Drive Tab (Dynamic Service Account & Folder) -->
          <div id="target-tab-gdrive">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <div>
                <strong style="font-size:14px;color:var(--text-primary);">Google Drive via rclone</strong>
                <div style="font-size:12px;color:var(--text-secondary);">Direct cloud upload using GCP Service Account or rclone tokens</div>
              </div>
              <div style="display:flex;align-items:center;gap:12px;">
                <span class="badge badge-neutral" id="gdrive-sa-badge">Checking credentials...</span>
                <label class="form-check">
                  <input type="checkbox" id="gdrive-enabled" checked>
                  <span style="font-size:12px;color:var(--text-secondary);">Enabled</span>
                </label>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">rclone Remote Name</label>
                <input type="text" id="gdrive-remote" class="form-input" placeholder="gdrive-backup" value="gdrive-backup">
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Google Drive Root Folder ID</label>
                <input type="text" id="gdrive-root-folder" class="form-input" placeholder="e.g. 15rWFqW1kt5hL53LtnlDZ9Uc4KB3Ewy2H">
                <div class="form-hint">The folder ID from your Google Drive URL</div>
              </div>
            </div>

            <!-- Service Account JSON Input Area -->
            <div class="form-group">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <label class="form-label" style="margin-bottom:0;">Google Service Account JSON Key</label>
                <div style="display:flex;gap:8px;">
                  <button type="button" class="btn btn-xs btn-secondary" onclick="document.getElementById('sa-file-input').click()">
                    ${I.get('download', { size: 12 })}
                    <span>Upload .json File</span>
                  </button>
                  <input type="file" id="sa-file-input" accept=".json" style="display:none;" onchange="handleSaFileUpload(event)">
                </div>
              </div>
              <textarea id="sa-json-input" class="form-textarea" rows="6" style="font-family:var(--font-mono);font-size:12px;" placeholder='Paste your Google Cloud Service Account JSON content here:&#10;{&#10;  "type": "service_account",&#10;  "project_id": "...",&#10;  "private_key": "-----BEGIN PRIVATE KEY-----..."&#10;}'></textarea>
              <div class="form-hint">
                Pasting your JSON here automatically configures <code>service-account.json</code> and connects rclone dynamically.
              </div>
            </div>

            <div style="display:flex;gap:8px;">
              <button class="btn btn-sm btn-secondary" onclick="saveServiceAccountOnly()">
                ${I.get('save', { size: 12 })}
                <span>Save Service Account JSON</span>
              </button>
              <button class="btn btn-sm btn-secondary" onclick="testStorageConnection('gdrive')">
                ${I.get('zap', { size: 12 })}
                <span>Test Google Drive Connection</span>
              </button>
            </div>
          </div>

          <!-- Amazon S3 Tab -->
          <div id="target-tab-s3" style="display:none;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <strong style="font-size:14px;">Amazon S3 Bucket</strong>
              <label class="form-check">
                <input type="checkbox" id="s3-enabled">
                <span style="font-size:12px;color:var(--text-secondary);">Enabled</span>
              </label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">S3 Bucket Name</label>
                <input type="text" id="s3-bucket" class="form-input" placeholder="my-vps-backups">
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">AWS Region</label>
                <input type="text" id="s3-region" class="form-input" placeholder="us-east-1">
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Access Key ID</label>
                <input type="text" id="s3-access-key" class="form-input" placeholder="AKIA...">
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Secret Access Key</label>
                <input type="password" id="s3-secret-key" class="form-input" placeholder="••••••••">
              </div>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="testStorageConnection('s3')">
              ${I.get('zap', { size: 12 })}
              <span>Verify S3 Configuration</span>
            </button>
          </div>

          <!-- SFTP Tab -->
          <div id="target-tab-sftp" style="display:none;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <strong style="font-size:14px;">Remote SFTP Server</strong>
              <label class="form-check">
                <input type="checkbox" id="sftp-enabled">
                <span style="font-size:12px;color:var(--text-secondary);">Enabled</span>
              </label>
            </div>
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;margin-bottom:12px;">
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Server Host / IP</label>
                <input type="text" id="sftp-host" class="form-input" placeholder="backup.myserver.com">
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">SSH Port</label>
                <input type="number" id="sftp-port" class="form-input" value="22">
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Username</label>
                <input type="text" id="sftp-user" class="form-input" placeholder="root">
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
  const I = window.Icons;
  try {
    const s = await api.getSettings();

    // 1. Notifications & SMTP
    if (s.notifications) {
      if (s.notifications.discord) {
        document.getElementById('discord-enabled').checked = !!s.notifications.discord.enabled;
        document.getElementById('discord-webhook').value = s.notifications.discord.webhookUrl || '';
      }

      if (s.notifications.email) {
        document.getElementById('email-enabled').checked = !!s.notifications.email.enabled;
        document.getElementById('email-to').value = s.notifications.email.to || '';
        document.getElementById('email-from').value = s.notifications.email.from || '';

        const smtp = s.notifications.email.smtp || {};
        document.getElementById('smtp-host').value = smtp.host || 'smtp.gmail.com';
        document.getElementById('smtp-port').value = smtp.port || 587;
        document.getElementById('smtp-tls').checked = smtp.tls !== false;
        document.getElementById('smtp-user').value = smtp.user || '';
        if (smtp.hasPassword) {
          document.getElementById('smtp-pass').placeholder = '•••••••• (Configured)';
        }

        const smtpBadge = document.getElementById('smtp-status-badge');
        if (smtpBadge) {
          if (s.notifications.email.msmtpConfigured) {
            smtpBadge.className = 'badge badge-success';
            smtpBadge.textContent = 'msmtp Active';
          } else {
            smtpBadge.className = 'badge badge-neutral';
            smtpBadge.textContent = 'Unconfigured';
          }
        }
      }
    }

    // 2. Backup & Targets
    if (s.backup) {
      document.getElementById('retention-days').value = s.backup.retentionDays || 30;
      document.getElementById('default-target').value = s.backup.defaultTarget || 'gdrive';

      const targets = s.backup.targets || {};
      if (targets.gdrive) {
        document.getElementById('gdrive-enabled').checked = !!targets.gdrive.enabled;
        document.getElementById('gdrive-remote').value = targets.gdrive.remoteName || 'gdrive-backup';
        document.getElementById('gdrive-root-folder').value = targets.gdrive.rootFolderId || '';

        const saBadge = document.getElementById('gdrive-sa-badge');
        if (saBadge) {
          if (targets.gdrive.hasServiceAccount) {
            saBadge.className = 'badge badge-success';
            saBadge.textContent = 'Service Account Active';
          } else if (targets.gdrive.hasRcloneConf) {
            saBadge.className = 'badge badge-info';
            saBadge.textContent = 'rclone Token Active';
          } else {
            saBadge.className = 'badge badge-neutral';
            saBadge.textContent = 'No Credentials';
          }
        }
      }

      if (targets.s3) {
        document.getElementById('s3-enabled').checked = !!targets.s3.enabled;
        document.getElementById('s3-bucket').value = targets.s3.bucket || '';
        document.getElementById('s3-region').value = targets.s3.region || '';
        document.getElementById('s3-access-key').value = targets.s3.accessKey || '';
        if (targets.s3.hasSecretKey) {
          document.getElementById('s3-secret-key').placeholder = '•••••••• (Configured)';
        }
      }

      if (targets.sftp) {
        document.getElementById('sftp-enabled').checked = !!targets.sftp.enabled;
        document.getElementById('sftp-host').value = targets.sftp.host || '';
        document.getElementById('sftp-port').value = targets.sftp.port || 22;
        document.getElementById('sftp-user').value = targets.sftp.user || '';
      }
    }

    // 3. API Key
    const keyInput = document.getElementById('current-api-key');
    const storedKey = api.getApiKey();
    if (keyInput) {
      keyInput.value = storedKey || '(no key configured)';
    }

  } catch (err) {
    toast.error('Load Error', err.message || 'Failed to load settings');
  }
}

async function saveAllSettings() {
  try {
    const saInput = document.getElementById('sa-json-input').value.trim();
    const smtpPass = document.getElementById('smtp-pass').value;

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
          smtp: {
            host: document.getElementById('smtp-host').value.trim(),
            port: parseInt(document.getElementById('smtp-port').value) || 587,
            tls: document.getElementById('smtp-tls').checked,
            user: document.getElementById('smtp-user').value.trim(),
            password: smtpPass || undefined,
            from: document.getElementById('email-from').value.trim()
          }
        }
      },
      backup: {
        retentionDays: parseInt(document.getElementById('retention-days').value) || 30,
        defaultTarget: document.getElementById('default-target').value,
        targets: {
          gdrive: {
            enabled: document.getElementById('gdrive-enabled').checked,
            remoteName: document.getElementById('gdrive-remote').value.trim(),
            rootFolderId: document.getElementById('gdrive-root-folder').value.trim()
          },
          s3: {
            enabled: document.getElementById('s3-enabled').checked,
            bucket: document.getElementById('s3-bucket').value.trim(),
            region: document.getElementById('s3-region').value.trim(),
            accessKey: document.getElementById('s3-access-key').value.trim(),
            secretKey: document.getElementById('s3-secret-key').value || undefined
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

    if (saInput) {
      payload.serviceAccount = saInput;
    }

    toast.info('Saving', 'Saving settings and generating server configuration files...');
    const res = await api.updateSettings(payload);
    toast.success('Settings Saved', res.message || 'Dynamic configuration applied to server');
    loadSettings();
  } catch (err) {
    toast.error('Save Failed', err.message || 'Failed to save settings');
  }
}

async function saveServiceAccountOnly() {
  const saInput = document.getElementById('sa-json-input').value.trim();
  if (!saInput) {
    toast.error('Empty', 'Please paste Service Account JSON content');
    return;
  }

  try {
    toast.info('Saving', 'Validating and saving Service Account JSON...');
    const res = await api.saveServiceAccount(saInput);
    toast.success('Saved', res.message || 'Service Account saved');
    document.getElementById('sa-json-input').value = '';
    loadSettings();
  } catch (err) {
    toast.error('Error', err.message || 'Failed to save Service Account');
  }
}

function handleSaFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result;
      JSON.parse(content); // validate JSON
      document.getElementById('sa-json-input').value = content;
      toast.success('Loaded', `Loaded ${file.name} successfully`);
    } catch {
      toast.error('Invalid JSON', 'The uploaded file is not valid JSON');
    }
  };
  reader.readAsText(file);
}

async function testStorageConnection(target) {
  toast.info('Testing', `Testing connection to ${target}...`);
  try {
    const res = await api.testStorage(target);
    toast.success('Connected', res.message || 'Storage target reached successfully');
    if (res.output) {
      Modal.show(`Storage Output (${target})`, `<pre style="font-family:var(--font-mono);font-size:12px;background:#f8fafc;padding:12px;border-radius:6px;max-height:300px;overflow-y:auto;">${escapeHtml(res.output)}</pre>`);
    }
  } catch (err) {
    toast.error('Connection Failed', err.message || `Failed to connect to ${target}`);
  }
}

function testActiveStorage() {
  const target = document.getElementById('default-target').value || 'gdrive';
  testStorageConnection(target);
}

async function testSmtpFromForm() {
  const to = document.getElementById('email-to').value.trim();
  const from = document.getElementById('email-from').value.trim();

  if (!to) {
    toast.error('Recipient Missing', 'Please specify Alert Recipient (To) email');
    return;
  }

  toast.info('Testing SMTP', `Sending test email to ${to}...`);
  try {
    const res = await api.testNotification('email', to, from);
    const emailRes = res.results?.email;
    if (emailRes?.success) {
      toast.success('Email Sent', 'Test email dispatched successfully');
    } else {
      toast.error('Email Failed', emailRes?.error || 'Failed to send test email');
    }
  } catch (err) {
    toast.error('Test Failed', err.message);
  }
}

async function testNotification(type) {
  toast.info('Testing', `Sending test ${type} alert...`);
  try {
    const res = await api.testNotification(type);
    toast.success('Dispatched', res.results?.[type]?.message || 'Test alert dispatched');
  } catch (err) {
    toast.error('Test Failed', err.message || `Test ${type} notification failed`);
  }
}

async function runSystemCheckModal() {
  const I = window.Icons;
  try {
    const res = await api.runSystemCheck();
    const tools = res.tools || {};

    const rows = Object.entries(tools).map(([name, info]) => {
      const isOk = info.installed;
      const statusBadge = isOk
        ? `<span class="badge badge-success">${I.get('check', { size: 11 })} Installed</span>`
        : `<span class="badge badge-danger">${I.get('x', { size: 11 })} Missing</span>`;

      return `
        <tr>
          <td><strong style="text-transform:capitalize;">${name}</strong></td>
          <td>${statusBadge}</td>
          <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);">${escapeHtml(info.version || '—')}</td>
        </tr>
      `;
    }).join('');

    Modal.show('VPS System Environment & Tools', `
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">
        Status of CLI tools required for automated backups, process management, and Git builds on this VPS.
      </p>
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Status</th>
              <th>Version / Path</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `, {
      submitText: 'Done',
      submitClass: 'btn-primary'
    });
  } catch (err) {
    toast.error('Check Failed', err.message);
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

function toggleInputVisibility(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
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
      toast.success('Generated', 'New API key generated and applied');
    } catch (err) {
      toast.error('Failed', err.message || 'Failed to generate key');
    }
  });
}

window.renderSettings = renderSettings;
