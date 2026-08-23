import { EmbedBuilder } from "discord.js";

import {
  GAME_LOBBY_ACTIONS,
  PLAYER_DAY_ACTIONS,
  PLAYER_VOTE_ACTIONS,
  ST_DO_ACTIONS,
  ST_SETUP_ACTIONS,
  ST_SLASH_SHORTCUTS,
  type DoAction,
} from "./action-catalog.js";

const GUIDE_COLOR = 0x5865f2;
const FIELD_VALUE_LIMIT = 1024;
/** Discord API: sum of title + description + field names/values (+ footer/author) ≤ 6000. */
const EMBED_TOTAL_LIMIT = 6000;
const EMBED_FIELD_COUNT_LIMIT = 25;

function cmd(name: string, description: string): string {
  return `**${name}**\n${description}`;
}

const ST_SHORTCUT_NAMES = new Set(ST_SLASH_SHORTCUTS.map((action) => action.name));

/** Hide legacy aliases (e.g. `say`) from help embeds / search; they still work via `/st do`. */
const ST_DO_ACTIONS_FOR_HELP = ST_DO_ACTIONS.filter((action) => action.name !== "say");

/** Prefer `/st <name>` when a first-class shortcut exists; otherwise `/st do <name>`. */
function stCommandPrefix(actionName: string): string {
  return ST_SHORTCUT_NAMES.has(actionName) ? "/st" : "/st do";
}

