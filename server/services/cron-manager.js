import { createHash } from 'crypto';
import { run } from '../lib/shell.js';

const LABEL_PREFIX = '# vps-panel: ';
const DISABLED_PREFIX = '#off# ';
const ENV_LINE = /^[A-Za-z_][A-Za-z0-9_]*\s*=/;

const MACROS = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *'
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, offset: 1 },
  { name: 'day of week', min: 0, max: 7, names: DAYS, offset: 0 }
];

/**
 * Cron Manager — reads and writes the crontab of the user running the panel.
 *
 * Lines the panel does not understand (comments, env vars like MAILTO=) are kept
 * exactly as they are. Panel-managed extras:
 *   "# vps-panel: <label>"  on the line above a job gives it a label
 *   "#off# <job line>"      is a disabled job
 */
export class CronManager {

  // ── Crontab I/O ────────────────────────────────────────────

  static async readLines() {
    const { code, stdout, stderr } = await run('crontab', ['-l'], { timeout: 10000 });
    if (code !== 0) {
      // "no crontab for root" is an empty crontab, anything else is a real error
      if (/no crontab/i.test(stderr)) return [];
      throw new Error(`Cannot read crontab: ${stderr.trim() || `exit ${code}`}`);
    }
    const lines = stdout.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  static async writeLines(lines) {
    const content = lines.join('\n').replace(/\n*$/, '\n');
    const { code, stderr } = await run('crontab', ['-'], { input: content, timeout: 10000 });
    if (code !== 0) throw new Error(`crontab rejected the update: ${stderr.trim()}`);
  }

  // ── Parsing ────────────────────────────────────────────────

  /**
   * Split a job line into { schedule, command }, or null if it is not a job.
   */
  static splitJobLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || ENV_LINE.test(trimmed)) return null;

    if (trimmed.startsWith('@')) {
      const m = trimmed.match(/^(@\w+)\s+(.+)$/);
      if (!m) return null;
      return { schedule: m[1], command: m[2] };
    }

