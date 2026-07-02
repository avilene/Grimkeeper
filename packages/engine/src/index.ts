export type GamePhase = "lobby" | "setup" | "night" | "day" | "ended";

import { GameCommandKind } from "./command-kinds.js";
import { GameEventType } from "./event-types.js";
import {
  formatScriptRoleName,
  resolveStandardScript,
  StandardEdition,
  type GameScript,
} from "./scripts/index.js";

export * from "./command-kinds.js";
export * from "./event-types.js";

export type Team = "good" | "evil" | "traveler";

export interface GameEventBase {
  type: GameEventType;
  gameId: string;
  timestamp: string;
}

export interface GameCreatedEvent extends GameEventBase {
  type: typeof GameEventType.GameCreated;
  guildId: string;
  channelId: string;
  storytellerId: string;
  script: GameScript;
}

export interface GameStartedEvent extends GameEventBase {
  type: typeof GameEventType.GameStarted;
}

export interface RoleAssignedEvent extends GameEventBase {
  type: typeof GameEventType.RoleAssigned;
  playerId: string;
  roleId: string;
}

export interface PlayerAddedEvent extends GameEventBase {
  type: typeof GameEventType.PlayerAdded;
  playerId: string;
  discordUserId: string;
  displayName: string;
}

export interface RolesDealtEvent extends GameEventBase {
  type: typeof GameEventType.RolesDealt;
  assignments: Array<{ playerId: string; roleId: string }>;
}

export interface NightStartedEvent extends GameEventBase {
  type: typeof GameEventType.NightStarted;
  nightNumber: number;
}

export interface DayStartedEvent extends GameEventBase {
  type: typeof GameEventType.DayStarted;
  dayNumber: number;
}

export interface PlayerDiedEvent extends GameEventBase {
  type: typeof GameEventType.PlayerDied;
  playerId: string;
  cause: string;
}

export interface NominationMadeEvent extends GameEventBase {
  type: typeof GameEventType.NominationMade;
  nominatorId: string;
  nomineeId: string;
}

export interface SeatPickedEvent extends GameEventBase {
  type: typeof GameEventType.SeatPicked;
  playerId: string;
  seat: number;
}

export interface SeatsOpenedEvent extends GameEventBase {
  type: typeof GameEventType.SeatsOpened;
}

export interface SeatsClosedEvent extends GameEventBase {
  type: typeof GameEventType.SeatsClosed;
}

export interface GameEndedEvent extends GameEventBase {
  type: typeof GameEventType.GameEnded;
  winner: "good" | "evil";
  reason: string;
}

export interface PlayerRemovedEvent extends GameEventBase {
  type: typeof GameEventType.PlayerRemoved;
  playerId: string;
}

export interface StorytellerPromotedEvent extends GameEventBase {
  type: typeof GameEventType.StorytellerPromoted;
  discordUserId: string;
}

export type GameEvent =
  | GameCreatedEvent
  | PlayerAddedEvent
  | PlayerRemovedEvent
  | StorytellerPromotedEvent
  | GameStartedEvent
  | RoleAssignedEvent
  | RolesDealtEvent
  | NightStartedEvent
  | DayStartedEvent
  | PlayerDiedEvent
  | NominationMadeEvent
  | SeatsOpenedEvent
  | SeatsClosedEvent
  | SeatPickedEvent
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

export interface NominationState {
  nominatorId: string;
  nomineeId: string;
}

export interface GameState {
  gameId: string;
  guildId: string;
  channelId: string;
  phase: GamePhase;
  storytellerId: string | null;
  promotedStorytellerIds: string[];
  script: GameScript | null;
  nightNumber: number;
  dayNumber: number;
  players: PlayerState[];
  nominations: NominationState[];
  seatsOpen: boolean;
  winner: "good" | "evil" | null;
}

export interface CreateGameCommand {
  kind: typeof GameCommandKind.CreateGame;
  gameId: string;
  guildId: string;
  channelId: string;
  storytellerId: string;
  script: GameScript;
}

export interface AssignRoleCommand {
  kind: typeof GameCommandKind.AssignRole;
  gameId: string;
  playerId: string;
  roleId: string;
}

export interface DealRolesCommand {
  kind: typeof GameCommandKind.DealRoles;
  gameId: string;
  roleAssignments: Array<{ playerId: string; roleId: string }>;
}

export interface BeginNightCommand {
  kind: typeof GameCommandKind.BeginNight;
  gameId: string;
}

