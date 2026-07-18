import { randomUUID } from "node:crypto";

export type GamePhase = "lobby" | "setup" | "night" | "day" | "ended";
export type VoteChoice = "yes" | "no" | "conditional";
export type VoteVisibility = "public" | "secret";
export type NominationStatus = "open" | "resolved_pass" | "resolved_fail" | "executed";

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
  script?: GameScript | null;
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

export interface DayOpenedEvent extends GameEventBase {
  type: typeof GameEventType.DayOpened;
  dayNumber: number;
  discordThreadId: string;
}

export interface DefenseAddedEvent extends GameEventBase {
  type: typeof GameEventType.DefenseAdded;
  nominationId: string;
  playerId: string;
  defense: string;
}

export interface VoteCastEvent extends GameEventBase {
  type: typeof GameEventType.VoteCast;
  nominationId: string;
  voterId: string;
  choice: VoteChoice;
  reason: string | null;
  manualSet?: boolean;
}

export interface NominationsPausedEvent extends GameEventBase {
  type: typeof GameEventType.NominationsPaused;
  pausedUntil: string;
}

export interface NominationsResumedEvent extends GameEventBase {
  type: typeof GameEventType.NominationsResumed;
}

export interface VoteVisibilitySetEvent extends GameEventBase {
  type: typeof GameEventType.VoteVisibilitySet;
  visibility: VoteVisibility;
}

export interface NominationsClosedEvent extends GameEventBase {
  type: typeof GameEventType.NominationsClosed;
}

export interface NominationResolvedEvent extends GameEventBase {
  type: typeof GameEventType.NominationResolved;
  nominationId: string;
  passed: boolean;
  yesVotes: number;
  livingCount: number;
}

export interface PlayerDiedEvent extends GameEventBase {
  type: typeof GameEventType.PlayerDied;
  playerId: string;
  cause: string;
  nominationId?: string;
}

export interface NominationMadeEvent extends GameEventBase {
  type: typeof GameEventType.NominationMade;
  nominationId?: string;
  nominatorId: string;
  nomineeId: string;
  accusation?: string;
  order?: number;
  voteDeadlineAt?: string;
}

export interface TownSetupEvent extends GameEventBase {
  type: typeof GameEventType.TownSetup;
  channelId: string;
  players: Array<{
    playerId: string;
    discordUserId: string;
    displayName: string;
    seat: number;
  }>;
}

export interface PlayerAliveChangedEvent extends GameEventBase {
  type: typeof GameEventType.PlayerAliveChanged;
  playerId: string;
  alive: boolean;
}

export interface NominationVotesLockedEvent extends GameEventBase {
  type: typeof GameEventType.NominationVotesLocked;
  nominationId: string;
}

export interface NominationVotesUnlockedEvent extends GameEventBase {
  type: typeof GameEventType.NominationVotesUnlocked;
  nominationId: string;
}

export interface NominationCountStartedEvent extends GameEventBase {
  type: typeof GameEventType.NominationCountStarted;
  nominationId: string;
  handPlayerId: string;
  handIndex: number;
}

export interface NominationCountHandAdvancedEvent extends GameEventBase {
  type: typeof GameEventType.NominationCountHandAdvanced;
  nominationId: string;
  voterId: string;
  choice: VoteChoice;
  handPlayerId: string | null;
  handIndex: number | null;
  finished: boolean;
}