function formatDoAction(action: DoAction, prefix: string): string {
  const command = prefix ? `${prefix} ${action.name}` : `/${action.name}`;
  const needs = action.needs?.length
    ? ` Needs ${action.needs.map((need) => `\`${need}\``).join(", ")}.`
    : "";
  return `**${command}**\n${action.description}.${needs}`;
}

export type HelpEntry = {
  command: string;
  description: string;
};

export type HelpSearchScope = "game" | "player" | "st" | "dev";

function entriesFromActions(actions: DoAction[], prefix: string): HelpEntry[] {
  return actions.map((action) => ({
    command: prefix ? `${prefix} ${action.name}` : `/${action.name}`,
    description:
      action.description +
      (action.needs?.length
        ? ` Needs ${action.needs.map((need) => `\`${need}\``).join(", ")}.`
        : "."),
  }));
}

export const GAME_HELP_ENTRIES: HelpEntry[] = [
  ...entriesFromActions(PLAYER_VOTE_ACTIONS, ""),
  ...entriesFromActions(PLAYER_DAY_ACTIONS, ""),
  {
    command: "/alias",
    description: "Set your display name for this server (used in every game). ST/admin can set `user:`.",
  },
  ...entriesFromActions(GAME_LOBBY_ACTIONS, "/game"),
  ...ST_SETUP_ACTIONS.map((action) => ({
    command: `${stCommandPrefix(action.name)} ${action.name}`,
    description:
      action.description +
      (action.needs?.length
        ? ` Needs ${action.needs.map((need) => `\`${need}\``).join(", ")}.`
        : "."),
  })),
  { command: "/game help", description: "Player command guide (optional `search:`)." },
  { command: "/stats", description: "Win rate and most-played characters in this server (optional `user:`)." },
  { command: "/player help", description: "Day-play guide: nominate, vote, whisper, alias, stats (optional `search:`)." },
];

/** Day-play only — nominate / vote / whisper / alias (and related). */
export const PLAYER_HELP_ENTRIES: HelpEntry[] = [
  ...entriesFromActions(PLAYER_VOTE_ACTIONS, ""),
  ...entriesFromActions(PLAYER_DAY_ACTIONS, ""),
  {
    command: "/alias",
    description: "Set your display name for this server (used in every game). ST/admin can set `user:`.",
  },
  {
    command: "/stats",
    description: "Your win rate and most-played characters in this server (optional `user:`).",
  },
  {
    command: "/player help",
    description: "Day-play guide: nominate, vote, whisper, alias, stats (optional `search:`).",
  },
];

export const ST_HELP_ENTRIES: HelpEntry[] = [
  {
    command: "/st do",
    description: "Pick any action via autocomplete, then fill only the options that action needs.",
  },
  ...entriesFromActions(ST_SLASH_SHORTCUTS, "/st"),
  {
    command: "/st panel",
    description: "Pin/refresh kib buttons: resolve, execute, votes, close nominations, next phase, …",
  },
  {
    command: "/st add-kib",
    description: "Assign kib role (+ thread access when kib is a thread). Same as `/st do add-spectator`.",
  },
  {
    command: "/st remove-kib",
    description: "Remove kib role. Same as `/st do remove-spectator`.",
  },
  ...entriesFromActions(ST_DO_ACTIONS_FOR_HELP, "/st do"),
  {
    command: "/st guide topic: setup",
    description: "Checklist: lobby → town setup.",
  },
  {
    command: "/st guide topic: day",
    description: "Checklist: running a day (noms, votes, resolve, next-phase).",
  },
  {
    command: "/st guide topic: night",
    description: "Checklist: running a night (broadcast, mark-dead, next-phase).",
  },
  {
    command: "/st guide topic: buffet",
    description: "Checklist: configuring and running a Sushi Buffet role draft.",
  },
  {
    command: "/st mark",
    description:
      "In a town thread: assign it as Town Voting, Rules, Public Claims, or Whisper Declaration.",
  },
  {
    command: "/st queue show",
    description:
      "Show the current ST queue from any channel (open to everyone; DMs you if used in the board thread).",
  },
  {
    command: "/st queue set",
    description: "Mark the current thread as this server's ST queue board (admin / allowlist).",
  },
  {
    command: "/st queue join",
    description: "Join the ST queue (modal: script name, link, notes, optional image URLs).",
  },
  {
    command: "/st queue edit",
    description: "Edit your open ST queue entry.",
  },
  {
    command: "/st queue attach",
    description: "Attach script images by uploading in-channel within 2 minutes.",
  },
  {
    command: "/st queue leave",
    description: "Close your open ST queue entry.",
  },
  {
    command: "/st queue refresh",
    description: "Refresh and bump the live queue panel in the board thread.",
  },
  {
    command: "/reminder",
    description: "Replace this channel’s reminder batch (alias for /st reminder batch; `1m 30m 1h 4 8`).",
  },
  {
    command: "/listreminders",
    description: "List pending reminders (alias for /st reminder list).",
  },
  {
    command: "/clearreminders",
    description: "Cancel pending reminders (alias for /st reminder clear).",
  },
  {
    command: "/st reminder schedule",
    description: "Schedule a reminder (requires ST role, storyteller, or allowlist; max 7d).",
  },
  {
    command: "/st reminder batch",
    description: "Replace this channel’s reminder batch (`1m 30m 1h 4 8`; does not stack).",
  },
  { command: "/st reminder list", description: "List pending reminders." },
  {
    command: "/st reminder edit",
    description: "Update a pending reminder by ID prefix.",
  },
  {
    command: "/st reminder delete",
    description: "Cancel one pending reminder by ID prefix.",
  },
  {
    command: "/st reminder clear",
    description: "Cancel pending reminders for your game/channel.",
  },
  { command: "/st help", description: "Storyteller command guide (optional `search:`)." },
];

export const DEV_HELP_ENTRIES: HelpEntry[] = [
  { command: "/dev fill", description: "Add fake players to the lobby." },
  { command: "/dev clear", description: "Remove all fake players." },
  { command: "/dev setup", description: "Fill lobby with fake players for testing." },
  {
    command: "/dev bot-game",
    description: "Seat bots (default 8) + optional real @mentions; opens town threads; optional buffet draft.",
  },
  {
    command: "/dev reminders",
    description: "List/delete all server reminders (STs use `/st reminder list` for their game).",
  },
  { command: "/dev help", description: "Dev command guide (optional `search:`)." },
];

const HELP_ENTRIES_BY_SCOPE: Record<HelpSearchScope, HelpEntry[]> = {
  game: GAME_HELP_ENTRIES,
  player: PLAYER_HELP_ENTRIES,
  st: ST_HELP_ENTRIES,
  dev: DEV_HELP_ENTRIES,
};

export function searchHelpEntries(entries: HelpEntry[], query: string): HelpEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return entries.filter(
    (entry) =>
      entry.command.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q),
  );
}

export function buildHelpSearchEmbeds(
  scope: HelpSearchScope,
  query: string,
): EmbedBuilder[] {
  const trimmed = query.trim();
  const matches = searchHelpEntries(HELP_ENTRIES_BY_SCOPE[scope], trimmed);
  const title =
    scope === "game"
      ? "Player help search"
      : scope === "player"
        ? "Day-play help search"
        : scope === "st"
          ? "Storyteller help search"
          : "Dev help search";

  if (matches.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(GUIDE_COLOR)
        .setTitle(title)
        .setDescription(
          `No commands matched \`${trimmed}\`.\nTry another word, or run \`/${scope} help\` without \`search:\` for the full guide.`,
        ),
    ];
  }

  const lines = matches.map(
    (entry) => `**${entry.command}**\n${entry.description}`,
  );

  return [
    new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle(title)
      .setDescription(
        `**${matches.length}** match${matches.length === 1 ? "" : "es"} for \`${trimmed}\`.`,
      )
      .addFields(...chunkHelpLines(lines, "Matches")),
  ];
}

