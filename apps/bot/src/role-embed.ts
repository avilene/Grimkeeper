import { EmbedBuilder } from "discord.js";
import {
  formatScriptRoleName,
  getOfficialRole,
  getRoleImageUrl,
  getRoleWikiUrl,
  type GameScript,
} from "@grimkeeper/engine";

const ART_ATTRIBUTION = "Character art © The Pandemonium Institute (Community Created Content)";

function resolveRole(roleId: string, script?: GameScript | null) {
  if (script) {
    const fromScript = script.roles.find((role) => role.id === roleId);
    if (fromScript) return fromScript;
  }
  return getOfficialRole(roleId);
}

export function buildRoleEmbed(roleId: string, script?: GameScript | null): EmbedBuilder | null {
  const role = resolveRole(roleId, script);
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

export function buildRoleDmEmbed(roleId: string, script?: GameScript | null): EmbedBuilder {
  const roleName = formatScriptRoleName(script ?? null, roleId);
  const embed =
    buildRoleEmbed(roleId, script) ??
    new EmbedBuilder()
      .setTitle(`Your role: ${roleName}`)
      .setDescription("Keep it secret until the Grim Reveal.");

  if (!embed.data.description?.includes("Keep it secret")) {
    embed.setDescription(`${embed.data.description}\n\nKeep it secret until the Grim Reveal.`);
  }

  return embed;
}
