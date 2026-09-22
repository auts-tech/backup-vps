import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SERVER_DIR = join(__dirname, '..');
export const PROJECT_ROOT = join(SERVER_DIR, '..');
export const DATA_DIR = join(SERVER_DIR, 'data');
export const CONFIG_PATH = join(DATA_DIR, 'config.json');

export function getConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

export function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
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
