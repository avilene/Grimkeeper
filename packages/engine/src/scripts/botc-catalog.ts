import { BOTC_ROLES, type BotcRoleRecord, type BotcRoleTeam } from "./botc-roles.js";

const WIKI_BASE = "https://wiki.bloodontheclocktower.com";

const EDITION_LABELS: Record<string, string> = {
  tb: "Trouble Brewing",
  bmr: "Bad Moon Rising",
  snv: "Sects & Violets",
};

const TEAM_LABELS: Record<BotcRoleTeam, string> = {
  townsfolk: "Townsfolk",
  outsider: "Outsider",
  minion: "Minion",
  demon: "Demon",
  traveler: "Traveler",
};

const byId = new Map(BOTC_ROLES.map((role) => [role.id, role]));

export function listBotcRoles(): readonly BotcRoleRecord[] {
  return BOTC_ROLES;
}

export function getBotcRole(idOrName: string): BotcRoleRecord | undefined {
  const normalized = normalizeQuery(idOrName);
  if (!normalized) return undefined;
  const exactId = byId.get(normalized.replace(/\s+/g, ""));
  if (exactId) return exactId;
  return BOTC_ROLES.find((role) => normalizeQuery(role.name) === normalized);
}

export function formatBotcTeam(team: BotcRoleTeam): string {
  return TEAM_LABELS[team] ?? team;
}

export function formatBotcEdition(edition: string): string | null {
  const key = edition.trim().toLowerCase();
  if (!key) return null;
  return EDITION_LABELS[key] ?? edition;
}

export function getBotcWikiUrl(role: BotcRoleRecord): string {
  return `${WIKI_BASE}/${encodeURIComponent(role.name.replace(/ /g, "_"))}`;
}

/** Wiki token icon (left thumbnail). Uses Special:FilePath so Discord can follow the redirect. */
export function getBotcIconUrl(role: BotcRoleRecord): string {
  return `${WIKI_BASE}/Special:FilePath/Icon_${role.id}.png`;
}

/** True when ability uses the official night* marker (not the first night). */
export function abilityHasNightAsterisk(ability: string): boolean {
  return /night\*/i.test(ability);
}

export function formatBotcAbility(ability: string): string {
  const trimmed = ability.trim();
  if (!abilityHasNightAsterisk(trimmed)) return trimmed;
  return `${trimmed}\n\n_\\* Not the first night._`;
}

export type BotcRoleMatch = {
  role: BotcRoleRecord;
  score: number;
};

/** Minimum characters required for `/role` search and autocomplete. */
export const BOTC_ROLE_SEARCH_MIN_LENGTH = 3;

function normalizeQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string): string {
  return normalizeQuery(value).replace(/\s+/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

function scoreRole(query: string, role: BotcRoleRecord): number {
  const q = normalizeQuery(query);
  if (!q) return 0;
  const qCompact = compact(query);
  const name = normalizeQuery(role.name);
  const nameCompact = compact(role.name);
  const id = role.id.toLowerCase();

  if (name === q || id === qCompact || nameCompact === qCompact) return 100;
  if (name.startsWith(q) || id.startsWith(qCompact)) return 90;
  if (name.includes(q) || id.includes(qCompact)) return 75;

  const tokens = q.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => name.includes(token) || id.includes(token))) {
    return 70;
  }

  const distance = Math.min(levenshtein(qCompact, nameCompact), levenshtein(qCompact, id));
  const maxLen = Math.max(qCompact.length, nameCompact.length, id.length, 1);
  const similarity = 1 - distance / maxLen;
  if (similarity >= 0.72) return Math.round(55 + similarity * 20);
  if (similarity >= 0.55) return Math.round(40 + similarity * 15);
  return 0;
}

/** Fuzzy search over official characters (including travelers). */
export function searchBotcRoles(query: string, limit = 25): BotcRoleMatch[] {
  const q = query.trim();
  if (q.length < BOTC_ROLE_SEARCH_MIN_LENGTH) {
    // Autocomplete submits role ids; allow exact hits under the min length (e.g. Po → `po`).
    const exact = getBotcRole(q);
    return exact ? [{ role: exact, score: 100 }] : [];
  }

  return BOTC_ROLES.map((role) => ({ role, score: scoreRole(q, role) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.role.name.localeCompare(b.role.name))
    .slice(0, limit);
}
