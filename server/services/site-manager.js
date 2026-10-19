import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "fs";
import { join, dirname } from "path";
import { createServer } from "net";
import { randomBytes } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getConfig, updateConfig, httpError } from "../lib/config.js";
import { run, which, shq } from "../lib/shell.js";
import {
  assertSiteName,
  assertSitePath,
  assertWebRoot,
  assertBranch,
  assertGitUrl,
  assertPort,
  maskGitUrl,
  slugify,
  isSystemPath,
} from "../lib/validate.js";
import {
  STACKS,
  normalizeStack,
  detectStack,
  defaultDeployScript,
  defaultStartCommand,
  suggestWebRoot,
} from "../lib/stacks.js";
import { parseEnv, mergeEnv, isValidEnvKey } from "../lib/dotenv.js";
import {
  NginxManager,
  normalizeDomains,
  SITES_AVAILABLE,
} from "./nginx-manager.js";
import { ProcessManager } from "./process-manager.js";
import { DeployEngine } from "./deploy-engine.js";
import {
  MysqlManager,
  assertDbName,
  assertUser,
  PANEL_USER,
} from "./mysql-manager.js";
import { JobRunner } from "./job-runner.js";
import { CronManager } from "./cron-manager.js";
import { PhpManager } from "./php-manager.js";
import { BackupEngine, DEFAULT_BACKUP_EXCLUDES } from "./backup-engine.js";
import { ComposerManager, phpBinary } from "./composer-manager.js";
import { panelTasks, wrapCronCommand, siteCronJobs } from "./panel-tasks.js";
import { trafficStats, checkDns, diskUsage } from "./site-insights.js";

export const SITES_ROOT = process.env.PANEL_SITES_ROOT || "/var/www";

// Stacks whose code reads a .env file
const ENV_STACKS = new Set([
  "node",
  "next",
  "react",
  "laravel",
  "php",
  "static",
  "python",
]);

const NGINX_INSTALL_SCRIPT = `
apt_get update
apt_get install nginx
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
svc_enable nginx
ufw_allow 'Nginx Full'
nginx -v
echo "nginx installed and running."
`;

function randomPassword(length = 24) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return [...randomBytes(length)].map((b) => chars[b % chars.length]).join("");
}

function stackOf(site) {
  return STACKS[normalizeStack(site.type)];
}

/**
 * Fill in the fields that records from older versions (Projects page) lack.
 */
export function normalizeSite(p) {
  const type = normalizeStack(p.type);
  const stack = STACKS[type];
  return {
    ...p,
    type,
    description: p.description || "",
    deployPath: p.deployPath || null,
    webRoot: p.webRoot || "",
    gitUrl: p.gitUrl || "",
    branch: p.branch || (p.gitUrl ? "main" : null),
    port: p.port ? Number(p.port) : null,
    startCommand:
      p.startCommand ||
      (stack.process ? defaultStartCommand(type, p.deployPath) : ""),
    proxyTarget: p.proxyTarget || "",
    phpVersion: p.phpVersion || null,
    siteName: p.siteName || null,
    deploy: {
      script: p.deploy?.script ?? defaultDeployScript(type, p.deployPath),
      autoDeploy: !!p.deploy?.autoDeploy,
      webhookSecret: p.deploy?.webhookSecret || null,
      resetHard: !!p.deploy?.resetHard,
    },
    database: p.database || { type: "mysql", name: "", user: "", password: "" },
    backupDirs: Array.isArray(p.backupDirs) ? p.backupDirs : [],
    backupExcludes: Array.isArray(p.backupExcludes)
      ? p.backupExcludes
      : DEFAULT_BACKUP_EXCLUDES,
  };
}

function allSites() {
  return (getConfig().projects || []).map(normalizeSite);
}

export function getSite(id) {
  const raw = (getConfig().projects || []).find((p) => p.id === id);
  if (!raw) throw httpError(404, "Website not found");
  return normalizeSite(raw);
}

/**
 * Read-modify-write one website record.
 */
export function saveSite(id, mutator) {
  let saved = null;
  updateConfig((c) => {
    const list = c.projects || (c.projects = []);
    const i = list.findIndex((p) => p.id === id);
    if (i === -1) throw httpError(404, "Website not found");
    const next = mutator({ ...list[i] }) || list[i];
    next.updatedAt = new Date().toISOString();
    list[i] = next;
    saved = next;
  });
  return normalizeSite(saved);
}

/**
 * The website fields the dashboard sees (no passwords or webhook secret).
 */
function publicSite(site) {
  const { database = {}, deploy = {}, provision, ...rest } = site;
  return {
    ...rest,
    gitUrl: site.gitUrl ? maskGitUrl(site.gitUrl) : "",
    deploy: {
      script: deploy.script,
      autoDeploy: deploy.autoDeploy,
      resetHard: deploy.resetHard,
      hasWebhook: !!deploy.webhookSecret,
    },
    database: database.name
      ? {
          type: database.type || "mysql",
          name: database.name,
          user: database.user,
          hasPassword: !!database.password,
        }
      : null,
    provision: provision
      ? {
          status: provision.status,
          jobId: provision.jobId || null,
          error: provision.error || null,
          startedAt: provision.startedAt,
        }
      : null,
  };
}

function health(site, { stack, app, nginx, deploying }) {
  if (site.provision?.status === "running")
    return { state: "deploying", label: "Setting up" };
  if (site.provision?.status === "failed")
    return { state: "error", label: "Setup failed" };
  if (deploying) return { state: "deploying", label: "Deploying" };
  if (stack.process) {
    if (!app || app.status === "pm2-missing")
      return { state: "error", label: "PM2 not installed" };
    if (app.status === "online") {
      if (nginx && !nginx.enabled)
        return { state: "disabled", label: "Site disabled" };
      return { state: "live", label: nginx ? "Live" : "Running" };
    }
    if (app.status === "errored") return { state: "error", label: "Crashed" };
    if (app.status === "launching")
      return { state: "deploying", label: "Starting" };
    if (app.status === "not-started")
      return { state: "stopped", label: "Not started" };
    return { state: "stopped", label: "Stopped" };
  }
  if (!nginx) return { state: "idle", label: "No domain" };
  if (!nginx.enabled) return { state: "disabled", label: "Disabled" };
  return { state: "live", label: "Live" };
}

async function portFree(port) {
  const listening = await run("ss", ["-ltnH"], { timeout: 5000 });
  if (
    listening.code === 0 &&
    listening.stdout.split("\n").some((l) => new RegExp(`:${port}\\s`).test(l))
  )
    return false;
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });
}

function phpFpmVersions() {
  return PhpManager.installedVersions().filter((v) =>
    existsSync(`/etc/php/${v}/fpm`),
  );
}

/**
 * Newest installed PHP-FPM version that satisfies a composer constraint like "^8.2" or ">=8.1".
 */
function pickPhpVersion(constraint) {
  const installed = phpFpmVersions();
  const min = (String(constraint || "").match(/(\d+)\.(\d+)/) || [])
    .slice(1)
    .map(Number);
  const ok = installed.filter((v) => {
    if (!min.length) return true;
    const [maj, minor] = v.split(".").map(Number);
    return maj > min[0] || (maj === min[0] && minor >= min[1]);
  });
  return ok[0] || installed[0] || null;
}

