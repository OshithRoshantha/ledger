#!/usr/bin/env sh
# Nightly MongoDB backup with 14-day retention. Works with Atlas (MONGO_URL) or the local-db profile.
#   crontab -e  ->  15 2 * * * /opt/ledger/deploy/backup.sh >> /var/log/ledger-backup.log 2>&1
set -eu

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-$(pwd)/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/ledger-$STAMP.archive.gz"
DB="${MONGO_DB:-ledger}"

case "${COMPOSE_PROFILES:-}" in
  *local-db*)
    docker compose exec -T mongo mongodump \
      --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" \
      --authenticationDatabase admin --db "$DB" --archive --gzip > "$FILE.partial"
    ;;
  *)
    # Atlas: run the tools in a throwaway container; the URI never touches the command history.
    docker run --rm -e MONGO_URL mongo:7.0 sh -c 'mongodump --uri "$MONGO_URL" --db '"$DB"' --archive --gzip' > "$FILE.partial"
    ;;
esac
mv "$FILE.partial" "$FILE"
chmod 600 "$FILE"

find "$BACKUP_DIR" -name 'ledger-*.archive.gz' -type f -mtime +"$RETENTION_DAYS" -delete
echo "$(date -u +%FT%TZ) backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