function chunkHelpLines(
  lines: string[],
  baseName: string,
): { name: string; value: string }[] {
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

/** Split catalog entries into embed fields that stay under Discord's 1024-char limit. */
function doActionFields(
  catalog: DoAction[],
  prefix: string | ((action: DoAction) => string),
  baseName: string,
): { name: string; value: string }[] {
  const lines = catalog.map((action) =>
    formatDoAction(action, typeof prefix === "function" ? prefix(action) : prefix),
  );
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

function measureEmbedText(options: {
  title?: string;
  description?: string;
  fields: { name: string; value: string }[];
}): number {
  let total = (options.title?.length ?? 0) + (options.description?.length ?? 0);
  for (const field of options.fields) {
    total += field.name.length + field.value.length;
  }
  return total;
}

/** Pack fields into one or more embeds under Discord's per-embed 6000-char / 25-field limits.
 * Callers that send multiple embeds in one message must paginate — Discord also caps
 * the combined text of all embeds in a message at 6000 characters.
 */
function packGuideEmbeds(options: {
  title: string;
  description: string;
  fields: { name: string; value: string }[];
}): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];
  let currentFields: { name: string; value: string }[] = [];
  let isFirst = true;

  const flush = () => {
    if (!isFirst && currentFields.length === 0) return;
    const title = isFirst ? options.title : `${options.title} (cont.)`;
    const embed = new EmbedBuilder().setColor(GUIDE_COLOR).setTitle(title);
    if (isFirst) {
      embed.setDescription(options.description);
    }
    if (currentFields.length > 0) {
      embed.addFields(...currentFields);
    }
    embeds.push(embed);
    currentFields = [];
    isFirst = false;
  };

  for (const field of options.fields) {
    const title = isFirst ? options.title : `${options.title} (cont.)`;
    const description = isFirst ? options.description : undefined;
    const candidate = [...currentFields, field];
    const wouldExceed =
      candidate.length > EMBED_FIELD_COUNT_LIMIT ||
      measureEmbedText({ title, description, fields: candidate }) > EMBED_TOTAL_LIMIT;
    // Always allow the first field onto an empty page (field values are already ≤ 1024).
    if (currentFields.length > 0 && wouldExceed) {
      flush();
    }
    currentFields.push(field);
  }
  flush();
  return embeds;
}

