import type { Guild } from "discord.js";
import { GameCommandKind, type GameEngine } from "@grimkeeper/engine";

import {
  persistEvents,
  refreshStVoteTrackerForGame,
  resolveVotingChannel,
  syncGameProjection,
} from "./commands/command-context.js";
import { postGameLog } from "./game-log-thread.js";
import { upsertStControlPanel } from "./st-control-panel.js";

type TownGame = {
  id: string;
  channelId: string;
  kibThreadId?: string | null;
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
      .send("Nominations are now **closed** for the day. No further nominations until the next day.")
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

/**
 * Start the next town day: clears nominations/votes, reopens nominations,
 * keeps the existing Town Voting thread.
 */
export async function startNextTownDay(
  guild: Guild,
  game: TownGame,
  engine: GameEngine,
  actorDiscordId: string,
): Promise<{ dayNumber: number }> {
  const previousThreadId = engine.getState().day?.discordThreadId ?? null;

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

  return { dayNumber };
}
