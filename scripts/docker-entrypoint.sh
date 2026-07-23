#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/app/data/grimkeeper.db}"

echo "Applying database schema..."
cd /app/packages/database
./node_modules/.bin/prisma db push --accept-data-loss

echo "Starting Grimkeeper bot..."
exec node --import /app/apps/bot/dist/instrument.js /app/apps/bot/dist/index.js
