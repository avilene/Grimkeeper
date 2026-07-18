import type { Guild } from "discord.js";
import { GameCommandKind, type GameEngine } from "@grimkeeper/engine";

import {
  isGameTextChannel,
  persistEvents,
  refreshStVoteTrackerForGame,
  resolveVotingChannel,
  syncGameProjection,
} from "./commands/command-context.js";
import {
  townPhaseParentChannelName,
  townVoteThreadName,
} from "./day-thread.js";
import { postGameLog } from "./game-log-thread.js";
import { upsertStControlPanel } from "./st-control-panel.js";

type TownGame = {
  id: string;
  channelId: string;
  kibThreadId?: string | null;
};

export type TownPhaseAdvanceResult = {
  phase: "day" | "night";
  phaseNumber: number;
};

/** Close nominations (and new votes) until the next day. */
export async function closeTownNominations(
  guild: Guild,
  game: TownGame,
  engine: GameEngine,
  actorDiscordId: string,
): Promise<{ dayNumber: number }> {
  const events = engine.handle({
    kind: GameCommandKind.CloseNominations,
    gameId: game.id,
  });
  await persistEvents(engine, events);
  await syncGameProjection(game.id, engine);

  const dayNumber = engine.getState().dayNumber;
  const voting = await resolveVotingChannel(guild, game, engine);
  if (voting) {
    await voting
      .send(
        "Nominations are now **closed** for the day. No further nominations until the next day.",
      )
      .catch(() => undefined);
  }

  await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);
  await refreshStVoteTrackerForGame(guild, game, engine);
  await postGameLog(
    guild,
    game,
    `<@${actorDiscordId}> closed nominations for day **${dayNumber}**.`,
  );

  return { dayNumber };
}

/** Best-effort rename of the town channel to `{base}-{day|night}N`. Voting thread keeps Town Voting. */
export async function renameTownPhaseSurfaces(
  guild: Guild,
  game: TownGame,
  voteThreadId: string | null,
  phase: "day" | "night",
  phaseNumber: number,
): Promise<void> {
  const parent = await guild.channels.fetch(game.channelId).catch(() => null);
  if (isGameTextChannel(parent)) {
    const parentName = townPhaseParentChannelName(parent.name, phase, phaseNumber);
    if (parent.name !== parentName) {
      await parent.setName(parentName, `Town ${phase} ${phaseNumber}`).catch(() => undefined);
    }
  }

  if (!voteThreadId) return;

  const thread = await guild.channels.fetch(voteThreadId).catch(() => null);
  if (!thread || !("setName" in thread) || typeof thread.setName !== "function") return;

  const threadName = townVoteThreadName(game.id);
  if (thread.name !== threadName) {
    await thread.setName(threadName, "Keep Town Voting thread name").catch(() => undefined);
  }
}

/**
 * Advance town phase: day → night (Night dayNumber+1), or night → day.
 * Keeps the Town Voting thread name; renames the parent channel when possible.
 */
export async function advanceTownPhase(
  guild: Guild,
  game: TownGame,
  engine: GameEngine,
  actorDiscordId: string,
): Promise<TownPhaseAdvanceResult> {
  const state = engine.getState();
  if (!state.townMode) {
    throw new Error("Phase advance is only for town-mode games.");
  }

  if (state.phase === "day") {
    if (state.day?.nominationsOpen) {
      const closeEvents = engine.handle({
        kind: GameCommandKind.CloseNominations,
        gameId: game.id,
      });
      await persistEvents(engine, closeEvents);
    }

    const voteThreadId = state.day?.discordThreadId ?? null;

    const events = engine.handle({
      kind: GameCommandKind.AdvancePhase,
      gameId: game.id,
      targetPhase: "night",
    });
    await persistEvents(engine, events);
    await syncGameProjection(game.id, engine);

    const nightNumber = engine.getState().nightNumber;
    await renameTownPhaseSurfaces(guild, game, voteThreadId, "night", nightNumber);

    const voting = await resolveVotingChannel(guild, game, engine);
    if (voting) {
      await voting
        .send(
          `**Night ${nightNumber}** has begun — nominations are closed until the next day.`,
        )
        .catch(() => undefined);
    }

    await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);
    await refreshStVoteTrackerForGame(guild, game, engine);
    await postGameLog(
      guild,
      game,
      `<@${actorDiscordId}> started night **${nightNumber}**.`,
    );

    return { phase: "night", phaseNumber: nightNumber };
  }

  if (state.phase === "night") {
    const previousThreadId = state.day?.discordThreadId ?? null;

    const events = engine.handle({
      kind: GameCommandKind.AdvancePhase,
      gameId: game.id,
      targetPhase: "day",
    });
    await persistEvents(engine, events);

    const dayNumber = engine.getState().dayNumber;
    const voteThreadId = previousThreadId ?? engine.getState().day?.discordThreadId;
    if (voteThreadId) {
      const openEvents = engine.handle({
        kind: GameCommandKind.OpenDay,
        gameId: game.id,
        discordThreadId: voteThreadId,
      });
      await persistEvents(engine, openEvents);
    }

    await syncGameProjection(game.id, engine);
    await renameTownPhaseSurfaces(guild, game, voteThreadId ?? null, "day", dayNumber);

    const voting = await resolveVotingChannel(guild, game, engine);
    if (voting) {
      await voting
        .send(
          `**Day ${dayNumber}** has begun — nominations are open again.\n` +
            `_Each living player may nominate once today, and each living player may be nominated once._`,
        )
        .catch(() => undefined);
    }

    await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);
    await refreshStVoteTrackerForGame(guild, game, engine);
    await postGameLog(
      guild,
      game,
      `<@${actorDiscordId}> started day **${dayNumber}** (nominations reset and reopened).`,
    );

    return { phase: "day", phaseNumber: dayNumber };
  }

  throw new Error(`Cannot advance phase from ${state.phase}.`);
}
