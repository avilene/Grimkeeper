#!/usr/bin/env sh
# Wipe the SQLite database (all games, events, reminders).
# Usage:
#   pnpm db:wipe                         # local file DB
#   docker compose exec bot sh /app/scripts/wipe-db.sh   # in container (if mounted)
#   Or on droplet:
#     docker compose stop bot
#     docker compose run --rm --entrypoint sh bot -c 'rm -f /app/data/grimkeeper.db*'
#     docker compose up -d bot
set -eu

cd "$(dirname "$0")/.."

if [ -n "${DATABASE_URL:-}" ]; then
  url="$DATABASE_URL"
else
  url="file:./packages/database/prisma/dev.db"
fi

case "$url" in
  file:*)
    path="${url#file:}"
    # Relative paths in Docker often resolve under /app
    if [ ! -f "$path" ] && [ -f "/app/data/grimkeeper.db" ]; then
      path="/app/data/grimkeeper.db"
    fi
    ;;
  *)
    echo "Only SQLite file: URLs are supported (got: $url)" >&2
    exit 1
    ;;
esac

echo "Wiping database at: $path"
rm -f "$path" "$path-journal" "$path-wal" "$path-shm"
echo "Deleted. Restart the bot (or wait for entrypoint) so prisma db push recreates the schema."
