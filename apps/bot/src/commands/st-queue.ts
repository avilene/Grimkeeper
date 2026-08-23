import {
  ApplicationCommandOptionType,
  ChannelType,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  closeQueueEntry,
  ensureQueueBoard,
  findOpenEntryForOwner,
} from "@grimkeeper/database";

import {
  beginAttachForOwner,
  listQueueStatusText,
  showEditQueueModal,
  showJoinQueueModal,
} from "../interactions/st-queue.js";
import {
  resolveQueueThreadIdForGuild,
  refreshQueuePanel,
} from "../st-queue-board.js";
import {
  replyOrEditInteraction,
  requireCommandAccess,
} from "./command-context.js";

/**
 * Public queue actions (show / join / signup / …) — anyone in the server.
 * Configuring the board (`set`) stays allowlist-gated.
 */
async function requireQueueGuild(interaction: CommandInteraction): Promise<boolean> {
  if (!interaction.guildId) {
    await replyOrEditInteraction(interaction, {
      content: "Use this in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

@Discord()
@SlashGroup({
  name: "queue",
  description: "Storyteller queue — who's ready to run",
  root: "st",
})
@SlashGroup("queue", "st")
export class StQueueCommands {
  @Slash({
    name: "show",
    description: "Show the current ST queue (DM if used in the queue channel)",
  })
  async show(interaction: CommandInteraction): Promise<void> {
    if (!(await requireQueueGuild(interaction))) return;
    const guildId = interaction.guildId!;
    const text = await listQueueStatusText(guildId);
    const queueThreadId = await resolveQueueThreadIdForGuild(guildId);
    const inQueueChannel = Boolean(queueThreadId && interaction.channelId === queueThreadId);

    if (inQueueChannel) {
      try {
        await interaction.user.send({ content: text });
        await replyOrEditInteraction(interaction, {
          content: "Sent the queue status to your DMs.",
          flags: MessageFlags.Ephemeral,
        });
      } catch {
        await replyOrEditInteraction(interaction, {
          content: `Couldn't DM you (check privacy settings). Here's the queue:\n\n${text}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    await replyOrEditInteraction(interaction, {
      content: text,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "set",
    description: "Mark this thread as the ST queue board (admin / allowlist)",
  })
  async set(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId || !interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.channel;
    const isThread =
      channel?.isThread?.() === true ||
      channel?.type === ChannelType.PublicThread ||
      channel?.type === ChannelType.PrivateThread ||
      channel?.type === ChannelType.AnnouncementThread;

    if (!channel || !isThread) {
      await replyOrEditInteraction(interaction, {
        content: "Run `/st queue set` inside the thread you want as the ST queue board.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await ensureQueueBoard(interaction.guildId, channel.id);
    try {
      const result = await refreshQueuePanel(interaction.guild);
      await replyOrEditInteraction(interaction, {
        content: `Marked <#${result.boardThreadId}> as the ST queue board and posted the live panel (${result.entryCount} open).`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyOrEditInteraction(interaction, {
        content:
          error instanceof Error
            ? `Board thread saved, but panel refresh failed: ${error.message}`
            : "Board thread saved, but panel refresh failed.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({ name: "join", description: "Join the ST queue (opens a form for script + notes)" })
  async join(interaction: CommandInteraction): Promise<void> {
    if (!(await requireQueueGuild(interaction))) return;
    const guildId = interaction.guildId!;
    if (!(await resolveQueueThreadIdForGuild(guildId))) {
      await replyOrEditInteraction(interaction, {
        content:
          "ST queue is not configured. An admin should run `/st queue set` in the board thread.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const existing = await findOpenEntryForOwner(guildId, interaction.user.id);
    if (existing) {
      await replyOrEditInteraction(interaction, {
        content: `You already have an open entry (**${existing.scriptName}**). Use \`/st queue edit\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await showJoinQueueModal(interaction);
  }

  @Slash({ name: "edit", description: "Edit your open ST queue entry" })
  async edit(interaction: CommandInteraction): Promise<void> {
    if (!(await requireQueueGuild(interaction))) return;
    const entry = await findOpenEntryForOwner(interaction.guildId!, interaction.user.id);
    if (!entry) {
      await replyOrEditInteraction(interaction, {
        content: "You don't have an open queue entry. Use `/st queue join`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await showEditQueueModal(interaction, entry.id);
  }

  @Slash({ name: "leave", description: "Close your open ST queue entry" })
  async leave(interaction: CommandInteraction): Promise<void> {
    if (!(await requireQueueGuild(interaction))) return;
    if (!interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const entry = await findOpenEntryForOwner(interaction.guildId!, interaction.user.id);
    if (!entry) {
      await replyOrEditInteraction(interaction, {
        content: "You don't have an open queue entry.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await closeQueueEntry(entry.id);
    try {
      await refreshQueuePanel(interaction.guild);
    } catch {
      // ignore panel errors
    }
    await replyOrEditInteraction(interaction, {
      content: `Closed **${entry.scriptName}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "attach",
    description: "Attach script images: send image uploads in this channel within 2 minutes",
  })
  async attach(interaction: CommandInteraction): Promise<void> {
    if (!(await requireQueueGuild(interaction))) return;
    const content = await beginAttachForOwner(interaction);
    await replyOrEditInteraction(interaction, {
      content,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "refresh", description: "Refresh (and bump) the live queue panel in the board thread" })
  async refresh(interaction: CommandInteraction): Promise<void> {
    if (!(await requireQueueGuild(interaction))) return;
    if (!interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    try {
      const result = await refreshQueuePanel(interaction.guild);
      await replyOrEditInteraction(interaction, {
        content: `Queue panel refreshed in <#${result.boardThreadId}> (${result.entryCount} open)${
          result.reposted ? " — thread bumped" : ""
        }.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await replyOrEditInteraction(interaction, {
        content: error instanceof Error ? error.message : "Could not refresh the queue panel.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "signup",
    description: "Sign up (or leave) as a player on a queue entry by number",
  })
  async signup(
    @SlashOption({
      name: "position",
      description: "Queue position (1 = first)",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
    })
    position: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireQueueGuild(interaction))) return;
    if (!interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { listOpenQueueEntries, addQueueMember, removeQueueMember } = await import(
      "@grimkeeper/database"
    );
    const entries = await listOpenQueueEntries(interaction.guildId!);
    const entry = entries[position - 1];
    if (!entry) {
      await replyOrEditInteraction(interaction, {
        content: `No entry at position ${position}. Use \`/st queue show\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (entry.ownerDiscordId === interaction.user.id) {
      await replyOrEditInteraction(interaction, {
        content: "You're already the ST for that entry.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const already = entry.members.some(
      (m) => m.discordUserId === interaction.user.id && m.role === "player",
    );
    if (already) {
      await removeQueueMember(entry.id, interaction.user.id, "player");
      try {
        await refreshQueuePanel(interaction.guild);
      } catch {
        /* ignore */
      }
      await replyOrEditInteraction(interaction, {
        content: `Removed your signup from **${entry.scriptName}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await addQueueMember(entry.id, interaction.user.id, "player");
    try {
      await refreshQueuePanel(interaction.guild);
    } catch {
      /* ignore */
    }
    await replyOrEditInteraction(interaction, {
      content: `Signed up as a player for **${entry.scriptName}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "add-cost",
    description: "Add a co-storyteller to your open queue entry",
  })
  async addCost(
    @SlashOption({
      name: "user",
      description: "Co-storyteller to add",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: { id: string },
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireQueueGuild(interaction))) return;
    if (!interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const entry = await findOpenEntryForOwner(interaction.guildId!, interaction.user.id);
    if (!entry) {
      await replyOrEditInteraction(interaction, {
        content: "You don't have an open queue entry.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (user.id === interaction.user.id) {
      await replyOrEditInteraction(interaction, {
        content: "You're already the owner.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const { addQueueMember } = await import("@grimkeeper/database");
    await addQueueMember(entry.id, user.id, "co_st");
    try {
      await refreshQueuePanel(interaction.guild);
    } catch {
      /* ignore */
    }
    await replyOrEditInteraction(interaction, {
      content: `Added <@${user.id}> as co-ST on **${entry.scriptName}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
