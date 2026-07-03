#!/usr/bin/env sh
set -e

cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
Usage: scripts/docker.sh <command>

Commands:
  redeploy   Rebuild and restart containers (default; no docker compose down)
  restart    Quick restart without rebuilding
  logs       Follow container logs (optional service name)
  fresh      docker compose down, then up --build (full reset)
  clean-cache  Clear Docker build cache (fixes stale/corrupt pnpm store)

Examples:
  pnpm docker:redeploy
  pnpm docker:restart
  pnpm docker:logs
  pnpm docker:fresh
  pnpm docker:clean-cache
EOF
}

cmd="${1:-redeploy}"

case "$cmd" in
  redeploy|up)
    export DOCKER_BUILDKIT=1
    export COMPOSE_DOCKER_CLI_BUILD=1
    docker compose up -d --build
    docker compose ps
    ;;
  restart)
    docker compose restart
    docker compose ps
    ;;
  logs)
    docker compose logs -f "${2:-bot}"
    ;;
  fresh)
    export DOCKER_BUILDKIT=1
    export COMPOSE_DOCKER_CLI_BUILD=1
    docker compose down
    docker compose up -d --build
    docker compose ps
    ;;
  clean-cache)
    export DOCKER_BUILDKIT=1
    docker builder prune -f
    echo "Build cache cleared. Run pnpm docker:redeploy to rebuild."
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
