import type { AutocompleteInteraction } from "discord.js";

export type DoAction = {
  name: string;
  description: string;
  /** Extra options required for this action (shown in help). */
  needs?: string[];
};

export const ST_DO_ACTIONS: DoAction[] = [
  { name: "setup-town", description: "Set roster + seats from ordered @mentions", needs: ["players"] },
  { name: "broadcast", description: "Broadcast to all player threads from kib", needs: ["message"] },
  { name: "say", description: "Alias for broadcast (prefer /st broadcast)", needs: ["message"] },
  { name: "log", description: "Create or reopen the ST-only audit log thread" },
  {
    name: "recreate-threads",
    description: "Recreate Town Voting, Whisper Declaration, Public Claims, and Rules",
  },
  {
    name: "recreate-player-thread",
    description: "Create or reopen one player's private ST thread",
    needs: ["player"],
  },
  {
    name: "reset-to-setup",
    description: "Wipe day/night back to Setup (ADMIN_IDS only; keeps roster)",
  },
  { name: "end", description: "End the game (strip roles, open kib)", needs: ["winner"] },
  {
    name: "archive",
    description: "Open town/kib for everyone to read and lock all channels/threads read-only",
  },
  { name: "resolve-next", description: "Resolve the oldest open nomination" },
  { name: "fail-open-noms", description: "Force-fail every open nomination" },
  { name: "close-nominations", description: "Close nominations for the day (no new noms until next day)" },
  {
    name: "extend-noms",
    description: "Extend every current-day nomination vote deadline by N hours",
    needs: ["hours"],
  },
  {
    name: "repost-kib-noms",
    description: "Delete+repost open nomination embeds at the bottom of kib",
  },
  {
    name: "ping-missing",
    description: "Ping all players who have not voted on a specific open nomination",
    needs: ["nominee"],
  },
  { name: "next-phase", description: "Advance Setup → Night 1 → Day 1 → Night 2 …; renames town channel" },
  {
    name: "sub",
    description: "Substitute a seated player with another Discord user",
    needs: ["oldplayer", "newplayer"],
  },
  { name: "execute", description: "Execute a player after their nomination passed", needs: ["player"] },
  { name: "mark-dead", description: "Mark a player dead or alive", needs: ["player", "alive?"] },
  { name: "votes", description: "Refresh the ST vote tracker and Town Voting nomination embeds" },
  { name: "panel", description: "Post/refresh the ST control panel in kib" },
  { name: "vote-visibility", description: "Public or secret tallies", needs: ["mode"] },
  { name: "set-vote", description: "Manually set a player's vote", needs: ["choice", "voter?", "nominee?", "reason?"] },
  {
    name: "nominate",
    description: "Nominate on behalf of a player",
    needs: ["nominator", "nominee", "accusation", "override?"],
  },
  {
    name: "refresh-noms",
    description: "Push nomination/vote DB state to Discord (recreate missing open embeds, update votes)",
  },
  { name: "add-spectator", description: "Assign kib role + thread access (or use /st add-kib)", needs: ["user"] },
  { name: "remove-spectator", description: "Remove kib role (or use /st remove-kib)", needs: ["user"] },
  { name: "add-st", description: "Promote a co-storyteller (ST role only; no new player thread)", needs: ["user"] },
  {
    name: "remove-st",
    description: "Demote a co-storyteller (strip ST role + whisper/player-thread access)",
    needs: ["user"],
  },
  {
    name: "sync-st-threads",
    description: "Add everyone with the ST role to all player ST and whisper threads",
  },
  {
    name: "sync-player-roles",
    description: "Add the game player role to seated players who are missing it on Discord",
  },
  { name: "start", description: "Legacy start (prefer setup-town)" },
];

/**
 * First-class `/st <name>` shortcuts for mobile (same handlers as `/st do <name>`).
 * Prefer actions that are frequent and/or need options (harder via kib panel alone).
 * Keep `/st do` for the full catalog — do not remove actions from ST_DO_ACTIONS.
 *
 * Discord allows at most 25 options on `/st` (subcommands + subcommand groups combined,
 * including `help`, `guide`, `reminder`, and `queue` from other modules). Stay under that.
 */
export const ST_SLASH_SHORTCUTS: DoAction[] = [
  { name: "setup-town", description: "Set roster + seats from ordered @mentions", needs: ["players"] },
  { name: "broadcast", description: "Broadcast to all player threads from kib", needs: ["message"] },
  { name: "log", description: "Create or reopen the ST-only audit log thread" },
  { name: "end", description: "End the game (strip roles, open kib)", needs: ["winner"] },
  { name: "next-phase", description: "Advance Setup → Night 1 → Day 1 → …" },
  {
    name: "recreate-player-thread",
    description: "Create or reopen one player's private ST thread",
    needs: ["player"],
  },
  { name: "close-nominations", description: "Close nominations for the day" },
  {
    name: "nominate",
    description: "Nominate on behalf of a player",
    needs: ["nominator", "nominee", "accusation", "override?"],
  },
  {
    name: "refresh-noms",
    description: "Push nomination/vote DB state to Discord (recreate missing open embeds, update votes)",
  },
  { name: "resolve-next", description: "Resolve the oldest open nomination" },
  {
    name: "extend-noms",
    description: "Extend every current-day nomination vote deadline by N hours",
    needs: ["hours"],
  },
  {
    name: "ping-missing",
    description: "Ping all players who have not voted on a specific open nomination",
    needs: ["nominee"],
  },
  {
    name: "sub",
    description: "Substitute a seated player with another Discord user",
    needs: ["oldplayer", "newplayer"],
  },
  { name: "execute", description: "Execute a player after their nomination passed", needs: ["player"] },
  { name: "mark-dead", description: "Mark a player dead or alive", needs: ["player", "alive?"] },
];

