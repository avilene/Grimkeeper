import type { Guild, User } from "discord.js";
import { listGameWhispers, prisma } from "@grimkeeper/database";
import type { GameEngine, PlayerState } from "@grimkeeper/engine";

import { fetchGuildMemberWithTimeout } from "./access.js";
import {
  addUserToPlayerStThreads,
  findPersonalPlayerThread,
  removeUserFromPlayerStThreads,
  type GameRoleIds,
} from "./commands/command-context.js";
import { addUserToGameWhispers, removeUserFromGameWhispers } from "./whisper-thread.js";

export type BackpackGame = GameRoleIds & {
  id: string;
  channelId: string;
  stRoleId?: string | null;
  kibRoleId?: string | null;
};

export type BackpackResult =
  | { ok: true; stThreads: number; whisperThreads: number; message: string }
  | { ok: false; message: string };

/**
 * Backpackers must not already hold this game’s ST or kib Discord role.
 */
export async function assertEligibleBackpacker(
  guild: Guild,
  game: BackpackGame,
  user: User,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (user.bot) {
    return { ok: false, message: "Cannot backpack a bot account." };
  }

  const member = await fetchGuildMemberWithTimeout(guild, user.id, undefined, { force: true });
  if (!member) {
    return { ok: false, message: "Could not find that user in this server." };
  }
  if (game.stRoleId && member.roles.cache.has(game.stRoleId)) {
    return {
      ok: false,
      message: "That user has this game’s storyteller role — use `/st do add-st` instead.",
    };
  }
  if (game.kibRoleId && member.roles.cache.has(game.kibRoleId)) {
    return {
      ok: false,
      message: "That user has this game’s kib role — remove kib first, or pick someone else.",
    };
  }
  return { ok: true };
}

/** Invite a guest into whisper threads where `hostUserId` is a participant. */
export async function addUserToHostWhispers(
  guild: Guild,
  gameId: string,
  hostUserId: string,
  guestUserId: string,
): Promise<number> {
  const whispers = await listGameWhispers(gameId);
  let updated = 0;
  for (const whisper of whispers) {
    const participants = whisper.participantKey.split(",").filter(Boolean);
    if (!participants.includes(hostUserId)) continue;
    if (participants.includes(guestUserId)) continue;

    const channel = await guild.channels.fetch(whisper.threadId).catch(() => null);
    if (!channel?.isThread()) continue;
    if (channel.archived) {
      await channel.setArchived(false, "Adding backpacker to whisper.").catch(() => undefined);
    }
    const ok = await channel.members.add(guestUserId).then(() => true).catch(() => false);
    if (ok) updated++;
  }
  return updated;
}

/** Remove a guest from whisper threads where `hostUserId` is a participant (skip if guest is a listed participant). */
export async function removeUserFromHostWhispers(
  guild: Guild,
  gameId: string,
  hostUserId: string,
  guestUserId: string,
): Promise<number> {
  const whispers = await listGameWhispers(gameId);
  let updated = 0;
  for (const whisper of whispers) {
    const participants = whisper.participantKey.split(",").filter(Boolean);
    if (!participants.includes(hostUserId)) continue;
    if (participants.includes(guestUserId)) continue;

    const channel = await guild.channels.fetch(whisper.threadId).catch(() => null);
    if (!channel?.isThread()) continue;
    if (channel.archived) {
      await channel.setArchived(false, "Removing backpacker from whisper.").catch(() => undefined);
    }
    const ok = await channel.members.remove(guestUserId).then(() => true).catch(() => false);
    if (ok) updated++;
  }
  return updated;
}

async function addToHostStThread(
  guild: Guild,
  game: BackpackGame,
  host: PlayerState,
  guestUserId: string,
): Promise<{ ok: boolean; threadId?: string }> {
  const row = await prisma.player.findUnique({
    where: {
      gameId_discordUserId: { gameId: game.id, discordUserId: host.discordUserId },
    },
    select: { stThreadId: true },
  });
  const thread = await findPersonalPlayerThread(
    guild,
    game.channelId,
    game.id,
    host.displayName,
    undefined,
    row?.stThreadId ?? null,
  );
  if (!thread?.isThread()) return { ok: false };
  if (thread.archived) {
    await thread.setArchived(false, "Adding backpacker to player ST thread.").catch(() => undefined);
  }
  const ok = await thread.members.add(guestUserId).then(() => true).catch(() => false);
  return ok ? { ok: true, threadId: thread.id } : { ok: false, threadId: thread.id };
}

async function removeFromHostStThread(
  guild: Guild,
  game: BackpackGame,
  host: PlayerState,
  guestUserId: string,
): Promise<{ ok: boolean; threadId?: string }> {
  const row = await prisma.player.findUnique({
    where: {
      gameId_discordUserId: { gameId: game.id, discordUserId: host.discordUserId },
    },
    select: { stThreadId: true },
  });
  const thread = await findPersonalPlayerThread(
    guild,
    game.channelId,
    game.id,
    host.displayName,
    undefined,
    row?.stThreadId ?? null,
  );
  if (!thread?.isThread()) return { ok: false };
  if (thread.archived) {
    await thread
      .setArchived(false, "Removing backpacker from player ST thread.")
      .catch(() => undefined);
  }
  const ok = await thread.members.remove(guestUserId).then(() => true).catch(() => false);
  return ok ? { ok: true, threadId: thread.id } : { ok: false, threadId: thread.id };
}

