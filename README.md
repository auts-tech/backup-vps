# 🛡️ VPS Hosting Panel — Deploy, Backup & Hosting Manager

A self-hosted, cPanel-style control panel for a single Ubuntu/Debian VPS: websites, SSL, PHP, databases, email, files, terminal, cron, Git deploys and cloud backups — all from one web dashboard.

### Hosting
- **Websites & SSL** — Create nginx sites from templates (static, PHP, Laravel, WordPress, reverse proxy for Node/Python apps), edit configs with automatic `nginx -t` validation and rollback, per-site access/error logs. Install certbot with your Let's Encrypt email, one-click free HTTPS, automatic renewal status and renewal test.
- **PHP Versions** — Install several PHP-FPM versions side by side (5.6 – 8.5 via the ondrej/sury repositories), switch a site's PHP version from a dropdown, manage extensions, edit common `php.ini` settings, choose the default CLI version.
- **Databases** — Install MariaDB, create databases/users/privileges, browse tables, run SQL in a console, export (`.sql.gz`) and import dumps.
- **Email Hosting** — Mailboxes, forwarders and quotas on your own domains using docker-mailserver (Postfix, Dovecot, Rspamd, Fail2ban) with Roundcube webmail, automatic DKIM keys, and a live DNS checker for MX/SPF/DKIM/DMARC/PTR.
- **File Manager** — Browse, edit (syntax-highlighted editor), upload (drag & drop), download (folders as `.tar.gz`), zip/unzip, permissions & ownership, search.
- **Terminal** — Full root shell in the browser (xterm.js over an authenticated WebSocket).
- **Ports & Processes** — Every listening port with its process, public/local exposure, firewall status, and the project, PM2 app, Docker container, nginx site or service it belongs to.

### Operations
- **Projects, Backups & Deploy** — Back up databases, directories and `.env` files to Google Drive (rclone), S3 or SFTP; clone/pull Git repositories and restart apps.
- **Cron Jobs** — Schedule panel tasks (backups, VPS snapshots, retention cleanup) or any command; live schedule preview with next run times, pause/resume, “run now” with output, and an output log.
- **Monitoring & Alerts** — Live CPU/RAM/disk/network, top processes, live logs, Discord and email notifications.
- **One-click updates** — When new commits are pushed, the panel shows what's new and updates itself (fast-forward pull, dependency install, syntax check with automatic rollback, restart, re-login).

---

## 🚀 How to Run

### On an Ubuntu / Debian VPS (production)

> 📖 **Full guide**: firewall, HTTPS for the panel, website hosting and email hosting — see **[DEPLOY.md](DEPLOY.md)**.

```bash
ssh root@YOUR_SERVER_IP
cd /opt && git clone https://github.com/auts-tech/backup-vps.git backup-vps && cd backup-vps
cp .env.example .env && nano .env      # set ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET
sudo bash setup.sh
```

`setup.sh` installs Node.js 20, rclone, msmtp, cron, zip/unzip and build tools (for the web terminal), installs dependencies, creates the `vps-backup-manager` systemd service and enables log rotation. Then open **`http://YOUR_SERVER_IP:9090`**.

**Updating:** click **Update now** when the panel shows the *Update available* popup — or from SSH: `cd /opt/backup-vps && git pull && sudo bash setup.sh` (safe to re-run).

### Locally (development)

Requires **Node.js 18+**. Hosting features (nginx, PHP, MariaDB, mail) need a Debian/Ubuntu server; everything else runs locally.

```bash
./start.sh           # or: cd server && npm install && npm start
```

Open **http://localhost:9090**.

---

## 🔐 Security

- The panel runs as **root**: the terminal, file manager and installers have full control of the server. Treat the admin password like the root password.
- **Serve the panel over HTTPS and close port 9090** (see DEPLOY.md → *Secure the panel*). Logins are rate-limited (10 failures per IP per 15 minutes).
- All API routes under `/api/v1/` require a session token (from login) or the API key (`X-API-Key` header). Cron jobs use the API key automatically.
- Database and mail credentials are stored in `server/data/mysql.json` and `server/data/mail.json` (mode `0600`, git-ignored).

---

## 🛠️ Service Management

```bash
sudo systemctl status vps-backup-manager     # status
sudo systemctl restart vps-backup-manager    # restart
sudo journalctl -u vps-backup-manager -f     # panel logs
tail -f /var/log/vps-backup-manager.log      # backup / job activity
tail -f /var/log/vps-panel-cron.log          # output of scheduled tasks
node server/cli.js backup-all                # run a backup from the shell
```

---

## 📁 Project Structure

```
backup-scripts/
├── dashboard/                 # Single Page Application (vanilla JS)
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── app.js             # Router, sidebar, shared helpers
│       ├── api.js             # API client
│       ├── components/        # Toast, Modal, JobConsole (live job output), CodeEditor (Ace)
│       └── pages/             # dashboard, websites, files, databases, php, mail, terminal,
│                              # projects, backups, deploy, cron, monitor, logs, settings
├── server/                    # Node.js + Express API (port 9090)
│   ├── index.js               # Entry point, auth, WebSocket terminal
│   ├── cli.js                 # Task runner used by cron (backup-all, vps-snapshot, cleanup, backup <id>)
│   ├── lib/                   # shell (safe process spawning), config helpers
│   ├── routes/                # REST endpoints per module
│   ├── services/              # BackupEngine, CronManager, NginxManager, PhpManager,
│   │                          # MysqlManager, MailManager, JobRunner, Terminal, ...
│   └── data/config.json       # Projects & settings
├── setup.sh                   # Production installer (systemd)
├── start.sh                   # Local development start
└── backup.sh                  # Manual backup (wraps server/cli.js)
```
