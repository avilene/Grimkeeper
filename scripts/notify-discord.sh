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

escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

title_escaped=$(escape_json "$title")
details_value=$(escape_json "$(printf '```yaml\n%s\n```' "$meta")")

payload=$(cat <<EOF
{"embeds":[{"title":"${title_escaped}","color":${color},"timestamp":"${timestamp}","fields":[{"name":"Details","value":"${details_value}"}]}]}
EOF
)

curl -fsS -H "Content-Type: application/json" -d "$payload" "$webhook" >/dev/null
