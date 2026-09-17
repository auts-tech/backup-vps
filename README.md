# 🛡️ VPS Deploy & Backup Manager

A dynamic, multi-project VPS deployment and backup management platform with a dark-mode web dashboard.

- **Dynamic Multi-Project Support**: Manage any number of applications (Node.js, PHP, Python, Static) on a single VPS.
- **Automated Backups**: Back up MySQL/MariaDB databases, file directories, `.env` configs, or take full VPS snapshots.
- **Multiple Cloud Storage Targets**: Google Drive (via rclone), Amazon S3, and remote SFTP servers.
- **One-Click Git Deploy**: Clone repositories, pull latest commits, install dependencies, build, and control processes.
- **Visual Cron Automation**: Schedule automated backups (e.g. daily at 12:00 PM UK time) with human-readable previews.
- **Live System Monitor**: Real-time CPU, RAM, disk usage, network I/O, load averages, and top process inspection.
- **Live Log Streaming**: Real-time SSE (Server-Sent Events) log viewer with search and error filtering.
- **Alerts & Notifications**: Automated failure/success alerts via Discord webhooks and Email (msmtp).

---

## 🚀 How to Run

### Option 1: Running Locally (For Testing / Development)

Make sure you have **Node.js 18+** installed.

#### Quick Start:
```bash
cd /Users/aashishtimalsina/Work/Project/Evereuser/nhs/backup-scripts
./start.sh
```

#### Or run manually:
```bash
cd /Users/aashishtimalsina/Work/Project/Evereuser/nhs/backup-scripts/server
npm install
npm start
```

Open your browser at:
👉 **[http://localhost:9090](http://localhost:9090)**

---

### Option 2: Deploying on an Ubuntu / Debian VPS (Contabo, etc.)

> 📖 **Full Guide**: For detailed step-by-step instructions, firewall rules, and SSL configuration, see **[DEPLOY.md](file:///Users/aashishtimalsina/Work/Project/Evereuser/nhs/backup-scripts/DEPLOY.md)**.

Clone or upload this repository to your VPS (e.g., in `/opt/backup-vps`):

```bash
# 1. SSH into your VPS
ssh root@YOUR_SERVER_IP

# 2. Navigate to the project directory
cd /path/to/backup-scripts

# 3. Run the automated installer
sudo bash setup.sh
```

`setup.sh` automatically:
1. Installs Node.js 20 LTS, rclone, msmtp, jq, curl, git
2. Installs all server dependencies
3. Creates a systemd service (`vps-backup-manager`) that runs persistently and restarts on boot
4. Configures credentials and log files

Once setup finishes, visit:
👉 **`http://YOUR_SERVER_IP:9090`**

---

## 🛠️ Management via Systemd (on VPS)

```bash
# Check service status
sudo systemctl status vps-backup-manager

# Restart the manager
sudo systemctl restart vps-backup-manager

# View live system logs
sudo journalctl -u vps-backup-manager -f

# View backup operation logs
tail -f /var/log/vps-backup-manager.log
```

---

## 📁 Project Structure

```
backup-scripts/
├── dashboard/                  # Single Page Application (SPA)
│   ├── index.html             # Shell with sidebar & layout
│   ├── css/
│   │   └── styles.css         # Glassmorphism dark design system
│   └── js/
│       ├── app.js             # SPA Router & controller
│       ├── api.js             # API HTTP client
│       ├── components/        # Toast & Modal components
│       └── pages/             # Page modules (Dashboard, Projects, Backups, Deploy, Cron, Monitor, Logs, Settings)
│
├── server/                     # Backend API (Node.js + Express)
│   ├── index.js               # Express entry point (Port 9090)
│   ├── package.json
│   ├── data/
│   │   └── config.json        # Projects registry & credentials
│   ├── middleware/
│   │   └── auth.js            # API key authentication
│   ├── routes/                # REST API endpoints
│   └── services/              # BackupEngine, DeployEngine, CronManager, Monitor, Notifier
│
├── start.sh                   # 1-click startup script
├── setup.sh                   # Production VPS setup script (systemd)
├── rclone.conf                # rclone cloud remote configuration
├── service-account.json       # Google Drive service account credentials
└── msmtprc                    # SMTP email client configuration
```

---

## 🔐 Security & API Authentication

- All API routes under `/api/v1/` require an API key passed in the `X-API-Key` HTTP header or `?apiKey=` query parameter.
- On your first run, the dashboard prompts you to configure initial settings and automatically generates and saves your API key in browser storage.
- You can inspect or regenerate your key anytime under **Settings > Authentication & API Key**.
