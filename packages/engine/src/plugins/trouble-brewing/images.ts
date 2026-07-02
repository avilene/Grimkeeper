import { getTroubleBrewingRole, type RoleDefinition, type RoleType } from "./roles.js";

/** Official CCC-hosted assets: https://release.botc.app/resources/ */
const IMAGE_BASE = "https://release.botc.app/resources/characters/tb";
const WIKI_BASE = "https://wiki.bloodontheclocktower.com";

const ASSET_ID_OVERRIDES: Record<string, string> = {
  fortune_teller: "fortuneteller",
  scarlet_woman: "scarletwoman",
};

function assetIdForRole(role: RoleDefinition): string {
  return ASSET_ID_OVERRIDES[role.id] ?? role.id.replace(/_/g, "");
}

function alignmentSuffix(type: RoleType): "g" | "e" {
  return type === "minion" || type === "demon" ? "e" : "g";
}

export function getRoleImageUrl(roleId: string): string | undefined {
  const role = getTroubleBrewingRole(roleId);
  if (!role) return undefined;
  return `${IMAGE_BASE}/${assetIdForRole(role)}_${alignmentSuffix(role.type)}.webp`;
}

export function getRoleWikiUrl(roleId: string): string | undefined {
  const role = getTroubleBrewingRole(roleId);
  if (!role) return undefined;
  return `${WIKI_BASE}/${role.name.replace(/ /g, "_")}`;
}
