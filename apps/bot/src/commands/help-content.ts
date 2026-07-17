import { EmbedBuilder } from "discord.js";

import { isMinimalMode } from "../bot-mode.js";

const GUIDE_COLOR = 0x5865f2;

function cmd(name: string, description: string): string {
  return `**${name}**\n${description}`;
}

export function buildGameHelpEmbeds(): EmbedBuilder[] {
  if (isMinimalMode()) {
    return [
      new EmbedBuilder()
        .setColor(GUIDE_COLOR)
        .setTitle("Game commands")
        .setDescription(
          [
            "Player commands for minimal-mode town voting.",
            "Use **`/game do`** and start typing the action — Discord filters the list.",
            "Nominations and votes happen in the **Town Voting** thread after `/st do setup-town`.",
            "**Voting is allowlist-only** — only users in `ALLOWED_USER_IDS` can nominate, defend, or vote for now.",
            "You can also cast a **private ballot** from your personal ST thread.",
            "",
            "Storytellers: see **`/st help`** for setup and day control.",
          ].join("\n"),
        )
        .addFields(
          {
            name: "Lobby",
            value: [
              cmd(
                "/game do setup",
                "Create a game with existing roles: `st:`, `player_role:`, `kib:` (+ optional `edition:`).",
              ),
              cmd("/game do join", "Join the lobby (optional — ST can set roster with setup-town)."),
              cmd("/game do leave", "Leave the lobby."),
              cmd("/game do list", "List active games in this server."),
            ].join("\n\n"),
          },
          {
            name: "Nominations & votes",
            value: [
              cmd("/game do nominate", "Needs `player:` + `accusation:`."),
              cmd("/game do defend", "Needs `text:` — defense on an open nomination against you."),
              cmd("/game do vote", "Needs `nominee:` + `choice:` (+ `reason:` if conditional)."),
              cmd("/game do roster", "Show seat order and alive/dead status."),
            ].join("\n\n"),
          },
          {
            name: "Voting venues",
            value: [
              "**Town Voting** thread — shared embeds + Vote buttons; public results when visibility is public.",
              "**Personal ST thread** — private ballot (Vote button); confirmations stay ephemeral.",
              "You can vote on **any** open nomination; embeds update tallies after each vote.",
              "ST sets public vs secret tallies with `/st do vote-visibility` or the kib control panel.",
            ].join("\n"),
          },
        ),
    ];
  }

  return [
    new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("Game commands")
      .setDescription(
        "Player commands for full-mode games. Day nominations and votes happen in the **day thread**.",
      )
      .addFields(
        {
          name: "Lobby & setup",
          value: [
            cmd("/game create", "Create a game in this channel."),
            cmd("/game join", "Join the active game lobby."),
            cmd("/game leave", "Leave the lobby."),
            cmd("/game seat", "Pick your seat during setup."),
            cmd("/game seats", "Show the seating chart."),
            cmd("/game list", "List active games in this server."),
          ].join("\n\n"),
        },
        {
          name: "Reference",
          value: [
            cmd("/game role", "Show a script role with official art."),
            cmd("/game roles", "List roles on the script."),
          ].join("\n\n"),
        },
        {
          name: "Day thread",
          value: [
            cmd("/game nominate", "Nominate another player with an accusation."),
            cmd("/game defend", "Add your defense to an open nomination against you."),
            cmd("/game vote", "Vote yes / no / conditional."),
            cmd("/game nominations", "List nominations for the current day."),
            "Use the **Vote** button on nomination embeds, or `/game vote`.",
          ].join("\n\n"),
        },
      ),
  ];
}

