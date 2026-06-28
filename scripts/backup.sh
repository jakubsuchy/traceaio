#!/usr/bin/env bash
#
# Back up the TraceAIO Postgres database to a portable, compressed dump.
#
# The app containers hold almost no state — the only thing worth backing up is
# the database (brand config, API keys, models config, all analysis data live
# in app_settings + the analysis tables). This produces a pg_dump custom-format
# archive that restores cleanly across Postgres versions and CPU architectures.
#
# Usage:
#   scripts/backup.sh [output-dir]
#
# Env overrides (defaults match docker-compose.yml):
#   DB_SERVICE  (default: db)
#   DB_USER     (default: admin)
#   DB_NAME     (default: brand_tracker)
#
# Restore with: scripts/restore.sh <dump-file>

set -euo pipefail
cd "$(dirname "$0")/.."

DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-admin}"
DB_NAME="${DB_NAME:-brand_tracker}"
OUT_DIR="${1:-backups}"

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$OUT_DIR/traceaio-$STAMP.dump"

if ! docker compose ps --status running --services | grep -qx "$DB_SERVICE"; then
  echo "Error: the '$DB_SERVICE' service is not running. Start it with: docker compose up -d $DB_SERVICE" >&2
  exit 1
fi

echo "Dumping database '$DB_NAME' ..."
# -Fc = custom format (compressed, restore with pg_restore). -T flag on exec
# disables TTY so the binary stream isn't mangled.
docker compose exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$OUT_FILE"

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "Backup written: $OUT_FILE ($SIZE)"
