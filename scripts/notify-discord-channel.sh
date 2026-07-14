#!/usr/bin/env sh
# Post to ERROR_CHANNEL_ID using DISCORD_TOKEN (CI or local — no webhook required).
# Usage: notify-discord-channel.sh <title> <status> [extra yaml lines...]
set -eu

title="$1"
status="$2"
shift 2 || true

token="${DISCORD_TOKEN:-}"
channel="${ERROR_CHANNEL_ID:-}"

if [ -z "$token" ] || [ -z "$channel" ]; then
  echo "DISCORD_TOKEN and ERROR_CHANNEL_ID not configured; skipping."
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

escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

meta_escaped=$(escape_json "$meta")
title_escaped=$(escape_json "$title")

payload=$(cat <<EOF
{"content":"**${title_escaped}**\n\`\`\`yaml\n${meta_escaped}\n\`\`\`"}
EOF
)

curl -fsS \
  -H "Authorization: Bot ${token}" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "https://discord.com/api/v10/channels/${channel}/messages" >/dev/null

printf 'Posted %s to Discord channel %s\n' "$status" "$channel"
