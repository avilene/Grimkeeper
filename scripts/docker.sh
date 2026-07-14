#!/usr/bin/env sh
set -e

cd "$(dirname "$0")/.."

LOCKFILE=pnpm-lock.yaml
HASH_FILE=.deploy/lockfile-hash

# Load GRIMKEEPER_IMAGE from .env if set (pull deploy — no pnpm install on droplet).
if [ -f .env ]; then
  GRIMKEEPER_IMAGE=$(grep -E '^GRIMKEEPER_IMAGE=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export GRIMKEEPER_IMAGE
fi

lockfile_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$LOCKFILE" | awk '{print $1}'
  else
    shasum -a 256 "$LOCKFILE" | awk '{print $1}'
  fi
}

lockfile_changed() {
  mkdir -p .deploy
  current=$(lockfile_hash)
  previous=$(cat "$HASH_FILE" 2>/dev/null || true)
  [ "$current" != "$previous" ]
}

record_lockfile_hash() {
  mkdir -p .deploy
  lockfile_hash > "$HASH_FILE"
}

usage() {
  cat <<'EOF'
Usage: scripts/docker.sh <command>

Commands:
  redeploy   Pull pre-built image (if GRIMKEEPER_IMAGE in .env) or build locally
  restart    Restart containers without rebuilding (.env changes)
  logs       Follow container logs (optional service name)
  fresh      Force local rebuild including pnpm install (slow on droplet)

Droplet setup (recommended — skips pnpm install on server):
  1. Push to main → GitHub Actions builds the image
  2. In .env: GRIMKEEPER_IMAGE=ghcr.io/YOUR_USER/Grimkeeper:latest
  3. docker login ghcr.io -u YOUR_USER
  4. pnpm docker:redeploy

Build notifications:
  - GitHub repo secret: DISCORD_BUILD_WEBHOOK_URL (Discord channel webhook)
  - Each push to main posts build success/failure to that channel

Auto-deploy when GHCR :latest changes:
  - pnpm docker:watch              # poll every 5m, notify only
  - AUTO_REDEPLOY=true pnpm docker:watch
  - docker compose --profile deploy up -d watcher   # background on droplet

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
    if [ -n "$GRIMKEEPER_IMAGE" ]; then
      echo "Pulling $GRIMKEEPER_IMAGE (no build on this machine)..."
      docker compose pull bot
      DEPLOY_TRIGGER=manual docker compose up -d --no-build
    else
      if lockfile_changed; then
        echo "Lockfile changed — running pnpm install during build."
      else
        echo "Lockfile unchanged — reusing cached deps layer (compile only)."
      fi
      echo "Building locally (set GRIMKEEPER_IMAGE in .env to skip this on droplet)..."
      docker compose build bot
      record_lockfile_hash
      DEPLOY_TRIGGER=manual docker compose up -d
    fi
    docker compose ps
    ;;
  restart)
    DEPLOY_TRIGGER=restart docker compose up -d --no-build bot
    docker compose ps
    ;;
  logs)
    docker compose logs -f "${2:-bot}"
    ;;
  fresh)
    echo "Force full local rebuild (pnpm install + compile)..."
    docker compose build --no-cache bot
    record_lockfile_hash
    DEPLOY_TRIGGER=manual docker compose up -d
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
