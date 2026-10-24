// ---------------------------------------------------------------------------
// Content types (mirrors content/*.json, produced by tools/build_content.py)
// ---------------------------------------------------------------------------

export type Stat = "brawn" | "wits" | "charm" | "spark" | "luck";
export const STATS: Stat[] = ["brawn", "wits", "charm", "spark", "luck"];
export type Region = "forest" | "meadow" | "swamp" | "mountain" | "ruins";
export const REGIONS: Region[] = ["forest", "meadow", "swamp", "mountain", "ruins"];
export type Tag = Region | "creature" | "peril";
export const TAGS: Tag[] = [...REGIONS, "creature", "peril"];

/** One effect, as written on cards, items, and World cards. */
export interface Effect {
  type: string;
  [key: string]: any;
}

export interface ExploreOption {
  name: string;
  stats: Stat[];
  need: number;
  stamina: number;
  rest: boolean;
  pay: number | null;
  discardTreasure: boolean;
  classBonus: { cls: string; dice: number } | null;
  text: { success: string | null; fail: string | null; spark: string | null };
  sparkNeeds: number;
  success: Effect[];
  fail: Effect[];
  spark: Effect[];
  kind: "rest" | "dig" | "climb" | "befriend" | "explore";
}

export interface ExploreCard {
  id: string;
  name: string;
  region: Region;
  tags: Tag[];
  skull: number;
  copies: number;
  teaser: string;
  flavor: string;
  mishap: { text: string; effects: Effect[] } | null;
  options: ExploreOption[];
}

export interface Hook {
  kind: string;
  [key: string]: any;
}

export interface ItemDef {
  id: string;
  name: string;
  rarity: "common" | "uncommon" | "rare" | "legendary";
  type: "treasure" | "light" | "gear" | "food" | "relic";
  coin: number;
  vp: number;
  power: "none" | "reusable" | "oneUse" | "hidden";
  text: string;
  use?: Effect[];
  passive?: Hook[];
  unique?: boolean;
  carryover?: boolean;
  cannotTrade?: boolean;
  cannotSteal?: boolean;
  cannotCash?: boolean;
}

export interface CompanionDef {
  id: string;
  name: string;
  foundAt: string;
  region: Region | null;
  text: string;
  passive: Hook[];
  turns?: number;
}

export interface ClassDef {
  id: string;
  name: string;
  group: string;
  status: "built" | "concept";
  statMods?: Partial<Record<Stat, number>>;
  passive?: string;
  active?: string;
  signature?: string;
  weakness?: string;
  hooks?: Hook[];
}

export interface SpeciesDef {
  id: string;
  name: string;
  trait: string;
  hooks: Hook[];
}

export interface FragmentDef {
  id: string;
  name: string;
  whisper: string;
  text: string;
  effect: Effect;
}

/** Event conditions and end-of-game checks; see docs/mission-conditions.md. */
export interface Condition {
  event?: string;
  tags?: Tag[];
  minSkull?: number;
  stats?: Stat[];
  count?: number;
  distinct?: "location" | "tag" | "stat";
  requires?: Record<string, any>;
  previousTurn?: Condition;
  cost?: Record<string, any>;
  never?: Condition;
  ever?: Condition;
  until?: "milestones";
  end?: Record<string, any>;
  all?: Condition[];
  any?: Condition[];
  [key: string]: any;
}

export interface MissionDef {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  path: Tag[];
  anyPath: boolean;
  playsLike: string;
  lore: string;
  milestones: { text: string; vp: number; condition: Condition | null }[];
  finale: { text: string; vp: number; condition: Condition | null };
  flourish: { text: string; vp: number; condition: Condition | null };
}

export type WorldCategory = "weather" | "monster" | "merchant" | "rumor" | "chaos" | "escalation" | "finale";

export interface WorldCardDef {
  id: string;
  name: string;
  category: WorldCategory;
  text?: string;
  flavor?: string;
  duration?: string;
  night?: boolean;
  mods?: Hook[];
  instant?: Effect[];
  [key: string]: any;
}

export interface MonsterOption {
  name: string;
  stat?: Stat;
  need?: number;
  defeats?: boolean;
  pay?: { coin?: number; sparkTokens?: number };
  effects?: Effect[];
  onFail?: Effect[];
  onSuccess?: Effect[];
  reward?: Effect[];
}

export type GameLength = "quick" | "standard" | "long";

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export interface CharacterSheet {
  name: string;
  species: string;
  stats: Record<Stat, number>;
  /** Carried between games. */
  lessons?: Partial<Record<Stat, number>>;
  quirks?: Quirk[];
  heirlooms?: string[];
  /** Brand-new characters see 4 class options instead of 3 (up to 6 players). */
  isNew?: boolean;
}

export interface Quirk {
  name: string;
  text: string;
  quirk: Hook[];
}

