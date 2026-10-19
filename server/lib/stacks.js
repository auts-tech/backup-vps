import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * What each kind of website needs:
 *   web      nginx template (static | spa | php | laravel | wordpress | proxy)
 *   process  runs as a long-lived app under PM2 (needs a port + start command)
 *   php      served by PHP-FPM (needs a PHP version)
 *   external reverse proxy to something the panel does not manage
 */
export const STACKS = {
  node: { label: "Node.js", web: "proxy", process: true },
  next: { label: "Next.js", web: "proxy", process: true },
  // Built once on deploy, then served as files; unknown paths fall back to index.html
  react: { label: "React / SPA", web: "spa" },
  laravel: { label: "Laravel", web: "laravel", php: true },
  php: { label: "PHP", web: "php", php: true },
  wordpress: { label: "WordPress", web: "wordpress", php: true },
  static: { label: "Static site", web: "static" },
  python: { label: "Python", web: "proxy", process: true },
  proxy: { label: "Reverse proxy", web: "proxy", external: true },
};

export function normalizeStack(type) {
  if (type === "express") return "node";
  if (type === "spa" || type === "vue" || type === "vite") return "react";
  return STACKS[type] ? type : "static";
}

function readPackageJson(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
  } catch {
    return null;
  }
}

function deps(pkg) {
  return { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
}

/**
 * Best guess of a project's stack from the files in its folder.
 */
export function detectStack(dir) {
  if (!dir || !existsSync(dir)) return null;
  const has = (f) => existsSync(join(dir, f));
  if (has("artisan")) return "laravel";
  if (
    has("wp-config.php") ||
    has("wp-load.php") ||
    has("public_html/wp-load.php")
  )
    return "wordpress";
  const pkg = readPackageJson(dir);
  if (pkg) {
    const d = deps(pkg);
    if (d.next) return "next";
    const server = [
      "express",
      "fastify",
      "koa",
      "@nestjs/core",
      "@hapi/hapi",
      "hono",
      "@remix-run/serve",
      "nuxt",
      "@sveltejs/kit",
    ];
    if (server.some((s) => d[s])) return "node";
    // Front-end apps: `npm start` of Create React App / Vite is only a dev server
    const spa = ["react", "vue", "svelte", "@angular/core", "solid-js", "preact"];
    if (pkg.scripts?.build && !d.gatsby && !d.astro && spa.some((s) => d[s])) return "react";
    if (pkg.scripts?.start || pkg.main) return "node";
    if (pkg.scripts?.build) return "static"; // other front-end builds (Astro, Gatsby…) served as files
    return "node";
  }
  if (has("composer.json") || has("index.php")) return "php";
  if (has("requirements.txt") || has("pyproject.toml") || has("manage.py"))
    return "python";
  return "static";
}

function installCommand(dir) {
  const has = (f) => dir && existsSync(join(dir, f));
  if (has("pnpm-lock.yaml"))
    return "corepack enable\npnpm install --frozen-lockfile";
  if (has("yarn.lock"))
    return "corepack enable\nyarn install --frozen-lockfile";
  if (has("package-lock.json")) return "npm ci";
  return "npm install";
}

/**
 * Build/deploy script run in the website folder on every deployment.
 * PHP sites get `php` and `composer` for their own PHP version.
 */
export function defaultDeployScript(stack, dir, { database = false } = {}) {
  const has = (f) => dir && existsSync(join(dir, f));
  const pkg = dir ? readPackageJson(dir) : null;
  switch (stack) {
    case "node":
    case "next":
      return `${installCommand(dir)}\nnpm run build --if-present`;
    case "laravel":
      return [
        "composer install --no-dev --optimize-autoloader --no-interaction",
        ...(database
          ? ["php artisan migrate --force"]
          : ["# php artisan migrate --force"]),
        "php artisan storage:link || true",
        "php artisan config:cache",
        "php artisan route:cache",
        "php artisan view:cache",
      ].join("\n");
    case "php":
      return has("composer.json")
        ? "composer install --no-dev --optimize-autoloader --no-interaction"
        : "# Nothing to build — PHP files are served as they are";
    case "react":
      return `${installCommand(dir)}\nnpm run build`;
    case "static":
      return pkg?.scripts?.build
        ? `${installCommand(dir)}\nnpm run build`
        : "# Nothing to build — files are served as they are";
    case "python":
      return [
        "python3 -m venv .venv",
        ".venv/bin/pip install --upgrade pip",
        "if [ -f requirements.txt ]; then .venv/bin/pip install -r requirements.txt; fi",
      ].join("\n");
    case "wordpress":
      return "# WordPress updates itself from wp-admin — nothing to run on deploy";
    default:
      return "";
  }
}

/**
 * Command PM2 runs to start the app. $PORT is set to the website's port.
 */
export function defaultStartCommand(stack, dir) {
  const pkg = dir ? readPackageJson(dir) : null;
  if (stack === "next") return "npm start";
  if (stack === "node") {
    if (!pkg || pkg.scripts?.start) return "npm start";
    return `node ${pkg.main || "index.js"}`;
  }
  if (stack === "python") {
    if (dir && existsSync(join(dir, "main.py")))
      return ".venv/bin/python main.py";
    return ".venv/bin/python app.py";
  }
  return "";
}

/**
 * Sub folder nginx should serve for static/PHP sites (dist, build, public…).
 */
export function suggestWebRoot(stack, dir) {
  if (!dir) return "";
  const has = (f) => existsSync(join(dir, f));
  if (stack === "react") {
    const d = deps(readPackageJson(dir));
    return d["react-scripts"] ? "build" : "dist";
  }
  if (stack === "static") {
    const d = deps(readPackageJson(dir));
    if (d["react-scripts"]) return "build";
    if (d.gatsby) return "public";
    if (d.vite || d.astro || d["@vue/cli-service"] || d.parcel) return "dist";
    if (has("public_html")) return "public_html";
    if (!has("index.html") && has("public/index.html")) return "public";
    return "";
  }
  if (stack === "php") {
    if (has("public_html")) return "public_html";
    if (!has("index.php") && has("public/index.php")) return "public";
  }
  if (stack === "wordpress" && has("public_html/wp-load.php"))
    return "public_html";
  return "";
}

/**
 * True when a deploy script has at least one command (not just comments).
 */
export function hasCommands(script) {
  return String(script || "")
    .split("\n")
    .some((line) => line.trim() && !line.trim().startsWith("#"));
}
