import { Router } from 'express';
import { CronManager } from '../services/cron-manager.js';

const router = Router();

// GET /api/v1/cron — List all cron jobs
router.get('/', async (req, res) => {
  try {
    const jobs = await CronManager.list();
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/cron — Add a cron job
router.post('/', async (req, res) => {
  try {
    const { schedule, command } = req.body;
    if (!schedule || !command) {
      return res.status(400).json({ error: 'schedule and command are required' });
    }

    const result = await CronManager.add(schedule, command);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/v1/cron/:id — Update a cron job
router.put('/:id', async (req, res) => {
  try {
    const { schedule, command } = req.body;
    if (!schedule || !command) {
      return res.status(400).json({ error: 'schedule and command are required' });
    }

    const result = await CronManager.update(parseInt(req.params.id), schedule, command);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/cron/:id — Delete a cron job
router.delete('/:id', async (req, res) => {
  try {
    const result = await CronManager.remove(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
