import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Cron Manager — read/write system crontab entries
 */
export class CronManager {

  /**
   * List all cron jobs from crontab
   */
  static async list() {
    try {
      const { stdout } = await execAsync('crontab -l 2>/dev/null || echo ""');
      const lines = stdout.trim().split('\n').filter(l => l && !l.startsWith('#'));
      return lines.map((line, index) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) return null;
        const schedule = parts.slice(0, 5).join(' ');
        const command = parts.slice(5).join(' ');
        return {
          id: index,
          schedule,
          command,
          human: CronManager.toHuman(schedule),
          raw: line
        };
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Add a new cron job
   */
  static async add(schedule, command) {
    try {
      // Validate schedule format
      if (!CronManager.isValidSchedule(schedule)) {
        return { success: false, error: 'Invalid cron schedule format' };
      }

      const { stdout: existing } = await execAsync('crontab -l 2>/dev/null || echo ""');
      const newCrontab = existing.trim() + '\n' + `${schedule} ${command}` + '\n';
      const escaped = newCrontab.replace(/'/g, "'\\''");
      await execAsync(`echo '${escaped}' | crontab -`);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Update an existing cron job by index
   */
  static async update(index, schedule, command) {
    try {
      const { stdout } = await execAsync('crontab -l 2>/dev/null || echo ""');
      const lines = stdout.trim().split('\n');
      const jobLines = [];
      const otherLines = [];

      lines.forEach(line => {
        if (line.trim() && !line.startsWith('#')) {
          jobLines.push(line);
        } else {
          otherLines.push(line);
        }
      });

      if (index < 0 || index >= jobLines.length) {
        return { success: false, error: 'Invalid job index' };
      }

      jobLines[index] = `${schedule} ${command}`;
      const newCrontab = [...otherLines, ...jobLines].join('\n') + '\n';
      const escaped = newCrontab.replace(/'/g, "'\\''");
      await execAsync(`echo '${escaped}' | crontab -`);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Delete a cron job by index
   */
  static async remove(index) {
    try {
      const { stdout } = await execAsync('crontab -l 2>/dev/null || echo ""');
      const lines = stdout.trim().split('\n');
      const jobLines = [];
      const otherLines = [];

      lines.forEach(line => {
        if (line.trim() && !line.startsWith('#')) {
          jobLines.push(line);
        } else {
          otherLines.push(line);
        }
      });

      if (index < 0 || index >= jobLines.length) {
        return { success: false, error: 'Invalid job index' };
      }

      jobLines.splice(index, 1);
      const newCrontab = [...otherLines, ...jobLines].join('\n') + '\n';
      const escaped = newCrontab.replace(/'/g, "'\\''");
      await execAsync(`echo '${escaped}' | crontab -`);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Validate cron schedule format
   */
  static isValidSchedule(schedule) {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    // Basic validation — each field should match cron patterns
    const patterns = [
      /^(\*|(\d+)(,\d+)*(\/\d+)?|\*\/\d+|\d+-\d+)$/, // minute 0-59
      /^(\*|(\d+)(,\d+)*(\/\d+)?|\*\/\d+|\d+-\d+)$/, // hour 0-23
      /^(\*|(\d+)(,\d+)*(\/\d+)?|\*\/\d+|\d+-\d+)$/, // day 1-31
      /^(\*|(\d+)(,\d+)*(\/\d+)?|\*\/\d+|\d+-\d+)$/, // month 1-12
      /^(\*|(\d+)(,\d+)*(\/\d+)?|\*\/\d+|\d+-\d+)$/  // day-of-week 0-7
    ];
    return parts.every((part, i) => patterns[i].test(part));
  }

  /**
   * Convert cron schedule to human-readable string
   */
  static toHuman(schedule) {
    const parts = schedule.split(/\s+/);
    if (parts.length !== 5) return schedule;

    const [min, hour, dom, mon, dow] = parts;

    // Common patterns
    if (schedule === '* * * * *') return 'Every minute';
    if (schedule === '*/5 * * * *') return 'Every 5 minutes';
    if (schedule === '*/15 * * * *') return 'Every 15 minutes';
    if (schedule === '*/30 * * * *') return 'Every 30 minutes';
    if (schedule === '0 * * * *') return 'Every hour';

    if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
      return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }

    if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow !== '*') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayName = days[parseInt(dow)] || dow;
      return `Every ${dayName} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }

    return schedule;
  }
}
