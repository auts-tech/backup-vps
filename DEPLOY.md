# 🚀 Production Deployment & Server Management Guide

This guide walks you through deploying and managing the **VPS Deploy & Backup Manager** on an **Ubuntu / Debian VPS** (e.g., Contabo, Hetzner, DigitalOcean, Linode, AWS EC2).

> 💡 **100% Dynamic Configuration**: You do **not** need to manually edit config files like `service-account.json`, `msmtprc`, or `rclone.conf` on the server. All email credentials, Google Drive service accounts, storage targets, and backup tasks are managed directly through the Web Admin UI.

---

## 📋 Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Step 1: SSH Connection & Server Preparation](#step-1-ssh-connection--server-preparation)
3. [Step 2: Configure UFW Firewall](#step-2-configure-ufw-firewall)
4. [Step 3: Clone the Repository](#step-3-clone-the-repository)
5. [Step 4: Configure Login Credentials (.env)](#step-4-configure-login-credentials-env)
6. [Step 5: Run Automated Setup Script (setup.sh)](#step-5-run-automated-setup-script-setupsh)
7. [Step 6: Access Dashboard & Dynamic Configuration](#step-6-access-dashboard--dynamic-configuration)
8. [Step 7: 1-Click Instant Backup & Health Checks](#step-7-1-click-instant-backup--health-checks)
9. [Step 8: Service Management Commands](#step-8-service-management-commands)
10. [Step 9: How to Update in the Future](#step-9-how-to-update-in-the-future)
11. [Step 10: Secure the Panel with HTTPS (Recommended)](#step-10-secure-the-panel-with-https-recommended)
12. [Step 11: Host a Website](#step-11-host-a-website)
13. [Step 12: Email Hosting](#step-12-email-hosting)
14. [Troubleshooting](#troubleshooting)

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

# Allow Web Dashboard Port (close it again after Step 10)
ufw allow 9090/tcp

# Allow websites (HTTP + HTTPS)
ufw allow 80/tcp
ufw allow 443/tcp

# Enable Firewall
ufw --force enable

# Check status
ufw status
```

> **Note for Contabo Users**: If you have a custom firewall enabled in the Contabo Customer Control Panel (Cloud VPS > Manage > Security / Firewall), ensure ports `80`, `443` and `9090` TCP inbound are also allowed there. The panel opens mail ports (25, 465, 587, 993) in UFW automatically when you set up email, but a provider-level firewall must be opened by you.

---

## Step 3: Clone the Repository

We recommend placing the application under `/opt/backup-vps`:

```bash
cd /opt
git clone https://github.com/auts-tech/backup-vps.git backup-vps
cd /opt/backup-vps
```

---

## Step 4: Configure Login Credentials (.env)

The only file you need to create on the server is `.env` for your initial admin login:

1. Copy the example configuration template:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` in an editor:
   ```bash
   nano .env
   ```

3. Fill in your login credentials:
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

*(All other configurations like Google Drive Service Account, SMTP passwords, Discord webhooks, and S3 are done in the browser UI in Step 6).*

---

## Step 5: Run Automated Setup Script (setup.sh)

The project provides a complete installer script that automates tool installation and system service registration:

```bash
chmod +x setup.sh start.sh backup.sh
sudo bash setup.sh
```

### What `setup.sh` automatically configures:
1. Installs system packages: `rclone`, `jq`, `curl`, `git`, `gzip`, `msmtp`, `tar`, `ca-certificates`, `cron`, `zip`, `unzip`, `build-essential`, `python3`.
2. Enables the **cron** service (required for scheduled backups).
3. Installs **Node.js 20 LTS** & npm if not present.
4. Installs backend dependencies (`server/package.json`), including `node-pty` for the web terminal.
5. Creates log files and weekly log rotation (`/etc/logrotate.d/vps-panel`).
6. Creates and enables the systemd background daemon (`vps-backup-manager.service`) with auto-restart on boot.

nginx, PHP, MariaDB, certbot and Docker are **not** installed up front — each has an *Install* button in the panel, so you only install what you use.

---

## Step 6: Access Dashboard & Dynamic Configuration

Open your web browser and visit:
```
http://YOUR_SERVER_IP:9090
```

- Enter the **Email** and **Password** configured in your `.env`.
- You will be greeted by the modern high-contrast dashboard.

### Configuring Credentials in the UI:
Navigate to **Settings** from the sidebar:

1. **SMTP & Email Alerts**:
   - Enter your SMTP Host (e.g. `smtp.gmail.com`), Port (`587`), Username, and App Password.
   - Enter your sender and recipient email addresses.
   - Click **"Send Test Email"** to verify live email delivery.
   - When saved, the server dynamically generates and secures `/root/.msmtprc` automatically!

2. **Google Drive & Storage Quotas (Important)**:
   - **Personal Google Drive (@gmail.com)**:
     - Google **does not allow Service Accounts** to upload files into personal folders (fails with `Error 403: Service Accounts do not have storage quota. Leverage shared drives or use OAuth delegation instead., storageQuotaExceeded`).
     - **Solution**: In **Settings > Cloud Storage > Google Drive**, select **OAuth Token / rclone.conf (Personal Drive)**.
     - Paste your `rclone.conf` config block (containing `token = {"access_token": ..., "refresh_token": ...}`) and click **"Save Google Drive Config"**.
   - **Google Workspace Shared Drive (Team Drive)**:
     - Select **Service Account JSON (Shared Drive)**, paste your service account JSON file, and enter your Root Folder ID.
   - Click **"Test Google Drive Connection"** to verify that Google Drive is reachable and writable.

3. **Discord Webhooks**:
   - Paste your Discord webhook URL and click **"Send Test Webhook"**.

4. **Amazon S3 / SFTP**:
   - Configure S3 buckets or remote SFTP storage with live verification tests.

---

## Step 7: 1-Click Instant Backup & Health Checks

### 1. Persistent Instant Backup Button
- Located on the **top navigation bar** on every page.
- Click **"Instant Backup"** to immediately trigger a full snapshot across all registered applications and databases. Live toast alerts update you as the snapshot runs.

### 2. VPS System Health Check
- In **Settings**, click **"System Health Check"**.
- View real-time status and installed versions for `Node.js`, `rclone`, `msmtp`, `mysqldump`, `git`, `tar`, and `gzip` without touching the terminal.

---

## Step 8: Service Management Commands

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
| **Manual backup via CLI** | `sudo /opt/backup-vps/backup.sh` |

---

## Step 9: How to Update in the Future

### From the panel (recommended)

When new commits are pushed to the branch the server was cloned from, the panel shows an **Update available** popup right after you log in (and a green *Update available* button in the top bar). It lists what's new; click **Update now** and the panel:

1. Downloads the changes (`git fetch` + fast-forward merge — never a force reset).
2. Keeps this server's `server/data/config.json` (websites, API key, settings) and deployment history even if the update touches them.
3. Runs `npm ci` only if dependencies changed.
4. Checks every server file for syntax errors — if anything fails, it **rolls back** to the previous version and keeps running.
5. Restarts itself, signs you out, and shows *"Panel updated to …"* on the login screen.

You can also check manually by clicking the version number (e.g. `v1.0.0 · 9353904`) at the bottom of the sidebar.

**Private GitHub repository?** The server needs read access. Create a deploy key once:

```bash
ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N "" -C "vps-panel"
cat /root/.ssh/id_ed25519.pub     # GitHub → repo → Settings → Deploy keys → Add (read-only)
cd /opt/backup-vps && git remote set-url origin git@github.com:auts-tech/backup-vps.git
ssh -o StrictHostKeyChecking=accept-new -T git@github.com    # accept GitHub's host key once
```

If an update changes `setup.sh`, the popup tells you to run `sudo bash setup.sh` afterwards (from the panel's Terminal) to apply system-level changes.

### From SSH

```bash
cd /opt/backup-vps
git pull
sudo bash setup.sh
```

Re-running `setup.sh` is safe: it installs any new system packages and Node dependencies (`npm ci`, which never rewrites `package-lock.json`), then restarts the service. Your `.env`, `server/data/config.json`, database and mail credentials are kept.

> **Upgrading from a version before the hosting panel:** backup cron jobs created by the old dashboard never ran (they called the API without the API key). On first start the panel rewrites them to the new task runner automatically — check **Cron Jobs** afterwards. The old *Weekly Snapshot* and *Prune Expired* presets actually ran a normal backup; delete them and re-add from the new presets if you want a real snapshot or cleanup.

---

## Step 10: Secure the Panel with HTTPS (Recommended)

The panel includes a root terminal and file manager, so it should not be reachable over plain HTTP on port 9090. You can put it behind HTTPS **using the panel itself**:

1. **DNS**: create an `A` record, e.g. `panel.yourdomain.com` → your server IP.
2. **SSL / TLS** → enter your email → **Install certbot** — Let's Encrypt sends expiry warnings there, and automatic renewal is enabled. (nginx and certbot are also installed automatically with your first website.)
3. **Websites → New Website → Reverse proxy** → app port `9090` → domain `panel.yourdomain.com` → tick *Enable HTTPS* → **Create website**.
   (The proxy template already supports the live log stream and the terminal WebSocket.)
4. Open `https://panel.yourdomain.com` and log in.
5. Stop exposing port 9090 publicly:
   ```bash
   nano /opt/backup-vps/.env      # set HOST=127.0.0.1
   sudo systemctl restart vps-backup-manager
   ufw delete allow 9090/tcp
   ```
   From now on the panel is only reachable through nginx over HTTPS.

---

## Step 11: Host a Website

Every site or app on the server is a **Website**: one page holds its domains & HTTPS, code & deployments, `.env`, app process, database, backups and logs. There are no separate project / deploy / website records to keep in sync any more.

### Deploy an app from Git (Node.js, Next.js, React, Laravel, PHP, static, Python)

1. **Private repository?** **Security → SSH Keys** → *Generate deploy key*, add it to the repository as a read-only deploy key (GitHub: Settings → Deploy keys), and use the SSH URL (`git@github.com:you/app.git`). The page has a *Test connection* button.
2. **Websites → New Website → Deploy from Git** → paste the URL. The panel inspects the repository and fills in the framework, branch, build command, start command, web root (`dist`/`build` for React and other front-end apps) and a matching PHP version. The folder (`/var/www/<name>`) and a free port are suggested automatically — every value can be changed.
3. Enter the domain. A live DNS check shows whether it already points to this server; tick *Enable HTTPS* when it does. Laravel: keep *Create a database* ticked — the credentials are written to `.env`.
4. **Create website**. One job with a live log clones the code, writes `.env`, runs the deploy script (installing Composer or PM2 if missing), starts the app and checks it answers on its port, configures nginx, and issues the certificate. If a step fails, fix the cause and click *Retry setup* — finished steps are skipped.
5. Later updates: the **Deploy** button (pull + build + restart), or **Deployments → Deploy on push** to get a webhook URL and secret for GitHub, GitLab, Gitea or Bitbucket. Every deployment is kept with its log, and any earlier commit can be **rolled back** to.

### Other kinds of websites

- **WordPress** — *New Website → WordPress*: enter the domain and admin email. The database, WP-CLI download and installation happen automatically; the admin password is shown once at the end.
- **HTML / PHP files** — *New Website → Empty website*: upload into `public_html` with the **File Manager** (drag a `.zip` in, then *Extract*).
- **An app the panel doesn't run** (Docker, another service) — *New Website → Reverse proxy* → its port.
- **nginx sites made before this version** appear under *Other nginx sites* on the Websites page → **Manage as website**.

PHP sites need a PHP version (**PHP & Composer** → *Add Repository* once → **Install PHP Version**); databases need MariaDB connected (**Databases** → *Install MariaDB* → *Connect automatically*). Laravel's scheduler is a switch on the website's **PHP** tab.

**Which app is on which port?** Open **Ports & Processes**: every listening port with its process, whether it's public or local-only, whether UFW allows it, and what it belongs to (website, PM2 app, Docker container, nginx site, systemd service). Close everything else with **Security → Firewall** — turning it on keeps SSH and the panel reachable automatically.

Switch a website to another PHP version on its **PHP** tab. Every nginx change is validated with `nginx -t` first and rolled back automatically if it would break nginx.

---

## Step 12: Email Hosting

### Should you self-host email?

Receiving mail is easy; **delivering** mail to Gmail/Outlook inboxes is the hard part. It needs open outbound port 25, correct reverse DNS, SPF, DKIM and DMARC, and an IP address with a clean reputation.

| | Self-hosted (this panel) | Email provider (Google Workspace, Microsoft 365, Zoho Mail, Migadu, Fastmail) |
| :--- | :--- | :--- |
| Cost | Free, unlimited mailboxes | Per mailbox per month (Zoho has a free tier) |
| Deliverability | Good once DNS + PTR are right; you monitor it | Handled for you |
| Requirements | Port 25 open, PTR record, ~1 GB free RAM | Only DNS records |
| Best for | Many mailboxes, app/notification mail, full control | Business-critical mail |

If you choose a provider, you don't need the Email page — add the MX/SPF/DKIM records the provider gives you at your DNS host. Websites on this server keep working either way.

### Requirements (checked live on the Email page)

- **Outbound port 25 open.** Some providers block it on new accounts — ask support to unblock it if the check fails.
- **Reverse DNS (PTR)** for the server IP set to your mail hostname (e.g. `mail.example.com`). This is set in your **VPS provider's control panel** (Contabo: *Customer Control Panel → Reverse DNS Management*), not at your domain's DNS host.
- An **`A` record** for the mail hostname pointing to the server — needed for the TLS certificate.
- **nginx installed** (Websites page) and about **1 GB free RAM** (2 GB+ total recommended alongside websites).
- Nothing else listening on port 25 (remove `postfix`/`exim4` if a previous setup installed them).

### Setup

1. Open **Email** and review the pre-flight checks.
2. Enter your domain (`example.com`), mail hostname (`mail.example.com`), the first mailbox and its password → **Install Email Server**.
   The panel installs Docker and docker-mailserver in `/opt/vps-mail`, obtains a Let's Encrypt certificate, generates a DKIM key, opens ports 25/465/587/993 and (optionally) serves **Roundcube webmail** at `https://mail.example.com`.
3. **DNS Records** tab → add each record at your DNS provider. The page checks what is actually published and turns each row green:

   | Type | Name | Value |
   | :--- | :--- | :--- |
   | A | `mail.example.com` | server IP |
   | MX | `example.com` | `10 mail.example.com` |
   | TXT | `example.com` | `v=spf1 mx ~all` |
   | TXT | `mail._domainkey.example.com` | DKIM key shown on the page |
   | TXT | `_dmarc.example.com` | `v=DMARC1; p=quarantine; rua=mailto:postmaster@example.com` |
   | PTR | server IP | `mail.example.com` (set at your VPS provider) |

4. Send a message to [mail-tester.com](https://www.mail-tester.com) and aim for 10/10.
5. Add more mailboxes and forwarders from the Email page. Mailboxes on additional domains get their own DKIM key automatically — add that domain's records too.

**Mail client settings:** IMAP `mail.example.com:993` (SSL/TLS), SMTP `mail.example.com:587` (STARTTLS) or `465` (SSL/TLS), username = full email address.

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

### 3. rclone or Google Drive connection issues
- Go to **Settings > Google Drive** in the dashboard.
- If you see `Error 403: Service Accounts do not have storage quota. Leverage shared drives or use OAuth delegation instead., storageQuotaExceeded`:
  - **Reason**: Service Accounts have 0 MB storage quota on regular `@gmail.com` drives.
  - **Fix**: In the dashboard, switch to **OAuth Token / rclone.conf (Personal Drive)**, paste your `rclone.conf` with OAuth access/refresh token, and click **"Save Google Drive Config"**.
- Click **"Test Google Drive Connection"** to see live verification output returned by rclone.

### 4. Cron jobs don't run
- **Cron Jobs** page: a warning banner appears if the cron service is stopped — click *Start cron*.
- Check the **Cron Output Log** on that page (`/var/log/vps-panel-cron.log`). Every built-in task writes a line each time it runs.
- Click **Run** on a job to execute it immediately and see its output.
- Custom commands run with cron's minimal `PATH`: use absolute paths (`/usr/bin/php8.3`, not `php`) and write `%` as `\%`.

### 5. A PHP site shows "502 Bad Gateway"
- That site's PHP-FPM version isn't running: **PHP Versions** → *Start FPM*, or switch the site to an installed version on the Websites page.

### 6. Terminal says "basic terminal mode"
- `node-pty` did not compile. Run `apt install -y build-essential python3 && cd /opt/backup-vps/server && npm install`, then restart the service.

### 7. Email is not delivered or lands in spam
- Open **Email → DNS Records** and fix every red row (PTR and DKIM are the usual culprits).
- Make sure your provider allows outbound port 25.
- Check **Email → Logs** for rejection messages from the receiving server.

### 8. "Couldn't check for updates"
- The server can't reach the git remote. For a private repository add a deploy key (see Step 9), then click the version number in the sidebar to check again.
- "Files were edited on the server": someone changed tracked files directly on the VPS. Run `cd /opt/backup-vps && git status` and commit or `git checkout -- <file>` them.

