import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  realpathSync,
} from "fs";
import { run, serviceCtl, serviceActive, isDebianLike } from "../lib/shell.js";
import { httpError } from "../lib/config.js";
import { NginxManager } from "./nginx-manager.js";

const VERSION = /^\d+\.\d+$/;
const EXT_NAME = /^[a-z0-9][a-z0-9._-]{0,40}$/;

// Installed together with every new PHP version (skipped if a package doesn't exist for it)
export const DEFAULT_EXTENSIONS = [
  "cli",
  "fpm",
  "common",
  "mysql",
  "curl",
  "gd",
  "mbstring",
  "xml",
  "zip",
  "bcmath",
  "intl",
  "readline",
  "opcache",
  "sqlite3",
  "imagick",
  "redis",
];

// php.ini keys exposed as a form in the dashboard
export const INI_KEYS = [
  "memory_limit",
  "upload_max_filesize",
  "post_max_size",
  "max_execution_time",
  "max_input_time",
  "max_input_vars",
  "display_errors",
  "error_reporting",
  "date.timezone",
  "short_open_tag",
  "allow_url_fopen",
];

export function assertVersion(v) {
  if (!VERSION.test(v || ""))
    throw httpError(400, `Invalid PHP version "${v}"`);
}

/**
 * PHP manager — multiple PHP-FPM versions side by side (Debian/Ubuntu layout under /etc/php/<ver>).
 */
export class PhpManager {
  static installedVersions() {
    if (!existsSync("/etc/php")) return [];
    return readdirSync("/etc/php")
      .filter((v) => VERSION.test(v))
      .sort((a, b) => parseFloat(b) - parseFloat(a) || b.localeCompare(a));
  }

  static async repoStatus() {
    const dir = "/etc/apt/sources.list.d";
    let configured = false;
    if (existsSync(dir)) {
      configured = readdirSync(dir).some(
        (f) => /ondrej|sury|php/i.test(f) && /\.(list|sources)$/.test(f),
      );
    }
    const osRelease = existsSync("/etc/os-release")
      ? readFileSync("/etc/os-release", "utf-8")
      : "";
    const distro =
      (osRelease.match(/^ID=(.*)$/m) || [])[1]?.replace(/"/g, "") || "unknown";
    return { configured, distro, supported: isDebianLike() };
  }

  /**
   * PHP versions installable from apt (after the ondrej/sury repository is added).
   */
  static async availableVersions() {
    const { stdout } = await run("apt-cache", ["pkgnames", "php"], {
      timeout: 30000,
    });
    const versions = new Set();
    for (const name of stdout.split("\n")) {
      const m = name.match(/^php(\d+\.\d+)-fpm$/);
      if (m) versions.add(m[1]);
    }
    return [...versions].sort(
      (a, b) => parseFloat(b) - parseFloat(a) || b.localeCompare(a),
    );
  }

  static async defaultCli() {
    try {
      const target = realpathSync("/usr/bin/php");
      return (target.match(/php(\d+\.\d+)$/) || [])[1] || null;
    } catch {
      return null;
    }
  }

  static async versionInfo(v) {
    const fpmInstalled = existsSync(`/usr/sbin/php-fpm${v}`);
    const cliInstalled = existsSync(`/usr/bin/php${v}`);
    const [running, modules, full] = await Promise.all([
      fpmInstalled ? serviceActive(`php${v}-fpm`) : false,
      cliInstalled
        ? run(`/usr/bin/php${v}`, ["-m"], { timeout: 10000 })
        : Promise.resolve({ stdout: "" }),
      cliInstalled
        ? run(`/usr/bin/php${v}`, ["-r", "echo PHP_VERSION;"], {
            timeout: 10000,
          })
        : Promise.resolve({ stdout: "" }),
    ]);
    const extensions = modules.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("["));
    return {
      version: v,
      fullVersion: full.stdout.trim() || v,
      fpmInstalled,
      cliInstalled,
      running,
      socket: `/run/php/php${v}-fpm.sock`,
      fpmIni: existsSync(`/etc/php/${v}/fpm/php.ini`)
        ? `/etc/php/${v}/fpm/php.ini`
        : null,
      cliIni: existsSync(`/etc/php/${v}/cli/php.ini`)
        ? `/etc/php/${v}/cli/php.ini`
        : null,
      poolConf: existsSync(`/etc/php/${v}/fpm/pool.d/www.conf`)
        ? `/etc/php/${v}/fpm/pool.d/www.conf`
        : null,
      extensions: [...new Set(extensions)].sort(),
    };
  }

