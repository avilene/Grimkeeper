import { EmbedBuilder } from "discord.js";
import {
  formatBotcAbility,
  formatBotcEdition,
  formatBotcTeam,
  formatScriptRoleName,
  getBotcIconUrl,
  getBotcWikiUrl,
  getOfficialRole,
  getRoleImageUrl,
  getRoleWikiUrl,
  searchBotcRoles,
  BOTC_ROLE_SEARCH_MIN_LENGTH,
  type BotcRoleRecord,
  type GameScript,
} from "@grimkeeper/engine";

const ART_ATTRIBUTION = "Character art © The Pandemonium Institute";

function resolveRole(roleId: string, script?: GameScript | null) {
  if (script) {
    const fromScript = script.roles.find((role) => role.id === roleId);
    if (fromScript) return fromScript;
  }
  return getOfficialRole(roleId);
}

/** Lookup embed for `/role` (wiki catalog: icon, category, script, ability). */
export function buildBotcRoleLookupEmbed(
  role: BotcRoleRecord,
  options?: { alsoMatched?: BotcRoleRecord[] },
): EmbedBuilder {
  const edition = formatBotcEdition(role.edition);
  const embed = new EmbedBuilder()
    .setTitle(role.name)
    .setURL(getBotcWikiUrl(role))
    .setThumbnail(getBotcIconUrl(role))
    .setDescription(formatBotcAbility(role.ability))
    .addFields(
      { name: "Category", value: formatBotcTeam(role.team), inline: true },
      {
        name: "Script",
        value: edition ?? "Experimental / not on a base script",
        inline: true,
      },
    )
    .setFooter({ text: ART_ATTRIBUTION });

  const also = options?.alsoMatched?.filter((candidate) => candidate.id !== role.id) ?? [];
  if (also.length > 0) {
    embed.addFields({
      name: "Also matched",
      value: also
        .slice(0, 8)
        .map((candidate) => `• **${candidate.name}** (\`${candidate.id}\`)`)
        .join("\n"),
    });
  }

  return embed;
}

export function buildRoleSearchResultEmbeds(query: string): EmbedBuilder[] {
  const trimmed = query.trim();
  const matches = searchBotcRoles(trimmed, 10);
  if (
    matches.length === 0 &&
    trimmed.length < BOTC_ROLE_SEARCH_MIN_LENGTH
  ) {
    return [
      new EmbedBuilder()
        .setTitle("Keep typing")
        .setDescription(
          `Enter at least **${BOTC_ROLE_SEARCH_MIN_LENGTH}** characters to search characters.`,
        ),
    ];
  }

  if (matches.length === 0) {
    return [
      new EmbedBuilder()
        .setTitle("No characters found")
        .setDescription(
          `Nothing matched \`${trimmed}\`.\nTry another spelling, or browse with autocomplete on \`/role name:\`.`,
        ),
    ];
  }

  const best = matches[0]!;
  const close = matches
    .slice(1)
    .filter((match) => match.score >= Math.max(60, best.score - 15))
    .map((match) => match.role);

  return [buildBotcRoleLookupEmbed(best.role, { alsoMatched: close })];
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
