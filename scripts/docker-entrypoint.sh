#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/app/data/grimkeeper.db}"

service="${GRIMKEEPER_SERVICE:-bot}"

# Only the bot migrates the shared SQLite volume (avoids concurrent prisma db push).
if [ "$service" = "bot" ]; then
  echo "Applying database schema..."
  cd /app/packages/database
  ./node_modules/.bin/prisma db push --accept-data-loss
  cd /app
fi

case "$service" in
  admin)
    echo "Starting Grimkeeper admin..."
    exec node --import /app/apps/admin/dist/instrument.js /app/apps/admin/dist/index.js
    ;;
  bot|*)
    echo "Starting Grimkeeper bot..."
    exec node --import /app/apps/bot/dist/instrument.js /app/apps/bot/dist/index.js
    ;;
esac
