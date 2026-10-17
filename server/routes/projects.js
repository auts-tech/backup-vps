import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getConfig, updateConfig, httpError } from "../lib/config.js";
import { normalizeStack } from "../lib/stacks.js";
import { assertSitePath } from "../lib/validate.js";
import { SiteManager, getSite, normalizeSite } from "../services/site-manager.js";

/**
 * Older API kept for scripts that still call it. Projects are websites now:
 * the dashboard uses /api/v1/sites, which also sets up nginx, PM2 and builds.
 */
const router = Router();

function publicProject(p) {
  const site = normalizeSite(p);
  return {
    ...site,
    database: { ...site.database, password: undefined, hasPassword: !!site.database?.password },
    deploy: { ...site.deploy, webhookSecret: undefined },
  };
}

// GET /api/v1/projects — List all projects (websites)
router.get("/", (req, res) => {
  res.json({ projects: (getConfig().projects || []).map(publicProject) });
});

// GET /api/v1/projects/:id
router.get("/:id", (req, res) => {
  res.json(publicProject(getSite(req.params.id)));
});

// POST /api/v1/projects — Register an existing folder without setting anything up
router.post("/", (req, res) => {
  const { name, gitUrl, branch, deployPath, type, port, database, backupDirs, description } = req.body;
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name))
    throw httpError(400, "A project name (letters, numbers, . _ -) is required");
  const projects = getConfig().projects || [];
  if (projects.some((p) => p.name === name)) throw httpError(409, "Project with this name already exists");
  const path = assertSitePath(deployPath || `/var/www/${name}`);
  const project = {
    id: uuidv4(),
    name,
    description: description || "",
    gitUrl: gitUrl || "",
    branch: branch || "main",
    deployPath: path,
    type: normalizeStack(type || "node"),
    port: port ? Number(port) : null,
    database: database || { type: "mysql", name: "", user: "", password: "" },
    backupDirs: Array.isArray(backupDirs) ? backupDirs : [path],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  updateConfig((c) => {
    (c.projects || (c.projects = [])).push(project);
  });
  res.status(201).json(publicProject(project));
});

// PUT /api/v1/projects/:id — Same fields as PUT /api/v1/sites/:id
router.put("/:id", async (req, res) => {
  const { site } = await SiteManager.update(req.params.id, req.body);
  res.json(site);
});

// DELETE /api/v1/projects/:id — Forget the project (files, nginx and processes are kept)
router.delete("/:id", (req, res) => {
  const site = getSite(req.params.id);
  updateConfig((c) => {
    c.projects = (c.projects || []).filter((p) => p.id !== site.id);
  });
  res.json({ message: "Project removed from the panel", project: { id: site.id, name: site.name } });
});

export default router;