export interface AddPlayerCommand {
  kind: typeof GameCommandKind.AddPlayer;
  gameId: string;
  playerId: string;
  discordUserId: string;
  displayName: string;
}

export interface RemovePlayerCommand {
  kind: typeof GameCommandKind.RemovePlayer;
  gameId: string;
  playerId: string;
}

export interface StartGameCommand {
  kind: typeof GameCommandKind.StartGame;
  gameId: string;
  minPlayers?: number;
}

export interface ClearFakePlayersCommand {
  kind: typeof GameCommandKind.ClearFakePlayers;
  gameId: string;
}

export interface AdvancePhaseCommand {
  kind: typeof GameCommandKind.AdvancePhase;
  gameId: string;
  targetPhase: "night" | "day";
}

export interface MakeNominationCommand {
  kind: typeof GameCommandKind.MakeNomination;
  gameId: string;
  nominatorId: string;
  nomineeId: string;
}

export interface PickSeatCommand {
  kind: typeof GameCommandKind.PickSeat;
  gameId: string;
  playerId: string;
  seat: number;
}

export interface OpenSeatsCommand {
  kind: typeof GameCommandKind.OpenSeats;
  gameId: string;
}

export interface CloseSeatsCommand {
  kind: typeof GameCommandKind.CloseSeats;
  gameId: string;
}

export interface EndGameCommand {
  kind: typeof GameCommandKind.EndGame;
  gameId: string;
  winner: "good" | "evil";
  reason: string;
}

export interface PromoteStorytellerCommand {
  kind: typeof GameCommandKind.PromoteStoryteller;
  gameId: string;
  discordUserId: string;
}

export type GameCommand =
  | CreateGameCommand
  | AddPlayerCommand
  | RemovePlayerCommand
  | StartGameCommand
  | AssignRoleCommand
  | DealRolesCommand
  | BeginNightCommand
  | ClearFakePlayersCommand
  | AdvancePhaseCommand
  | MakeNominationCommand
  | OpenSeatsCommand
  | CloseSeatsCommand
  | PickSeatCommand
  | EndGameCommand
  | PromoteStorytellerCommand;

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
    promotedStorytellerIds: [],
    script: null,
    nightNumber: 0,
    dayNumber: 0,
    players: [],
    nominations: [],
    seatsOpen: false,
    winner: null,
  };
}

export function getStorytellerDiscordIds(state: GameState): string[] {
  const ids: string[] = [];
  if (state.storytellerId) {
    ids.push(state.storytellerId);
  }
  for (const discordUserId of state.promotedStorytellerIds) {
    if (!ids.includes(discordUserId)) {
      ids.push(discordUserId);
    }
  }
  return ids;
}

export function isStoryteller(state: GameState, discordUserId: string): boolean {
  return getStorytellerDiscordIds(state).includes(discordUserId);
}

export class GameEngine {
  private state: GameState;

  constructor(gameId: string, initialState?: GameState) {
    this.state = initialState ?? emptyState(gameId);
  }

  getState(): GameState {
    return structuredClone(this.state);
  }

  getStorytellerDiscordIds(): string[] {
    return getStorytellerDiscordIds(this.state);
  }

  isStoryteller(discordUserId: string): boolean {
    return isStoryteller(this.state, discordUserId);
  }

  getPlayerByDiscordId(discordUserId: string): PlayerState | undefined {
    return this.state.players.find((player) => player.discordUserId === discordUserId);
  }

