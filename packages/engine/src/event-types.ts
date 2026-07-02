export const GameEventType = {
  GameCreated: "GameCreated",
  PlayerAdded: "PlayerAdded",
  PlayerRemoved: "PlayerRemoved",
  StorytellerPromoted: "StorytellerPromoted",
  GameStarted: "GameStarted",
  RoleAssigned: "RoleAssigned",
  RolesDealt: "RolesDealt",
  NightStarted: "NightStarted",
  DayStarted: "DayStarted",
  PlayerDied: "PlayerDied",
  NominationMade: "NominationMade",
  SeatsOpened: "SeatsOpened",
  SeatsClosed: "SeatsClosed",
  SeatPicked: "SeatPicked",
  GameEnded: "GameEnded",
} as const;

export type GameEventType = (typeof GameEventType)[keyof typeof GameEventType];
