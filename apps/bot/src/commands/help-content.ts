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

export type HelpSearchScope = "game" | "st" | "dev";

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
    command: "/st guide setup",
    description: "Checklist: lobby → town setup.",
  },
  {
    command: "/st guide day",
    description: "Checklist: running a day (noms, votes, resolve, next-phase).",
  },
  {
    command: "/st guide night",
    description: "Checklist: running a night (broadcast, mark-dead, next-phase).",
  },
  {
    command: "/st mark",
    description:
      "In a town thread: assign it as Town Voting, Rules, Public Claims, or Whisper Declaration.",
  },
  {
    command: "/st queue show",
    description: "Show the current ST queue from any channel.",
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
    description: "Refresh the live queue panel in the board thread.",
  },
  {
    command: "/st remind",
    description: "Schedule a reminder (requires ST role, storyteller, or allowlist).",
  },
  {
    command: "/st set-reminders",
    description: "Replace this channel’s reminder batch (`1m 30m 1h 4 8`; does not stack).",
  },
  { command: "/st reminders", description: "List pending reminders." },
  {
    command: "/st edit-reminder",
    description: "Update a pending reminder by ID prefix.",
  },
  {
    command: "/st delete-reminder",
    description: "Cancel one pending reminder by ID prefix.",
  },
  {
    command: "/st clear-reminders",
    description: "Cancel pending reminders for your game/channel.",
  },
  { command: "/st help", description: "Storyteller command guide (optional `search:`)." },
];

export const DEV_HELP_ENTRIES: HelpEntry[] = [
  { command: "/dev fill", description: "Add fake players to the lobby." },
  { command: "/dev clear", description: "Remove all fake players." },
  { command: "/dev setup", description: "Fill lobby with fake players for testing." },
  {
    command: "/dev reminders",
    description: "List/delete all server reminders (STs use `/st reminders` for their game).",
  },
  { command: "/dev help", description: "Dev command guide (optional `search:`)." },
];

