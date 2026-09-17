# 🚀 Production Deployment & Server Management Guide

This guide walks you through deploying and managing the **VPS Deploy & Backup Manager** on an **Ubuntu / Debian VPS** (e.g., Contabo, Hetzner, DigitalOcean, Linode, AWS EC2).

---

## 📋 Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Step 1: SSH Connection & Server Preparation](#step-1-ssh-connection--server-preparation)
3. [Step 2: Configure UFW Firewall](#step-2-configure-ufw-firewall)
4. [Step 3: Clone the Repository](#step-3-clone-the-repository)
5. [Step 4: Configure Environment & Login Credentials](#step-4-configure-environment--login-credentials)
6. [Step 5: Run Automated Setup Script](#step-5-run-automated-setup-script)
7. [Step 6: Verify & Access Dashboard](#step-6-verify--access-dashboard)
8. [Step 7: Service Management Commands](#step-7-service-management-commands)
9. [Step 8: How to Update in the Future](#step-8-how-to-update-in-the-future)
10. [Step 9: (Optional) Nginx Reverse Proxy with Free SSL](#step-9-optional-nginx-reverse-proxy-with-free-ssl)
11. [Troubleshooting](#troubleshooting)

---

## 1. Prerequisites
- An Ubuntu (20.04 / 22.04 / 24.04 LTS) or Debian VPS server.
- Root or sudo access.
- Inbound access on port `22` (SSH) and port `9090` (or `80`/`443` if using Nginx).

---

## Step 1: SSH Connection & Server Preparation

Log in to your Contabo VPS via SSH:
```bash
ssh root@YOUR_SERVER_IP
```

Update your package manager index:
```bash
apt update && apt upgrade -y
```

---

## Step 2: Configure UFW Firewall

Ensure SSH access and the manager port (`9090`) are permitted:

```bash
# Allow SSH
ufw allow 22/tcp

# Allow Web Dashboard Port
ufw allow 9090/tcp

# Enable Firewall
ufw --force enable

# Check status
ufw status
```

> **Note for Contabo Users**: If you have a custom firewall enabled in the Contabo Customer Control Panel (Cloud VPS > Manage > Security / Firewall), ensure port `9090` TCP inbound traffic is also allowed there.

---

## Step 3: Clone the Repository

We recommend placing the application under `/opt/backup-vps`:

```bash
cd /opt
git clone https://github.com/auts-tech/backup-vps.git backup-vps
cd /opt/backup-vps
```

*(If using an SSH deploy key instead, clone via `git clone git@github.com:auts-tech/backup-vps.git backup-vps`)*.

---

## Step 4: Configure Environment & Login Credentials

1. Copy the example configuration template:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` in an editor:
   ```bash
   nano .env
   ```

3. Fill in your credentials:
   ```ini
   # ── Admin Login Credentials ──────────
   ADMIN_EMAIL=admin@yourdomain.com
   ADMIN_PASSWORD=SetYourStrongPasswordHere

   # ── Server Configuration ─────────────
   PORT=9090
   HOST=0.0.0.0

   # ── Session Security ─────────────────
   # Generate a long random secret key
   SESSION_SECRET=e7b4198c2fa809d43ef102875bca612349018274a
   ```
   Save and exit (`Ctrl + O`, then `Enter`, then `Ctrl + X`).

4. Secure file permissions:
   ```bash
   chmod 600 .env
   ```

#### (Optional) Cloud Credentials Setup
- **Google Drive**: If you have Google Drive backups, copy your files:
  ```bash
  # cp service-account.json.example service-account.json
  # cp rclone.conf.example rclone.conf
  ```
- **Email Alerts**: If configuring Gmail / SMTP:
  ```bash
  # cp msmtprc.example msmtprc
  ```

---

## Step 5: Run Automated Setup Script

The project provides a complete installer script that automates tool installation and system service registration:

```bash
chmod +x setup.sh start.sh
sudo bash setup.sh
```

### What `setup.sh` automatically configures:
1. Installs system packages: `rclone`, `jq`, `curl`, `git`, `gzip`, `msmtp`, `tar`, `ca-certificates`.
2. Installs **Node.js 20 LTS** & npm if not present.
3. Installs backend dependencies (`server/package.json`).
4. Creates necessary log and config directories (`/root/.config/backup`, `/root/.config/rclone`, `/var/log`).
5. Creates and enables the systemd background daemon (`vps-backup-manager.service`).

---

## Step 6: Verify & Access Dashboard

Open your web browser and visit:
```
http://YOUR_SERVER_IP:9090
```

- Enter the **Email** and **Password** configured in your `.env`.
- You will be greeted by the dark glassmorphism dashboard where you can add projects, configure backup destinations, inspect system resources, and trigger deployments.

---

## Step 7: Service Management Commands

The application runs as a native Linux system service named `vps-backup-manager`.

| Task | Command |
| :--- | :--- |
| **Check service status** | `sudo systemctl status vps-backup-manager` |
| **Restart service** | `sudo systemctl restart vps-backup-manager` |
| **Stop service** | `sudo systemctl stop vps-backup-manager` |
| **Start service** | `sudo systemctl start vps-backup-manager` |
| **View real-time app logs** | `sudo journalctl -u vps-backup-manager -f` |
| **View backup execution logs** | `tail -f /var/log/vps-backup-manager.log` |
| **Check process port** | `ss -tulpn \| grep 9090` |

---

## Step 8: How to Update in the Future

When new features or fixes are pushed to the GitHub repository:

```bash
cd /opt/backup-vps
git pull
cd server && npm install --production
sudo systemctl restart vps-backup-manager
```

---

## Step 9: (Optional) Nginx Reverse Proxy with Free SSL

To access your panel at `https://backup.yourdomain.com` with a valid SSL certificate:

1. **Point your domain's DNS A Record** to your server's public IP address.
2. **Install Nginx and Certbot**:
   ```bash
   apt install -y nginx certbot python3-certbot-nginx
   ufw allow 80/tcp
   ufw allow 443/tcp
   ```
3. **Create Nginx configuration**:
   ```bash
   nano /etc/nginx/sites-available/backup-vps
   ```
   Paste the following configuration:
   ```nginx
   server {
       listen 80;
       server_name backup.yourdomain.com;

       location / {
           proxy_pass http://127.0.0.1:9090;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           
           # Disable buffer for real-time SSE logs
           proxy_buffering off;
           proxy_read_timeout 86400s;
       }
   }
   ```
4. **Enable the site**:
   ```bash
   ln -s /etc/nginx/sites-available/backup-vps /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```
5. **Issue free Let's Encrypt SSL Certificate**:
   ```bash
   certbot --nginx -d backup.yourdomain.com
   ```
   Now your panel is securely reachable at **`https://backup.yourdomain.com`**!

---

## Troubleshooting

### 1. Dashboard not loading in browser
- Check service status: `systemctl status vps-backup-manager`
- Check if port 9090 is listening: `ss -tulpn | grep 9090`
- Check UFW firewall: `ufw status`
- Contabo Cloud Firewall: Make sure port 9090 is allowed in the Contabo web panel.

### 2. "Invalid credentials" when logging in
- Check `.env` in `/opt/backup-vps/.env`.
- Remember to restart the service after editing `.env`:
  ```bash
  sudo systemctl restart vps-backup-manager
  ```

### 3. Permission denied during backup
- Ensure the service runs as `root` (default in the systemd unit) so it can back up MySQL databases, system configuration files, and read project directories.
