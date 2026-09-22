#!/bin/bash
set -euo pipefail

# ============================================================
# VPS Deploy & Backup Manager — Manual Backup Runner
# Triggers a backup of every registered project. If the panel is running the
# backup is handed to it (visible in the dashboard); otherwise it runs directly
# and this script waits until it has finished.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "======================================================"
echo "  🛡️ VPS Backup Manager — Backup Execution"
echo "  Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "======================================================"

exec node "$SCRIPT_DIR/server/cli.js" "${1:-backup-all}" ${2:+"$2"}