const HELP_ENTRIES_BY_SCOPE: Record<HelpSearchScope, HelpEntry[]> = {
  game: GAME_HELP_ENTRIES,
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

export function buildGameHelpEmbeds(): EmbedBuilder[] {
  return [
    new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("Player commands")
      .setDescription(
        [
          "Day play uses top-level slash commands — not `/game …`.",
          "**`/nominate`** · **`/defend`** · **`/vote`** · **`/privatevote`** · **`/roster`** · **`/whisper`** · **`/role`** · **`/alias`**",
          "Nominations and votes happen in the **Town Voting** thread once Day 1 begins (`/st next-phase` twice after setup-town: Setup → Night 1 → Day 1).",
          "Each living player may nominate **once per day**; each player (alive or dead) may be nominated **once per day**. Ghosts cannot nominate.",
          "Public ballot: `/vote` (or the Vote button). Private ballot: `/privatevote` (ST sees it on the kib tracker).",
          "Whispers: `/whisper neighbor` opens NW threads with both seats; `/whisper with` takes `@mentions` (optional `name:`; groups default to `Group (names)`).",
          "Character lookup: **`/role name:`** — fuzzy search over official characters (incl. travelers).",
          "Set how your name appears with **`/alias`** (defaults to a short form of your Discord name at setup).",
          "",
          "Lobby: `/game setup` then **`/st setup-town`** — see Lobby + Setup below. Full ST guide: **`/st help`**.",
          "Also available as **`/game help`**. Search: `/game help search: vote`.",
        ].join("\n"),
      )
      .addFields(
        ...doActionFields(PLAYER_VOTE_ACTIONS, "", "Voting"),
        ...doActionFields(PLAYER_DAY_ACTIONS, "", "Day"),
        {
          name: "Name",
          value: cmd(
            "/alias",
            "Set your display name for this server (used in every game). ST/admin can set `user:`.",
          ),
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
          "1. `/game setup` in the town channel — pick existing `st:`, `player_role:`, and `kib:` roles (optional `kib_thread:` channel/thread + `log_thread:`)",
          "2. `/st setup-town` with `players:` @mentions in **seat order** (any player count)",
          "3. `/st broadcast` from kib to send the same message to all player threads",
          "4. `/st remind` / `/st set-reminders` for scheduled pings (ST role or allowlist)",
          "5. `/st end` with `winner: good` or `evil` — strips game roles, cancels reminders, opens kib for post-game chat",
          "",
          "An **ST-only log thread** is created on setup (or pick `log_thread:`). Use `/st log` to recreate it mid-game.",
          "On mobile, prefer **`/st broadcast`**, **`/st next-phase`**, **`/st resolve-next`**, **`/st execute`**, etc. from the slash menu — no autocomplete. Full catalog still on **`/st do`**. Mid-game buttons: **`/st panel`**.",
          "Phase checklists: **`/st guide setup`**, **`/st guide day`**, **`/st guide night`**.",
        ].join("\n"),
      )
      .addFields(
        {
          name: "How to run commands",
          value: [
            cmd(
              "/st … shortcuts",
              "Common actions as first-class subcommands (setup-town, broadcast, log, end, next-phase, close-nominations, resolve-next, execute, mark-dead).",
            ),
            cmd(
              "/st do",
              "Full action catalog via autocomplete (everything else, plus the shortcuts above).",
            ),
            cmd(
              "/st guide setup|day|night",
              "Phase checklist (commands only where the bot is involved).",
            ),
            cmd(
              "/st mark",
              "In a town thread: assign it as Town Voting, Rules, Public Claims, or Whisper Declaration.",
            ),
            cmd(
              "/st panel",
              "Pin/refresh kib buttons: resolve, execute, votes, close nominations, next phase, …",
            ),
            cmd(
              "/st add-kib / remove-kib",
              "Assign or remove kib role (same as `/st do add-spectator` / `remove-spectator`).",
            ),
            cmd(
              "/st queue show|join|edit|attach|leave|refresh",
              "ST queue board: who's ready to run (script, notes, co-STs, player signups).",
            ),
            cmd("/st help", "This guide (optional `search:`)."),
          ].join("\n\n"),
        },
        ...doActionFields(ST_SLASH_SHORTCUTS, "/st", "Mobile shortcuts (`/st …`)"),
        ...doActionFields(ST_DO_ACTIONS_FOR_HELP, "/st do", "All actions (`/st do …`)"),
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
            "`setup-town` enters **Setup** (opens Voting, Whisper Declaration, Public Claims, Rules). `/st next-phase` → Night 1 → Day 1.",
            "Public: `/vote` or Vote button. Private: `/privatevote` (kib vote tracker).",
            "`/st mark` assigns a thread as Town Voting, Rules, Public Claims, or Whisper Declaration.",
            "`/st do recreate-threads` (Voting + town surfaces) · `/st recreate-player-thread` (one private ST thread).",
            "Vote lock/count stay in Town Voting; **Announce & resolve** posts to Town Voting + audit log.",
            "Each living player may nominate once per day; each player may be nominated once. Ghosts cannot nominate.",
            "`next-phase` advances Setup → Night 1 → Day 1 → …. Renames town to `base-setup` / `base-nightN` / `base-dayN`.",
            "`add-st` / `sync-st-threads` promote STs and invite them into player ST threads.",
            "`reset-to-setup` (ALLOWED_USER_IDS only) wipes day/night back to Setup, keeping the roster.",
            "Day stamps go to Voting, Whisper Declaration, Public Claims, kib, and whisper threads — not Rules.",
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

export type StGuideTopic = "setup" | "day" | "night";

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
            "Confirm kib + ST log look right (log nests under a kib channel when kib is a channel)",
          ]),
        },
        {
          name: "2. Open town",
          value: checklist([
            "`/st setup-town` with `players:` @mentions in **seat order** (starts **Night 1**, nominations closed)",
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
            "Optional: `/st remind` / `/st set-reminders`",
            "Optional: `/st do add-st` / `/st do sync-st-threads` / `/st add-kib`",
            "Optional: `/st log` if the audit log is missing",
            "`/st next-phase` — start **Day 1** (opens nominations)",
          ]),
        },
        {
          name: "Also",
          value: [
            "Full command list: `/st help`",
            "Day loop: `/st guide day` · Night: `/st guide night`",
          ].join("\n"),
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
            "Players: `/nominate`, `/defend`, `/vote` (public), `/privatevote` (private)",
            "Watch kib vote tracker — refresh with `/st do votes` if needed",
            "Lock / count / announce from Town Voting or the panel",
            "`/st resolve-next` (or panel) — resolve oldest open nomination",
            "If it passed: `/st execute` `player:` (or panel)",
            "Other deaths: `/st mark-dead` `player:` (`alive:` if reviving)",
            "Fix a ballot: `/st do set-vote` — or nominate for someone: `/st do nominate`",
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
            "Game over: `/st end` with `winner: good` or `evil`.",
            "Setup: `/st guide setup` · Night: `/st guide night` · All commands: `/st help`",
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
          "Deaths overnight: `/st mark-dead` `player:`",
          "Optional: `/st remind` / `/st set-reminders` for morning pings",
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
          "Game over: `/st end` with `winner: good` or `evil`.",
          "Setup: `/st guide setup` · Day: `/st guide day` · All commands: `/st help`",
        ].join("\n"),
      },
    );
}