export function buildPlayerHelpEmbeds(): EmbedBuilder[] {
  return [
    new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("Player day commands")
      .setDescription(
        [
          "Use these during an active game (usually in **Town Voting** or town).",
          "**`/nominate`** · **`/accusation`** · **`/defend`** · **`/vote`** · **`/privatevote`** · **`/whisper`** · **`/backpack`** · **`/alias`** · **`/stats`** · **`/roster`** · **`/role`**",
          "",
          "Search: `/player help search: whisper`. Full lobby/setup guide: **`/game help`**.",
        ].join("\n"),
      )
      .addFields(
        {
          name: "Nominate",
          value: [
            cmd(
              "/nominate",
              "Nominate (`player:` + `accusation:`). Once per living player per day; each person may be nominated once per day. Ghosts cannot nominate (activated Banshee: twice/day).",
            ),
            cmd(
              "/accusation",
              "Update the accusation text on an open nomination you made (`text:`).",
            ),
            cmd("/defend", "Add your defense text when you are the nominee on an open nomination."),
          ].join("\n\n"),
        },
        {
          name: "Vote",
          value: [
            cmd(
              "/vote",
              "Public ballot on an open nomination (`nominee:`, `choice:`, optional `reason:`). You can also use the **Vote** button in Town Voting.",
            ),
            cmd(
              "/privatevote",
              "Private ballot — only the ST sees it on the kib vote tracker (`nominee:`, `choice:`, optional `reason:`).",
            ),
          ].join("\n\n"),
        },
        {
          name: "Whisper & backpack",
          value: [
            cmd(
              "/whisper neighbor",
              "Open or resume neighbor (NW) whisper threads with both seated neighbors. ST is added; a declaration posts to Whisper Declaration when available.",
            ),
            cmd(
              "/whisper with",
              "Open or resume a whisper with one or more players (`players:` @mentions, optional `name:`). Groups default to `Group (names)`.",
            ),
            cmd(
              "/backpack add",
              "Invite a follower into your private ST thread and your whispers (`user:`). They must not have this game’s ST or kib role. ST: `everywhere:True` for all threads.",
            ),
            cmd(
              "/backpack remove",
              "Remove a backpacker from your ST thread and whispers (`user:`; ST: `everywhere:True`).",
            ),
          ].join("\n\n"),
        },
        {
          name: "Alias & extras",
          value: [
            cmd(
              "/alias",
              "Set your display name for this server (used in nominations, votes, roster). ST/admin can set `user:`.",
            ),
            cmd(
              "/stats",
              "Your win rate and most-played characters in this server (optional `user:`).",
            ),
            cmd("/roster", "Show seat order and alive/dead status."),
            cmd("/role", "Look up a BotC character by fuzzy name (includes travelers)."),
          ].join("\n\n"),
        },
      ),
  ];
}

export function buildGameHelpEmbeds(): EmbedBuilder[] {
  return [
    new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("Player commands")
      .setDescription(
        [
          "Day play uses top-level slash commands — not `/game …`.",
          "**`/nominate`** · **`/accusation`** · **`/defend`** · **`/vote`** · **`/privatevote`** · **`/roster`** · **`/whisper`** · **`/backpack`** · **`/role`** · **`/script`** · **`/alias`** · **`/stats`**",
          "Nominations and votes happen in the **Town Voting** thread once Day 1 begins (`/st next-phase` twice after setup-town: Setup → Night 1 → Day 1).",
          "Each living player may nominate **once per day**; each player (alive or dead) may be nominated **once per day**. Ghosts cannot nominate (activated Banshee: twice/day).",
          "Update your accusation with **`/accusation`**. Nominee defense: **`/defend`**.",
          "Public ballot: `/vote` (or the Vote button). Private ballot: `/privatevote` (ST sees it on the kib tracker).",
          "Whispers: `/whisper neighbor` opens NW threads with both seats; `/whisper with` takes `@mentions` (optional `name:`; groups default to `Group (names)`).",
          "Backpack: `/backpack add user:` invites a follower into your ST thread + whispers (not ST/kib). ST mass: `everywhere:True`.",
          "Character lookup: **`/role name:`** — fuzzy search over official characters (incl. travelers).",
          "Sushi Buffet games: **`/script`** — enabled roles and draft house rules.",
          "Set how your name appears with **`/alias`** (defaults to a short form of your Discord name at setup).",
          "Ended-game record: **`/stats`** (optional `user:`) for win rate and most-played characters.",
          "",
          "Day-play only: **`/player help`**. Lobby: `/game setup` then **`/st setup-town`**. Full ST guide: **`/st help`**.",
          "Also available as **`/game help`**. Search: `/game help search: vote`.",
        ].join("\n"),
      )
      .addFields(
        ...doActionFields(PLAYER_VOTE_ACTIONS, "", "Voting"),
        ...doActionFields(PLAYER_DAY_ACTIONS, "", "Day"),
        {
          name: "Name & stats",
          value: [
            cmd(
              "/alias",
              "Set your display name for this server (used in every game). ST/admin can set `user:`.",
            ),
            cmd(
              "/stats",
              "Win rate and most-played characters in this server (optional `user:`).",
            ),
          ].join("\n\n"),
        },
        ...doActionFields(GAME_LOBBY_ACTIONS, "/game", "Lobby (`/game …`)"),
        ...doActionFields(
          ST_SETUP_ACTIONS,
          (action) => stCommandPrefix(action.name),
          "Setup (`/st …` / `/st do …`)",
        ),
        {
          name: "Voting venues",
          value: [
            "**Town Voting** — nominations and votes. **Whisper Declaration** / **Public Claims** / **Rules** (ST write-only) open on setup-town.",
            "**`/vote`** — public ballot. **`/privatevote`** — private ballot (ST sees it on the kib **vote tracker**).",
            "**Whisper threads** — `/whisper neighbor` or `/whisper with` (ST is added). Declarations post to Whisper Declaration when available.",
            "You can vote on **any** open nomination.",
            "ST sets public vs secret tallies with `/st do vote-visibility` or the kib control panel (applies to new nominations only).",
          ].join("\n"),
        },
      ),
  ];
}

