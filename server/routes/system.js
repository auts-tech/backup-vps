import { Router } from "express";
import { PortScanner } from "../services/port-scanner.js";
import { Updater } from "../services/updater.js";
import { ServiceManager } from "../services/service-manager.js";
import { httpError } from "../lib/config.js";
import { serviceCtl, hasSystemd } from "../lib/shell.js";

const router = Router();
const UNIT = /^[A-Za-z0-9@_.:-]+\.service$/;
// Restarting these from the ports page would cut you off or kill the panel mid-request
const CRITICAL_UNITS = [
  "ssh.service",
  "sshd.service",
  "vps-backup-manager.service",
  "systemd-journald.service",
  "dbus.service",
];

// GET /api/v1/system/ports — Listening ports with process and owner details
router.get("/ports", async (req, res) => {
  res.json(await PortScanner.list());
});

// POST /api/v1/system/processes/:pid/kill — { signal: TERM|KILL }
router.post("/processes/:pid/kill", async (req, res) => {
  res.json(await PortScanner.kill(req.params.pid, req.body.signal || "TERM"));
});

// GET /api/v1/system/services — systemd services (hosting services first)
router.get("/services", async (req, res) => {
  res.json(await ServiceManager.list());
});

// GET /api/v1/system/services/:unit/logs?lines=200 — journalctl output
router.get("/services/:unit/logs", async (req, res) => {
  res.json(await ServiceManager.logs(req.params.unit, req.query.lines));
});

// POST /api/v1/system/services/:unit/restart — Restart from the Ports page (never SSH or the panel)
router.post("/services/:unit/restart", async (req, res) => {
  const unit = req.params.unit;
  if (!UNIT.test(unit)) throw httpError(400, "Invalid service name");
  if (CRITICAL_UNITS.includes(unit))
    throw httpError(400, `${unit} can't be restarted from here`);
  if (!hasSystemd())
    throw httpError(400, "systemd is not available on this server");
  const r = await serviceCtl("restart", unit.replace(/\.service$/, ""));
  if (r.code !== 0)
    throw httpError(
      500,
      (r.stderr || r.stdout).trim() || `Could not restart ${unit}`,
    );
  res.json({ success: true });
});

// POST /api/v1/system/services/:unit/:action — start | stop | reload | enable | disable (Services page)
router.post("/services/:unit/:action", async (req, res) => {
  res.json(await ServiceManager.action(req.params.unit, req.params.action));
});

// GET /api/v1/system/version — Running version and commit
router.get("/version", async (req, res) => {
  res.json(await Updater.version());
});

// GET /api/v1/system/update?force=1 — Check the git remote for a newer version
router.get("/update", async (req, res) => {
  res.json(await Updater.check({ force: req.query.force === "1" }));
});

// POST /api/v1/system/update — Pull, install dependencies, verify, then restart
router.post("/update", async (req, res) => {
  res.json(await Updater.apply());
});

export default router;
