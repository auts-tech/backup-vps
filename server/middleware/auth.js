import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getConfig() {
  const configPath = join(__dirname, '..', 'data', 'config.json');
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

/**
 * Authentication middleware.
 * Supports two auth methods:
 *   1. Bearer token (from login endpoint) — checked via req.activeSessions
 *   2. Legacy X-API-Key header or ?apiKey query param
 *
 * If neither is valid, returns 401.
 */
export function authMiddleware(req, res, next) {
  // 1. Check Bearer token from login session
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const sessions = req.activeSessions;
    if (sessions && sessions.has(token)) {
      const session = sessions.get(token);
      // Check token age (24 hour expiry)
      const DAY = 24 * 60 * 60 * 1000;
      if (Date.now() - session.createdAt < DAY) {
        req.user = { email: session.email };
        return next();
      }
      // Token expired — remove it
      sessions.delete(token);
    }
  }

  // 2. Check Bearer token from query param (for SSE streams etc.)
  const queryToken = req.query.token;
  if (queryToken) {
    const sessions = req.activeSessions;
    if (sessions && sessions.has(queryToken)) {
      const session = sessions.get(queryToken);
      const DAY = 24 * 60 * 60 * 1000;
      if (Date.now() - session.createdAt < DAY) {
        req.user = { email: session.email };
        return next();
      }
      sessions.delete(queryToken);
    }
  }

  // 3. Legacy: Check X-API-Key header or ?apiKey query param
  const config = getConfig();
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (apiKey && config.apiKey && apiKey === config.apiKey) {
    req.user = { email: 'api-key-user' };
    return next();
  }

  // No valid auth found
  return res.status(401).json({
    error: 'Authentication required',
    message: 'Please login at the dashboard or provide a valid Bearer token'
  });
}

/**
 * Bypass auth for specific routes (e.g., initial setup, health check)
 */
export function publicRoute(req, res, next) {
  req.isPublic = true;
  next();
}