/** Add a backpacker to one host’s ST thread + whispers that host is in. */
export async function addBackpackerForHost(
  guild: Guild,
  game: BackpackGame,
  host: PlayerState,
  guest: User,
): Promise<BackpackResult> {
  if (host.discordUserId === guest.id) {
    return { ok: false, message: "You cannot backpack yourself." };
  }
  const eligible = await assertEligibleBackpacker(guild, game, guest);
  if (!eligible.ok) return eligible;

  const st = await addToHostStThread(guild, game, host, guest.id);
  const whisperThreads = await addUserToHostWhispers(guild, game.id, host.discordUserId, guest.id);

  if (!st.ok && whisperThreads === 0) {
    return {
      ok: false,
      message: st.threadId
        ? "Could not add that user to your ST thread (check bot Manage Threads permission)."
        : "No ST thread found for you. Ask the ST to run `/st recreate-player-thread`.",
    };
  }

  const hints = [
    st.ok && st.threadId ? `<#${st.threadId}>` : null,
    whisperThreads > 0
      ? `**${whisperThreads}** whisper thread${whisperThreads === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return {
    ok: true,
    stThreads: st.ok ? 1 : 0,
    whisperThreads,
    message: `Added <@${guest.id}> as a backpacker to ${hints.join(" and ")}.`,
  };
}

/** Remove a backpacker from one host’s ST thread + whispers that host is in. */
export async function removeBackpackerForHost(
  guild: Guild,
  game: BackpackGame,
  host: PlayerState,
  guest: User,
): Promise<BackpackResult> {
  const st = await removeFromHostStThread(guild, game, host, guest.id);
  const whisperThreads = await removeUserFromHostWhispers(
    guild,
    game.id,
    host.discordUserId,
    guest.id,
  );

  if (!st.ok && whisperThreads === 0) {
    return {
      ok: false,
      message: st.threadId
        ? `<@${guest.id}> was not removed from your ST thread (or was not a member).`
        : "No ST thread found for you.",
    };
  }

  const hints = [
    st.ok && st.threadId ? `<#${st.threadId}>` : null,
    whisperThreads > 0
      ? `**${whisperThreads}** whisper thread${whisperThreads === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return {
    ok: true,
    stThreads: st.ok ? 1 : 0,
    whisperThreads,
    message: `Removed <@${guest.id}> from ${hints.join(" and ")}.`,
  };
}

/** ST mass-add: every player ST thread + every whisper. */
export async function addBackpackerEverywhere(
  guild: Guild,
  game: BackpackGame,
  engine: GameEngine,
  guest: User,
): Promise<BackpackResult> {
  const eligible = await assertEligibleBackpacker(guild, game, guest);
  if (!eligible.ok) return eligible;

  const { attempted, added } = await addUserToPlayerStThreads(guild, game, engine, guest.id);
  const whisperThreads = await addUserToGameWhispers(guild, game.id, guest.id);

  if (attempted === 0 && whisperThreads === 0) {
    return {
      ok: false,
      message: "No player ST or whisper threads found. Run `/st setup-town` or open whispers first.",
    };
  }

  const hints = [
    added > 0
      ? `**${added}** player ST thread${added === 1 ? "" : "s"}`
      : attempted > 0
        ? `0/${attempted} player ST threads (check Manage Threads)`
        : null,
    whisperThreads > 0
      ? `**${whisperThreads}** whisper thread${whisperThreads === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  if (hints.length === 0) {
    return {
      ok: false,
      message: `Could not add <@${guest.id}> to any threads (check bot Manage Threads permission).`,
    };
  }

  return {
    ok: true,
    stThreads: added,
    whisperThreads,
    message: `Added <@${guest.id}> as a backpacker to ${hints.join(" and ")} (no ST/kib role).`,
  };
}

/** ST mass-remove: every player ST thread + every whisper (observer seats only). */
export async function removeBackpackerEverywhere(
  guild: Guild,
  game: BackpackGame,
  engine: GameEngine,
  guest: User,
): Promise<BackpackResult> {
  const { attempted, removed } = await removeUserFromPlayerStThreads(guild, game, engine, guest.id);
  const whisperThreads = await removeUserFromGameWhispers(guild, game.id, guest.id);

  if (attempted === 0 && whisperThreads === 0) {
    return {
      ok: false,
      message: "No player ST or whisper threads found for this game.",
    };
  }

  const hints = [
    removed > 0
      ? `**${removed}** player ST thread${removed === 1 ? "" : "s"}`
      : attempted > 0
        ? `0/${attempted} player ST threads`
        : null,
    whisperThreads > 0
      ? `**${whisperThreads}** whisper thread${whisperThreads === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  if (hints.length === 0) {
    return {
      ok: false,
      message: `<@${guest.id}> was not a member of any player ST or whisper threads (or removal failed).`,
    };
  }

  return {
    ok: true,
    stThreads: removed,
    whisperThreads,
    message: `Removed <@${guest.id}> from ${hints.join(" and ")}.`,
  };
}
