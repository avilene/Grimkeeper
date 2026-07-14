#!/usr/bin/env sh
# POST a signed deploy webhook (used by GitHub Actions or manual testing).
set -eu

url="${DEPLOY_WEBHOOK_URL:-}"
secret="${DEPLOY_WEBHOOK_SECRET:-}"
sha="${1:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"

if [ -z "$url" ] || [ -z "$secret" ]; then
  echo "Set DEPLOY_WEBHOOK_URL and DEPLOY_WEBHOOK_SECRET." >&2
  exit 1
fi

body=$(printf '{"event":"docker-push","ref":"refs/heads/main","sha":"%s"}' "$sha")
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$secret" | awk '{print $2}')

curl -fsS -X POST "$url" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$sig" \
  -d "$body"

printf '\nDeploy webhook sent to %s\n' "$url"
