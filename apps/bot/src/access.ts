import type { CommandInteraction } from "discord.js";

function parseList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export async function canUseBot(interaction: CommandInteraction): Promise<boolean> {
  const allowedUserIds = parseList(process.env.ALLOWED_USER_IDS);
  const allowedRoleIds = parseList(process.env.ALLOWED_ROLE_IDS);
  const userId = interaction?.user?.id;

  // No restrictions configured: allow everyone.
  if (allowedUserIds.size === 0 && allowedRoleIds.size === 0) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (allowedUserIds.has(userId)) {
    return true;
  }

  if (!interaction.guildId || allowedRoleIds.size === 0) {
    return false;
  }

  const member = await interaction.guild?.members.fetch(userId).catch(() => null);
  if (!member) return false;

  return member.roles.cache.some((role) => allowedRoleIds.has(role.id));
}
