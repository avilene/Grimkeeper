import {
  ChannelType,
  type AnyThreadChannel,
  type Guild,
} from "discord.js";
import { prisma } from "@grimkeeper/database";
import type { GameEngine } from "@grimkeeper/engine";

import {
  DEFAULT_THREAD_AUTO_ARCHIVE,
  ensureThreadAutoArchive,
  isGameTextChannel,
  shortGameId,
} from "./commands/command-context.js";
import { townVoteThreadName } from "./day-thread.js";

export type TownSurfaceKind = "whisper-decl" | "claims" | "rules";

/** Surfaces assignable via `/st mark` (includes Town Voting). */
export type MarkableTownSurface = TownSurfaceKind | "voting";

export type TownSurfaceGame = {
  id: string;
  channelId: string;
  stRoleId?: string | null;
  playerRoleId?: string | null;
  kibRoleId?: string | null;
  whisperDeclThreadId?: string | null;
  claimsThreadId?: string | null;
  rulesThreadId?: string | null;
};

/** @mention ST / player / kib roles (same line used on all public town threads). */
export function formatRolePingLine(game: {
  stRoleId?: string | null;
  playerRoleId?: string | null;
  kibRoleId?: string | null;
}): { content: string; roleIds: string[] } {
  const roleIds = [game.stRoleId, game.playerRoleId, game.kibRoleId].filter(
    (id): id is string => Boolean(id),
  );
  if (roleIds.length === 0) return { content: "", roleIds: [] };
  return {
    content: roleIds.map((id) => `<@&${id}>`).join(" "),
    roleIds,
  };
}

const SURFACE_META: Record<
  TownSurfaceKind,
  {
    label: string;
    dbField: "whisperDeclThreadId" | "claimsThreadId" | "rulesThreadId";
    intro: string[];
    /** Locked = ST-only write (requires ManageThreads). */
    locked: boolean;
  }
> = {
  "whisper-decl": {
    label: "Whisper Declaration",
    dbField: "whisperDeclThreadId",
    intro: [
      "**Whisper Declaration** — announce whispers here.",
      "Use `/whisper neighbor` or `/whisper with` to open private whisper threads.",
    ],
    locked: false,
  },
  claims: {
    label: "Public Claims",
    dbField: "claimsThreadId",
    intro: [
      "**Public Claims** — post character claims and public information here.",
    ],
    locked: false,
  },
  rules: {
    label: "Rules",
    dbField: "rulesThreadId",
    intro: [
      "**Rules** — storyteller posts house rules and reminders here.",
      "_Players can read this thread; only the storyteller can write._",
    ],
    locked: true,
  },
};

export function townSurfaceThreadName(kind: TownSurfaceKind, _gameId?: string): string {
  return SURFACE_META[kind].label.slice(0, 100);
}

export function legacyTownSurfaceThreadName(kind: TownSurfaceKind, gameId: string): string {
  return `${SURFACE_META[kind].label} · ${shortGameId(gameId)}`.slice(0, 100);
}

export function townSurfaceNameSuffix(gameId: string): string {
  return `· ${shortGameId(gameId)}`;
}

/** Name match for a town surface under an already-scoped parent channel. */
export function matchesTownSurfaceThreadName(
  name: string,
  kind: TownSurfaceKind,
  gameId: string,
): boolean {
  const label = SURFACE_META[kind].label;
  const cleanName = townSurfaceThreadName(kind);
  const legacyName = legacyTownSurfaceThreadName(kind, gameId);
  // Match clean / current-game legacy names, or any leftover `Label · <oldShortId>`
  // under this parent (reuse across games in the same town channel).
  return (
    name === cleanName ||
    name === legacyName ||
    name.startsWith(`${label} ·`) ||
    (name.includes(label) && name.includes(townSurfaceNameSuffix(gameId)))
  );
}