export function buildStHelpEmbeds(): EmbedBuilder[] {
  if (isMinimalMode()) {
    return [
      new EmbedBuilder()
        .setColor(GUIDE_COLOR)
        .setTitle("Storyteller guide — minimal mode")
        .setDescription(
          [
            "**Quick start**",
            "1. `/game do setup` in the town channel — pick existing `st:`, `player_role:`, and `kib:` roles",
            "2. `/st do setup-town` with `players:` @mentions in **seat order** (any player count)",
            "3. `/st do say` from kib to broadcast to all player threads",
            "4. `/st remind` / `/st set-reminders` for scheduled pings (ST role or allowlist)",
            "5. `/st do end` — strips game roles, cancels reminders, opens kib for post-game chat",
            "",
            "Prefer typing less? **`/st do`** filters actions as you type. Mid-game buttons: **`/st panel`**.",
          ].join("\n"),
        )
        .addFields(
          {
            name: "How to run commands",
            value: [
              cmd("/st do", "Pick an action via autocomplete, then fill only the options that action needs."),
              cmd("/st panel", "Pin/refresh button controls in the kib thread (resolve, execute, votes, …)."),
            ].join("\n\n"),
          },
          {
            name: "Setup & town (`/st do …`)",
            value: [
              cmd("setup-town", "Needs `players:` ordered @mentions — assigns player role + creates threads."),
              cmd("say", "Needs `message:` — broadcast from **kib** to every personal player thread."),
              cmd("end", "End game: remove roles from players, cancel reminders, open kib."),
              cmd("add-spectator / remove-spectator", "Needs `user:` — assigns/removes the kib role."),
            ].join("\n\n"),
          },
          {
            name: "Day testing (`/st do …` or panel — allowlist voting only)",
            value: [
              cmd("resolve-next", "Resolve the oldest open nomination."),
              cmd("execute", "Needs `player:` after a passed nomination."),
              cmd("votes", "Refresh the ST vote tracker (Lock/Unlock lives there)."),
              cmd("vote-visibility", "Needs `mode:` public or secret."),
              cmd("set-vote", "Needs `choice:` (+ optional voter/nominee/reason)."),
              cmd("mark-dead", "Needs `player:` (+ optional `alive:`). Corrections only — not execute."),
            ].join("\n\n"),
          },
          {
            name: "Reminders",
            value: [
              cmd("/st remind", "Schedule a reminder (requires ST role, storyteller, or allowlist)."),
              cmd("/st set-reminders", "Replace this channel’s hour-offset reminder batch (does not stack)."),
              cmd("/st reminders", "List pending reminders."),
              cmd("/st edit-reminder / delete-reminder / clear-reminders", "Manage pending reminders."),
            ].join("\n\n"),
          },
          {
            name: "Notes",
            value: [
              "Player nominate/vote is restricted to **`ALLOWED_USER_IDS`** during development.",
              "Votes live in the **Town Voting** private thread (all players + ST).",
              "Private ballots are also posted to each personal ST thread.",
              "`setup-town` also pins the **control panel** + **vote tracker** in kib.",
              "Personal player threads stay private after `/st do end`.",
            ].join("\n"),
          },
        ),
    ];
  }

  return [
    new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("Storyteller commands — full mode")
      .setDescription("Storyteller flow: lobby → setup → deal → night/day loop → end.")
      .addFields(
        {
          name: "Lobby & setup",
          value: [
            cmd("/st start", "Move from lobby to grimoire setup."),
            cmd("/st grim-setup", "Show script and composition."),
            cmd("/st open-seats", "Let players pick seats."),
            cmd("/st close-seats", "Close seat selection and announce seating."),
            cmd("/st deal", "Randomly deal roles and begin night 1."),
            cmd("/st assign", "Manually assign a role during setup."),
            cmd("/st begin-night", "Lock manual assignments and start night 1."),
          ].join("\n\n"),
        },
        {
          name: "Night & day",
          value: [
            cmd("/st night", "Advance to the next night."),
            cmd("/st day", "Advance to the next day and open the day thread."),
            cmd("/st kill", "Mark a player dead (night kill or other cause)."),
            cmd("/st pause-nominations", "Pause new nominations for a duration."),
            cmd("/st vote-visibility", "Set public or secret vote visibility."),
            cmd("/st close-nominations", "Stop new nominations and votes for the day."),
          ].join("\n\n"),
        },
        {
          name: "Nominations & end",
          value: [
            cmd("/st resolve-next", "Resolve the next open nomination."),
            cmd("/st execute", "Execute a player after a passed nomination."),
            cmd("/st set-vote", "Manually set a player's vote."),
            cmd("/st grim-reveal", "Show end-of-game role reveal."),
            cmd("/st end", "End the game and record the winner."),
          ].join("\n\n"),
        },
        {
          name: "Other",
          value: [
            cmd("/st add-spectator", "Add a user to the storyteller thread."),
            cmd("/st promote-st", "Promote a co-storyteller."),
            cmd("/st ping-players", "Ping all players."),
            cmd("/st ping-st", "Ping storytellers."),
            cmd("/st remind", "Schedule a reminder."),
            cmd("/st set-reminders", "Replace this channel’s hour-offset reminder batch."),
            cmd("/st reminders", "List pending reminders."),
          ].join("\n\n"),
        },
      ),
  ];
}

export function buildDevHelpEmbeds(): EmbedBuilder[] {
  if (isMinimalMode()) {
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
            cmd("/dev setup", "Fill lobby to min players and show role script."),
          ].join("\n\n"),
        }),
    ];
  }

  return [
    new EmbedBuilder()
      .setColor(GUIDE_COLOR)
      .setTitle("Dev commands")
      .setDescription("Available when `DEV_MODE=true`. Fake players use seat-based shortcuts.")
      .addFields(
        {
          name: "Lobby",
          value: [
            cmd("/dev fill", "Add fake players to the lobby."),
            cmd("/dev clear", "Remove all fake players."),
            cmd("/dev setup", "Fill lobby to min players and show role script."),
          ].join("\n\n"),
        },
        {
          name: "Day testing",
          value: [
            cmd("/dev day", "Start the next day (dev shortcut)."),
            cmd("/dev day-status", "Show nominations, votes, and day state."),
            cmd("/dev nominate", "Record a nomination by seat."),
            cmd("/dev set-vote", "Set a vote by seat."),
            cmd("/dev kill", "Mark a player dead by seat."),
          ].join("\n\n"),
        },
      ),
  ];
}
