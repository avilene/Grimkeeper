export function discordTimestamp(date: Date, style: "R" | "F" | "t" = "R"): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export function buildReminderFireContent(
  playerPing: string | null,
  message: string,
  fireAt: Date,
): string {
  const when = discordTimestamp(fireAt, "t");
  const body = `⏰ ${message.trim()} (${when})`;
  return playerPing ? `${playerPing} ${body}` : body;
}
