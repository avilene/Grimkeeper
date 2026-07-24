#!/usr/bin/env sh
# Pull GRIMKEEPER_IMAGE (+ ADMIN_IMAGE when the admin compose profile is on) and restart.
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

# Derive ghcr.io/.../Grimkeeper-admin:tag from ghcr.io/.../Grimkeeper:tag when unset.
derive_admin_image() {
  image="$1"
  case "$image" in
    *:*)
      base="${image%:*}"
      tag="${image##*:}"
      printf '%s-admin:%s\n' "$base" "$tag"
      ;;
    *)
      printf '%s-admin\n' "$image"
      ;;
  esac
}

if [ -f .env ]; then
  GRIMKEEPER_IMAGE=$(grep -E '^GRIMKEEPER_IMAGE=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export GRIMKEEPER_IMAGE
  ADMIN_IMAGE=$(grep -E '^ADMIN_IMAGE=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export ADMIN_IMAGE
fi

if [ -z "${GRIMKEEPER_IMAGE:-}" ]; then
  notify_failure "GRIMKEEPER_IMAGE is not set in .env"
  echo "Set GRIMKEEPER_IMAGE in .env before redeploying." >&2
  exit 1
fi

# Compose loads COMPOSE_PROFILES from .env — include admin when that profile is enabled.
services="bot"
if docker compose config --services 2>/dev/null | grep -qx admin; then
  services="bot admin"
  if [ -z "${ADMIN_IMAGE:-}" ]; then
    ADMIN_IMAGE="$(derive_admin_image "$GRIMKEEPER_IMAGE")"
    export ADMIN_IMAGE
  fi
fi

printf '[%s] [redeploy] Pulling bot=%s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$GRIMKEEPER_IMAGE"
if [ "$services" = "bot admin" ]; then
  printf ' admin=%s' "$ADMIN_IMAGE"
fi
printf ' (trigger=%s)\n' "$trigger"

# shellcheck disable=SC2086
if ! docker compose pull $services; then
  notify_failure "docker compose pull failed — run docker login ghcr.io on the droplet"
  echo "docker compose pull failed" >&2
  exit 1
fi

# shellcheck disable=SC2086
if ! DEPLOY_TRIGGER="$trigger" docker compose up -d --no-build --force-recreate $services; then
  notify_failure "docker compose up failed"
  echo "docker compose up failed" >&2
  exit 1
fi

# shellcheck disable=SC2086
docker compose ps $services

if [ -f ./scripts/docker-cleanup.sh ]; then
  sh ./scripts/docker-cleanup.sh || true
fi

printf '[%s] [redeploy] Complete\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
