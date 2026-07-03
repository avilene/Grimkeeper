#!/usr/bin/env sh
set -e

cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
Usage: scripts/docker.sh <command>

Commands:
  redeploy   Rebuild and restart containers (default)
  restart    Restart without rebuilding (fast — use for .env changes)
  logs       Follow container logs (optional service name)
  fresh      docker compose down, then up --build

Examples:
  pnpm docker:redeploy
  pnpm docker:restart
  pnpm docker:logs
  pnpm docker:fresh
EOF
}

cmd="${1:-redeploy}"

case "$cmd" in
  redeploy|up)
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
    docker compose down
    docker compose up -d --build
    docker compose ps
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
