import type { Client } from "discord.js";

let botClient: Client | null = null;

export function setBotClient(client: Client): void {
  botClient = client;
}

export function getBotClient(): Client | null {
  return botClient;
}
