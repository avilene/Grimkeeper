import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  closeQueueEntry,
  findOpenEntryForOwner,
} from "@grimkeeper/database";

import {
  beginAttachForOwner,
  listQueueStatusText,
  showEditQueueModal,
  showJoinQueueModal,
} from "../interactions/st-queue.js";
import { getConfiguredQueueThreadId, refreshQueuePanel } from "../st-queue-board.js";
import {
  replyOrEditInteraction,
  requireCommandAccess,
} from "./command-context.js";

@Discord()
@SlashGroup({
  name: "queue",
  description: "Storyteller queue — who's ready to run",
  root: "st",
})
@SlashGroup("queue", "st")
export class StQueueCommands {
  @Slash({ name: "show", description: "Show the current ST queue (works from any channel)" })
  async show(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const text = await listQueueStatusText(interaction.guildId);
    await replyOrEditInteraction(interaction, {
      content: text,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "join", description: "Join the ST queue (opens a form for script + notes)" })
  async join(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!getConfiguredQueueThreadId()) {
      await replyOrEditInteraction(interaction, {
        content: "ST queue is not configured (`ST_QUEUE_THREAD_ID`).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const existing = await findOpenEntryForOwner(interaction.guildId, interaction.user.id);
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
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const entry = await findOpenEntryForOwner(interaction.guildId, interaction.user.id);
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
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId || !interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const entry = await findOpenEntryForOwner(interaction.guildId, interaction.user.id);
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
    if (!(await requireCommandAccess(interaction))) return;
    const content = await beginAttachForOwner(interaction);
    await replyOrEditInteraction(interaction, {
      content,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "refresh", description: "Refresh the live queue panel in the board thread" })
  async refresh(interaction: CommandInteraction): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;
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
        content: `Queue panel refreshed in <#${result.boardThreadId}> (${result.entryCount} open).`,
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
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId || !interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { listOpenQueueEntries, addQueueMember, removeQueueMember } = await import(
      "@grimkeeper/database"
    );
    const entries = await listOpenQueueEntries(interaction.guildId);
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
    if (!(await requireCommandAccess(interaction))) return;
    if (!interaction.guildId || !interaction.guild) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const entry = await findOpenEntryForOwner(interaction.guildId, interaction.user.id);
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
