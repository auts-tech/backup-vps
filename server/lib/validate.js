import { resolve } from "path";
import { isIP } from "net";
import { httpError } from "./config.js";

// Folders a website must never live in (or be): deleting or chown-ing them would break the server
const SYSTEM_PATHS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/home",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/media",
  "/mnt",
  "/opt",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/snap",
  "/srv",
  "/sys",
  "/tmp",
  "/usr",
  "/var",
  "/var/www",
  "/var/lib",
  "/var/log",
]);

const SITE_SLUG = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;
const GIT_URL =
  /^((https?|ssh|git|file):\/\/[^\s]+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+)$/;

/**
 * Name of a new website: used for its folder, nginx config, PM2 process and backups.
 */
export function assertSiteName(name) {
  if (!SITE_SLUG.test(name || "") || name.includes(".."))
    throw httpError(
      400,
      "Website names may use lowercase letters, numbers, dots, - and _ (max 63), e.g. my-shop",
    );
  return name;
}

/**
 * Turn a domain or repository name into a valid website name.
 */
export function slugify(text) {
  return (
    String(text || "")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\.git$/, "")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
      .slice(0, 63) || "site"
  );
}

export function isSystemPath(p) {
  return SYSTEM_PATHS.has(p);
}

/**
 * Absolute folder for a website's code. Refuses system folders and anything
 * nginx could not use as a `root` (spaces, quotes, ; { }).
 */
export function assertSitePath(p, field = "Folder") {
  if (typeof p !== "string" || !p.startsWith("/"))
    throw httpError(
      400,
      `${field} must be an absolute path, e.g. /var/www/my-site`,
    );
  if (/[\0\r\n;{}\s'"`$\\]/.test(p))
    throw httpError(
      400,
      `${field} must not contain spaces, quotes or special characters`,
    );
  const clean = resolve(p);
  if (SYSTEM_PATHS.has(clean) || clean.split("/").length < 3)
    throw httpError(
      400,
      `${field} ${clean} is a system folder — use a subfolder such as /var/www/my-site`,
    );
  return clean;
}

/**
 * Optional sub folder served by the web server (dist, public, build, public_html).
 */
export function assertWebRoot(dir) {
  const clean = String(dir || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!clean) return "";
  if (
    clean.split("/").some((part) => part === ".." || part === ".") ||
    !/^[A-Za-z0-9._/-]{1,120}$/.test(clean)
  )
    throw httpError(
      400,
      "Web root must be a folder inside the website, e.g. public or dist",
    );
  return clean;
}

export function assertBranch(branch) {
  const b = String(branch || "").trim();
  if (!BRANCH.test(b) || b.endsWith("/") || b.endsWith(".lock"))
    throw httpError(400, `Invalid branch name "${branch}"`);
  return b;
}

export function assertGitUrl(url) {
  const u = String(url || "").trim();
  if (!GIT_URL.test(u) || u.startsWith("-"))
    throw httpError(
      400,
      "Enter a Git URL like https://github.com/org/repo.git or git@github.com:org/repo.git",
    );
  return u;
}

/**
 * Hide credentials embedded in an https Git URL (https://user:token@host/...).
 */
export function maskGitUrl(url) {
  return String(url || "").replace(/\/\/[^@/]+@/, "//***@");
}

export function assertPort(port, field = "Port") {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1024 || n > 65535)
    throw httpError(400, `${field} must be a number between 1024 and 65535`);
  return n;
}

/**
 * IPv4/IPv6 address, optionally with a CIDR suffix (10.0.0.0/8).
 */
export function assertIpOrCidr(value, field = "Address") {
  const v = String(value || "").trim();
  const [ip, bits, extra] = v.split("/");
  const family = isIP(ip);
  const maxBits = family === 6 ? 128 : 32;
  if (
    !family ||
    extra !== undefined ||
    (bits !== undefined && (!/^\d{1,3}$/.test(bits) || Number(bits) > maxBits))
  )
    throw httpError(
      400,
      `${field} must be an IP address or range, e.g. 203.0.113.7 or 10.0.0.0/8`,
    );
  return v;
}
