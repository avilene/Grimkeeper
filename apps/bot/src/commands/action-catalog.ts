import type { AutocompleteInteraction } from "discord.js";

export type DoAction = {
  name: string;
  description: string;
  /** Extra options required for this action (shown in help). */
  needs?: string[];
};

export const ST_DO_ACTIONS: DoAction[] = [
  { name: "setup-town", description: "Set roster + seats from ordered @mentions", needs: ["players"] },
  { name: "say", description: "Broadcast to all player threads from kib", needs: ["message"] },
  { name: "log", description: "Create or reopen the ST-only audit log thread" },
  { name: "end", description: "End the game (strip roles, open kib)" },
  { name: "resolve-next", description: "Resolve the oldest open nomination" },
  { name: "close-nominations", description: "Close nominations for the day (no new noms until next day)" },
  { name: "next-phase", description: "Advance day ↔ night (Day 1 → Night 2 → Day 2 …); renames town channel to base-dayN / base-nightN" },
  { name: "execute", description: "Execute a player after their nomination passed", needs: ["player"] },
  { name: "mark-dead", description: "Mark a player dead or alive", needs: ["player", "alive?"] },
  { name: "votes", description: "Refresh the ST vote tracker in kib" },
  { name: "panel", description: "Post/refresh the ST control panel in kib" },
  { name: "vote-visibility", description: "Public or secret tallies", needs: ["mode"] },
  { name: "set-vote", description: "Manually set a player's vote", needs: ["choice", "voter?", "nominee?", "reason?"] },
  {
    name: "nominate",
    description: "Nominate on behalf of a player",
    needs: ["nominator", "nominee", "accusation", "override?"],
  },
  { name: "add-spectator", description: "Assign kib role + thread access", needs: ["user"] },
  { name: "remove-spectator", description: "Remove kib role", needs: ["user"] },
  { name: "add-st", description: "Promote a co-storyteller (ST role only; no new player thread)", needs: ["user"] },
  { name: "start", description: "Legacy start (prefer setup-town)" },
];

/** Lobby / setup under `/game …`. */
export const GAME_LOBBY_ACTIONS: DoAction[] = [
  { name: "setup", description: "Create a game with existing ST/player/kib roles", needs: ["st", "player_role", "kib", "kib_thread?", "log_thread?"] },
  { name: "create", description: "Create a game lobby (legacy — prefer setup)" },
  { name: "join", description: "Join the lobby" },
  { name: "leave", description: "Leave the lobby" },
  { name: "list", description: "List active games in this server" },
];

/** Top-level day commands: `/nominate`, `/defend`, `/vote`, `/roster`. */
export const PLAYER_DAY_ACTIONS: DoAction[] = [
  { name: "nominate", description: "Nominate a player (autocomplete from game roster)", needs: ["player", "accusation"] },
  { name: "defend", description: "Add defense to an open nomination against you", needs: ["text"] },
  { name: "vote", description: "Vote on an open nomination (autocomplete open nominees)", needs: ["nominee", "choice", "reason?"] },
  { name: "roster", description: "Show seat order and alive/dead" },
];

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
  ).slice(0, 25);

  await interaction.respond(
    matches.map((action) => ({
      name: `${action.name} — ${action.description}`.slice(0, 100),
      value: action.name,
    })),
  );
}
