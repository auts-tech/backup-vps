import { Router } from 'express';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { Notifier } from '../services/notifier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '..', 'data', 'config.json');

const router = Router();

function getConfig() {
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

function saveConfig(config) {
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// GET /api/v1/settings — Get current settings
router.get('/', (req, res) => {
  const config = getConfig();
  // Don't expose sensitive keys in full
  const sanitized = {
    server: config.server,
    notifications: config.notifications,
    backup: {
      retentionDays: config.backup.retentionDays,
      defaultTarget: config.backup.defaultTarget,
      targets: {
        gdrive: {
          enabled: config.backup.targets.gdrive.enabled,
          remoteName: config.backup.targets.gdrive.remoteName,
          basePath: config.backup.targets.gdrive.basePath
        },
        s3: {
          enabled: config.backup.targets.s3.enabled,
          bucket: config.backup.targets.s3.bucket,
          region: config.backup.targets.s3.region,
          accessKey: config.backup.targets.s3.accessKey ? '***configured***' : '',
          basePath: config.backup.targets.s3.basePath
        },
        sftp: {
          enabled: config.backup.targets.sftp.enabled,
          host: config.backup.targets.sftp.host,
          port: config.backup.targets.sftp.port,
          user: config.backup.targets.sftp.user,
          basePath: config.backup.targets.sftp.basePath
        }
      }
    },
    hasApiKey: !!config.apiKey
  };
  res.json(sanitized);
});

// PUT /api/v1/settings — Update settings
router.put('/', (req, res) => {
  const config = getConfig();
  const updates = req.body;

  // Merge notifications
  if (updates.notifications) {
    if (updates.notifications.discord) {
      config.notifications.discord = { ...config.notifications.discord, ...updates.notifications.discord };
    }
    if (updates.notifications.email) {
      config.notifications.email = { ...config.notifications.email, ...updates.notifications.email };
    }
  }

  // Merge backup settings
  if (updates.backup) {
    if (updates.backup.retentionDays !== undefined) {
      config.backup.retentionDays = updates.backup.retentionDays;
    }
    if (updates.backup.defaultTarget) {
      config.backup.defaultTarget = updates.backup.defaultTarget;
    }
    if (updates.backup.targets) {
      for (const [key, val] of Object.entries(updates.backup.targets)) {
        if (config.backup.targets[key]) {
          config.backup.targets[key] = { ...config.backup.targets[key], ...val };
        }
      }
    }
  }

  saveConfig(config);
  res.json({ success: true, message: 'Settings updated' });
});

// POST /api/v1/settings/test-notification — Test notifications
router.post('/test-notification', async (req, res) => {
  const config = getConfig();
  const { type } = req.body; // 'discord', 'email', or 'all'

  const results = {};

  if (type === 'discord' || type === 'all') {
    results.discord = await Notifier.sendDiscord(
      config.notifications.discord.webhookUrl,
      {
        title: '🔔 Test Notification',
        message: 'This is a test notification from VPS Backup Manager!',
        color: 3447003
      }
    );
  }

  if (type === 'email' || type === 'all') {
    results.email = await Notifier.sendEmail(
      config.notifications.email.to,
      config.notifications.email.from,
      {
        subject: '🔔 VPS Backup Manager — Test Notification',
        body: 'This is a test notification from VPS Backup Manager!\n\nIf you received this, email notifications are working correctly.'
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

// POST /api/v1/settings/setup — Initial setup (first run)
router.post('/setup', (req, res) => {
  const config = getConfig();

  if (config.apiKey) {
    return res.status(400).json({ error: 'Already configured. Use PUT /settings to update.' });
  }

  const { discord, email, rcloneRemote } = req.body;

  config.apiKey = uuidv4();

  if (discord?.webhookUrl) {
    config.notifications.discord = { enabled: true, webhookUrl: discord.webhookUrl };
  }

  if (email?.to) {
    config.notifications.email = {
      enabled: true,
      to: email.to,
      from: email.from || email.to,
      msmtpConfigured: true
    };
  }

  if (rcloneRemote) {
    config.backup.targets.gdrive.remoteName = rcloneRemote;
    config.backup.targets.gdrive.enabled = true;
  }

  saveConfig(config);

  res.json({
    success: true,
    apiKey: config.apiKey,
    message: 'Setup complete! Save your API key.'
  });
});

export default router;
