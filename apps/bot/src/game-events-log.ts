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
        scriptName: event.script.name,
        scriptSource: event.script.source,
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
    case GameEventType.GameEnded:
      return { winner: event.winner, reason: event.reason };
    case GameEventType.PlayerDied:
      return { playerId: event.playerId, cause: event.cause };
    case GameEventType.NominationMade:
      return { nominatorId: event.nominatorId, nomineeId: event.nomineeId };
    case GameEventType.SeatsOpened:
      return {};
    case GameEventType.SeatsClosed:
      return {};
    case GameEventType.SeatPicked:
      return { playerId: event.playerId, seat: event.seat };
  }
}

export function logGameEvent(engine: GameEngine, event: GameEvent): void {
  log("info", "game.event", {
    event: event.type,
    ...eventFields(event),
    ...stateFields(engine.getState()),
  });
}
