import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getConfig, updateConfig, httpError } from "../lib/config.js";
import { normalizeStack } from "../lib/stacks.js";
import { assertSitePath } from "../lib/validate.js";
import {
  SiteManager,
  getSite,
  normalizeSite,
} from "../services/site-manager.js";

const router = Router();

function publicProject(p) {
  const site = normalizeSite(p);
  return {
    ...site,
    database: {
      ...site.database,
      password: undefined,
      hasPassword: !!site.database?.password,
    },
    deploy: { ...site.deploy, webhookSecret: undefined },
  };
}

router.get("/", (req, res) => {
  res.json({ projects: (getConfig().projects || []).map(publicProject) });
});

router.get("/:id", (req, res) => {
  res.json(publicProject(getSite(req.params.id)));
});

router.post("/", (req, res) => {
  const {
    name,
    gitUrl,
    branch,
    deployPath,
    type,
    port,
    database,
    backupDirs,
    description,
  } = req.body;
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name))
    throw httpError(
      400,
      "A project name (letters, numbers, . _ -) is required",
    );
  const projects = getConfig().projects || [];
  if (projects.some((p) => p.name === name))
    throw httpError(409, "Project with this name already exists");
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

router.put("/:id", async (req, res) => {
  const { site } = await SiteManager.update(req.params.id, req.body);
  res.json(site);
});

router.delete("/:id", (req, res) => {
  const site = getSite(req.params.id);
  updateConfig((c) => {
    c.projects = (c.projects || []).filter((p) => p.id !== site.id);
  });
  res.json({
    message: "Project removed from the panel",
    project: { id: site.id, name: site.name },
  });
});

export default router;
