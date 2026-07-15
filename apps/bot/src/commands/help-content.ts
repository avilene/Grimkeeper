import { EmbedBuilder } from "discord.js";

import { isMinimalMode, minPlayersForMode } from "../bot-mode.js";

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
            "Nominations and votes happen in the **Town Voting** thread after `/st setup-town`.",
            "You can also cast a **private ballot** from your personal ST thread.",
            "",
            "Storytellers: see **`/st help`** for setup and day control.",
          ].join("\n"),
        )
        .addFields(
          {
            name: "Lobby",
            value: [
              cmd("/game create", "Create a game in this channel."),
              cmd("/game join", "Join the lobby (optional — ST can set roster with setup-town)."),
              cmd("/game leave", "Leave the lobby."),
              cmd("/game list", "List active games in this server."),
            ].join("\n\n"),
          },
          {
            name: "Nominations & votes",
            value: [
              cmd("/game nominate", "Nominate another player (town or voting thread)."),
              cmd("/game defend", "Add your defense to an open nomination against you."),
              cmd("/game vote", "Vote yes / no / conditional on any open nomination."),
              cmd("/game roster", "Show seat order and alive/dead status."),
            ].join("\n\n"),
          },
          {
            name: "Voting venues",
            value: [
              "**Town Voting** thread — shared embeds + Vote buttons; public results when visibility is public.",
              "**Personal ST thread** — private ballot (Vote button); confirmations stay ephemeral.",
              "You can vote on **any** open nomination; embeds update tallies after each vote.",
              "Use `/st vote-visibility` for public vs secret tallies.",
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
    const minPlayers = minPlayersForMode();
    return [
      new EmbedBuilder()
        .setColor(GUIDE_COLOR)
        .setTitle("Storyteller guide — minimal mode")
        .setDescription(
          [
            "**Quick start**",
            `1. \`/game create\` in the town channel`,
            `2. \`/st setup-town players:\` @mentions in **seat order** (min ${minPlayers} players)`,
            "3. Players nominate and vote in **Town Voting** (or privately in ST threads)",
            "4. \`/st resolve-next\` → \`/st execute\` if passed",
          ].join("\n"),
        )
        .addFields(
          {
            name: "Setup & town",
            value: [
              cmd("/st setup-town", "Set roster + seats, create ST threads + Town Voting thread."),
              cmd("/st end", "End the game."),
            ].join("\n\n"),
          },
          {
            name: "Nominations & votes",
            value: [
              cmd("/st resolve-next", "Resolve the oldest open nomination (majority pass/fail)."),
              cmd("/st execute", "Execute a player after their nomination passed."),
              cmd("/st set-vote", "Manually set a player's vote on a nomination."),
              cmd("/st vote-visibility", "Public or secret vote tallies."),
              cmd("/st votes", "Refresh the ST vote tracker in the kib thread."),
            ].join("\n\n"),
          },
          {
            name: "Player status",
            value: [
              cmd("/st mark-dead", "Mark a player dead or alive (ST correction; reversible)."),
              "`alive:false` (default) = dead · `alive:true` = alive again",
              "**Execute** = official kill after a passed nomination. **Mark-dead** = ST corrections only.",
            ].join("\n"),
          },
          {
            name: "Spectators & reminders",
            value: [
              cmd("/st add-spectator", "Assign spectator role and kib thread access."),
              cmd("/st remove-spectator", "Remove spectator role."),
              cmd("/st remind", "Schedule a reminder in the town channel."),
              cmd("/st set-reminders", "Schedule repeating hourly reminders."),
              cmd("/st reminders", "List pending reminders."),
              cmd("/st edit-reminder", "Update a pending reminder."),
              cmd("/st delete-reminder", "Cancel one reminder by ID prefix."),
              cmd("/st clear-reminders", "Cancel all pending reminders."),
            ].join("\n\n"),
          },
          {
            name: "Notes",
            value: [
              "Votes live in the **Town Voting** private thread (all players + ST).",
              "Private ballots are also posted to each personal ST thread.",
              "ST: pin a **vote tracker** in kib (`/st votes`) with full rolls + Lock/Unlock buttons.",
              "A player can only have **one open nomination** at a time (as nominator or nominee).",
              "Seat order = mention order in `/st setup-town`.",
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
            cmd("/st set-reminders", "Schedule repeating hourly reminders."),
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
