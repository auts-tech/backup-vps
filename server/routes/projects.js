import { Router } from "express";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "..", "data", "config.json");

const router = Router();

function getConfig() {
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function saveConfig(config) {
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// GET /api/v1/projects — List all projects
router.get("/", (req, res) => {
  const config = getConfig();
  res.json({ projects: config.projects || [] });
});

// GET /api/v1/projects/:id — Get a single project
router.get("/:id", (req, res) => {
  const config = getConfig();
  const project = config.projects.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project);
});

// POST /api/v1/projects — Add a new project
router.post("/", (req, res) => {
  const config = getConfig();
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

  if (!name) return res.status(400).json({ error: "Project name is required" });

  // Check for duplicate names
  if (config.projects.some((p) => p.name === name)) {
    return res
      .status(409)
      .json({ error: "Project with this name already exists" });
  }

  const project = {
    id: uuidv4(),
    name,
    description: description || "",
    gitUrl: gitUrl || "",
    branch: branch || "main",
    deployPath: deployPath || `/var/www/${name}`,
    type: type || "node", // node, php, static
    port: port || null,
    database: database || { type: "mysql", name: "", user: "", password: "" },
    backupDirs: backupDirs || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  config.projects.push(project);
  saveConfig(config);

  res.status(201).json(project);
});

// PUT /api/v1/projects/:id — Update a project
router.put("/:id", (req, res) => {
  const config = getConfig();
  const index = config.projects.findIndex((p) => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Project not found" });

  const updates = req.body;
  delete updates.id; // Can't change ID
  delete updates.createdAt;

  config.projects[index] = {
    ...config.projects[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  saveConfig(config);
  res.json(config.projects[index]);
});

// DELETE /api/v1/projects/:id — Delete a project
router.delete("/:id", (req, res) => {
  const config = getConfig();
  const index = config.projects.findIndex((p) => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Project not found" });

  const removed = config.projects.splice(index, 1)[0];
  saveConfig(config);

  res.json({ message: "Project deleted", project: removed });
});

export default router;
