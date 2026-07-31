import type { Guild, User } from "discord.js";
import { prisma, substituteDiscordIdInGameWhispers } from "@grimkeeper/database";
import { GameCommandKind } from "@grimkeeper/engine";

import { fetchGuildMemberWithTimeout } from "./access.js";
import { resolveOrCreatePlayerAlias } from "./commands/alias.js";
import {
  loadEngine,
  loadParentThreadIndex,
  persistEvents,
  refreshAllNominationEverywhere,
  resolveVotingChannel,
  stPlayerThreadName,
  syncGameProjection,
  transferGamePlayerRole,
  type GameRoleIds,
} from "./commands/command-context.js";
import { postGameLog, postGameLogRoleChange } from "./game-log-thread.js";
import { upsertStControlPanel } from "./st-control-panel.js";
import { upsertStVoteTracker } from "./st-vote-tracker.js";

export type SubstituteGame = GameRoleIds & {
  id: string;
  channelId: string;
  guildId: string;
  kibThreadId?: string | null;
  votingThreadId?: string | null;
  stRoleId?: string | null;
  playerRoleId?: string | null;
  kibRoleId?: string | null;
};

export type SubstitutePlayerResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Hand a seat to a different Discord user: engine identity + Discord access transfer.
 */
export async function substitutePlayerInGame(
  guild: Guild,
  game: SubstituteGame,
  oldUser: User,
  newUser: User,
  actorDiscordId: string,
): Promise<SubstitutePlayerResult> {
  if (newUser.bot) {
    return { ok: false, message: "Cannot substitute with a bot account." };
  }
  if (oldUser.id === newUser.id) {
    return { ok: false, message: "Pick two different users." };
  }

  const engine = await loadEngine(game.id);
  if (engine.getState().phase === "ended") {
    return { ok: false, message: "That game has already ended." };
  }

  const oldPlayer = engine.getPlayerByDiscordId(oldUser.id);
  if (!oldPlayer) {
    return { ok: false, message: "That player is not seated in this game." };
  }
  if (oldPlayer.isFake || oldPlayer.discordUserId.startsWith("dev:")) {
    return { ok: false, message: "Cannot substitute a fake/dev player." };
  }

  if (engine.getPlayerByDiscordId(newUser.id)) {
    return { ok: false, message: "That user is already in this game." };
  }

  // Force REST — without Guild Members intent the cache is often incomplete/stale.
  const member = await fetchGuildMemberWithTimeout(guild, newUser.id, undefined, { force: true });
  if (!member) {
    return { ok: false, message: "Could not find that user in this server." };
  }
  if (game.stRoleId && member.roles.cache.has(game.stRoleId)) {
    return {
      ok: false,
      message: "That user already has this game’s storyteller role.",
    };
  }
  if (game.kibRoleId && member.roles.cache.has(game.kibRoleId)) {
    return {
      ok: false,
      message: "That user already has this game’s kib role.",
    };
  }

  const displayName = await resolveOrCreatePlayerAlias(
    guild.id,
    newUser.id,
    member.displayName || newUser.username,
  );

  const oldDiscordUserId = oldPlayer.discordUserId;
  const playerId = oldPlayer.id;
  const seat = oldPlayer.seat;
  const oldDisplayName = oldPlayer.displayName;

  const stRow = await prisma.player.findFirst({
    where: { id: playerId, gameId: game.id },
    select: { stThreadId: true },
  });

  const events = engine.handle({
    kind: GameCommandKind.SubstitutePlayer,
    gameId: game.id,
    playerId,
    newDiscordUserId: newUser.id,
    displayName,
  });
  await persistEvents(engine, events);
  await syncGameProjection(game.id, engine);

  const roleTransfer = await transferGamePlayerRole(
    guild,
    game,
    oldDiscordUserId,
    newUser.id,
  );
  let roleNote: string;
  if (roleTransfer.status === "transferred") {
    roleNote = "player role transferred";
    await postGameLogRoleChange(
      guild,
      game,
      "added",
      newUser.id,
      `<@&${roleTransfer.roleId}> (player)`,
      actorDiscordId,
    );
    await postGameLogRoleChange(
      guild,
      game,
      "removed",
      oldDiscordUserId,
      `<@&${roleTransfer.roleId}> (player)`,
      actorDiscordId,
    );
  } else if (roleTransfer.status === "missing") {
    roleNote = "player role missing — run `/game setup` with roles";
  } else if (roleTransfer.added) {
    roleNote =
      "player role added (could not remove from old user — check Manage Roles / role hierarchy)";
    await postGameLogRoleChange(
      guild,
      game,
      "added",
      newUser.id,
      `<@&${roleTransfer.roleId}> (player)`,
      actorDiscordId,
    );
  } else {
    roleNote =
      "player role **not** added — check bot Manage Roles permission and that the player role is below the bot’s highest role";
  }

  // Personal ST thread: swap members, rename if needed, keep stThreadId on the same seat.
  let stThreadNote = "no ST thread found";
  const storedThreadId = stRow?.stThreadId ?? null;
  let thread =
    storedThreadId != null
      ? await guild.channels.fetch(storedThreadId).catch(() => null)
      : null;
  if (!thread?.isThread()) {
    // listPersonalPlayerThreads searches by the *new* player name after syncGameProjection,
    // so it will miss the old thread (e.g. "ST Star") before it has been renamed.
    // Search the thread index directly by both old and new display names instead.
    const threadIndex = await loadParentThreadIndex(guild, game.channelId);
    thread =
      threadIndex.get(stPlayerThreadName(oldDisplayName)) ??
      threadIndex.get(stPlayerThreadName(displayName)) ??
      null;
  }

  if (thread?.isThread()) {
    if (thread.archived) {
      await thread.setArchived(false, "Player substituted.").catch(() => undefined);
    }
    await thread.members.remove(oldDiscordUserId).catch(() => undefined);
    await thread.members.add(newUser.id).catch(() => undefined);
    const nextName = stPlayerThreadName(displayName);
    if (thread.name !== nextName) {
      await thread.setName(nextName).catch(() => undefined);
    }
    await prisma.player
      .update({
        where: { id: playerId },
        data: { stThreadId: thread.id },
      })
      .catch(() => undefined);
    await thread
      .send({
        content: `<@${newUser.id}> is now playing this seat (substituted for <@${oldDiscordUserId}>).`,
        allowedMentions: { users: [newUser.id, oldDiscordUserId] },
      })
      .catch(() => undefined);
    stThreadNote = `updated <#${thread.id}>`;
  }

  const whisperResult = await substituteDiscordIdInGameWhispers(
    game.id,
    oldDiscordUserId,
    newUser.id,
  );
  for (const threadId of whisperResult.threadIds) {
    const whisperThread = await guild.channels.fetch(threadId).catch(() => null);
    if (!whisperThread?.isThread()) continue;
    if (whisperThread.archived) {
      await whisperThread.setArchived(false, "Player substituted.").catch(() => undefined);
    }
    await whisperThread.members.remove(oldDiscordUserId).catch(() => undefined);
    await whisperThread.members.add(newUser.id).catch(() => undefined);
  }

  const voting = await resolveVotingChannel(guild, game, engine);
  if (voting?.isThread()) {
    await voting.members.remove(oldDiscordUserId).catch(() => undefined);
    await voting.members.add(newUser.id).catch(() => undefined);
  }

  await refreshAllNominationEverywhere(guild, game, engine, { revealSecret: true });
  await upsertStVoteTracker(guild, game.channelId, engine, game.kibThreadId);
  await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);

  const seatLabel = seat != null ? `seat **${seat}**` : "unseated";
  await postGameLog(
    guild,
    game,
    `<@${actorDiscordId}> substituted <@${oldDiscordUserId}> → <@${newUser.id}> (${seatLabel}).`,
  );

  const whisperNote =
    whisperResult.updated > 0
      ? `updated ${whisperResult.updated} whisper thread${whisperResult.updated === 1 ? "" : "s"}`
      : "no whispers";

  return {
    ok: true,
    message: [
      `Substituted <@${oldDiscordUserId}> → <@${newUser.id}> (${seatLabel}, now **${displayName}**).`,
      stThreadNote,
      whisperNote,
      roleNote,
    ].join(" · "),
  };
}
