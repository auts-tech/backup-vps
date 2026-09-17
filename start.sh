#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"

echo "=========================================="
echo "  🚀 Starting VPS Deploy & Backup Manager  "
echo "=========================================="

if [ ! -d "$SERVER_DIR/node_modules" ]; then
  echo "📦 Installing server dependencies..."
  (cd "$SERVER_DIR" && npm install)
fi

echo "🌐 Launching dashboard & API server..."
cd "$SERVER_DIR"
npm start