export interface ItemInstance {
  uid: number;
  id: string;
  /** Where it was found (for "treasure found at a Swamp location"). */
  foundTags: Tag[];
  foundSkull: number;
  origin: "explore" | "bought" | "world" | "start" | "monster" | "rumor" | "dropped";
  stolen?: boolean;
  carriedOver?: boolean;
  /** Taproot Fragment's hidden power, drawn when found. */
  fragment?: string;
  usedOnce?: boolean;
  /** World-card bonuses on a found treasure (Thal Tide, The Sky Cracks...). */
  bonusVp?: number;
  bonusCoin?: number;
  /** Squirrelfolk's protected item. */
  protected?: boolean;
}

export interface CompanionInstance {
  id: string;
  turnsLeft?: number;
  usedOnce?: boolean;
}

export interface Trap {
  owner: number;
  location: string; // explore card id (location name)
  type: "snare" | "pickpocket" | "stinkbomb";
  permanent?: boolean;
}

export interface GameEvent {
  type: string;
  round: number;
  turn: number; // player's own turn counter
  tags?: Tag[];
  skull?: number;
  stat?: Stat;
  location?: string;
  [key: string]: any;
}

export interface PlayerState {
  id: number;
  name: string;
  species: string;
  cls: string | null;
  mission: string | null;
  bot?: BotPersona | null;
  stats: Record<Stat, number>;
  baseStats: Record<Stat, number>;
  health: number;
  stamina: number;
  maxHealth: number;
  maxStamina: number;
  coin: number;
  sparkTokens: number;
  items: ItemInstance[];
  companions: CompanionInstance[];
  lessons: Record<Stat, number>;
  grownThisGame: number;
  growth: Stat[];
  quirks: Quirk[];
  claimed: number[]; // milestone indexes
  finaleDone: boolean;
  firstFinisher: boolean;
  flourishDone: boolean;
  // per-turn / temporary
  frog: boolean;
  skipExplore: boolean;
  teasersNext: number | null;
  peekTurns: number;
  trouble: { amount: number; rolls: number };
  nextRollDice: number;
  stink: boolean;
  untargetable: boolean;
  forcePass: boolean;
  noPush: boolean;
  heat: number;
  heatReady: boolean;
  dream: number;
  surgeTurns: number;
  oncePerGame: string[]; // hook keys already used
  rationsUsed: boolean;
  damageThisTurn: number;
  rootedUsed: boolean;
  flowUsed: boolean;
  intel: Record<number, string[]>; // rival id -> learned mission tags
  knownMissions: Record<number, string>; // revealed by fragment
  seenWorld: number;
  history: GameEvent[];
  turns: number;
  guesses: Record<number, string> | null;
  vpBonus: number;
  brawlDice: number;
  quickActionLost: boolean;
  bet: boolean;
  // stats for the simulator
  log: Record<string, number>;
}

export type BotPersona = "friendly" | "aggressive" | "cautious" | "balanced";

export interface CardInstance {
  uid: number;
  card: string; // explore card id
}

export interface ActiveMonster {
  id: string;
  roundsLeft: number;
  targets: number[];
}

export interface ActiveRumor {
  id: string;
}

export interface MarketState {
  merchant: string;
  stock: { uid: number; id: string; price: number; sold?: boolean }[];
  auction?: { id: string } | null;
  pending: number[];
}

export interface Meeting {
  players: number[];
  key: string;
  choices: Record<number, "ally" | "brawl" | "pass" | null>;
  resolved: boolean;
  result?: string;
}

export interface Picks {
  [playerId: number]: CardInstance | null;
}

export type Phase =
  | "classDraft"
  | "missionDraft"
  | "pick"
  | "meeting"
  | "turn"
  | "market"
  | "trade"
  | "finalGuess"
  | "over";

export interface Decision {
  player: number;
  kind: DecisionKind;
  /** Information the player needs to decide (already filtered to what they may see). */
  data: Record<string, any>;
}

export type DecisionKind =
  | "chooseClass"
  | "chooseMission"
  | "pickTeaser"
  | "meetingChoice"
  | "monsterChoice"
  | "chooseOption"
  | "assistOffer"
  | "push"
  | "reward"
  | "quickAction"
  | "market"
  | "respondTrade"
  | "finalGuess";

export interface TurnContext {
  player: number;
  card: CardInstance | null;
  step:
    | "start"
    | "monsters"
    | "trap"
    | "choose"
    | "assist"
    | "roll"
    | "push"
    | "reward"
    | "quick"
    | "done";
  monsterQueue: string[];
  option?: number;
  stat?: Stat;
  dice?: number[];
  troubleDice?: number[];
  baseDice?: number;
  need?: number;
  pushed?: boolean;
  usedToken?: boolean;
  assistDice?: number;
  assistFrom?: number[];
  assistAsked?: number[];
  finaleAttempt?: boolean;
  staminaSpent?: number;
  sprangTrap?: boolean;
  usedItem?: boolean;
  lessonStat?: Stat;
  startHealth?: number;
  startStamina?: number;
  meetingBonus?: number;
  duringMeeting?: boolean;
  teamUp?: boolean;
  successes?: number;
  altExplore?: string | null;
}

