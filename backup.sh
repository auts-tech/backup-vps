#!/bin/bash
set -euo pipefail


DB_NAME="nhs_db"
DB_USER="nhs_user"
DB_PASS='Zyex2$iealoaABef'
BACKEND_DIR="/var/www/nhs-backend"
UPLOADS_DIR="/var/www/nhs-backend/uploads"
RCLONE_REMOTE="gdrive-backup"
DISCORD_WEBHOOK="https://discord.com/api/webhooks/1549841401917735023/x4gJB3sKt1DxEsKmr2R8B2UcQjsZ4yLcNSCkiprkbM57isF8an3m50dxkpJqew_2SqGo"
NOTIFY_EMAIL="hello.auts@gmail.com"
RETENTION_DAYS=30


DATE=$(date +%Y-%m-%d_%H-%M)
DATE_SHORT=$(date +%Y-%m-%d)
BACKUP_DIR="/tmp/nhs-backup-${DATE}"
LOG_FILE="/var/log/nhs-backup.log"
START_TIME=$(date +%s)

mkdir -p "$BACKUP_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

notify_discord() {
    local color="$1"
    local title="$2"
    local msg="$3"

    if [ "$DISCORD_WEBHOOK" = "__DISCORD_WEBHOOK_URL__" ]; then
        log "Discord webhook not configured, skipping notification"
        return 0
    fi

    curl -s -H "Content-Type: application/json" \
        -d "{\"embeds\":[{\"title\":\"$title\",\"description\":\"$msg\",\"color\":$color,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]}" \
        "$DISCORD_WEBHOOK" > /dev/null 2>&1 || true
}

notify_email() {
    local subject="$1"
    local body="$2"

    if command -v msmtp &> /dev/null; then
        echo -e "Subject: $subject\nFrom: hello.auts@gmail.com\nTo: $NOTIFY_EMAIL\n\n$body" \
            | msmtp "$NOTIFY_EMAIL" 2>/dev/null || log "Email notification failed (msmtp error)"
    else
        log "msmtp not installed, skipping email notification"
    fi
}

cleanup_on_error() {
    local end_time=$(date +%s)
    local duration=$(( end_time - START_TIME ))

    log "=== BACKUP FAILED after ${duration}s ==="

    local msg="❌ **Backup FAILED**\\n📅 Date: ${DATE_SHORT}\\n⏱️ Duration: ${duration}s\\n\\nCheck logs: \`/var/log/nhs-backup.log\`"
    notify_discord 15158332 "🚨 ATS Backup FAILED" "$msg"
    notify_email "❌ ATS Backup FAILED — ${DATE_SHORT}" "Backup failed at $(date)\nDuration: ${duration}s\n\nCheck logs at /var/log/nhs-backup.log on the VPS."

    rm -rf "$BACKUP_DIR"
    exit 1
}

trap cleanup_on_error ERR

log "============================================"
log "=== ATS Backup started ==="
log "============================================"

log "[1/6] Dumping MySQL database: $DB_NAME"
mysqldump \
    -u"$DB_USER" \
    -p"$DB_PASS" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    "$DB_NAME" 2>/dev/null | gzip > "$BACKUP_DIR/db_${DATE}.sql.gz"

DB_SIZE=$(du -sh "$BACKUP_DIR/db_${DATE}.sql.gz" | cut -f1)
log "    DB dump complete: $DB_SIZE"

log "[2/6] Archiving uploads directory: $UPLOADS_DIR"
if [ -d "$UPLOADS_DIR" ]; then
    tar czf "$BACKUP_DIR/files_${DATE}.tar.gz" \
        -C "$(dirname "$UPLOADS_DIR")" \
        "$(basename "$UPLOADS_DIR")"
    FILES_SIZE=$(du -sh "$BACKUP_DIR/files_${DATE}.tar.gz" | cut -f1)
    log "    Files archive complete: $FILES_SIZE"
else
    FILES_SIZE="0B"
    log "    WARNING: Uploads directory not found, skipping"
fi

log "[3/6] Backing up .env file"
if [ -f "$BACKEND_DIR/.env" ]; then
    cp "$BACKEND_DIR/.env" "$BACKUP_DIR/env_${DATE}.env"
    log "    .env backup complete"
else
    log "    WARNING: .env file not found at $BACKEND_DIR/.env"
fi

log "[4/6] Uploading to Google Drive..."
rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE:backups/${DATE_SHORT}/" \
    --drive-chunk-size=64M \
    --transfers=2 \
    --retries=5 \
    --retries-sleep=10s \
    --low-level-retries=10 \
    --stats-one-line \
    --log-file="$LOG_FILE" \
    --log-level=INFO

log "    Upload complete"

log "[5/6] Cleaning up backups older than $RETENTION_DAYS days from Google Drive..."
OLD_DIRS=$(rclone lsd "$RCLONE_REMOTE:backups/" 2>/dev/null | awk '{print $NF}' || true)
CUTOFF_DATE=$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y-%m-%d)

for dir in $OLD_DIRS; do
    if [[ "$dir" < "$CUTOFF_DATE" ]]; then
        log "    Deleting old backup: $dir"
        rclone purge "$RCLONE_REMOTE:backups/$dir" 2>/dev/null || true
    fi
done
log "    Cleanup complete"

log "[6/6] Cleaning up local temp files..."
rm -rf "$BACKUP_DIR"
log "    Local cleanup done"

END_TIME=$(date +%s)
DURATION=$(( END_TIME - START_TIME ))
DURATION_MIN=$(( DURATION / 60 ))
DURATION_SEC=$(( DURATION % 60 ))

log "============================================"
log "=== Backup completed successfully in ${DURATION_MIN}m ${DURATION_SEC}s ==="
log "============================================"

MSG="✅ **Backup completed successfully**\\n📅 Date: ${DATE_SHORT}\\n💾 Database: ${DB_SIZE}\\n📁 Files: ${FILES_SIZE}\\n⏱️ Duration: ${DURATION_MIN}m ${DURATION_SEC}s"
notify_discord 3066993 "✅ ATS Backup Success" "$MSG"
notify_email "✅ ATS Backup Success — ${DATE_SHORT}" "Backup completed successfully.\n\nDate: ${DATE_SHORT}\nDatabase: ${DB_SIZE}\nFiles: ${FILES_SIZE}\nDuration: ${DURATION_MIN}m ${DURATION_SEC}s\n\nFiles uploaded to Google Drive under: backups/${DATE_SHORT}/"
