import { existsSync, mkdirSync, symlinkSync, rmSync } from "fs";
import { join } from "path";
import { DATA_DIR, httpError } from "../lib/config.js";
import { run, which, toolEnv, shq } from "../lib/shell.js";
import { assertSitePath } from "../lib/validate.js";

const VERSION = /^\d+\.\d+$/;
const PACKAGE =
  /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9]([_.-]?[a-z0-9]+)*(:[A-Za-z0-9.*^~|<>=!@,_-]+)?$/;

// Commands offered in the dashboard and the flags each one accepts
export const COMPOSER_COMMANDS = {
  install: [
    "--no-dev",
    "--optimize-autoloader",
    "--no-scripts",
    "--ignore-platform-reqs",
  ],
  update: [
    "--no-dev",
    "--optimize-autoloader",
    "--with-all-dependencies",
    "--no-scripts",
    "--ignore-platform-reqs",
  ],
  require: [
    "--dev",
    "--no-update",
    "--with-all-dependencies",
    "--ignore-platform-reqs",
  ],
  remove: ["--dev", "--no-update"],
  "dump-autoload": ["--optimize", "--no-dev"],
  validate: [],
  diagnose: [],
};
const PACKAGE_COMMANDS = new Set(["require", "remove"]);

/**
 * PHP CLI binary for a version (php8.3), or the default `php`.
 */
export function phpBinary(version) {
  if (version && VERSION.test(version) && existsSync(`/usr/bin/php${version}`))
    return `/usr/bin/php${version}`;
  return null;
}

/**
 * A folder with a `php` symlink to the given version. Put first in PATH it
 * makes `php artisan` and `composer` in deploy scripts use the site's PHP.
 */
export function phpShimDir(version) {
  const bin = phpBinary(version);
  if (!bin) return null;
  const dir = join(DATA_DIR, "bin", `php${version}`);
  try {
    mkdirSync(dir, { recursive: true });
    rmSync(join(dir, "php"), { force: true });
    symlinkSync(bin, join(dir, "php"));
    return dir;
  } catch {
    return null;
  }
}

/**
 * Composer — the PHP package manager — installed once for all PHP versions.
 */
export class ComposerManager {
  static async status() {
    const path = await which("composer");
    if (!path) return { installed: false, commands: COMPOSER_COMMANDS };
    const r = await run(path, ["--version", "--no-ansi"], {
      env: toolEnv(),
      timeout: 30000,
    });
    const text = `${r.stdout}\n${r.stderr}`;
    return {
      installed: true,
      path,
      version:
        (text.match(/Composer (?:version )?(\d+\.\d+\.\d+\S*)/) || [])[1] ||
        null,
      phpVersion: (text.match(/PHP version (\d+\.\d+\.\d+)/) || [])[1] || null,
      commands: COMPOSER_COMMANDS,
    };
  }

  /**
   * Official installer, verified against the published SHA-384 checksum.
   */
  static installScript() {
    return `
if ! command -v php >/dev/null 2>&1; then
  echo "No PHP CLI found — install a PHP version first (PHP page)."
  exit 1
fi
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
echo "Downloading the Composer installer..."
EXPECTED="$(curl -fsSL https://composer.github.io/installer.sig)"
curl -fsSL https://getcomposer.org/installer -o composer-setup.php
ACTUAL="$(php -r "echo hash_file('sha384', 'composer-setup.php');")"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "ERROR: installer checksum mismatch — download aborted."
  exit 1
fi
php composer-setup.php --quiet --install-dir=/usr/local/bin --filename=composer
composer --version --no-ansi
echo ""
echo "Composer is installed at /usr/local/bin/composer."
`;
  }

  static selfUpdateScript() {
    return `
if ! command -v composer >/dev/null 2>&1; then echo "Composer is not installed."; exit 1; fi
composer self-update --no-interaction --no-ansi
composer --version --no-ansi
`;
  }

  /**
   * Run a Composer command inside a project folder with a chosen PHP version.
   */
  static runScript({ dir, version, command, packageName, flags = [] }) {
    const folder = assertSitePath(dir, "Project folder");
    if (!existsSync(folder)) throw httpError(404, `${folder} does not exist`);
    if (!COMPOSER_COMMANDS[command])
      throw httpError(400, `Unsupported composer command "${command}"`);
    if (
      command !== "require" &&
      command !== "diagnose" &&
      !existsSync(join(folder, "composer.json"))
    )
      throw httpError(400, `${folder} has no composer.json`);
    const args = [command];
    if (PACKAGE_COMMANDS.has(command)) {
      const pkgs = String(packageName || "")
        .split(/\s+/)
        .filter(Boolean);
      if (!pkgs.length || !pkgs.every((p) => PACKAGE.test(p)))
        throw httpError(
          400,
          "Enter a package like vendor/package or vendor/package:^2.0",
        );
      args.push(...pkgs);
    }
    for (const flag of Array.isArray(flags) ? flags : []) {
      if (!COMPOSER_COMMANDS[command].includes(flag))
        throw httpError(400, `Flag ${flag} is not allowed for ${command}`);
      args.push(flag);
    }
    let php = "php";
    if (version && version !== "default") {
      if (!VERSION.test(version)) throw httpError(400, "Invalid PHP version");
      php = phpBinary(version);
      if (!php) throw httpError(400, `PHP ${version} CLI is not installed`);
    }
    const shown = `composer ${args.join(" ")}`;
    return `
if ! command -v composer >/dev/null 2>&1; then echo "Composer is not installed — install it first."; exit 1; fi
cd ${shq(folder)}
echo "$ ${shown}   (PHP: $(${shq(php)} -r 'echo PHP_VERSION;'))"
${shq(php)} "$(command -v composer)" ${args.map(shq).join(" ")} --no-interaction --no-ansi
# Composer runs as root: give new files back to the folder's owner
for f in vendor composer.json composer.lock; do
  if [ -e "$f" ]; then chown -R --reference=. "$f" 2>/dev/null || true; fi
done
echo ""
echo "Done."
`;
  }
}
