import { Router } from "express";
import { SiteManager, getSite } from "../services/site-manager.js";
import { DeployEngine } from "../services/deploy-engine.js";

const router = Router();

// GET /api/v1/sites — Every website with live status, plus nginx sites that belong to none
router.get("/", async (req, res) => {
  res.json(await SiteManager.list());
});

// GET /api/v1/sites/suggest?name=&domain=&repo=&type= — Defaults for the New website form
router.get("/suggest", async (req, res) => {
  res.json(await SiteManager.suggest(req.query));
});

// POST /api/v1/sites/inspect — { gitUrl, branch } branches + detected stack, commands, PHP version
router.post("/inspect", async (req, res) => {
  res.json(
    await SiteManager.inspectRepository(req.body.gitUrl, req.body.branch),
  );
});

// GET /api/v1/sites/dns?domain= — Where a domain points, and whether that is this server
router.get("/dns", async (req, res) => {
  res.json(await SiteManager.checkDns(req.query.domain));
});

// POST /api/v1/sites — Create a website; setup runs as a job → { site, jobId }
router.post("/", async (req, res) => {
  res.status(201).json(await SiteManager.create(req.body));
});

// POST /api/v1/sites/import — { name } Manage an existing nginx site as a website
router.post("/import", async (req, res) => {
  res.status(201).json({ site: await SiteManager.importNginx(req.body.name) });
});

// POST /api/v1/sites/pm2/install — Install the PM2 process manager
router.post("/pm2/install", (req, res) => {
  res.json({ jobId: SiteManager.installPm2().id });
});

// GET /api/v1/sites/:id — Everything the website page shows
router.get("/:id", async (req, res) => {
  res.json(await SiteManager.detail(req.params.id));
});

// PUT /api/v1/sites/:id — Settings (description, branch, deploy script, start command, port, PHP, web root, backups)
router.put("/:id", async (req, res) => {
  res.json(await SiteManager.update(req.params.id, req.body));
});

// POST /api/v1/sites/:id/delete — { deleteFiles, dropDatabase, removeNginx } → { jobId }
router.post("/:id/delete", (req, res) => {
  res.json({ jobId: SiteManager.remove(req.params.id, req.body).id });
});

// POST /api/v1/sites/:id/retry — Run a failed setup again
router.post("/:id/retry", (req, res) => {
  res.json({ jobId: SiteManager.retry(req.params.id).id });
});

// ── Deployments ────────────────────────────────────────────

function startDeploy(res, fn) {
  try {
    res.json(fn());
  } catch (err) {
    // Let the dashboard attach to the deployment that is already running
    if (err.jobId)
      return res.status(409).json({ error: err.message, jobId: err.jobId });
    throw err;
  }
}

// POST /api/v1/sites/:id/deploy — Pull, build and restart → { jobId, deployId }
router.post("/:id/deploy", (req, res) => {
  const site = getSite(req.params.id);
  startDeploy(res, () =>
    DeployEngine.deploy(site, {
      trigger: "manual",
      by: req.user?.email || null,
    }),
  );
});

// POST /api/v1/sites/:id/rollback — { commit } Check out an earlier commit, build and restart
router.post("/:id/rollback", (req, res) => {
  const site = getSite(req.params.id);
  startDeploy(res, () =>
    DeployEngine.deploy(site, {
      trigger: "rollback",
      commit: String(req.body.commit || ""),
      by: req.user?.email || null,
    }),
  );
});

// GET /api/v1/sites/:id/deployments — History, newest first
router.get("/:id/deployments", (req, res) => {
  getSite(req.params.id);
  res.json({
    deployments: DeployEngine.history(req.params.id),
    running: DeployEngine.running(req.params.id)?.id || null,
  });
});

// GET /api/v1/sites/:id/deployments/:deployId/log
router.get("/:id/deployments/:deployId/log", (req, res) => {
  getSite(req.params.id);
  res.json(DeployEngine.readLog(req.params.id, req.params.deployId));
});

// GET /api/v1/sites/:id/git/pending — Fetch and list commits not deployed yet
router.get("/:id/git/pending", async (req, res) => {
  res.json(await DeployEngine.pendingCommits(getSite(req.params.id)));
});

// POST /api/v1/sites/:id/webhook — { enabled, rotate } Push-to-deploy
router.post("/:id/webhook", (req, res) => {
  res.json(SiteManager.setAutoDeploy(req.params.id, req.body));
});

