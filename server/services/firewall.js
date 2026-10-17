import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { run, which } from "../lib/shell.js";
import { httpError } from "../lib/config.js";
import { assertIpOrCidr } from "../lib/validate.js";

const ACTIONS = ["allow", "deny", "reject", "limit"];
const PROTOS = ["tcp", "udp"];
const COMMENT = /^[A-Za-z0-9 _.,:@()/+-]{1,60}$/;
// ufw rule tokens as printed by `ufw show added`
const TOKEN = /^[A-Za-z0-9_.,:/()-]+$/;

/**
 * Port sshd listens on, from sshd_config (and sshd_config.d/*.conf).
 */
export function sshPort() {
  const files = ["/etc/ssh/sshd_config"];
  if (existsSync("/etc/ssh/sshd_config.d"))
    for (const f of readdirSync("/etc/ssh/sshd_config.d")) if (f.endsWith(".conf")) files.push(join("/etc/ssh/sshd_config.d", f));
  for (const file of files) {
    try {
      const m = readFileSync(file, "utf-8").match(/^\s*Port\s+(\d+)/m);
      if (m) return parseInt(m[1]);
    } catch {}
  }
  return 22;
}

/**
 * Parse `ufw status numbered`:
 *   [ 1] 22/tcp                     ALLOW IN    Anywhere                   # SSH
 */
function parseNumbered(stdout) {
  const rules = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT|FWD))?\s+(.+?)\s*(?:#\s*(.*))?$/);
    if (!m) continue;
    const v6 = /\(v6\)/.test(m[2]) || /\(v6\)/.test(m[5]);
    rules.push({
      number: parseInt(m[1]),
      to: m[2].replace(/\s*\(v6\)\s*$/, "").trim(),
      action: m[3].toLowerCase(),
      direction: (m[4] || "IN").toLowerCase(),
      from: m[5].replace(/\s*\(v6\)\s*$/, "").trim(),
      v6,
      comment: (m[6] || "").trim(),
    });
  }
  return rules;
}

function portOf(to) {
  const m = String(to).match(/^(\d+)(?:\/(tcp|udp))?$/);
  return m ? parseInt(m[1]) : null;
}

/**
 * UFW firewall: status, rules, enable/disable — never locking out SSH.
 */
export class Firewall {
  static async ufw(args) {
    return run("ufw", args, { timeout: 30000 });
  }

