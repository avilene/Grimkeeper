#!/usr/bin/env sh
# Pull GRIMKEEPER_IMAGE and restart the bot container (droplet / webhook / watcher).
set -eu

cd "$(dirname "$0")/.."

trigger="${1:-unknown}"

if [ -f .env ]; then
  GRIMKEEPER_IMAGE=$(grep -E '^GRIMKEEPER_IMAGE=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export GRIMKEEPER_IMAGE
fi

if [ -z "${GRIMKEEPER_IMAGE:-}" ]; then
  echo "Set GRIMKEEPER_IMAGE in .env before redeploying." >&2
  exit 1
fi

printf '[%s] [redeploy] Pulling %s (trigger=%s)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$GRIMKEEPER_IMAGE" "$trigger"
docker compose pull bot
DEPLOY_TRIGGER="$trigger" docker compose up -d --no-build --force-recreate bot
docker compose ps bot
printf '[%s] [redeploy] Complete\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
