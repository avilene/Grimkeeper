import type { RoleDefinition } from "../plugins/trouble-brewing/roles.js";

/** Sects & Violets — official character IDs. */
export const sectsAndVioletsRoles: RoleDefinition[] = [
  { id: "clockmaker", name: "Clockmaker", type: "townsfolk", team: "good", ability: "Learn how many steps from the Demon to its nearest Minion." },
  { id: "dreamer", name: "Dreamer", type: "townsfolk", team: "good", ability: "Each night, choose a player: learn a good and an evil character they might be." },
  { id: "snake_charmer", name: "Snake Charmer", type: "townsfolk", team: "good", ability: "Each night, choose an alive player: a chosen Demon swaps characters with you." },
  { id: "mathematician", name: "Mathematician", type: "townsfolk", team: "good", ability: "Each night, learn how many players' abilities worked abnormally since dawn." },
  { id: "flowergirl", name: "Flowergirl", type: "townsfolk", team: "good", ability: "Each night, learn if the Demon voted today." },
  { id: "town_crier", name: "Town Crier", type: "townsfolk", team: "good", ability: "Each night, learn if a Minion nominated today." },
  { id: "oracle", name: "Oracle", type: "townsfolk", team: "good", ability: "Each night, learn how many dead players are evil." },
  { id: "savant", name: "Savant", type: "townsfolk", team: "good", ability: "Each day, you may visit the Storyteller to learn 1 true & 1 false statement." },
  { id: "seamstress", name: "Seamstress", type: "townsfolk", team: "good", ability: "Once per game, at night, choose two players: learn if they are the same alignment." },
  { id: "philosopher", name: "Philosopher", type: "townsfolk", team: "good", ability: "Once per game, at night, choose a good character: gain that ability." },
  { id: "artist", name: "Artist", type: "townsfolk", team: "good", ability: "Once per game, during the day, privately ask the Storyteller any yes/no question." },
  { id: "sage", name: "Sage", type: "townsfolk", team: "good", ability: "If the Demon kills you, a player who is not the Demon is executed." },
  { id: "mutant", name: "Mutant", type: "outsider", team: "good", ability: "If you are mad about being an Outsider, you might be executed." },
  { id: "sweetheart", name: "Sweetheart", type: "outsider", team: "good", ability: "When you die, 1 player is drunk until dusk." },
  { id: "barber", name: "Barber", type: "outsider", team: "good", ability: "If you died today, the Demon may choose 2 players to swap characters." },
  { id: "klutz", name: "Klutz", type: "outsider", team: "good", ability: "When you learn which players are evil, 1 is good." },
  { id: "evil_twin", name: "Evil Twin", type: "minion", team: "evil", ability: "You and an opposing player know each other. If one of you dies, the other dies too." },
  { id: "marionette", name: "Marionette", type: "minion", team: "evil", ability: "You think you are good, but you are not. The Demon knows who you are." },
  { id: "mezepheles", name: "Mezepheles", type: "minion", team: "evil", ability: "Choose a word at game start. If a good player says it, they become evil." },
  { id: "harpy", name: "Harpy", type: "minion", team: "evil", ability: "Each night, choose two players: tomorrow, one must accuse the other or both might die." },
  { id: "fang_gu", name: "Fang Gu", type: "demon", team: "evil", ability: "Each night, choose a player: they die. The 1st Outsider becomes the Fang Gu if you kill them." },
  { id: "vigormortis", name: "Vigormortis", type: "demon", team: "evil", ability: "Each night, choose a player: they die. Minions you kill keep their ability and register as good." },
  { id: "no_dashii", name: "No Dashii", type: "demon", team: "evil", ability: "Each night, choose a player: they die. Your 2 Townsfolk neighbors are poisoned." },
  { id: "vortox", name: "Vortox", type: "demon", team: "evil", ability: "Each night, choose a player: they die. Good players' abilities give false info. Each day, if no one is executed, evil wins." },
];
