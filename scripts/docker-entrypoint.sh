#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/app/data/grimkeeper.db}"

service="${GRIMKEEPER_SERVICE:-bot}"

# Only the bot migrates the shared SQLite volume (avoids concurrent prisma db push).
if [ "$service" = "bot" ]; then
  echo "Applying database schema..."
  cd /app/packages/database
  ./node_modules/.bin/prisma db push --accept-data-loss
  cd /app
fi

case "$service" in
  admin)
    echo "Starting Grimkeeper admin (Next.js)..."
    cd /app/admin-standalone
    export PORT="${ADMIN_PORT:-3847}"
    # Bind address only — must not be used as the public OAuth/site URL.
    export HOSTNAME="${ADMIN_HOSTNAME:-0.0.0.0}"
    export AUTH_TRUST_HOST=true
    # Auth.js needs the public origin when listening on 0.0.0.0 (else redirects go to 0.0.0.0).
    if [ -z "${AUTH_URL:-}" ] && [ -n "${ADMIN_OAUTH_CALLBACK_URL:-}" ]; then
      AUTH_URL="$(
        node -e 'try{process.stdout.write(new URL(process.env.ADMIN_OAUTH_CALLBACK_URL).origin)}catch{}'
      )"
      if [ -n "$AUTH_URL" ]; then
        export AUTH_URL
        echo "Auth.js AUTH_URL=$AUTH_URL"
      fi
    fi
    if [ -z "${AUTH_URL:-}" ]; then
      echo "Warning: AUTH_URL / ADMIN_OAUTH_CALLBACK_URL unset — OAuth redirects may use 0.0.0.0." >&2
    fi
    exec node apps/admin/server.js
    ;;
  bot|*)
    echo "Starting Grimkeeper bot..."
    exec node --import /app/apps/bot/dist/instrument.js /app/apps/bot/dist/index.js
    ;;
esac