  static async status() {
    if (!(await which("ufw"))) return { installed: false, sshPort: sshPort() };
    const [verbose, numbered] = await Promise.all([Firewall.ufw(["status", "verbose"]), Firewall.ufw(["status", "numbered"])]);
    if (verbose.code !== 0) throw httpError(500, (verbose.stderr || verbose.stdout).trim() || "ufw status failed (the panel must run as root)");
    const active = /Status:\s+active/.test(verbose.stdout);
    const defaults = verbose.stdout.match(/Default:\s*(\w+) \(incoming\),\s*(\w+) \(outgoing\)/);
    const status = {
      installed: true,
      active,
      incoming: defaults?.[1] || null,
      outgoing: defaults?.[2] || null,
      logging: (verbose.stdout.match(/Logging:\s*(.+)/) || [])[1]?.trim() || null,
      sshPort: sshPort(),
      rules: active ? parseNumbered(numbered.stdout) : [],
      pending: [],
    };
    if (!active) {
      // Rules added while ufw is off take effect when it is enabled
      const added = await Firewall.ufw(["show", "added"]);
      status.pending = added.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("ufw "))
        .map((l) => l.slice(4));
    }
    return status;
  }

  static installScript() {
    return `
apt_get update
apt_get install ufw
ufw --version
echo "ufw installed (not enabled yet). Enable it from the Firewall page — SSH stays allowed."
`;
  }

  /**
   * Enable with SSH (and how you reach the panel) allowed first.
   * viaProxy: the panel is behind nginx, so allow 80/443 instead of its own port.
   */
  static async enable({ panelPort, viaProxy }) {
    const ssh = sshPort();
    const allow = [[`${ssh}/tcp`, "SSH"]];
    if (viaProxy) allow.push(["80/tcp", "HTTP"], ["443/tcp", "HTTPS"]);
    else if (panelPort) allow.push([`${panelPort}/tcp`, "VPS Panel"]);
    for (const [port, comment] of allow) {
      const r = await Firewall.ufw(["allow", port, "comment", comment]);
      if (r.code !== 0) throw httpError(500, `Could not allow ${port}: ${(r.stderr || r.stdout).trim()}`);
    }
    const r = await Firewall.ufw(["--force", "enable"]);
    if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim());
    return { success: true, allowed: allow.map(([p]) => p) };
  }

  static async disable() {
    const r = await Firewall.ufw(["disable"]);
    if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim());
    return { success: true };
  }

  /**
   * { action: allow|deny|reject|limit, port: "443" | "8000:8100", proto: tcp|udp|"", from: IP/CIDR|"", comment }
   */
  static async addRule({ action, port, proto, from, comment }) {
    if (!ACTIONS.includes(action)) throw httpError(400, "Action must be allow, deny, reject or limit");
    const p = String(port || "").trim();
    const pr = String(proto || "").trim();
    const src = String(from || "").trim();
    if (p && !/^\d{1,5}(:\d{1,5})?$/.test(p)) throw httpError(400, "Port must be a number (443) or range (8000:8100)");
    for (const n of p ? p.split(":").map(Number) : []) if (n < 1 || n > 65535) throw httpError(400, "Ports go from 1 to 65535");
    if (pr && !PROTOS.includes(pr)) throw httpError(400, "Protocol must be tcp or udp");
    if (p.includes(":") && !pr) throw httpError(400, "A port range needs a protocol (tcp or udp)");
    if (src) assertIpOrCidr(src, "Source address");
    if (!p && !src) throw httpError(400, "Enter a port, a source address, or both");
    if (comment && !COMMENT.test(comment)) throw httpError(400, "Comments may use letters, numbers and . , : @ ( ) / + -");

    const ssh = sshPort();
    if (action !== "allow" && action !== "limit" && !src && p === String(ssh))
      throw httpError(400, `Blocking port ${ssh} for everyone would lock you out of SSH`);

    let args;
    if (!src) args = [action, pr ? `${p}/${pr}` : p];
    else args = [action, "from", src, ...(p ? ["to", "any", "port", p, ...(pr ? ["proto", pr] : [])] : [])];
    if (comment) args.push("comment", comment);

    // Blocking an address must come before the allow rules, or it never matches
    const status = await Firewall.status();
    if (status.active && action !== "allow" && src && status.rules.length) args = ["insert", "1", ...args];

    const r = await Firewall.ufw(args);
    if (r.code !== 0 || /ERROR/i.test(r.stdout)) throw httpError(400, (r.stderr || r.stdout).trim());
    return { success: true, output: r.stdout.trim() };
  }

  /**
   * Delete by number (active firewall) or by the rule text from `ufw show added`.
   */
  static async deleteRule({ number, spec }) {
    const status = await Firewall.status();
    if (number !== undefined && number !== null) {
      const n = parseInt(number);
      const rule = status.rules.find((r) => r.number === n);
      if (!rule) throw httpError(404, "Rule not found — the firewall changed, refresh and try again");
      const ssh = sshPort();
      if (rule.action === "allow" && portOf(rule.to) === ssh && rule.from === "Anywhere") {
        const others = status.rules.filter((r) => r !== rule && r.action === "allow" && portOf(r.to) === ssh && r.v6 === rule.v6);
        if (!others.length) throw httpError(400, `This rule keeps SSH (port ${ssh}) reachable — deleting it would lock you out`);
      }
      const r = await Firewall.ufw(["--force", "delete", String(n)]);
      if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim());
      return { success: true };
    }
    const full = String(spec || "").trim();
    if (!status.pending.includes(full)) throw httpError(404, "Rule not found");
    // `ufw delete` takes the rule without its comment
    const tokens = full.replace(/\s+comment\s+'[^']*'\s*$/, "").split(/\s+/);
    if (!tokens.every((t) => TOKEN.test(t)) || !ACTIONS.includes(tokens[0])) throw httpError(400, "Invalid rule");
    const r = await Firewall.ufw(["delete", ...tokens]);
    if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim());
    return { success: true };
  }
}
