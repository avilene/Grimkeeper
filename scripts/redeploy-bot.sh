#!/usr/bin/env sh
# Pull GRIMKEEPER_IMAGE and restart the bot container (droplet / webhook / watcher).
set -eu

cd "$(dirname "$0")/.."

trigger="${1:-unknown}"

notify_failure() {
  message="$1"
  if [ -f ./scripts/notify-discord-channel.sh ]; then
    sh ./scripts/notify-discord-channel.sh "Grimkeeper redeploy failed" "failure" \
      "trigger: ${trigger}" \
      "message: ${message}" \
      2>/dev/null || true
  fi
}

if [ -f .env ]; then
  GRIMKEEPER_IMAGE=$(grep -E '^GRIMKEEPER_IMAGE=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export GRIMKEEPER_IMAGE
fi

if [ -z "${GRIMKEEPER_IMAGE:-}" ]; then
  notify_failure "GRIMKEEPER_IMAGE is not set in .env"
  echo "Set GRIMKEEPER_IMAGE in .env before redeploying." >&2
  exit 1
fi

printf '[%s] [redeploy] Pulling %s (trigger=%s)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$GRIMKEEPER_IMAGE" "$trigger"

if ! docker compose pull bot; then
  notify_failure "docker compose pull failed — run docker login ghcr.io on the droplet"
  echo "docker compose pull failed" >&2
  exit 1
fi

if ! DEPLOY_TRIGGER="$trigger" docker compose up -d --no-build --force-recreate bot; then
  notify_failure "docker compose up failed"
  echo "docker compose up failed" >&2
  exit 1
fi

docker compose ps bot
printf '[%s] [redeploy] Complete\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
