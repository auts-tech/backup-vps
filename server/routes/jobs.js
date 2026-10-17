import { Router } from "express";
import { JobRunner } from "../services/job-runner.js";
import { httpError } from "../lib/config.js";

const router = Router();

// GET /api/v1/jobs — Recent background jobs
router.get("/", (req, res) => {
  res.json({ jobs: JobRunner.list() });
});

// GET /api/v1/jobs/:id?offset=N — Job status plus output since offset
router.get("/:id", (req, res) => {
  const job = JobRunner.get(req.params.id, parseInt(req.query.offset) || 0);
  if (!job) throw httpError(404, "Job not found (it may have expired)");
  res.json(job);
});

// POST /api/v1/jobs/:id/cancel — Stop a running job
router.post("/:id/cancel", (req, res) => {
  const cancelled = JobRunner.cancel(req.params.id);
  res.json({ success: cancelled });
});

export default router;