export interface NominationCountFinishedEvent extends GameEventBase {
  type: typeof GameEventType.NominationCountFinished;
  nominationId: string;
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
  | DayOpenedEvent
  | PlayerDiedEvent
  | NominationMadeEvent
  | DefenseAddedEvent
  | VoteCastEvent
  | NominationsPausedEvent
  | NominationsResumedEvent
  | VoteVisibilitySetEvent
  | NominationsClosedEvent
  | NominationResolvedEvent
  | SeatsOpenedEvent
  | SeatsClosedEvent
  | SeatPickedEvent
  | GameEndedEvent
  | TownSetupEvent
  | PlayerAliveChangedEvent
  | NominationVotesLockedEvent
  | NominationVotesUnlockedEvent
  | NominationCountStartedEvent
  | NominationCountHandAdvancedEvent
  | NominationCountFinishedEvent;

export interface PlayerState {
  id: string;
  discordUserId: string;
  displayName: string;
  seat: number | null;
  roleId: string | null;
  alive: boolean;
  isFake: boolean;
  ghostVoteUsed: boolean;
}

export interface NominationRecord {
  id: string;
  nominatorId: string;
  nomineeId: string;
  accusation: string;
  defense: string | null;
  order: number;
  status: NominationStatus;
  voteDeadlineAt: string | null;
  votesLocked: boolean;
  /** Index into eligible count order; null when not counting. */
  countHandIndex: number | null;
}

export interface VoteRecord {
  nominationId: string;
  voterId: string;
  choice: VoteChoice;
  reason: string | null;
}

export interface DayPhaseState {
  dayNumber: number;
  discordThreadId: string | null;
  nominationsOpen: boolean;
  nominationsPausedUntil: string | null;
  voteVisibility: VoteVisibility;
  nominations: NominationRecord[];
  votes: VoteRecord[];
  executionUsed: boolean;
}

export interface VoteTally {
  yes: number;
  no: number;
  conditional: number;
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
  day: DayPhaseState | null;
  seatsOpen: boolean;
  townMode: boolean;
  winner: "good" | "evil" | null;
}

export interface CreateGameCommand {
  kind: typeof GameCommandKind.CreateGame;
  gameId: string;
  guildId: string;
  channelId: string;
  storytellerId: string;
  script?: GameScript | null;
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
  accusation: string;
  /** Storyteller override: allow a second nomination today for nominator and/or nominee. */
  allowDuplicate?: boolean;
}

export interface OpenDayCommand {
  kind: typeof GameCommandKind.OpenDay;
  gameId: string;
  discordThreadId: string;
}

export interface AddDefenseCommand {
  kind: typeof GameCommandKind.AddDefense;
  gameId: string;
  playerId: string;
  nominationId: string;
  defense: string;
}

export interface CastVoteCommand {
  kind: typeof GameCommandKind.CastVote;
  gameId: string;
  voterId: string;
  nominationId: string;
  choice: VoteChoice;
  reason?: string | null;
}

export interface SetPlayerVoteCommand {
  kind: typeof GameCommandKind.SetPlayerVote;
  gameId: string;
  voterId: string;
  nominationId: string;
  choice: VoteChoice;
  reason?: string | null;
}

export interface KillPlayerCommand {
  kind: typeof GameCommandKind.KillPlayer;
  gameId: string;
  playerId: string;
  cause: string;
}

export interface PauseNominationsCommand {
  kind: typeof GameCommandKind.PauseNominations;
  gameId: string;
  pausedUntil: string;
}

export interface ResumeNominationsCommand {
  kind: typeof GameCommandKind.ResumeNominations;
  gameId: string;
}

export interface SetVoteVisibilityCommand {
  kind: typeof GameCommandKind.SetVoteVisibility;
  gameId: string;
  visibility: VoteVisibility;
}

export interface CloseNominationsCommand {
  kind: typeof GameCommandKind.CloseNominations;
  gameId: string;
}

export interface ResolveNominationCommand {
  kind: typeof GameCommandKind.ResolveNomination;
  gameId: string;
  /** When set, resolve this open nomination; otherwise the oldest open one. */
  nominationId?: string;
}

export interface ExecutePlayerCommand {
  kind: typeof GameCommandKind.ExecutePlayer;
  gameId: string;
  playerId: string;
  nominationId: string;
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

export interface SetupTownPlayerInput {
  playerId: string;
  discordUserId: string;
  displayName: string;
}

export interface SetupTownCommand {
  kind: typeof GameCommandKind.SetupTown;
  gameId: string;
  channelId: string;
  players: SetupTownPlayerInput[];
  minPlayers?: number;
}

export interface SetPlayerAliveCommand {
  kind: typeof GameCommandKind.SetPlayerAlive;
  gameId: string;
  playerId: string;
  alive: boolean;
}

export interface LockNominationVotesCommand {
  kind: typeof GameCommandKind.LockNominationVotes;
  gameId: string;
  nominationId: string;
}

export interface UnlockNominationVotesCommand {
  kind: typeof GameCommandKind.UnlockNominationVotes;
  gameId: string;
  nominationId: string;
}

export interface StartNominationCountCommand {
  kind: typeof GameCommandKind.StartNominationCount;
  gameId: string;
  nominationId: string;
}

export interface CountHandVoteCommand {
  kind: typeof GameCommandKind.CountHandVote;
  gameId: string;
  nominationId: string;
  choice: "yes" | "no";
}

export interface CancelNominationCountCommand {
  kind: typeof GameCommandKind.CancelNominationCount;
  gameId: string;
  nominationId: string;
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
  | OpenDayCommand
  | AddDefenseCommand
  | CastVoteCommand
  | SetPlayerVoteCommand
  | KillPlayerCommand
  | PauseNominationsCommand
  | ResumeNominationsCommand
  | SetVoteVisibilityCommand
  | CloseNominationsCommand
  | ResolveNominationCommand
  | ExecutePlayerCommand
  | OpenSeatsCommand
  | CloseSeatsCommand
  | PickSeatCommand
  | EndGameCommand
  | PromoteStorytellerCommand
  | SetupTownCommand
  | SetPlayerAliveCommand
  | LockNominationVotesCommand
  | UnlockNominationVotesCommand
  | StartNominationCountCommand
  | CountHandVoteCommand
  | CancelNominationCountCommand;

export const DEFAULT_MIN_PLAYERS = 5;
export const DEV_MIN_PLAYERS = 3;
export const NOMINATION_VOTE_DEADLINE_MS = 24 * 3_600_000;

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
    day: null,
    seatsOpen: false,
    townMode: false,
    winner: null,
  };
}

export function countLivingPlayers(state: GameState): number {
  return state.players.filter((player) => player.alive).length;
}

export function passesExecutionVote(yesVotes: number, livingCount: number): boolean {
  return yesVotes > Math.floor(livingCount / 2);
}

/** Yes votes required to put a nominee on the block (majority of living players). */
export function votesNeededOnTheBlock(livingCount: number): number {
  return Math.floor(livingCount / 2) + 1;
}

export interface NominationVoteStanding {
  nominationId: string;
  nomineeId: string;
  yesVotes: number;
  hasMajority: boolean;
}

export type BlockContest =
  | { kind: "empty" }
  | { kind: "sole"; leader: NominationVoteStanding }
  | { kind: "tie"; leaders: NominationVoteStanding[]; yesVotes: number };

/**
 * Among locked nominations with a majority, who currently holds the block.
 * A tie for most votes means nobody is uniquely on the block.
 */
export function getBlockContest(
  state: GameState,
  options?: { includeNominationIds?: string[] },
): BlockContest {
  const day = state.day;
  if (!day) return { kind: "empty" };

  const living = countLivingPlayers(state);
  const standings: NominationVoteStanding[] = [];

  for (const nomination of day.nominations) {
    if (nomination.status !== "open" && nomination.status !== "resolved_pass") continue;
    if (!nomination.votesLocked && nomination.status === "open") continue;
    if (
      options?.includeNominationIds &&
      !options.includeNominationIds.includes(nomination.id)
    ) {
      continue;
    }
    const yesVotes = getEffectiveYesVotes(state, nomination.id);
    standings.push({
      nominationId: nomination.id,
      nomineeId: nomination.nomineeId,
      yesVotes,
      hasMajority: passesExecutionVote(yesVotes, living),
    });
  }

  const majority = standings.filter((standing) => standing.hasMajority);
  if (majority.length === 0) return { kind: "empty" };

  const topYes = Math.max(...majority.map((standing) => standing.yesVotes));
  const leaders = majority.filter((standing) => standing.yesVotes === topYes);
  if (leaders.length === 1) {
    return { kind: "sole", leader: leaders[0]! };
  }
  return { kind: "tie", leaders, yesVotes: topYes };
}

export function createEmptyDayState(dayNumber: number): DayPhaseState {
  return {
    dayNumber,
    discordThreadId: null,
    nominationsOpen: true,
    nominationsPausedUntil: null,
    voteVisibility: "public",
    nominations: [],
    votes: [],
    executionUsed: false,
  };
}

export function getNominationTally(state: GameState, nominationId: string): VoteTally {
  const tally: VoteTally = { yes: 0, no: 0, conditional: 0 };
  if (!state.day) return tally;

  for (const vote of state.day.votes) {
    if (vote.nominationId !== nominationId) continue;
    tally[vote.choice]++;
  }
  return tally;
}

export function getEffectiveYesVotes(state: GameState, nominationId: string): number {
  if (!state.day) return 0;

  let yes = 0;
  for (const vote of state.day.votes) {
    if (vote.nominationId !== nominationId || vote.choice !== "yes") continue;
    yes++;
  }
  return yes;
}

export function isNominationsPaused(day: DayPhaseState, now = new Date()): boolean {
  if (!day.nominationsPausedUntil) return false;
  return new Date(day.nominationsPausedUntil) > now;
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

  getNominationById(nominationId: string): NominationRecord | undefined {
    return this.state.day?.nominations.find((nomination) => nomination.id === nominationId);
  }

  getNextOpenNomination(): NominationRecord | undefined {
    if (!this.state.day) return undefined;
    return this.state.day.nominations
      .filter((nomination) => nomination.status === "open")
      .sort((a, b) => a.order - b.order)[0];
  }

  getNominationTally(nominationId: string): VoteTally {
    return getNominationTally(this.state, nominationId);
  }

  getEffectiveYesVotes(nominationId: string): number {
    return getEffectiveYesVotes(this.state, nominationId);
  }

  countLivingPlayers(): number {
    return countLivingPlayers(this.state);
  }

  votesNeededOnTheBlock(): number {
    return votesNeededOnTheBlock(this.countLivingPlayers());
  }

  getBlockContest(options?: { includeNominationIds?: string[] }): BlockContest {
    return getBlockContest(this.state, options);
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
        if (command.targetPhase === "night" && this.state.townMode && this.state.phase === "day") {
          const open = this.state.day?.nominations.some((nomination) => nomination.status === "open");
          if (open) {
            throw new GameEngineError(
              "Resolve or clear open nominations before starting the next night.",
            );
          }
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
        this.assertDayState();
        this.assertNominationsAcceptingNew();
        this.assertAlivePlayer(command.nominatorId, "Ghosts cannot nominate.");
        this.assertAlivePlayer(command.nomineeId, "You can only nominate alive players.");
        if (command.nominatorId === command.nomineeId) {
          throw new GameEngineError("You cannot nominate yourself.");
        }
        if (!command.accusation.trim()) {
          throw new GameEngineError("An accusation is required.");
        }
        if (!command.allowDuplicate) {
          if (
            this.state.day!.nominations.some(
              (nomination) => nomination.nominatorId === command.nominatorId,
            )
          ) {
            throw new GameEngineError("You have already made a nomination today.");
          }
          if (
            this.state.day!.nominations.some(
              (nomination) => nomination.nomineeId === command.nomineeId,
            )
          ) {
            throw new GameEngineError("That player has already been nominated today.");
          }
        }
        break;
      case GameCommandKind.OpenDay:
        this.assertPhase("day", "Day can only be opened during the day phase.");
        if (!this.state.day) {
          throw new GameEngineError("Day state is not initialized.");
        }
        break;
      case GameCommandKind.AddDefense: {
        this.assertPhase("day", "Defense can only be added during the day.");
        this.assertDayState();
        const nomination = this.getNominationById(command.nominationId);
        if (!nomination || nomination.status !== "open") {
          throw new GameEngineError("That nomination is not open.");
        }
        if (nomination.nomineeId !== command.playerId) {
          throw new GameEngineError("Only the nominee can add a defense.");
        }
        if (!command.defense.trim()) {
          throw new GameEngineError("Defense text is required.");
        }
        break;
      }
      case GameCommandKind.CastVote: {
        this.assertPhase("day", "Votes can only be cast during the day.");
        this.assertDayState();
        if (!this.state.day!.nominationsOpen) {
          throw new GameEngineError("Nominations and voting are closed.");
        }
        const nomination = this.getNominationById(command.nominationId);
        if (!nomination || nomination.status !== "open") {
          throw new GameEngineError("That nomination is not open for voting.");
        }
        const voter = this.getPlayerById(command.voterId);
        if (!voter) {
          throw new GameEngineError("Player is not in this game.");
        }
        if (command.choice === "conditional" && !command.reason?.trim()) {
          throw new GameEngineError("Conditional votes require a reason.");
        }
        if (
          nomination.voteDeadlineAt &&
          Date.now() >= new Date(nomination.voteDeadlineAt).getTime()
        ) {
          throw new GameEngineError("Voting has closed on this nomination.");
        }
        if (nomination.votesLocked) {
          throw new GameEngineError("Votes are locked on this nomination. Ask the storyteller to unlock.");
        }
        if (nomination.countHandIndex != null) {
          throw new GameEngineError("A vote count is in progress. Wait for the storyteller.");
        }
        if (!voter.alive) {
          if (voter.ghostVoteUsed) {
            throw new GameEngineError("You have already used your ghost vote.");
          }
          if (command.choice !== "yes") {
            throw new GameEngineError("Ghost votes must be yes.");
          }
        }
        break;
      }
      case GameCommandKind.SetPlayerVote: {
        this.assertPhase("day", "Votes can only be set during the day.");
        this.assertDayState();
        const nomination = this.getNominationById(command.nominationId);
        if (!nomination || nomination.status !== "open") {
          throw new GameEngineError("That nomination is not open for voting.");
        }
        const voter = this.getPlayerById(command.voterId);
        if (!voter) {
          throw new GameEngineError("Player is not in this game.");
        }
        if (command.choice === "conditional" && !command.reason?.trim()) {
          throw new GameEngineError("Conditional votes require a reason.");
        }
        break;
      }
      case GameCommandKind.KillPlayer:
        if (this.state.phase === "ended") {
          throw new GameEngineError("Game has already ended.");
        }
        if (!this.getPlayerById(command.playerId)) {
          throw new GameEngineError("Player is not in this game.");
        }
        this.assertAlivePlayer(command.playerId, "That player is already dead.");
        break;
      case GameCommandKind.PauseNominations:
        this.assertPhase("day", "Nominations can only be paused during the day.");
        this.assertDayState();
        break;
      case GameCommandKind.ResumeNominations:
        this.assertPhase("day", "Nominations can only be resumed during the day.");
        this.assertDayState();
        break;
      case GameCommandKind.SetVoteVisibility:
        this.assertPhase("day", "Vote visibility can only be changed during the day.");
        this.assertDayState();
        break;
      case GameCommandKind.CloseNominations:
        this.assertPhase("day", "Nominations can only be closed during the day.");
        this.assertDayState();
        if (!this.state.day!.nominationsOpen) {
          throw new GameEngineError("Nominations are already closed.");
        }
        break;
      case GameCommandKind.ResolveNomination: {
        this.assertPhase("day", "Nominations can only be resolved during the day.");
        this.assertDayState();
        if (command.nominationId) {
          const nomination = this.getNominationById(command.nominationId);
          if (!nomination || nomination.status !== "open") {
            throw new GameEngineError("That nomination is not open.");
          }
        } else if (!this.getNextOpenNomination()) {
          throw new GameEngineError("No open nominations remain to resolve.");
        }
        break;
      }
      case GameCommandKind.ExecutePlayer: {
        this.assertPhase("day", "Executions can only happen during the day.");
        this.assertDayState();
        if (this.state.day!.executionUsed) {
          throw new GameEngineError("Only one execution is allowed per day.");
        }
        const nomination = this.getNominationById(command.nominationId);
        if (!nomination || nomination.status !== "resolved_pass") {
          throw new GameEngineError("That nomination has not passed.");
        }
        if (nomination.nomineeId !== command.playerId) {
          throw new GameEngineError("That player is not the nominee for this execution.");
        }
        this.assertAlivePlayer(command.playerId, "That player is already dead.");
        break;
      }
      case GameCommandKind.SetupTown: {
        if (this.state.phase === "ended") {
          throw new GameEngineError("Game has already ended.");
        }
        const minPlayers = command.minPlayers ?? DEFAULT_MIN_PLAYERS;
        if (command.players.length < minPlayers) {
          throw new GameEngineError(`At least ${minPlayers} players are required to set up town.`);
        }
        const discordIds = new Set<string>();
        for (const player of command.players) {
          if (discordIds.has(player.discordUserId)) {
            throw new GameEngineError("Duplicate players in town setup.");
          }
          discordIds.add(player.discordUserId);
        }
        break;
      }
      case GameCommandKind.SetPlayerAlive:
        if (this.state.phase === "ended") {
          throw new GameEngineError("Game has already ended.");
        }
        if (!this.getPlayerById(command.playerId)) {
          throw new GameEngineError("Player is not in this game.");
        }
        break;
      case GameCommandKind.LockNominationVotes: {
        this.assertPhase("day", "Votes can only be locked during the day.");
        this.assertDayState();
        const nomination = this.getNominationById(command.nominationId);
        if (!nomination || nomination.status !== "open") {
          throw new GameEngineError("That nomination is not open.");
        }
        if (nomination.votesLocked) {
          throw new GameEngineError("Votes are already locked on this nomination.");
        }
        break;
      }
      case GameCommandKind.UnlockNominationVotes: {
        this.assertPhase("day", "Votes can only be unlocked during the day.");
        this.assertDayState();
        const nomination = this.getNominationById(command.nominationId);
        if (!nomination || nomination.status !== "open") {
          throw new GameEngineError("That nomination is not open.");
        }
        if (!nomination.votesLocked && nomination.countHandIndex == null) {
          throw new GameEngineError("Votes are not locked on this nomination.");
        }
        break;
      }
      case GameCommandKind.StartNominationCount: {
        this.assertPhase("day", "Vote counts can only start during the day.");
        this.assertDayState();
        const nomination = this.getNominationById(command.nominationId);
        if (!nomination || nomination.status !== "open") {
          throw new GameEngineError("That nomination is not open.");
        }
        if (nomination.votesLocked) {
          throw new GameEngineError("Votes are already locked on this nomination.");
        }
        if (nomination.countHandIndex != null) {
          throw new GameEngineError("A vote count is already in progress.");
        }
        if (this.getCountEligiblePlayers(nomination.nomineeId).length === 0) {
          throw new GameEngineError("No eligible voters to count.");
        }
        break;
      }
      case GameCommandKind.CountHandVote: {
        this.assertPhase("day", "Vote counts can only advance during the day.");
        this.assertDayState();
        const nomination = this.getNominationById(command.nominationId);
        if (!nomination || nomination.status !== "open") {
          throw new GameEngineError("That nomination is not open.");
        }
        if (nomination.countHandIndex == null) {
          throw new GameEngineError("Start the vote count first.");
        }
        if (nomination.votesLocked) {
          throw new GameEngineError("Votes are already locked.");
        }
        if (command.choice !== "yes" && command.choice !== "no") {
          throw new GameEngineError("Count votes must be yes or no.");
        }
        break;
      }
      case GameCommandKind.CancelNominationCount: {
        this.assertPhase("day", "Vote counts can only be cancelled during the day.");
        this.assertDayState();
        const nomination = this.getNominationById(command.nominationId);
        if (!nomination || nomination.status !== "open") {
          throw new GameEngineError("That nomination is not open.");
        }
        if (nomination.countHandIndex == null) {
          throw new GameEngineError("No vote count is in progress.");
        }
        break;
      }
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
            script: command.script ?? null,
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
      case GameCommandKind.MakeNomination: {
        const order = (this.state.day?.nominations.length ?? 0) + 1;
        const nominationId = randomUUID();
        const voteDeadlineAt = new Date(Date.now() + NOMINATION_VOTE_DEADLINE_MS).toISOString();
        return [
          {
            type: GameEventType.NominationMade,
            gameId: command.gameId,
            nominationId,
            nominatorId: command.nominatorId,
            nomineeId: command.nomineeId,
            accusation: command.accusation.trim(),
            order,
            voteDeadlineAt,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      case GameCommandKind.OpenDay:
        return [
          {
            type: GameEventType.DayOpened,
            gameId: command.gameId,
            dayNumber: this.state.dayNumber,
            discordThreadId: command.discordThreadId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.AddDefense:
        return [
          {
            type: GameEventType.DefenseAdded,
            gameId: command.gameId,
            nominationId: command.nominationId,
            playerId: command.playerId,
            defense: command.defense.trim(),
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.CastVote:
        return [
          {
            type: GameEventType.VoteCast,
            gameId: command.gameId,
            nominationId: command.nominationId,
            voterId: command.voterId,
            choice: command.choice,
            reason: command.reason?.trim() ?? null,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.SetPlayerVote:
        return [
          {
            type: GameEventType.VoteCast,
            gameId: command.gameId,
            nominationId: command.nominationId,
            voterId: command.voterId,
            choice: command.choice,
            reason: command.reason?.trim() ?? null,
            manualSet: true,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.KillPlayer:
        return [
          {
            type: GameEventType.PlayerDied,
            gameId: command.gameId,
            playerId: command.playerId,
            cause: command.cause,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.PauseNominations:
        return [
          {
            type: GameEventType.NominationsPaused,
            gameId: command.gameId,
            pausedUntil: command.pausedUntil,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.ResumeNominations:
        return [
          {
            type: GameEventType.NominationsResumed,
            gameId: command.gameId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.SetVoteVisibility:
        return [
          {
            type: GameEventType.VoteVisibilitySet,
            gameId: command.gameId,
            visibility: command.visibility,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.CloseNominations:
        return [
          {
            type: GameEventType.NominationsClosed,
            gameId: command.gameId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.ResolveNomination: {
        const nomination = command.nominationId
          ? this.getNominationById(command.nominationId)!
          : this.getNextOpenNomination()!;
        const yesVotes = this.getEffectiveYesVotes(nomination.id);
        const livingCount = this.countLivingPlayers();
        const passed = passesExecutionVote(yesVotes, livingCount);
        return [
          {
            type: GameEventType.NominationResolved,
            gameId: command.gameId,
            nominationId: nomination.id,
            passed,
            yesVotes,
            livingCount,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      case GameCommandKind.ExecutePlayer:
        return [
          {
            type: GameEventType.PlayerDied,
            gameId: command.gameId,
            playerId: command.playerId,
            cause: "execution",
            nominationId: command.nominationId,
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
      case GameCommandKind.SetupTown:
        return [
          {
            type: GameEventType.TownSetup,
            gameId: command.gameId,
            channelId: command.channelId,
            players: command.players.map((player, index) => ({
              playerId: player.playerId,
              discordUserId: player.discordUserId,
              displayName: player.displayName,
              seat: index + 1,
            })),
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.SetPlayerAlive: {
        const player = this.getPlayerById(command.playerId)!;
        if (player.alive === command.alive) {
          return [];
        }
        return [
          {
            type: GameEventType.PlayerAliveChanged,
            gameId: command.gameId,
            playerId: command.playerId,
            alive: command.alive,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      case GameCommandKind.LockNominationVotes:
        return [
          {
            type: GameEventType.NominationVotesLocked,
            gameId: command.gameId,
            nominationId: command.nominationId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.UnlockNominationVotes:
        return [
          {
            type: GameEventType.NominationVotesUnlocked,
            gameId: command.gameId,
            nominationId: command.nominationId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.StartNominationCount: {
        const nomination = this.getNominationById(command.nominationId)!;
        const handPlayer = this.getCountEligiblePlayers(nomination.nomineeId)[0]!;
        return [
          {
            type: GameEventType.NominationCountStarted,
            gameId: command.gameId,
            nominationId: command.nominationId,
            handPlayerId: handPlayer.id,
            handIndex: 0,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      case GameCommandKind.CountHandVote: {
        const nomination = this.getNominationById(command.nominationId)!;
        const eligible = this.getCountEligiblePlayers(nomination.nomineeId);
        const handIndex = nomination.countHandIndex ?? 0;
        const voter = eligible[handIndex];
        if (!voter) {
          throw new GameEngineError("No voter under the hand.");
        }
        const nextIndex = handIndex + 1;
        const finished = nextIndex >= eligible.length;
        const nextPlayer = finished ? null : eligible[nextIndex]!;
        return [
          {
            type: GameEventType.NominationCountHandAdvanced,
            gameId: command.gameId,
            nominationId: command.nominationId,
            voterId: voter.id,
            choice: command.choice,
            handPlayerId: nextPlayer?.id ?? null,
            handIndex: finished ? null : nextIndex,
            finished,
            timestamp: new Date().toISOString(),
          },
          ...(finished
            ? [
                {
                  type: GameEventType.NominationCountFinished,
                  gameId: command.gameId,
                  nominationId: command.nominationId,
                  timestamp: new Date().toISOString(),
                } as const,
                {
                  type: GameEventType.NominationVotesLocked,
                  gameId: command.gameId,
                  nominationId: command.nominationId,
                  timestamp: new Date().toISOString(),
                } as const,
              ]
            : []),
        ];
      }
      case GameCommandKind.CancelNominationCount:
        return [
          {
            type: GameEventType.NominationCountFinished,
            gameId: command.gameId,
            nominationId: command.nominationId,
            timestamp: new Date().toISOString(),
          },
        ];
      default:
        return [];
    }
  }

  apply(event: GameEvent): void {
    switch (event.type) {
      case GameEventType.GameCreated:
        this.state.gameId = event.gameId;
        this.state.guildId = event.guildId;
        this.state.channelId = event.channelId;
        this.state.storytellerId = event.storytellerId;
        this.state.script = event.script ?? null;
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
          ghostVoteUsed: false,
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
        this.state.day = createEmptyDayState(event.dayNumber);
        break;
      case GameEventType.DayOpened:
        if (this.state.day) {
          this.state.day.discordThreadId = event.discordThreadId;
        }
        break;
      case GameEventType.NominationMade: {
        if (!this.state.day) {
          this.state.day = createEmptyDayState(this.state.dayNumber || 1);
        }
        this.state.day.nominations.push({
          id: event.nominationId ?? randomUUID(),
          nominatorId: event.nominatorId,
          nomineeId: event.nomineeId,
          accusation: event.accusation ?? "",
          defense: null,
          order: event.order ?? this.state.day.nominations.length + 1,
          status: "open",
          voteDeadlineAt: event.voteDeadlineAt ?? null,
          votesLocked: false,
          countHandIndex: null,
        });
        break;
      }
      case GameEventType.DefenseAdded: {
        const nomination = this.getNominationById(event.nominationId);
        if (nomination) {
          nomination.defense = event.defense;
        }
        break;
      }
      case GameEventType.VoteCast: {
        if (!this.state.day) break;
        const existingIndex = this.state.day.votes.findIndex(
          (vote) =>
            vote.nominationId === event.nominationId && vote.voterId === event.voterId,
        );
        const voteRecord: VoteRecord = {
          nominationId: event.nominationId,
          voterId: event.voterId,
          choice: event.choice,
          reason: event.reason,
        };
        if (existingIndex >= 0) {
          this.state.day.votes[existingIndex] = voteRecord;
        } else {
          this.state.day.votes.push(voteRecord);
        }
        const voter = this.getPlayerById(event.voterId);
        if (voter && !voter.alive && !event.manualSet) {
          voter.ghostVoteUsed = true;
        }
        break;
      }
      case GameEventType.NominationsPaused:
        if (this.state.day) {
          this.state.day.nominationsPausedUntil = event.pausedUntil;
        }
        break;
      case GameEventType.NominationsResumed:
        if (this.state.day) {
          this.state.day.nominationsPausedUntil = null;
        }
        break;
      case GameEventType.VoteVisibilitySet:
        if (this.state.day) {
          this.state.day.voteVisibility = event.visibility;
        }
        break;
      case GameEventType.NominationsClosed:
        if (this.state.day) {
          this.state.day.nominationsOpen = false;
        }
        break;
      case GameEventType.NominationResolved: {
        const nomination = this.getNominationById(event.nominationId);
        if (nomination) {
          nomination.status = event.passed ? "resolved_pass" : "resolved_fail";
        }
        break;
      }
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
        if (event.cause === "execution" && event.nominationId && this.state.day) {
          this.state.day.executionUsed = true;
          const nomination = this.getNominationById(event.nominationId);
          if (nomination) {
            nomination.status = "executed";
          }
        }
        break;
      }
      case GameEventType.GameEnded:
        this.state.phase = "ended";
        this.state.winner = event.winner;
        break;
      case GameEventType.TownSetup:
        this.state.channelId = event.channelId;
        this.state.players = event.players.map((player) => ({
          id: player.playerId,
          discordUserId: player.discordUserId,
          displayName: player.displayName,
          seat: player.seat,
          roleId: null,
          alive: true,
          isFake: player.discordUserId.startsWith("dev:"),
          ghostVoteUsed: false,
        }));
        this.state.phase = "day";
        this.state.dayNumber = 1;
        // Night 1 is skipped at setup (roles/first night handled offline); next night is Night 2.
        this.state.nightNumber = 1;
        this.state.townMode = true;
        this.state.seatsOpen = false;
        this.state.day = createEmptyDayState(1);
        break;
      case GameEventType.PlayerAliveChanged: {
        const player = this.state.players.find((candidate) => candidate.id === event.playerId);
        if (player) {
          player.alive = event.alive;
        }
        break;
      }
      case GameEventType.NominationVotesLocked: {
        const nomination = this.getNominationById(event.nominationId);
        if (nomination) {
          nomination.votesLocked = true;
          nomination.countHandIndex = null;
        }
        break;
      }
      case GameEventType.NominationVotesUnlocked: {
        const nomination = this.getNominationById(event.nominationId);
        if (nomination) {
          nomination.votesLocked = false;
          nomination.countHandIndex = null;
        }
        break;
      }
      case GameEventType.NominationCountStarted: {
        const nomination = this.getNominationById(event.nominationId);
        if (nomination) {
          nomination.countHandIndex = event.handIndex;
        }
        break;
      }
      case GameEventType.NominationCountHandAdvanced: {
        if (!this.state.day) break;
        const existingIndex = this.state.day.votes.findIndex(
          (vote) =>
            vote.nominationId === event.nominationId && vote.voterId === event.voterId,
        );
        const voteRecord: VoteRecord = {
          nominationId: event.nominationId,
          voterId: event.voterId,
          choice: event.choice,
          reason: null,
        };
        if (existingIndex >= 0) {
          this.state.day.votes[existingIndex] = voteRecord;
        } else {
          this.state.day.votes.push(voteRecord);
        }
        const voter = this.getPlayerById(event.voterId);
        if (voter && !voter.alive && event.choice === "yes") {
          voter.ghostVoteUsed = true;
        }
        const nomination = this.getNominationById(event.nominationId);
        if (nomination) {
          nomination.countHandIndex = event.handIndex;
        }
        break;
      }
      case GameEventType.NominationCountFinished: {
        const nomination = this.getNominationById(event.nominationId);
        if (nomination) {
          nomination.countHandIndex = null;
        }
        break;
      }
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

  formatNomination(nomination: NominationRecord): string {
    const nominator = this.getPlayerById(nomination.nominatorId);
    const nominee = this.getPlayerById(nomination.nomineeId);
    const base = `${nominator?.displayName ?? "Unknown"} nominates ${nominee?.displayName ?? "Unknown"}`;
    if (nomination.accusation) {
      return `${base}: ${nomination.accusation}`;
    }
    return base;
  }

  formatNominationTally(nominationId: string, options?: { revealSecret?: boolean }): string {
    const tally = this.getNominationTally(nominationId);
    const day = this.state.day;
    if (day?.voteVisibility === "secret" && !options?.revealSecret) {
      return "Votes recorded (secret mode)";
    }
    return `Yes: ${tally.yes} | No: ${tally.no} | Conditional: ${tally.conditional}`;
  }

  /** Storyteller vote roll — seat order starting after the nominee, ending with the nominee. */
  formatNominationVoteRoll(nominationId: string): string {
    const day = this.state.day;
    const nomination = this.getNominationById(nominationId);
    if (!day || !nomination) return "—";

    const ordered = this.getVoteLockInOrder(nomination.nomineeId);
    if (ordered.length === 0) return "_No seated players._";

    const votesByVoter = new Map(
      day.votes
        .filter((vote) => vote.nominationId === nominationId)
        .map((vote) => [vote.voterId, vote] as const),
    );

    const handPlayerId =
      nomination.countHandIndex != null
        ? this.getCountEligiblePlayers(nomination.nomineeId)[nomination.countHandIndex]?.id
        : null;

    const lines = ordered.map((player, index) => {
      const seat = player.seat != null ? `seat ${player.seat}` : "unseated";
      const vote = votesByVoter.get(player.id);
      const deadTag = player.alive ? "" : " [dead]";
      const underHand = player.id === handPlayerId;
      let status: string;
      if (vote) {
        const reason = vote.reason ? ` — ${vote.reason}` : "";
        const ghostTag = !player.alive ? " (ghost)" : "";
        status = `**${vote.choice}**${ghostTag}${reason}`;
      } else if (!player.alive && player.ghostVoteUsed) {
        status = "_ghost used (no vote this nomination)_";
      } else if (!player.alive) {
        status = "_ghost available — pending_";
      } else {
        status = "_pending_";
      }
      const line = `${index + 1}. ${player.displayName}${deadTag} (${seat}): ${status}`;
      return underHand ? `👉 **${line}**` : line;
    });

    return lines.join("\n");
  }

  /** Summary of dead players and whether their ghost vote remains. */
  formatGhostVoteStatus(): string {
    const dead = this.state.players
      .filter((player) => !player.alive)
      .sort((a, b) => (a.seat ?? 999) - (b.seat ?? 999));
    if (dead.length === 0) return "_Nobody dead._";
    return dead
      .map((player) => {
        const seat = player.seat != null ? `seat ${player.seat}` : "unseated";
        const ghost = player.ghostVoteUsed ? "**used**" : "**available**";
        return `• ${player.displayName} (${seat}): ghost ${ghost}`;
      })
      .join("\n");
  }

  /**
   * Voting / lock-in order around the circle: first player after the nominee by seat,
   * wrapping until the nominee votes last.
   */
  getVoteLockInOrder(nomineeId: string): PlayerState[] {
    const seated = this.state.players
      .filter((player) => player.seat != null)
      .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
    if (seated.length === 0) return [];

    const nomineeIndex = seated.findIndex((player) => player.id === nomineeId);
    if (nomineeIndex < 0) {
      return seated;
    }

    const start = (nomineeIndex + 1) % seated.length;
    const ordered: PlayerState[] = [];
    for (let offset = 0; offset < seated.length; offset++) {
      ordered.push(seated[(start + offset) % seated.length]!);
    }
    return ordered;
  }

  /** Players who can participate in a counted vote (alive, or dead with ghost remaining). */
  getCountEligiblePlayers(nomineeId: string): PlayerState[] {
    return this.getVoteLockInOrder(nomineeId).filter(
      (player) => player.alive || !player.ghostVoteUsed,
    );
  }

  getCountHandPlayer(nominationId: string): PlayerState | null {
    const nomination = this.getNominationById(nominationId);
    if (!nomination || nomination.countHandIndex == null) return null;
    return this.getCountEligiblePlayers(nomination.nomineeId)[nomination.countHandIndex] ?? null;
  }

  getPlayersMissingVotes(nominationId: string): PlayerState[] {
    const day = this.state.day;
    const nomination = this.getNominationById(nominationId);
    if (!day || !nomination) return [];
    const voted = new Set(
      day.votes.filter((vote) => vote.nominationId === nominationId).map((vote) => vote.voterId),
    );
    return this.getCountEligiblePlayers(nomination.nomineeId).filter(
      (player) => !voted.has(player.id),
    );
  }

  getSeatingChart(): string[] {
    const seatCount = this.state.players.length;
    const lines: string[] = [];

    for (let seat = 1; seat <= seatCount; seat++) {
      const occupant = this.state.players.find((player) => player.seat === seat);
      if (!occupant) {
        lines.push(`Seat ${seat}: —`);
        continue;
      }
      let status = occupant.alive ? "alive" : "dead";
      if (!occupant.alive) {
        status += occupant.ghostVoteUsed ? ", ghost used" : ", ghost available";
      }
      lines.push(`Seat ${seat}: ${occupant.displayName} (${status})`);
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

  private assertDayState(): void {
    if (!this.state.day) {
      throw new GameEngineError("Day state is not initialized.");
    }
  }

  private assertNominationsAcceptingNew(): void {
    this.assertDayState();
    if (!this.state.day!.nominationsOpen) {
      throw new GameEngineError("Nominations are closed.");
    }
    if (isNominationsPaused(this.state.day!)) {
      throw new GameEngineError("Nominations are paused.");
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
