import { randomUUID } from "node:crypto";

export type GamePhase = "lobby" | "setup" | "night" | "day" | "ended";
/** Open-ended vote value; canonical values are "yes", "no", "conditional" but any string is accepted. */
export type VoteChoice = string;
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
import {
  type BuffetDraftConfig,
  type BuffetDraftState,
  type BuffetCurrentOffer,
  type BuffetSecretRole,
  buildInitialPool,
  buildPickablePool,
  buildNextOffer,
  buildLilMonstaMinionOffer,
  applyPick,
  applyMulligan,
  applySummonerNoDemonSetup,
  applyAssignDrunk,
  applyAssignLunatic,
  assignSecretRoles,
  collectBuffetPreAssignments,
  chooseOutsiderAdjustment,
  computeRemainingSlots,
  defaultBuffetConfig,
  validatePoolForComposition,
  planMarionetteSeatSwaps,
  shuffle,
  isBuffetSecretRole,
  OUTSIDER_SETUP_DELTAS,
} from "./buffet-draft.js";

export * from "./command-kinds.js";
export * from "./event-types.js";
export {
  type BuffetDraftConfig,
  type BuffetDraftState,
  type BuffetCurrentOffer,
  type BuffetScriptPreset,
  type BuffetSecretRole,
  type BuffetOfferKind,
  defaultBuffetConfig,
  buildInitialPool,
  buildPickablePool,
  computeRemainingSlots,
  validatePoolForComposition,
  applySummonerNoDemonSetup,
  OUTSIDER_SETUP_DELTAS,
  BUFFET_SECRET_ROLES,
  BUFFET_HIDDEN_BY_DEFAULT,
  describeBuffetDrunkFix,
  formatBuffetDrunkFixLine,
  formatHermitUnchosenOutsidersLine,
  listUnchosenOutsidersForHermit,
  formatBuffetDraftTracker,
  applyAssignLunatic,
  collectBuffetPreAssignments,
  isBuffetSecretRole,
} from "./buffet-draft.js";

export {
  describeBuffetRules,
  formatBuffetRulesMessage,
  type BuffetRulesSections,
} from "./buffet-rules.js";

export {
  buildClocktowerLiveGamestate,
  serializeClocktowerLiveGamestate,
  type ClocktowerLiveGamestate,
  type ClocktowerLivePlayer,
  type ClocktowerExportInput,
} from "./clocktower-live-export.js";

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

export interface AccusationUpdatedEvent extends GameEventBase {
  type: typeof GameEventType.AccusationUpdated;
  nominationId: string;
  playerId: string;
  accusation: string;
}

export interface NominationVoteDeadlineUpdatedEvent extends GameEventBase {
  type: typeof GameEventType.NominationVoteDeadlineUpdated;
  nominationId: string;
  voteDeadlineAt: string | null;
}

