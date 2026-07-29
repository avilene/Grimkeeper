import { randomUUID } from "node:crypto";
import type { CommandInteraction, Guild } from "discord.js";
import { prisma } from "@grimkeeper/database";
import {
  GameCommandKind,
  GameEngine,
  type GameEvent,
  defaultBuffetConfig,
  fakePlayerId,
  fakePlayerName,
} from "@grimkeeper/engine";

import { minPlayersForMode } from "./bot-mode.js";
import {
  addRoleToUser,
  createPlayerStThreads,
  createTownVoteThread,
  loadEngine,
  persistEvents,
  resolveGameRoles,
  setInteractionProgress,
} from "./commands/command-context.js";
import { postGameLog, postGameLogRoleChange } from "./game-log-thread.js";
import { upsertPinnedGameStatus } from "./game-status.js";
import { upsertStControlPanel } from "./st-control-panel.js";
import { upsertStVoteTracker } from "./st-vote-tracker.js";
import {
  ensureTownSurfaceThreads,
} from "./town-surfaces.js";
import { renameTownPhaseSurfaces, postKibPhaseHeader } from "./town-day.js";

export const DEFAULT_DEV_BOT_GAME_SIZE = 8;

export type DevBotRosterEntry = {
  playerId: string;
  discordUserId: string;
  displayName: string;
};

export function buildDevBotRoster(gameId: string, count: number): DevBotRosterEntry[] {
  return buildMixedDevRoster(gameId, count, []);
}

/** Real players first (seat order), then bots to reach `totalCount`. */
export function buildMixedDevRoster(
  gameId: string,
  totalCount: number,
  realPlayers: Array<{ discordUserId: string; displayName: string }>,
): DevBotRosterEntry[] {
  if (totalCount < 3 || totalCount > 15) {
    throw new Error("Player count must be between 3 and 15.");
  }
  if (realPlayers.length > totalCount) {
    throw new Error(
      `Too many real players (${realPlayers.length}) for a table of ${totalCount}. Increase count or remove mentions.`,
    );
  }

  const roster: DevBotRosterEntry[] = realPlayers.map((player) => ({
    playerId: randomUUID(),
    discordUserId: player.discordUserId,
    displayName: player.displayName,
  }));

  const botCount = totalCount - realPlayers.length;
  for (let i = 0; i < botCount; i++) {
    const index = i + 1;
    roster.push({
      playerId: randomUUID(),
      discordUserId: fakePlayerId(gameId, index),
      displayName: fakePlayerName(index),
    });
  }

  return roster;
}

export interface DevBotGameResult {
  playerCount: number;
  seatingChart: string[];
  voteThreadId: string | null;
  buffetStarted: boolean;
  buffetCompleted: boolean;
}

