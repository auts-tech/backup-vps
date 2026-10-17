import { Router } from "express";
import {
  PhpManager,
  DEFAULT_EXTENSIONS,
  INI_KEYS,
  assertVersion,
} from "../services/php-manager.js";
import { JobRunner } from "../services/job-runner.js";
import { httpError } from "../lib/config.js";

const router = Router();

// GET /api/v1/php — Installed versions, repository status, default CLI
router.get("/", async (req, res) => {
  res.json({
    ...(await PhpManager.overview()),
    defaultExtensions: DEFAULT_EXTENSIONS,
    iniKeys: INI_KEYS,
  });
});

// GET /api/v1/php/available — Versions installable from apt
router.get("/available", async (req, res) => {
  res.json({
    versions: await PhpManager.availableVersions(),
    installed: PhpManager.installedVersions(),
  });
});

// POST /api/v1/php/repository — Add ondrej/php (Ubuntu) or sury.org (Debian)
router.post("/repository", (req, res) => {
  const job = JobRunner.start("Add PHP repository", PhpManager.addRepoScript());
  res.json({ jobId: job.id });
});

// POST /api/v1/php/install — { version, extensions: [] }
router.post("/install", (req, res) => {
  const { version, extensions } = req.body;
  const job = JobRunner.start(
    `Install PHP ${version}`,
    PhpManager.installScript(
      version,
      Array.isArray(extensions) && extensions.length
        ? extensions
        : DEFAULT_EXTENSIONS,
    ),
  );
  res.json({ jobId: job.id });
});

// POST /api/v1/php/:version/uninstall
router.post("/:version/uninstall", (req, res) => {
  const job = JobRunner.start(
    `Uninstall PHP ${req.params.version}`,
    PhpManager.uninstallScript(req.params.version),
  );
  res.json({ jobId: job.id });
});

// POST /api/v1/php/:version/control — { action: start|stop|restart|reload }
router.post("/:version/control", async (req, res) => {
  res.json(await PhpManager.control(req.params.version, req.body.action));
});

// POST /api/v1/php/:version/default — Make this version the `php` CLI
router.post("/:version/default", async (req, res) => {
  res.json(await PhpManager.setDefaultCli(req.params.version));
});

// GET /api/v1/php/:version/extensions — Available extension packages
router.get("/:version/extensions", async (req, res) => {
  res.json({
    extensions: await PhpManager.extensionPackages(req.params.version),
  });
});

// POST /api/v1/php/:version/extensions — { name, action: install|remove }
router.post("/:version/extensions", (req, res) => {
  const { name, action } = req.body;
  if (!["install", "remove"].includes(action))
    throw httpError(400, "action must be install or remove");
  const job = JobRunner.start(
    `${action === "install" ? "Install" : "Remove"} php${req.params.version}-${name}`,
    PhpManager.extensionScript(req.params.version, name, action),
  );
  res.json({ jobId: job.id });
});

// GET /api/v1/php/:version/ini?sapi=fpm — Common php.ini settings
router.get("/:version/ini", (req, res) => {
  assertVersion(req.params.version);
  const sapi = req.query.sapi || "fpm";
  res.json({
    sapi,
    path: PhpManager.iniPath(req.params.version, sapi),
    settings: PhpManager.readIniSettings(req.params.version, sapi),
  });
});

// PUT /api/v1/php/:version/ini — { sapi, settings: { key: value } }
router.put("/:version/ini", async (req, res) => {
  res.json(
    await PhpManager.writeIniSettings(
      req.params.version,
      req.body.sapi || "fpm",
      req.body.settings,
    ),
  );
});

export default router;