function dnsName(name) {
  return (
    name
      .replace(/[^a-z0-9_]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase()
      .slice(0, 40) || "site"
  );
}

async function databaseExists(name) {
  return MysqlManager.with(async (c) => {
    const [rows] = await c.query(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
      [name],
    );
    return rows.length > 0;
  });
}

/**
 * Create a database plus a user with all privileges on it. The password is
 * always (re)set: CREATE USER IF NOT EXISTS keeps the old one of a leftover user.
 */
async function createDatabaseWithUser(db) {
  await MysqlManager.createDatabase({
    name: db.name,
    user: db.user,
    password: db.password,
  });
  await MysqlManager.setPassword(db.user, "localhost", db.password);
}

async function uniqueDbNames(siteName) {
  const base = dnsName(siteName);
  for (let i = 1; i < 50; i++) {
    const name = i === 1 ? base : `${base.slice(0, 37)}_${i}`;
    if (!(await databaseExists(name))) return { name, user: name.slice(0, 32) };
  }
  throw httpError(409, "Could not find a free database name");
}

function envUpdatesForDatabase(type, db) {
  if (type === "laravel")
    return {
      DB_CONNECTION: "mysql",
      DB_HOST: "127.0.0.1",
      DB_PORT: "3306",
      DB_DATABASE: db.name,
      DB_USERNAME: db.user,
      DB_PASSWORD: db.password,
    };
  return {
    DATABASE_URL: `mysql://${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}@127.0.0.1:3306/${db.name}`,
    DB_HOST: "127.0.0.1",
    DB_PORT: "3306",
    DB_NAME: db.name,
    DB_USER: db.user,
    DB_PASSWORD: db.password,
  };
}

/**
 * Write values into a website's .env (comments and order are kept) and give
 * the file to the folder's owner.
 */
async function updateEnvFile(site, updates, { fromExample = false } = {}) {
  const file = join(site.deployPath, ".env");
  const example = join(site.deployPath, ".env.example");
  const current = existsSync(file)
    ? readFileSync(file, "utf-8")
    : fromExample && existsSync(example)
      ? readFileSync(example, "utf-8")
      : "";
  writeFileSync(file, mergeEnv(current, updates), { mode: 0o640 });
  await run("chown", ["--reference", site.deployPath, file]);
  return file;
}

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

/**
 * The database a website's code already uses, from its .env (Laravel, Node,
 * DATABASE_URL) or WordPress wp-config.php. null when nothing is configured.
 */
export function detectDatabaseConfig(site) {
  if (!site.deployPath) return null;
  const read = (f) => {
    try {
      return readFileSync(f, "utf-8");
    } catch {
      return null;
    }
  };
  const env = read(join(site.deployPath, ".env"));
  if (env) {
    const vars = Object.fromEntries(parseEnv(env).map((v) => [v.key, v.value]));
    if (/^mysql2?:\/\//.test(vars.DATABASE_URL || "")) {
      try {
        const u = new URL(vars.DATABASE_URL);
        const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
        if (name)
          return {
            name,
            user: decodeURIComponent(u.username),
            password: decodeURIComponent(u.password),
            host: u.hostname,
            source: ".env (DATABASE_URL)",
          };
      } catch {}
    }
    const name = vars.DB_DATABASE || vars.DB_NAME || vars.MYSQL_DATABASE;
    if (name && /mysql|mariadb/i.test(vars.DB_CONNECTION || "mysql"))
      return {
        name,
        user: vars.DB_USERNAME || vars.DB_USER || vars.MYSQL_USER || "",
        password: vars.DB_PASSWORD || vars.MYSQL_PASSWORD || "",
        host: vars.DB_HOST || "localhost",
        source: ".env",
      };
  }
  const candidates = [
    join(site.deployPath, site.webRoot || "", "wp-config.php"),
    join(site.deployPath, "wp-config.php"),
    join(site.deployPath, "public_html", "wp-config.php"),
  ];
  for (const file of candidates) {
    const wp = read(file);
    if (!wp) continue;
    const def = (k) =>
      (wp.match(new RegExp(`define\\(\\s*['"]${k}['"]\\s*,\\s*['"]([^'"]*)['"]`)) || [])[1];
    const name = def("DB_NAME");
    if (name)
      return {
        name,
        user: def("DB_USER") || "",
        password: def("DB_PASSWORD") || "",
        host: def("DB_HOST") || "localhost",
        source: "wp-config.php",
      };
  }
  return null;
}

function defaultSslEmail() {
  const c = getConfig();
  return (
    c.ssl?.email || c.notifications?.email?.to || process.env.ADMIN_EMAIL || ""
  );
}

/**
 * Websites = one record per site/app joining its folder, Git repository,
 * nginx config, PM2 process, database, .env, cron jobs and backups.
 */
export class SiteManager {
  // ── Listing ────────────────────────────────────────────────

  static async context() {
    let nginxSites = [];
    try {
      nginxSites = NginxManager.listSites();
    } catch {}
    const [pm2Installed, nginxBin] = await Promise.all([
      ProcessManager.installed(),
      which("nginx"),
    ]);
    const pm2 = pm2Installed
      ? await ProcessManager.list().catch(() => new Map())
      : new Map();
    return {
      nginxSites,
      pm2,
      pm2Installed,
      nginxInstalled: !!nginxBin || existsSync(SITES_AVAILABLE),
    };
  }

  static async summary(site, ctx) {
    const stack = stackOf(site);
    const own = ctx.nginxSites.filter(
      (s) =>
        s.projectId === site.id || (site.siteName && s.name === site.siteName),
    );
    const primary = own.find((s) => s.name === site.siteName) || own[0] || null;
    const domains = [...new Set(own.flatMap((s) => s.serverNames))].filter(
      (d) => d && d !== "_",
    );
    const daysLeft = primary?.sslExpires
      ? Math.floor((new Date(primary.sslExpires) - Date.now()) / 86400000)
      : null;
    const app = stack.process
      ? ctx.pm2.get(site.name) || {
          status: ctx.pm2Installed ? "not-started" : "pm2-missing",
        }
      : null;
    const deploying = DeployEngine.running(site.id);
    const git = site.deployPath
      ? await DeployEngine.gitInfo(site.deployPath).catch(() => null)
      : null;
    const nginx = primary
      ? {
          name: primary.name,
          enabled: primary.enabled,
          type: primary.type,
          root: primary.root,
          proxyPass: primary.proxyPass,
          phpVersion: primary.phpVersion,
        }
      : null;
    return {
      ...publicSite(site),
      stackLabel: stack.label,
      features: {
        process: !!stack.process,
        php: !!stack.php,
        external: !!stack.external,
        web: stack.web,
        env: ENV_STACKS.has(site.type),
      },
      domains,
      primaryDomain: domains[0] || null,
      url:
        domains[0] && !domains[0].startsWith("*")
          ? `${primary?.ssl ? "https" : "http"}://${domains[0]}`
          : null,
      nginx,
      nginxSites: own.map((s) => s.name),
      ssl: {
        enabled: !!primary?.ssl,
        expires: primary?.sslExpires || null,
        daysLeft,
      },
      app: app
        ? {
            status: app.status,
            pid: app.pid || null,
            cpu: app.cpu ?? null,
            memory: app.memory ?? null,
            uptime: app.uptime || 0,
            restarts: app.restarts || 0,
          }
        : null,
      git,
      deploy: {
        ...publicSite(site).deploy,
        running: deploying?.id || null,
        last: DeployEngine.lastDeploy(site.id),
      },
      health: health(site, { stack, app, nginx, deploying }),
    };
  }

  static async list() {
    const ctx = await SiteManager.context();
    const sites = await Promise.all(
      allSites().map((s) => SiteManager.summary(s, ctx)),
    );
    const linked = new Set(sites.flatMap((s) => s.nginxSites));
    const unlinked = ctx.nginxSites
      .filter((s) => !linked.has(s.name))
      .map((s) => ({
        name: s.name,
        domains: s.serverNames.filter((d) => d !== "_"),
        type: s.type,
        root: s.root,
        proxyPass: s.proxyPass,
        phpVersion: s.phpVersion,
        enabled: s.enabled,
        ssl: s.ssl,
        sslExpires: s.sslExpires,
        catchAll: s.serverNames.filter((d) => d !== "_").length === 0,
      }));
    return {
      sites: sites.sort((a, b) => a.name.localeCompare(b.name)),
      unlinked,
      tools: { pm2: ctx.pm2Installed, nginx: ctx.nginxInstalled },
    };
  }

  /**
   * Everything the website page shows.
   */
  static async detail(id) {
    const site = getSite(id);
    const ctx = await SiteManager.context();
    const summary = await SiteManager.summary(site, ctx);
    const [cron, composer, dbInfo] = await Promise.all([
      siteCronJobs(site),
      stackOf(site).php
        ? ComposerManager.status().catch(() => ({ installed: false }))
        : null,
      SiteManager.databaseInfo(site),
    ]);
    return {
      ...summary,
      deploy: { ...summary.deploy, webhookSecret: site.deploy.webhookSecret },
      history: DeployEngine.history(id).slice(0, 25),
      disk: site.deployPath ? diskUsage(site.deployPath) : null,
      maxBodySize: summary.nginx
        ? NginxManager.maxBodySize(summary.nginx.name)
        : null,
      env: site.deployPath
        ? {
            path: join(site.deployPath, ".env"),
            exists: existsSync(join(site.deployPath, ".env")),
          }
        : null,
      cron: {
        backups: cron.backups.map((j) => ({
          id: j.id,
          schedule: j.schedule,
          human: j.human,
          nextRun: j.nextRun,
          enabled: j.enabled,
        })),
        scheduler: cron.scheduler.length > 0,
      },
      phpVersions: phpFpmVersions(),
      databaseInfo: dbInfo,
      databaseSuggestion: site.database?.name ? null : await SiteManager.detectDatabase(id).catch(() => null),
      backupDirs: site.backupDirs,
      backupExcludes: site.backupExcludes,
      tools: {
        pm2: ctx.pm2Installed,
        nginx: ctx.nginxInstalled,
        composer: composer?.installed ?? null,
        mysql: !!MysqlManager.getCreds(),
      },
      certbotEmail: defaultSslEmail(),
    };
  }

  // ── Suggestions for the "New website" form ─────────────────

  static async suggestPort(start = 3000) {
    const used = new Set(
      allSites()
        .map((s) => s.port)
        .filter(Boolean),
    );
    for (let port = start; port < 65000; port++) {
      if (used.has(port)) continue;
      if (await portFree(port)) return port;
    }
    throw httpError(500, "No free port found");
  }

  /**
   * Name, folder, port and PHP version for a new website — the form fills
   * these in automatically; every value can still be changed.
   */
  static async suggest({ name, domain, repo, type } = {}) {
    const base = slugify(
      name || domain || (repo ? repo.split("/").pop() : "") || "my-site",
    );
    const taken = new Set([
      ...allSites().map((s) => s.name),
      ...(existsSync(SITES_AVAILABLE) ? readdirSync(SITES_AVAILABLE) : []),
    ]);
    let suggested = base;
    for (let i = 2; taken.has(suggested) && i < 100; i++)
      suggested = `${base}-${i}`;
    const stack = type && STACKS[type] ? STACKS[type] : null;
    const versions = phpFpmVersions();
    return {
      name: suggested,
      deployPath: join(SITES_ROOT, suggested),
      port: !stack || stack.process ? await SiteManager.suggestPort() : null,
      phpVersion: versions[0] || null,
      phpVersions: versions,
      sitesRoot: SITES_ROOT,
      tools: {
        nginx: !!(await which("nginx")) || existsSync(SITES_AVAILABLE),
        pm2: await ProcessManager.installed(),
        mysql: !!MysqlManager.getCreds(),
        composer: !!(await which("composer")),
      },
    };
  }

  static inspectRepository(url, branch) {
    return DeployEngine.inspectRepository(url, branch).then((info) => ({
      ...info,
      phpVersion:
        info.stack && STACKS[info.stack]?.php
          ? pickPhpVersion(info.phpConstraint)
          : null,
    }));
  }

  static checkDns(domain) {
    const [d] = normalizeDomains(domain);
    return checkDns(d);
  }

  // ── Create ─────────────────────────────────────────────────

  /**
   * Validate the "New website" form and build the record plus a setup plan.
   */
  static async prepare(input) {
    const source = ["git", "wordpress", "empty", "proxy"].includes(input.source)
      ? input.source
      : "git";
    let type = input.type;
    if (source === "wordpress") type = "wordpress";
    if (source === "proxy") type = "proxy";
    if (source === "empty" && !["static", "php"].includes(type))
      type = "static";
    if (!STACKS[type])
      throw httpError(400, "Choose what kind of website this is");
    const stack = STACKS[type];

    let domains = [];
    const rawDomains = Array.isArray(input.domains)
      ? input.domains
      : String(input.domains || "").split(/[\s,]+/);
    if (rawDomains.filter(Boolean).length) {
      domains = normalizeDomains(rawDomains);
      if (
        input.www &&
        !domains[0].startsWith("www.") &&
        !domains[0].startsWith("*.") &&
        !domains.includes(`www.${domains[0]}`)
      )
        domains.splice(1, 0, `www.${domains[0]}`);
    }
    if (!domains.length && ["wordpress", "empty", "proxy"].includes(source))
      throw httpError(400, "Enter the domain for this website");

    // Domains already served by another nginx site would be ambiguous
    let nginxSites = [];
    try {
      nginxSites = NginxManager.listSites();
    } catch {}
    for (const d of domains) {
      const owner = nginxSites.find((s) => s.serverNames.includes(d));
      if (owner)
        throw httpError(
          409,
          `${d} is already used by the nginx site "${owner.name}"`,
        );
    }

    const name = assertSiteName(
      input.name
        ? String(input.name).trim()
        : slugify(domains[0] || input.gitUrl || "site"),
    );
    const sites = allSites();
    if (sites.some((s) => s.name === name))
      throw httpError(409, `A website named "${name}" already exists`);
    if (domains.length && existsSync(NginxManager.sitePath(name)))
      throw httpError(
        409,
        `An nginx site named "${name}" already exists — import it from the Websites page instead`,
      );

    let deployPath = null;
    if (type !== "proxy") {
      deployPath = assertSitePath(
        input.deployPath
          ? String(input.deployPath).trim()
          : join(SITES_ROOT, name),
      );
      if (deployPath === SITES_ROOT)
        throw httpError(
          400,
          `Use a folder inside ${SITES_ROOT}, e.g. ${join(SITES_ROOT, name)}`,
        );
      if (sites.some((s) => s.deployPath === deployPath))
        throw httpError(
          409,
          `${deployPath} already belongs to another website`,
        );
      if (
        existsSync(deployPath) &&
        readdirSync(deployPath).length &&
        !(source === "empty" && input.useExisting)
      )
        throw httpError(
          409,
          `${deployPath} already exists and is not empty — choose another folder`,
        );
    }

    const site = {
      id: uuidv4(),
      name,
      description: String(input.description || "").slice(0, 300),
      type,
      deployPath,
      webRoot: "",
      gitUrl: "",
      branch: null,
      port: null,
      startCommand: "",
      proxyTarget: "",
      phpVersion: null,
      siteName: null,
      deploy: {
        script: null,
        autoDeploy: false,
        webhookSecret: null,
        resetHard: false,
      },
      database: { type: "mysql", name: "", user: "", password: "" },
      backupDirs: deployPath ? [deployPath] : [],
      backupExcludes: DEFAULT_BACKUP_EXCLUDES,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (source === "git") {
      site.gitUrl = assertGitUrl(input.gitUrl);
      site.branch = assertBranch(input.branch || "main");
      if (
        input.deployScript !== undefined &&
        input.deployScript !== null &&
        String(input.deployScript).trim()
      )
        site.deploy.script = String(input.deployScript).slice(0, 20000);
    } else {
      site.deploy.script = defaultDeployScript(type, null);
    }

    if (stack.process) {
      site.port = input.port
        ? assertPort(input.port)
        : await SiteManager.suggestPort();
      if (sites.some((s) => s.port === site.port))
        throw httpError(409, `Port ${site.port} is used by another website`);
      if (!(await portFree(site.port)))
        throw httpError(
          409,
          `Port ${site.port} is already in use on this server`,
        );
      const cmd = String(input.startCommand || "").trim();
      if (/[\r\n]/.test(cmd) || cmd.length > 500)
        throw httpError(400, "The start command must be a single line");
      site.startCommand = cmd; // empty → detected after cloning
    }

    if (stack.php) {
      const versions = phpFpmVersions();
      if (!versions.length)
        throw httpError(
          409,
          "No PHP version is installed yet — install one on the PHP page first",
        );
      site.phpVersion = input.phpVersion || pickPhpVersion(null);
      if (!versions.includes(site.phpVersion))
        throw httpError(400, `PHP ${site.phpVersion} (FPM) is not installed`);
    }

    if (type === "proxy") {
      let target = String(input.proxyTarget || "").trim();
      if (/^\d+$/.test(target)) target = `http://127.0.0.1:${target}`;
      if (!/^https?:\/\/[A-Za-z0-9.\-:[\]]+(\/[^\s;{}]*)?$/.test(target))
        throw httpError(
          400,
          "Enter the app's port (8080) or URL (http://127.0.0.1:8080)",
        );
      site.proxyTarget = target;
    }

    if (["static", "react", "php"].includes(type)) {
      site.webRoot =
        input.webRoot !== undefined &&
        input.webRoot !== null &&
        input.webRoot !== "auto"
          ? assertWebRoot(input.webRoot)
          : source === "empty"
            ? "public_html"
            : null; // null → detected after cloning
    }
    if (type === "wordpress") site.webRoot = "public_html";
    if (domains.length) site.siteName = name;

    // Database
    let db = null;
    const wantsDb = type === "wordpress" || !!input.database?.create;
    if (wantsDb) {
      if (!MysqlManager.getCreds())
        throw httpError(
          409,
          "Connect the database server first (Databases page) — or untick “Create a database”",
        );
      const names = await uniqueDbNames(name);
      db = {
        name: input.database?.name ? String(input.database.name) : names.name,
        user: input.database?.user ? String(input.database.user) : names.user,
        password: randomPassword(),
      };
      assertDbName(db.name);
      assertUser(db.user);
      if (await databaseExists(db.name))
        throw httpError(409, `Database ${db.name} already exists`);
      site.database = { type: "mysql", ...db };
    }

    let wordpress = null;
    if (type === "wordpress") {
      const wp = input.wordpress || {};
      const email = String(wp.adminEmail || defaultSslEmail() || "").trim();
      if (!/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email))
        throw httpError(400, "Enter the WordPress admin email");
      const user = String(wp.adminUser || "admin").trim();
      if (!/^[A-Za-z0-9._@-]{3,60}$/.test(user))
        throw httpError(
          400,
          "The admin username may use letters, numbers, . _ @ - (3–60)",
        );
      const password = String(wp.adminPassword || "") || randomPassword(20);
      if (password.length < 8)
        throw httpError(
          400,
          "The admin password must be at least 8 characters",
        );
      wordpress = {
        title: String(wp.title || domains[0]).slice(0, 120),
        adminUser: user,
        adminPassword: password,
        adminEmail: email,
        locale: /^[a-z]{2,3}(_[A-Z]{2})?$/.test(wp.locale || "")
          ? wp.locale
          : "en_US",
      };
    }

    const extraEnv = String(input.env || "");
    for (const { key } of parseEnv(extraEnv))
      if (!isValidEnvKey(key))
        throw httpError(400, `Invalid environment variable name ${key}`);

    const plan = {
      source,
      domains,
      ssl: !!input.ssl && domains.length > 0,
      sslEmail: String(input.sslEmail || "").trim() || null,
      db: db ? { ...db } : null,
      writeEnv: input.database?.writeEnv !== false,
      env: extraEnv,
      wordpress,
      detect: {
        script: site.deploy.script === null,
        start: stack.process && !site.startCommand,
        webRoot: site.webRoot === null,
      },
      url: domains[0]
        ? `${input.ssl ? "https" : "http"}://${domains[0]}`
        : null,
    };
    if (site.webRoot === null) site.webRoot = "";
    return { site, plan };
  }

  static async create(input) {
    const { site, plan } = await SiteManager.prepare(input);
    site.provision = {
      status: "running",
      startedAt: new Date().toISOString(),
      plan,
    };
    updateConfig((c) => {
      (c.projects || (c.projects = [])).push(site);
    });
    const job = SiteManager.provision(site.id);
    return {
      site: publicSite(getSite(site.id)),
      jobId: job.id,
      wordpress: plan.wordpress
        ? {
            adminUser: plan.wordpress.adminUser,
            adminPassword: plan.wordpress.adminPassword,
          }
        : null,
    };
  }

  /**
   * Re-run a failed setup (each step skips work that is already done).
   */
  static retry(id) {
    const site = getSite(id);
    if (site.provision?.status !== "failed" || !site.provision.plan)
      throw httpError(409, "Only a failed setup can be retried");
    if (DeployEngine.running(id)) throw httpError(409, "This website is busy");
    saveSite(id, (p) => ({
      ...p,
      provision: {
        ...p.provision,
        status: "running",
        error: null,
        startedAt: new Date().toISOString(),
      },
    }));
    return SiteManager.provision(id);
  }

  /**
   * The setup job: install missing tools, create the database, get the code,
   * detect build settings, write .env, build, start, nginx, HTTPS.
   */
  static provision(id) {
    const initial = getSite(id);
    const plan = initial.provision.plan;
    const current = () => getSite(id);
    const stack = stackOf(initial);

    const sourceSteps = {
      git: [DeployEngine.cloneStep(initial)],
      wordpress: [
        {
          id: "wordpress",
          title: "Install WordPress",
          run: async (ctx) => {
            const site = current();
            const wp = plan.wordpress;
            const code = await ctx.sh(SiteManager.wordpressScript(), {
              env: {
                SITE_PATH: site.deployPath,
                WEB_ROOT: join(site.deployPath, site.webRoot),
                PHP_BIN: phpBinary(site.phpVersion) || "php",
                DB_NAME: plan.db.name,
                DB_USER: plan.db.user,
                DB_PASS: plan.db.password,
                WP_URL: plan.url,
                WP_TITLE: wp.title,
                WP_ADMIN_USER: wp.adminUser,
                WP_ADMIN_PASS: wp.adminPassword,
                WP_ADMIN_EMAIL: wp.adminEmail,
                WP_LOCALE: wp.locale,
              },
            });
            if (code !== 0)
              throw new Error(
                "WordPress installation failed — see the output above",
              );
          },
        },
      ],
      empty: [
        {
          id: "folder",
          title: "Create website folder",
          run: async (ctx) => {
            const site = current();
            const dir = join(site.deployPath, site.webRoot);
            mkdirSync(dir, { recursive: true });
            ctx.log(`Upload your files to ${dir} (File Manager or SFTP).`);
          },
        },
      ],
      proxy: [],
    }[plan.source];

    const steps = [
      {
        id: "nginx-install",
        title: "Install nginx",
        when: async () =>
          plan.domains.length > 0 &&
          !(await which("nginx")) &&
          !existsSync(SITES_AVAILABLE),
        script: NGINX_INSTALL_SCRIPT,
      },
      {
        id: "database",
        title: plan.db ? `Create database ${plan.db.name}` : "Create database",
        when: () => !!plan.db,
        run: async (ctx) => {
          if (await databaseExists(plan.db.name))
            return ctx.log(
              `Database ${plan.db.name} already exists — keeping it.`,
            );
          await createDatabaseWithUser(plan.db);
          ctx.log(
            `Created database ${plan.db.name} and user ${plan.db.user}@localhost (all privileges on it).`,
          );
        },
      },
      ...sourceSteps,
      {
        id: "detect",
        title: "Detect build settings",
        when: () => plan.source === "git",
        run: async (ctx) => {
          const site = current();
          const detected = detectStack(site.deployPath);
          if (detected && detected !== site.type)
            ctx.log(
              `⚠ The code looks like a ${STACKS[detected].label} project, but this website was set up as ${STACKS[site.type].label}. Change it in Settings if that's wrong.`,
            );
          const saved = saveSite(id, (p) => {
            if (plan.detect.script)
              p.deploy = {
                ...(p.deploy || {}),
                script: defaultDeployScript(p.type, p.deployPath, {
                  database: !!plan.db,
                }),
              };
            if (plan.detect.start)
              p.startCommand = defaultStartCommand(p.type, p.deployPath);
            if (plan.detect.webRoot)
              p.webRoot = suggestWebRoot(p.type, p.deployPath);
            return p;
          });
          ctx.log(
            `Deploy script:\n${saved.deploy.script.replace(/^/gm, "  ")}`,
          );
          if (stack.process)
            ctx.log(
              `Start command: ${saved.startCommand}   (PORT=${saved.port})`,
            );
          if (saved.webRoot) ctx.log(`Web root: ${saved.webRoot}/`);
        },
      },
      {
        id: "env",
        title: "Write .env",
        when: () =>
          ENV_STACKS.has(initial.type) &&
          (initial.type === "laravel" ||
            (plan.db && plan.writeEnv) ||
            !!plan.env.trim()),
        run: async (ctx) => {
          const site = current();
          const updates = {};
          if (site.type === "laravel")
            Object.assign(updates, {
              APP_ENV: "production",
              APP_DEBUG: "false",
              ...(plan.url ? { APP_URL: plan.url } : {}),
            });
          if (plan.db && plan.writeEnv)
            Object.assign(updates, envUpdatesForDatabase(site.type, plan.db));
          for (const { key, value } of parseEnv(plan.env)) updates[key] = value;
          const file = await updateEnvFile(site, updates, {
            fromExample: true,
          });
          ctx.log(
            `Wrote ${Object.keys(updates).length} value(s) to ${file}${plan.db && plan.writeEnv ? " (including the database credentials)" : ""}.`,
          );
        },
      },
      ...DeployEngine.buildSteps(current),
      {
        id: "app-key",
        title: "Generate Laravel APP_KEY",
        when: () => {
          if (initial.type !== "laravel") return false;
          const env = join(current().deployPath, ".env");
          return (
            existsSync(env) && /^APP_KEY=\s*$/m.test(readFileSync(env, "utf-8"))
          );
        },
        run: async (ctx) => {
          const site = current();
          const code = await ctx.sh(
            "php artisan key:generate --force\nphp artisan config:cache",
            {
              cwd: site.deployPath,
              env: DeployEngine.scriptEnv(site),
            },
          );
          if (code !== 0) throw new Error("php artisan key:generate failed");
        },
      },
      {
        id: "web",
        title: plan.domains.length
          ? `Configure nginx for ${plan.domains[0]}`
          : "Configure nginx",
        when: () => plan.domains.length > 0,
        run: async (ctx) => {
          await SiteManager.configureWebServer(current(), plan.domains);
          ctx.log(`nginx now serves ${plan.domains.join(", ")} over HTTP.`);
        },
      },
      {
        id: "ssl",
        title: "Enable HTTPS (Let's Encrypt)",
        when: () => plan.ssl,
        run: async (ctx) => {
          const site = current();
          const code = await ctx.sh(
            NginxManager.sslScript({
              name: site.siteName,
              domains: plan.domains,
              email: plan.sslEmail || defaultSslEmail(),
            }),
          );
          if (code === 0) return;
          if (site.type === "wordpress") {
            await ctx.sh(
              `cd ${shq(join(site.deployPath, site.webRoot))} && WP=$(command -v wp) && for o in home siteurl; do ${shq(phpBinary(site.phpVersion) || "php")} "$WP" option update "$o" ${shq(plan.url.replace(/^https:/, "http:"))} --allow-root; done`,
            );
          }
          const err = new Error(
            "The certificate could not be issued — the site works over HTTP. Point the domain's DNS A record to this server, then use “Enable HTTPS” on the Domains tab.",
          );
          err.warning = true;
          throw err;
        },
      },
    ];

    const job = JobRunner.pipeline(`Set up ${initial.name}`, steps, {
      meta: { kind: "provision", siteId: id },
      onExit: (job, ctx) => {
        const ok = job.status === "completed";
        const failed = job.steps.find((s) => s.status === "failed");
        let site;
        try {
          site = saveSite(id, (p) => {
            p.provision = ok
              ? {
                  status: "completed",
                  jobId: job.id,
                  finishedAt: job.finishedAt,
                }
              : {
                  ...p.provision,
                  status: "failed",
                  jobId: job.id,
                  error: failed
                    ? `${failed.title}: ${failed.error}`
                    : "Cancelled",
                };
            return p;
          });
        } catch {
          return; // deleted while setting up
        }
        DeployEngine.recordSetup(site, job, ctx);
        BackupEngine.log(
          `[Websites] Setup of ${site.name}: ${ok ? "completed" : "FAILED"}`,
        );
      },
    });
    // The dashboard follows the live log through this id
    saveSite(id, (p) => ({
      ...p,
      provision: { ...p.provision, jobId: job.id },
    }));
    return job;
  }

  /**
   * WP-CLI install (values come from the job environment, never interpolated).
   */
  static wordpressScript() {
    return `
WP=$(command -v wp || true)
if [ -z "$WP" ]; then
  echo "Installing WP-CLI..."
  curl -fsSL -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
  chmod +x /usr/local/bin/wp
  WP=/usr/local/bin/wp
fi
mkdir -p "$WEB_ROOT"
cd "$WEB_ROOT"
if [ ! -f wp-load.php ]; then
  "$PHP_BIN" "$WP" core download --allow-root --locale="$WP_LOCALE"
fi
if [ ! -f wp-config.php ]; then
  "$PHP_BIN" "$WP" config create --allow-root --dbname="$DB_NAME" --dbuser="$DB_USER" --dbpass="$DB_PASS" --dbhost=localhost --skip-check
fi
if ! "$PHP_BIN" "$WP" core is-installed --allow-root >/dev/null 2>&1; then
  "$PHP_BIN" "$WP" core install --allow-root --url="$WP_URL" --title="$WP_TITLE" --admin_user="$WP_ADMIN_USER" --admin_password="$WP_ADMIN_PASS" --admin_email="$WP_ADMIN_EMAIL" --skip-email
fi
chown -R www-data:www-data "$SITE_PATH"
echo ""
echo "WordPress is installed. Log in at $WP_URL/wp-admin as $WP_ADMIN_USER."
`;
  }

  /**
   * Create (or update) the nginx site that serves a website on its domains.
   */
  static async configureWebServer(site, domains) {
    const stack = stackOf(site);
    const name = site.siteName || site.name;
    if (NginxManager.siteInfo(name)) {
      await NginxManager.setServerNames(name, domains);
      await NginxManager.linkProject(name, site.id);
    } else {
      let root;
      if (stack.web !== "proxy")
        root =
          site.type === "laravel"
            ? site.deployPath
            : join(site.deployPath, site.webRoot || "");
      await NginxManager.createSite({
        name,
        domains,
        type: stack.web,
        root,
        phpVersion: site.phpVersion,
        proxyTarget: stack.external ? site.proxyTarget : String(site.port),
        projectId: site.id,
        ownPort: true,
        maxBodySize: "64M",
      });
    }
    if (site.siteName !== name)
      saveSite(site.id, (p) => ({ ...p, siteName: name }));
  }

  // ── Import an existing nginx site ──────────────────────────

  static async importNginx(name) {
    const info = NginxManager.siteInfo(name);
    if (!info) throw httpError(404, `nginx site "${name}" not found`);
    const sites = allSites();
    if (info.projectId && sites.some((s) => s.id === info.projectId))
      throw httpError(409, "This site already belongs to a website");
    if (sites.some((s) => s.name === name))
      throw httpError(409, `A website named "${name}" already exists`);

    const type = info.type === "proxy" ? "proxy" : normalizeStack(info.type);
    let deployPath = null;
    let webRoot = "";
    if (info.root) {
      if (type === "laravel")
        deployPath = info.root.replace(/\/public\/?$/, "");
      else if (/\/(public_html|public|dist|build|html)\/?$/.test(info.root)) {
        deployPath = dirname(info.root);
        webRoot = info.root.slice(deployPath.length + 1).replace(/\/$/, "");
      } else deployPath = info.root;
      if (isSystemPath(deployPath)) {
        deployPath = info.root;
        webRoot = "";
      }
    }
    let gitUrl = "";
    let branch = null;
    if (deployPath && existsSync(join(deployPath, ".git"))) {
      const git = await DeployEngine.gitInfo(deployPath);
      const remote = await run("git", [
        "-c",
        "safe.directory=*",
        "-C",
        deployPath,
        "remote",
        "get-url",
        "origin",
      ]);
      gitUrl = remote.code === 0 ? remote.stdout.trim() : "";
      branch = git?.branch && git.branch !== "HEAD" ? git.branch : "main";
    }
    const site = {
      id: uuidv4(),
      name,
      description: "",
      type,
      deployPath,
      webRoot,
      gitUrl,
      branch,
      port: null,
      startCommand: "",
      proxyTarget: type === "proxy" ? info.proxyPass || "" : "",
      phpVersion: info.phpVersion,
      siteName: name,
      deploy: {
        script: deployPath ? defaultDeployScript(type, deployPath) : "",
        autoDeploy: false,
        webhookSecret: null,
        resetHard: false,
      },
      database: { type: "mysql", name: "", user: "", password: "" },
      backupDirs: deployPath ? [deployPath] : [],
      backupExcludes: DEFAULT_BACKUP_EXCLUDES,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Keep managing the database the site already uses (backups include it)
    const detected = detectDatabaseConfig(site);
    if (detected && LOCAL_DB_HOSTS.has(detected.host.split(":")[0])) {
      const exists = MysqlManager.getCreds() ? await databaseExists(detected.name).catch(() => false) : true;
      if (exists)
        site.database = { type: "mysql", name: detected.name, user: detected.user, password: detected.password };
    }
    await NginxManager.linkProject(name, site.id);
    updateConfig((c) => {
      (c.projects || (c.projects = [])).push(site);
    });
    return getSite(site.id);
  }

  // ── Update ─────────────────────────────────────────────────

  static async update(id, body) {
    const site = getSite(id);
    const stack = stackOf(site);
    const patch = {};
    let restartNeeded = false;
    const nginxName =
      site.siteName && NginxManager.siteInfo(site.siteName)
        ? site.siteName
        : null;

    if ("description" in body)
      patch.description = String(body.description || "").slice(0, 300);
    if ("gitUrl" in body) {
      const url = String(body.gitUrl || "").trim();
      if (url && url !== maskGitUrl(site.gitUrl)) {
        patch.gitUrl = assertGitUrl(url);
        if (!site.branch) patch.branch = "main";
      }
    }
    if ("branch" in body && (site.gitUrl || patch.gitUrl))
      patch.branch = assertBranch(body.branch);
    if (body.deploy && typeof body.deploy === "object") {
      patch.deploy = { ...site.deploy };
      if ("script" in body.deploy)
        patch.deploy.script = String(body.deploy.script ?? "").slice(0, 20000);
      if ("resetHard" in body.deploy)
        patch.deploy.resetHard = !!body.deploy.resetHard;
    }
    if ("startCommand" in body && stack.process) {
      const cmd = String(body.startCommand || "").trim();
      if (!cmd || /[\r\n]/.test(cmd) || cmd.length > 500)
        throw httpError(
          400,
          "Enter a single-line start command, e.g. npm start",
        );
      if (cmd !== site.startCommand) {
        patch.startCommand = cmd;
        restartNeeded = true;
      }
    }
    if (
      "port" in body &&
      stack.process &&
      body.port !== null &&
      body.port !== ""
    ) {
      const port = assertPort(body.port);
      if (port !== site.port) {
        if (allSites().some((s) => s.id !== id && s.port === port))
          throw httpError(409, `Port ${port} is used by another website`);
        if (!(await portFree(port)))
          throw httpError(409, `Port ${port} is already in use on this server`);
        if (nginxName) await NginxManager.setProxyPass(nginxName, String(port));
        patch.port = port;
        restartNeeded = true;
      }
    }
    if ("proxyTarget" in body && stack.external) {
      const target = String(body.proxyTarget || "").trim();
      if (target && target !== site.proxyTarget) {
        if (nginxName) await NginxManager.setProxyPass(nginxName, target);
        patch.proxyTarget = /^\d+$/.test(target)
          ? `http://127.0.0.1:${target}`
          : target;
      }
    }
    if (
      "webRoot" in body &&
      ["static", "react", "php", "wordpress"].includes(site.type)
    ) {
      const webRoot = assertWebRoot(body.webRoot);
      if (webRoot !== site.webRoot) {
        if (nginxName)
          await NginxManager.setRoot(nginxName, join(site.deployPath, webRoot));
        patch.webRoot = webRoot;
      }
    }
    if (
      "phpVersion" in body &&
      stack.php &&
      body.phpVersion &&
      body.phpVersion !== site.phpVersion
    ) {
      if (!phpFpmVersions().includes(body.phpVersion))
        throw httpError(400, `PHP ${body.phpVersion} (FPM) is not installed`);
      if (nginxName)
        await NginxManager.setPhpVersion(nginxName, body.phpVersion);
      patch.phpVersion = body.phpVersion;
    }
    if ("maxBodySize" in body && nginxName)
      await NginxManager.setMaxBodySize(
        nginxName,
        String(body.maxBodySize).trim(),
      );
    if ("backupDirs" in body) {
      const dirs = (
        Array.isArray(body.backupDirs)
          ? body.backupDirs
          : String(body.backupDirs || "").split("\n")
      )
        .map((d) => String(d).trim())
        .filter(Boolean);
      for (const d of dirs)
        if (!d.startsWith("/") || d.includes("..") || /[\0\r\n]/.test(d))
          throw httpError(400, `Invalid folder ${d}`);
      patch.backupDirs = [...new Set(dirs)];
    }
    if ("backupExcludes" in body) {
      const list = (
        Array.isArray(body.backupExcludes)
          ? body.backupExcludes
          : String(body.backupExcludes || "").split(/[\n,]/)
      )
        .map((d) => String(d).trim())
        .filter(Boolean);
      for (const e of list)
        if (!/^[A-Za-z0-9._*/-]{1,100}$/.test(e))
          throw httpError(400, `Invalid exclude pattern ${e}`);
      patch.backupExcludes = [...new Set(list)];
    }

    const saved = saveSite(id, (p) => ({ ...p, ...patch }));
    if (stack.process && restartNeeded && saved.startCommand)
      ProcessManager.writeEcosystem(saved);
    return { site: await SiteManager.detail(id), restartNeeded };
  }

  /**
   * Turn push-to-deploy on or off (a new secret is generated when enabling or rotating).
   */
  static setAutoDeploy(id, { enabled, rotate = false }) {
    const site = getSite(id);
    if (!site.gitUrl) throw httpError(400, "Connect a Git repository first");
    saveSite(id, (p) => {
      const deploy = { ...normalizeSite(p).deploy };
      deploy.autoDeploy = !!enabled;
      if (enabled && (!deploy.webhookSecret || rotate))
        deploy.webhookSecret = DeployEngine.newWebhookSecret();
      return { ...p, deploy };
    });
    return { autoDeploy: !!enabled, secret: getSite(id).deploy.webhookSecret };
  }

  // ── Delete ─────────────────────────────────────────────────

  static remove(
    id,
    { deleteFiles = false, dropDatabase = false, removeNginx = true } = {},
  ) {
    const site = getSite(id);
    if (DeployEngine.running(id))
      throw httpError(
        409,
        "Wait for the running deployment or setup to finish",
      );
    const stack = stackOf(site);
    let nginxNames = [];
    try {
      nginxNames = NginxManager.listSites()
        .filter((s) => s.projectId === id || s.name === site.siteName)
        .map((s) => s.name);
    } catch {}

    const steps = [
      {
        title: "Stop and remove the app (PM2)",
        when: () => stack.process,
        run: async (ctx) => {
          await ProcessManager.remove(site);
          ctx.log(`Removed PM2 app ${site.name}.`);
        },
      },
      {
        title: "Remove nginx site and certificate",
        when: () => removeNginx && nginxNames.length > 0,
        run: async (ctx) => {
          for (const name of nginxNames) {
            await NginxManager.deleteSite(name);
            ctx.log(`Removed nginx site ${name}.`);
            try {
              const r = await NginxManager.deleteCertificate(name);
              if (!r.skipped) ctx.log(`Deleted certificate ${name}.`);
            } catch (err) {
              ctx.log(`⚠ Certificate ${name}: ${err.message}`);
            }
          }
        },
      },
      {
        title: "Detach nginx site",
        when: () => !removeNginx && nginxNames.length > 0,
        run: async (ctx) => {
          for (const name of nginxNames)
            await NginxManager.linkProject(name, null);
          ctx.log(
            "nginx keeps serving the site; it is listed under “Other nginx sites”.",
          );
        },
      },
      {
        title: "Remove scheduled jobs",
        run: async (ctx) => {
          const { backups, scheduler } = await siteCronJobs(site);
          for (const job of [...backups, ...scheduler])
            await CronManager.remove(job.id).catch(() => {});
          ctx.log(`${backups.length + scheduler.length} cron job(s) removed.`);
        },
      },
      {
        title: `Delete database ${site.database?.name || ""}`.trim(),
        when: () => dropDatabase && !!site.database?.name,
        run: async (ctx) => {
          if (await databaseExists(site.database.name)) {
            await MysqlManager.dropDatabase(site.database.name);
            ctx.log(`Dropped database ${site.database.name}.`);
          }
          if (
            site.database.user &&
            site.database.user !== PANEL_USER &&
            site.database.user !== "root"
          ) {
            await MysqlManager.dropUser(site.database.user, "localhost").catch(
              () => {},
            );
            ctx.log(`Removed user ${site.database.user}@localhost.`);
          }
        },
      },
      {
        title: `Delete files in ${site.deployPath || ""}`.trim(),
        when: () => deleteFiles && !!site.deployPath,
        run: async (ctx) => {
          const path = assertSitePath(site.deployPath);
          if (path === SITES_ROOT)
            throw new Error(`Refusing to delete ${SITES_ROOT}`);
          rmSync(path, { recursive: true, force: true });
          ctx.log(`Deleted ${path}.`);
        },
      },
      {
        title: "Remove website from the panel",
        run: async () => {
          updateConfig((c) => {
            c.projects = (c.projects || []).filter((p) => p.id !== id);
          });
          DeployEngine.clearHistory(id);
        },
      },
    ];
    return JobRunner.pipeline(`Delete ${site.name}`, steps, {
      meta: { kind: "delete", siteId: id },
    });
  }

  // ── Domains & HTTPS ────────────────────────────────────────

  static async setDomains(id, domains) {
    const site = getSite(id);
    const list = normalizeDomains(domains);
    const own = new Set([site.siteName]);
    for (const s of NginxManager.listSites()) {
      if (s.projectId === id) own.add(s.name);
      if (own.has(s.name)) continue;
      const clash = list.find((d) => s.serverNames.includes(d));
      if (clash)
        throw httpError(
          409,
          `${clash} is already used by the nginx site "${s.name}"`,
        );
    }
    const before = site.siteName ? NginxManager.siteInfo(site.siteName) : null;
    await SiteManager.configureWebServer(site, list);
    const fresh = getSite(id);
    // A certificate must cover every domain: expand it when domains change
    if (before?.ssl) {
      const job = JobRunner.start(
        `HTTPS for ${list[0]}`,
        NginxManager.sslScript({
          name: fresh.siteName,
          domains: list,
          email: defaultSslEmail(),
        }),
        {
          meta: { kind: "ssl", siteId: id },
        },
      );
      return { success: true, jobId: job.id };
    }
    return { success: true, created: !before };
  }

  static issueSsl(id, { email, redirect = true } = {}) {
    const site = getSite(id);
    const info = site.siteName ? NginxManager.siteInfo(site.siteName) : null;
    if (!info) throw httpError(400, "Add a domain to this website first");
    const domains = info.serverNames.filter(
      (d) => d !== "_" && !d.startsWith("*."),
    );
    const address = String(email || defaultSslEmail() || "").trim();
    if (email)
      updateConfig((c) => (c.ssl = { ...(c.ssl || {}), email: address }));
    const job = JobRunner.start(
      `HTTPS for ${domains[0]}`,
      NginxManager.sslScript({
        name: site.siteName,
        domains,
        email: address,
        redirect,
      }),
      {
        meta: { kind: "ssl", siteId: id },
      },
    );
    return { jobId: job.id };
  }

  static async setEnabled(id, enabled) {
    const site = getSite(id);
    if (!site.siteName) throw httpError(400, "This website has no domain yet");
    await NginxManager.setEnabled(site.siteName, enabled);
    return { success: true };
  }

  // ── App process ────────────────────────────────────────────

  static async control(id, action) {
    const site = getSite(id);
    if (!stackOf(site).process)
      throw httpError(400, "This website does not run an app process");
    return ProcessManager.control(site, action);
  }

  static installPm2() {
    return JobRunner.start("Install PM2", ProcessManager.installScript());
  }

  // ── .env ───────────────────────────────────────────────────

  static readEnv(id) {
    const site = getSite(id);
    if (!site.deployPath) throw httpError(400, "This website has no folder");
    const file = join(site.deployPath, ".env");
    const exists = existsSync(file);
    const content = exists ? readFileSync(file, "utf-8") : "";
    const example = join(site.deployPath, ".env.example");
    return {
      path: file,
      exists,
      content,
      vars: parseEnv(content),
      example: existsSync(example)
        ? parseEnv(readFileSync(example, "utf-8"))
        : [],
    };
  }

  /**
   * Save either raw `content` or the full list of `vars` ([{ key, value }]).
   */
  static async writeEnv(id, { content, vars }) {
    const site = getSite(id);
    if (!site.deployPath || !existsSync(site.deployPath))
      throw httpError(400, "The website folder does not exist");
    const file = join(site.deployPath, ".env");
    if (typeof content === "string") {
      if (content.length > 512 * 1024)
        throw httpError(413, ".env is too large");
      writeFileSync(
        file,
        content.endsWith("\n") || !content ? content : `${content}\n`,
        { mode: 0o640 },
      );
      await run("chown", ["--reference", site.deployPath, file]);
    } else if (Array.isArray(vars)) {
      const updates = {};
      const wanted = new Set();
      for (const { key, value } of vars) {
        if (!isValidEnvKey(key))
          throw httpError(400, `Invalid variable name "${key}"`);
        updates[key] = String(value ?? "");
        wanted.add(key);
      }
      const existing = existsSync(file)
        ? parseEnv(readFileSync(file, "utf-8"))
        : [];
      for (const { key } of existing) if (!wanted.has(key)) updates[key] = null;
      await updateEnvFile(site, updates);
    } else throw httpError(400, "Send content or vars");
    return { success: true, ...SiteManager.readEnv(id) };
  }

  /**
   * Make a changed .env take effect: restart the app, or rebuild Laravel's config cache.
   */
  static async applyEnv(id) {
    const site = getSite(id);
    const stack = stackOf(site);
    if (stack.process) {
      await ProcessManager.control(site, "restart");
      return {
        success: true,
        message: "App restarted with the new environment",
      };
    }
    if (site.type === "laravel") {
      const php = phpBinary(site.phpVersion) || "php";
      const r = await run(
        "bash",
        [
          "-c",
          `${shq(php)} artisan config:clear && ${shq(php)} artisan config:cache`,
        ],
        {
          cwd: site.deployPath,
          timeout: 120000,
        },
      );
      if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim());
      return { success: true, message: "Laravel config cache rebuilt" };
    }
    return {
      success: true,
      message: "Saved — the new values are used on the next request or build",
    };
  }

  // ── Database ───────────────────────────────────────────────

  static async databaseInfo(site) {
    if (!site.database?.name || !MysqlManager.getCreds()) return null;
    try {
      return await MysqlManager.with(async (c) => {
        const [[row]] = await c.query(
          `SELECT COUNT(t.TABLE_NAME) AS tables, COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) AS size,
                  (SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?) AS present
           FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = ?`,
          [site.database.name, site.database.name],
        );
        return {
          exists: Number(row.present) > 0,
          tables: Number(row.tables) || 0,
          size: Number(row.size) || 0,
        };
      });
    } catch (err) {
      return { error: err.message };
    }
  }

  static async createDatabaseFor(id, { writeEnv = true } = {}) {
    const site = getSite(id);
    if (site.database?.name)
      throw httpError(409, "This website already has a database");
    if (!MysqlManager.getCreds())
      throw httpError(
        409,
        "Connect the database server first (Databases page)",
      );
    const names = await uniqueDbNames(site.name);
    const db = { ...names, password: randomPassword() };
    await createDatabaseWithUser(db);
    saveSite(id, (p) => ({ ...p, database: { type: "mysql", ...db } }));
    let envUpdated = false;
    if (
      writeEnv &&
      ENV_STACKS.has(site.type) &&
      site.deployPath &&
      existsSync(site.deployPath)
    ) {
      await updateEnvFile(site, envUpdatesForDatabase(site.type, db), {
        fromExample: site.type === "laravel",
      });
      envUpdated = true;
    }
    return { database: db, envUpdated };
  }

  /**
   * The database found in the website's .env / wp-config.php (password left out).
   */
  static async detectDatabase(id) {
    const site = getSite(id);
    const found = detectDatabaseConfig(site);
    if (!found) return { found: false };
    const local = LOCAL_DB_HOSTS.has(found.host.split(":")[0]);
    const exists = local && MysqlManager.getCreds() ? await databaseExists(found.name).catch(() => null) : null;
    return {
      found: true,
      name: found.name,
      user: found.user,
      hasPassword: !!found.password,
      host: found.host,
      source: found.source,
      local,
      exists,
    };
  }

  /**
   * Remember an existing database (used for backups and shown on the website page).
   * fromConfig: take the name/user/password the website's .env or wp-config.php uses.
   */
  static async linkDatabase(id, { name, user, password, fromConfig = false }) {
    if (fromConfig) {
      const found = detectDatabaseConfig(getSite(id));
      if (!found) throw httpError(404, "No database settings found in .env or wp-config.php");
      ({ name, user, password } = found);
    }
    assertDbName(name);
    if (user) assertUser(user);
    if (MysqlManager.getCreds() && !(await databaseExists(name)))
      throw httpError(404, `Database ${name} does not exist`);
    saveSite(id, (p) => ({
      ...p,
      database: {
        type: "mysql",
        name,
        user: user || "",
        password: password || p.database?.password || "",
      },
    }));
    return { success: true };
  }

  static async unlinkDatabase(id, { drop = false } = {}) {
    const site = getSite(id);
    if (!site.database?.name) return { success: true };
    if (drop) {
      if (await databaseExists(site.database.name))
        await MysqlManager.dropDatabase(site.database.name);
      if (
        site.database.user &&
        site.database.user !== PANEL_USER &&
        site.database.user !== "root"
      )
        await MysqlManager.dropUser(site.database.user, "localhost").catch(
          () => {},
        );
    }
    saveSite(id, (p) => ({
      ...p,
      database: { type: "mysql", name: "", user: "", password: "" },
    }));
    return { success: true };
  }

  static databaseCredentials(id) {
    const site = getSite(id);
    if (!site.database?.name) throw httpError(404, "No database linked");
    return {
      host: "127.0.0.1",
      port: 3306,
      name: site.database.name,
      user: site.database.user,
      password: site.database.password || "",
    };
  }

  // ── Backups & scheduled jobs ───────────────────────────────

  static async backups(id) {
    const site = getSite(id);
    const config = getConfig();
    const [list, cron] = await Promise.all([
      BackupEngine.listBackups(site.name).catch(() => []),
      siteCronJobs(site),
    ]);
    return {
      backups: list,
      target: config.backup?.defaultTarget || "gdrive",
      targetEnabled:
        !!config.backup?.targets?.[config.backup?.defaultTarget]?.enabled,
      running: BackupEngine.getStatus()[id] || null,
      schedule: cron.backups.map((j) => ({
        id: j.id,
        schedule: j.schedule,
        human: j.human,
        nextRun: j.nextRun,
        enabled: j.enabled,
      })),
      includes: {
        database: site.database?.name || null,
        dirs: site.backupDirs,
        excludes: site.backupExcludes,
        env: !!site.deployPath && existsSync(join(site.deployPath, ".env")),
      },
    };
  }

  static backupNow(id) {
    getSite(id);
    return BackupEngine.backupProject(id);
  }

  static restore(id, body) {
    const site = getSite(id);
    return BackupEngine.restoreJob(site, body.backup, {
      restoreDb: body.restoreDb !== false,
      restoreFiles: body.restoreFiles !== false,
      restoreEnv: body.restoreEnv !== false,
    });
  }

  /**
   * Replace the website's backup schedule (null/"" turns automatic backups off).
   */
  static async setBackupSchedule(id, schedule) {
    const site = getSite(id);
    const { backups } = await siteCronJobs(site);
    for (const job of backups) await CronManager.remove(job.id);
    if (!schedule) return { success: true, schedule: null };
    const task = panelTasks().find((t) => t.id === `backup:${id}`);
    const label = `Backup ${site.name}`;
    await CronManager.add({
      schedule: String(schedule).trim(),
      command: wrapCronCommand(task.command, label),
      label,
    });
    return { success: true, schedule };
  }

  /**
   * Laravel's scheduler (php artisan schedule:run every minute).
   */
  static async setScheduler(id, enabled) {
    const site = getSite(id);
    if (site.type !== "laravel")
      throw httpError(400, "The scheduler is for Laravel websites");
    const { scheduler } = await siteCronJobs(site);
    for (const job of scheduler) await CronManager.remove(job.id);
    if (enabled) {
      const php = phpBinary(site.phpVersion) || "php";
      await CronManager.add({
        schedule: "* * * * *",
        command: `cd ${shq(site.deployPath)} && ${php} artisan schedule:run >> /dev/null 2>&1`,
        label: `Laravel scheduler — ${site.name}`,
      });
    }
    return { success: true, enabled: !!enabled };
  }

  // ── Logs & statistics ──────────────────────────────────────

  static async logs(id, type = "error", lines = 200) {
    const site = getSite(id);
    if (type === "out" || type === "err")
      return ProcessManager.logs(site, type, lines);
    if (!site.siteName) return { path: null, lines: [] };
    const file = NginxManager.logPath(
      site.siteName,
      type === "access" ? "access" : "error",
    );
    if (!existsSync(file)) return { path: file, lines: [] };
    const r = await run("tail", [
      "-n",
      String(Math.min(Math.max(parseInt(lines) || 200, 10), 2000)),
      file,
    ]);
    return { path: file, lines: r.stdout.split("\n").filter(Boolean) };
  }

  static stats(id, days = 7) {
    const site = getSite(id);
    if (!site.siteName)
      return { available: false, reason: "This website has no domain yet" };
    const d = Math.min(Math.max(parseInt(days) || 7, 1), 30);
    return trafficStats(NginxManager.logPath(site.siteName, "access"), {
      days: d,
    });
  }

  static disk(id) {
    const site = getSite(id);
    return diskUsage(site.deployPath);
  }

  /**
   * One-off: run setup/deploy recovery after a panel restart.
   */
  static recover() {
    const sites = allSites();
    DeployEngine.recoverInterrupted(sites.map((s) => s.id));
    for (const s of sites) {
      if (
        s.provision?.status === "running" &&
        !JobRunner.jobs.has(s.provision.jobId)
      ) {
        saveSite(s.id, (p) => ({
          ...p,
          provision: {
            ...p.provision,
            status: "failed",
            error: "Interrupted (the panel restarted) — retry the setup",
          },
        }));
      }
    }
  }
}
