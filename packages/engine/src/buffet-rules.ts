import {
  BUFFET_HIDDEN_BY_DEFAULT,
  BUFFET_SECRET_ROLES,
  OUTSIDER_SETUP_DELTAS,
  type BuffetDraftConfig,
} from "./buffet-draft.js";
import { listBotcRoles } from "./scripts/botc-catalog.js";

export interface BuffetRulesSections {
  title: string;
  roleSummary: string;
  rules: string[];
}

function formatOutsiderSetupRule(roleId: string): string | null {
  const deltas = OUTSIDER_SETUP_DELTAS[roleId];
  if (!deltas?.length) return null;
  const catalog = new Map(listBotcRoles().map((r) => [r.id, r.name]));
  const name = catalog.get(roleId) ?? roleId;
  if (deltas.length === 1) {
    const d = deltas[0]!;
    if (d === 0) return `${name}: no outsider-count change`;
    const n = Math.abs(d);
    const word = n === 1 ? "outsider" : "outsiders";
    return d > 0
      ? `${name}: +${d} ${word} when drafted`
      : `${name}: −${n} ${word} when drafted`;
  }
  return `${name}: outsider count adjusts when drafted (${deltas.join(" or ")} outsiders)`;
}

/** Player-safe summary of the configured Sushi Buffet script and house rules. */
export function describeBuffetRules(config: BuffetDraftConfig): BuffetRulesSections {
  const catalog = new Map(listBotcRoles().map((r) => [r.id, r]));
  const enabled = config.enabledRoleIds
    .map((id) => catalog.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  const byTeam: Record<string, string[]> = {
    townsfolk: [],
    outsider: [],
    minion: [],
    demon: [],
    traveler: [],
  };
  for (const role of enabled) {
    (byTeam[role.team] ??= []).push(role.name);
  }
  for (const team of Object.keys(byTeam)) {
    byTeam[team]!.sort((a, b) => a.localeCompare(b));
  }

  const roleLines = [
    byTeam.townsfolk?.length ? `Townsfolk (${byTeam.townsfolk.length}): ${byTeam.townsfolk.join(", ")}` : null,
    byTeam.outsider?.length ? `Outsiders (${byTeam.outsider.length}): ${byTeam.outsider.join(", ")}` : null,
    byTeam.minion?.length ? `Minions (${byTeam.minion.length}): ${byTeam.minion.join(", ")}` : null,
    byTeam.demon?.length ? `Demons (${byTeam.demon.length}): ${byTeam.demon.join(", ")}` : null,
    byTeam.traveler?.length ? `Travelers (${byTeam.traveler.length}): ${byTeam.traveler.join(", ")}` : null,
  ].filter((line): line is string => line != null);

  const rules: string[] = [
    `Mulligans: ${config.mulliganSteps.join(" → ")} choices per pick`,
    config.recycleUnchosen
      ? "Unchosen roles return to the pool for later picks."
      : "Unchosen roles leave the pool when someone passes on them.",
  ];

  const setupRoles = config.enabledRoleIds
    .map((id) => formatOutsiderSetupRule(id))
    .filter((line): line is string => line != null);
  if (setupRoles.length > 0) {
    rules.push("Outsider-count roles in this script:");
    rules.push(...setupRoles.map((line) => `• ${line}`));
  }

  if (config.enabledRoleIds.includes("summoner")) {
    rules.push("Summoner is enabled — no Demon in the bag at game start.");
  }
  if (config.enabledRoleIds.includes("lilmonsta")) {
    rules.push("Lil' Monsta can be drafted — it is not a player; the drafter then picks a Minion.");
  }

  const hidden = BUFFET_HIDDEN_BY_DEFAULT.filter((id) => config.enabledRoleIds.includes(id));
  if (hidden.includes("lunatic")) {
    rules.push("Lunatic is in the script but not player-pickable — the Storyteller assigns who is Lunatic.");
  }
  if (hidden.includes("marionette")) {
    rules.push("Marionette is in the script but not player-pickable — may be assigned behind the scenes.");
  }
  if (config.enabledRoleIds.includes("drunk")) {
    rules.push("Drunk is in the script but not player-pickable — the Storyteller assigns Drunk when needed.");
  }

  const pickableSecrets = BUFFET_SECRET_ROLES.filter(
    (id) => id !== "drunk" && config.enabledRoleIds.includes(id),
  );
  if (pickableSecrets.length === 0 && !hidden.length) {
    rules.push("Every enabled role except Drunk can appear in your pick buttons.");
  }

  return {
    title: "Sushi Buffet script",
    roleSummary: roleLines.join("\n"),
    rules,
  };
}

/** Discord message body for `/script` (kept under typical embed limits). */
export function formatBuffetRulesMessage(config: BuffetDraftConfig): string {
  const { title, roleSummary, rules } = describeBuffetRules(config);
  return [`**${title}**`, "", roleSummary, "", "**How this draft works**", ...rules.map((r) => (r.startsWith("•") ? r : `• ${r}`))].join(
    "\n",
  );
}
