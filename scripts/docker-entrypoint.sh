#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/app/data/grimkeeper.db}"

echo "Applying database schema..."
cd packages/database
node ../../node_modules/prisma/build/index.js db push
cd ../..

echo "Starting Grimkeeper bot..."
exec node apps/bot/dist/index.js
