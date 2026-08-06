import {
  ApplicationCommandOptionType,
  Attachment,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  createInterestPost,
  deleteInterestPost,
  setInterestPostMessageId,
} from "@grimkeeper/database";

import { buildInterestMessagePayload } from "../interest-post.js";
import {
  replyOrEditInteraction,
  requireCommandAccess,
} from "./command-context.js";

function isLikelyImageAttachment(attachment: Attachment): boolean {
  const type = attachment.contentType ?? "";
  if (type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(attachment.name ?? "");
}

function isMissingAccessError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: unknown }).code === 50001,
  );
}

@Discord()
@SlashGroup({ name: "interest", description: "Interest checks (signups before a real game)" })
@SlashGroup("interest")
export class InterestCommands {
  @Slash({
    name: "create",
    description: "Post an interest check with Playing / KIB / Backup signups",
  })
  async create(
    @SlashOption({
      name: "title",
      description: "Script or game title",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    title: string,
    @SlashOption({
      name: "script",
      description: "Script URL (e.g. botcscripts.com)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    script: string | undefined,
    @SlashOption({
      name: "description",
      description: "Notes for interested players",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    description: string | undefined,
    @SlashOption({
      name: "image",
      description: "Optional script / flyer image",
      type: ApplicationCommandOptionType.Attachment,
      required: false,
    })
    image: Attachment | undefined,
    @SlashOption({
      name: "max_players",
      description: "Optional playing capacity (shown as Playing n/max)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 50,
    })
    maxPlayers: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireCommandAccess(interaction))) return;

    if (!interaction.guildId || !interaction.channelId) {
      await replyOrEditInteraction(interaction, {
        content: "Use this in a server channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (image && !isLikelyImageAttachment(image)) {
      await replyOrEditInteraction(interaction, {
        content: "The attachment must be an image (png, jpg, gif, or webp).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const scriptUrl = (script ?? "").trim();
    if (scriptUrl && !/^https?:\/\//i.test(scriptUrl)) {
      await replyOrEditInteraction(interaction, {
        content: "Script URL must start with http:// or https://.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.channel;
    if (!channel || !("send" in channel)) {
      await replyOrEditInteraction(interaction, {
        content: "Couldn't post in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const post = await createInterestPost({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      ownerId: interaction.user.id,
      title,
      description,
      scriptUrl,
      imageUrl: image?.url,
      maxPlayers: maxPlayers ?? null,
    });

    const payload = buildInterestMessagePayload(post);

    try {
      // Post via channel API (not interaction.reply) so we fail clearly when the bot
      // lacks View Channel / Send Messages — signup buttons need that access too.
      const message = await channel.send(payload);
      await setInterestPostMessageId(post.id, message.id);
      await replyOrEditInteraction(interaction, {
        content: `Interest check posted: ${message.url}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await deleteInterestPost(post.id).catch(() => undefined);
      if (isMissingAccessError(error)) {
        await replyOrEditInteraction(interaction, {
          content:
            "Missing access to this channel. Add the Grimkeeper bot with **View Channel** and **Send Messages**, then try again.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      throw error;
    }
  }
}
