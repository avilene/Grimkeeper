import { EmbedBuilder } from "discord.js";

import { GAME_LOBBY_ACTIONS, PLAYER_DAY_ACTIONS, ST_DO_ACTIONS, type DoAction } from "./action-catalog.js";

const GUIDE_COLOR = 0x5865f2;
const FIELD_VALUE_LIMIT = 1024;

function cmd(name: string, description: string): string {
  return `**${name}**\n${description}`;
}

function formatDoAction(action: DoAction, prefix: string): string {
  const command = prefix ? `${prefix} ${action.name}` : `/${action.name}`;
  const needs = action.needs?.length
    ? ` Needs ${action.needs.map((need) => `\`${need}\``).join(", ")}.`
    : "";
  return `**${command}**\n${action.description}.${needs}`;
}

/** Split catalog entries into embed fields that stay under Discord's 1024-char limit. */
function doActionFields(
  catalog: DoAction[],
  prefix: string,
  baseName: string,
): { name: string; value: string }[] {
  const lines = catalog.map((action) => formatDoAction(action, prefix));
  const fields: { name: string; value: string }[] = [];
  let chunk: string[] = [];
  let chunkLen = 0;

  const flush = () => {
    if (chunk.length === 0) return;
    const index = fields.length;
    fields.push({
      name: index === 0 ? baseName : `${baseName} (cont. ${index})`,
      value: chunk.join("\n\n"),
    });
    chunk = [];
    chunkLen = 0;
  };

  for (const line of lines) {
    const added = chunkLen === 0 ? line.length : chunkLen + 2 + line.length;
    if (chunk.length > 0 && added > FIELD_VALUE_LIMIT) {
      flush();
    }
    chunk.push(line);
    chunkLen = chunkLen === 0 ? line.length : chunkLen + 2 + line.length;
  }
  flush();

  return fields;
}

export function buildGameHelpEmbeds(): EmbedBuilder[] {
  return [
    new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("Player commands")
      .setDescription(
        [
          "Day play uses top-level slash commands — not `/game …`.",
          "**`/nominate`** · **`/defend`** · **`/vote`** · **`/roster`** · **`/alias`**",
          "Nominations and votes happen in the **Town Voting** thread after `/st do setup-town`.",
          "Each living player may nominate **once per day**; each player (alive or dead) may be nominated **once per day**. Ghosts cannot nominate.",
          "Private ballot: `/vote` in your personal ST thread (ST sees it on the kib tracker).",
          "Set how your name appears with **`/alias`** (defaults to a short form of your Discord name at setup).",
          "",
          "Lobby setup (roles/channels): `/game setup` — see Lobby below. Storytellers: **`/st help`**.",
          "Also available as **`/game help`** / **`/game commands`**.",
        ].join("\n"),
      )
      .addFields(
        ...doActionFields(PLAYER_DAY_ACTIONS, "", "Day"),
        {
          name: "Name",
          value: cmd(
            "/alias",
            "Set your display name for this server (used in every game). ST/admin can set `user:`.",
          ),
        },
        ...doActionFields(GAME_LOBBY_ACTIONS, "/game", "Lobby (`/game …`)"),
        {
          name: "Voting venues",
          value: [
            "**Town Voting** thread — nominations ping the player role; Vote buttons + public results when visibility is public.",
            "**Personal ST thread** — `/vote` for a private ballot; ST sees the vote on the kib **vote tracker**.",
            "You can vote on **any** open nomination.",
            "ST sets public vs secret tallies with `/st do vote-visibility` or the kib control panel.",
          ].join("\n"),
        },
      ),
  ];
}

export function buildStHelpEmbeds(): EmbedBuilder[] {
  return [
    new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("Storyteller guide")
      .setDescription(
        [
          "**Quick start**",
          "1. `/game setup` in the town channel — pick existing `st:`, `player_role:`, and `kib:` roles (optional `kib_thread:` / `log_thread:`)",
          "2. `/st do setup-town` with `players:` @mentions in **seat order** (any player count)",
          "3. `/st do say` from kib to broadcast to all player threads",
          "4. `/st remind` / `/st set-reminders` for scheduled pings (ST role or allowlist)",
          "5. `/st do end` — strips game roles, cancels reminders, opens kib for post-game chat",
          "",
          "An **ST-only log thread** is created on setup (or pick `log_thread:`). Use `/st do log` to recreate it mid-game.",
          "Prefer typing less? **`/st do`** filters actions as you type. Mid-game buttons: **`/st panel`**.",
        ].join("\n"),
      )
      .addFields(
        {
          name: "How to run commands",
          value: [
            cmd(
              "/st do",
              "Pick an action via autocomplete, then fill only the options that action needs.",
            ),
            cmd(
              "/st panel",
              "Pin/refresh kib buttons: resolve, execute, votes, close nominations, next phase, …",
            ),
            cmd("/st help", "This guide (also `/st commands`)."),
          ].join("\n\n"),
        },
        ...doActionFields(ST_DO_ACTIONS, "/st do", "Actions (`/st do …`)"),
        {
          name: "Reminders",
          value: [
            cmd("/st remind", "Schedule a reminder (requires ST role, storyteller, or allowlist)."),
            cmd(
              "/st set-reminders",
              "Replace this channel’s reminder batch (`1m 30m 1h 4 8`; does not stack).",
            ),
            cmd("/st reminders", "List pending reminders."),
            cmd(
              "/st edit-reminder / delete-reminder / clear-reminders",
              "Manage pending reminders for your game/channel.",
            ),
          ].join("\n\n"),
        },
        {
          name: "Notes",
          value: [
            "Votes live in the **Town Voting** private thread (players are pinged there on each nomination).",
            "Private ballots: `/vote` in a personal ST thread — ST sees them on the kib vote tracker.",
            "`setup-town` also pins the **control panel** + **vote tracker** in kib.",
            "Vote lock/count stay in Town Voting for hand pings; **Announce & resolve** closes that nomination to the audit log (no Town Voting pass/fail post).",
            "Each living player may nominate once per day; each player (alive or dead) may be nominated once. Ghosts cannot nominate. Use `/st do nominate` + `override:` to bypass.",
            "`close-nominations` then `next-phase` for Night 2; `next-phase` again for Day 2. Renames the town channel to `base-dayN` / `base-nightN` (voting thread stays Town Voting).",
            "Use `/st do add-st` to promote a co-storyteller (ST role; no new player thread).",
            "Personal player threads stay private after `/st do end`.",
          ].join("\n"),
        },
      ),
  ];
}

export function buildDevHelpEmbeds(): EmbedBuilder[] {
  return [
    new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("Dev commands")
      .setDescription("Available when `DEV_MODE=true`. Fake players use `dev:` IDs.")
      .addFields({
        name: "Lobby testing",
        value: [
          cmd("/dev fill", "Add fake players to the lobby."),
          cmd("/dev clear", "Remove all fake players."),
          cmd("/dev setup", "Fill lobby with fake players for testing."),
          cmd(
            "/dev reminders",
            "List/delete all server reminders (STs use `/st reminders` for their game).",
          ),
        ].join("\n\n"),
      }),
  ];
}
