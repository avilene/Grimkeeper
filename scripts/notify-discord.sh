#!/usr/bin/env sh
# Post a build/deploy notification to Discord (optional webhook).
# Usage: notify-discord.sh <title> <status> [extra yaml lines...]
set -e

title="$1"
status="$2"
shift 2 || true

webhook="${DISCORD_BUILD_WEBHOOK_URL:-${DISCORD_DEPLOY_WEBHOOK_URL:-}}"
if [ -z "$webhook" ]; then
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl required for Discord notifications" >&2
  exit 0
fi

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
meta="time: ${timestamp}
status: ${status}"

for line in "$@"; do
  meta="${meta}
${line}"
done

# Escape for JSON string (minimal — webhook content only).
escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

meta_escaped=$(escape_json "$meta")
title_escaped=$(escape_json "$title")

payload=$(cat <<EOF
{"content":"**${title_escaped}**\n\`\`\`yaml\n${meta_escaped}\n\`\`\`"}
EOF
)

curl -fsS -H "Content-Type: application/json" -d "$payload" "$webhook" >/dev/null
