import express, { Router } from "express";
import { getConfig } from "../lib/config.js";
import { normalizeSite } from "../services/site-manager.js";
import { DeployEngine } from "../services/deploy-engine.js";
import { BackupEngine } from "../services/backup-engine.js";

/**
 * Public endpoints called by Git hosts, not the dashboard. They are mounted
 * before the session check and authenticate with each website's own secret
 * (GitHub/Gitea/Bitbucket HMAC signature, GitLab token, or ?token=).
 */
const router = Router();

// The raw body is needed to verify the HMAC signature
router.use(express.raw({ type: () => true, limit: "5mb" }));

// POST /api/v1/hooks/deploy/:id — Push to deploy
router.post("/deploy/:id", (req, res) => {
  const record = (getConfig().projects || []).find((p) => p.id === req.params.id);
  if (!record) return res.status(404).json({ error: "Unknown website" });
  const site = normalizeSite(record);

  const check = DeployEngine.checkWebhook(site, {
    headers: req.headers,
    query: req.query,
    rawBody: req.body,
  });
  if (!check.deploy) {
    if (check.status === 401) BackupEngine.log(`[Deploy] Rejected webhook for ${site.name} from ${req.ip}: ${check.message}`);
    return res.status(check.status).json({ message: check.message });
  }

  try {
    const result = DeployEngine.deploy(site, { trigger: "webhook", by: check.pusher });
    BackupEngine.log(
      `[Deploy] Webhook for ${site.name}${check.branch ? ` (${check.branch})` : ""}: ${result.queued ? "queued" : "started"}`,
    );
    res.status(202).json({
      message: result.queued ? "Queued — it starts when the running deployment finishes" : "Deployment started",
      ...result,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
