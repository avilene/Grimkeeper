import type { Guild } from "discord.js";
import { GameCommandKind, type GameEngine } from "@grimkeeper/engine";

import {
  getKibThreadForGame,
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
import { postDayMarkersToTownSurfaces } from "./town-surfaces.js";
import { postDayMarkersToWhispers } from "./whisper-thread.js";

type TownGame = {
  id: string;
  channelId: string;
  kibThreadId?: string | null;
  whisperDeclThreadId?: string | null;
  claimsThreadId?: string | null;
  rulesThreadId?: string | null;
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

/** Town Voting thread banner when a new day opens. */
export function formatVoteThreadDayStartMessage(dayNumber: number): string {
  const openLine =
    dayNumber === 1
      ? `**Day ${dayNumber}** has begun — nominations are open.`
      : `**Day ${dayNumber}** has begun — nominations are open again.`;
  return [
    `## Day ${dayNumber}`,
    "",
    openLine,
    "_Each living player may nominate once today, and each player (alive or dead) may be nominated once._",
  ].join("\n");
}

export async function postVoteThreadDayStart(
  guild: Guild,
  game: TownGame,
  engine: GameEngine,
  dayNumber: number,
): Promise<void> {
  const voting = await resolveVotingChannel(guild, game, engine);
  if (!voting) return;
  await voting
    .send({
      content: formatVoteThreadDayStartMessage(dayNumber),
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);
}

/** Kib thread banner when a new day, night, or setup begins. */
export function formatKibPhaseHeader(
  phase: "day" | "night" | "setup",
  phaseNumber = 0,
): string {
  if (phase === "setup") return "## Setup";
  const label = phase === "day" ? "Day" : "Night";
  return `## ${label} ${phaseNumber}`;
}

export async function postKibPhaseHeader(
  guild: Guild,
  game: TownGame,
  phase: "day" | "night" | "setup",
  phaseNumber = 0,
): Promise<void> {
  const kib = await getKibThreadForGame(guild, game);
  if (!kib) return;
  await kib
    .send({
      content: formatKibPhaseHeader(phase, phaseNumber),
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);
}

/** Best-effort rename of the town channel to `{base}-setup` / `{base}-{day|night}N`. Voting thread keeps Town Voting. */
export async function renameTownPhaseSurfaces(
  guild: Guild,
  game: TownGame,
  voteThreadId: string | null,
  phase: "day" | "night" | "setup",
  phaseNumber = 0,
): Promise<void> {
  const parent = await guild.channels.fetch(game.channelId).catch(() => null);
  if (isGameTextChannel(parent)) {
    const parentName = townPhaseParentChannelName(parent.name, phase, phaseNumber);
    if (parent.name !== parentName) {
      const reason =
        phase === "setup" ? "Town setup" : `Town ${phase} ${phaseNumber}`;
      await parent.setName(parentName, reason).catch(() => undefined);
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
 * Advance town phase: setup → night (Night 1), day → night, or night → day.
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

  if (state.phase === "setup") {
    const voteThreadId =
      (await resolveVotingChannel(guild, game, engine))?.id ?? null;

    const events = engine.handle({
      kind: GameCommandKind.AdvancePhase,
      gameId: game.id,
      targetPhase: "night",
    });
    await persistEvents(engine, events);
    await syncGameProjection(game.id, engine);

    const nightNumber = engine.getState().nightNumber;
    await renameTownPhaseSurfaces(guild, game, voteThreadId, "night", nightNumber);
    await postKibPhaseHeader(guild, game, "night", nightNumber);

    const voting = await resolveVotingChannel(guild, game, engine);
    if (voting) {
      await voting
        .send(
          `**Night ${nightNumber}** has begun — nominations open when the storyteller starts Day 1 (\`/st next-phase\`).`,
        )
        .catch(() => undefined);
    }

    await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);
    await refreshStVoteTrackerForGame(guild, game, engine);
    await postGameLog(
      guild,
      game,
      `<@${actorDiscordId}> started night **${nightNumber}** from setup.`,
    );

    return { phase: "night", phaseNumber: nightNumber };
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

    await postKibPhaseHeader(guild, game, "night", nightNumber);

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
    let voteThreadId = previousThreadId ?? engine.getState().day?.discordThreadId ?? null;
    if (!voteThreadId) {
      const voting = await resolveVotingChannel(guild, game, engine);
      voteThreadId = voting?.id ?? null;
    }
    if (voteThreadId) {
      const openEvents = engine.handle({
        kind: GameCommandKind.OpenDay,
        gameId: game.id,
        discordThreadId: voteThreadId,
      });
      await persistEvents(engine, openEvents);
    }

    await syncGameProjection(game.id, engine);
    await renameTownPhaseSurfaces(guild, game, voteThreadId, "day", dayNumber);

    await postKibPhaseHeader(guild, game, "day", dayNumber);
    await postVoteThreadDayStart(guild, game, engine, dayNumber);
    await postDayMarkersToTownSurfaces(guild, game, dayNumber);
    await postDayMarkersToWhispers(guild, game.id, dayNumber);

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