// ── App process (PM2) ──────────────────────────────────────

// POST /api/v1/sites/:id/app/:action — start | stop | restart
router.post("/:id/app/:action", async (req, res) => {
  res.json(await SiteManager.control(req.params.id, req.params.action));
});

// GET /api/v1/sites/:id/logs?type=access|error|out|err&lines=200
router.get("/:id/logs", async (req, res) => {
  res.json(
    await SiteManager.logs(req.params.id, req.query.type, req.query.lines),
  );
});

// ── Domains & HTTPS ────────────────────────────────────────

// PUT /api/v1/sites/:id/domains — { domains: [] } (creates the nginx site when there is none)
router.put("/:id/domains", async (req, res) => {
  res.json(await SiteManager.setDomains(req.params.id, req.body.domains));
});

// POST /api/v1/sites/:id/ssl — { email, redirect } Let's Encrypt certificate → { jobId }
router.post("/:id/ssl", (req, res) => {
  res.json(SiteManager.issueSsl(req.params.id, req.body));
});

// POST /api/v1/sites/:id/enabled — { enabled } Take the site online/offline in nginx
router.post("/:id/enabled", async (req, res) => {
  res.json(
    await SiteManager.setEnabled(req.params.id, req.body.enabled !== false),
  );
});

// ── Environment (.env) ─────────────────────────────────────

router.get("/:id/env", (req, res) => {
  res.json(SiteManager.readEnv(req.params.id));
});

// PUT /api/v1/sites/:id/env — { content } raw file, or { vars: [{ key, value }] }
router.put("/:id/env", async (req, res) => {
  res.json(await SiteManager.writeEnv(req.params.id, req.body));
});

// POST /api/v1/sites/:id/env/apply — Restart the app / rebuild Laravel's config cache
router.post("/:id/env/apply", async (req, res) => {
  res.json(await SiteManager.applyEnv(req.params.id));
});

// ── Database ───────────────────────────────────────────────

// POST /api/v1/sites/:id/database — { writeEnv } Create a database + user for the website
router.post("/:id/database", async (req, res) => {
  res
    .status(201)
    .json(await SiteManager.createDatabaseFor(req.params.id, req.body));
});

// PUT /api/v1/sites/:id/database — { name, user, password } Link an existing database
router.put("/:id/database", async (req, res) => {
  res.json(await SiteManager.linkDatabase(req.params.id, req.body));
});

// POST /api/v1/sites/:id/database/unlink — { drop }
router.post("/:id/database/unlink", async (req, res) => {
  res.json(await SiteManager.unlinkDatabase(req.params.id, req.body));
});

// GET /api/v1/sites/:id/database/credentials
router.get("/:id/database/credentials", (req, res) => {
  res.json(SiteManager.databaseCredentials(req.params.id));
});

// ── Backups & scheduled jobs ───────────────────────────────

router.get("/:id/backups", async (req, res) => {
  res.json(await SiteManager.backups(req.params.id));
});

// POST /api/v1/sites/:id/backups — Back up now
router.post("/:id/backups", async (req, res) => {
  res.json(await SiteManager.backupNow(req.params.id));
});

// POST /api/v1/sites/:id/backups/restore — { backup, restoreDb, restoreFiles, restoreEnv } → { jobId }
router.post("/:id/backups/restore", (req, res) => {
  res.json({ jobId: SiteManager.restore(req.params.id, req.body).id });
});

// PUT /api/v1/sites/:id/backups/schedule — { schedule: "0 2 * * *" | null }
router.put("/:id/backups/schedule", async (req, res) => {
  res.json(
    await SiteManager.setBackupSchedule(req.params.id, req.body.schedule),
  );
});

// PUT /api/v1/sites/:id/scheduler — { enabled } Laravel scheduler cron entry
router.put("/:id/scheduler", async (req, res) => {
  res.json(await SiteManager.setScheduler(req.params.id, !!req.body.enabled));
});

// ── Insights ───────────────────────────────────────────────

// GET /api/v1/sites/:id/stats?days=7 — Visitors from the access log
router.get("/:id/stats", (req, res) => {
  res.json(SiteManager.stats(req.params.id, req.query.days));
});

// GET /api/v1/sites/:id/disk — Folder size (measured in the background, cached)
router.get("/:id/disk", (req, res) => {
  res.json(SiteManager.disk(req.params.id));
});

export default router;