export function buildStHelpEmbeds(): EmbedBuilder[] {
  return packGuideEmbeds({
    title: "Storyteller guide",
    description: [
      "**Quick start**",
      "1. `/game setup` in the town channel — pick existing `st:`, `player_role:`, and `kib:` roles (optional `kib_thread:` channel/thread + `log_thread:`). If you pass a kib **channel**, add the Grimkeeper bot to that channel first.",
      "2. `/st setup-town` with `players:` @mentions in **seat order** (any player count)",
      "3. `/st broadcast` from kib to send the same message to all player threads",
      "4. `/reminder` / `/st reminder batch` / `/st reminder schedule` for scheduled pings (ST role or allowlist)",
      "5. `/st end` with `winner: good` or `evil` — strips game roles, cancels reminders, opens kib for post-game chat",
      "6. `/st do archive` — opens town/kib for everyone to read, locks all channels/threads read-only, and moves town (and kib channel) to the Archives category (Admin → Guild settings)",
      "",
      "An **ST-only log thread** is created on setup (or pick `log_thread:`). Use `/st log` to recreate it mid-game.",
      "On mobile, prefer **`/st broadcast`**, **`/st next-phase`**, **`/st resolve-next`**, **`/st execute`**, etc. from the slash menu — no autocomplete. Full catalog still on **`/st do`**. Mid-game buttons: **`/st panel`**.",
      "Phase checklists: **`/st guide topic: setup`**, **`/st guide topic: buffet`**, **`/st guide topic: day`**, **`/st guide topic: night`**.",
    ].join("\n"),
    fields: [
      {
        name: "How to run commands",
        value: [
          cmd(
            "/st … shortcuts",
            "Frequent mobile subcommands (setup-town, broadcast, next-phase, sub, resolve-next, …). Full catalog: `/st do`. Fail-all / kib repost / reset-to-setup: panel or `/st do`.",
          ),
          cmd(
            "/st do",
            "Full action catalog via autocomplete (everything else, plus the shortcuts above).",
          ),
          cmd(
            "/st guide topic: setup|buffet|day|night",
            "Phase checklist (commands only where the bot is involved).",
          ),
          cmd(
            "/st mark",
            "In a town thread: assign it as Town Voting, Rules, Public Claims, or Whisper Declaration.",
          ),
          cmd(
            "/st panel",
            "Pin/refresh kib buttons: resolve, execute, votes, close nominations, fail all open, repost kib noms, next phase, …",
          ),
          cmd(
            "/st add-kib / remove-kib",
            "Assign or remove kib role (same as `/st do add-spectator` / `remove-spectator`).",
          ),
          cmd(
            "/st queue set|show|join|edit|attach|leave|refresh|signup",
            "ST queue board: mark a thread with `set`, then show/join/signup. Panel bumps on every update.",
          ),
          cmd("/st help", "This guide (optional `search:`)."),
        ].join("\n\n"),
      },
      ...doActionFields(ST_SLASH_SHORTCUTS, "/st", "Mobile shortcuts (`/st …`)"),
      ...doActionFields(ST_DO_ACTIONS_FOR_HELP, "/st do", "All actions (`/st do …`)"),
      {
        name: "Reminders",
        value: [
          cmd("/reminder", "Set offset reminders (alias for /st reminder batch; `1m 30m 1h 4 8`)."),
          cmd("/st reminder schedule", "Schedule a single reminder (requires ST role, storyteller, or allowlist)."),
          cmd(
            "/st reminder batch",
            "Replace this channel’s reminder batch (`1m 30m 1h 4 8`; does not stack).",
          ),
          cmd("/listreminders", "List pending reminders (alias for /st reminder list)."),
          cmd("/clearreminders", "Cancel pending reminders (alias for /st reminder clear)."),
          cmd("/st reminder list", "List pending reminders."),
          cmd(
            "/st reminder edit / delete / clear",
            "Manage pending reminders for your game/channel.",
          ),
        ].join("\n\n"),
      },
      {
        name: "Notes",
        value: [
          "`setup-town` → **Setup** (Voting, Whisper Decl, Claims, Rules). `/st next-phase` → Night 1 → Day 1.",
          "Public `/vote` or Vote button; private `/privatevote` (kib tracker).",
          "`/st mark` assigns Voting / Rules / Claims / Whisper Decl. `/st do recreate-threads` · `/st recreate-player-thread`.",
          "Lock/count in Town Voting; **Announce & resolve** → Voting + audit log.",
          "One nom per living player/day (Banshee after `/st mark-dead banshee:true`: twice/day + yes×2, no ghost vote). Ghosts otherwise cannot nominate.",
          "`next-phase` renames town `…-setup` / `…-nightN` / `…-dayN`. Co-STs: `add-st` / `remove-st` / `sync-st-threads`.",
          "`/st sub` swaps a seat. `/st do reset-to-setup` (ADMIN_IDS). Day stamps skip Rules.",
        ].join("\n"),
      },
    ],
  });
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
            "/dev bot-game",
            "Seat bots (default 8) + optional `players:` @mentions in seat order; `buffet:true` starts draft.",
          ),
          cmd(
            "/dev reminders",
            "List/delete all server reminders (STs use `/st reminder list` for their game).",
          ),
        ].join("\n\n"),
      }),
  ];
}

