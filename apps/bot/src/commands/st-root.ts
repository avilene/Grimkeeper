import {
  ApplicationCommandOptionType,
  CommandInteraction,
  User,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";

import { requireCommandAccess } from "./command-context.js";
import { StCommandsMinimal } from "./st-minimal.js";

const st = new StCommandsMinimal();

async function runSt(
  interaction: CommandInteraction | undefined,
  run: () => Promise<void>,
): Promise<void> {
  if (!interaction) return;
  if (!(await requireCommandAccess(interaction))) return;
  await run();
}

/**
 * True top-level ST slash commands (`/add-kib`, `/archive`, …).
 * Delegates to the same handlers as `/st do` and `/st …` shortcuts.
 */
@Discord()
export class StRootCommands {
  @Slash({
    name: "setup-town",
    description: "Set roster + seats from ordered @mentions",
  })
  async setupTown(
    @SlashOption({
      name: "players",
      description: "Ordered @mentions in seat order",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    players: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.setupTown(players, interaction));
  }

  @Slash({
    name: "broadcast",
    description: "Broadcast to all player ST threads from kib",
  })
  async broadcast(
    @SlashOption({
      name: "message",
      description: "Text to send to every player ST thread",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    message: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.broadcast(message, interaction));
  }

  @Slash({
    name: "log",
    description: "Create or reopen the ST-only audit log",
  })
  async log(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.log(interaction));
  }

  @Slash({
    name: "end",
    description: "End the game and open kib",
  })
  async end(
    @SlashChoice({ name: "Good wins", value: "good" })
    @SlashChoice({ name: "Evil wins", value: "evil" })
    @SlashChoice({ name: "Cancel", value: "cancel" })
    @SlashOption({
      name: "winner",
      description: "Which team won",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    winner: "good" | "evil" | "cancel",
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.end(winner, interaction));
  }

  @Slash({
    name: "next-phase",
    description: "Advance Setup → Night 1 → Day 1 → …",
  })
  async nextPhase(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.nextPhase(interaction));
  }

  @Slash({
    name: "recreate-player-thread",
    description: "Create or reopen one player's private ST thread",
  })
  async recreatePlayerThread(
    @SlashOption({
      name: "player",
      description: "Player whose ST thread to recreate",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    player: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.recreatePlayerThread(player, interaction));
  }

  @Slash({
    name: "close-nominations",
    description: "Close nominations for the day",
  })
  async closeNominations(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.closeNominations(interaction));
  }

  @Slash({
    name: "refresh-noms",
    description: "Push nomination/vote DB state to Discord",
  })
  async refreshNoms(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.refreshNoms(interaction));
  }

  @Slash({
    name: "st-nominate",
    description: "Nominate on behalf of a player (ST)",
  })
  async stNominate(
    @SlashOption({
      name: "nominator",
      description: "Player making the nomination",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    nominator: User,
    @SlashOption({
      name: "nominee",
      description: "Player being nominated",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    nominee: User,
    @SlashOption({
      name: "accusation",
      description: "Accusation text",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    accusation: string,
    @SlashOption({
      name: "override",
      description: "Allow a second nomination today for nominator and/or nominee",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    override: boolean | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    await runSt(interaction, () =>
      st.nominateFor(nominator, nominee, accusation, override, interaction),
    );
  }

  @Slash({
    name: "resolve-next",
    description: "Resolve the oldest open nomination",
  })
  async resolveNext(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.resolveNext(interaction));
  }

  @Slash({
    name: "extend-noms",
    description: "Extend every nomination deadline by N hours",
  })
  async extendNoms(
    @SlashOption({
      name: "hours",
      description: "Hours to add to each nomination's current deadline",
      type: ApplicationCommandOptionType.Number,
      required: true,
    })
    hours: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.extendNoms(hours, interaction));
  }

  @Slash({
    name: "ping-missing",
    description: "Ping all players who have not voted on a nomination",
  })
  async pingMissing(
    @SlashOption({
      name: "nominee",
      description: "Open nominee whose missing voters to ping",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    nominee: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.pingMissing(nominee, interaction));
  }

  @Slash({
    name: "sub",
    description: "Substitute a seated player with another Discord user",
  })
  async sub(
    @SlashOption({
      name: "oldplayer",
      description: "Seated player being replaced",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    oldplayer: User,
    @SlashOption({
      name: "newplayer",
      description: "Discord user taking the seat",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    newplayer: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.substitutePlayer(oldplayer, newplayer, interaction));
  }

  @Slash({
    name: "execute",
    description: "Execute a player after a passed nomination",
  })
  async execute(
    @SlashOption({
      name: "player",
      description: "Player to execute",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    player: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.execute(player, interaction));
  }

  @Slash({
    name: "mark-dead",
    description: "Mark a player dead or alive",
  })
  async markDead(
    @SlashOption({
      name: "player",
      description: "Player to mark",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    player: User,
    @SlashOption({
      name: "alive",
      description: "true = alive, false = dead (default false)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    alive: boolean | undefined,
    @SlashOption({
      name: "banshee",
      description: "Demon killed the Banshee — grant double nominate/vote and announce",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    banshee: boolean | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    await runSt(interaction, () => st.markDead(player, alive, interaction, banshee));
  }

  @Slash({
    name: "panel",
    description: "Post or refresh the ST control panel (buttons) in kib",
  })
  async panel(interaction: CommandInteraction): Promise<void> {
    await st.panel(interaction);
  }

  @Slash({
    name: "add-kib",
    description: "Assign kib role (+ thread access when kib is a thread)",
  })
  async addKib(
    @SlashOption({
      name: "user",
      description: "User to add as kib/spectator",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.addSpectator(user, interaction));
  }

  @Slash({
    name: "remove-kib",
    description: "Remove kib role from a user",
  })
  async removeKib(
    @SlashOption({
      name: "user",
      description: "User to remove from kib/spectator",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.removeSpectator(user, interaction));
  }

  @Slash({
    name: "mark",
    description: "Mark this thread as Town Voting, Rules, Public Claims, or Whisper Declaration",
  })
  async mark(
    @SlashChoice({ name: "Town Voting", value: "voting" })
    @SlashChoice({ name: "Rules", value: "rules" })
    @SlashChoice({ name: "Public Claims", value: "claims" })
    @SlashChoice({ name: "Whisper Declaration", value: "whisper" })
    @SlashOption({
      name: "surface",
      description: "Which town thread this should be",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    surface: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await st.mark(surface, interaction);
  }

  @Slash({
    name: "archive",
    description: "Open town/kib for reading and lock channels/threads read-only",
  })
  async archive(
    @SlashOption({
      name: "dry_run",
      description: "Preview changes without applying them",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    dry_run: boolean | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    await runSt(interaction, () => st.archive(interaction, dry_run ?? false));
  }

  @Slash({
    name: "fail-open-noms",
    description: "Force-fail every open nomination",
  })
  async failOpenNoms(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.failOpenNoms(interaction));
  }

  @Slash({
    name: "repost-kib-noms",
    description: "Delete and repost open nomination embeds at the bottom of kib",
  })
  async repostKibNoms(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.repostKibNoms(interaction));
  }

  @Slash({
    name: "votes",
    description: "Refresh the ST vote tracker and Town Voting nomination embeds",
  })
  async votes(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.votes(interaction));
  }

  @Slash({
    name: "vote-visibility",
    description: "Set public or secret vote tallies",
  })
  async voteVisibility(
    @SlashChoice({ name: "Public tallies", value: "public" })
    @SlashChoice({ name: "Secret tallies", value: "secret" })
    @SlashOption({
      name: "mode",
      description: "Public or secret tallies",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    mode: "public" | "secret",
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.voteVisibility(mode, interaction));
  }

  @Slash({
    name: "set-vote",
    description: "Manually set a player's vote",
  })
  async setVote(
    @SlashOption({
      name: "choice",
      description: "yes / no / conditional",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    choice: string,
    @SlashOption({
      name: "voter",
      description: "Who is voting",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    voter: User | undefined,
    @SlashOption({
      name: "nominee",
      description: "Nominated player",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    nominee: User | undefined,
    @SlashOption({
      name: "reason",
      description: "For conditional votes",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    await runSt(interaction, () => st.setVote(choice, voter, nominee, reason, interaction));
  }

  @Slash({
    name: "recreate-threads",
    description: "Recreate Town Voting, Whisper Declaration, Public Claims, and Rules",
  })
  async recreateThreads(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.recreateThreads(interaction));
  }

  @Slash({
    name: "add-st",
    description: "Promote a co-storyteller (ST role only)",
  })
  async addSt(
    @SlashOption({
      name: "user",
      description: "User to promote as co-ST",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.addSt(user, interaction));
  }

  @Slash({
    name: "remove-st",
    description: "Demote a co-storyteller",
  })
  async removeSt(
    @SlashOption({
      name: "user",
      description: "User to demote",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.removeSt(user, interaction));
  }

  @Slash({
    name: "sync-st-threads",
    description: "Add ST-role holders to all player ST and whisper threads",
  })
  async syncStThreads(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.syncStThreads(interaction));
  }

  @Slash({
    name: "sync-player-roles",
    description: "Give the game player role to seated players who are missing it",
  })
  async syncPlayerRoles(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.syncPlayerRoles(interaction));
  }

  @Slash({
    name: "reset-to-setup",
    description: "Wipe day/night back to Setup (ADMIN_IDS only; keeps roster)",
  })
  async resetToSetup(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.resetToSetup(interaction));
  }

  @Slash({
    name: "buffet-start",
    description: "Start the Sushi Buffet role draft",
  })
  async buffetStart(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.buffetStart(interaction));
  }

  @Slash({
    name: "buffet-status",
    description: "Show buffet draft status and recreate the kib draft tracker",
  })
  async buffetStatus(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.buffetStatus(interaction));
  }

  @Slash({
    name: "buffet-cancel",
    description: "Cancel the active Sushi Buffet draft",
  })
  async buffetCancel(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.buffetCancel(interaction));
  }

  @Slash({
    name: "buffet-assign-drunk",
    description: "ST-assign Drunk to a player (outsider-count setups)",
  })
  async buffetAssignDrunk(
    @SlashOption({
      name: "player",
      description: "Player to assign Drunk",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    player: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.buffetAssignDrunk(player, interaction));
  }

  @Slash({
    name: "buffet-assign-lunatic",
    description: "Pre-assign Lunatic to a player (enable Lunatic in admin first)",
  })
  async buffetAssignLunatic(
    @SlashOption({
      name: "player",
      description: "Player to assign Lunatic",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    player: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    await runSt(interaction, () => st.buffetAssignLunatic(player, interaction));
  }

  @Slash({
    name: "buffet-configure",
    description: "Configure buffet draft options: recycle unchosen on/off",
  })
  async buffetConfigure(
    @SlashOption({
      name: "recycle",
      description: "Recycle unchosen roles (true/false)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    recycle: boolean | undefined,
    interaction?: CommandInteraction,
  ): Promise<void> {
    if (!interaction) return;
    await runSt(interaction, () => st.buffetConfigure(recycle, interaction));
  }

  @Slash({
    name: "buffet-export-clocktower",
    description: "Export clocktower.live gamestate JSON for grimoire import",
  })
  async buffetExportClocktower(interaction: CommandInteraction): Promise<void> {
    await runSt(interaction, () => st.buffetExportClocktower(interaction));
  }
}