  static async overview() {
    const versions = PhpManager.installedVersions();
    const sites = NginxManager.listSites();
    const [infos, repo, defaultCli] = await Promise.all([
      Promise.all(versions.map((v) => PhpManager.versionInfo(v))),
      PhpManager.repoStatus(),
      PhpManager.defaultCli(),
    ]);
    for (const info of infos) {
      info.sites = sites
        .filter((s) => s.phpVersion === info.version)
        .map((s) => s.name);
    }
    return { versions: infos, repo, defaultCli };
  }

  // ── Install scripts (run through JobRunner) ────────────────

  static addRepoScript() {
    return `
. /etc/os-release
apt_get update
apt_get install ca-certificates curl gnupg lsb-release
if [ "$ID" = "ubuntu" ]; then
  apt_get install software-properties-common
  LC_ALL=C.UTF-8 add-apt-repository -y ppa:ondrej/php
else
  curl -fsSLo /usr/share/keyrings/deb.sury.org-php.gpg https://packages.sury.org/php/apt.gpg
  echo "deb [signed-by=/usr/share/keyrings/deb.sury.org-php.gpg] https://packages.sury.org/php/ $VERSION_CODENAME main" > /etc/apt/sources.list.d/php-sury.list
fi
apt_get update
echo "PHP repository added. Available FPM versions:"
apt-cache pkgnames php | grep -E '^php[0-9]+\\.[0-9]+-fpm$' | sort -V
`;
  }

  static installScript(version, extensions = DEFAULT_EXTENSIONS) {
    assertVersion(version);
    const exts = [...new Set(["cli", "fpm", "common", ...extensions])];
    exts.forEach((e) => {
      if (!EXT_NAME.test(e)) throw httpError(400, `Invalid extension "${e}"`);
    });
    const pkgs = exts.map((e) => `php${version}-${e}`).join(" ");
    return `
apt_get update
PKGS=""
for p in ${pkgs}; do
  if apt-cache show "$p" >/dev/null 2>&1; then PKGS="$PKGS $p"; else echo "Skipping $p (not available for PHP ${version})"; fi
done
if ! echo "$PKGS" | grep -q "php${version}-fpm"; then
  echo "PHP ${version} is not available from apt. Add the PHP repository first."
  exit 1
fi
echo "Installing:$PKGS"
apt_get install $PKGS
svc_enable php${version}-fpm
php${version} -v
echo ""
echo "PHP ${version} installed. FPM socket: /run/php/php${version}-fpm.sock"
`;
  }

  static uninstallScript(version) {
    assertVersion(version);
    return `
PKGS=$(dpkg-query -W -f='\${Package} \${Status}\\n' 'php${version}-*' 2>/dev/null | awk '/install ok installed/ {print $1}')
if [ -z "$PKGS" ]; then echo "No PHP ${version} packages installed."; exit 0; fi
echo "Removing: $PKGS"
apt_get purge $PKGS
apt_get autoremove
echo "PHP ${version} removed."
`;
  }

  static extensionScript(version, ext, action) {
    assertVersion(version);
    if (!EXT_NAME.test(ext || ""))
      throw httpError(400, "Invalid extension name");
    const pkg = `php${version}-${ext}`;
    return action === "remove"
      ? `apt_get remove ${pkg}\nsvc_restart php${version}-fpm\necho "Removed ${pkg}"`
      : `apt_get update\napt_get install ${pkg}\nsvc_restart php${version}-fpm\necho "Installed ${pkg}"`;
  }

