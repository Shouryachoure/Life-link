#!/usr/bin/env bash
# ==============================================================================
# LifeLink India — Database Backup & Disaster Recovery Automation
# ==============================================================================
# Uses standard PostgreSQL utilities (pg_dump, pg_restore).
# Zero paid tool requirement. Runs on standard Linux / Cron.
#
# Usage:
#   Backup:  ./deploy/backup_restore.sh backup
#   Restore: ./deploy/backup_restore.sh restore /path/to/backup_file.dump
#   Verify:  ./deploy/backup_restore.sh verify /path/to/backup_file.dump
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/lifelink}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/lifelink?schema=public}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

mkdir -p "${BACKUP_DIR}"

backup() {
    local target_file="${BACKUP_DIR}/lifelink_backup_${TIMESTAMP}.dump"
    echo "[LifeLink Backup] Starting PostgreSQL compressed binary backup..."
    echo "[LifeLink Backup] Target: ${target_file}"

    # -Fc: Custom compressed binary format (supports selective restore, parallel restore, and checksums)
    # -v: Verbose progress
    pg_dump "${DATABASE_URL}" \
        --format=custom \
        --compress=9 \
        --no-owner \
        --no-privileges \
        --file="${target_file}"

    local size
    size=$(du -h "${target_file}" | cut -f1)
    echo "[LifeLink Backup] Backup completed successfully. Archive size: ${size}"

    # Prune backups older than RETENTION_DAYS
    echo "[LifeLink Backup] Pruning backups older than ${RETENTION_DAYS} days..."
    find "${BACKUP_DIR}" -name "lifelink_backup_*.dump" -type f -mtime +"${RETENTION_DAYS}" -delete
    echo "[LifeLink Backup] Retention cleanup completed."
}

verify() {
    local dump_file="${1:-}"
    if [ -z "${dump_file}" ] || [ ! -f "${dump_file}" ]; then
        echo "Error: Please specify an existing .dump file to verify."
        exit 1
    fi

    echo "[LifeLink Verify] Inspecting backup archive contents: ${dump_file}"
    pg_restore --list "${dump_file}" | head -n 30
    echo "[LifeLink Verify] Archive TOC structure is valid and readable."
}

restore() {
    local dump_file="${1:-}"
    if [ -z "${dump_file}" ] || [ ! -f "${dump_file}" ]; then
        echo "Error: Please specify an existing .dump file to restore."
        exit 1
    fi

    echo "=============================================================================="
    echo "⚠️  WARNING: DATABASE RESTORATION IN PROGRESS"
    echo "Database: ${DATABASE_URL}"
    echo "Source:   ${dump_file}"
    echo "=============================================================================="
    read -p "Type 'RESTORE' to confirm replacement of existing database tables: " confirmation

    if [ "${confirmation}" != "RESTORE" ]; then
        echo "Aborted by user."
        exit 0
    fi

    echo "[LifeLink Restore] Restoring schema and data..."
    # --clean: Drop database objects before recreating them
    # --if-exists: Use IF EXISTS when dropping objects
    # --no-owner: Do not set ownership of objects to match the original database
    pg_restore \
        --dbname="${DATABASE_URL}" \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        --verbose \
        "${dump_file}"

    echo "[LifeLink Restore] Database restoration completed successfully."
}

case "${1:-}" in
    backup)
        backup
        ;;
    verify)
        verify "${2:-}"
        ;;
    restore)
        restore "${2:-}"
        ;;
    *)
        echo "Usage: $0 {backup|verify <file>|restore <file>}"
        exit 1
        ;;
esac
