import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { hostname } from "os";
import { run } from "../lib/shell.js";
import { httpError } from "../lib/config.js";

const KEY =
  /(?:^|\s)(ssh-ed25519|ssh-rsa|ssh-dss|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+([A-Za-z0-9+/]+={0,3})(?:\s+(.*))?$/;
const DEPLOY_KEYS = ["id_ed25519", "id_ecdsa", "id_rsa"];
const GIT_HOSTS = {
  github: "github.com",
  gitlab: "gitlab.com",
  bitbucket: "bitbucket.org",
};

function sshDir() {
  return join(process.env.HOME || "/root", ".ssh");
}

function parseKey(line) {
  const m = String(line).trim().match(KEY);
  if (!m) return null;
  return {
    type: m[1],
    key: m[2],
    comment: (m[3] || "").trim(),
    options: String(line).trim().slice(0, m.index).trim(),
    fingerprint: `SHA256:${createHash("sha256").update(Buffer.from(m[2], "base64")).digest("base64").replace(/=+$/, "")}`,
  };
}

function passwordLoginDisabled() {
  const files = ["/etc/ssh/sshd_config"];
  if (existsSync("/etc/ssh/sshd_config.d"))
    for (const f of readdirSync("/etc/ssh/sshd_config.d"))
      if (f.endsWith(".conf")) files.push(join("/etc/ssh/sshd_config.d", f));
  return files.some((f) => {
    try {
      return /^\s*PasswordAuthentication\s+no\b/im.test(
        readFileSync(f, "utf-8"),
      );
    } catch {
      return false;
    }
  });
}

/**
 * SSH access: keys allowed to log in as the panel's user (root), and the
 * server's own key used to pull private Git repositories ("deploy key").
 */
export class SshKeys {
  static authorizedFile() {
    return join(sshDir(), "authorized_keys");
  }

  static list() {
    const file = SshKeys.authorizedFile();
    if (!existsSync(file))
      return { keys: [], file, passwordLoginDisabled: passwordLoginDisabled() };
    const keys = readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map(parseKey)
      .filter(Boolean)
      .map(({ type, comment, options, fingerprint }) => ({
        type,
        comment,
        options,
        fingerprint,
      }));
    return { keys, file, passwordLoginDisabled: passwordLoginDisabled() };
  }

  static add(publicKey, comment) {
    if (/PRIVATE KEY/.test(publicKey || ""))
      throw httpError(
        400,
        "That is a private key — paste the .pub file instead",
      );
    const lines = String(publicKey || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length !== 1)
      throw httpError(
        400,
        "Paste exactly one public key (one line, e.g. ssh-ed25519 AAAA… you@laptop)",
      );
    const parsed = parseKey(lines[0]);
    if (!parsed)
      throw httpError(
        400,
        "That is not an OpenSSH public key — it should start with ssh-ed25519, ssh-rsa or ecdsa-sha2-…",
      );
    const label = String(comment || parsed.comment || "")
      .replace(/[^\w .@:+-]/g, "")
      .slice(0, 80);
    if (SshKeys.list().keys.some((k) => k.fingerprint === parsed.fingerprint))
      throw httpError(409, "This key is already authorized");

    mkdirSync(sshDir(), { recursive: true, mode: 0o700 });
    chmodSync(sshDir(), 0o700);
    const file = SshKeys.authorizedFile();
    const current = existsSync(file) ? readFileSync(file, "utf-8") : "";
    const line = `${parsed.options ? `${parsed.options} ` : ""}${parsed.type} ${parsed.key}${label ? ` ${label}` : ""}`;
    writeFileSync(
      file,
      `${current}${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`,
      { mode: 0o600 },
    );
    chmodSync(file, 0o600);
    return { success: true, fingerprint: parsed.fingerprint };
  }

  static remove(fingerprint) {
    const file = SshKeys.authorizedFile();
    if (!existsSync(file)) throw httpError(404, "Key not found");
    const lines = readFileSync(file, "utf-8").split("\n");
    const keep = lines.filter((l) => parseKey(l)?.fingerprint !== fingerprint);
    if (keep.length === lines.length) throw httpError(404, "Key not found");
    const remaining = keep.filter((l) => parseKey(l)).length;
    if (remaining === 0 && passwordLoginDisabled())
      throw httpError(
        400,
        "This is the last key and password login is disabled — removing it would lock you out of SSH",
      );
    writeFileSync(file, keep.join("\n"), { mode: 0o600 });
    return { success: true };
  }

  /**
   * The server's own public key, if it has one.
   */
  static deployKey() {
    for (const name of DEPLOY_KEYS) {
      const pub = join(sshDir(), `${name}.pub`);
      if (!existsSync(pub)) continue;
      const text = readFileSync(pub, "utf-8").trim();
      const parsed = parseKey(text);
      if (parsed)
        return {
          exists: true,
          path: pub,
          type: parsed.type,
          publicKey: text,
          fingerprint: parsed.fingerprint,
        };
    }
    return { exists: false };
  }

  static async generateDeployKey() {
    if (SshKeys.deployKey().exists)
      throw httpError(409, "This server already has a key");
    mkdirSync(sshDir(), { recursive: true, mode: 0o700 });
    const r = await run(
      "ssh-keygen",
      [
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        `vps-panel@${hostname()}`,
        "-f",
        join(sshDir(), "id_ed25519"),
      ],
      { timeout: 30000 },
    );
    if (r.code !== 0)
      throw httpError(
        500,
        (r.stderr || r.stdout).trim() || "ssh-keygen failed",
      );
    return SshKeys.deployKey();
  }

  /**
   * Check whether the deploy key can reach a Git host (ssh -T git@host).
   */
  static async testGitHost(host) {
    const target = GIT_HOSTS[host] || String(host || "");
    if (!/^[A-Za-z0-9.-]{3,253}$/.test(target))
      throw httpError(400, "Invalid host");
    const r = await run(
      "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
        `git@${target}`,
      ],
      { timeout: 25000 },
    );
    const output = `${r.stdout}\n${r.stderr}`.trim();
    const ok =
      /successfully authenticated|Welcome to GitLab|authenticated via|You can use git|Hi .+!/i.test(
        output,
      );
    return { host: target, ok, output };
  }
}