  /**
   * Extension packages available for a version, flagged when installed.
   */
  static async extensionPackages(version) {
    assertVersion(version);
    const [{ stdout: all }, { stdout: installed }] = await Promise.all([
      run("apt-cache", ["pkgnames", `php${version}-`], { timeout: 30000 }),
      run(
        "dpkg-query",
        ["-W", "-f=${Package} ${Status}\n", `php${version}-*`],
        { timeout: 30000 },
      ),
    ]);
    const installedSet = new Set(
      installed
        .split("\n")
        .filter((l) => l.includes("install ok installed"))
        .map((l) => l.split(" ")[0]),
    );
    const prefix = `php${version}-`;
    const skip = new Set([
      "dev",
      "dbgsym",
      "phpdbg",
      "cgi",
      "fpm",
      "cli",
      "common",
    ]);
    return all
      .split("\n")
      .filter((p) => p.startsWith(prefix) && !p.endsWith("-dbgsym"))
      .map((p) => p.slice(prefix.length))
      .filter((e) => e && !skip.has(e))
      .sort()
      .map((name) => ({ name, installed: installedSet.has(prefix + name) }));
  }

  // ── Services & defaults ────────────────────────────────────

  static async control(version, action) {
    assertVersion(version);
    if (!["start", "stop", "restart", "reload"].includes(action))
      throw httpError(400, "Invalid action");
    if (action !== "stop") {
      const test = await run(`/usr/sbin/php-fpm${version}`, ["-t"], {
        timeout: 15000,
      });
      if (test.code !== 0)
        throw httpError(
          400,
          `php-fpm configuration test failed:\n${(test.stderr || test.stdout).trim()}`,
        );
    }
    const r = await serviceCtl(action, `php${version}-fpm`);
    if (r.code !== 0)
      throw httpError(
        500,
        (r.stderr || r.stdout).trim() || `php${version}-fpm ${action} failed`,
      );
    return { success: true };
  }

  static async setDefaultCli(version) {
    assertVersion(version);
    if (!existsSync(`/usr/bin/php${version}`))
      throw httpError(400, `PHP ${version} CLI is not installed`);
    const r = await run(
      "update-alternatives",
      ["--set", "php", `/usr/bin/php${version}`],
      { timeout: 15000 },
    );
    if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim());
    return { success: true };
  }

  // ── php.ini ────────────────────────────────────────────────

  static iniPath(version, sapi = "fpm") {
    assertVersion(version);
    if (!["fpm", "cli"].includes(sapi))
      throw httpError(400, "sapi must be fpm or cli");
    const file = `/etc/php/${version}/${sapi}/php.ini`;
    if (!existsSync(file)) throw httpError(404, `${file} not found`);
    return file;
  }

  static readIniSettings(version, sapi) {
    const text = readFileSync(PhpManager.iniPath(version, sapi), "utf-8");
    const settings = {};
    for (const key of INI_KEYS) {
      const re = new RegExp(
        `^\\s*${key.replace(".", "\\.")}\\s*=\\s*(.*)$`,
        "m",
      );
      const m = text.match(re);
      settings[key] = m ? m[1].trim().replace(/^"(.*)"$/, "$1") : "";
    }
    return settings;
  }

  /**
   * Update selected keys in php.ini (uncommenting them if needed), then restart FPM.
   */
  static async writeIniSettings(version, sapi, updates) {
    const file = PhpManager.iniPath(version, sapi);
    let text = readFileSync(file, "utf-8");
    for (const [key, raw] of Object.entries(updates || {})) {
      if (!INI_KEYS.includes(key)) continue;
      const value = String(raw).trim();
      if (!/^[A-Za-z0-9_./ ~&|^!-]*$/.test(value))
        throw httpError(400, `Invalid value for ${key}`);
      const escapedKey = key.replace(".", "\\.");
      const active = new RegExp(`^\\s*${escapedKey}\\s*=.*$`, "m");
      const commented = new RegExp(`^\\s*;\\s*${escapedKey}\\s*=.*$`, "m");
      const line = `${key} = ${value}`;
      if (active.test(text)) text = text.replace(active, line);
      else if (commented.test(text)) text = text.replace(commented, line);
      else text += `\n${line}\n`;
    }
    copyFileSync(file, `${file}.bak`);
    writeFileSync(file, text);
    if (sapi === "fpm") {
      try {
        await PhpManager.control(version, "restart");
      } catch (err) {
        copyFileSync(`${file}.bak`, file); // keep FPM running with the old settings
        await serviceCtl("restart", `php${version}-fpm`);
        throw httpError(
          400,
          `New settings rejected, restored previous php.ini: ${err.message}`,
        );
      }
    }
    return { success: true };
  }
}
