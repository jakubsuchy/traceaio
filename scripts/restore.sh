#!/usr/bin/env bash
#
# Restore a TraceAIO Postgres database from a dump produced by scripts/backup.sh.
#
# This OVERWRITES the current database contents (--clean --if-exists drops and
# recreates objects). On a fresh target host the usual flow is:
#   1. docker compose up -d db        # bring up just Postgres
#   2. scripts/restore.sh <dump>      # load the data
#   3. docker compose up -d           # start the app
#
# Usage:
#   scripts/restore.sh <dump-file> [--yes]
#
# Env overrides (defaults match docker-compose.yml):
#   DB_SERVICE  (default: db)
#   DB_USER     (default: admin)
#   DB_NAME     (default: brand_tracker)

set -euo pipefail
cd "$(dirname "$0")/.."

DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-admin}"
DB_NAME="${DB_NAME:-brand_tracker}"

DUMP_FILE="${1:-}"
ASSUME_YES="${2:-}"

if [[ -z "$DUMP_FILE" ]]; then
  echo "Usage: scripts/restore.sh <dump-file> [--yes]" >&2
  exit 1
fi
if [[ ! -f "$DUMP_FILE" ]]; then
  echo "Error: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

if ! docker compose ps --status running --services | grep -qx "$DB_SERVICE"; then
  echo "Error: the '$DB_SERVICE' service is not running. Start it with: docker compose up -d $DB_SERVICE" >&2
  exit 1
fi

if [[ "$ASSUME_YES" != "--yes" ]]; then
  echo "WARNING: this will OVERWRITE the contents of database '$DB_NAME'."
  read -r -p "Continue? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

echo "Restoring '$DB_NAME' from $DUMP_FILE ..."
# --clean --if-exists makes the restore idempotent over an existing DB.
# --no-owner avoids failing on role mismatches between hosts.
docker compose exec -T "$DB_SERVICE" \
  pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner < "$DUMP_FILE"

echo "Restore complete."
