import { Router } from "express";
import { DeployEngine } from "../services/deploy-engine.js";

const router = Router();

// POST /api/v1/deploy/clone — Clone a repo
router.post("/clone", async (req, res) => {
  try {
    const { gitUrl, branch, deployPath, name, type, description, port } =
      req.body;
    if (!gitUrl || !deployPath) {
      return res
        .status(400)
        .json({ error: "gitUrl and deployPath are required" });
    }
    const result = await DeployEngine.cloneRepo(gitUrl, branch, deployPath, {
      name,
      type,
      description,
      port,
    });
    if (!result.success) return res.status(409).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/v1/deploy/pull — Pull latest changes
router.post("/pull", async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId)
      return res.status(400).json({ error: "projectId is required" });

    const config = DeployEngine.getConfig();
    const project = config.projects.find((p) => p.id === projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const result = await DeployEngine.pullLatest(
      project.deployPath,
      project.branch,
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/deploy/configure — Install deps + build
router.post("/configure", async (req, res) => {
  try {
    const { projectId, envVars } = req.body;
    if (!projectId)
      return res.status(400).json({ error: "projectId is required" });

    const result = await DeployEngine.configure(projectId, envVars || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/deploy/start — Start a project
router.post("/start", async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId)
      return res.status(400).json({ error: "projectId is required" });

    const result = await DeployEngine.start(projectId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/deploy/stop — Stop a project
router.post("/stop", async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId)
      return res.status(400).json({ error: "projectId is required" });

    const result = await DeployEngine.stop(projectId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/deploy/restart — Restart a project
router.post("/restart", async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId)
      return res.status(400).json({ error: "projectId is required" });

    const result = await DeployEngine.restart(projectId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/deploy/status/:id — Project runtime status
router.get("/status/:id", async (req, res) => {
  try {
    const result = await DeployEngine.getStatus(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/deploy/status — All project statuses
router.get("/status", async (req, res) => {
  try {
    const statuses = await DeployEngine.getAllStatuses();
    res.json({ statuses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