export type StGuideTopic = "setup" | "buffet" | "day" | "night";

function checklist(items: string[]): string {
  return items.map((item) => `☐ ${item}`).join("\n");
}

export function buildStGuideEmbed(topic: StGuideTopic): EmbedBuilder {
  if (topic === "setup") {
    return new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("ST checklist · Setup")
      .setDescription("Lobby → Night 1. Commands only where the bot is involved.")
      .addFields(
        {
          name: "1. Lobby",
          value: checklist([
            "`/game setup` — pick existing `st:`, `player_role:`, `kib:` (optional `kib_thread:` channel or thread + `log_thread:`)",
            "If `kib_thread:` is a **channel**, add the Grimkeeper bot to it first (so panels, log, and commands work there)",
            "Confirm kib + ST log look right (log nests under a kib channel when kib is a channel)",
          ]),
        },
        {
          name: "2. Open town",
          value: checklist([
            "`/st setup-town` with `players:` @mentions in **seat order** (enters **Setup**; nominations closed)",
            "Confirm **Town Voting**, **Whisper Declaration**, **Public Claims**, **Rules** opened",
            "Post house rules in **Rules** (ST write-only)",
            "Optional: `/st mark` in a custom thread to assign Town Voting / Rules / Claims / Whisper Declaration",
            "Missing surfaces? `/st do recreate-threads` (includes Town Voting)",
          ]),
        },
        {
          name: "3. Before Day 1",
          value: checklist([
            "`/st panel` — pin control panel in kib (or `/st do panel`)",
            "Optional: `/st do vote-visibility` `mode: public|secret`",
            "Optional: `/st broadcast` — send the same message to all player ST threads",
            "Optional: `/reminder` / `/st reminder batch` / `/st reminder schedule`",
            "Optional: `/st do add-st` / `/st do sync-st-threads` / `/st add-kib`",
            "Optional: `/st log` if the audit log is missing",
            "**Sushi Buffet?** Admin panel → game → Sushi Buffet config (toggle roles, save), then `/st do buffet-start`",
            "`/st next-phase` — start **Day 1** (opens nominations)",
          ]),
        },
        {
          name: "Also",
          value: [
            "Full command list: `/st help`",
            "Day loop: `/st guide topic: day` · Night: `/st guide topic: night`",
          ].join("\n"),
        },
      );
  }

  if (topic === "buffet") {
    return new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("ST checklist · Sushi Buffet")
      .setDescription("Configure the private role draft while the game is still in **Setup**.")
      .addFields(
        {
          name: "1. Prepare the game",
          value: checklist([
            "`/game setup` — configure the game roles and a kib thread or channel (if kib is a channel, add the Grimkeeper bot to it first)",
            "`/st setup-town` with players in seat order — creates every player’s private ST thread",
            "Do not advance to Night 1 yet; the draft can start only during **Setup**",
          ]),
        },
        {
          name: "2. Configure the role pool",
          value: checklist([
            "Admin → Games → this game → **Sushi Buffet Draft** — enable the roles players may choose, then save",
            "Keep enough Townsfolk, Outsider, Minion, and Demon roles for the current player count",
            "For a small custom pool, enable **Recycle unchosen roles** so declined offers remain available",
            "Players can read the script anytime with **`/script`**",
          ]),
        },
        {
          name: "3. Run and finish",
          value: checklist([
            "`/st do buffet-start` — sends the first private offer; players pick in their own ST threads",
            "For fake/dev players, the ST picks from that player’s ST thread",
            "Enable **Lunatic** in admin if you want one, then `/st do buffet-assign-lunatic player:@…` before or during the draft",
            "After outsider-count roles (Baron, etc.), `/st do buffet-assign-drunk player:@…` if you need a Drunk",
            "`/st do buffet-status` — check picks + recreate kib draft tracker; `/st do buffet-cancel` — stop before completion",
            "`/st do buffet-export-clocktower` — JSON for clocktower.live grimoire import",
            "When complete, the complete player → role roster is posted privately in kib; then `/st next-phase` for Night 1",
          ]),
        },
        {
          name: "Also",
          value: "Setup: `/st guide topic: setup` · Day: `/st guide topic: day` · Night: `/st guide topic: night` · All commands: `/st help`",
        },
      );
  }

  if (topic === "day") {
    return new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("ST checklist · Day")
      .setDescription(
        "Nominations & votes live in **Town Voting**. Use the kib **panel** / **vote tracker** when you can.",
      )
      .addFields(
        {
          name: "During the day",
          value: checklist([
            "Players: `/nominate`, `/accusation`, `/defend`, `/vote` (public), `/privatevote` (private)",
            "Watch kib vote tracker — refresh with `/st do votes` if needed (also refreshes Town Voting nomination embeds)",
            "Lock / count / announce from Town Voting or the panel",
            "`/st resolve-next` (or panel) — resolve oldest open nomination",
            "`/st do fail-open-noms` (or panel) — force-fail every open nomination",
            "`/st ping-missing` `nominee:` — ping everyone still missing a vote on that nom",
            "`/st extend-noms` `hours:` — add hours to each nom’s existing deadline (even if past)",
            "`/st do repost-kib-noms` (or panel) — delete+repost open nom embeds at the bottom of kib",
            "If it passed: `/st execute` `player:` (or panel)",
            "Other deaths: `/st mark-dead` `player:` (`alive:` revive; `banshee:true` Demon-kill Banshee)",
            "Fix a ballot: `/st do set-vote` — or nominate for someone: `/st nominate`",
            "After admin DB edits: `/st refresh-noms` (recreates missing open embeds + updates votes)",
          ]),
        },
        {
          name: "End of day",
          value: checklist([
            "`/st close-nominations` — no new noms until next day",
            "`/st next-phase` — advance to night (renames town to `…-nightN`)",
          ]),
        },
        {
          name: "Also",
          value: [
            "Whispers are player-side (`/whisper …`); declarations go to Whisper Declaration.",
            "Game over: `/st end` with `winner: good` or `evil`. Then `/st do archive` to freeze town/kib read-only.",
            "Setup: `/st guide topic: setup` · Night: `/st guide topic: night` · All commands: `/st help`",
          ].join("\n"),
        },
      );
  }

  return new EmbedBuilder()
    .setColor(GUIDE_COLOR)
    .setTitle("ST checklist · Night")
    .setDescription(
      "Night abilities run offline on your grimoire. Use the bot for info, deaths, and phase.",
    )
    .addFields(
      {
        name: "During the night",
        value: checklist([
          "`/st broadcast` — send the same night info to every player ST thread",
          "Use each player’s private ST thread for personal night results",
          "Deaths overnight: `/st mark-dead` `player:` (`banshee:true` for Demon-kill Banshee)",
          "Optional: `/reminder` / `/st reminder batch` for morning pings",
        ]),
      },
      {
        name: "End of night",
        value: checklist([
          "`/st next-phase` — open the next day (Town Voting + day stamps; renames to `…-dayN`)",
          "Confirm kib panel / vote tracker are ready for nominations",
        ]),
      },
      {
        name: "Also",
        value: [
          "Game over: `/st end` with `winner: good` or `evil`. Then `/st do archive` to freeze town/kib read-only.",
          "Setup: `/st guide topic: setup` · Day: `/st guide topic: day` · All commands: `/st help`",
        ].join("\n"),
      },
    );
}