export interface GameConfig {
  seed: number;
  length: GameLength;
  players: (CharacterSheet & { bot?: BotPersona | null; /** skip the draft and play this class */ cls?: string })[];
  /** Restrict the class draft (e.g. to classes whose powers are automated). */
  classPool?: string[];
  missionPool?: string[];
}

export interface GameState {
  version: 1;
  config: {
    seed: number;
    length: GameLength;
    playerCount: number;
    classPool: string[];
    missionPool: string[];
    newCharacters: boolean[];
    forcedClasses: (string | null)[];
  };
  rng: number;
  uid: number;
  phase: Phase;
  round: number;
  players: PlayerState[];
  order: number[]; // turn order this round
  firstPlayer: number;
  pending: Decision[];
  // decks
  exploreDeck: CardInstance[];
  exploreDiscard: CardInstance[];
  worldDeck: string[]; // world card ids, top first; last is "FINALE"
  worldDiscard: string[];
  escalations: string[];
  finale: string | null;
  finalRound: boolean;
  firstFinisher: number | null;
  // per-round
  hands: Record<number, CardInstance[]>;
  picks: Picks;
  meetings: Meeting[];
  turnIndex: number;
  turn: TurnContext | null;
  // world state
  mods: { source: string; mods: Hook[]; until: "round" | "next" | "game" }[];
  night: boolean;
  monsters: ActiveMonster[];
  rumors: ActiveRumor[];
  traps: Trap[];
  trapHistory: string[]; // locations where a trap was sprung
  dropped: Record<string, ItemInstance[]>; // location -> items
  squirrelStash: ItemInstance[];
  market: MarketState | null;
  tradeOffers: TradeOffer[];
  takenUniques: string[];
  sealed: string[];
  // drafts
  classOptions: Record<number, string[]>;
  missionOptions: Record<number, string[]>;
  /** Answers collected for simultaneous decisions (picks, meeting choices, market, guesses). */
  collect: Record<number, any>;
  meetingBonus: Record<number, number>;
  log: LogEntry[];
  stats: Record<string, number>;
  winner: number[] | null;
  scores: ScoreLine[] | null;
  /** The most recent explore roll, for showing dice. */
  lastRoll?: LastRoll | null;
  /** Queued die results (tests, scripted tutorials). Consumed before the RNG. */
  scriptedDice?: number[];
}

export interface LastRoll {
  seq: number;
  player: number;
  card: string;
  option: string;
  stat: Stat;
  dice: number[];
  trouble: number[];
  need: number;
  successes: number;
  ok: boolean;
  pushed: boolean;
  spark: boolean;
  mishap: boolean;
}

export interface TradeOffer {
  from: number;
  to: number;
  give: { items: number[]; coin: number };
  get: { items: number[]; coin: number };
}

export interface LogEntry {
  round: number;
  text: string;
  /** If set, only these players (and the TV after the game) may see it. */
  private?: number[];
}

export interface ScoreLine {
  player: number;
  name: string;
  cls: string | null;
  mission: string | null;
  tier: number;
  milestones: number;
  finale: boolean;
  flourish: boolean;
  first: boolean;
  missionVp: number;
  treasureVp: number;
  guessVp: number;
  fragmentVp: number;
  bonusVp: number;
  total: number;
  coin: number;
  correctGuesses: number;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { player: number; kind: "chooseClass"; cls: string }
  | { player: number; kind: "chooseMission"; mission: string }
  | { player: number; kind: "pickTeaser"; card: number }
  | { player: number; kind: "meetingChoice"; choice: "ally" | "brawl" | "pass" }
  | { player: number; kind: "monsterChoice"; option: number }
  | {
      player: number;
      kind: "chooseOption";
      option: number;
      stat?: Stat;
      useToken?: boolean;
      rations?: boolean;
      useItems?: number[];
      askAssist?: boolean;
      attemptFinale?: boolean;
      lessonStat?: Stat;
      /** Take an optional bet on a rest option (The Kite Cliffs). */
      bet?: boolean;
    }
  | { player: number; kind: "assistOffer"; dice: number }
  | { player: number; kind: "push"; push: boolean }
  | { player: number; kind: "reward"; lessonInstead: boolean; lessonStat?: Stat }
  | {
      player: number;
      kind: "quickAction";
      action: "none" | "trap" | "rations";
      location?: string;
      trapType?: "snare" | "pickpocket" | "stinkbomb";
      useItems?: number[];
      cash?: number[];
      target?: number;
    }
  | {
      player: number;
      kind: "market";
      buy?: number[];
      cash?: number[];
      exchange?: number[];
      bid?: number;
      services?: string[];
      offers?: Omit<TradeOffer, "from">[];
    }
  | { player: number; kind: "respondTrade"; accept: boolean }
  | { player: number; kind: "finalGuess"; guesses: Record<number, string> };
