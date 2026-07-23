import type { GameEngine, GameEvent, GameState } from "@grimkeeper/engine";
import { GameEventType, getStorytellerDiscordIds } from "@grimkeeper/engine";

import { log } from "./logger.js";

function stateFields(state: GameState): Record<string, unknown> {
  return {
    gameId: state.gameId,
    guildId: state.guildId,
    channelId: state.channelId,
    phase: state.phase,
    nightNumber: state.nightNumber,
    dayNumber: state.dayNumber,
    playerCount: state.players.length,
    aliveCount: state.players.filter((player) => player.alive).length,
    winner: state.winner,
    storytellerCount: getStorytellerDiscordIds(state).length,
  };
}

function eventFields(event: GameEvent): Record<string, unknown> {
  switch (event.type) {
    case GameEventType.GameCreated:
      return {
        storytellerId: event.storytellerId,
        scriptName: event.script?.name ?? null,
        scriptSource: event.script?.source ?? null,
      };
    case GameEventType.GameStarted:
      return {};
    case GameEventType.RoleAssigned:
      return { playerId: event.playerId };
    case GameEventType.PlayerAdded:
      return { playerId: event.playerId, displayName: event.displayName };
    case GameEventType.PlayerRemoved:
      return { playerId: event.playerId };
    case GameEventType.StorytellerPromoted:
      return { discordUserId: event.discordUserId };
    case GameEventType.RolesDealt:
      // Role assignments are secret — only log that dealing happened.
      return { assignmentCount: event.assignments.length };
    case GameEventType.NightStarted:
      return { nightNumber: event.nightNumber };
    case GameEventType.DayStarted:
      return { dayNumber: event.dayNumber };
    case GameEventType.DayOpened:
      return { dayNumber: event.dayNumber, discordThreadId: event.discordThreadId };
    case GameEventType.GameEnded:
      return { winner: event.winner, reason: event.reason };
    case GameEventType.PlayerDied:
      return { playerId: event.playerId, cause: event.cause, nominationId: event.nominationId };
    case GameEventType.NominationMade:
      return {
        nominationId: event.nominationId,
        nominatorId: event.nominatorId,
        nomineeId: event.nomineeId,
        order: event.order,
      };
    case GameEventType.DefenseAdded:
      return { nominationId: event.nominationId, playerId: event.playerId };
    case GameEventType.VoteCast:
      return {
        nominationId: event.nominationId,
        voterId: event.voterId,
        choice: event.choice,
        manualSet: event.manualSet,
        privateBallot: event.privateBallot === true,
      };
    case GameEventType.NominationsPaused:
      return { pausedUntil: event.pausedUntil };
    case GameEventType.NominationsResumed:
      return {};
    case GameEventType.VoteVisibilitySet:
      return { visibility: event.visibility };
    case GameEventType.NominationsClosed:
      return {};
    case GameEventType.NominationResolved:
      return {
        nominationId: event.nominationId,
        passed: event.passed,
        yesVotes: event.yesVotes,
        livingCount: event.livingCount,
      };
    case GameEventType.SeatsOpened:
      return {};
    case GameEventType.SeatsClosed:
      return {};
    case GameEventType.SeatPicked:
      return { playerId: event.playerId, seat: event.seat };
    case GameEventType.TownSetup:
      return { playerCount: event.players.length, channelId: event.channelId };
    case GameEventType.TownResetToSetup:
      return {};
    case GameEventType.PlayerAliveChanged:
      return { playerId: event.playerId, alive: event.alive };
    case GameEventType.PlayerDisplayNameChanged:
      return { playerId: event.playerId, displayName: event.displayName };
    case GameEventType.NominationVotesLocked:
      return { nominationId: event.nominationId };
    case GameEventType.NominationVotesUnlocked:
      return { nominationId: event.nominationId };
    case GameEventType.NominationCountStarted:
      return {
        nominationId: event.nominationId,
        handPlayerId: event.handPlayerId,
        handIndex: event.handIndex,
      };
    case GameEventType.NominationCountHandAdvanced:
      return {
        nominationId: event.nominationId,
        voterId: event.voterId,
        choice: event.choice,
        handPlayerId: event.handPlayerId,
        handIndex: event.handIndex,
        finished: event.finished,
      };
    case GameEventType.NominationCountFinished:
      return { nominationId: event.nominationId };
  }
}

export function logGameEvent(engine: GameEngine, event: GameEvent): void {
  log("info", "game.event", {
    event: event.type,
    ...eventFields(event),
    ...stateFields(engine.getState()),
  });
}
