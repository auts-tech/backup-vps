import { Router } from "express";
import { httpError } from "../lib/config.js";
import { getSite } from "../services/site-manager.js";
import { DeployEngine } from "../services/deploy-engine.js";
import { ProcessManager } from "../services/process-manager.js";

/**
 * Older deploy API kept for scripts and CI jobs that still call it.
 * New integrations: POST /api/v1/sites/:id/deploy, or a push webhook.
 */
const router = Router();

function siteFromBody(req) {
  if (!req.body.projectId) throw httpError(400, "projectId is required");
  return getSite(req.body.projectId);
}

// POST /api/v1/deploy/pull — { projectId } Full deployment: pull, build, restart → { jobId }
router.post("/pull", (req, res) => {
  const site = siteFromBody(req);
  try {
    res.json({ success: true, ...DeployEngine.deploy(site, { trigger: "api" }) });
  } catch (err) {
    if (err.jobId) return res.status(409).json({ success: false, error: err.message, jobId: err.jobId });
    throw err;
  }
});

// POST /api/v1/deploy/start|stop|restart — { projectId }
for (const action of ["start", "stop", "restart"]) {
  router.post(`/${action}`, async (req, res) => {
    res.json(await ProcessManager.control(siteFromBody(req), action));
  });
}

// GET /api/v1/deploy/status/:id — PM2 status of one project
router.get("/status/:id", async (req, res) => {
  res.json(await ProcessManager.status(getSite(req.params.id).name));
});

// GET /api/v1/deploy/status — PM2 status of every app
router.get("/status", async (req, res) => {
  res.json({ statuses: [...(await ProcessManager.list()).values()] });
});

// Clone/configure became part of website setup
router.post(["/clone", "/configure"], () => {
  throw httpError(410, "Create websites with POST /api/v1/sites — it clones, builds and starts in one job");
});

export default router;
