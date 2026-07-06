#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/app/data/grimkeeper.db}"

echo "Applying database schema..."
cd /app/packages/database
./node_modules/.bin/prisma db push

echo "Starting Grimkeeper bot (BOT_MODE=${BOT_MODE:-full})..."
exec node /app/apps/bot/dist/index.js
