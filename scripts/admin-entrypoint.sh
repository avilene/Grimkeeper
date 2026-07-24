#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/app/data/grimkeeper.db}"

echo "Starting Grimkeeper admin (Next.js)..."
export PORT="${ADMIN_PORT:-${PORT:-3847}}"
# Bind address only — must not be used as the public OAuth/site URL.
export HOSTNAME="${ADMIN_HOSTNAME:-${HOSTNAME:-0.0.0.0}}"
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