    const m = trimmed.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (!m) return null;
    return { schedule: m.slice(1, 6).join(' '), command: m[6] };
  }

  /**
   * Parse crontab lines into job objects that remember their line position.
   */
  static parse(lines) {
    const jobs = [];
    const seen = new Map();

    lines.forEach((line, index) => {
      let enabled = true;
      let body = line;
      if (line.startsWith(DISABLED_PREFIX)) {
        enabled = false;
        body = line.slice(DISABLED_PREFIX.length);
      }

      const parts = CronManager.splitJobLine(body);
      if (!parts) return;

      const prev = index > 0 ? lines[index - 1] : '';
      const label = prev.startsWith(LABEL_PREFIX) ? prev.slice(LABEL_PREFIX.length).trim() : '';

      // Stable id derived from content, so edits never hit the wrong line
      const hash = createHash('sha1').update(body.trim()).digest('hex').slice(0, 12);
      const n = (seen.get(hash) || 0) + 1;
      seen.set(hash, n);
      const id = n === 1 ? hash : `${hash}-${n}`;

      let validation = { valid: true };
      try { CronManager.parseSchedule(parts.schedule); } catch (err) { validation = { valid: false, error: err.message }; }
      const next = validation.valid ? CronManager.nextRuns(parts.schedule, 1)[0] : null;

      jobs.push({
        id,
        line: index,
        labelLine: label ? index - 1 : null,
        label,
        enabled,
        schedule: parts.schedule,
        command: parts.command,
        human: validation.valid ? CronManager.toHuman(parts.schedule) : 'Invalid schedule',
        nextRun: next ? next.toISOString() : null,
        valid: validation.valid,
        error: validation.error || null
      });
    });

    return jobs;
  }

  // ── Public API ─────────────────────────────────────────────

  static async list() {
    return CronManager.parse(await CronManager.readLines());
  }

  static buildLines({ schedule, command, label, enabled = true }) {
    const out = [];
    if (label) out.push(LABEL_PREFIX + label.replace(/[\r\n]+/g, ' ').trim());
    out.push(`${enabled ? '' : DISABLED_PREFIX}${schedule.trim()} ${command.trim()}`);
    return out;
  }

  static validateInput(schedule, command) {
    CronManager.parseSchedule(schedule); // throws with a helpful message
    if (!command || !command.trim()) throw new Error('Command is required');
    if (/[\r\n]/.test(command)) throw new Error('Command must be a single line');
    if (/(^|[^\\])%/.test(command)) throw new Error('cron treats % as a line break — write it as \\% (e.g. date +\\%Y-\\%m-\\%d)');
  }

  static async add({ schedule, command, label, enabled = true }) {
    CronManager.validateInput(schedule, command);
    const lines = await CronManager.readLines();
    lines.push(...CronManager.buildLines({ schedule, command, label, enabled }));
    await CronManager.writeLines(lines);
    return { success: true };
  }

  static async _findOrFail(lines, id) {
    const job = CronManager.parse(lines).find(j => j.id === id);
    if (!job) {
      const err = new Error('This cron job no longer exists — the crontab changed. Refresh and try again.');
      err.status = 409;
      throw err;
    }
    return job;
  }

  /**
   * Replace a job's lines (label + job) with new ones, in place.
   */
  static _splice(lines, job, replacement) {
    const start = job.labelLine !== null ? job.labelLine : job.line;
    lines.splice(start, job.line - start + 1, ...replacement);
  }

  static async update(id, { schedule, command, label, enabled }) {
    const lines = await CronManager.readLines();
    const job = await CronManager._findOrFail(lines, id);
    const next = {
      schedule: schedule ?? job.schedule,
      command: command ?? job.command,
      label: label ?? job.label,
      enabled: enabled ?? job.enabled
    };
    // Only a changed command is re-validated, so toggling a hand-written job never fails
    if (next.command !== job.command) CronManager.validateInput(next.schedule, next.command);
    else CronManager.parseSchedule(next.schedule);
    CronManager._splice(lines, job, CronManager.buildLines(next));
    await CronManager.writeLines(lines);
    return { success: true };
  }

  static async setEnabled(id, enabled) {
    return CronManager.update(id, { enabled: !!enabled });
  }

  static async remove(id) {
    const lines = await CronManager.readLines();
    const job = await CronManager._findOrFail(lines, id);
    CronManager._splice(lines, job, []);
    await CronManager.writeLines(lines);
    return { success: true };
  }

  static async get(id) {
    const lines = await CronManager.readLines();
    return CronManager._findOrFail(lines, id);
  }

  // ── Schedule parsing ───────────────────────────────────────

  /**
   * Parse a schedule into sets of allowed values. Throws a readable error when invalid.
   * Returns null for @reboot (no calendar schedule).
   */
  static parseSchedule(schedule) {
    const s = (schedule || '').trim().toLowerCase();
    if (!s) throw new Error('Schedule is required');
    if (s === '@reboot') return null;
    if (s.startsWith('@')) {
      if (!MACROS[s]) throw new Error(`Unknown schedule macro "${schedule}". Use @reboot, @hourly, @daily, @weekly, @monthly or @yearly`);
      return CronManager.parseSchedule(MACROS[s]);
    }

    const parts = s.split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`A schedule needs 5 fields (minute hour day month weekday), got ${parts.length}`);
    }

    const sets = parts.map((part, i) => CronManager._expandField(part, FIELDS[i]));
    // Day-of-week 7 is Sunday
    if (sets[4].has(7)) { sets[4].delete(7); sets[4].add(0); }

    return {
      minute: sets[0],
      hour: sets[1],
      dom: sets[2],
      month: sets[3],
      dow: sets[4],
      domRestricted: !parts[2].startsWith('*'),
      dowRestricted: !parts[4].startsWith('*')
    };
  }

  static _expandField(expr, spec) {
    const values = new Set();
    const toNum = (token) => {
      if (spec.names) {
        const idx = spec.names.indexOf(token);
        if (idx !== -1) return idx + spec.offset;
      }
      if (!/^\d+$/.test(token)) throw new Error(`Invalid ${spec.name} value "${token}"`);
      const n = parseInt(token, 10);
      if (n < spec.min || n > spec.max) throw new Error(`${spec.name} must be between ${spec.min} and ${spec.max} (got ${n})`);
      return n;
    };

    for (const item of expr.split(',')) {
      if (!item) throw new Error(`Empty value in ${spec.name} field`);
      const [range, stepStr, extra] = item.split('/');
      if (extra !== undefined) throw new Error(`Invalid step in ${spec.name} field: "${item}"`);
      let step = 1;
      if (stepStr !== undefined) {
        if (!/^\d+$/.test(stepStr) || parseInt(stepStr, 10) === 0) throw new Error(`Invalid step "${stepStr}" in ${spec.name} field`);
        step = parseInt(stepStr, 10);
      }

      let start, end;
      if (range === '*') {
        start = spec.min;
        end = spec.name === 'day of week' ? 6 : spec.max;
      } else if (range.includes('-')) {
        const [a, b] = range.split('-');
        start = toNum(a);
        end = toNum(b);
        if (start > end) throw new Error(`Invalid range "${range}" in ${spec.name} field`);
      } else {
        // Debian's cron rejects "N/step"; require an explicit range instead
        if (stepStr !== undefined) throw new Error(`Use a range with a step in the ${spec.name} field, e.g. "${range}-${spec.max}/${stepStr}"`);
        start = end = toNum(range);
      }

      for (let v = start; v <= end; v += step) values.add(v);
    }
    return values;
  }

  /**
   * Compute the next `count` run times in server local time (the timezone cron uses).
   */
  static nextRuns(schedule, count = 5, from = new Date()) {
    let spec;
    try { spec = CronManager.parseSchedule(schedule); } catch { return []; }
    if (!spec) return []; // @reboot

    const results = [];
    const d = new Date(from);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    const limit = new Date(from.getTime() + 366 * 24 * 3600 * 1000 * 5);

    const dayMatches = (date) => {
      const domOk = spec.dom.has(date.getDate());
      const dowOk = spec.dow.has(date.getDay());
      if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
      if (spec.domRestricted) return domOk;
      if (spec.dowRestricted) return dowOk;
      return true;
    };

    while (results.length < count && d < limit) {
      if (!spec.month.has(d.getMonth() + 1)) {
        d.setMonth(d.getMonth() + 1, 1);
        d.setHours(0, 0, 0, 0);
        continue;
      }
      if (!dayMatches(d)) {
        d.setDate(d.getDate() + 1);
        d.setHours(0, 0, 0, 0);
        continue;
      }
      if (!spec.hour.has(d.getHours())) {
        d.setHours(d.getHours() + 1, 0, 0, 0);
        continue;
      }
      if (!spec.minute.has(d.getMinutes())) {
        d.setMinutes(d.getMinutes() + 1, 0, 0);
        continue;
      }
      results.push(new Date(d));
      d.setMinutes(d.getMinutes() + 1, 0, 0);
    }
    return results;
  }

  /**
   * Convert a schedule to a readable sentence.
   */
  static toHuman(schedule) {
    const s = schedule.trim().toLowerCase();
    if (s === '@reboot') return 'Once at system startup';
    if (s === '@hourly') return 'Every hour';
    if (s === '@daily' || s === '@midnight') return 'Every day at 00:00';
    if (s === '@weekly') return 'Every Sunday at 00:00';
    if (s === '@monthly') return 'On the 1st of every month at 00:00';
    if (s === '@yearly' || s === '@annually') return 'Every year on 1 January at 00:00';

    const [min, hour, dom, mon, dow] = s.split(/\s+/);
    const isNum = (v) => /^\d+$/.test(v);
    const time = () => `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

    if (s === '* * * * *' || s === '*/1 * * * *') return 'Every minute';
    const everyN = min.match(/^\*\/(\d+)$/);
    if (everyN && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${everyN[1]} minutes`;
    if (isNum(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
      return min === '0' ? 'Every hour, on the hour' : `Every hour at minute ${min}`;
    }
    const everyH = hour.match(/^\*\/(\d+)$/);
    if (isNum(min) && everyH && dom === '*' && mon === '*' && dow === '*') return `Every ${everyH[1]} hours at minute ${min}`;

    if (isNum(min) && isNum(hour)) {
      const dayText = CronManager._describeDow(dow);
      if (dom === '*' && mon === '*' && dow === '*') return `Every day at ${time()}`;
      if (dom === '*' && mon === '*' && dayText) return `${dayText} at ${time()}`;
      if (isNum(dom) && mon === '*' && dow === '*') return `On day ${dom} of every month at ${time()}`;
      if (isNum(dom) && isNum(mon) && dow === '*') return `Every year on ${dom} ${MONTH_NAMES[parseInt(mon) - 1]} at ${time()}`;
    }

    const bits = [];
    bits.push(min === '*' ? 'every minute' : `minute ${min}`);
    bits.push(hour === '*' ? 'of every hour' : `past hour ${hour}`);
    if (dom !== '*') bits.push(`on day-of-month ${dom}`);
    if (mon !== '*') bits.push(`in month ${mon}`);
    if (dow !== '*') bits.push(`on weekday ${dow}`);
    const text = bits.join(' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  static _describeDow(dow) {
    if (dow === '1-5' || dow === 'mon-fri') return 'Every weekday (Mon–Fri)';
    if (dow === '0,6' || dow === '6,0' || dow === 'sat,sun') return 'Every weekend day';
    const names = dow.split(',').map(d => {
      const n = /^\d$/.test(d) ? parseInt(d) % 7 : DAYS.indexOf(d);
      return n >= 0 && n <= 6 ? DAY_NAMES[n] : null;
    });
    if (names.every(Boolean)) return `Every ${names.join(', ')}`;
    return null;
  }
}