/** Lobby / setup under `/game …`. */
export const GAME_LOBBY_ACTIONS: DoAction[] = [
  { name: "setup", description: "Create a game with existing ST/player/kib roles", needs: ["st", "player_role", "kib", "kib_thread? (channel or thread)", "log_thread?"] },
  { name: "create", description: "Create a game lobby (legacy — prefer setup)" },
  { name: "join", description: "Join the lobby" },
  { name: "leave", description: "Leave the lobby" },
  { name: "list", description: "List active games in this server" },
];

/** Storyteller setup steps after `/game setup` (shown in `/game help` Lobby flow). */
export const ST_SETUP_ACTIONS: DoAction[] = [
  {
    name: "setup-town",
    description: "Set roster + seats from ordered @mentions; opens Voting, Whisper Declaration, Claims, Rules",
    needs: ["players"],
  },
  { name: "log", description: "Create or reopen the ST-only audit log thread" },
  {
    name: "recreate-threads",
    description: "Recreate Town Voting, Whisper Declaration, Public Claims, and Rules",
  },
];

/** Top-level day commands: `/nominate`, `/defend`, `/roster`, `/whisper …`. */
export const PLAYER_DAY_ACTIONS: DoAction[] = [
  { name: "nominate", description: "Nominate a player (autocomplete from game roster)", needs: ["player", "accusation"] },
  { name: "defend", description: "Add defense to an open nomination against you", needs: ["text"] },
  { name: "accusation", description: "Update your accusation on an open nomination you made", needs: ["text"] },
  { name: "roster", description: "Show seat order and alive/dead" },
  {
    name: "whisper neighbor",
    description: "Open or resume NW whispers with both seated neighbors",
  },
  {
    name: "whisper with",
    description: "Open or resume a whisper with one or more players",
    needs: ["players", "name?"],
  },
  {
    name: "backpack add",
    description: "Invite a follower into your ST thread + whispers (not ST/kib)",
    needs: ["user", "everywhere?"],
  },
  {
    name: "backpack remove",
    description: "Remove a follower from your ST thread + whispers",
    needs: ["user", "everywhere?"],
  },
  {
    name: "role",
    description: "Look up a BotC character (fuzzy search; includes travelers)",
    needs: ["name"],
  },
];

/** Top-level voting commands. */
export const PLAYER_VOTE_ACTIONS: DoAction[] = [
  { name: "vote", description: "Cast a public vote on an open nomination", needs: ["nominee", "choice", "reason?"] },
  {
    name: "privatevote",
    description: "Cast a private vote (ST sees it on the kib tracker)",
    needs: ["nominee", "choice", "reason?"],
  },
];

/**
 * Discord mobile/desktop sometimes submits the autocomplete *label*
 * (`name — description`) as the string value instead of `value`.
 * Keep only the action token before an em/en/hyphen dash separator.
 */
export function normalizeDoActionInput(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  // Split on spaced dashes, or bare em/en dashes (mobile often pastes `name—description`
  // with no spaces). Do not split on bare `-` so `mark-dead` / `recreate-player-thread` stay intact.
  const beforeDash = trimmed.split(/\s+[—–-]\s+|[—–]/)[0] ?? trimmed;
  return beforeDash.trim();
}

export function resolveDoActionName(raw: string, actions: DoAction[]): string | null {
  const normalized = normalizeDoActionInput(raw);
  if (!normalized) return null;
  const exact = actions.find((action) => action.name === normalized);
  if (exact) return exact.name;
  // Label without spaced dashes, or trailing junk: prefer longest matching action name prefix.
  const prefixMatches = actions
    .filter(
      (action) =>
        normalized === action.name ||
        normalized.startsWith(`${action.name} `) ||
        normalized.startsWith(`${action.name}—`) ||
        normalized.startsWith(`${action.name}–`) ||
        normalized.startsWith(`${action.name}-`),
    )
    .sort((a, b) => b.name.length - a.name.length);
  return prefixMatches[0]?.name ?? null;
}

function rankDoActionMatch(action: DoAction, query: string): number {
  if (!query) return 0;
  if (action.name === query) return 0;
  if (action.name.startsWith(query)) return 1;
  if (action.name.includes(query)) return 2;
  if (action.description.toLowerCase().includes(query)) return 3;
  return 4;
}

export async function respondDoAutocomplete(
  interaction: AutocompleteInteraction,
  actions: DoAction[],
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "action") {
    await interaction.respond([]);
    return;
  }

  const query = focused.value.trim().toLowerCase();
  const matches = (query
    ? actions.filter(
        (action) =>
          action.name.includes(query) ||
          action.description.toLowerCase().includes(query),
      )
    : actions
  )
    .slice()
    .sort((a, b) => {
      const rankDiff = rankDoActionMatch(a, query) - rankDoActionMatch(b, query);
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 25);

  await interaction.respond(
    matches.map((action) => ({
      // Shown in the picker. Some clients paste this back as the option value — see normalizeDoActionInput.
      name: `${action.name} — ${action.description}`.slice(0, 100),
      value: action.name,
    })),
  );
}
