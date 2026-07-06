export const STANDARD_EDITION_CHOICES = [
  { name: "Trouble Brewing", value: "tb" },
  { name: "Bad Moon Rising", value: "bmr" },
  { name: "Sects & Violets", value: "snv" },
] as const;

export type StandardEditionChoice = (typeof STANDARD_EDITION_CHOICES)[number]["value"];
