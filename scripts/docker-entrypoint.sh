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
    echo "Starting Grimkeeper admin (Next.js)..."
    cd /app/admin-standalone
    export PORT="${ADMIN_PORT:-3847}"
    export HOSTNAME="${ADMIN_HOSTNAME:-0.0.0.0}"
    export AUTH_TRUST_HOST=true
    exec node apps/admin/server.js
    ;;
  bot|*)
    echo "Starting Grimkeeper bot..."
    exec node --import /app/apps/bot/dist/instrument.js /app/apps/bot/dist/index.js
    ;;
esac
