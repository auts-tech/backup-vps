import { readFileSync, writeFileSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SERVER_DIR = join(__dirname, "..");
export const PROJECT_ROOT = join(SERVER_DIR, "..");
export const DATA_DIR = join(SERVER_DIR, "data");
export const CONFIG_PATH = join(DATA_DIR, "config.json");

export function getConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

/**
 * Write via a temp file + rename so a crash never leaves a half-written
 * config.json. Mode 0600: it holds database passwords and webhook secrets.
 */
export function saveConfig(config) {
  const tmp = `${CONFIG_PATH}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(tmp, CONFIG_PATH);
}

/**
 * Read-modify-write helper: updateConfig(c => { c.x = 1; })
 */
export function updateConfig(mutator) {
  const config = getConfig();
  mutator(config);
  saveConfig(config);
  return config;
}

/**
 * Error with an HTTP status, picked up by the global error handler.
 */
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
