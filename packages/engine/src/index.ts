export type GamePhase = "lobby" | "night" | "day" | "ended";

import { formatRoleName } from "./plugins/index.js";

export type Team = "good" | "evil" | "traveler";

export interface GameEventBase {
  type: string;
  gameId: string;
  timestamp: string;
}

export interface GameCreatedEvent extends GameEventBase {
  type: "GameCreated";
  guildId: string;
  channelId: string;
  storytellerId: string;
}

export interface PlayerAddedEvent extends GameEventBase {
  type: "PlayerAdded";
  playerId: string;
  discordUserId: string;
  displayName: string;
}

export interface RolesDealtEvent extends GameEventBase {
  type: "RolesDealt";
  assignments: Array<{ playerId: string; roleId: string }>;
}

export interface NightStartedEvent extends GameEventBase {
  type: "NightStarted";
  nightNumber: number;
}

export interface DayStartedEvent extends GameEventBase {
  type: "DayStarted";
  dayNumber: number;
}

export interface PlayerDiedEvent extends GameEventBase {
  type: "PlayerDied";
  playerId: string;
  cause: string;
}

export interface NominationMadeEvent extends GameEventBase {
  type: "NominationMade";
  nominatorId: string;
  nomineeId: string;
}

export interface GameEndedEvent extends GameEventBase {
  type: "GameEnded";
  winner: "good" | "evil";
  reason: string;
}

export interface PlayerRemovedEvent extends GameEventBase {
  type: "PlayerRemoved";
  playerId: string;
}

export type GameEvent =
  | GameCreatedEvent
  | PlayerAddedEvent
  | PlayerRemovedEvent
  | RolesDealtEvent
  | NightStartedEvent
  | DayStartedEvent
  | PlayerDiedEvent
  | NominationMadeEvent
  | GameEndedEvent;

export interface PlayerState {
  id: string;
  discordUserId: string;
  displayName: string;
  seat: number | null;
  roleId: string | null;
  alive: boolean;
  isFake: boolean;
}

export interface GameState {
  gameId: string;
  guildId: string;
  channelId: string;
  phase: GamePhase;
  storytellerId: string | null;
  nightNumber: number;
  dayNumber: number;
  players: PlayerState[];
  winner: "good" | "evil" | null;
}

export interface CreateGameCommand {
  kind: "CreateGame";
  gameId: string;
  guildId: string;
  channelId: string;
  storytellerId: string;
}

export interface AddPlayerCommand {
  kind: "AddPlayer";
  gameId: string;
  playerId: string;
  discordUserId: string;
  displayName: string;
}

export interface RemovePlayerCommand {
  kind: "RemovePlayer";
  gameId: string;
  playerId: string;
}

export interface StartGameCommand {
  kind: "StartGame";
  gameId: string;
  roleAssignments: Array<{ playerId: string; roleId: string }>;
  minPlayers?: number;
}

export interface ClearFakePlayersCommand {
  kind: "ClearFakePlayers";
  gameId: string;
}

export interface AdvancePhaseCommand {
  kind: "AdvancePhase";
  gameId: string;
  targetPhase: "night" | "day";
}

export interface EndGameCommand {
  kind: "EndGame";
  gameId: string;
  winner: "good" | "evil";
  reason: string;
}

export type GameCommand =
  | CreateGameCommand
  | AddPlayerCommand
  | RemovePlayerCommand
  | StartGameCommand
  | ClearFakePlayersCommand
  | AdvancePhaseCommand
  | EndGameCommand;

export const DEFAULT_MIN_PLAYERS = 5;
export const DEV_MIN_PLAYERS = 3;

export class GameEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameEngineError";
  }
}

function emptyState(gameId: string): GameState {
  return {
    gameId,
    guildId: "",
    channelId: "",
    phase: "lobby",
    storytellerId: null,
    nightNumber: 0,
    dayNumber: 0,
    players: [],
    winner: null,
  };
}

export class GameEngine {
  private state: GameState;

  constructor(gameId: string, initialState?: GameState) {
    this.state = initialState ?? emptyState(gameId);
  }

  getState(): GameState {
    return structuredClone(this.state);
  }

  static fromEvents(gameId: string, events: GameEvent[]): GameEngine {
    const engine = new GameEngine(gameId);
    for (const event of events) {
      engine.apply(event);
    }
    return engine;
  }

  validate(command: GameCommand): void {
    switch (command.kind) {
      case "CreateGame":
        if (this.state.storytellerId) {
          throw new GameEngineError("Game already exists.");
        }
        break;
      case "AddPlayer":
        this.assertPhase("lobby", "Players can only join during the lobby.");
        if (this.state.players.some((p) => p.discordUserId === command.discordUserId)) {
          throw new GameEngineError("Player already joined.");
        }
        break;
      case "RemovePlayer":
        this.assertPhase("lobby", "Players can only leave during the lobby.");
        if (!this.state.players.some((p) => p.id === command.playerId)) {
          throw new GameEngineError("Player is not in this game.");
        }
        break;
      case "StartGame": {
        this.assertPhase("lobby", "Game can only start from the lobby.");
        const minPlayers = command.minPlayers ?? DEFAULT_MIN_PLAYERS;
        if (this.state.players.length < minPlayers) {
          throw new GameEngineError(`At least ${minPlayers} players are required to start.`);
        }
        if (command.roleAssignments.length !== this.state.players.length) {
          throw new GameEngineError("Every player must receive a role.");
        }
        break;
      }
      case "ClearFakePlayers":
        this.assertPhase("lobby", "Fake players can only be cleared during the lobby.");
        break;
      case "AdvancePhase":
        if (this.state.phase === "ended") {
          throw new GameEngineError("Game has already ended.");
        }
        if (command.targetPhase === "night" && this.state.phase !== "day" && this.state.phase !== "lobby") {
          throw new GameEngineError("Can only enter night from lobby or day.");
        }
        if (command.targetPhase === "day" && this.state.phase !== "night") {
          throw new GameEngineError("Can only enter day from night.");
        }
        break;
      case "EndGame":
        if (this.state.phase === "ended") {
          throw new GameEngineError("Game has already ended.");
        }
        break;
    }
  }

