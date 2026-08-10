import type { BuffetDraftConfig, BuffetDraftState } from "./buffet-draft.js";
import { listBotcRoles } from "./scripts/botc-catalog.js";

export interface ClocktowerLiveReminder {
  role?: string;
  team?: string;
  edition?: string;
  name?: string;
  imageAlt?: string;
}

export interface ClocktowerLivePlayer {
  name: string;
  id: string;
  connected: boolean;
  role: string | Record<string, never>;
  alignmentIndex: number;
  reminders: ClocktowerLiveReminder[];
  isVoteless: boolean;
  hasTwoVotes: boolean;
  hasResponded: Record<string, unknown>;
  isDead: boolean;
  handRaised: boolean;
  pronouns: string;
}

export interface ClocktowerLiveGamestate {
  bluffs: Array<string | null>;
  edition: {
    id: string;
    name: string;
    author: string;
    bootlegger?: string[];
  };
  roles: Array<{ id: string }>;
  npcs: unknown[];
  players: ClocktowerLivePlayer[];
}

export interface ClocktowerExportInput {
  config: BuffetDraftConfig;
  players: Array<{
    id: string;
    displayName: string;
    seat: number | null;
    alive: boolean;
    hasTwoVotes?: boolean;
  }>;
  draft?: Pick<
    BuffetDraftState,
    "picks" | "beliefs" | "secretAssignments" | "inPlayDemon"
  > | null;
  /** Defaults to "Grimkeeper Sushi Buffet". */
  scriptName?: string;
}

function alignmentIndexForRole(roleId: string): number {
  const role = listBotcRoles().find((r) => r.id === roleId);
  if (!role) return 0;
  return role.team === "minion" || role.team === "demon" ? 1 : 0;
}

function emptyPlayer(name: string): ClocktowerLivePlayer {
  return {
    name,
    id: "",
    connected: false,
    role: {},
    alignmentIndex: 0,
    reminders: [],
    isVoteless: false,
    hasTwoVotes: false,
    hasResponded: {},
    isDead: false,
    handRaised: false,
    pronouns: "Any",
  };
}

function buildReminders(
  trueRoleId: string,
  beliefRoleId: string | undefined,
): ClocktowerLiveReminder[] {
  if (!beliefRoleId || beliefRoleId === trueRoleId) return [];
  const catalog = new Map(listBotcRoles().map((r) => [r.id, r]));
  const trueRole = catalog.get(trueRoleId);
  if (!trueRole) {
    return [{ name: `True: ${trueRoleId}` }];
  }
  return [
    {
      role: trueRole.id,
      team: trueRole.team,
      edition: trueRole.edition || undefined,
      name: `Is ${trueRole.name}`,
    },
  ];
}

/**
 * Build a clocktower.live gamestate JSON object for import.
 * Shows belief roles on tokens; true roles appear as reminders when they differ.
 */
export function buildClocktowerLiveGamestate(input: ClocktowerExportInput): ClocktowerLiveGamestate {
  const { config, players, draft } = input;
  const picks = draft?.picks ?? {};
  const beliefs = draft?.beliefs ?? {};
  const secrets = draft?.secretAssignments ?? {};

  const seated = players
    .filter((p) => p.seat !== null)
    .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));

  const clocktowerPlayers: ClocktowerLivePlayer[] = seated.map((player) => {
    const trueRoleId = picks[player.id] ?? secrets[player.id];
    const beliefRoleId = beliefs[player.id];
    const displayRoleId = beliefRoleId ?? trueRoleId;

    const base = emptyPlayer(player.displayName);
    base.isDead = !player.alive;
    base.hasTwoVotes = Boolean(player.hasTwoVotes);

    if (!displayRoleId) {
      return base;
    }

    base.role = displayRoleId;
    base.alignmentIndex = alignmentIndexForRole(trueRoleId ?? displayRoleId);
    base.reminders = trueRoleId ? buildReminders(trueRoleId, beliefRoleId) : [];
    return base;
  });

  if (draft?.inPlayDemon === "lilmonsta") {
    const lil = emptyPlayer("Lil' Monsta");
    lil.role = "lilmonsta";
    lil.alignmentIndex = 1;
    clocktowerPlayers.push(lil);
  }

  const bootlegger: string[] = [
    "Imported from Grimkeeper Sushi Buffet.",
    "Token role shows what the player believes; reminders show true roles when they differ.",
  ];
  if (draft?.inPlayDemon === "lilmonsta") {
    bootlegger.push("Lil' Monsta is in play but not assigned to a seated player.");
  }

  return {
    bluffs: [null, null, null],
    edition: {
      id: "custom",
      name: input.scriptName ?? "Grimkeeper Sushi Buffet",
      author: "Grimkeeper",
      bootlegger,
    },
    roles: config.enabledRoleIds.map((id) => ({ id })),
    npcs: [],
    players: clocktowerPlayers,
  };
}

export function serializeClocktowerLiveGamestate(state: ClocktowerLiveGamestate): string {
  return JSON.stringify(state);
}
