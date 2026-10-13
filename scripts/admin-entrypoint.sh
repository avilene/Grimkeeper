#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/app/data/grimkeeper.db}"

echo "Starting Grimkeeper admin (Next.js)..."
export PORT="${ADMIN_PORT:-${PORT:-3847}}"
# Bind address only — must not be used as the public OAuth/site URL.
export HOSTNAME="${ADMIN_HOSTNAME:-${HOSTNAME:-0.0.0.0}}"
export AUTH_TRUST_HOST=true

# Auth.js reads AUTH_SECRET by default; keep ADMIN_SESSION_SECRET as the single source in .env.
if [ -z "${AUTH_SECRET:-}" ] && [ -n "${ADMIN_SESSION_SECRET:-}" ]; then
  export AUTH_SECRET="$ADMIN_SESSION_SECRET"
fi
if [ -z "${AUTH_SECRET:-}" ] && [ -z "${ADMIN_SESSION_SECRET:-}" ]; then
  echo "Warning: AUTH_SECRET / ADMIN_SESSION_SECRET unset — Discord login will fail with Configuration." >&2
fi
if [ -z "${DISCORD_CLIENT_SECRET:-}" ]; then
  echo "Warning: DISCORD_CLIENT_SECRET unset — Discord OAuth token exchange will fail." >&2
fi

# Auth.js needs the public origin when listening on 0.0.0.0 (else redirects go to 0.0.0.0).
# Always normalize to origin — a full callback path in AUTH_URL breaks basePath.
normalize_origin() {
  node -e 'try{process.stdout.write(new URL(process.argv[1]).origin)}catch{}' "$1"
}
if [ -n "${AUTH_URL:-}" ]; then
  NORMALIZED="$(normalize_origin "$AUTH_URL")"
  if [ -n "$NORMALIZED" ] && [ "$NORMALIZED" != "$AUTH_URL" ]; then
    echo "Auth.js AUTH_URL normalized to origin: $NORMALIZED (was $AUTH_URL)"
  fi
  if [ -n "$NORMALIZED" ]; then
    export AUTH_URL="$NORMALIZED"
  fi
elif [ -n "${ADMIN_OAUTH_CALLBACK_URL:-}" ]; then
  AUTH_URL="$(normalize_origin "$ADMIN_OAUTH_CALLBACK_URL")"
  if [ -n "$AUTH_URL" ]; then
    export AUTH_URL
  fi
fi
if [ -n "${AUTH_URL:-}" ]; then
  echo "Auth.js AUTH_URL=$AUTH_URL"
else
  echo "Warning: AUTH_URL / ADMIN_OAUTH_CALLBACK_URL unset — OAuth redirects may use 0.0.0.0." >&2
fi
exec node apps/admin/server.js