export interface VoteCastEvent extends GameEventBase {
  type: typeof GameEventType.VoteCast;
  nominationId: string;
  voterId: string;
  choice: VoteChoice;
  reason: string | null;
  manualSet?: boolean;
  /** True when cast from a personal ST thread (hidden from Town Voting). */
  privateBallot?: boolean;
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
  /** Snapshotted at emission; older events omit this and fall back on apply-time day visibility. */
  voteVisibility?: VoteVisibility;
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

/** Wipe day/night progress and return to town setup while keeping the roster. */
export interface TownResetToSetupEvent extends GameEventBase {
  type: typeof GameEventType.TownResetToSetup;
}

export interface PlayerAliveChangedEvent extends GameEventBase {
  type: typeof GameEventType.PlayerAliveChanged;
  playerId: string;
  alive: boolean;
}

/** Banshee (and similar): vote counts twice; may nominate twice/day while dead. */
export interface PlayerHasTwoVotesChangedEvent extends GameEventBase {
  type: typeof GameEventType.PlayerHasTwoVotesChanged;
  playerId: string;
  hasTwoVotes: boolean;
}

export interface PlayerDisplayNameChangedEvent extends GameEventBase {
  type: typeof GameEventType.PlayerDisplayNameChanged;
  playerId: string;
  displayName: string;
}

export interface PlayerSubstitutedEvent extends GameEventBase {
  type: typeof GameEventType.PlayerSubstituted;
  playerId: string;
  oldDiscordUserId: string;
  newDiscordUserId: string;
  displayName: string;
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
  winner: "good" | "evil" | "cancel";
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

export interface StorytellerDemotedEvent extends GameEventBase {
  type: typeof GameEventType.StorytellerDemoted;
  discordUserId: string;
}

export interface BuffetDraftConfiguredEvent extends GameEventBase {
  type: typeof GameEventType.BuffetDraftConfigured;
  config: BuffetDraftConfig;
}

export interface BuffetDraftStartedEvent extends GameEventBase {
  type: typeof GameEventType.BuffetDraftStarted;
  draftOrder: string[];
  pool: string[];
  remainingSlots: Record<string, number>;
  /** Players secretly assigned Lunatic / Marionette (not offered as picks). */
  secretAssignments?: Record<string, BuffetSecretRole>;
}

export interface BuffetChoicesOfferedEvent extends GameEventBase {
  type: typeof GameEventType.BuffetChoicesOffered;
  offer: BuffetCurrentOffer;
}

export interface BuffetRolePickedEvent extends GameEventBase {
  type: typeof GameEventType.BuffetRolePicked;
  playerId: string;
  /** Role the player clicked (belief role for Lunatic / Marionette). */
  roleId: string;
  /** Outsider ↔ townsfolk delta applied by this pick (Baron, Fang Gu, …). */
  outsiderAdjustment?: number;
}

export interface BuffetMulliganUsedEvent extends GameEventBase {
  type: typeof GameEventType.BuffetMulliganUsed;
  playerId: string;
  newOffer: BuffetCurrentOffer;
  /** Roles from the offer that was discarded by this mulligan. */
  declinedRoleIds?: string[];
}

export interface BuffetDraftCompletedEvent extends GameEventBase {
  type: typeof GameEventType.BuffetDraftCompleted;
  assignments: Array<{ playerId: string; roleId: string }>;
}

export interface BuffetDrunkAssignedEvent extends GameEventBase {
  type: typeof GameEventType.BuffetDrunkAssigned;
  playerId: string;
}

export interface BuffetLunaticAssignedEvent extends GameEventBase {
  type: typeof GameEventType.BuffetLunaticAssigned;
  playerId: string;
}

export type GameEvent =
  | GameCreatedEvent
  | PlayerAddedEvent
  | PlayerRemovedEvent
  | StorytellerPromotedEvent
  | StorytellerDemotedEvent
  | GameStartedEvent
  | RoleAssignedEvent
  | RolesDealtEvent
  | NightStartedEvent
  | DayStartedEvent
  | DayOpenedEvent
  | PlayerDiedEvent
  | NominationMadeEvent
  | DefenseAddedEvent
  | AccusationUpdatedEvent
  | NominationVoteDeadlineUpdatedEvent
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
  | TownResetToSetupEvent
  | PlayerAliveChangedEvent
  | PlayerHasTwoVotesChangedEvent
  | PlayerDisplayNameChangedEvent
  | PlayerSubstitutedEvent
  | NominationVotesLockedEvent
  | NominationVotesUnlockedEvent
  | NominationCountStartedEvent
  | NominationCountHandAdvancedEvent
  | NominationCountFinishedEvent
  | BuffetDraftConfiguredEvent
  | BuffetDraftStartedEvent
  | BuffetChoicesOfferedEvent
  | BuffetRolePickedEvent
  | BuffetMulliganUsedEvent
  | BuffetDraftCompletedEvent
  | BuffetDrunkAssignedEvent
  | BuffetLunaticAssignedEvent;

export interface PlayerState {
  id: string;
  discordUserId: string;
  displayName: string;
  seat: number | null;
  roleId: string | null;
  alive: boolean;
  isFake: boolean;
  ghostVoteUsed: boolean;
  /** Banshee power: yes votes count twice; may nominate twice per day while dead. */
  hasTwoVotes: boolean;
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
  /**
   * Player-facing visibility for this nomination, snapshotted from day.voteVisibility
   * when the nomination was made. Mid-day visibility toggles do not rewrite existing noms.
   */
  voteVisibility: VoteVisibility;
}

export interface VoteRecord {
  nominationId: string;
  voterId: string;
  /** Open-ended ballot value (e.g. "yes", "no", "conditional"). */
  choice: VoteChoice;
  reason: string | null;
  /** True for private ST-thread ballots; false for public Town Voting ballots. */
  isPrivate: boolean;
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
  winner: "good" | "evil" | "cancel" | null;
  /** ISO timestamp from GameEnded; null while the game is in progress. */
  endedAt: string | null;
  buffetDraft: BuffetDraftState | null;
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

export interface UpdateAccusationCommand {
  kind: typeof GameCommandKind.UpdateAccusation;
  gameId: string;
  playerId: string;
  nominationId: string;
  accusation: string;
}

export interface CastVoteCommand {
  kind: typeof GameCommandKind.CastVote;
  gameId: string;
  voterId: string;
  nominationId: string;
  choice: VoteChoice;
  reason?: string | null;
  /** True when cast from a personal ST thread. */
  privateBallot?: boolean;
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

/** Force-fail every open nomination (ignores vote tally). */
export interface FailOpenNominationsCommand {
  kind: typeof GameCommandKind.FailOpenNominations;
  gameId: string;
}

/** Bump every current-day nomination deadline by `hours` (from the existing deadline). */
export interface ExtendNominationDeadlinesCommand {
  kind: typeof GameCommandKind.ExtendNominationDeadlines;
  gameId: string;
  hours: number;
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
  winner: "good" | "evil" | "cancel";
  reason: string;
}

export interface PromoteStorytellerCommand {
  kind: typeof GameCommandKind.PromoteStoryteller;
  gameId: string;
  discordUserId: string;
}

export interface DemoteStorytellerCommand {
  kind: typeof GameCommandKind.DemoteStoryteller;
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

/** Allowlist-only: return an in-progress town game to Setup (keeps roster). */
export interface ResetTownToSetupCommand {
  kind: typeof GameCommandKind.ResetTownToSetup;
  gameId: string;
}

export interface SetPlayerAliveCommand {
  kind: typeof GameCommandKind.SetPlayerAlive;
  gameId: string;
  playerId: string;
  alive: boolean;
  /**
   * When marking dead (or already dead): grant Banshee-style double nominate/vote.
   * Ignored when marking alive.
   */
  activateBanshee?: boolean;
}

export interface SetPlayerHasTwoVotesCommand {
  kind: typeof GameCommandKind.SetPlayerHasTwoVotes;
  gameId: string;
  playerId: string;
  hasTwoVotes: boolean;
}

export interface SetPlayerDisplayNameCommand {
  kind: typeof GameCommandKind.SetPlayerDisplayName;
  gameId: string;
  playerId: string;
  displayName: string;
}

/** Hand a seat to a different Discord user (keeps playerId / seat / votes). */
export interface SubstitutePlayerCommand {
  kind: typeof GameCommandKind.SubstitutePlayer;
  gameId: string;
  playerId: string;
  newDiscordUserId: string;
  displayName: string;
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

export interface ConfigureBuffetDraftCommand {
  kind: typeof GameCommandKind.ConfigureBuffetDraft;
  gameId: string;
  config: Partial<BuffetDraftConfig>;
}

export interface StartBuffetDraftCommand {
  kind: typeof GameCommandKind.StartBuffetDraft;
  gameId: string;
  devMode?: boolean;
}

export interface PickBuffetRoleCommand {
  kind: typeof GameCommandKind.PickBuffetRole;
  gameId: string;
  playerId: string;
  roleId: string;
}

export interface MulliganBuffetCommand {
  kind: typeof GameCommandKind.MulliganBuffet;
  gameId: string;
  playerId: string;
}

export interface CancelBuffetDraftCommand {
  kind: typeof GameCommandKind.CancelBuffetDraft;
  gameId: string;
}

export interface AssignBuffetDrunkCommand {
  kind: typeof GameCommandKind.AssignBuffetDrunk;
  gameId: string;
  playerId: string;
}

export interface AssignBuffetLunaticCommand {
  kind: typeof GameCommandKind.AssignBuffetLunatic;
  gameId: string;
  playerId: string;
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
  | UpdateAccusationCommand
  | CastVoteCommand
  | SetPlayerVoteCommand
  | KillPlayerCommand
  | PauseNominationsCommand
  | ResumeNominationsCommand
  | SetVoteVisibilityCommand
  | CloseNominationsCommand
  | ResolveNominationCommand
  | FailOpenNominationsCommand
  | ExtendNominationDeadlinesCommand
  | ExecutePlayerCommand
  | OpenSeatsCommand
  | CloseSeatsCommand
  | PickSeatCommand
  | EndGameCommand
  | PromoteStorytellerCommand
  | DemoteStorytellerCommand
  | SetupTownCommand
  | ResetTownToSetupCommand
  | SetPlayerAliveCommand
  | SetPlayerHasTwoVotesCommand
  | SetPlayerDisplayNameCommand
  | SubstitutePlayerCommand
  | LockNominationVotesCommand
  | UnlockNominationVotesCommand
  | StartNominationCountCommand
  | CountHandVoteCommand
  | CancelNominationCountCommand
  | ConfigureBuffetDraftCommand
  | StartBuffetDraftCommand
  | PickBuffetRoleCommand
  | MulliganBuffetCommand
  | CancelBuffetDraftCommand
  | AssignBuffetDrunkCommand
  | AssignBuffetLunaticCommand;

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
    endedAt: null,
    buffetDraft: null,
  };
}

export function countLivingPlayers(state: GameState): number {
  return state.players.filter((player) => player.alive).length;
}

export function passesExecutionVote(yesVotes: number, livingCount: number): boolean {
  return yesVotes >= Math.ceil(livingCount / 2);
}

/** Yes votes required to put a nominee on the block (half the living players, rounded up). */
export function votesNeededOnTheBlock(livingCount: number): number {
  return Math.ceil(livingCount / 2);
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

export function getPlayerVoteWeight(player: PlayerState): number {
  return player.hasTwoVotes ? 2 : 1;
}

export function maxNominationsPerDay(player: PlayerState): number {
  return player.hasTwoVotes ? 2 : 1;
}

export function getNominationTally(
  state: GameState,
  nominationId: string,
  options?: { ballot?: "effective" | "public" | "private" },
): VoteTally {
  const tally: VoteTally = { yes: 0, no: 0, conditional: 0 };
  if (!state.day) return tally;
  const ballot = options?.ballot ?? "effective";
  const playersById = new Map(state.players.map((player) => [player.id, player]));

  if (ballot === "effective") {
    // Per voter: prefer private ballot over public when both exist.
    const effectiveByVoter = new Map<string, VoteRecord>();
    for (const vote of state.day.votes) {
      if (vote.nominationId !== nominationId) continue;
      const existing = effectiveByVoter.get(vote.voterId);
      if (!existing || vote.isPrivate) {
        effectiveByVoter.set(vote.voterId, vote);
      }
    }
    for (const vote of effectiveByVoter.values()) {
      if (vote.choice === "yes") {
        const voter = playersById.get(vote.voterId);
        tally.yes += voter ? getPlayerVoteWeight(voter) : 1;
      } else if (vote.choice === "no") tally.no++;
      else if (vote.choice === "conditional") tally.conditional++;
    }
  } else {
    const targetPrivate = ballot === "private";
    for (const vote of state.day.votes) {
      if (vote.nominationId !== nominationId) continue;
      if (vote.isPrivate !== targetPrivate) continue;
      if (vote.choice === "yes") {
        const voter = playersById.get(vote.voterId);
        tally.yes += voter ? getPlayerVoteWeight(voter) : 1;
      } else if (vote.choice === "no") tally.no++;
      else if (vote.choice === "conditional") tally.conditional++;
    }
  }

  return tally;
}

function formatVoteReasonSuffix(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  return trimmed ? ` — ${trimmed}` : "";
}

function formatStorytellerVoteStatus(
  player: PlayerState,
  publicVote: VoteRecord | undefined,
  privateVote: VoteRecord | undefined,
): string {
  if (!publicVote && !privateVote) {
    if (!player.alive && player.hasTwoVotes) {
      return "_pending_ (×2, no ghost vote)_";
    }
    if (!player.alive && player.ghostVoteUsed) {
      return "_ghost used (no vote this nomination)_";
    }
    if (!player.alive) {
      return "_ghost available — pending_";
    }
    return player.hasTwoVotes ? "_pending_ (×2)" : "_pending_";
  }

  const ghostTag = !player.alive
    ? player.hasTwoVotes
      ? " (dead)"
      : " (ghost)"
    : "";
  const publicLabel = publicVote?.choice ?? "—";
  const reason = privateVote
    ? formatVoteReasonSuffix(privateVote.reason)
    : formatVoteReasonSuffix(publicVote?.reason);
  const yesWeight = (choice: string) =>
    choice === "yes" && player.hasTwoVotes ? " ×2" : "";

  if (privateVote) {
    return `**${privateVote.choice}**${yesWeight(privateVote.choice)}${ghostTag} (public: ${publicLabel})${reason}`;
  }
  if (publicVote) {
    return `**${publicVote.choice}**${yesWeight(publicVote.choice)}${ghostTag}${reason}`;
  }
  if (!player.alive && player.hasTwoVotes) {
    return "_pending_ (×2, no ghost vote)_";
  }
  if (!player.alive && player.ghostVoteUsed) {
    return "_ghost used (no vote this nomination)_";
  }
  if (!player.alive) return "_ghost available — pending_";
  return "_pending_";
}

export function getEffectiveYesVotes(state: GameState, nominationId: string): number {
  if (!state.day) return 0;

  // Per voter: private vote overrides public for the effective count.
  const effectiveByVoter = new Map<string, VoteRecord>();
  for (const vote of state.day.votes) {
    if (vote.nominationId !== nominationId) continue;
    const existing = effectiveByVoter.get(vote.voterId);
    if (!existing || vote.isPrivate) {
      effectiveByVoter.set(vote.voterId, vote);
    }
  }
  const playersById = new Map(state.players.map((player) => [player.id, player]));
  let yes = 0;
  for (const vote of effectiveByVoter.values()) {
    if (vote.choice !== "yes") continue;
    const voter = playersById.get(vote.voterId);
    yes += voter ? getPlayerVoteWeight(voter) : 1;
  }
  return yes;
}

/** Ghost already spent their daily yes on a different nomination. */
export function hasGhostYesOnOtherNomination(
  state: GameState,
  voterId: string,
  nominationId: string,
): boolean {
  if (!state.day) return false;
  return state.day.votes.some(
    (vote) =>
      vote.voterId === voterId &&
      vote.nominationId !== nominationId &&
      vote.choice === "yes",
  );
}

/** Alive players always count; Banshee (hasTwoVotes) always counts; other ghosts while vote available. */
export function isCountEligibleVoter(
  state: GameState,
  player: PlayerState,
  nominationId: string,
): boolean {
  if (player.alive) return true;
  if (player.hasTwoVotes) return true;
  if (player.ghostVoteUsed) return false;
  return !hasGhostYesOnOtherNomination(state, player.id, nominationId);
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

  getNominationTally(
    nominationId: string,
    options?: { ballot?: "effective" | "public" | "private" },
  ): VoteTally {
    return getNominationTally(this.state, nominationId, options);
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
        // Legacy grimoire flow: stay in setup until DealRoles / BeginNight.
        if (this.state.phase === "setup" && !this.state.townMode) {
          throw new GameEngineError("Finish grimoire setup before advancing phases.");
        }
        if (command.targetPhase === "night") {
          const fromDay = this.state.phase === "day";
          const fromLobby = this.state.phase === "lobby";
          const fromTownSetup = this.state.townMode && this.state.phase === "setup";
          if (!fromDay && !fromLobby && !fromTownSetup) {
            throw new GameEngineError("Can only enter night from lobby, day, or town setup.");
          }
          if (fromDay && this.state.townMode) {
            const open = this.state.day?.nominations.some((nomination) => nomination.status === "open");
            if (open) {
              throw new GameEngineError(
                "Resolve or clear open nominations before starting the next night.",
              );
            }
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
      case GameCommandKind.DemoteStoryteller:
        if (this.state.phase === "ended") {
          throw new GameEngineError("Cannot demote storytellers after the game has ended.");
        }
        if (this.state.storytellerId === command.discordUserId) {
          throw new GameEngineError("Cannot demote the primary storyteller.");
        }
        if (!this.state.promotedStorytellerIds.includes(command.discordUserId)) {
          throw new GameEngineError("That user is not a promoted storyteller.");
        }
        break;
      case GameCommandKind.MakeNomination: {
        this.assertPhase("day", "Nominations can only be made during the day.");
        this.assertDayState();
        this.assertNominationsAcceptingNew();
        const nominator = this.getPlayerById(command.nominatorId);
        if (!nominator) {
          throw new GameEngineError("Player is not in this game.");
        }
        if (!nominator.alive && !nominator.hasTwoVotes) {
          throw new GameEngineError("Ghosts cannot nominate.");
        }
        if (!command.accusation.trim()) {
          throw new GameEngineError("An accusation is required.");
        }
        if (!command.allowDuplicate) {
          const nomsFromNominator = this.state.day!.nominations.filter(
            (nomination) => nomination.nominatorId === command.nominatorId,
          ).length;
          const maxNoms = maxNominationsPerDay(nominator);
          if (nomsFromNominator >= maxNoms) {
            throw new GameEngineError(
              maxNoms > 1
                ? "You have already made both nominations today."
                : "You have already made a nomination today.",
            );
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
      }
      case GameCommandKind.OpenDay:
        // Retarget Town Voting whenever day state exists (incl. overnight leftovers).
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
      case GameCommandKind.UpdateAccusation: {
        this.assertPhase("day", "Accusations can only be updated during the day.");
        this.assertDayState();
        const nomination = this.getNominationById(command.nominationId);
        if (!nomination || nomination.status !== "open") {
          throw new GameEngineError("That nomination is not open.");
        }
        if (nomination.nominatorId !== command.playerId) {
          throw new GameEngineError("Only the nominator can update the accusation.");
        }
        if (!command.accusation.trim()) {
          throw new GameEngineError("An accusation is required.");
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
        // Ghosts may vote yes / no / conditional; only a yes spends the ghost vote.
        // Activated Banshee (hasTwoVotes) votes without spending a ghost vote.
        if (!voter.alive && command.choice === "yes" && !voter.hasTwoVotes) {
          if (voter.ghostVoteUsed) {
            throw new GameEngineError("You have already used your ghost vote.");
          }
          if (
            hasGhostYesOnOtherNomination(
              this.state,
              command.voterId,
              command.nominationId,
            )
          ) {
            throw new GameEngineError("You have already used your ghost vote.");
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
      case GameCommandKind.FailOpenNominations: {
        this.assertPhase("day", "Nominations can only be resolved during the day.");
        this.assertDayState();
        if (!this.getNextOpenNomination()) {
          throw new GameEngineError("No open nominations remain to fail.");
        }
        break;
      }
      case GameCommandKind.ExtendNominationDeadlines: {
        this.assertPhase("day", "Nomination deadlines can only be extended during the day.");
        this.assertDayState();
        if (!Number.isFinite(command.hours) || command.hours <= 0) {
          throw new GameEngineError("Hours must be a positive number.");
        }
        if ((this.state.day!.nominations.length ?? 0) === 0) {
          throw new GameEngineError("No nominations today to extend.");
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
        if (this.state.buffetDraft?.status === "active") {
          throw new GameEngineError(
            "Cannot re-run setup-town while a Sushi Buffet draft is in progress. Cancel the draft first (`/st do buffet-cancel`).",
          );
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
      case GameCommandKind.ResetTownToSetup: {
        if (this.state.phase === "ended") {
          throw new GameEngineError("Game has already ended.");
        }
        if (!this.state.townMode) {
          throw new GameEngineError("Only town-mode games can reset to setup.");
        }
        if (this.state.players.length === 0) {
          throw new GameEngineError("Town has no players to reset. Run setup-town first.");
        }
        if (this.state.phase === "lobby") {
          throw new GameEngineError("Game is still in lobby. Run setup-town first.");
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
      case GameCommandKind.SetPlayerHasTwoVotes:
        if (this.state.phase === "ended") {
          throw new GameEngineError("Game has already ended.");
        }
        if (!this.getPlayerById(command.playerId)) {
          throw new GameEngineError("Player is not in this game.");
        }
        break;
      case GameCommandKind.SetPlayerDisplayName:
        if (this.state.phase === "ended") {
          throw new GameEngineError("Game has already ended.");
        }
        if (!this.getPlayerById(command.playerId)) {
          throw new GameEngineError("Player is not in this game.");
        }
        if (!command.displayName.trim()) {
          throw new GameEngineError("Display name cannot be empty.");
        }
        if (command.displayName.trim().length > 100) {
          throw new GameEngineError("Display name must be 100 characters or fewer.");
        }
        break;
      case GameCommandKind.SubstitutePlayer: {
        if (this.state.phase === "ended") {
          throw new GameEngineError("Game has already ended.");
        }
        const player = this.getPlayerById(command.playerId);
        if (!player) {
          throw new GameEngineError("Player is not in this game.");
        }
        if (player.isFake || player.discordUserId.startsWith("dev:")) {
          throw new GameEngineError("Cannot substitute a fake/dev player.");
        }
        const newDiscordUserId = command.newDiscordUserId.trim();
        if (!newDiscordUserId) {
          throw new GameEngineError("New Discord user is required.");
        }
        if (newDiscordUserId.startsWith("dev:")) {
          throw new GameEngineError("Cannot substitute with a fake/dev user.");
        }
        if (newDiscordUserId === player.discordUserId) {
          throw new GameEngineError("That user is already occupying this seat.");
        }
        if (this.getPlayerByDiscordId(newDiscordUserId)) {
          throw new GameEngineError("That user is already in this game.");
        }
        if (!command.displayName.trim()) {
          throw new GameEngineError("Display name cannot be empty.");
        }
        if (command.displayName.trim().length > 100) {
          throw new GameEngineError("Display name must be 100 characters or fewer.");
        }
        break;
      }
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
        if (this.getCountEligiblePlayers(nomination.id).length === 0) {
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
      case GameCommandKind.ConfigureBuffetDraft:
        if (this.state.phase === "ended") {
          throw new GameEngineError("Cannot configure buffet on an ended game.");
        }
        if (this.state.buffetDraft?.status === "active") {
          throw new GameEngineError("Cannot reconfigure buffet while a draft is in progress.");
        }
        break;
      case GameCommandKind.StartBuffetDraft: {
        if (this.state.phase !== "setup") {
          throw new GameEngineError("Buffet draft can only start during setup.");
        }
        if (this.state.buffetDraft?.status === "active") {
          throw new GameEngineError("A buffet draft is already in progress.");
        }
        const seatedPlayers = this.state.players.filter((p) => p.seat !== null);
        if (seatedPlayers.length < 1) {
          throw new GameEngineError("No seated players. Run setup-town first.");
        }
        const nonSecretRoles = this.state.players.filter(
          (p) => p.roleId && !isBuffetSecretRole(p.roleId),
        );
        if (nonSecretRoles.length > 0) {
          throw new GameEngineError(
            "Some players already have roles assigned. Clear them first, or only pre-assign secret roles (Lunatic / Marionette / Drunk).",
          );
        }
        const preCheck = collectBuffetPreAssignments(
          this.state.players,
          this.state.buffetDraft?.secretAssignments ?? {},
        );
        const secretValues = Object.values(preCheck);
        if (new Set(secretValues).size !== secretValues.length) {
          throw new GameEngineError(
            "The same secret role is assigned to more than one player.",
          );
        }
        const config = this.state.buffetDraft?.config ?? defaultBuffetConfig();
        const pool = buildInitialPool(config.enabledRoleIds);
        const slots = applySummonerNoDemonSetup(
          computeRemainingSlots(seatedPlayers.length, command.devMode),
          config.enabledRoleIds,
        );
        const poolError = validatePoolForComposition(pool, slots);
        if (poolError) {
          throw new GameEngineError(poolError);
        }
        break;
      }
      case GameCommandKind.PickBuffetRole: {
        const draft = this.state.buffetDraft;
        if (!draft || draft.status !== "active") {
          throw new GameEngineError("No active buffet draft.");
        }
        const offer = draft.currentOffer;
        if (!offer) {
          throw new GameEngineError("No current offer to pick from.");
        }
        if (offer.playerId !== command.playerId) {
          throw new GameEngineError("It is not your turn to pick.");
        }
        if (!offer.roleIds.includes(command.roleId)) {
          throw new GameEngineError("That role was not in your offer.");
        }
        break;
      }
      case GameCommandKind.MulliganBuffet: {
        const draft = this.state.buffetDraft;
        if (!draft || draft.status !== "active") {
          throw new GameEngineError("No active buffet draft.");
        }
        const offer = draft.currentOffer;
        if (!offer) {
          throw new GameEngineError("No current offer to mulligan.");
        }
        if (offer.playerId !== command.playerId) {
          throw new GameEngineError("It is not your turn.");
        }
        const nextStep = offer.mulliganStep + 1;
        if (nextStep >= draft.config.mulliganSteps.length) {
          throw new GameEngineError("No more mulligans available.");
        }
        break;
      }
      case GameCommandKind.CancelBuffetDraft:
        if (!this.state.buffetDraft || this.state.buffetDraft.status !== "active") {
          throw new GameEngineError("No active buffet draft to cancel.");
        }
        break;
      case GameCommandKind.AssignBuffetDrunk: {
        const draft = this.state.buffetDraft;
        if (!draft || (draft.status !== "active" && draft.status !== "complete")) {
          throw new GameEngineError("No buffet draft to assign Drunk on.");
        }
        try {
          applyAssignDrunk(draft, command.playerId);
        } catch (error) {
          throw new GameEngineError(
            error instanceof Error ? error.message : "Cannot assign Drunk.",
          );
        }
        break;
      }
      case GameCommandKind.AssignBuffetLunatic: {
        const draft = this.state.buffetDraft;
        if (!draft) {
          throw new GameEngineError(
            "Configure the buffet role pool first and enable Lunatic in admin.",
          );
        }
        if (draft.status !== "idle" && draft.status !== "active") {
          throw new GameEngineError("Can only assign Lunatic before or during the draft.");
        }
        if (!this.state.players.some((p) => p.id === command.playerId && p.seat !== null)) {
          throw new GameEngineError("That player is not seated in this game.");
        }
        try {
          applyAssignLunatic(draft, command.playerId);
        } catch (error) {
          throw new GameEngineError(
            error instanceof Error ? error.message : "Cannot assign Lunatic.",
          );
        }
        break;
      }
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
      case GameCommandKind.DemoteStoryteller:
        return [
          {
            type: GameEventType.StorytellerDemoted,
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
            voteVisibility: this.state.day?.voteVisibility ?? "public",
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
      case GameCommandKind.UpdateAccusation:
        return [
          {
            type: GameEventType.AccusationUpdated,
            gameId: command.gameId,
            nominationId: command.nominationId,
            playerId: command.playerId,
            accusation: command.accusation.trim(),
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
            privateBallot: command.privateBallot === true,
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
            privateBallot: false,
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
      case GameCommandKind.FailOpenNominations: {
        const open =
          this.state.day?.nominations.filter((nomination) => nomination.status === "open") ?? [];
        const livingCount = this.countLivingPlayers();
        const timestamp = new Date().toISOString();
        return open.map(
          (nomination): NominationResolvedEvent => ({
            type: GameEventType.NominationResolved,
            gameId: command.gameId,
            nominationId: nomination.id,
            passed: false,
            yesVotes: this.getEffectiveYesVotes(nomination.id),
            livingCount,
            timestamp,
          }),
        );
      }
      case GameCommandKind.ExtendNominationDeadlines: {
        const nominations = this.state.day?.nominations ?? [];
        const nowMs = Date.now();
        const deltaMs = command.hours * 3_600_000;
        const timestamp = new Date().toISOString();
        const events: GameEvent[] = [];
        for (const nomination of nominations) {
          if (nomination.status === "open" && (nomination.votesLocked || nomination.countHandIndex != null)) {
            events.push({
              type: GameEventType.NominationVotesUnlocked,
              gameId: command.gameId,
              nominationId: nomination.id,
              timestamp,
            });
          }
          const oldMs = nomination.voteDeadlineAt
            ? new Date(nomination.voteDeadlineAt).getTime()
            : NaN;
          // Add hours to the existing deadline (even if past). Missing deadline → from now.
          const baseMs = Number.isFinite(oldMs) ? oldMs : nowMs;
          events.push({
            type: GameEventType.NominationVoteDeadlineUpdated,
            gameId: command.gameId,
            nominationId: nomination.id,
            voteDeadlineAt: new Date(baseMs + deltaMs).toISOString(),
            timestamp,
          });
        }
        return events;
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
      case GameCommandKind.ResetTownToSetup:
        return [
          {
            type: GameEventType.TownResetToSetup,
            gameId: command.gameId,
            timestamp: new Date().toISOString(),
          },
        ];
      case GameCommandKind.SetPlayerAlive: {
        const player = this.getPlayerById(command.playerId)!;
        const events: GameEvent[] = [];
        if (player.alive !== command.alive) {
          events.push({
            type: GameEventType.PlayerAliveChanged,
            gameId: command.gameId,
            playerId: command.playerId,
            alive: command.alive,
            timestamp: new Date().toISOString(),
          });
        }
        if (command.activateBanshee && !command.alive && !player.hasTwoVotes) {
          events.push({
            type: GameEventType.PlayerHasTwoVotesChanged,
            gameId: command.gameId,
            playerId: command.playerId,
            hasTwoVotes: true,
            timestamp: new Date().toISOString(),
          });
        }
        return events;
      }
      case GameCommandKind.SetPlayerHasTwoVotes: {
        const player = this.getPlayerById(command.playerId)!;
        if (player.hasTwoVotes === command.hasTwoVotes) {
          return [];
        }
        return [
          {
            type: GameEventType.PlayerHasTwoVotesChanged,
            gameId: command.gameId,
            playerId: command.playerId,
            hasTwoVotes: command.hasTwoVotes,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      case GameCommandKind.SetPlayerDisplayName: {
        const player = this.getPlayerById(command.playerId)!;
        const displayName = command.displayName.trim();
        if (player.displayName === displayName) {
          return [];
        }
        return [
          {
            type: GameEventType.PlayerDisplayNameChanged,
            gameId: command.gameId,
            playerId: command.playerId,
            displayName,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      case GameCommandKind.SubstitutePlayer: {
        const player = this.getPlayerById(command.playerId)!;
        return [
          {
            type: GameEventType.PlayerSubstituted,
            gameId: command.gameId,
            playerId: command.playerId,
            oldDiscordUserId: player.discordUserId,
            newDiscordUserId: command.newDiscordUserId.trim(),
            displayName: command.displayName.trim(),
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
        const order = this.getVoteLockInOrder(nomination.nomineeId);
        const handIndex = order.findIndex((player) =>
          isCountEligibleVoter(this.state, player, command.nominationId),
        );
        if (handIndex < 0) {
          throw new GameEngineError("No eligible voters to count.");
        }
        const handPlayer = order[handIndex]!;
        return [
          {
            type: GameEventType.NominationCountStarted,
            gameId: command.gameId,
            nominationId: command.nominationId,
            handPlayerId: handPlayer.id,
            handIndex,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      case GameCommandKind.CountHandVote: {
        const nomination = this.getNominationById(command.nominationId)!;
        const order = this.getVoteLockInOrder(nomination.nomineeId);
        const handIndex = nomination.countHandIndex ?? 0;
        const voter = order[handIndex];
        if (!voter || !isCountEligibleVoter(this.state, voter, command.nominationId)) {
          throw new GameEngineError("No voter under the hand.");
        }

        // Index into the full seat circle so a ghost voting yes (ghostVoteUsed)
        // does not shrink the list and skip the next player.
        let nextIndex: number | null = null;
        let nextPlayer: PlayerState | null = null;
        for (let index = handIndex + 1; index < order.length; index++) {
          const candidate = order[index]!;
          if (isCountEligibleVoter(this.state, candidate, command.nominationId)) {
            nextIndex = index;
            nextPlayer = candidate;
            break;
          }
        }
        const finished = nextIndex == null;
        return [
          {
            type: GameEventType.NominationCountHandAdvanced,
            gameId: command.gameId,
            nominationId: command.nominationId,
            voterId: voter.id,
            choice: command.choice,
            handPlayerId: nextPlayer?.id ?? null,
            handIndex: nextIndex,
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
      case GameCommandKind.ConfigureBuffetDraft: {
        const existing = this.state.buffetDraft;
        const baseConfig = existing?.config ?? defaultBuffetConfig();
        const newConfig: BuffetDraftConfig = { ...baseConfig, ...command.config };
        return [
          {
            type: GameEventType.BuffetDraftConfigured,
            gameId: command.gameId,
            config: newConfig,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      case GameCommandKind.StartBuffetDraft: {
        const config = this.state.buffetDraft?.config ?? defaultBuffetConfig();
        const seatedPlayers = this.state.players.filter((p) => p.seat !== null);
        const baseSlots = applySummonerNoDemonSetup(
          computeRemainingSlots(seatedPlayers.length, command.devMode),
          config.enabledRoleIds,
        );
        const draftOrder = shuffle(seatedPlayers.map((p) => p.id));
        const preAssignments = collectBuffetPreAssignments(
          this.state.players,
          this.state.buffetDraft?.secretAssignments ?? {},
        );
        const { secretAssignments, remainingSlots } = assignSecretRoles(
          config.enabledRoleIds,
          baseSlots,
          draftOrder,
          Math.random,
          preAssignments,
        );
        const pool = buildPickablePool(config.enabledRoleIds);
        const pickableError = validatePoolForComposition(pool, remainingSlots);
        if (pickableError) {
          throw new GameEngineError(pickableError);
        }
        const draftPreview: BuffetDraftState = {
          status: "active",
          config,
          pool,
          remainingSlots,
          draftOrder,
          currentIndex: 0,
          currentOffer: null,
          mulligansUsed: {},
          declinedRoles: {},
          picks: {},
          secretAssignments,
          beliefs: {},
          inPlayDemon: null,
        };
        const firstOffer = buildNextOffer(draftPreview);
        if (!firstOffer || firstOffer.roleIds.length === 0) {
          throw new GameEngineError("Could not build the first buffet offer — check the role pool.");
        }
        return [
          {
            type: GameEventType.BuffetDraftStarted,
            gameId: command.gameId,
            draftOrder,
            pool,
            remainingSlots: remainingSlots as Record<string, number>,
            secretAssignments,
            timestamp: new Date().toISOString(),
          },
          {
            type: GameEventType.BuffetChoicesOffered,
            gameId: command.gameId,
            offer: firstOffer,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      case GameCommandKind.PickBuffetRole: {
        const draft = this.state.buffetDraft!;
        const offerKind = draft.currentOffer?.offerKind ?? "standard";
        const isPretender = Boolean(draft.secretAssignments[command.playerId]);
        const outsiderAdjustment =
          isPretender || command.roleId === "lilmonsta" || offerKind === "lilmonsta-minion"
            ? 0
            : command.roleId in OUTSIDER_SETUP_DELTAS
              ? chooseOutsiderAdjustment(command.roleId, draft.remainingSlots.outsider ?? 0)
              : 0;
        const newDraftState = applyPick(draft, command.playerId, command.roleId, {
          outsiderAdjustment,
        });
        const events: GameEvent[] = [
          {
            type: GameEventType.BuffetRolePicked,
            gameId: command.gameId,
            playerId: command.playerId,
            roleId: command.roleId,
            outsiderAdjustment: outsiderAdjustment || undefined,
            timestamp: new Date().toISOString(),
          },
        ];

        // Lil' Monsta: same player immediately chooses which Minion they are.
        if (
          command.roleId === "lilmonsta" &&
          offerKind === "standard" &&
          !newDraftState.picks[command.playerId]
        ) {
          const minionOffer = buildLilMonstaMinionOffer(newDraftState, command.playerId);
          if (minionOffer.roleIds.length === 0) {
            throw new GameEngineError(
              "Lil' Monsta was picked but no Minion roles remain in the pool.",
            );
          }
          events.push({
            type: GameEventType.BuffetChoicesOffered,
            gameId: command.gameId,
            offer: minionOffer,
            timestamp: new Date().toISOString(),
          });
          return events;
        }

        if (newDraftState.status === "complete") {
          const assignments = Object.entries(newDraftState.picks).map(
            ([playerId, roleId]) => ({ playerId, roleId }),
          );
          const seatSwaps = planMarionetteSeatSwaps(
            this.state.players,
            newDraftState.picks,
            newDraftState.inPlayDemon,
          );
          for (const swap of seatSwaps) {
            events.push({
              type: GameEventType.SeatPicked,
              gameId: command.gameId,
              playerId: swap.playerId,
              seat: swap.seat,
              timestamp: new Date().toISOString(),
            });
          }
          events.push({
            type: GameEventType.BuffetDraftCompleted,
            gameId: command.gameId,
            assignments,
            timestamp: new Date().toISOString(),
          });
          events.push({
            type: GameEventType.RolesDealt,
            gameId: command.gameId,
            assignments,
            timestamp: new Date().toISOString(),
          });
        } else {
          const nextOffer = buildNextOffer(newDraftState);
          if (!nextOffer || nextOffer.roleIds.length === 0) {
            throw new GameEngineError(
              "Could not build the next buffet offer — remaining slots may be unfillable.",
            );
          }
          events.push({
            type: GameEventType.BuffetChoicesOffered,
            gameId: command.gameId,
            offer: nextOffer,
            timestamp: new Date().toISOString(),
          });
        }
        return events;
      }
      case GameCommandKind.MulliganBuffet: {
        const draft = this.state.buffetDraft!;
        const { newOffer, declinedRoleIds } = applyMulligan(draft, command.playerId);
        const offer: BuffetCurrentOffer = {
          playerId: command.playerId,
          roleIds: newOffer,
          mulliganStep: (draft.currentOffer?.mulliganStep ?? 0) + 1,
          offerKind: draft.currentOffer?.offerKind ?? "standard",
        };
        return [
          {
            type: GameEventType.BuffetMulliganUsed,
            gameId: command.gameId,
            playerId: command.playerId,
            newOffer: offer,
            declinedRoleIds,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      case GameCommandKind.CancelBuffetDraft: {
        // Re-emit configured (idle) so draft resets while preserving the role pool config
        const config = this.state.buffetDraft?.config ?? defaultBuffetConfig();
        return [
          {
            type: GameEventType.BuffetDraftConfigured,
            gameId: command.gameId,
            config,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      case GameCommandKind.AssignBuffetDrunk: {
        const draft = this.state.buffetDraft!;
        const newState = applyAssignDrunk(draft, command.playerId);
        const events: GameEvent[] = [
          {
            type: GameEventType.BuffetDrunkAssigned,
            gameId: command.gameId,
            playerId: command.playerId,
            timestamp: new Date().toISOString(),
          },
        ];
        // If we cleared their offer (it was their turn), rebuild townsfolk choices.
        if (!newState.currentOffer && newState.draftOrder[newState.currentIndex] === command.playerId) {
          const offer = buildNextOffer(newState);
          if (!offer || offer.roleIds.length === 0) {
            throw new GameEngineError(
              "Assigned Drunk but could not build townsfolk choices for that player.",
            );
          }
          events.push({
            type: GameEventType.BuffetChoicesOffered,
            gameId: command.gameId,
            offer,
            timestamp: new Date().toISOString(),
          });
        }
        return events;
      }
      case GameCommandKind.AssignBuffetLunatic: {
        const draft = this.state.buffetDraft!;
        // Ensure idle draft exists when validating seeded it on state.
        const newState = applyAssignLunatic(draft, command.playerId);
        const events: GameEvent[] = [
          {
            type: GameEventType.BuffetLunaticAssigned,
            gameId: command.gameId,
            playerId: command.playerId,
            timestamp: new Date().toISOString(),
          },
        ];
        if (
          newState.status === "active" &&
          !newState.currentOffer &&
          newState.draftOrder[newState.currentIndex] === command.playerId
        ) {
          const offer = buildNextOffer(newState);
          if (!offer || offer.roleIds.length === 0) {
            throw new GameEngineError(
              "Assigned Lunatic but could not build demon choices for that player.",
            );
          }
          events.push({
            type: GameEventType.BuffetChoicesOffered,
            gameId: command.gameId,
            offer,
            timestamp: new Date().toISOString(),
          });
        }
        return events;
      }
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
          hasTwoVotes: false,
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
      case GameEventType.StorytellerDemoted:
        this.state.promotedStorytellerIds = this.state.promotedStorytellerIds.filter(
          (id) => id !== event.discordUserId,
        );
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
          voteVisibility:
            event.voteVisibility ?? this.state.day.voteVisibility ?? "public",
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
      case GameEventType.AccusationUpdated: {
        const nomination = this.getNominationById(event.nominationId);
        if (nomination) {
          nomination.accusation = event.accusation;
        }
        break;
      }
      case GameEventType.NominationVoteDeadlineUpdated: {
        const nomination = this.getNominationById(event.nominationId);
        if (nomination) {
          nomination.voteDeadlineAt = event.voteDeadlineAt;
        }
        break;
      }
      case GameEventType.VoteCast: {
        if (!this.state.day) break;
        const isPrivate = event.privateBallot === true;
        const existingIndex = this.state.day.votes.findIndex(
          (vote) =>
            vote.nominationId === event.nominationId &&
            vote.voterId === event.voterId &&
            vote.isPrivate === isPrivate,
        );
        const voteRecord: VoteRecord = {
          nominationId: event.nominationId,
          voterId: event.voterId,
          choice: event.choice,
          reason: event.reason,
          isPrivate,
        };
        if (existingIndex >= 0) {
          this.state.day.votes[existingIndex] = voteRecord;
        } else {
          this.state.day.votes.push(voteRecord);
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
        this.state.endedAt = event.timestamp;
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
          hasTwoVotes: false,
        }));
        // Town starts in Setup; ST runs next-phase for Night 1, then Day 1, …
        this.state.phase = "setup";
        this.state.nightNumber = 0;
        this.state.dayNumber = 0;
        this.state.townMode = true;
        this.state.seatsOpen = false;
        this.state.day = null;
        break;
      case GameEventType.TownResetToSetup:
        this.state.phase = "setup";
        this.state.nightNumber = 0;
        this.state.dayNumber = 0;
        this.state.townMode = true;
        this.state.seatsOpen = false;
        this.state.day = null;
        this.state.winner = null;
        this.state.endedAt = null;
        for (const player of this.state.players) {
          player.alive = true;
          player.ghostVoteUsed = false;
          player.hasTwoVotes = false;
          player.roleId = null;
        }
        break;
      case GameEventType.PlayerAliveChanged: {
        const player = this.state.players.find((candidate) => candidate.id === event.playerId);
        if (player) {
          player.alive = event.alive;
        }
        break;
      }
      case GameEventType.PlayerHasTwoVotesChanged: {
        const player = this.state.players.find((candidate) => candidate.id === event.playerId);
        if (player) {
          player.hasTwoVotes = event.hasTwoVotes;
        }
        break;
      }
      case GameEventType.PlayerDisplayNameChanged: {
        const player = this.state.players.find((candidate) => candidate.id === event.playerId);
        if (player) {
          player.displayName = event.displayName;
        }
        break;
      }
      case GameEventType.PlayerSubstituted: {
        const player = this.state.players.find((candidate) => candidate.id === event.playerId);
        if (player) {
          player.discordUserId = event.newDiscordUserId;
          player.displayName = event.displayName;
          player.isFake = event.newDiscordUserId.startsWith("dev:");
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
        // Count votes are always public ballots.
        const existingIndex = this.state.day.votes.findIndex(
          (vote) =>
            vote.nominationId === event.nominationId &&
            vote.voterId === event.voterId &&
            !vote.isPrivate,
        );
        const voteRecord: VoteRecord = {
          nominationId: event.nominationId,
          voterId: event.voterId,
          choice: event.choice,
          reason: null,
          isPrivate: false,
        };
        if (existingIndex >= 0) {
          this.state.day.votes[existingIndex] = voteRecord;
        } else {
          this.state.day.votes.push(voteRecord);
        }
        const voter = this.getPlayerById(event.voterId);
        if (voter && !voter.alive && event.choice === "yes" && !voter.hasTwoVotes) {
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
      case GameEventType.BuffetDraftConfigured: {
        // Keep ST pre-assignments (e.g. Lunatic) when those roles stay enabled.
        const kept = Object.fromEntries(
          Object.entries(this.state.buffetDraft?.secretAssignments ?? {}).filter(([, role]) =>
            event.config.enabledRoleIds.includes(role),
          ),
        ) as BuffetDraftState["secretAssignments"];
        this.state.buffetDraft = {
          status: "idle",
          config: event.config,
          pool: [],
          remainingSlots: { townsfolk: 0, outsider: 0, minion: 0, demon: 0 },
          draftOrder: [],
          currentIndex: 0,
          currentOffer: null,
          mulligansUsed: {},
          declinedRoles: {},
          picks: {},
          secretAssignments: kept,
          beliefs: {},
          inPlayDemon: null,
        };
        break;
      }
      case GameEventType.BuffetDraftStarted: {
        const config = this.state.buffetDraft?.config ?? defaultBuffetConfig();
        this.state.buffetDraft = {
          status: "active",
          config,
          pool: event.pool,
          remainingSlots: event.remainingSlots as BuffetDraftState["remainingSlots"],
          draftOrder: event.draftOrder,
          currentIndex: 0,
          currentOffer: null,
          mulligansUsed: {},
          declinedRoles: {},
          picks: {},
          secretAssignments: event.secretAssignments ?? {},
          beliefs: {},
          inPlayDemon: null,
        };
        break;
      }
      case GameEventType.BuffetChoicesOffered: {
        if (this.state.buffetDraft) {
          this.state.buffetDraft.currentOffer = event.offer;
        }
        break;
      }
      case GameEventType.BuffetRolePicked: {
        const draft = this.state.buffetDraft;
        if (!draft) break;
        const newState = applyPick(draft, event.playerId, event.roleId, {
          outsiderAdjustment: event.outsiderAdjustment ?? 0,
        });
        this.state.buffetDraft = newState;
        break;
      }
      case GameEventType.BuffetMulliganUsed: {
        const draft = this.state.buffetDraft;
        if (!draft) break;
        const declinedRoleIds = event.declinedRoleIds ?? [];
        if (declinedRoleIds.length > 0) {
          const prev = draft.declinedRoles[event.playerId] ?? [];
          draft.declinedRoles = {
            ...draft.declinedRoles,
            [event.playerId]: [...prev, ...declinedRoleIds],
          };
        }
        draft.currentOffer = event.newOffer;
        draft.mulligansUsed = {
          ...draft.mulligansUsed,
          [event.playerId]: (draft.mulligansUsed[event.playerId] ?? 0) + 1,
        };
        break;
      }
      case GameEventType.BuffetDraftCompleted: {
        if (this.state.buffetDraft) {
          this.state.buffetDraft.status = "complete";
          this.state.buffetDraft.currentOffer = null;
        }
        break;
      }
      case GameEventType.BuffetDrunkAssigned: {
        const draft = this.state.buffetDraft;
        if (!draft) break;
        this.state.buffetDraft = applyAssignDrunk(draft, event.playerId);
        const trueRole = this.state.buffetDraft.picks[event.playerId];
        if (trueRole) {
          const player = this.state.players.find((p) => p.id === event.playerId);
          if (player?.roleId) {
            player.roleId = trueRole;
          }
        }
        break;
      }
      case GameEventType.BuffetLunaticAssigned: {
        const draft = this.state.buffetDraft;
        if (!draft) break;
        this.state.buffetDraft = applyAssignLunatic(draft, event.playerId);
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

  formatNominationTally(
    nominationId: string,
    options?: { revealSecret?: boolean; ballot?: "effective" | "public" | "private" },
  ): string {
    const tally = this.getNominationTally(nominationId, {
      ballot: options?.ballot ?? "effective",
    });
    const nomination = this.getNominationById(nominationId);
    const visibility =
      nomination?.voteVisibility ?? this.state.day?.voteVisibility ?? "public";
    if (visibility === "secret" && !options?.revealSecret) {
      return "Votes recorded (secret mode)";
    }
    return `Yes: ${tally.yes} | No: ${tally.no} | Conditional: ${tally.conditional}`;
  }

  /** Player-facing visibility for a nomination (snapshotted at creation). */
  getNominationVoteVisibility(nominationId: string): VoteVisibility {
    const nomination = this.getNominationById(nominationId);
    return nomination?.voteVisibility ?? this.state.day?.voteVisibility ?? "public";
  }

  /**
   * Seat-circle vote roll.
   * - `public`: Town Voting — only public ballots
   * - `storyteller`: kib tracker — private ballot, then (public: …)
   */
  formatNominationVoteRoll(
    nominationId: string,
    options?: { audience?: "public" | "storyteller" },
  ): string {
    const day = this.state.day;
    const nomination = this.getNominationById(nominationId);
    if (!day || !nomination) return "—";
    const audience = options?.audience ?? "public";

    const ordered = this.getVoteLockInOrder(nomination.nomineeId);
    if (ordered.length === 0) return "_No seated players._";

    // Build per-voter buckets for public and private ballots.
    const publicVoteByVoter = new Map<string, VoteRecord>();
    const privateVoteByVoter = new Map<string, VoteRecord>();
    for (const vote of day.votes) {
      if (vote.nominationId !== nominationId) continue;
      if (vote.isPrivate) {
        privateVoteByVoter.set(vote.voterId, vote);
      } else {
        publicVoteByVoter.set(vote.voterId, vote);
      }
    }

    const handPlayerId =
      nomination.countHandIndex != null
        ? this.getCountHandPlayer(nominationId)?.id
        : null;

    const lines = ordered.map((player, index) => {
      const seat = player.seat != null ? `seat ${player.seat}` : "unseated";
      const deadTag = player.alive ? "" : " [dead]";
      const underHand = player.id === handPlayerId;
      const publicVote = publicVoteByVoter.get(player.id);
      const privateVote = privateVoteByVoter.get(player.id);
      let status: string;
      if (audience === "storyteller") {
        status = formatStorytellerVoteStatus(player, publicVote, privateVote);
      } else if (publicVote) {
        const ghostTag = !player.alive
          ? player.hasTwoVotes
            ? " (dead)"
            : " (ghost)"
          : "";
        const yesWeight =
          publicVote.choice === "yes" && player.hasTwoVotes ? " ×2" : "";
        status = `**${publicVote.choice}**${yesWeight}${ghostTag}${publicVote.choice === "conditional" ? formatVoteReasonSuffix(publicVote.reason) : ''}`;
      } else if (!player.alive && player.hasTwoVotes) {
        status = "_pending_ (×2, no ghost vote)_";
      } else if (!player.alive && player.ghostVoteUsed) {
        status = "_ghost used (no vote this nomination)_";
      } else if (!player.alive) {
        status = "_ghost available — pending_";
      } else {
        status = player.hasTwoVotes ? "_pending_ (×2)" : "_pending_";
      }
      const line = `${index + 1}. ${player.displayName}${deadTag} (${seat}):\n${status}`;
      // Do not wrap the whole line in ** — status already uses bold and Discord breaks nested markers.
      return underHand ? `👉 ${line}` : line;
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
        if (player.hasTwoVotes) {
          return `• ${player.displayName} (${seat}): **two votes** (no ghost vote)`;
        }
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
  getCountEligiblePlayers(nominationId: string): PlayerState[] {
    const nomination = this.getNominationById(nominationId);
    if (!nomination) return [];
    return this.getVoteLockInOrder(nomination.nomineeId).filter((player) =>
      isCountEligibleVoter(this.state, player, nominationId),
    );
  }

  getCountHandPlayer(nominationId: string): PlayerState | null {
    const nomination = this.getNominationById(nominationId);
    if (!nomination || nomination.countHandIndex == null) return null;
    const order = this.getVoteLockInOrder(nomination.nomineeId);
    return order[nomination.countHandIndex] ?? null;
  }

  getPlayersMissingVotes(nominationId: string): PlayerState[] {
    const day = this.state.day;
    const nomination = this.getNominationById(nominationId);
    if (!day || !nomination) return [];
    const voted = new Set(
      day.votes.filter((vote) => vote.nominationId === nominationId).map((vote) => vote.voterId),
    );
    return this.getCountEligiblePlayers(nominationId).filter(
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
        if (occupant.hasTwoVotes) {
          status += ", two votes (no ghost vote)";
        } else {
          status += occupant.ghostVoteUsed ? ", ghost used" : ", ghost available";
        }
      } else if (occupant.hasTwoVotes) {
        status += ", two votes";
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