  handle(command: GameCommand): GameEvent[] {
    this.validate(command);

    switch (command.kind) {
      case "CreateGame":
        return [
          {
            type: "GameCreated",
            gameId: command.gameId,
            guildId: command.guildId,
            channelId: command.channelId,
            storytellerId: command.storytellerId,
            timestamp: new Date().toISOString(),
          },
        ];
      case "AddPlayer":
        return [
          {
            type: "PlayerAdded",
            gameId: command.gameId,
            playerId: command.playerId,
            discordUserId: command.discordUserId,
            displayName: command.displayName,
            timestamp: new Date().toISOString(),
          },
        ];
      case "RemovePlayer":
        return [
          {
            type: "PlayerRemoved",
            gameId: command.gameId,
            playerId: command.playerId,
            timestamp: new Date().toISOString(),
          },
        ];
      case "StartGame":
        return [
          {
            type: "RolesDealt",
            gameId: command.gameId,
            assignments: command.roleAssignments,
            timestamp: new Date().toISOString(),
          },
          {
            type: "NightStarted",
            gameId: command.gameId,
            nightNumber: 1,
            timestamp: new Date().toISOString(),
          },
        ];
      case "ClearFakePlayers":
        return this.state.players
          .filter((player) => player.isFake)
          .map((player) => ({
            type: "PlayerRemoved" as const,
            gameId: command.gameId,
            playerId: player.id,
            timestamp: new Date().toISOString(),
          }));
      case "AdvancePhase":
        if (command.targetPhase === "night") {
          return [
            {
              type: "NightStarted",
              gameId: command.gameId,
              nightNumber: this.state.nightNumber + 1,
              timestamp: new Date().toISOString(),
            },
          ];
        }
        return [
          {
            type: "DayStarted",
            gameId: command.gameId,
            dayNumber: this.state.dayNumber + 1,
            timestamp: new Date().toISOString(),
          },
        ];
      case "EndGame":
        return [
          {
            type: "GameEnded",
            gameId: command.gameId,
            winner: command.winner,
            reason: command.reason,
            timestamp: new Date().toISOString(),
          },
        ];
    }
  }

  apply(event: GameEvent): void {
    switch (event.type) {
      case "GameCreated":
        this.state.gameId = event.gameId;
        this.state.guildId = event.guildId;
        this.state.channelId = event.channelId;
        this.state.storytellerId = event.storytellerId;
        this.state.phase = "lobby";
        break;
      case "PlayerAdded":
        this.state.players.push({
          id: event.playerId,
          discordUserId: event.discordUserId,
          displayName: event.displayName,
          seat: this.state.players.length + 1,
          roleId: null,
          alive: true,
          isFake: event.discordUserId.startsWith("dev:"),
        });
        break;
      case "PlayerRemoved":
        this.state.players = this.state.players
          .filter((player) => player.id !== event.playerId)
          .map((player, index) => ({ ...player, seat: index + 1 }));
        break;
      case "RolesDealt":
        for (const assignment of event.assignments) {
          const player = this.state.players.find((p) => p.id === assignment.playerId);
          if (player) {
            player.roleId = assignment.roleId;
          }
        }
        break;
      case "NightStarted":
        this.state.phase = "night";
        this.state.nightNumber = event.nightNumber;
        break;
      case "DayStarted":
        this.state.phase = "day";
        this.state.dayNumber = event.dayNumber;
        break;
      case "PlayerDied": {
        const player = this.state.players.find((p) => p.id === event.playerId);
        if (player) {
          player.alive = false;
        }
        break;
      }
      case "GameEnded":
        this.state.phase = "ended";
        this.state.winner = event.winner;
        break;
    }
  }

  getGrimReveal(): string[] {
    const lines: string[] = [];
    for (const player of this.state.players) {
      const role = player.roleId ? formatRoleName(player.roleId) : "unknown";
      const status = player.alive ? "alive" : "dead";
      const fakeTag = player.isFake ? " [dev]" : "";
      lines.push(`${player.displayName}${fakeTag} — ${role} (${status})`);
    }
    if (this.state.winner) {
      lines.push(`Winner: ${this.state.winner}`);
    }
    return lines;
  }

  private assertPhase(expected: GamePhase, message: string): void {
    if (this.state.phase !== expected) {
      throw new GameEngineError(message);
    }
  }
}

export * from "./plugins/index.js";
