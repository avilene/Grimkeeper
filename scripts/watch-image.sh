#!/usr/bin/env sh
# Poll GHCR (or any registry) for a new image digest and optionally redeploy.
set -e

cd "$(dirname "$0")/.."

INTERVAL="${IMAGE_WATCH_INTERVAL:-300}"
AUTO_REDEPLOY="${AUTO_REDEPLOY:-false}"
DIGEST_FILE=".deploy/image-digest"
ONCE="${WATCH_ONCE:-false}"

if [ -f .env ]; then
  GRIMKEEPER_IMAGE=$(grep -E '^GRIMKEEPER_IMAGE=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export GRIMKEEPER_IMAGE
  # shellcheck disable=SC1091
  set -a
  . ./.env 2>/dev/null || true
  set +a
fi

if [ -z "$GRIMKEEPER_IMAGE" ]; then
  echo "Set GRIMKEEPER_IMAGE in .env to watch for new builds." >&2
  exit 1
fi

mkdir -p .deploy

watch_log() {
  printf '[%s] [watch] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

image_digest() {
  if command -v jq >/dev/null 2>&1; then
    docker manifest inspect "$GRIMKEEPER_IMAGE" 2>/dev/null | jq -r '
      if .manifests then
        (.manifests | map(.digest) | sort | join(","))
      else
        .config.digest // .Descriptor.digest // empty
      end
    ' | head -1
    return
  fi

  docker manifest inspect "$GRIMKEEPER_IMAGE" 2>/dev/null | grep -m1 '"digest"' | sed 's/.*"digest": *"\([^"]*\)".*/\1/'
}

notify_new_build() {
  previous="$1"
  current="$2"
  export DISCORD_BUILD_WEBHOOK_URL DISCORD_DEPLOY_WEBHOOK_URL
  sh scripts/notify-discord.sh "Grimkeeper image updated" "new digest" \
    "image: ${GRIMKEEPER_IMAGE}" \
    "digest: ${current}" \
    "previous: ${previous:-none}" \
    "autoRedeploy: ${AUTO_REDEPLOY}" || true
}

handle_digest() {
  current="$1"
  previous="$(cat "$DIGEST_FILE" 2>/dev/null || true)"

  if [ -z "$current" ]; then
    watch_log "Could not read manifest for $GRIMKEEPER_IMAGE (docker login ghcr.io?)" >&2
    return 1
  fi

  if [ "$current" = "$previous" ]; then
    watch_log "No change ($current)"
    return 0
  fi

  watch_log "New digest: $current (was: ${previous:-none})"
  printf '%s' "$current" > "$DIGEST_FILE"

  if [ -n "$previous" ]; then
    notify_new_build "$previous" "$current"
    if [ "$AUTO_REDEPLOY" = "true" ]; then
      watch_log "Auto-redeploying..."
      sh scripts/redeploy-bot.sh auto
      watch_log "Redeploy complete"
    fi
  else
    watch_log "Baseline digest recorded."
  fi
}

check_once() {
  digest="$(image_digest || true)"
  handle_digest "$digest" || true
}

watch_log "Image: $GRIMKEEPER_IMAGE (every ${INTERVAL}s, autoRedeploy=${AUTO_REDEPLOY})"

if [ "$ONCE" = "true" ]; then
  check_once
  exit 0
fi

while true; do
  check_once
  watch_log "Next check in ${INTERVAL}s"
  sleep "$INTERVAL"
done