async function findTownSurfaceThread(
  guild: Guild,
  parentChannelId: string,
  kind: TownSurfaceKind,
  gameId: string,
  storedId?: string | null,
): Promise<AnyThreadChannel | null> {
  if (storedId) {
    const byId = await guild.channels.fetch(storedId).catch(() => null);
    if (byId?.isThread() && byId.parentId === parentChannelId) {
      return byId;
    }
  }

  const matches = (name: string) => matchesTownSurfaceThreadName(name, kind, gameId);

  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const activeThread = active?.threads.find(
    (candidate) => candidate.parentId === parentChannelId && matches(candidate.name),
  );
  if (activeThread) return activeThread;

  const parent = await guild.channels.fetch(parentChannelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  for (const type of ["private", "public"] as const) {
    const archived = await parent.threads.fetchArchived({ type }).catch(() => null);
    const match = archived?.threads.find((candidate) => matches(candidate.name));
    if (match) return match;
  }
  return null;
}

async function persistTownSurfaceThreadId(
  gameId: string,
  kind: TownSurfaceKind,
  threadId: string,
): Promise<void> {
  const field = SURFACE_META[kind].dbField;
  await prisma.game.update({
    where: { id: gameId },
    data: { [field]: threadId },
  });
}

/**
 * Ensure a town surface thread exists. Players are not added individually — creation
 * @mentions ST / player / kib roles so they get notified; threads are public so roles can see them.
 */
export async function ensureTownSurfaceThread(
  guild: Guild,
  game: TownSurfaceGame,
  _engine: GameEngine,
  kind: TownSurfaceKind,
): Promise<AnyThreadChannel | null> {
  const meta = SURFACE_META[kind];
  const storedId = game[meta.dbField];
  const parent = await guild.channels.fetch(game.channelId).catch(() => null);
  if (!isGameTextChannel(parent)) return null;

  const threadName = townSurfaceThreadName(kind);
  let thread = await findTownSurfaceThread(guild, game.channelId, kind, game.id, storedId);

  if (!thread) {
    try {
      thread = await parent.threads.create({
        name: threadName,
        autoArchiveDuration: DEFAULT_THREAD_AUTO_ARCHIVE,
        reason: `${meta.label} thread for game ${game.id}`,
        ...( {
          type: ChannelType.PublicThread,
        } as Record<string, unknown>),
      });
      const ping = formatRolePingLine(game);
      const introLines = [...meta.intro];
      if (ping.content) introLines.unshift(ping.content);
      await thread
        .send({
          content: introLines.join("\n"),
          allowedMentions: { roles: ping.roleIds },
        })
        .catch(() => undefined);
    } catch {
      return null;
    }
  }

  if (thread.archived) {
    await thread.setArchived(false, `Town setup; reopening ${meta.label}.`).catch(() => undefined);
  }
  await ensureThreadAutoArchive(thread);

  // Rules: locked so only ManageThreads (ST) can send; everyone else can still read.
  if (meta.locked) {
    if (!thread.locked) {
      await thread.setLocked(true, "Rules thread is ST-write / player-read.").catch(() => undefined);
    }
  } else if (thread.locked) {
    await thread.setLocked(false, `Unlock ${meta.label} for player posts.`).catch(() => undefined);
  }

  if (thread.id !== storedId) {
    await persistTownSurfaceThreadId(game.id, kind, thread.id);
  }

  return thread;
}

export type TownSurfaceThreads = {
  whisperDecl: AnyThreadChannel | null;
  claims: AnyThreadChannel | null;
  rules: AnyThreadChannel | null;
};

/** Create or reopen Whisper Declaration, Public Claims, and Rules threads. */
export async function ensureTownSurfaceThreads(
  guild: Guild,
  game: TownSurfaceGame,
  engine: GameEngine,
): Promise<TownSurfaceThreads> {
  const whisperDecl = await ensureTownSurfaceThread(guild, game, engine, "whisper-decl");
  const claims = await ensureTownSurfaceThread(guild, game, engine, "claims");
  const rules = await ensureTownSurfaceThread(guild, game, engine, "rules");
  return { whisperDecl, claims, rules };
}

/** Reload game row so stored surface thread ids are current after ensure. */
export async function reloadTownSurfaceGame(gameId: string): Promise<TownSurfaceGame | null> {
  return prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      channelId: true,
      stRoleId: true,
      playerRoleId: true,
      kibRoleId: true,
      whisperDeclThreadId: true,
      claimsThreadId: true,
      rulesThreadId: true,
    },
  });
}

export function parseTownSurfaceKind(value: string): TownSurfaceKind | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "rules") return "rules";
  if (normalized === "claims" || normalized === "public-claims" || normalized === "public_claims") {
    return "claims";
  }
  if (
    normalized === "whisper" ||
    normalized === "whispers" ||
    normalized === "whisper-decl" ||
    normalized === "whisper-declaration" ||
    normalized === "declaration"
  ) {
    return "whisper-decl";
  }
  return null;
}

/** Parse `/st mark surface:` including Town Voting. */
export function parseMarkableTownSurface(value: string): MarkableTownSurface | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "voting" ||
    normalized === "vote" ||
    normalized === "votes" ||
    normalized === "town-voting" ||
    normalized === "town_voting"
  ) {
    return "voting";
  }
  return parseTownSurfaceKind(value);
}

export function townSurfaceLabel(kind: TownSurfaceKind): string {
  return SURFACE_META[kind].label;
}

/**
 * Point a town surface at an existing thread (must be under the town channel).
 * Applies naming and Rules lock as needed (no per-player membership).
 */
