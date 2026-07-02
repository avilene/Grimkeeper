#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/app/data/grimkeeper.db}"

echo "Applying database schema..."
node ./packages/database/node_modules/prisma/build/index.js db push --schema=./packages/database/prisma/schema.prisma

echo "Starting Grimkeeper bot..."
exec node apps/bot/dist/index.js
