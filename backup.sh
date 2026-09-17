#!/bin/bash
set -euo pipefail

# ============================================================
# VPS Deploy & Backup Manager — Dynamic Backup Runner
# All configuration and credentials are managed dynamically via the Web Admin Panel.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-9090}"
URL="http://127.0.0.1:${PORT}/api/v1/backups/trigger"

echo "======================================================"
echo "  🛡️ VPS Backup Manager — Dynamic Backup Execution"
echo "  Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "======================================================"

# 1. Try triggering via running web daemon
if curl -s -f -X POST "$URL" -H "Content-Type: application/json" -d '{}' > /dev/null 2>&1; then
  echo "✓ Backup task triggered successfully via running daemon."
  echo "  Track progress in the admin dashboard: http://localhost:${PORT}"
  exit 0
fi

# 2. Fallback: Run BackupEngine directly via Node if daemon is not running
echo "Web daemon not responding on port ${PORT}. Executing direct backup engine..."
(cd "$SCRIPT_DIR/server" && node -e "
  import('./services/backup-engine.js').then(async ({ BackupEngine }) => {
    console.log('Running direct backup for all registered projects...');
    const result = await BackupEngine.backupAll();
    console.log('Execution completed:', JSON.stringify(result, null, 2));
    process.exit(0);
  }).catch(err => {
    console.error('Direct backup failed:', err);
    process.exit(1);
  });
")
