import { readFileSync } from "fs";
import { run, hasSystemd } from "../lib/shell.js";
import { httpError } from "../lib/config.js";

const UNIT = /^[A-Za-z0-9@_.:-]+\.service$/;
// Hosting services shown first
const IMPORTANT = [
  /^nginx\./,
  /^(mariadb|mysql|mysqld)\./,
  /^php[\d.]+-fpm\./,
  /^pm2-/,
  /^(cron|crond)\./,
  /^(ssh|sshd)\./,
  /^docker\./,
  /^(redis|redis-server)\./,
  /^postgresql/,
  /^memcached\./,
  /^fail2ban\./,
  /^ufw\./,
  /^certbot\./,
  /^supervisor\./,
  /^vps-backup-manager\./,
];
// Stopping these would cut off access or take the system down
const PROTECTED = new Set([
  "ssh.service",
  "sshd.service",
  "dbus.service",
  "systemd-journald.service",
  "systemd-logind.service",
  "systemd-networkd.service",
  "systemd-resolved.service",
  "networking.service",
  "NetworkManager.service",
  "getty@tty1.service",
]);

/**
 * The systemd unit running this panel (e.g. vps-backup-manager.service).
 */
export function panelUnit() {
  try {
    return (
      (readFileSync("/proc/self/cgroup", "utf-8").match(
        /\/([^/\n]+\.service)\s*$/m,
      ) || [])[1] || null
    );
  } catch {
    return null;
  }
}

function assertUnit(unit) {
  if (!UNIT.test(unit || "")) throw httpError(400, "Invalid service name");
  if (!hasSystemd())
    throw httpError(400, "systemd is not available on this server");
}

/**
 * systemd services: list, start/stop/restart/reload, enable at boot, journal logs.
 */
export class ServiceManager {
  static async list() {
    if (!hasSystemd()) return { supported: false, services: [] };
    const [units, files] = await Promise.all([
      run(
        "systemctl",
        [
          "list-units",
          "--type=service",
          "--all",
          "--no-legend",
          "--plain",
          "--no-pager",
        ],
        { timeout: 20000 },
      ),
      run(
        "systemctl",
        [
          "list-unit-files",
          "--type=service",
          "--no-legend",
          "--plain",
          "--no-pager",
        ],
        { timeout: 20000 },
      ),
    ]);
    const enabled = new Map();
    for (const line of files.stdout.split("\n")) {
      const [unit, state] = line.trim().split(/\s+/);
      if (unit && state) enabled.set(unit, state);
    }
    const services = new Map();
    for (const line of units.stdout.split("\n")) {
      const m = line
        .trim()
        .match(/^(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
      if (!m || m[2] === "not-found") continue;
      services.set(m[1], {
        unit: m[1],
        load: m[2],
        active: m[3],
        sub: m[4],
        description: m[5],
      });
    }
    // Installed but never started since boot (e.g. disabled services)
    for (const [unit, state] of enabled) {
      if (
        services.has(unit) ||
        unit.includes("@.service") ||
        ["static", "alias", "masked"].includes(state)
      )
        continue;
      services.set(unit, {
        unit,
        load: "loaded",
        active: "inactive",
        sub: "dead",
        description: "",
      });
    }
    const own = panelUnit();
    const list = [...services.values()].map((s) => ({
      ...s,
      enabled: enabled.get(s.unit) || null,
      important: IMPORTANT.some((re) => re.test(s.unit)),
      protected: PROTECTED.has(s.unit),
      panel: s.unit === own,
    }));
    list.sort(
      (a, b) =>
        Number(b.important) - Number(a.important) ||
        Number(b.active === "active") - Number(a.active === "active") ||
        a.unit.localeCompare(b.unit),
    );
    return { supported: true, services: list, panelUnit: own };
  }

  static async action(unit, action) {
    assertUnit(unit);
    if (
      !["start", "stop", "restart", "reload", "enable", "disable"].includes(
        action,
      )
    )
      throw httpError(400, "Unknown action");
    if (PROTECTED.has(unit) && ["stop", "restart", "disable"].includes(action))
      throw httpError(
        400,
        `${unit} keeps the server reachable — ${action} it from an SSH session if you really need to`,
      );
    if (unit === panelUnit()) {
      if (action !== "restart")
        throw httpError(
          400,
          "That is this panel — it can only be restarted here",
        );
      // Answer first: the restart stops this very process
      setTimeout(() => run("systemctl", ["--no-block", "restart", unit]), 500);
      return { success: true, restarting: true };
    }
    const args =
      action === "enable"
        ? ["enable", unit]
        : action === "disable"
          ? ["disable", unit]
          : [action, unit];
    const r = await run("systemctl", args, { timeout: 120000 });
    if (r.code !== 0)
      throw httpError(
        500,
        (r.stderr || r.stdout).trim() || `systemctl ${action} ${unit} failed`,
      );
    return { success: true };
  }

  static async logs(unit, lines = 200) {
    assertUnit(unit);
    const n = String(Math.min(Math.max(parseInt(lines) || 200, 10), 2000));
    const r = await run(
      "journalctl",
      ["-u", unit, "-n", n, "--no-pager", "-o", "short-iso"],
      { timeout: 20000 },
    );
    return { unit, lines: r.stdout.split("\n").filter(Boolean) };
  }
}
