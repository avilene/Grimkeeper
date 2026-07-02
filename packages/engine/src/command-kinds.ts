export const GameCommandKind = {
  CreateGame: "CreateGame",
  AddPlayer: "AddPlayer",
  RemovePlayer: "RemovePlayer",
  StartGame: "StartGame",
  AssignRole: "AssignRole",
  DealRoles: "DealRoles",
  BeginNight: "BeginNight",
  ClearFakePlayers: "ClearFakePlayers",
  AdvancePhase: "AdvancePhase",
  MakeNomination: "MakeNomination",
  OpenSeats: "OpenSeats",
  CloseSeats: "CloseSeats",
  PickSeat: "PickSeat",
  EndGame: "EndGame",
  PromoteStoryteller: "PromoteStoryteller",
} as const;

export type GameCommandKind = (typeof GameCommandKind)[keyof typeof GameCommandKind];
