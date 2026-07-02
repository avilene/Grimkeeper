#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/app/data/grimkeeper.db}"

echo "Applying database schema..."
pnpm --filter @grimkeeper/database db:push

echo "Starting Grimkeeper bot..."
exec node apps/bot/dist/index.js
