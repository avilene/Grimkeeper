#!/usr/bin/env sh
set -e

cd "$(dirname "$0")/.."

LOCKFILE=pnpm-lock.yaml
HASH_FILE=.deploy/lockfile-hash

# Load image tags from .env if set (pull deploy — no pnpm install on droplet).
if [ -f .env ]; then
  GRIMKEEPER_IMAGE=$(grep -E '^GRIMKEEPER_IMAGE=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export GRIMKEEPER_IMAGE
  ADMIN_IMAGE=$(grep -E '^ADMIN_IMAGE=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export ADMIN_IMAGE
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
  cleanup    Prune unused Docker images/containers (see DOCKER_* in .env)
  logs       Follow container logs (optional service name)
  fresh      Force local rebuild including pnpm install (slow on droplet)

Droplet setup (recommended — skips pnpm install on server):
  1. Push to main → GitHub Actions builds the bot image (and admin when apps/admin or packages change)
  2. In .env: GRIMKEEPER_IMAGE=ghcr.io/YOUR_USER/Grimkeeper:latest
  3. docker login ghcr.io -u YOUR_USER
  4. pnpm docker:redeploy

Admin UI on the droplet (optional compose profile — separate image):
  1. Discord OAuth2 redirect: https://YOUR_HOST/api/auth/callback/discord (or http://IP:3847/...)
  2. In .env: COMPOSE_PROFILES=admin (and OAuth / ADMIN_IDS — see apps/admin/README.md)
  3. Optional: ADMIN_IMAGE=ghcr.io/YOUR_USER/Grimkeeper-admin:latest
     (defaults to GRIMKEEPER_IMAGE with -admin before the tag)
  4. pnpm docker:redeploy   # recreates bot + admin from their images
  5. Open http://YOUR_DROPLET:3847
  6. HTTPS on a domain: set COMPOSE_PROFILES=admin,proxy and ADMIN_DOMAIN=your.domain,
     open ports 80/443, then redeploy (Caddy → admin:3847; see apps/admin/README.md)

Build notifications:
  - GitHub repo secret: DISCORD_BUILD_WEBHOOK_URL (Discord channel webhook)
  - Each push to main posts build success/failure to that channel

Auto-deploy after GitHub Actions build (shared webhook — Grimkeeper + Koi):
  1. In .env: DEPLOY_WEBHOOK_SECRET=<random>
  2. In .env: DEPLOY_HOOK_IMAGE=ghcr.io/YOUR_USER/Grimkeeper-deploy-hook:latest
  3. In .env: KOI_REPO_DIR=/path/to/koi-discord   # sibling checkout on the droplet
  4. docker login ghcr.io -u YOUR_USER   # on the droplet (credentials used by deploy-hook)
  5. docker compose --profile deploy pull deploy-hook && docker compose --profile deploy up -d deploy-hook
     (CI only rebuilds deploy-hook when ops/deploy-hook/ changes; redeploy scripts are mounted from the repos)
  6. Grimkeeper GitHub secrets: DEPLOY_WEBHOOK_SECRET, DEPLOY_WEBHOOK_URL=http://DROPLET:9000/hooks/redeploy
  7. Koi GitHub secrets:        DEPLOY_WEBHOOK_SECRET (same), DEPLOY_WEBHOOK_URL=http://DROPLET:9000/hooks/redeploy-koi
  8. Open port 9000 (or put nginx in front with TLS)

Docker disk cleanup (runs automatically after each redeploy):
  - DOCKER_CLEANUP=1          # set 0 to disable (default: on)
  - DOCKER_PRUNE_UNTIL=72h    # drop unused images older than this
  - DOCKER_PRUNE_VOLUMES=0    # set 1 to also prune unused volumes (off by default)
  - Manual: pnpm docker:cleanup

Legacy poll-based deploy (if you cannot expose a webhook port):
  - pnpm docker:watch
  - AUTO_REDEPLOY=true pnpm docker:watch

Examples:
  pnpm docker:redeploy
  pnpm docker:cleanup
  pnpm docker:restart
  pnpm docker:logs
  pnpm docker:fresh
EOF
}

cmd="${1:-redeploy}"

case "$cmd" in
  redeploy|up)
    if [ -n "$GRIMKEEPER_IMAGE" ]; then
      sh scripts/redeploy-bot.sh manual
    else
      if lockfile_changed; then
        echo "Lockfile changed — running pnpm install during build."
      else
        echo "Lockfile unchanged — reusing cached deps layer (compile only)."
      fi
      echo "Building locally (set GRIMKEEPER_IMAGE in .env to skip this on droplet)..."
      export SENTRY_RELEASE="${SENTRY_RELEASE:-$(git rev-parse HEAD 2>/dev/null || true)}"
      services="bot"
      if docker compose config --services 2>/dev/null | grep -qx admin; then
        services="bot admin"
      fi
      # shellcheck disable=SC2086
      docker compose build $services
      record_lockfile_hash
      # shellcheck disable=SC2086
      DEPLOY_TRIGGER=manual docker compose up -d $services
    fi
    docker compose ps
    ;;
  restart)
    services="bot"
    if docker compose config --services 2>/dev/null | grep -qx admin; then
      services="bot admin"
    fi
    # shellcheck disable=SC2086
    DEPLOY_TRIGGER=restart docker compose up -d --no-build $services
    # shellcheck disable=SC2086
    docker compose ps $services
    ;;
  cleanup)
    sh scripts/docker-cleanup.sh
    ;;
  logs)
    docker compose logs -f "${2:-bot}"
    ;;
  fresh)
    echo "Force full local rebuild (pnpm install + compile)..."
    export SENTRY_RELEASE="${SENTRY_RELEASE:-$(git rev-parse HEAD 2>/dev/null || true)}"
    services="bot"
    if docker compose config --services 2>/dev/null | grep -qx admin; then
      services="bot admin"
    fi
    # shellcheck disable=SC2086
    docker compose build --no-cache $services
    record_lockfile_hash
    # shellcheck disable=SC2086
    DEPLOY_TRIGGER=manual docker compose up -d $services
    # shellcheck disable=SC2086
    docker compose ps $services
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
