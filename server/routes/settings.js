import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { Notifier } from '../services/notifier.js';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '..', 'data', 'config.json');
const projectRoot = join(__dirname, '..', '..');

const router = Router();

function getConfig() {
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

function saveConfig(config) {
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Write msmtprc file automatically from SMTP settings
 */
function syncMsmtpConfig(smtp) {
  if (!smtp || !smtp.host || !smtp.user) return false;

  const content = `defaults
auth           on
tls            ${smtp.tls === false ? 'off' : 'on'}
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        /var/log/msmtp.log

account        default
host           ${smtp.host}
port           ${smtp.port || 587}
from           ${smtp.from || smtp.user}
user           ${smtp.user}
password       ${smtp.password || ''}
`;

  const targets = [
    join(projectRoot, 'msmtprc'),
    '/root/.msmtprc',
    process.env.HOME ? join(process.env.HOME, '.msmtprc') : null
  ].filter(Boolean);

  for (const target of targets) {
    try {
      const dir = dirname(target);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(target, content, { mode: 0o600 });
      chmodSync(target, 0o600);
    } catch {
      // Best-effort write if permissions allow
    }
  }
  return true;
}

/**
 * Write service-account.json automatically from settings
 */
function syncServiceAccount(saData) {
  if (!saData) return false;

  let jsonStr = '';
  if (typeof saData === 'string') {
    // Validate JSON
    JSON.parse(saData);
    jsonStr = saData;
  } else if (typeof saData === 'object') {
    jsonStr = JSON.stringify(saData, null, 2);
  }

  const targets = [
    join(projectRoot, 'service-account.json'),
    '/root/.config/backup/service-account.json'
  ];

  for (const target of targets) {
    try {
      const dir = dirname(target);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(target, jsonStr, { mode: 0o600 });
      chmodSync(target, 0o600);
    } catch {
      // Best effort
    }
  }
  return true;
}

/**
 * Write rclone.conf automatically from settings
 */
function syncRcloneConfig(gdrive) {
  if (!gdrive) return false;

  let content = '';
  if (gdrive.rcloneRaw && gdrive.rcloneRaw.trim()) {
    content = gdrive.rcloneRaw.trim();
  } else {
    const remoteName = gdrive.remoteName || 'gdrive-backup';
    const saPath = existsSync('/root/.config/backup/service-account.json')
      ? '/root/.config/backup/service-account.json'
      : join(projectRoot, 'service-account.json');

    content = `[${remoteName}]
type = drive
scope = drive
${existsSync(saPath) ? `service_account_file = ${saPath}` : ''}
${gdrive.rootFolderId ? `root_folder_id = ${gdrive.rootFolderId}` : ''}
`;
  }

  const targets = [
    join(projectRoot, 'rclone.conf'),
    '/root/.config/rclone/rclone.conf',
    process.env.HOME ? join(process.env.HOME, '.config', 'rclone', 'rclone.conf') : null
  ].filter(Boolean);

  for (const target of targets) {
    try {
      const dir = dirname(target);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(target, content, { mode: 0o600 });
      chmodSync(target, 0o600);
    } catch {
      // Best effort
    }
  }
  return true;
}

// GET /api/v1/settings — Get current settings
router.get('/', (req, res) => {
  const config = getConfig();

  // Check if credentials exist on disk
  const hasServiceAccount = existsSync(join(projectRoot, 'service-account.json')) ||
    existsSync('/root/.config/backup/service-account.json');
  const hasRcloneConf = existsSync(join(projectRoot, 'rclone.conf')) ||
    existsSync('/root/.config/rclone/rclone.conf');
  const hasMsmtprc = existsSync(join(projectRoot, 'msmtprc')) ||
    existsSync('/root/.msmtprc');

  const smtp = config.notifications?.email?.smtp || {};

  const sanitized = {
    server: config.server,
    notifications: {
      discord: config.notifications?.discord || { enabled: false, webhookUrl: '' },
      email: {
        enabled: config.notifications?.email?.enabled || false,
        to: config.notifications?.email?.to || '',
        from: config.notifications?.email?.from || '',
        msmtpConfigured: hasMsmtprc || config.notifications?.email?.msmtpConfigured,
        smtp: {
          host: smtp.host || 'smtp.gmail.com',
          port: smtp.port || 587,
          tls: smtp.tls !== false,
          user: smtp.user || '',
          from: smtp.from || '',
          hasPassword: !!smtp.password
        }
      }
    },
    backup: {
      retentionDays: config.backup?.retentionDays || 30,
      defaultTarget: config.backup?.defaultTarget || 'gdrive',
      targets: {
        gdrive: {
          enabled: config.backup?.targets?.gdrive?.enabled !== false,
          remoteName: config.backup?.targets?.gdrive?.remoteName || 'gdrive-backup',
          basePath: config.backup?.targets?.gdrive?.basePath || 'backups',
          rootFolderId: config.backup?.targets?.gdrive?.rootFolderId || '',
          hasServiceAccount,
          hasRcloneConf
        },
        s3: {
          enabled: config.backup?.targets?.s3?.enabled || false,
          bucket: config.backup?.targets?.s3?.bucket || '',
          region: config.backup?.targets?.s3?.region || '',
          accessKey: config.backup?.targets?.s3?.accessKey || '',
          hasSecretKey: !!config.backup?.targets?.s3?.secretKey,
          basePath: config.backup?.targets?.s3?.basePath || 'backups'
        },
        sftp: {
          enabled: config.backup?.targets?.sftp?.enabled || false,
          host: config.backup?.targets?.sftp?.host || '',
          port: config.backup?.targets?.sftp?.port || 22,
          user: config.backup?.targets?.sftp?.user || '',
          basePath: config.backup?.targets?.sftp?.basePath || '/backups'
        }
      }
    },
    hasApiKey: !!config.apiKey
  };

  res.json(sanitized);
});

// PUT /api/v1/settings — Update settings and auto-sync config files
router.put('/', (req, res) => {
  const config = getConfig();
  const updates = req.body;

  // Merge notifications & SMTP
  if (updates.notifications) {
    if (updates.notifications.discord) {
      config.notifications.discord = { ...config.notifications.discord, ...updates.notifications.discord };
    }
    if (updates.notifications.email) {
      config.notifications.email = { ...config.notifications.email, ...updates.notifications.email };

      // Handle SMTP details and auto-sync msmtprc
      if (updates.notifications.email.smtp) {
        const prevSmtp = config.notifications.email.smtp || {};
        const newSmtp = { ...prevSmtp, ...updates.notifications.email.smtp };

        // If password was empty, keep existing password
        if (!updates.notifications.email.smtp.password && prevSmtp.password) {
          newSmtp.password = prevSmtp.password;
        }

        config.notifications.email.smtp = newSmtp;
        syncMsmtpConfig(newSmtp);
        config.notifications.email.msmtpConfigured = true;
      }
    }
  }

  // Merge backup settings & cloud configs
  if (updates.backup) {
    if (updates.backup.retentionDays !== undefined) {
      config.backup.retentionDays = updates.backup.retentionDays;
    }
    if (updates.backup.defaultTarget) {
      config.backup.defaultTarget = updates.backup.defaultTarget;
    }
    if (updates.backup.targets) {
      for (const [key, val] of Object.entries(updates.backup.targets)) {
        if (!config.backup.targets[key]) {
          config.backup.targets[key] = {};
        }

        // Retain secrets if not re-sent
        if (key === 's3' && !val.secretKey && config.backup.targets.s3?.secretKey) {
          val.secretKey = config.backup.targets.s3.secretKey;
        }

        config.backup.targets[key] = { ...config.backup.targets[key], ...val };
      }

      // Auto-sync rclone if gdrive settings updated
      if (updates.backup.targets.gdrive) {
        syncRcloneConfig(config.backup.targets.gdrive);
      }
    }
  }

  // Handle service account JSON payload if provided
  if (updates.serviceAccount) {
    try {
      syncServiceAccount(updates.serviceAccount);
      if (config.backup?.targets?.gdrive) {
        syncRcloneConfig(config.backup.targets.gdrive);
      }
    } catch (err) {
      return res.status(400).json({ error: `Invalid Service Account JSON: ${err.message}` });
    }
  }

  saveConfig(config);
  res.json({ success: true, message: 'Settings saved and server configurations applied dynamically.' });
});

// POST /api/v1/settings/service-account — Save Service Account directly
router.post('/service-account', (req, res) => {
  const { serviceAccountJson } = req.body;
  if (!serviceAccountJson) {
    return res.status(400).json({ error: 'Service Account JSON content is required' });
  }

  try {
    syncServiceAccount(serviceAccountJson);
    const config = getConfig();
    if (config.backup?.targets?.gdrive) {
      syncRcloneConfig(config.backup.targets.gdrive);
    }
    res.json({ success: true, message: 'Service Account JSON saved and rclone configured successfully.' });
  } catch (err) {
    res.status(400).json({ error: `Invalid JSON: ${err.message}` });
  }
});

// POST /api/v1/settings/test-storage — Test Cloud Storage Connection (rclone/S3)
router.post('/test-storage', async (req, res) => {
  const config = getConfig();
  const target = req.body.target || config.backup.defaultTarget || 'gdrive';

  if (target === 'gdrive') {
    const remote = config.backup.targets?.gdrive?.remoteName || 'gdrive-backup';
    try {
      // Execute rclone lsd or about
      const { stdout } = await execAsync(`rclone lsd "${remote}:" --max-depth 1`, { timeout: 15000 });
      return res.json({
        success: true,
        message: `Successfully connected to Google Drive remote "${remote}"!`,
        output: stdout.trim() || '(Remote connected, root folder accessible)'
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: `Failed to connect to rclone remote "${remote}": ${err.stderr || err.message}`
      });
    }
  }

  if (target === 's3') {
    const s3 = config.backup.targets?.s3;
    if (!s3?.bucket) {
      return res.status(400).json({ error: 'S3 bucket name not configured' });
    }
    return res.json({ success: true, message: `S3 target configured for bucket "${s3.bucket}".` });
  }

  res.json({ success: true, message: `Target "${target}" configured.` });
});

// GET /api/v1/settings/system-check — Check system tools and dependencies
router.get('/system-check', async (req, res) => {
  const tools = ['node', 'rclone', 'msmtp', 'git', 'tar', 'gzip'];
  const results = {};

  for (const tool of tools) {
    try {
      const { stdout } = await execAsync(`which ${tool} && ${tool} --version || true`);
      results[tool] = {
        installed: true,
        version: stdout.split('\n')[0].trim()
      };
    } catch {
      results[tool] = { installed: false, version: 'Not installed' };
    }
  }

  // Check mysqldump
  try {
    const { stdout } = await execAsync('mysqldump --version || mariadb-dump --version');
    results.database = { installed: true, name: 'mysqldump', version: stdout.split('\n')[0].trim() };
  } catch {
    results.database = { installed: false, name: 'mysqldump', version: 'Not found (install mysql-client if backing up DB)' };
  }

  res.json({ tools: results });
});

// POST /api/v1/settings/test-notification — Test notifications
router.post('/test-notification', async (req, res) => {
  const config = getConfig();
  const { type, emailTo, emailFrom } = req.body;
  const results = {};

  if (type === 'discord' || type === 'all') {
    results.discord = await Notifier.sendDiscord(
      config.notifications.discord.webhookUrl,
      {
        title: 'System Notification Test',
        message: 'VPS Deploy & Backup Manager alert channels are connected and operational.',
        color: 3447003
      }
    );
  }

  if (type === 'email' || type === 'all') {
    const to = emailTo || config.notifications.email.to;
    const from = emailFrom || config.notifications.email.from || config.notifications.email.smtp?.from;
    results.email = await Notifier.sendEmail(
      to,
      from,
      {
        subject: 'VPS Backup Manager — System Notification Test',
        body: 'This is a test notification from your VPS Deploy & Backup Manager.\n\nYour SMTP alert dispatch is working properly.'
      }
    );
  }

  res.json({ results });
});

// POST /api/v1/settings/api-key — Generate or set API key
router.post('/api-key', (req, res) => {
  const config = getConfig();
  const { apiKey } = req.body;

  config.apiKey = apiKey || uuidv4();
  saveConfig(config);

  res.json({ apiKey: config.apiKey, message: 'API key updated' });
});

export default router;
