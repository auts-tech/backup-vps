import { Router } from "express";
import { Firewall } from "../services/firewall.js";
import { JobRunner } from "../services/job-runner.js";

const router = Router();
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// GET /api/v1/firewall — ufw status, default policies, rules
router.get("/", async (req, res) => {
  res.json(await Firewall.status());
});

// POST /api/v1/firewall/install — apt install ufw (not enabled)
router.post("/install", (req, res) => {
  res.json({
    jobId: JobRunner.start("Install ufw firewall", Firewall.installScript()).id,
  });
});

// POST /api/v1/firewall/enable — Allow SSH + the way you reach this panel, then enable
router.post("/enable", async (req, res) => {
  res.json(
    await Firewall.enable({
      panelPort: req.socket.localPort,
      viaProxy: LOOPBACK.has(req.socket.remoteAddress),
    }),
  );
});

// POST /api/v1/firewall/disable
router.post("/disable", async (req, res) => {
  res.json(await Firewall.disable());
});

// POST /api/v1/firewall/rules — { action, port, proto, from, comment }
router.post("/rules", async (req, res) => {
  res.status(201).json(await Firewall.addRule(req.body));
});

// POST /api/v1/firewall/rules/delete — { number } or { spec } (inactive firewall)
router.post("/rules/delete", async (req, res) => {
  res.json(await Firewall.deleteRule(req.body));
});

export default router;
