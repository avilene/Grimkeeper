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
    # migrate resolve marks the migration as applied without executing its SQL.
    # Apply any schema additions that exist in the init migration but may be absent
    # from a database that was previously managed by `db push`.
    node -e "
      try {
        const db = require('./node_modules/better-sqlite3')('${DB_PATH}');
        const cols = db.prepare('PRAGMA table_info(Vote)').all();
        if (!cols.some(function(c) { return c.name === 'isPrivate'; })) {
          process.stderr.write('Patching Vote table: adding isPrivate column...\n');
          db.exec('ALTER TABLE Vote ADD COLUMN isPrivate BOOLEAN NOT NULL DEFAULT false');
          db.exec('DROP INDEX IF EXISTS Vote_nominationId_voterId_key');
          db.exec('CREATE UNIQUE INDEX IF NOT EXISTS Vote_nominationId_voterId_isPrivate_key ON Vote (nominationId, voterId, isPrivate)');
          process.stderr.write('Vote.isPrivate column added.\n');
        }
        db.close();
      } catch (e) { process.stderr.write(e.message + '\n'); process.exit(1); }
    "
  fi
fi

./node_modules/.bin/prisma migrate deploy
cd /app

echo "Starting Grimkeeper bot..."
exec node --import /app/apps/bot/dist/instrument.js /app/apps/bot/dist/index.js
