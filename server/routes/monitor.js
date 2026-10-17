import { Router } from "express";
import { Monitor } from "../services/monitor.js";

const router = Router();

// GET /api/v1/monitor/stats — Current system stats
router.get("/stats", async (req, res) => {
  try {
    const stats = await Monitor.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/monitor/processes — Top processes
router.get("/processes", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const processes = await Monitor.getProcesses(limit);
    res.json({ processes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/monitor/history — Historical metrics
router.get("/history", (req, res) => {
  const history = Monitor.getHistory();
  res.json({ history });
});

export default router;
