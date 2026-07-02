import { EmbedBuilder } from "discord.js";
import {
  formatRoleName,
  getRoleImageUrl,
  getRoleWikiUrl,
  getTroubleBrewingRole,
} from "@grimkeeper/engine";

const ART_ATTRIBUTION = "Character art © The Pandemonium Institute (Community Created Content)";

export function buildRoleEmbed(roleId: string): EmbedBuilder | null {
  const role = getTroubleBrewingRole(roleId);
  if (!role) return null;

  const imageUrl = getRoleImageUrl(roleId);
  const wikiUrl = getRoleWikiUrl(roleId);

  const embed = new EmbedBuilder()
    .setTitle(role.name)
    .setDescription(role.ability)
    .addFields({ name: "Type", value: role.type })
    .setFooter({ text: ART_ATTRIBUTION });

  if (imageUrl) {
    embed.setImage(imageUrl);
  }
  if (wikiUrl) {
    embed.setURL(wikiUrl);
  }

  return embed;
}

export function buildRoleDmEmbed(roleId: string): EmbedBuilder {
  const roleName = formatRoleName(roleId);
  const embed =
    buildRoleEmbed(roleId) ??
    new EmbedBuilder()
      .setTitle(`Your role: ${roleName}`)
      .setDescription("Keep it secret until the Grim Reveal.");

  if (!embed.data.description?.includes("Keep it secret")) {
    embed.setDescription(`${embed.data.description}\n\nKeep it secret until the Grim Reveal.`);
  }

  return embed;
}
