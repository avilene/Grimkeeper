import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  CommandInteraction,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { searchBotcRoles, BOTC_ROLE_SEARCH_MIN_LENGTH } from "@grimkeeper/engine";

import { replyOrEditInteraction } from "./command-context.js";
import { buildRoleSearchResultEmbeds } from "../role-embed.js";

async function respondRoleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "name") {
    await interaction.respond([]);
    return;
  }

  if (focused.value.trim().length < BOTC_ROLE_SEARCH_MIN_LENGTH) {
    await interaction.respond([]);
    return;
  }

  const matches = searchBotcRoles(focused.value, 25);
  await interaction.respond(
    matches.map(({ role }) => ({
      name: `${role.name} (${formatTeamShort(role.team)})`.slice(0, 100),
      value: role.id,
    })),
  );
}

function formatTeamShort(team: string): string {
  switch (team) {
    case "townsfolk":
      return "Townsfolk";
    case "outsider":
      return "Outsider";
    case "minion":
      return "Minion";
    case "demon":
      return "Demon";
    case "traveler":
      return "Traveler";
    default:
      return team;
  }
}

@Discord()
export class RoleLookupCommands {
  @Slash({
    name: "role",
    description: "Look up a BotC character (fuzzy name search, includes travelers)",
  })
  async role(
    @SlashOption({
      name: "name",
      description: "Character name (at least 3 characters)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: respondRoleAutocomplete,
    })
    name: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await replyOrEditInteraction(interaction, {
      embeds: buildRoleSearchResultEmbeds(name),
    });
  }
}
