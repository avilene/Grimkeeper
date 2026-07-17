/** Discord custom IDs max 100 chars. UUIDs contain `-` (and legacy ids used `:`), so never split on those. */
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function encodeIdPair(left: string, right: string): string {
  return `${left}.${right}`;
}

/** Pull the first two UUIDs from a custom_id payload (tolerates `.` `|` `:` and trailing nonces). */
export function parseIdPair(value: string): { left: string; right: string } | null {
  const matches = value.match(UUID_RE);
  if (!matches || matches.length < 2) return null;
  return { left: matches[0]!.toLowerCase(), right: matches[1]!.toLowerCase() };
}
