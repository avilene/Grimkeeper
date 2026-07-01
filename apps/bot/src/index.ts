import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import "reflect-metadata";
import { IntentsBitField } from "discord.js";
import { Client } from "discordx";

import { GameCommands } from "./commands/game.js";

void GameCommands;

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN is required. Copy .env.example to .env and fill it in.");
}

const client = new Client({
  botId: process.env.DISCORD_CLIENT_ID,
  intents: [IntentsBitField.Flags.Guilds],
  silent: false,
  simpleCommand: {
    prefix: "!",
  },
});

client.once("ready", async () => {
  await client.initApplicationCommands();
  console.log(`Grimkeeper logged in as ${client.user?.tag}`);
});

client.on("interactionCreate", (interaction) => {
  void client.executeInteraction(interaction);
});

await client.login(token);
