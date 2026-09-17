import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Notifier service — Discord webhooks + email via msmtp
 */
export class Notifier {

  /**
   * Send a Discord webhook notification
   */
  static async sendDiscord(webhookUrl, { title, message, color = 3066993, fields = [] }) {
    if (!webhookUrl) return { success: false, error: 'No webhook URL configured' };

    const embed = {
      title,
      description: message,
      color,
      timestamp: new Date().toISOString(),
      fields: fields.map(f => ({ name: f.name, value: f.value, inline: f.inline ?? true }))
    };

    try {
      const payload = JSON.stringify({ embeds: [embed] });
      const escaped = payload.replace(/'/g, "'\\''");
      await execAsync(
        `curl -s -H "Content-Type: application/json" -d '${escaped}' "${webhookUrl}"`,
        { timeout: 15000 }
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Send an email notification via msmtp
   */
  static async sendEmail(to, from, { subject, body }) {
    if (!to || !from) return { success: false, error: 'Email not configured' };

    try {
      const emailContent = `Subject: ${subject}\nFrom: ${from}\nTo: ${to}\n\n${body}`;
      const escaped = emailContent.replace(/'/g, "'\\''");
      await execAsync(
        `echo '${escaped}' | msmtp "${to}"`,
        { timeout: 30000 }
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Send notification to all configured channels
   */
  static async notifyAll(config, { title, message, color, emailSubject, emailBody, fields }) {
    const results = {};

    if (config.notifications.discord.enabled && config.notifications.discord.webhookUrl) {
      results.discord = await Notifier.sendDiscord(
        config.notifications.discord.webhookUrl,
        { title, message, color, fields }
      );
    }

    if (config.notifications.email.enabled && config.notifications.email.to) {
      results.email = await Notifier.sendEmail(
        config.notifications.email.to,
        config.notifications.email.from,
        { subject: emailSubject || title, body: emailBody || message }
      );
    }

    return results;
  }
}