  getPlayerById(playerId: string): PlayerState | undefined {
    return this.state.players.find((player) => player.id === playerId);
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
      case GameCommandKind.CreateGame:
        if (this.state.storytellerId) {
          throw new GameEngineError("Game already exists.");
        }
        break;
      case GameCommandKind.AddPlayer:
        this.assertPhase("lobby", "Players can only join during the lobby.");
        if (this.state.players.some((p) => p.discordUserId === command.discordUserId)) {
          throw new GameEngineError("Player already joined.");
        }
        break;
      case GameCommandKind.RemovePlayer:
        this.assertPhase("lobby", "Players can only leave during the lobby.");
        if (!this.state.players.some((p) => p.id === command.playerId)) {
          throw new GameEngineError("Player is not in this game.");
        }
        break;
      case GameCommandKind.StartGame: {
        this.assertPhase("lobby", "Game can only start from the lobby.");
        const minPlayers = command.minPlayers ?? DEFAULT_MIN_PLAYERS;
        if (this.state.players.length < minPlayers) {
          throw new GameEngineError(`At least ${minPlayers} players are required to start.`);
        }
        if (!this.state.script) {
          throw new GameEngineError("Game has no script configured.");
        }
        break;
      }
      case GameCommandKind.AssignRole:
        this.assertPhase("setup", "Roles can only be assigned during setup.");
        this.assertScriptRole(command.roleId);
        if (!this.state.players.some((player) => player.id === command.playerId)) {
          throw new GameEngineError("Player is not in this game.");
        }
        if (
          this.state.players.some(
            (player) => player.id !== command.playerId && player.roleId === command.roleId,
          )
        ) {
          throw new GameEngineError("That role is already assigned to another player.");
        }
        break;
      case GameCommandKind.DealRoles: {
        this.assertPhase("setup", "Roles can only be dealt during setup.");
        if (command.roleAssignments.length !== this.state.players.length) {
          throw new GameEngineError("Every player must receive a role.");
        }
        this.assertRoleAssignments(command.roleAssignments);
        break;
      }
      case GameCommandKind.BeginNight:
        this.assertPhase("setup", "Night can only begin after setup.");
        if (!this.state.players.every((player) => player.roleId)) {
          throw new GameEngineError("Every player must have a role before night begins.");
        }
        break;
      case GameCommandKind.ClearFakePlayers:
        this.assertPhase("lobby", "Fake players can only be cleared during the lobby.");
        break;
      case GameCommandKind.AdvancePhase:
        if (this.state.phase === "ended") {
          throw new GameEngineError("Game has already ended.");
        }
        if (this.state.phase === "setup") {
          throw new GameEngineError("Finish grimoire setup before advancing phases.");
        }
        if (command.targetPhase === "night" && this.state.phase !== "day" && this.state.phase !== "lobby") {
          throw new GameEngineError("Can only enter night from lobby or day.");
        }
        if (command.targetPhase === "day" && this.state.phase !== "night") {
          throw new GameEngineError("Can only enter day from night.");
        }
        break;
      case GameCommandKind.EndGame:
        if (this.state.phase === "ended") {
          throw new GameEngineError("Game has already ended.");
        }
        break;
      case GameCommandKind.PromoteStoryteller:
        if (this.state.phase === "ended") {
          throw new GameEngineError("Cannot promote storytellers after the game has ended.");
        }
        if (isStoryteller(this.state, command.discordUserId)) {
          throw new GameEngineError("That user is already a storyteller.");
        }
        break;
      case GameCommandKind.MakeNomination:
        this.assertPhase("day", "Nominations can only be made during the day.");
        this.assertAlivePlayer(command.nominatorId, "Only alive players can nominate.");
        this.assertAlivePlayer(command.nomineeId, "You can only nominate alive players.");
        if (command.nominatorId === command.nomineeId) {
          throw new GameEngineError("You cannot nominate yourself.");
        }
        if (
          this.state.nominations.some((nomination) => nomination.nominatorId === command.nominatorId)
        ) {
          throw new GameEngineError("You have already made a nomination today.");
        }
        if (this.state.nominations.some((nomination) => nomination.nomineeId === command.nomineeId)) {
          throw new GameEngineError("That player has already been nominated today.");
        }
        break;
      case GameCommandKind.OpenSeats:
        this.assertPhase("setup", "Seats can only be opened during setup.");
        if (this.state.seatsOpen) {
          throw new GameEngineError("Seat selection is already open.");
        }
        break;
      case GameCommandKind.CloseSeats:
        this.assertPhase("setup", "Seats can only be closed during setup.");
        if (!this.state.seatsOpen) {
          throw new GameEngineError("Seat selection is not open.");
        }
        break;
      case GameCommandKind.PickSeat:
        this.assertPhase("setup", "Seats can only be picked during setup.");
        if (!this.state.seatsOpen) {
          throw new GameEngineError("Seat selection is not open yet. Wait for the storyteller.");
        }
        if (!this.state.players.some((player) => player.id === command.playerId)) {
          throw new GameEngineError("Player is not in this game.");
        }
        this.assertValidSeatNumber(command.seat);
        if (
          this.state.players.some(
            (player) => player.id !== command.playerId && player.seat === command.seat,
          )
        ) {
          throw new GameEngineError("That seat is already taken.");
        }
        break;
    }
  }

  handle(command: GameCommand): GameEvent[] {
    this.validate(command);

    switch (command.kind) {
      case GameCommandKind.CreateGame:
        return [
          {
            type: GameEventType.GameCreated,
            gameId: command.gameId,
            guildId: command.guildId,
            channelId: command.channelId,
            storytellerId: command.storytellerId,
            script: command.script,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.AddPlayer:
        return [
          {
            type: GameEventType.PlayerAdded,
            gameId: command.gameId,
            playerId: command.playerId,
            discordUserId: command.discordUserId,
            displayName: command.displayName,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.RemovePlayer:
        return [
          {
            type: GameEventType.PlayerRemoved,
            gameId: command.gameId,
            playerId: command.playerId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.StartGame:
        return [
          {
            type: GameEventType.GameStarted,
            gameId: command.gameId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.AssignRole:
        return [
          {
            type: GameEventType.RoleAssigned,
            gameId: command.gameId,
            playerId: command.playerId,
            roleId: command.roleId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.DealRoles:
        return [
          {
            type: GameEventType.RolesDealt,
            gameId: command.gameId,
            assignments: command.roleAssignments,
            timestamp: new Date().toISOString(),
          },
          {
            type: GameEventType.NightStarted,
            gameId: command.gameId,
            nightNumber: 1,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.BeginNight:
        return [
          {
            type: GameEventType.RolesDealt,
            gameId: command.gameId,
            assignments: this.state.players.map((player) => ({
              playerId: player.id,
              roleId: player.roleId!,
            })),
            timestamp: new Date().toISOString(),
          },
          {
            type: GameEventType.NightStarted,
            gameId: command.gameId,
            nightNumber: 1,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.ClearFakePlayers:
        return this.state.players
          .filter((player) => player.isFake)
          .map((player) => ({
            type: GameEventType.PlayerRemoved,
            gameId: command.gameId,
            playerId: player.id,
            timestamp: new Date().toISOString(),
          }));
      case GameCommandKind.AdvancePhase:
        if (command.targetPhase === "night") {
          return [
            {
              type: GameEventType.NightStarted,
              gameId: command.gameId,
              nightNumber: this.state.nightNumber + 1,
              timestamp: new Date().toISOString(),
            },
          ];
        }
        return [
          {
            type: GameEventType.DayStarted,
            gameId: command.gameId,
            dayNumber: this.state.dayNumber + 1,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.EndGame:
        return [
          {
            type: GameEventType.GameEnded,
            gameId: command.gameId,
            winner: command.winner,
            reason: command.reason,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.PromoteStoryteller:
        return [
          {
            type: GameEventType.StorytellerPromoted,
            gameId: command.gameId,
            discordUserId: command.discordUserId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.MakeNomination:
        return [
          {
            type: GameEventType.NominationMade,
            gameId: command.gameId,
            nominatorId: command.nominatorId,
            nomineeId: command.nomineeId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.OpenSeats:
        return [
          {
            type: GameEventType.SeatsOpened,
            gameId: command.gameId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.CloseSeats:
        return [
          {
            type: GameEventType.SeatsClosed,
            gameId: command.gameId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.PickSeat:
        return [
          {
            type: GameEventType.SeatPicked,
            gameId: command.gameId,
            playerId: command.playerId,
            seat: command.seat,
            timestamp: new Date().toISOString(),
          },
        ];
    }
  }

  apply(event: GameEvent): void {
    switch (event.type) {
      case GameEventType.GameCreated:
        this.state.gameId = event.gameId;
        this.state.guildId = event.guildId;
        this.state.channelId = event.channelId;
        this.state.storytellerId = event.storytellerId;
        this.state.script = event.script ?? resolveStandardScript(StandardEdition.TB);
        this.state.phase = "lobby";
        break;
      case GameEventType.PlayerAdded:
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
      case GameEventType.PlayerRemoved:
        this.state.players = this.state.players
          .filter((player) => player.id !== event.playerId)
          .map((player, index) => ({
            ...player,
            seat: this.state.phase === "lobby" ? index + 1 : player.seat,
          }));
        break;
      case GameEventType.StorytellerPromoted:
        if (!this.state.promotedStorytellerIds.includes(event.discordUserId)) {
          this.state.promotedStorytellerIds.push(event.discordUserId);
        }
        break;
      case GameEventType.GameStarted:
        this.state.phase = "setup";
        this.state.seatsOpen = false;
        for (const player of this.state.players) {
          player.seat = null;
        }
        break;
      case GameEventType.RoleAssigned: {
        const player = this.state.players.find((candidate) => candidate.id === event.playerId);
        if (player) {
          player.roleId = event.roleId;
        }
        break;
      }
      case GameEventType.RolesDealt:
        for (const assignment of event.assignments) {
          const player = this.state.players.find((p) => p.id === assignment.playerId);
          if (player) {
            player.roleId = assignment.roleId;
          }
        }
        break;
      case GameEventType.NightStarted:
        this.state.phase = "night";
        this.state.nightNumber = event.nightNumber;
        break;
      case GameEventType.DayStarted:
        this.state.phase = "day";
        this.state.dayNumber = event.dayNumber;
        this.state.nominations = [];
        break;
      case GameEventType.NominationMade:
        this.state.nominations.push({
          nominatorId: event.nominatorId,
          nomineeId: event.nomineeId,
        });
        break;
      case GameEventType.SeatsOpened:
        this.state.seatsOpen = true;
        break;
      case GameEventType.SeatsClosed:
        this.state.seatsOpen = false;
        break;
      case GameEventType.SeatPicked: {
        const player = this.state.players.find((candidate) => candidate.id === event.playerId);
        if (player) {
          player.seat = event.seat;
        }
        break;
      }
      case GameEventType.PlayerDied: {
        const player = this.state.players.find((p) => p.id === event.playerId);
        if (player) {
          player.alive = false;
        }
        break;
      }
      case GameEventType.GameEnded:
        this.state.phase = "ended";
        this.state.winner = event.winner;
        break;
    }
  }

  getGrimReveal(): string[] {
    const lines: string[] = [];
    for (const player of this.state.players) {
      const role = player.roleId
        ? formatScriptRoleName(this.state.script, player.roleId)
        : "unknown";
      const status = player.alive ? "alive" : "dead";
      const fakeTag = player.isFake ? " [dev]" : "";
      lines.push(`${player.displayName}${fakeTag} — ${role} (${status})`);
    }
    if (this.state.winner) {
      lines.push(`Winner: ${this.state.winner}`);
    }
    return lines;
  }

  private assertScriptRole(roleId: string): void {
    if (!this.state.script?.roles.some((role) => role.id === roleId)) {
      throw new GameEngineError("That role is not on this game's script.");
    }
  }

  private assertRoleAssignments(assignments: Array<{ playerId: string; roleId: string }>): void {
    const playerIds = new Set(this.state.players.map((player) => player.id));
    const roleIds = new Set<string>();
    for (const assignment of assignments) {
      if (!playerIds.has(assignment.playerId)) {
        throw new GameEngineError("Role assignment includes an unknown player.");
      }
      this.assertScriptRole(assignment.roleId);
      if (roleIds.has(assignment.roleId)) {
        throw new GameEngineError("Each role can only be assigned once.");
      }
      roleIds.add(assignment.roleId);
    }
  }

  formatNomination(nomination: NominationState): string {
    const nominator = this.getPlayerById(nomination.nominatorId);
    const nominee = this.getPlayerById(nomination.nomineeId);
    return `${nominator?.displayName ?? "Unknown"} nominates ${nominee?.displayName ?? "Unknown"}`;
  }

  getSeatingChart(): string[] {
    const seatCount = this.state.players.length;
    const lines: string[] = [];

    for (let seat = 1; seat <= seatCount; seat++) {
      const occupant = this.state.players.find((player) => player.seat === seat);
      lines.push(`Seat ${seat}: ${occupant?.displayName ?? "—"}`);
    }

    const unseated = this.state.players.filter((player) => player.seat === null);
    if (unseated.length > 0) {
      lines.push(`Unseated: ${unseated.map((player) => player.displayName).join(", ")}`);
    }

    return lines;
  }

  allPlayersSeated(): boolean {
    return this.state.players.every((player) => player.seat !== null);
  }

  private assertValidSeatNumber(seat: number): void {
    const seatCount = this.state.players.length;
    if (!Number.isInteger(seat) || seat < 1 || seat > seatCount) {
      throw new GameEngineError(`Seat must be between 1 and ${seatCount}.`);
    }
  }

  private assertAlivePlayer(playerId: string, message: string): void {
    const player = this.getPlayerById(playerId);
    if (!player) {
      throw new GameEngineError("Player is not in this game.");
    }
    if (!player.alive) {
      throw new GameEngineError(message);
    }
  }

  private assertPhase(expected: GamePhase, message: string): void {
    if (this.state.phase !== expected) {
      throw new GameEngineError(message);
    }
  }
}

export * from "./plugins/index.js";
export * from "./scripts/index.js";
