#!/usr/bin/env sh
# Prune unused Docker data on the droplet (safe defaults — never removes named volumes).
set -eu

if [ "${DOCKER_CLEANUP:-1}" = "0" ] || [ "${DOCKER_CLEANUP:-1}" = "false" ]; then
  printf '[%s] [docker-cleanup] Skipped (DOCKER_CLEANUP=%s)\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${DOCKER_CLEANUP:-1}"
  exit 0
fi

until="${DOCKER_PRUNE_UNTIL:-72h}"
builder_until="${DOCKER_BUILDER_PRUNE_UNTIL:-168h}"

log() {
  printf '[%s] [docker-cleanup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"
}

if ! command -v docker >/dev/null 2>&1; then
  log "docker not found — skipping"
  exit 0
fi

log "Disk before:"
df -h / 2>/dev/null | tail -1 || true
docker system df 2>/dev/null || true

log "Pruning stopped containers"
docker container prune -f >/dev/null 2>&1 || true

log "Pruning dangling images"
docker image prune -f >/dev/null 2>&1 || true

log "Pruning unused images older than ${until}"
docker image prune -af --filter "until=${until}" 2>&1 || true

if [ "${DOCKER_PRUNE_BUILDER:-1}" != "0" ] && [ "${DOCKER_PRUNE_BUILDER:-1}" != "false" ]; then
  log "Pruning build cache older than ${builder_until}"
  docker builder prune -af --filter "until=${builder_until}" 2>&1 || true
fi

if [ "${DOCKER_PRUNE_VOLUMES:-0}" = "1" ] || [ "${DOCKER_PRUNE_VOLUMES:-0}" = "true" ]; then
  log "Pruning unused volumes (DOCKER_PRUNE_VOLUMES enabled)"
  docker volume prune -f 2>&1 || true
fi

log "Disk after:"
df -h / 2>/dev/null | tail -1 || true
docker system df 2>/dev/null || true
log "Complete"
