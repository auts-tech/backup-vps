import { Router } from "express";
import { BackupEngine } from "../services/backup-engine.js";

const router = Router();

// GET /api/v1/backups — List backups (optionally for a specific project)
router.get("/", async (req, res) => {
  try {
    const { project } = req.query;
    const backups = await BackupEngine.listBackups(project || null);
    res.json({ backups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/backups/trigger — Trigger backup for a project or all
router.post("/trigger", async (req, res) => {
  try {
    const { projectId, target } = req.body;

    if (projectId) {
      const result = await BackupEngine.backupProject(projectId, target);
      if (req.body.waitForCompletion && result.backupId) {
        const [completed] = await BackupEngine.waitForAll();
        return res.json(completed || result);
      }
      return res.json(result);
    }

    // Backup all projects
    const results = await BackupEngine.backupAll(target);
    if (req.body.waitForCompletion) {
      const completed = await BackupEngine.waitForAll();
      return res.json({ results: completed });
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/backups/trigger-vps — Full VPS snapshot
router.post("/trigger-vps", async (req, res) => {
  try {
    const { target } = req.body;
    const result = await BackupEngine.snapshotVPS(target);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/backups/restore — Restore a backup
router.post("/restore", async (req, res) => {
  try {
    const { projectId, backupDate, restoreDb, restoreFiles, restoreEnv } =
      req.body;
    if (!projectId || !backupDate) {
      return res
        .status(400)
        .json({ error: "projectId and backupDate are required" });
    }

    const result = await BackupEngine.restoreBackup(projectId, backupDate, {
      restoreDb,
      restoreFiles,
      restoreEnv,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/backups/status — Current backup status
router.get("/status", (req, res) => {
  const status = BackupEngine.getStatus();
  res.json({ status });
});

// POST /api/v1/backups/cleanup — Clean up old backups
router.post("/cleanup", async (req, res) => {
  try {
    const { project } = req.body;
    await BackupEngine.cleanupOldBackups(project);
    res.json({ success: true, message: "Cleanup completed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
