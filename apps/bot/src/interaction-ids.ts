/** Discord custom IDs are max 100 chars; UUIDs contain `:`, so never split game/nomination on `:`. */
const ID_PAIR_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[|:]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function encodeIdPair(left: string, right: string): string {
  return `${left}|${right}`;
}

export function parseIdPair(value: string): { left: string; right: string } | null {
  const match = value.match(ID_PAIR_RE);
  if (!match) return null;
  return { left: match[1]!, right: match[2]! };
}