/** Seat fake players (and optional real players) via SetupTown and open town surfaces (dev-only). */
export async function runDevBotGameSetup(
  interaction: CommandInteraction,
  game: { id: string; channelId: string; kibThreadId?: string | null },
  options?: {
    count?: number;
    startBuffet?: boolean;
    realPlayers?: Array<{ discordUserId: string; displayName: string }>;
  },
): Promise<DevBotGameResult> {
  const guild = interaction.guild;
  if (!guild) {
    throw new Error("This command must be used in a server.");
  }

  const count = options?.count ?? DEFAULT_DEV_BOT_GAME_SIZE;
  const realPlayers = options?.realPlayers ?? [];
  const botCount = count - realPlayers.length;

  await setInteractionProgress(
    interaction,
    realPlayers.length > 0
      ? `Setting up ${count} players (${realPlayers.length} real, ${botCount} bots)…`
      : `Setting up ${count} bot players…`,
  );

  const roster = buildMixedDevRoster(game.id, count, realPlayers);
  const engine = await loadEngine(game.id);

  const events = engine.handle({
    kind: GameCommandKind.SetupTown,
    gameId: game.id,
    channelId: game.channelId,
    players: roster,
    minPlayers: minPlayersForMode(),
  });
  await persistEvents(engine, events);

  await prisma.player.deleteMany({ where: { gameId: game.id } });
  if (roster.length > 0) {
    await prisma.player.createMany({
      data: engine.getState().players.map((player) => ({
        id: player.id,
        gameId: game.id,
        discordUserId: player.discordUserId,
        displayName: player.displayName,
        seat: player.seat,
        alive: player.alive,
        ghostVoteUsed: player.ghostVoteUsed,
        roleId: player.roleId,
      })),
    });
  }

  const roles = await resolveGameRoles(guild, game);
  if (roles && realPlayers.length > 0) {
    await setInteractionProgress(interaction, "Assigning player roles…");
    for (const player of engine.getState().players) {
      if (player.isFake) continue;
      await addRoleToUser(guild, player.discordUserId, roles.playersRole.id);
      await postGameLogRoleChange(
        guild,
        game,
        "added",
        player.discordUserId,
        `<@&${roles.playersRole.id}> (player)`,
        interaction.user.id,
      );
    }
  }

  await setInteractionProgress(interaction, "Opening town threads…");
  const threadSummary = await createPlayerStThreads(interaction, game, engine);
  const voteThread = await createTownVoteThread(guild, game, engine);
  const surfaces = await ensureTownSurfaceThreads(guild, game, engine);

  await renameTownPhaseSurfaces(guild, game, voteThread?.id ?? null, "setup");
  await postKibPhaseHeader(guild, game, "setup");
  if (voteThread) {
    await voteThread
      .send(
        "**Setup** — dev bot game. Night 1 starts when the storyteller advances the phase.",
      )
      .catch(() => undefined);
  }

  await upsertPinnedGameStatus(guild, game.channelId, engine);
  await upsertStVoteTracker(guild, game.channelId, engine, game.kibThreadId);
  await upsertStControlPanel(guild, game.channelId, engine, game.kibThreadId);

  let buffetStarted = false;
  let buffetCompleted = false;

  if (options?.startBuffet) {
    await setInteractionProgress(interaction, "Starting Sushi Buffet draft for bots…");
    buffetStarted = await startDevBuffetDraft(guild, game, engine);
    buffetCompleted = engine.getState().buffetDraft?.status === "complete";
  }

  const playerNames = engine
    .getState()
    .players.map((player) => player.displayName)
    .join(", ");
  const surfaceLinks = [
    surfaces.whisperDecl ? `<#${surfaces.whisperDecl.id}>` : null,
    surfaces.claims ? `<#${surfaces.claims.id}>` : null,
    surfaces.rules ? `<#${surfaces.rules.id}>` : null,
  ].filter(Boolean);

  const rosterSummary =
    realPlayers.length > 0
      ? `**${count}** players (${realPlayers.length} real, ${botCount} bots) (${playerNames})`
      : `**${count}** fake players (${playerNames})`;

  await postGameLog(
    guild,
    game,
    `<@${interaction.user.id}> dev bot-game — ${rosterSummary}.` +
      ` **Setup** phase.` +
      (voteThread ? ` Voting: <#${voteThread.id}>.` : "") +
      (surfaceLinks.length > 0 ? ` Town threads: ${surfaceLinks.join(", ")}.` : "") +
      (buffetStarted ? " Sushi Buffet draft started — pick for bots in their ST threads." : ""),
  );

  void threadSummary;

  return {
    playerCount: count,
    seatingChart: engine.getSeatingChart(),
    voteThreadId: voteThread?.id ?? null,
    buffetStarted,
    buffetCompleted,
  };
}

async function startDevBuffetDraft(
  guild: Guild,
  game: { id: string; channelId: string },
  engine: GameEngine,
): Promise<boolean> {
  const configEvents = engine.handle({
    kind: GameCommandKind.ConfigureBuffetDraft,
    gameId: game.id,
    config: defaultBuffetConfig(),
  });
  await persistEvents(engine, configEvents);

  const startEvents = engine.handle({
    kind: GameCommandKind.StartBuffetDraft,
    gameId: game.id,
  });
  await persistEvents(engine, startEvents);

  const firstOffer = engine.getState().buffetDraft?.currentOffer;
  if (firstOffer) {
    const { postBuffetOffer } = await import("./interactions/buffet-draft.js");
    await postBuffetOffer(guild, game, engine, firstOffer);
  }

  await upsertPinnedGameStatus(guild, game.channelId, engine);
  return true;
}