export async function markTownSurfaceThread(
  guild: Guild,
  game: TownSurfaceGame,
  _engine: GameEngine,
  kind: TownSurfaceKind,
  thread: AnyThreadChannel,
): Promise<{ label: string }> {
  if (thread.parentId !== game.channelId) {
    throw new Error("Mark a thread inside this game’s town channel.");
  }

  const meta = SURFACE_META[kind];
  const threadName = townSurfaceThreadName(kind);

  if (thread.archived) {
    await thread.setArchived(false, `Marked as ${meta.label}.`).catch(() => undefined);
  }
  if (thread.name !== threadName) {
    await thread.setName(threadName, `Marked as ${meta.label}.`).catch(() => undefined);
  }
  await ensureThreadAutoArchive(thread);

  if (meta.locked) {
    if (!thread.locked) {
      await thread.setLocked(true, "Rules thread is ST-write / player-read.").catch(() => undefined);
    }
  } else if (thread.locked) {
    await thread.setLocked(false, `Unlock ${meta.label} for player posts.`).catch(() => undefined);
  }

  // Clear other surface slots that pointed at this same thread.
  const clearOther: Record<string, string | null> = {};
  for (const other of Object.keys(SURFACE_META) as TownSurfaceKind[]) {
    if (other === kind) continue;
    const field = SURFACE_META[other].dbField;
    if (game[field] === thread.id) {
      clearOther[field] = null;
    }
  }
  // If this thread was Town Voting, clear votingThreadId.
  const gameRow = await prisma.game.findUnique({
    where: { id: game.id },
    select: { votingThreadId: true },
  });
  if (gameRow?.votingThreadId === thread.id) {
    clearOther.votingThreadId = null;
  }

  await prisma.game.update({
    where: { id: game.id },
    data: {
      ...clearOther,
      [meta.dbField]: thread.id,
    },
  });

  await thread
    .send({
      content: `This thread is now **${meta.label}** for the game.`,
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);

  return { label: meta.label };
}

/**
 * Point Town Voting at an existing town-channel thread (rename + unlock).
 * Caller should `OpenDay` when day state exists so nominations resolve here.
 */
export async function markTownVoteThread(
  game: TownSurfaceGame,
  thread: AnyThreadChannel,
): Promise<{ label: string }> {
  if (thread.parentId !== game.channelId) {
    throw new Error("Mark a thread inside this game’s town channel.");
  }

  const label = "Town Voting";
  const threadName = townVoteThreadName();

  if (thread.archived) {
    await thread.setArchived(false, `Marked as ${label}.`).catch(() => undefined);
  }
  if (thread.name !== threadName) {
    await thread.setName(threadName, `Marked as ${label}.`).catch(() => undefined);
  }
  await ensureThreadAutoArchive(thread);

  if (thread.locked) {
    await thread.setLocked(false, `Unlock ${label} for nominations and votes.`).catch(() => undefined);
  }

  // This thread can no longer be Rules / Claims / Whisper Declaration.
  const clearOther: Record<string, string | null> = {};
  for (const other of Object.keys(SURFACE_META) as TownSurfaceKind[]) {
    const field = SURFACE_META[other].dbField;
    if (game[field] === thread.id) {
      clearOther[field] = null;
    }
  }

  await prisma.game.update({
    where: { id: game.id },
    data: {
      ...clearOther,
      votingThreadId: thread.id,
    },
  });

  await thread
    .send({
      content: `This thread is now **${label}** for the game.`,
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);

  return { label };
}

export async function getTownSurfaceThread(
  guild: Guild,
  game: TownSurfaceGame,
  kind: TownSurfaceKind,
): Promise<AnyThreadChannel | null> {
  const field = SURFACE_META[kind].dbField;
  return findTownSurfaceThread(guild, game.channelId, kind, game.id, game[field]);
}

/** Post `## Day N` into Whisper Declaration and Public Claims (not Rules). */
export async function postDayMarkersToTownSurfaces(
  guild: Guild,
  game: TownSurfaceGame,
  dayNumber: number,
): Promise<void> {
  const content = `## Day ${dayNumber}`;
  for (const kind of ["whisper-decl", "claims"] as const) {
    const thread = await getTownSurfaceThread(guild, game, kind);
    if (!thread) continue;
    const field = SURFACE_META[kind].dbField;
    if (game[field] !== thread.id) {
      await persistTownSurfaceThreadId(game.id, kind, thread.id);
      game[field] = thread.id;
    }
    if (thread.archived) {
      await thread.setArchived(false, `Day ${dayNumber} marker`).catch(() => undefined);
    }
    await thread.send({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
  }
}
