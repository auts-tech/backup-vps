#!/bin/bash
set -euo pipefail

# ============================================================
# VPS Deploy & Backup Manager — Full Server Setup Script
# Run this on your Ubuntu/Debian VPS to install all tools & start daemon
# Usage: sudo bash setup.sh
# ============================================================

echo "======================================================"
echo "  🛡️  VPS Deploy & Backup Manager — Setup & Install"
echo "======================================================"

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Update packages
echo "[1/7] Updating package index..."
apt-get update -y

# 2. Install required CLI utilities
echo "[2/7] Installing rclone, jq, curl, git, gzip, msmtp, tar..."
apt-get install -y rclone jq curl git gzip msmtp msmtp-mta tar ca-certificates

# 3. Install Node.js 20 LTS if not present
echo "[3/7] Checking Node.js installation..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 18 ]; then
  echo "  Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "  Node.js version: $(node -v)"
echo "  NPM version:     $(npm -v)"

# 4. Install backend dependencies
echo "[4/7] Installing Node dependencies in server/..."
(cd "$INSTALL_DIR/server" && npm install --production)

# 5. Setup config & log directories
echo "[5/7] Creating system directories & setting permissions..."
mkdir -p /root/.config/backup
mkdir -p /root/.config/rclone
mkdir -p /var/log
touch /var/log/vps-backup-manager.log
chmod 664 /var/log/vps-backup-manager.log

# Set UK timezone
timedatectl set-timezone Europe/London || true

# Ensure .env exists
if [ ! -f "$INSTALL_DIR/.env" ] && [ -f "$INSTALL_DIR/.env.example" ]; then
  echo "  Creating .env from .env.example..."
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
fi

# Copy credentials if present
if [ -f "$INSTALL_DIR/service-account.json" ]; then
  cp "$INSTALL_DIR/service-account.json" /root/.config/backup/
  chmod 600 /root/.config/backup/service-account.json
fi

if [ -f "$INSTALL_DIR/rclone.conf" ]; then
  cp "$INSTALL_DIR/rclone.conf" /root/.config/rclone/
  chmod 600 /root/.config/rclone/rclone.conf
fi

if [ -f "$INSTALL_DIR/msmtprc" ]; then
  cp "$INSTALL_DIR/msmtprc" /root/.msmtprc
  chmod 600 /root/.msmtprc
fi

# 6. Create systemd service
echo "[6/7] Configuring systemd service (vps-backup-manager)..."
cat <<EOF > /etc/systemd/system/vps-backup-manager.service
[Unit]
Description=VPS Deploy & Backup Manager API and Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/server
ExecStart=$(which node) index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=9090
EnvironmentFile=-$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vps-backup-manager
systemctl restart vps-backup-manager

# 7. Verification
echo "[7/7] Verifying service..."
sleep 2
if systemctl is-active --quiet vps-backup-manager; then
  SERVER_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
  echo ""
  echo "======================================================"
  echo "  🎉 Setup Complete & Service Running!"
  echo "======================================================"
  echo ""
  echo "  🌐 Dashboard URL: http://${SERVER_IP}:9090"
  echo "  📡 API Endpoint:  http://${SERVER_IP}:9090/api/v1"
  echo "  📋 Status:        systemctl status vps-backup-manager"
  echo "  📜 Logs:          journalctl -u vps-backup-manager -f"
  echo ""
  echo "  First step: Open the dashboard URL in your browser"
  echo "  to complete the initial setup wizard!"
  echo "======================================================"
else
  echo "⚠️ Service did not start cleanly. Check logs with:"
  echo "  journalctl -u vps-backup-manager -xe"
fi
