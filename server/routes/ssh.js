import { Router } from "express";
import { SshKeys } from "../services/ssh-keys.js";

const router = Router();

// GET /api/v1/ssh/keys — Keys allowed to log in over SSH
router.get("/keys", (req, res) => {
  res.json(SshKeys.list());
});

// POST /api/v1/ssh/keys — { publicKey, comment }
router.post("/keys", (req, res) => {
  res.status(201).json(SshKeys.add(req.body.publicKey, req.body.comment));
});

// POST /api/v1/ssh/keys/delete — { fingerprint }
router.post("/keys/delete", (req, res) => {
  res.json(SshKeys.remove(String(req.body.fingerprint || "")));
});

// GET /api/v1/ssh/deploy-key — This server's public key (for Git deploy keys)
router.get("/deploy-key", (req, res) => {
  res.json(SshKeys.deployKey());
});

// POST /api/v1/ssh/deploy-key — Generate one (ed25519) if the server has none
router.post("/deploy-key", async (req, res) => {
  res.status(201).json(await SshKeys.generateDeployKey());
});

// POST /api/v1/ssh/test — { host: github | gitlab | bitbucket | hostname }
router.post("/test", async (req, res) => {
  res.json(await SshKeys.testGitHost(req.body.host));
});

export default router;
