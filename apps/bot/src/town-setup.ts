const USER_MENTION = /<@!?(\d{17,20})>/g;

/** Parse Discord user mentions from a slash-command string, preserving order. */
export function parseUserMentionsFromString(input: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of input.matchAll(USER_MENTION)) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
