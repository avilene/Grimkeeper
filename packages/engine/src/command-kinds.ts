export const GameCommandKind = {
  CreateGame: "CreateGame",
  AddPlayer: "AddPlayer",
  RemovePlayer: "RemovePlayer",
  StartGame: "StartGame",
  ClearFakePlayers: "ClearFakePlayers",
  AdvancePhase: "AdvancePhase",
  EndGame: "EndGame",
  PromoteStoryteller: "PromoteStoryteller",
} as const;

export type GameCommandKind = (typeof GameCommandKind)[keyof typeof GameCommandKind];
