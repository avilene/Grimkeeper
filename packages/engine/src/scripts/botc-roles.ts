/** Official BotC characters (incl. travelers) from the script-tool / townsquare catalog. */
export type BotcRoleTeam = "townsfolk" | "outsider" | "minion" | "demon" | "traveler";

export type BotcRoleRecord = {
  id: string;
  name: string;
  /** tb | bmr | snv | empty (experimental). */
  edition: string;
  team: BotcRoleTeam;
  ability: string;
};

export const BOTC_ROLES: BotcRoleRecord[] = [
  {
    "id": "washerwoman",
    "name": "Washerwoman",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "You start knowing that 1 of 2 players is a particular Townsfolk."
  },
  {
    "id": "librarian",
    "name": "Librarian",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "You start knowing that 1 of 2 players is a particular Outsider. (Or that zero are in play.)"
  },
  {
    "id": "investigator",
    "name": "Investigator",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "You start knowing that 1 of 2 players is a particular Minion."
  },
  {
    "id": "chef",
    "name": "Chef",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "You start knowing how many pairs of evil players there are."
  },
  {
    "id": "empath",
    "name": "Empath",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "Each night, you learn how many of your 2 alive neighbours are evil."
  },
  {
    "id": "fortuneteller",
    "name": "Fortune Teller",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you."
  },
  {
    "id": "undertaker",
    "name": "Undertaker",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "Each night*, you learn which character died by execution today."
  },
  {
    "id": "monk",
    "name": "Monk",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "Each night*, choose a player (not yourself): they are safe from the Demon tonight."
  },
  {
    "id": "ravenkeeper",
    "name": "Ravenkeeper",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "If you die at night, you are woken to choose a player: you learn their character."
  },
  {
    "id": "virgin",
    "name": "Virgin",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "The 1st time you are nominated, if the nominator is a Townsfolk, they are executed immediately."
  },
  {
    "id": "slayer",
    "name": "Slayer",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "Once per game, during the day, publicly choose a player: if they are the Demon, they die."
  },
  {
    "id": "soldier",
    "name": "Soldier",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "You are safe from the Demon."
  },
  {
    "id": "mayor",
    "name": "Mayor",
    "edition": "tb",
    "team": "townsfolk",
    "ability": "If only 3 players live & no execution occurs, your team wins. If you die at night, another player might die instead."
  },
  {
    "id": "butler",
    "name": "Butler",
    "edition": "tb",
    "team": "outsider",
    "ability": "Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too."
  },
  {
    "id": "drunk",
    "name": "Drunk",
    "edition": "tb",
    "team": "outsider",
    "ability": "You do not know you are the Drunk. You think you are a Townsfolk character, but you are not."
  },
  {
    "id": "recluse",
    "name": "Recluse",
    "edition": "tb",
    "team": "outsider",
    "ability": "You might register as evil & as a Minion or Demon, even if dead."
  },
  {
    "id": "saint",
    "name": "Saint",
    "edition": "tb",
    "team": "outsider",
    "ability": "If you die by execution, your team loses."
  },
  {
    "id": "poisoner",
    "name": "Poisoner",
    "edition": "tb",
    "team": "minion",
    "ability": "Each night, choose a player: they are poisoned tonight and tomorrow day."
  },
  {
    "id": "spy",
    "name": "Spy",
    "edition": "tb",
    "team": "minion",
    "ability": "Each night, you see the Grimoire. You might register as good & as a Townsfolk or Outsider, even if dead."
  },
  {
    "id": "scarletwoman",
    "name": "Scarlet Woman",
    "edition": "tb",
    "team": "minion",
    "ability": "If there are 5 or more players alive & the Demon dies, you become the Demon. (Travellers don\u2019t count)"
  },
  {
    "id": "baron",
    "name": "Baron",
    "edition": "tb",
    "team": "minion",
    "ability": "There are extra Outsiders in play. [+2 Outsiders]"
  },
  {
    "id": "imp",
    "name": "Imp",
    "edition": "tb",
    "team": "demon",
    "ability": "Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp."
  },
  {
    "id": "bureaucrat",
    "name": "Bureaucrat",
    "edition": "tb",
    "team": "traveler",
    "ability": "Each night, choose a player (not yourself): their vote counts as 3 votes tomorrow."
  },
  {
    "id": "thief",
    "name": "Thief",
    "edition": "tb",
    "team": "traveler",
    "ability": "Each night, choose a player (not yourself): their vote counts negatively tomorrow."
  },
  {
    "id": "gunslinger",
    "name": "Gunslinger",
    "edition": "tb",
    "team": "traveler",
    "ability": "Each day, after the 1st vote has been tallied, you may choose a player that voted: they die."
  },
  {
    "id": "scapegoat",
    "name": "Scapegoat",
    "edition": "tb",
    "team": "traveler",
    "ability": "If a player of your alignment is executed, you might be executed instead."
  },
  {
    "id": "beggar",
    "name": "Beggar",
    "edition": "tb",
    "team": "traveler",
    "ability": "You must use a vote token to vote. Dead players may choose to give you theirs. If so, you learn their alignment. You are sober & healthy."
  },
  {
    "id": "grandmother",
    "name": "Grandmother",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "You start knowing a good player & their character. If the Demon kills them, you die too."
  },
  {
    "id": "sailor",
    "name": "Sailor",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "Each night, choose an alive player: either you or they are drunk until dusk. You can't die."
  },
  {
    "id": "chambermaid",
    "name": "Chambermaid",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "Each night, choose 2 alive players (not yourself): you learn how many woke tonight due to their ability."
  },
  {
    "id": "exorcist",
    "name": "Exorcist",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "Each night*, choose a player (different to last night): the Demon, if chosen, learns who you are then doesn't wake tonight."
  },
  {
    "id": "innkeeper",
    "name": "Innkeeper",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "Each night*, choose 2 players: they can't die tonight, but 1 is drunk until dusk."
  },
  {
    "id": "gambler",
    "name": "Gambler",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "Each night*, choose a player & guess their character: if you guess wrong, you die."
  },
  {
    "id": "gossip",
    "name": "Gossip",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "Each day, you may make a public statement. Tonight, if it was true, a player dies."
  },
  {
    "id": "courtier",
    "name": "Courtier",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "Once per game, at night, choose a character: they are drunk for 3 nights & 3 days."
  },
  {
    "id": "professor",
    "name": "Professor",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "Once per game, at night*, choose a dead player: if they are a Townsfolk, they are resurrected."
  },
  {
    "id": "minstrel",
    "name": "Minstrel",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "When a Minion dies by execution, all other players (except Travellers) are drunk until dusk tomorrow."
  },
  {
    "id": "tealady",
    "name": "Tea Lady",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "If both your alive neighbours are good, they can't die."
  },
  {
    "id": "pacifist",
    "name": "Pacifist",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "Executed good players might not die."
  },
  {
    "id": "fool",
    "name": "Fool",
    "edition": "bmr",
    "team": "townsfolk",
    "ability": "The first time you die, you don't."
  },
  {
    "id": "tinker",
    "name": "Tinker",
    "edition": "bmr",
    "team": "outsider",
    "ability": "You might die at any time."
  },
  {
    "id": "moonchild",
    "name": "Moonchild",
    "edition": "bmr",
    "team": "outsider",
    "ability": "When you learn that you died, publicly choose 1 alive player. Tonight, if it was a good player, they die."
  },
  {
    "id": "goon",
    "name": "Goon",
    "edition": "bmr",
    "team": "outsider",
    "ability": "Each night, the 1st player to choose you with their ability is drunk until dusk. You become their alignment."
  },
  {
    "id": "lunatic",
    "name": "Lunatic",
    "edition": "bmr",
    "team": "outsider",
    "ability": "You think you are a Demon, but you are not. The Demon knows who you are & who you choose at night."
  },
  {
    "id": "godfather",
    "name": "Godfather",
    "edition": "bmr",
    "team": "minion",
    "ability": "You start knowing which Outsiders are in play. If 1 died today, choose a player tonight: they die. [\u22121 or +1 Outsider]"
  },
  {
    "id": "devilsadvocate",
    "name": "Devil's Advocate",
    "edition": "bmr",
    "team": "minion",
    "ability": "Each night, choose a living player (different to last night): if executed tomorrow, they don't die."
  },
  {
    "id": "assassin",
    "name": "Assassin",
    "edition": "bmr",
    "team": "minion",
    "ability": "Once per game, at night*, choose a player: they die, even if for some reason they could not."
  },
  {
    "id": "mastermind",
    "name": "Mastermind",
    "edition": "bmr",
    "team": "minion",
    "ability": "If the Demon dies by execution (ending the game), play for 1 more day. If a player is then executed, their team loses."
  },
  {
    "id": "zombuul",
    "name": "Zombuul",
    "edition": "bmr",
    "team": "demon",
    "ability": "Each night*, if no-one died today, choose a player: they die. The 1st time you die, you live but register as dead."
  },
  {
    "id": "pukka",
    "name": "Pukka",
    "edition": "bmr",
    "team": "demon",
    "ability": "Each night, choose a player: they are poisoned. The previously poisoned player dies then becomes healthy."
  },
  {
    "id": "shabaloth",
    "name": "Shabaloth",
    "edition": "bmr",
    "team": "demon",
    "ability": "Each night*, choose 2 players: they die. A dead player you chose last night might be regurgitated."
  },
  {
    "id": "po",
    "name": "Po",
    "edition": "bmr",
    "team": "demon",
    "ability": "Each night*, you may choose a player: they die. If your last choice was no-one, choose 3 players tonight."
  },
  {
    "id": "apprentice",
    "name": "Apprentice",
    "edition": "bmr",
    "team": "traveler",
    "ability": "On your 1st night, you gain a Townsfolk ability (if good), or a Minion ability (if evil)."
  },
  {
    "id": "matron",
    "name": "Matron",
    "edition": "bmr",
    "team": "traveler",
    "ability": "Each day, you may choose up to 3 sets of 2 players to swap seats. Players may not leave their seats to talk in private."
  },
  {
    "id": "judge",
    "name": "Judge",
    "edition": "bmr",
    "team": "traveler",
    "ability": "Once per game, if another player nominated, you may choose to force the current execution to pass or fail."
  },
  {
    "id": "bishop",
    "name": "Bishop",
    "edition": "bmr",
    "team": "traveler",
    "ability": "Only the Storyteller can nominate. At least 1 opposite player must be nominated each day."
  },
  {
    "id": "voudon",
    "name": "Voudon",
    "edition": "bmr",
    "team": "traveler",
    "ability": "Only you and the dead can vote. They don't need a vote token to do so. A 50% majority is not required."
  },
  {
    "id": "clockmaker",
    "name": "Clockmaker",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "You start knowing how many steps from the Demon to its nearest Minion."
  },
  {
    "id": "dreamer",
    "name": "Dreamer",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "Each night, choose a player (not yourself or Travellers): you learn 1 good and 1 evil character, 1 of which is correct."
  },
  {
    "id": "snakecharmer",
    "name": "Snake Charmer",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "Each night, choose an alive player: a chosen Demon swaps characters & alignments with you & is then poisoned."
  },
  {
    "id": "mathematician",
    "name": "Mathematician",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "Each night, you learn how many players\u2019 abilities worked abnormally (since dawn) due to another character's ability."
  },
  {
    "id": "flowergirl",
    "name": "Flowergirl",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "Each night*, you learn if a Demon voted today."
  },
  {
    "id": "towncrier",
    "name": "Town Crier",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "Each night*, you learn if a Minion nominated today."
  },
  {
    "id": "oracle",
    "name": "Oracle",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "Each night*, you learn how many dead players are evil."
  },
  {
    "id": "savant",
    "name": "Savant",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "Each day, you may visit the Storyteller to learn 2 things in private: 1 is true & 1 is false."
  },
  {
    "id": "seamstress",
    "name": "Seamstress",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "Once per game, at night, choose 2 players (not yourself): you learn if they are the same alignment."
  },
  {
    "id": "philosopher",
    "name": "Philosopher",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "Once per game, at night, choose a good character: gain that ability. If this character is in play, they are drunk."
  },
  {
    "id": "artist",
    "name": "Artist",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "Once per game, during the day, privately ask the Storyteller any yes/no question."
  },
  {
    "id": "juggler",
    "name": "Juggler",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "On your 1st day, publicly guess up to 5 players' characters. That night, you learn how many you got correct."
  },
  {
    "id": "sage",
    "name": "Sage",
    "edition": "snv",
    "team": "townsfolk",
    "ability": "If the Demon kills you, you learn that it is 1 of 2 players."
  },
  {
    "id": "mutant",
    "name": "Mutant",
    "edition": "snv",
    "team": "outsider",
    "ability": "If you are \u201cmad\u201d about being an Outsider, you might be executed."
  },
  {
    "id": "sweetheart",
    "name": "Sweetheart",
    "edition": "snv",
    "team": "outsider",
    "ability": "When you die, 1 player is drunk from now on."
  },
  {
    "id": "barber",
    "name": "Barber",
    "edition": "snv",
    "team": "outsider",
    "ability": "If you died today or tonight, the Demon may choose 2 players (not another Demon) to swap characters."
  },
  {
    "id": "klutz",
    "name": "Klutz",
    "edition": "snv",
    "team": "outsider",
    "ability": "When you learn that you died, publicly choose 1 alive player: if they are evil, your team loses."
  },
  {
    "id": "eviltwin",
    "name": "Evil Twin",
    "edition": "snv",
    "team": "minion",
    "ability": "You & an opposing player know each other. If the good player is executed, evil wins. Good can't win if you both live."
  },
  {
    "id": "witch",
    "name": "Witch",
    "edition": "snv",
    "team": "minion",
    "ability": "Each night, choose a player: if they nominate tomorrow, they die. If just 3 players live, you lose this ability."
  },
  {
    "id": "cerenovus",
    "name": "Cerenovus",
    "edition": "snv",
    "team": "minion",
    "ability": "Each night, choose a player & a good character: they are \u201cmad\u201d they are this character tomorrow, or might be executed."
  },
  {
    "id": "pithag",
    "name": "Pit-Hag",
    "edition": "snv",
    "team": "minion",
    "ability": "Each night*, choose a player & a character they become (if not-in-play). If a Demon is made, deaths tonight are arbitrary."
  },
  {
    "id": "fanggu",
    "name": "Fang Gu",
    "edition": "snv",
    "team": "demon",
    "ability": "Each night*, choose a player: they die. The 1st Outsider this kills becomes an evil Fang Gu & you die instead. [+1 Outsider]"
  },
  {
    "id": "vigormortis",
    "name": "Vigormortis",
    "edition": "snv",
    "team": "demon",
    "ability": "Each night*, choose a player: they die. Minions you kill keep their ability & poison 1 Townsfolk neighbour. [\u22121 Outsider]"
  },
  {
    "id": "nodashii",
    "name": "No Dashii",
    "edition": "snv",
    "team": "demon",
    "ability": "Each night*, choose a player: they die. Your 2 Townsfolk neighbours are poisoned."
  },
  {
    "id": "vortox",
    "name": "Vortox",
    "edition": "snv",
    "team": "demon",
    "ability": "Each night*, choose a player: they die. Townsfolk abilities yield false info. Each day, if no-one is executed, evil wins."
  },
  {
    "id": "barista",
    "name": "Barista",
    "edition": "snv",
    "team": "traveler",
    "ability": "Each night, until dusk, 1) a player becomes sober, healthy and gets true info, or 2) their ability works twice. They learn which."
  },
  {
    "id": "harlot",
    "name": "Harlot",
    "edition": "snv",
    "team": "traveler",
    "ability": "Each night*, choose a living player: if they agree, you learn their character, but you both might die."
  },
  {
    "id": "butcher",
    "name": "Butcher",
    "edition": "snv",
    "team": "traveler",
    "ability": "Each day, after the 1st execution, you may nominate again."
  },
  {
    "id": "bonecollector",
    "name": "Bone Collector",
    "edition": "snv",
    "team": "traveler",
    "ability": "Once per game, at night, choose a dead player: they regain their ability until dusk."
  },
  {
    "id": "deviant",
    "name": "Deviant",
    "edition": "snv",
    "team": "traveler",
    "ability": "If you were funny today, you cannot die by exile."
  },
  {
    "id": "noble",
    "name": "Noble",
    "edition": "",
    "team": "townsfolk",
    "ability": "You start knowing 3 players, 1 and only 1 of which is evil."
  },
  {
    "id": "bountyhunter",
    "name": "Bounty Hunter",
    "edition": "",
    "team": "townsfolk",
    "ability": "You start knowing 1 evil player. If the player you know dies, you learn another evil player tonight. [1 Townsfolk is evil]"
  },
  {
    "id": "pixie",
    "name": "Pixie",
    "edition": "",
    "team": "townsfolk",
    "ability": "You start knowing 1 in-play Townsfolk. If you were mad that you were this character, you gain their ability when they die."
  },
  {
    "id": "general",
    "name": "General",
    "edition": "",
    "team": "townsfolk",
    "ability": "Each night, you learn which alignment the Storyteller believes is winning: good, evil, or neither."
  },
  {
    "id": "preacher",
    "name": "Preacher",
    "edition": "",
    "team": "townsfolk",
    "ability": "Each night, choose a player: a Minion, if chosen, learns this. All chosen Minions have no ability."
  },
  {
    "id": "king",
    "name": "King",
    "edition": "",
    "team": "townsfolk",
    "ability": "Each night, if the dead outnumber the living, you learn 1 alive character. The Demon knows who you are."
  },
  {
    "id": "balloonist",
    "name": "Balloonist",
    "edition": "",
    "team": "townsfolk",
    "ability": "Each night, you learn 1 player of each character type, until there are no more types to learn. [+1 Outsider]"
  },
  {
    "id": "cultleader",
    "name": "Cult Leader",
    "edition": "",
    "team": "townsfolk",
    "ability": "Each night, you become the alignment of an alive neighbour. If all good players choose to join your cult, your team wins."
  },
  {
    "id": "lycanthrope",
    "name": "Lycanthrope",
    "edition": "",
    "team": "townsfolk",
    "ability": "Each night*, choose a living player: if good, they die, but they are the only player that can die tonight."
  },
  {
    "id": "amnesiac",
    "name": "Amnesiac",
    "edition": "",
    "team": "townsfolk",
    "ability": "You do not know what your ability is. Each day, privately guess what it is: you learn how accurate you are."
  },
  {
    "id": "nightwatchman",
    "name": "Nightwatchman",
    "edition": "",
    "team": "townsfolk",
    "ability": "Once per game, at night, choose a player: they learn who you are."
  },
  {
    "id": "engineer",
    "name": "Engineer",
    "edition": "",
    "team": "townsfolk",
    "ability": "Once per game, at night, choose which Minions or which Demon is in play."
  },
  {
    "id": "fisherman",
    "name": "Fisherman",
    "edition": "",
    "team": "townsfolk",
    "ability": "Once per game, during the day, visit the Storyteller for some advice to help you win."
  },
  {
    "id": "huntsman",
    "name": "Huntsman",
    "edition": "",
    "team": "townsfolk",
    "ability": "Once per game, at night, choose a living player: the Damsel, if chosen, becomes a not-in-play Townsfolk. [+the Damsel]"
  },
  {
    "id": "alchemist",
    "name": "Alchemist",
    "edition": "",
    "team": "townsfolk",
    "ability": "You have a not-in-play Minion ability."
  },
  {
    "id": "farmer",
    "name": "Farmer",
    "edition": "",
    "team": "townsfolk",
    "ability": "If you die at night, an alive good player becomes a Farmer."
  },
  {
    "id": "magician",
    "name": "Magician",
    "edition": "",
    "team": "townsfolk",
    "ability": "The Demon thinks you are a Minion. Minions think you are a Demon."
  },
  {
    "id": "choirboy",
    "name": "Choirboy",
    "edition": "",
    "team": "townsfolk",
    "ability": "If the Demon kills the King, you learn which player is the Demon. [+ the King]"
  },
  {
    "id": "poppygrower",
    "name": "Poppy Grower",
    "edition": "",
    "team": "townsfolk",
    "ability": "Minions & Demons do not know each other. If you die, they learn who each other are that night."
  },
  {
    "id": "atheist",
    "name": "Atheist",
    "edition": "",
    "team": "townsfolk",
    "ability": "The Storyteller can break the game rules & if executed, good wins, even if you are dead. [No evil characters]"
  },
  {
    "id": "cannibal",
    "name": "Cannibal",
    "edition": "",
    "team": "townsfolk",
    "ability": "You have the ability of the recently killed executee. If they are evil, you are poisoned until a good player dies by execution."
  },
  {
    "id": "snitch",
    "name": "Snitch",
    "edition": "",
    "team": "outsider",
    "ability": "Minions start knowing 3 not-in-play characters."
  },
  {
    "id": "acrobat",
    "name": "Acrobat",
    "edition": "",
    "team": "outsider",
    "ability": "Each night*, if either good living neighbour is drunk or poisoned, you die."
  },
  {
    "id": "puzzlemaster",
    "name": "Puzzlemaster",
    "edition": "",
    "team": "outsider",
    "ability": "1 player is drunk, even if you die. If you guess (once) who it is, learn the Demon player, but guess wrong & get false info."
  },
  {
    "id": "heretic",
    "name": "Heretic",
    "edition": "",
    "team": "outsider",
    "ability": "Whoever wins, loses & whoever loses, wins, even if you are dead."
  },
  {
    "id": "damsel",
    "name": "Damsel",
    "edition": "",
    "team": "outsider",
    "ability": "All Minions know you are in play. If a Minion publicly guesses you (once), your team loses."
  },
  {
    "id": "golem",
    "name": "Golem",
    "edition": "",
    "team": "outsider",
    "ability": "You may only nominate once per game. When you do, if the nominee is not the Demon, they die."
  },
  {
    "id": "politician",
    "name": "Politician",
    "edition": "",
    "team": "outsider",
    "ability": "If you were the player most responsible for your team losing, you change alignment & win, even if dead."
  },
  {
    "id": "widow",
    "name": "Widow",
    "edition": "",
    "team": "minion",
    "ability": "On your 1st night, look at the Grimoire and choose a player: they are poisoned. 1 good player knows a Widow is in play."
  },
  {
    "id": "fearmonger",
    "name": "Fearmonger",
    "edition": "",
    "team": "minion",
    "ability": "Each night, choose a player. If you nominate & execute them, their team loses. All players know if you choose a new player."
  },
  {
    "id": "psychopath",
    "name": "Psychopath",
    "edition": "",
    "team": "minion",
    "ability": "Each day, before nominations, you may publicly choose a player: they die. If executed, you only die if you lose roshambo."
  },
  {
    "id": "goblin",
    "name": "Goblin",
    "edition": "",
    "team": "minion",
    "ability": "If you publicly claim to be the Goblin when nominated & are executed that day, your team wins."
  },
  {
    "id": "mezepheles",
    "name": "Mezepheles",
    "edition": "",
    "team": "minion",
    "ability": "You start knowing a secret word. The 1st good player to say this word becomes evil that night."
  },
  {
    "id": "marionette",
    "name": "Marionette",
    "edition": "",
    "team": "minion",
    "ability": "You think you are a good character but you are not. The Demon knows who you are. [You neighbour the Demon]"
  },
  {
    "id": "boomdandy",
    "name": "Boomdandy",
    "edition": "",
    "team": "minion",
    "ability": "If you are executed, all but 3 players die. 1 minute later, the player with the most players pointing at them dies."
  },
  {
    "id": "lilmonsta",
    "name": "Lil' Monsta",
    "edition": "",
    "team": "demon",
    "ability": "Each night, Minions choose who babysits Lil' Monsta's token & \"is the Demon\". A player dies each night*. [+1 Minion]"
  },
  {
    "id": "lleech",
    "name": "Lleech",
    "edition": "",
    "team": "demon",
    "ability": "Each night*, choose a player: they die. You start by choosing an alive player: they are poisoned - you die if & only if they die."
  },
  {
    "id": "alhadikhia",
    "name": "Al-Hadikhia",
    "edition": "",
    "team": "demon",
    "ability": "Each night*, choose 3 players (all players learn who): each silently chooses to live or die, but if all live, all die."
  },
  {
    "id": "legion",
    "name": "Legion",
    "edition": "",
    "team": "demon",
    "ability": "Each night*, a player might die. Executions fail if only evil voted. You register as a Minion too. [Most players are Legion]"
  },
  {
    "id": "leviathan",
    "name": "Leviathan",
    "edition": "",
    "team": "demon",
    "ability": "If more than 1 good player is executed, you win. All players know you are in play. After day 5, evil wins."
  },
  {
    "id": "riot",
    "name": "Riot",
    "edition": "",
    "team": "demon",
    "ability": "Nominees die, but may nominate again immediately (on day 3, they must). After day 3, evil wins. [All Minions are Riot]"
  },
  {
    "id": "gangster",
    "name": "Gangster",
    "edition": "",
    "team": "traveler",
    "ability": "Once per day, you may choose to kill an alive neighbour, if your other alive neighbour agrees."
  }
];
