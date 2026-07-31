#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/app/data/grimkeeper.db}"
DB_PATH="${DATABASE_URL#file:}"

echo "Applying database migrations..."
cd /app/packages/database

# If the database file already exists but has no migration history, Prisma will
# refuse to deploy with P3005.  Baseline the initial migration so that
# `migrate deploy` can proceed without touching the existing schema.
if [ -f "$DB_PATH" ]; then
  HAS_MIGRATIONS=$(node -e "
    try {
      const db = require('./node_modules/better-sqlite3')('${DB_PATH}');
      const row = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'\").get();
      db.close();
      process.stdout.write(row ? 'yes' : 'no');
    } catch (e) { process.stdout.write('unknown'); }
  ")
  if [ "$HAS_MIGRATIONS" = "no" ]; then
    echo "Existing database has no migration history — baselining init migration..."
    ./node_modules/.bin/prisma migrate resolve --applied "20260731063241_init"
  fi
fi

./node_modules/.bin/prisma migrate deploy
cd /app

echo "Starting Grimkeeper bot..."
exec node --import /app/apps/bot/dist/instrument.js /app/apps/bot/dist/index.js
