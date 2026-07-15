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
meta="source: ${title}
status: ${status}"

for line in "$@"; do
  meta="${meta}
${line}"
done

case "$status" in
  failure|error|failed) color=15548997 ;;
  success|started) color=5763719 ;;
  *) color=5793266 ;;
esac

details="$(printf '```yaml\n%s\n```' "$meta")"

build_payload() {
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg title "$title" \
      --arg details "$details" \
      --arg timestamp "$timestamp" \
      --argjson color "$color" \
      '{embeds:[{title:$title,color:$color,timestamp:$timestamp,fields:[{name:"Details",value:$details}]}]}'
    return
  fi

  escape_json() {
    printf '%s' "$1" | awk '
      {
        line = $0
        gsub(/\\/, "\\\\", line)
        gsub(/"/, "\\\"", line)
        gsub(/\t/, "\\t", line)
        gsub(/\r/, "", line)
        if (NR > 1) printf "\\n"
        printf "%s", line
      }
    '
  }

  title_escaped=$(escape_json "$title")
  details_escaped=$(escape_json "$details")
  printf '{"embeds":[{"title":"%s","color":%s,"timestamp":"%s","fields":[{"name":"Details","value":"%s"}]}]}' \
    "$title_escaped" "$color" "$timestamp" "$details_escaped"
}

payload="$(build_payload)"

response="$(curl -sS -w "\n%{http_code}" \
  -H "Authorization: Bot ${token}" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "https://discord.com/api/v10/channels/${channel}/messages")"

http_code="$(printf '%s' "$response" | tail -n 1)"
body="$(printf '%s' "$response" | sed '$d')"

if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
  echo "Discord API error ${http_code}: ${body}" >&2
  exit 1
fi

printf 'Posted %s to Discord channel %s\n' "$status" "$channel"
