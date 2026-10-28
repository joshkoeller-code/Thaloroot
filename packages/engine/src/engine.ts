/**
 * The Thaloroot rules engine: a serializable state machine.
 *
 *   const state = createGame(config);
 *   while (state.phase !== "over") {
 *     const d = state.pending[0];          // who must decide what
 *     step(state, someActionFor(d));       // mutates state; act() returns a copy instead
 *   }
 *
 * Everything lives in GameState (including the RNG), so a game can be saved,
 * sent over the network, or replayed from its seed and action list.
 */
import { BUILT_CLASSES, Content } from "./content.js";
import { allowedStats, countSuccesses, dicePool, dreaming, isMishap, needFor, sparkTriggered, staminaFor } from "./dice.js";
import {
  addLessons,
  apply,
  damage,
  gainCompanion,
  gainItem,
  growthStat,
  itemCoin,
  itemValue,
  itemVp,
  log,
  tell,
  loseRandomItem,
  loseStamina,
  makeFrog,
  record,
  restoreStamina,
  steal,
  treasureVp,
  useItem,
} from "./effects.js";
import { endCheck } from "./missions.js";
import { availablePowers, exploredLocations, forage, hasPower, heirloomId, powerDef, springWards, usePower, walledFor } from "./powers.js";
import {
  addItem,
  bump,
  gstat,
  has,
  hooks,
  isTreasure,
  recomputeMax,
  removeItem,
  rivals,
  treasures,
  useOnce,
  worldMods,
} from "./player.js";
import { d6, int, pick, roll, sample, seedFrom, shuffle } from "./rng.js";
import type {
  Action,
  CardInstance,
  Decision,
  ExploreCard,
  ExploreOption,
  GameConfig,
  GameState,
  Meeting,
  PlayerState,
  ScoreLine,
  Stat,
  Trap,
} from "./types.js";
import { STATS } from "./types.js";
import {
  FINALE,
  assignHunts,
  buildWorldDeck,
  drawWorldCard,
  endRoundMonsters,
  finaleHas,
  finaleScoring,
  monsterDef,
  monsterDice,
  monsterNeedBonus,
  price,
  resolveMarket,
} from "./world.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function createGame(config: GameConfig): GameState {
  const n = config.players.length;
  const R = Content.rules;
  if (n < R.players.min || n > R.players.max) throw new Error(`Thaloroot needs ${R.players.min} to ${R.players.max} players`);
  const state: GameState = {
    version: 1,
    config: {
      seed: config.seed,
      length: config.length,
      playerCount: n,
      classPool: config.classPool ?? BUILT_CLASSES,
      missionPool: config.missionPool ?? Content.missions.map((m) => m.id),
      newCharacters: config.players.map((p) => !!p.isNew),
      forcedClasses: config.players.map((p) => p.cls ?? null),
    },
    rng: seedFrom(config.seed),
    uid: 0,
    phase: "classDraft",
    round: 0,
    players: [],
    order: [],
    firstPlayer: 0,
    pending: [],
    exploreDeck: [],
    exploreDiscard: [],
    worldDeck: [],
    worldDiscard: [],
    escalations: [],
    finale: null,
    finalRound: false,
    firstFinisher: null,
    hands: {},
    picks: {},
    meetings: [],
    turnIndex: 0,
    turn: null,
    mods: [],
    night: false,
    monsters: [],
    rumors: [],
    traps: [],
    trapHistory: [],
    dropped: {},
    squirrelStash: [],
    market: null,
    tradeOffers: [],
    takenUniques: [],
    sealed: [],
    wards: [],
    walls: [],
    burned: [],
    sharedDream: null,
    disguise: null,
    passed: {},
    possess: {},
    swaps: [],
    schemeQueue: [],
    whispered: [],
    classOptions: {},
    missionOptions: {},
    collect: {},
    meetingBonus: {},
    log: [],
    stats: {},
    winner: null,
    scores: null,
    story: [],
  };
  config.players.forEach((sheet, i) => {
    validateSheet(sheet);
    const lessons: Record<Stat, number> = { brawn: 0, wits: 0, charm: 0, spark: 0, luck: 0, ...(sheet.lessons ?? {}) };
    const p: PlayerState = {
      id: i,
      name: sheet.name,
      species: sheet.species,
      cls: null,
      mission: null,
      bot: sheet.bot ?? null,
      stats: { ...sheet.stats },
      baseStats: { ...sheet.stats },
      health: R.startingKit.health,
      stamina: R.startingKit.stamina,
      maxHealth: R.startingKit.health,
      maxStamina: R.startingKit.stamina,
      coin: R.startingKit.coin,
      sparkTokens: 0,
      items: [],
      companions: [],
      lessons,
      grownThisGame: 0,
      growth: [],
      quirks: [...(sheet.quirks ?? [])],
      claimed: [],
      finaleDone: false,
      firstFinisher: false,
      flourishDone: false,
      frog: false,
      skipExplore: false,
      teasersNext: null,
      peekTurns: 0,
      trouble: { amount: 0, rolls: 0 },
      nextRollDice: 0,
      stink: false,
      untargetable: false,
      forcePass: false,
      noPush: false,
      heat: 0,
      heatReady: false,
      dream: 0,
      surgeTurns: 0,
      oncePerGame: [],
      rationsUsed: false,
      damageThisTurn: 0,
      rootedUsed: false,
      flowUsed: false,
      intel: {},
      knownMissions: {},
      seenWorld: 0,
      history: [],
      turns: 0,
      guesses: null,
      vpBonus: 0,
      brawlDice: 0,
      quickActionLost: false,
      bet: false,
      ingredients: 0,
      boons: [],
      decoys: [],
      haunted: 0,
      log: {},
    };
    state.players.push(p);
    for (const h of Content.speciesById[p.species]?.hooks ?? []) {
      if (h.kind === "startItem") addItem(state, p, { uid: ++state.uid, id: h.item, foundTags: [], foundSkull: 0, origin: "start" });
    }
    for (const h of sheet.heirlooms ?? []) {
      // a reforged Heirloom remembers its stat: "reforged-gear:brawn"
      const [id, forged] = h.split(":");
      if (!Content.item[id]) continue;
      addItem(state, p, { uid: ++state.uid, id, foundTags: [], foundSkull: 0, origin: "start", carriedOver: true, ...(forged ? { forged: forged as Stat } : {}) });
    }
    recomputeMax(state, p);
    p.health = p.maxHealth;
    p.stamina = p.maxStamina;
  });
  state.firstPlayer = int(state, 0, n - 1);
  // decks
  for (const c of Content.cards) for (let k = 0; k < c.copies; k++) state.exploreDeck.push({ uid: ++state.uid, card: c.id });
  shuffle(state, state.exploreDeck);
  state.worldDeck = buildWorldDeck(state);
  // class draft: in seat order from the first player, each is dealt classes nobody has taken yet
  state.collect = {};
  dealClass(state, 0);
  return state;
}

export function validateSheet(sheet: GameConfig["players"][number]): void {
  if (!Content.speciesById[sheet.species]) throw new Error(`unknown species ${sheet.species}`);
  for (const s of STATS) {
    const v = sheet.stats[s];
    if (!Number.isInteger(v) || v < 1 || v > Content.rules.character.statCap) throw new Error(`${sheet.name}: bad ${s} ${v}`);
  }
}

/** A fresh character: every stat 1 plus 7 points, none above 4. */
export function newCharacterStats(points: Partial<Record<Stat, number>>): Record<Stat, number> {
  const R = Content.rules.character;
  const stats = { brawn: 1, wits: 1, charm: 1, spark: 1, luck: 1 } as Record<Stat, number>;
  let spent = 0;
  for (const s of STATS) {
    const add = points[s] ?? 0;
    stats[s] += add;
    spent += add;
    if (stats[s] > R.creationMax) throw new Error(`${s} can't start above ${R.creationMax}`);
  }
  if (spent !== R.creationPoints) throw new Error(`spend exactly ${R.creationPoints} points (spent ${spent})`);
  return stats;
}

function seatOrder(state: GameState): number[] {
  const n = state.players.length;
  return Array.from({ length: n }, (_, i) => (state.firstPlayer + i) % n);
}

function dealClass(state: GameState, k: number): void {
  const pid = seatOrder(state)[k];
  const p = state.players[pid];
  const taken = state.players.map((q) => q.cls).filter(Boolean);
  const pool = state.config.classPool.filter((c) => !taken.includes(c));
  const R = Content.rules.draft;
  const sheetNew = state.config.newCharacters[pid];
  const count = sheetNew && state.players.length <= R.newCharacterBonusMaxPlayers ? R.classOptionsNewCharacter : R.classOptions;
  const forced = state.config.forcedClasses[pid];
  state.classOptions[pid] = forced ? [forced] : sample(state, pool, Math.min(count, pool.length));
  state.phase = "classDraft";
  state.pending = [{ player: pid, kind: "chooseClass", data: { options: state.classOptions[pid] } }];
}

function applyClass(state: GameState, p: PlayerState, cls: string): void {
  p.cls = cls;
  const def = Content.cls[cls];
  for (const [s, v] of Object.entries(def.statMods ?? {})) p.stats[s as Stat] = Math.max(1, p.stats[s as Stat] + (v as number));
  for (const h of def.hooks ?? []) if (h.kind === "setStat") p.stats[h.stat as Stat] = h.value;
  recomputeMax(state, p);
  p.health = p.maxHealth;
  p.stamina = p.maxStamina;
}

function dealMissions(state: GameState): void {
  const pool = shuffle(state, [...state.config.missionPool]);
  const k = Content.rules.draft.missionOptions;
  state.phase = "missionDraft";
  state.collect = {};
  state.pending = state.players.map((p, i) => {
    state.missionOptions[p.id] = pool.slice(i * k, i * k + k);
    return { player: p.id, kind: "chooseMission", data: { options: state.missionOptions[p.id] } } as Decision;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function act(state: GameState, action: Action): GameState {
  const next = structuredClone(state);
  step(next, action);
  return next;
}

export function pendingFor(state: GameState, player: number): Decision | undefined {
  return state.pending.find((d) => d.player === player);
}

export class IllegalAction extends Error {}

function take(state: GameState, action: Action): Decision {
  const i = state.pending.findIndex((d) => d.player === action.player && d.kind === action.kind);
  if (i < 0) {
    const want = state.pending.map((d) => `${state.players[d.player]?.name}:${d.kind}`).join(", ");
    throw new IllegalAction(`not expecting ${action.kind} from player ${action.player} (waiting on: ${want || "nothing"})`);
  }
  return state.pending.splice(i, 1)[0];
}

/** Apply one action, then run the game forward until someone has to decide something. */
export function step(state: GameState, action: Action): void {
  const d = take(state, action);
  const p = state.players[action.player];
  switch (action.kind) {
    case "chooseClass": {
      if (!d.data.options.includes(action.cls)) throw new IllegalAction(`class ${action.cls} wasn't offered`);
      applyClass(state, p, action.cls);
      log(state, `${p.name} the ${Content.speciesById[p.species].name} becomes a ${Content.cls[action.cls].name}.`);
      const k = seatOrder(state).indexOf(p.id) + 1;
      if (k < state.players.length) dealClass(state, k);
      else dealMissions(state);
      return;
    }
    case "chooseMission": {
      if (!d.data.options.includes(action.mission)) throw new IllegalAction(`mission ${action.mission} wasn't offered`);
      p.mission = action.mission;
      log(state, `${p.name} secretly keeps ${Content.mission[action.mission].name}.`, [p.id]);
      tell(state, { kind: "mission", player: p.id, mission: p.mission, part: "opening", private: [p.id] });
      if (!state.pending.length) startRound(state);
      return;
    }
    case "pickTeaser": {
      const hand = state.hands[p.id] ?? [];
      if (action.dreamPeek) {
        // Dream Peek: pay, then choose again with the full cards showing
        if (d.data.fullCards || !usePower(state, p, { id: "dream-peek" }, "pick")) throw new IllegalAction("you can't Dream Peek now");
        log(state, `${p.name} dreams ahead and sees what waits behind their teasers.`);
        state.pending.push({ ...d, data: { ...pickData(state, p, hand), fullCards: true } });
        return;
      }
      if (action.bridge) {
        if (!(d.data.bridge ?? []).includes(action.bridge) || !usePower(state, p, { id: "build-a-bridge" }, "pick")) throw new IllegalAction("you can't build a bridge there");
        state.picks[p.id] = { uid: ++state.uid, card: action.bridge, virtual: true };
        for (const h of hand) state.exploreDiscard.push(h);
        state.passed[p.id] = [];
        state.hands[p.id] = [];
        log(state, `${p.name} builds a bridge back to a place they've been.`);
        if (!picksPending(state)) startScheme(state);
        return;
      }
      const c = hand.find((h) => h.uid === action.card);
      if (!c) throw new IllegalAction("that card isn't in your hand");
      choosePick(state, p.id, hand, c);
      if (!picksPending(state)) startScheme(state);
      return;
    }
    case "possess": {
      const rid = d.data.rival as number;
      const hand = state.hands[rid] ?? [];
      const c = hand.find((h) => h.uid === action.card) ?? hand[0];
      choosePick(state, rid, hand, c);
      log(state, `You choose ${Content.card[c.card].name} for ${state.players[rid].name}.`, [p.id]);
      if (!picksPending(state)) startScheme(state);
      return;
    }
    case "whisper": {
      const q = state.players[action.rival];
      if (!q || q.id === p.id || !state.picks[q.id]) throw new IllegalAction("nobody to listen to there");
      state.whispered.push(p.id);
      const card = Content.card[state.picks[q.id]!.card];
      log(state, `The wind whispers that ${q.name} is heading to ${card.name} (${card.region}, ${card.skull} skull${card.skull > 1 ? "s" : ""}).`, [p.id]);
      record(state, p, { type: "seeHidden", what: "pick", rival: q.id });
      nextScheme(state, p.id);
      return;
    }
    case "scheme": {
      if (action.power && !usePower(state, p, action.power, "scheme")) throw new IllegalAction(`can't use ${action.power.id} now`);
      nextScheme(state);
      return;
    }
    case "feast": {
      const cook = state.players[d.data.cook];
      if (action.accept) {
        restoreStamina(p, "all");
        cook.vpBonus += d.data.vp ?? 1;
        record(state, cook, { type: "feastGuest", guest: p.id });
        log(state, `${p.name} comes to ${cook.name}'s Feast.`);
      } else log(state, `${p.name} stays away from ${cook.name}'s Feast.`);
      if (!state.pending.some((x) => x.kind === "feast")) endTurn(state);
      return;
    }
    case "meetingChoice": {
      state.collect[p.id] = p.forcePass ? "pass" : action.choice;
      if (!state.pending.some((x) => x.kind === "meetingChoice")) {
        resolveMeetings(state);
        beginTurns(state);
      }
      return;
    }
    case "monsterChoice":
      faceMonster(state, p, d.data.monster, action.option);
      advanceTurn(state);
      return;
    case "chooseOption":
      chooseOption(state, p, action, d);
      advanceTurn(state);
      return;
    case "assistOffer": {
      const t = state.turn!;
      const dice = Math.max(0, Math.min(Content.rules.assist.maxDice, action.dice, p.stamina));
      if (dice > 0) {
        p.stamina -= dice * Content.rules.assist.staminaPerDie;
        t.assistDice = (t.assistDice ?? 0) + dice;
        (t.assistFrom ??= []).push(p.id);
        record(state, p, { type: "lendAssist", to: t.player, dice });
        log(state, `${p.name} lends ${dice} Assist ${dice === 1 ? "die" : "dice"} to ${state.players[t.player].name}.`);
      }
      if (!state.pending.some((x) => x.kind === "assistOffer")) {
        if (t.assistDice) record(state, state.players[t.player], { type: "receiveAssist", dice: t.assistDice });
        t.step = "roll";
        advanceTurn(state);
      }
      return;
    }
    case "push": {
      const t = state.turn!;
      if (action.push) doPush(state, p);
      finishRoll(state, p);
      advanceTurn(state);
      return;
    }
    case "reward":
      takeReward(state, p, action.lessonInstead, action.lessonStat);
      advanceTurn(state);
      return;
    case "quickAction":
      quickAction(state, p, action);
      // The Feast waits on the guests' answers
      if (state.pending.some((x) => x.kind === "feast")) {
        state.turn!.step = "feast";
        return;
      }
      endTurn(state);
      return;
    case "market": {
      state.collect[p.id] = action;
      if (action.offers) for (const o of action.offers) state.tradeOffers.push({ ...o, from: p.id });
      if (!state.pending.some((x) => x.kind === "market")) {
        resolveMarket(state, state.collect);
        state.collect = {};
        openTrades(state);
      }
      return;
    }
    case "respondTrade": {
      const offer = state.tradeOffers.shift()!;
      if (action.accept) executeTrade(state, offer);
      openTrades(state);
      return;
    }
    case "finalGuess": {
      // only missions from that rival's lineup count
      const lineups = (d.data.lineups ?? []) as { rival: number; missions: string[] }[];
      const ok = Object.entries(action.guesses).filter(([rid, mid]) => {
        const l = lineups.find((x) => x.rival === Number(rid));
        return !l || l.missions.includes(mid);
      });
      p.guesses = Object.fromEntries(ok.slice(0, Content.rules.scoring.maxGuesses)) as any;
      if (!state.pending.some((x) => x.kind === "finalGuess")) score(state);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

function draw(state: GameState, ok: (c: CardInstance) => boolean = () => true): CardInstance {
  // burned and walled-off locations go to the discard and you draw again
  for (let tries = 0; tries < 200; tries++) {
    if (!state.exploreDeck.length) {
      state.exploreDeck = shuffle(state, state.exploreDiscard);
      state.exploreDiscard = [];
      gstat(state, "reshuffles");
    }
    const c = state.exploreDeck.pop()!;
    if (!state.burned.includes(c.card) && ok(c)) return c;
    state.exploreDiscard.push(c);
  }
  return state.exploreDeck.pop()!;
}

function picksPending(state: GameState): boolean {
  return state.pending.some((x) => x.kind === "pickTeaser" || x.kind === "possess");
}

function choosePick(state: GameState, pid: number, hand: CardInstance[], c: CardInstance): void {
  state.picks[pid] = c;
  state.passed[pid] = hand.filter((h) => h !== c);
  for (const h of hand) if (h !== c) state.exploreDiscard.push(h);
  state.hands[pid] = [];
}

function pickData(state: GameState, p: PlayerState, hand: CardInstance[]) {
  const pw = availablePowers(state, p, "pick");
  return {
    cards: hand.map((h) => ({ uid: h.uid, card: h.card })),
    fullCards: false,
    dreamPeek: pw.some((x) => x.id === "dream-peek"),
    bridge: pw.find((x) => x.id === "build-a-bridge")?.locations ?? null,
  };
}

export function teaserCount(state: GameState, p: PlayerState): number {
  if (p.teasersNext !== null) return p.teasersNext;
  const windy = worldMods(state).find((m) => m.kind === "teasers");
  if (windy) return windy.count;
  if (p.claimed.length === 3 && !p.finaleDone) return Content.rules.teasers.afterMilestones;
  return Content.rules.teasers.perTurn;
}

function startRound(state: GameState): void {
  state.round += 1;
  const n = state.players.length;
  const seats = Array.from({ length: n }, (_, i) => (state.firstPlayer + i) % n);
  state.order = worldMods(state).some((m) => m.kind === "reverseOrder") ? seats.reverse() : seats;
  state.phase = "pick";
  state.picks = {};
  state.hands = {};
  state.meetings = [];
  state.meetingBonus = {};
  state.collect = {};
  state.pending = [];
  state.passed = {};
  state.whispered = [];
  for (const p of state.players) p.untargetable = false;
  log(state, `Round ${state.round}${state.finalRound ? " (the final turn)" : ""}.`);
  if (state.sharedDream === state.round) log(state, "The Shared Dream settles over Thaloroot: this round, 1s count as successes and two 6s cause a Mishap.");
  for (const w of state.walls) if (w.round === state.round) log(state, `${Content.card[w.location].name} is walled off this round.`);
  for (const pid of state.order) {
    const p = state.players[pid];
    if (p.skipExplore) {
      state.picks[pid] = null;
      continue;
    }
    const k = teaserCount(state, p);
    p.teasersNext = null;
    const hand = Array.from({ length: k }, () => draw(state, (c) => !walledFor(state, p, c.card)));
    state.hands[pid] = hand;
    const peek = p.peekTurns > 0;
    if (peek) p.peekTurns -= 1;
    const ghost = state.possess[pid];
    if (ghost !== undefined) {
      // Possession: the Ghost chooses this rival's card
      delete state.possess[pid];
      state.pending.push({ player: ghost, kind: "possess", data: { rival: pid, cards: hand.map((h) => ({ uid: h.uid, card: h.card })) } });
      continue;
    }
    state.pending.push({ player: pid, kind: "pickTeaser", data: { ...pickData(state, p, hand), fullCards: peek } });
  }
  if (!state.pending.length) startScheme(state);
}

/**
 * After everyone picks and before the reveal: Whispers on the Wind, Switcheroo,
 * Gust, and Cyclone, one player at a time in turn order.
 */
function startScheme(state: GameState): void {
  state.phase = "scheme";
  state.schemeQueue = state.order.filter((pid) => {
    const p = state.players[pid];
    return hasPower(p, "whispers") || availablePowers(state, p, "scheme").length > 0;
  });
  nextScheme(state);
}

/** Ask the next schemer, or reveal. `again` re-asks a player who just used Whispers. */
function nextScheme(state: GameState, again?: number): void {
  state.pending = [];
  if (again !== undefined) {
    const p = state.players[again];
    const pw = availablePowers(state, p, "scheme");
    if (pw.length) {
      state.pending.push({ player: p.id, kind: "scheme", data: { powers: pw } });
      return;
    }
  }
  while (state.schemeQueue.length) {
    const p = state.players[state.schemeQueue.shift()!];
    const listeners = state.players.filter((q) => q.id !== p.id && state.picks[q.id]).map((q) => q.id);
    if (hasPower(p, "whispers") && !state.whispered.includes(p.id) && listeners.length) {
      state.pending.push({ player: p.id, kind: "whisper", data: { rivals: listeners } });
      return;
    }
    const pw = availablePowers(state, p, "scheme");
    if (pw.length) {
      state.pending.push({ player: p.id, kind: "scheme", data: { powers: pw } });
      return;
    }
  }
  reveal(state);
}

function meetingKey(card: ExploreCard): string {
  return `${card.region}:${card.skull}`;
}

function reveal(state: GameState): void {
  // Pass It On: everyone hands their chosen card to the left
  if (worldMods(state).some((m) => m.kind === "passCardsLeft")) {
    const ids = state.order.filter((pid) => state.picks[pid]);
    const cards = ids.map((pid) => state.picks[pid]);
    ids.forEach((pid, i) => (state.picks[ids[(i + 1) % ids.length]] = cards[i]));
  }
  const names = state.order
    .map((pid) => `${state.players[pid].name}: ${state.picks[pid] ? Content.card[state.picks[pid]!.card].name : "(recovering)"}`)
    .join("; ");
  log(state, `Reveal. ${names}.`);
  // Meetings: same region and same skull rating. Pairs form in turn order.
  const groups: Record<string, number[]> = {};
  for (const pid of state.order) {
    const c = state.picks[pid];
    if (!c) continue;
    (groups[meetingKey(Content.card[c.card])] ??= []).push(pid);
  }
  state.meetings = [];
  for (const [key, ids] of Object.entries(groups)) {
    for (let i = 0; i + 1 < ids.length; i += 2) {
      state.meetings.push({ players: [ids[i], ids[i + 1]], key, choices: {}, resolved: false });
    }
  }
  assignHunts(state);
  state.collect = {};
  state.pending = [];
  state.phase = "meeting";
  for (const m of state.meetings) {
    gstat(state, "meetings");
    for (const pid of m.players) {
      const others = m.players.filter((x) => x !== pid);
      const masked = worldMods(state).some((x) => x.kind === "hiddenMeetings");
      if (state.players[pid].forcePass) state.collect[pid] = "pass";
      else state.pending.push({ player: pid, kind: "meetingChoice", data: { with: masked ? [] : others, key: m.key } });
    }
  }
  if (!state.pending.length) {
    resolveMeetings(state);
    beginTurns(state);
  }
}

function brawlDice(state: GameState, p: PlayerState, ambusher: boolean, defending: boolean): number {
  let n = p.stats.brawn + (ambusher ? Content.rules.meetings.ambushDice : 0) + p.brawlDice;
  p.brawlDice = 0;
  if (defending) for (const h of hooks(state, p, "brawlDefense")) n += h.amount;
  if (useOnce(state, p, "brawlDiceOnce")) n += hooks(state, p, "brawlDiceOnce")[0]?.amount ?? 0;
  return n;
}

function resolveMeetings(state: GameState): void {
  const R = Content.rules.meetings;
  for (const m of state.meetings) {
    const [a, b] = m.players.map((pid) => state.players[pid]);
    const ca = (state.collect[a.id] ?? "pass") as "ally" | "brawl" | "pass";
    const cb = (state.collect[b.id] ?? "pass") as "ally" | "brawl" | "pass";
    m.choices = { [a.id]: ca, [b.id]: cb };
    const skull = Number(m.key.split(":")[1]);
    record(state, a, { type: "meetingChoice", choice: ca, skull });
    record(state, b, { type: "meetingChoice", choice: cb, skull });
    if (ca === "ally" && cb === "ally") {
      state.meetingBonus[a.id] = R.allyDice;
      state.meetingBonus[b.id] = R.allyDice;
      (a.log as any).teamUpRound = state.round;
      (b.log as any).teamUpRound = state.round;
      a.log.teamUpWith = b.id;
      b.log.teamUpWith = a.id;
      gstat(state, "teamUps");
      m.result = `${a.name} and ${b.name} team up (+${R.allyDice} dice each).`;
    } else if (ca === "brawl" || cb === "brawl") {
      gstat(state, "brawls");
      const ambA = ca === "brawl" && cb === "ally";
      const ambB = cb === "brawl" && ca === "ally";
      if (ambA) b.log.ambushedRound = state.round;
      if (ambB) a.log.ambushedRound = state.round;
      const ra = countSuccesses(roll(state, brawlDice(state, a, ambA, cb === "brawl")), false, dreaming(state));
      const rb = countSuccesses(roll(state, brawlDice(state, b, ambB, ca === "brawl")), false, dreaming(state));
      let winner: PlayerState | null = null;
      let loser: PlayerState | null = null;
      if (ra === rb) {
        const la = has(state, a, "loseBrawlTies");
        const lb = has(state, b, "loseBrawlTies");
        if (la !== lb) [winner, loser] = la ? [b, a] : [a, b];
      } else [winner, loser] = ra > rb ? [a, b] : [b, a];
      if (!winner || !loser) {
        loseStamina(state, a, R.tieStaminaLoss);
        loseStamina(state, b, R.tieStaminaLoss);
        m.result = `${a.name} and ${b.name} brawl to a tie (${ra}-${rb}); both lose ${R.tieStaminaLoss} stamina.`;
      } else {
        const txt = steal(state, winner, loser, "brawl");
        damage(state, loser, R.brawlLoserDamage, "brawl");
        const amb = (winner === a && ambA) || (winner === b && ambB);
        record(state, winner, { type: "winBrawl", ambusher: amb, skull });
        m.result = `${winner.name} wins the Brawl (${Math.max(ra, rb)}-${Math.min(ra, rb)}), ${txt}, and ${loser.name} takes ${R.brawlLoserDamage} damage.`;
      }
    } else {
      m.result = `${a.name} and ${b.name} go their separate ways.`;
    }
    m.resolved = true;
    log(state, `Meeting: ${a.name} chooses ${ca}, ${b.name} chooses ${cb}. ${m.result}`);
  }
  state.collect = {};
}

function beginTurns(state: GameState): void {
  state.phase = "turn";
  state.turnIndex = 0;
  startTurn(state);
}

function startTurn(state: GameState): void {
  if (state.turnIndex >= state.order.length) return endRound(state);
  const pid = state.order[state.turnIndex];
  const p = state.players[pid];
  p.turns += 1;
  p.rootedUsed = false;
  p.damageThisTurn = 0;
  p.rationsUsed = false;
  p.flowUsed = false;
  if (p.frog && p.log.frogOwn) p.frog = false;
  if (p.stamina === 0 && has(state, p, "sleepAtZeroStamina") && !p.skipExplore) {
    p.skipExplore = true;
    p.dream += 2;
    log(state, `${p.name} falls asleep and dreams (+2 Dream tokens).`);
  }
  restoreStamina(p, Content.rules.staminaPerTurn);
  if (p.heatReady === false) {
    for (const h of worldMods(state)) if (h.kind === "classHeat" && h.cls === p.cls) addHeat(p, h.amount);
  }
  const card = state.picks[pid] ?? null;
  const met = card ? state.meetings.find((m) => m.players.includes(pid)) : undefined;
  state.turn = {
    player: pid,
    card,
    step: "start",
    monsterQueue: [],
    startHealth: p.health,
    startStamina: p.stamina,
    meetingBonus: state.meetingBonus[pid] ?? 0,
    duringMeeting: !!met,
    teamUp: (state.meetingBonus[pid] ?? 0) > 0,
  };
  record(state, p, { type: "turnStart", startHealth: p.health, startStamina: p.stamina });
  // monsters hunting this player
  for (const m of state.monsters) {
    if (!m.targets.includes(pid)) continue;
    if (m.id === "the-mimic-chest" && !p.items.some((i) => i.uid === p.log.mimicTreasure)) {
      m.targets = [];
      continue;
    }
    if (useOnce(state, p, "ignoreHuntOnce")) {
      log(state, `${p.name} slips away from ${monsterDef(m.id).name}.`);
      continue;
    }
    state.turn.monsterQueue.push(m.id);
  }
  state.turn.step = "monsters";
  advanceTurn(state);
}

function addHeat(p: PlayerState, n: number): void {
  p.heat += n;
  if (p.heat >= 3) p.heatReady = true;
}

/** Run the current turn forward until a decision is needed. */
function advanceTurn(state: GameState): void {
  const t = state.turn;
  if (!t || state.pending.length) return;
  const p = state.players[t.player];
  while (!state.pending.length) {
    switch (t.step) {
      case "monsters": {
        const id = t.monsterQueue.shift();
        if (!id) {
          t.step = "trap";
          break;
        }
        if (!state.monsters.some((m) => m.id === id)) break;
        const def = monsterDef(id);
        state.pending.push({
          player: p.id,
          kind: "monsterChoice",
          data: { monster: id, options: def.options.map((o, i) => ({ index: i, ...o, affordable: canAffordMonster(p, o) })) },
        });
        return;
      }
      case "trap": {
        if (p.skipExplore || !t.card) {
          if (p.skipExplore) {
            p.skipExplore = false;
            log(state, `${p.name} recovers and skips exploring.`);
            bump(p, "skippedExplores");
            if (p.log.downedPending) {
              p.log.downedPending = 0;
              record(state, p, { type: "downedReturn" });
            }
          }
          t.card = null;
          t.step = "quick";
          break;
        }
        springTraps(state, p, t.card.card);
        springWards(state, p, t.card.card);
        const drops = state.dropped[t.card.card];
        if (drops?.length) {
          for (const it of drops) addItem(state, p, it);
          log(state, `${p.name} picks up ${drops.length} dropped item(s).`);
          delete state.dropped[t.card.card];
        }
        t.step = "choose";
        break;
      }
      case "choose":
        state.pending.push({ player: p.id, kind: "chooseOption", data: optionData(state, p) });
        return;
      case "assist":
        return; // waiting on assist offers
      case "roll":
        doRoll(state, p);
        break;
      case "push":
        return;
      case "reward":
        return;
      case "feast":
        return;
      case "quick":
        if (p.quickActionLost) {
          p.quickActionLost = false;
          endTurn(state);
          return;
        }
        state.pending.push({ player: p.id, kind: "quickAction", data: quickData(state, p) });
        return;
      case "done":
        endTurn(state);
        return;
      default:
        return;
    }
  }
}

function canAffordMonster(p: PlayerState, o: any): boolean {
  if (o.pay?.coin && p.coin < o.pay.coin) return false;
  if (o.pay?.sparkTokens && p.sparkTokens < o.pay.sparkTokens) return false;
  return true;
}

function faceMonster(state: GameState, p: PlayerState, id: string, idx: number): void {
  const def = monsterDef(id);
  let o = def.options[idx];
  if (!o || !canAffordMonster(p, o)) o = def.options[def.options.length - 1];
  const flee = def.options[def.options.length - 1];
  if (o.pay) {
    p.coin -= o.pay.coin ?? 0;
    p.sparkTokens -= o.pay.sparkTokens ?? 0;
    log(state, `${p.name} pays off ${def.name}.`);
    return;
  }
  if (o.stat) {
    const need = (o.need ?? 1) + monsterNeedBonus(state);
    const n = monsterDice(state, p, o.stat) + (p.nextRollDice || 0);
    p.nextRollDice = 0;
    const dice = roll(state, n);
    const ok = countSuccesses(dice, false, dreaming(state)) >= need;
    gstat(state, "monsterFights");
    if (ok) {
      if (o.onSuccess) apply(state, p, o.onSuccess, { origin: "monster" });
      if (o.defeats) {
        state.monsters = state.monsters.filter((m) => m.id !== id);
        apply(state, p, o.reward ?? def.reward ?? [], { origin: "monster" });
        if (id === "the-gloomhound" && o.name === "Tame") gainCompanion(state, p, "gloomhound");
        gstat(state, "monstersDefeated");
        record(state, p, { type: "defeatMonster", monster: id });
        log(state, `${p.name} defeats ${def.name} (${o.stat}: ${dice.join(" ")})!`);
      } else log(state, `${p.name} handles ${def.name}.`);
    } else {
      const fx = o.onFail ?? flee.effects ?? [];
      applyMonsterLoss(state, p, fx);
      log(state, `${p.name} loses to ${def.name} (${dice.join(" ") || "no dice"}).`);
    }
    return;
  }
  applyMonsterLoss(state, p, o.effects ?? []);
  log(state, `${p.name} flees from ${def.name}.`);
}

function applyMonsterLoss(state: GameState, p: PlayerState, fx: any[]): void {
  for (const e of fx) {
    if (e.type === "damage") damage(state, p, e.amount, "monster");
    else if (e.type === "loseFoundTreasure") {
      const uid = p.log.mimicTreasure;
      if (removeItem(state, p, uid)) log(state, `The Mimic Chest eats ${p.name}'s treasure.`);
      state.monsters = state.monsters.filter((m) => m.id !== "the-mimic-chest");
    } else apply(state, p, [e], { origin: "monster" });
  }
}

function springTraps(state: GameState, p: PlayerState, location: string): void {
  const trap = state.traps.find((t) => t.location === location && t.owner !== p.id);
  if (!trap) return;
  if (!trap.permanent) state.traps = state.traps.filter((t) => t !== trap);
  const owner = state.players[trap.owner];
  if (p.untargetable) return;
  if (useOnce(state, p, "ignoreTrapOnce")) {
    log(state, `${p.name} finds a trap at ${Content.card[location].name} and slips out of it.`);
    return;
  }
  const resist = hooks(state, p, "trapResist")[0];
  if (resist) {
    const r = d6(state);
    if (!resist.catchOn.includes(r)) {
      log(state, `${p.name} dodges a hidden trap.`);
      return;
    }
  }
  gstat(state, "trapsSprung");
  state.trapHistory.push(location);
  state.turn!.sprangTrap = true;
  let txt = "";
  if (trap.type === "snare") {
    loseStamina(state, p, 2);
    txt = "loses 2 stamina";
  } else if (trap.type === "stinkbomb") {
    p.stink = true;
    txt = "rolls 2 fewer dice this turn";
  } else txt = steal(state, owner, p, "trap");
  log(state, `${p.name} springs a hidden ${trap.type} at ${Content.card[location].name} and ${txt}.`);
  log(state, `Your ${trap.type} caught ${p.name}.`, [owner.id]);
  record(state, p, { type: "springTrap", trapType: trap.type, location });
  record(state, owner, { type: "trapSprungByRival", trapType: trap.type, victim: p.id });
}

// ---------------------------------------------------------------------------
// Choosing and rolling
// ---------------------------------------------------------------------------

/** Options a player can choose this turn: the card's own, plus World-card extras. */
export function turnOptions(state: GameState, p: PlayerState): { card: ExploreCard; options: (ExploreOption & { alt?: string })[] } {
  const t = state.turn!;
  const card = Content.card[t.card!.card];
  const opts: (ExploreOption & { alt?: string })[] = card.options.map((o) => ({ ...o }));
  const alt = (id: string, name: string, stat: Stat, need: number, success: any[], fail: any[], stamina = 1) =>
    opts.push({
      name, stats: [stat], need, stamina, rest: false, pay: null, discardTreasure: false, classBonus: null,
      text: { success: null, fail: null, spark: null }, sparkNeeds: 1, success, fail, spark: [], kind: "explore", alt: id,
    });
  for (const m of state.mods) {
    const def = Content.worldCard[m.source];
    if (def?.altExplore) alt(def.id, def.name, def.altExplore.stat, def.altExplore.need, def.altExplore.success, def.altExplore.fail);
  }
  for (const m of state.monsters) {
    const def = monsterDef(m.id);
    if (def.scatter) alt(`scatter:${m.id}`, `Drive off ${def.name}`, def.scatter.stat, def.scatter.need, [], []);
  }
  const reach = finaleHas(state, "taprootReach");
  if (reach && state.finalRound) alt("taproot-reach", "Reach for the Taproot", "spark", reach.need, [], [], p.stamina);
  return { card, options: opts };
}

function frogRestricted(p: PlayerState): boolean {
  return p.frog && !p.log.frogOwn;
}

function optionData(state: GameState, p: PlayerState) {
  const { card, options } = turnOptions(state, p);
  const t = state.turn!;
  return {
    card: card.id,
    meetingBonus: t.meetingBonus,
    frog: frogRestricted(p),
    options: options.map((o, i) => {
      const stats = allowedStats(state, p, o);
      return {
        index: i,
        name: o.name,
        alt: o.alt ?? null,
        rest: o.rest,
        stats,
        need: o.rest ? 0 : needFor(state, card, o),
        stamina: staminaFor(state, p, card, o),
        dice: Object.fromEntries(stats.map((s) => [s, dicePool(state, p, card, o, s).total + (t.meetingBonus ?? 0)])),
        allowed: optionAllowed(state, p, card, o),
      };
    }),
    canRations: !p.rationsUsed && p.coin >= Content.rules.rations.coin,
    finaleCost: finaleCost(p),
    powers: availablePowers(state, p, "roll").map((x) => ({ ...x, dice: x.id === "stampede" ? p.companions.length * (x.params?.perCompanion ?? 1) : 0 })),
    boosts: p.items.filter((i) => (Content.item[i.id].use ?? []).some((e) => e.type === "nextRollDice")).map((i) => i.uid),
  };
}

function finaleCost(p: PlayerState): Record<string, any> | null {
  if (!p.mission || p.claimed.length < 3 || p.finaleDone) return null;
  const c = Content.mission[p.mission].finale.condition;
  return c?.cost ?? null;
}

function optionAllowed(state: GameState, p: PlayerState, card: ExploreCard, o: ExploreOption & { alt?: string }): boolean {
  if (frogRestricted(p) && !o.rest && !o.stats.includes("charm")) return false;
  if (o.pay && p.coin < o.pay) return false;
  if (o.discardTreasure && !treasures(p).length) return false;
  if (!o.rest && o.alt !== "taproot-reach" && staminaFor(state, p, card, o) > p.stamina + (p.rationsUsed ? 0 : 0)) return false;
  return true;
}

function chooseOption(state: GameState, p: PlayerState, a: Extract<Action, { kind: "chooseOption" }>, d: Decision): void {
  const t = state.turn!;
  const R = Content.rules;
  if (a.rations && !p.rationsUsed && p.coin >= R.rations.coin) {
    p.coin -= R.rations.coin;
    restoreStamina(p, R.rations.stamina);
    p.rationsUsed = true;
    bump(p, "rations");
  }
  for (const uid of a.useItems ?? []) {
    if (useItem(state, p, uid, { lessonStat: a.lessonStat })) t.usedItem = true;
  }
  const { card, options } = turnOptions(state, p);
  if (a.power === "the-walking-cottage" && usePower(state, p, { id: "the-walking-cottage" }, "roll")) {
    walkingCottage(state, p, card);
    t.step = "quick";
    return;
  }
  t.powerDice = 0;
  let o = options[a.option];
  if (!o || !optionAllowed(state, p, card, o)) {
    // fall back to the first legal option (a rest option always exists or nothing happens)
    const idx = options.findIndex((x) => optionAllowed(state, p, card, x));
    if (idx < 0) {
      log(state, `${p.name} can't afford anything at ${card.name}.`);
      t.step = "quick";
      return;
    }
    if (o) log(state, `${p.name} can't take ${o.name}.`);
    o = options[idx];
    a = { ...a, option: idx };
  }
  t.option = a.option;
  t.lessonStat = a.lessonStat;
  p.bet = !!a.bet;
  if (o.pay) p.coin -= o.pay;
  if (o.discardTreasure) {
    const tr = treasures(p).sort((x, y) => itemValue(x) - itemValue(y))[0];
    if (tr) removeItem(state, p, tr.uid);
  }
  if (a.attemptFinale) {
    const cost = finaleCost(p);
    if (cost && canPayFinale(state, p, cost) && payFinaleCost(state, p, cost)) t.finaleAttempt = true;
  }
  if (o.rest) {
    resolveRest(state, p, card, o);
    t.step = "quick";
    return;
  }
  if (a.power === "stampede" && usePower(state, p, { id: "stampede" }, "roll")) {
    t.powerDice = p.companions.length * (powerDef("stampede")?.params?.perCompanion ?? 1);
    log(state, `${p.name}'s companions stampede: +${t.powerDice} dice!`);
  }
  const stats = allowedStats(state, p, o);
  const stat = a.stat && stats.includes(a.stat) ? a.stat : o.stats.reduce((x, y) => (p.stats[y] > p.stats[x] ? y : x));
  if (!o.stats.includes(stat)) {
    if (has(state, p, "flow") && !p.flowUsed) p.flowUsed = true;
    else useOnce(state, p, "flowOnce");
  }
  t.stat = stat;
  const cost = o.alt === "taproot-reach" ? p.stamina : staminaFor(state, p, card, o, stat);
  p.stamina -= cost;
  t.staminaSpent = cost;
  t.need = o.alt ? o.need : needFor(state, card, o);
  t.baseDice = dicePool(state, p, card, o, stat).total;
  t.usedToken = false;
  if (a.useToken && p.sparkTokens > 0) {
    p.sparkTokens -= 1;
    t.usedToken = true;
  }
  t.assistDice = 0;
  t.assistFrom = [];
  if (a.askAssist && !has(state, p, "noAssistReceive")) {
    const helpers = rivals(state, p).filter((q) => q.stamina > 0);
    for (const q of helpers)
      state.pending.push({ player: q.id, kind: "assistOffer", data: { to: p.id, card: card.id, need: t.need, stat } });
    t.assistAsked = helpers.map((q) => q.id);
    t.step = helpers.length ? "assist" : "roll";
    return;
  }
  t.step = "roll";
}

function canPayFinale(state: GameState, p: PlayerState, cost: Record<string, any>): boolean {
  if (cost.coin && p.coin < cost.coin) return false;
  const n = treasures(p).length;
  if (cost.discardTreasures && n < cost.discardTreasures) return false;
  if (cost.giveTreasure && n < 1) return false;
  if (cost.giveTreasureEachRival && n < state.players.length - 1) return false;
  return true;
}

/** Pay a finale's cost up front. Check canPayFinale first: nothing is refunded. */
function payFinaleCost(state: GameState, p: PlayerState, cost: Record<string, any>): boolean {
  if (cost.coin) {
    if (p.coin < cost.coin) return false;
    p.coin -= cost.coin;
    log(state, `${p.name} pays ${cost.coin} coin.`);
  }
  if (cost.discardTreasures) {
    const ts = treasures(p).sort((x, y) => itemValue(x) - itemValue(y));
    if (ts.length < cost.discardTreasures) return false;
    for (const it of ts.slice(0, cost.discardTreasures)) removeItem(state, p, it.uid);
  }
  if (cost.giveTreasure || cost.giveTreasureEachRival) {
    const rs = cost.giveTreasureEachRival ? rivals(state, p) : [pick(state, rivals(state, p))];
    const ts = treasures(p).sort((x, y) => itemValue(x) - itemValue(y));
    if (ts.length < rs.length) return false;
    rs.forEach((q, i) => {
      removeItem(state, p, ts[i].uid);
      addItem(state, q, ts[i]);
      log(state, `${p.name} gives ${q.name} the ${Content.item[ts[i].id].name}.`);
      record(state, p, { type: "giveTreasure", to: q.id });
    });
  }
  return true;
}

/** The Walking Cottage: rest anywhere for full stamina, and nothing you carry can be stolen. */
function walkingCottage(state: GameState, p: PlayerState, card: ExploreCard): void {
  restoreStamina(p, "all");
  for (const it of p.items) it.protected = true;
  bump(p, "rests");
  log(state, `${p.name}'s Walking Cottage strolls up to ${card.name}. They rest to full stamina and stash everything they carry where no one can steal it.`);
  record(state, p, { type: "rest", tags: card.tags, skull: card.skull, location: card.id, cottage: true });
}

function resolveRest(state: GameState, p: PlayerState, card: ExploreCard, o: ExploreOption): void {
  const ctx = { foundTags: card.tags, foundSkull: card.skull, location: card.id, lessonStat: state.turn!.lessonStat, bet: p.bet };
  apply(state, p, o.success, ctx);
  let extra = 0;
  for (const h of [...hooks(state, p, "restStamina"), ...worldMods(state).filter((m) => m.kind === "restStamina")]) extra += h.amount;
  if (extra) restoreStamina(p, extra);
  for (const h of hooks(state, p, "restLesson")) if (!h.tags || card.tags.some((t) => h.tags.includes(t))) addLessons(state, p, growthStat(p, state.turn!.lessonStat), h.amount);
  for (const h of hooks(state, p, "dreamTokensOnRest")) {
    p.dream += h.amount;
    p.untargetable = true;
  }
  bump(p, "rests");
  log(state, `${p.name} takes it easy at ${card.name}: ${o.name}.`);
  tell(state, { kind: "scene", player: p.id, card: card.id, option: o.name, outcome: "rest", spark: false, mishap: false });
  record(state, p, { type: "rest", tags: card.tags, skull: card.skull, location: card.id });
}

function doRoll(state: GameState, p: PlayerState): void {
  const t = state.turn!;
  let n = (t.baseDice ?? 0) + (t.meetingBonus ?? 0) + (t.assistDice ?? 0) + (t.powerDice ?? 0);
  if (t.usedToken) n += worldMods(state).some((m) => m.kind === "sparkTokenDouble") ? 2 : 1;
  p.nextRollDice = 0;
  t.dice = roll(state, Math.max(0, n));
  t.troubleDice = [];
  if (p.trouble.amount > 0 && p.trouble.rolls > 0) {
    t.troubleDice = roll(state, p.trouble.amount);
    p.trouble.rolls -= 1;
    if (p.trouble.rolls <= 0) p.trouble = { amount: 0, rolls: 0 };
  }
  t.pushed = false;
  t.successes = successesOf(state, p);
  // Lucky Button / Lucky Thimble: once per game, reroll the worst dice of a failed roll
  if (t.successes < (t.need ?? 0) && t.need! - t.successes <= 2) {
    const h = hooks(state, p, "reroll")[0];
    if (h && useOnce(state, p, "reroll")) {
      const order = t.dice.map((d, i) => [d, i]).sort((a, b) => a[0] - b[0]).slice(0, h.dice);
      for (const [, i] of order) t.dice[i] = d6(state);
      t.successes = successesOf(state, p);
      log(state, `${p.name} rerolls ${h.dice} ${h.dice === 1 ? "die" : "dice"} with a lucky charm.`);
    }
  }
  bump(p, "attempts");
  gstat(state, "attempts");
  const canPush = !has(state, p, "noPush") && !p.noPush;
  if (t.successes < (t.need ?? 0) && canPush) {
    t.step = "push";
    state.pending.push({
      player: p.id,
      kind: "push",
      data: { dice: [...t.dice], trouble: [...t.troubleDice], successes: t.successes, need: t.need },
    });
    return;
  }
  finishRoll(state, p);
}

function successesOf(state: GameState, p: PlayerState): number {
  const t = state.turn!;
  const surge = p.surgeTurns > 0;
  const cancel = countSuccesses(t.troubleDice ?? [], false, dreaming(state));
  return Math.max(0, countSuccesses(t.dice!, surge, dreaming(state)) - cancel);
}

function doPush(state: GameState, p: PlayerState): void {
  const t = state.turn!;
  t.dice = [...t.dice!, ...roll(state, Content.rules.dice.pushDice)];
  t.pushed = true;
  t.successes = successesOf(state, p);
  bump(p, "pushes");
  gstat(state, "pushes");
  const card = Content.card[t.card!.card];
  record(state, p, { type: "push", tags: card.tags, location: card.id });
}

function finishRoll(state: GameState, p: PlayerState): void {
  const t = state.turn!;
  const { card, options } = turnOptions(state, p);
  const o = options[t.option!];
  const dice = t.dice!;
  const ok = (t.successes ?? 0) >= (t.need ?? 0);
  const sixes = dice.filter((d) => d === 6).length;
  if (p.heatReady && t.baseDice) {
    p.heatReady = false;
    p.heat = 0;
  }
  // Fire's Heat is snuffed out at Swamp locations
  if (has(state, p, "heat") && !card.tags.includes("swamp")) addHeat(p, sixes);
  log(
    state,
    `${p.name} at ${card.name} tries ${o.name} (${t.stat}, ${dice.length} dice${t.pushed ? ", pushed" : ""}): ${[...dice].sort((a, b) => b - a).join(" ")}${t.troubleDice?.length ? ` with Trouble ${t.troubleDice.join(" ")}` : ""}. ${ok ? "Success!" : "Fail."}`,
  );
  record(state, p, { type: "roll", sixes, location: card.id });
  // mishap
  let mishap = isMishap(dice, dreaming(state));
  if (mishap && useOnce(state, p, "ignoreMishapOnce")) mishap = false;
  t.successes = t.successes ?? 0;
  (t as any).ok = ok;
  (t as any).mishap = mishap;
  (t as any).spark = ok && sparkTriggered(state, dice, card, o.sparkNeeds);
  state.lastRoll = {
    seq: (state.lastRoll?.seq ?? 0) + 1,
    player: p.id,
    card: card.id,
    option: o.name,
    stat: t.stat!,
    dice: [...dice],
    trouble: [...(t.troubleDice ?? [])],
    need: t.need ?? 0,
    successes: t.successes ?? 0,
    ok,
    pushed: !!t.pushed,
    spark: (t as any).spark,
    mishap,
  };
  if (mishap) {
    bump(p, "mishaps");
    gstat(state, "mishaps");
    record(state, p, { type: "mishap", location: card.id });
    if (p.ingredients > 0 && hasPower(p, "forager")) {
      p.ingredients -= 1;
      log(state, `The Mishap eats one of ${p.name}'s ingredients.`);
    }
    if (has(state, p, "mishapToLesson")) addLessons(state, p, t.stat!, 1);
    else {
      const times = has(state, p, "mishapDouble") ? 2 : 1;
      for (let i = 0; i < times; i++) {
        if (has(state, p, "mishapBurnsItem") && p.items.length) loseRandomItem(state, p);
        else apply(state, p, card.mishap?.effects ?? Content.rules.mishapDefault, { foundTags: card.tags, foundSkull: card.skull });
      }
    }
  }
  if (!o.alt) tell(state, { kind: "scene", player: p.id, card: card.id, option: o.name, outcome: ok ? "success" : "fail", spark: (t as any).spark, mishap });
  if (o.alt) {
    resolveAlt(state, p, o.alt, ok);
    if (ok) recordSuccess(state, p, card, o, false);
    t.step = "quick";
    return;
  }
  if (!ok) {
    apply(state, p, o.fail, { foundTags: card.tags, foundSkull: card.skull, location: card.id });
    t.step = "quick";
    return;
  }
  bump(p, "successes");
  gstat(state, "successes");
  addLessons(state, p, t.stat!, Content.rules.lessons.perSuccess);
  if (o.success.length) {
    t.step = "reward";
    state.pending.push({ player: p.id, kind: "reward", data: { option: o.name, stat: t.stat, spark: (t as any).spark } });
    return;
  }
  takeReward(state, p, false);
}

function resolveAlt(state: GameState, p: PlayerState, alt: string, ok: boolean): void {
  if (alt.startsWith("scatter:")) {
    const id = alt.slice("scatter:".length);
    if (ok) {
      state.monsters = state.monsters.filter((m) => m.id !== id);
      apply(state, p, monsterDef(id).reward ?? [], { origin: "monster" });
      record(state, p, { type: "defeatMonster", monster: id });
      log(state, `${p.name} drives off ${monsterDef(id).name}.`);
    }
    return;
  }
  if (alt === "taproot-reach") {
    if (ok) {
      p.vpBonus += finaleHas(state, "taprootReach").vp;
      log(state, `${p.name} reaches the Taproot! (+8 VP)`);
    }
    return;
  }
  const def = Content.worldCard[alt];
  if (def?.altExplore) apply(state, p, ok ? def.altExplore.success : def.altExplore.fail, { origin: "world" });
}

function takeReward(state: GameState, p: PlayerState, lessonInstead: boolean, lessonStat?: Stat): void {
  const t = state.turn!;
  const { card, options } = turnOptions(state, p);
  const o = options[t.option!];
  const spark = (t as any).spark as boolean;
  const ctx = {
    foundTags: card.tags,
    foundSkull: card.skull,
    location: card.id,
    lessonStat: lessonStat ?? t.lessonStat,
    mult: finaleHas(state, "doubleRewards") && state.finalRound ? 2 : 1,
  };
  const replaces = spark && o.spark.some((e) => e.replaces);
  if (lessonInstead) {
    addLessons(state, p, t.stat!, Content.rules.lessons.instead);
    gstat(state, "lessonInstead");
    record(state, p, { type: "lessonInstead", stat: t.stat, tags: card.tags, skull: card.skull, location: card.id });
  } else {
    apply(state, p, replaces ? o.success.filter((e) => e.type !== "lessons") : o.success, ctx);
  }
  if (spark) {
    gstat(state, "sparks");
    apply(state, p, o.spark, ctx);
    record(state, p, { type: "spark", location: card.id });
  }
  for (const m of worldMods(state)) if (m.kind === "successCoin") p.coin += m.amount;
  forage(state, p, card.tags);
  const sky = finaleHas(state, "successItem");
  if (sky && state.finalRound) gainItem(state, p, sky.item, { foundTags: card.tags, foundSkull: card.skull, origin: "world" });
  recordSuccess(state, p, card, o, lessonInstead);
  t.step = "quick";
}

function recordSuccess(state: GameState, p: PlayerState, card: ExploreCard, o: ExploreOption, lessonInstead: boolean): void {
  const t = state.turn!;
  record(state, p, {
    type: "success",
    tags: card.tags,
    skull: card.skull,
    stat: t.stat,
    location: card.id,
    need: t.need,
    pushed: !!t.pushed,
    assisted: (t.assistDice ?? 0) > 0,
    usedItem: !!t.usedItem,
    duringMeeting: !!t.duringMeeting,
    teamUp: !!t.teamUp,
    mishap: !!(t as any).mishap,
    staminaSpent: t.staminaSpent ?? 0,
    lessonInstead,
    atTrappedLocation: state.trapHistory.includes(card.id),
    sprangTrap: !!t.sprangTrap,
    finaleAttempt: !!t.finaleAttempt,
    startHealth: t.startHealth,
    startStamina: t.startStamina,
    sixes: (t.dice ?? []).filter((d) => d === 6).length,
  });
}

// ---------------------------------------------------------------------------
// Quick actions, end of turn, end of round
// ---------------------------------------------------------------------------

function trapLimit(state: GameState, p: PlayerState): number {
  const h = hooks(state, p, "freeTraps")[0];
  return h ? h.max : Content.rules.traps.maxActive;
}

function trapCost(state: GameState, p: PlayerState): number {
  if (has(state, p, "freeTraps") || (p.log.freeTrap ?? 0) > 0) return 0;
  return Content.rules.traps.cost;
}

function quickData(state: GameState, p: PlayerState) {
  const mine = state.traps.filter((t) => t.owner === p.id).length;
  return {
    canTrap: mine < trapLimit(state, p) && p.stamina >= trapCost(state, p),
    trapCost: trapCost(state, p),
    canRations: !p.rationsUsed && p.coin >= Content.rules.rations.coin,
    usable: p.items.filter((i) => Content.item[i.id].power === "oneUse" || i.id === "taproot-fragment").map((i) => i.uid),
    cashable: treasures(p).filter((i) => !Content.item[i.id].cannotCash).map((i) => i.uid),
    powers: availablePowers(state, p, "quick"),
  };
}

function quickAction(state: GameState, p: PlayerState, a: Extract<Action, { kind: "quickAction" }>): void {
  for (const uid of a.cash ?? []) cashIn(state, p, uid);
  for (const uid of a.useItems ?? []) useItem(state, p, uid, { lessonStat: state.turn?.lessonStat, target: a.itemTargets?.[uid] ?? a.target });
  if (a.action === "power" && a.power) {
    if (!usePower(state, p, a.power, "quick")) log(state, `${p.name} can't use that power right now.`, [p.id]);
    return;
  }
  if (a.action === "rations" && !p.rationsUsed && p.coin >= Content.rules.rations.coin) {
    p.coin -= Content.rules.rations.coin;
    restoreStamina(p, Content.rules.rations.stamina);
    p.rationsUsed = true;
    bump(p, "rations");
  }
  if (a.action === "trap" && a.location && a.trapType && Content.card[a.location]) {
    const mine = state.traps.filter((t) => t.owner === p.id);
    const cost = trapCost(state, p);
    if (mine.length < trapLimit(state, p) && p.stamina >= cost && !state.traps.some((t) => t.location === a.location)) {
      p.stamina -= cost;
      if ((p.log.freeTrap ?? 0) > 0 && !has(state, p, "freeTraps")) p.log.freeTrap -= 1;
      state.traps.push({ owner: p.id, location: a.location, type: a.trapType } as Trap);
      gstat(state, "trapsSet");
      log(state, `${p.name} sets a ${a.trapType} at ${Content.card[a.location].name}.`, [p.id]);
      log(state, `${p.name} sets a trap somewhere.`);
      record(state, p, { type: "setTrap", trapType: a.trapType, location: a.location });
    }
  }
}

export function cashIn(state: GameState, p: PlayerState, uid: number): boolean {
  const it = p.items.find((i) => i.uid === uid);
  if (!it || !isTreasure(it) || Content.item[it.id].cannotCash) return false;
  removeItem(state, p, uid);
  const coin = itemCoin(it) + (has(state, p, "cashBonus") ? 1 : 0);
  p.coin += coin;
  log(state, `${p.name} cashes the ${Content.item[it.id].name} for ${coin} coin.`);
  record(state, p, { type: "cashIn", item: it.id });
  return true;
}

function endTurn(state: GameState): void {
  const t = state.turn;
  if (!t) return;
  const p = state.players[t.player];
  if (p.log.ambushedRound === state.round && !p.history.some((e) => e.type === "downed" && e.turn === p.turns)) {
    record(state, p, { type: "surviveAmbush" });
    p.log.ambushedRound = -1;
  }
  // frogs set before this turn end now; frogs from this turn last until the next one starts
  if (p.frog && !p.log.frogOwn) p.frog = false;
  p.log.frogOwn = p.frog ? 1 : 0;
  p.stink = false;
  p.haunted = 0;
  p.bet = false;
  if (p.surgeTurns > 0) p.surgeTurns -= 1;
  for (const c of [...p.companions]) {
    if (c.turnsLeft !== undefined) {
      c.turnsLeft -= 1;
      if (c.turnsLeft <= 0) {
        p.companions = p.companions.filter((x) => x !== c);
        log(state, `${Content.companion[c.id].name} wanders home.`);
      }
    }
  }
  if (t.card && !t.card.virtual) state.exploreDiscard.push(t.card);
  state.turn = null;
  state.turnIndex += 1;
  startTurn(state);
}

function endRound(state: GameState): void {
  state.turn = null;
  // The Swap: victims learn who did it
  for (const s of state.swaps) log(state, `It was ${state.players[s.thief].name} who swapped one of your items.`, [s.victim]);
  state.swaps = [];
  state.walls = state.walls.filter((w) => w.round > state.round);
  if (state.disguise && state.disguise.round <= state.round) state.disguise = null;
  if (state.sharedDream !== null && state.sharedDream <= state.round) state.sharedDream = null;
  endRoundMonsters(state);
  state.firstPlayer = (state.firstPlayer + 1) % state.players.length;
  if (state.finalRound) {
    finalFinale(state);
    state.phase = "finalGuess";
    state.collect = {};
    state.pending = state.players.map((p) => ({
      player: p.id,
      kind: "finalGuess",
      data: {
        rivals: rivals(state, p).map((q) => q.id),
        lineups: rivals(state, p).map((q) => ({ rival: q.id, missions: lineupFor(state, p, q) })),
        max: Content.rules.scoring.maxGuesses,
      },
    }));
    return;
  }
  const res = drawWorldCard(state);
  if (res.market) {
    state.phase = "market";
    state.pending = state.players.map((p) => ({ player: p.id, kind: "market", data: marketData(state, p) }));
    return;
  }
  startRound(state);
}

function marketData(state: GameState, p: PlayerState) {
  const m = state.market!;
  const def = Content.worldCard[m.merchant];
  return {
    merchant: m.merchant,
    stock: m.stock.map((s) => ({ uid: s.uid, id: s.id, price: s.price || price(state, p, s.id) })),
    auction: m.auction?.id ?? null,
    trade: def.trade ?? null,
    services: def.services ?? [],
    cashable: treasures(p).map((i) => i.uid),
  };
}

function openTrades(state: GameState): void {
  // drop offers that can no longer be honored
  while (state.tradeOffers.length) {
    const o = state.tradeOffers[0];
    state.phase = "trade";
    state.pending = [{ player: o.to, kind: "respondTrade", data: { ...o } }];
    return;
  }
  state.tradeOffers = [];
  startRound(state);
}

function executeTrade(state: GameState, o: GameState["tradeOffers"][number]): void {
  const a = state.players[o.from];
  const b = state.players[o.to];
  const has = (p: PlayerState, uids: number[], coin: number) => uids.every((u) => p.items.some((i) => i.uid === u && !Content.item[i.id].cannotTrade)) && p.coin >= coin;
  if (!has(a, o.give.items, o.give.coin) || !has(b, o.get.items, o.get.coin)) return;
  const move = (from: PlayerState, to: PlayerState, uids: number[], coin: number) => {
    for (const u of uids) {
      const it = removeItem(state, from, u);
      if (it) addItem(state, to, it);
    }
    from.coin -= coin;
    to.coin += coin;
  };
  move(a, b, o.give.items, o.give.coin);
  move(b, a, o.get.items, o.get.coin);
  gstat(state, "trades");
  log(state, `${a.name} and ${b.name} make a trade.`);
  record(state, a, { type: "trade", with: b.id });
  record(state, b, { type: "trade", with: a.id });
}

/**
 * The missions a player chooses between when guessing a rival's: the real one, the two the rival
 * turned down in the draft, and random others, shuffled. Built per guesser so lineups differ.
 */
export function lineupFor(state: GameState, guesser: PlayerState, rival: PlayerState): string[] {
  const size = Content.rules.scoring.lineupSize;
  const real = rival.mission!;
  const declined = (state.missionOptions[rival.id] ?? []).filter((m) => m !== real);
  const pool = Content.missions.map((m) => m.id).filter((m) => m !== real && !declined.includes(m) && m !== guesser.mission);
  const extra = sample(state, pool, Math.max(0, size - 1 - declined.length));
  return shuffle(state, [real, ...declined, ...extra].slice(0, size));
}

function finalFinale(state: GameState): void {
  const boss = finaleHas(state, "boss");
  if (boss) {
    const hits: Record<number, number> = {};
    for (const p of state.players) {
      const stat = (boss.stats as Stat[]).reduce((a, b) => (p.stats[b] > p.stats[a] ? b : a));
      hits[p.id] = roll(state, p.stats[stat]).filter((d) => d >= 5).length;
      p.vpBonus += hits[p.id] * boss.vpPerSuccess;
    }
    const best = Math.max(...Object.values(hits));
    if (best > 0) {
      const top = state.players.filter((p) => hits[p.id] === best);
      const killer = pick(state, top);
      killer.vpBonus += boss.killBonus;
      log(state, `${killer.name} lands the killing blow on the Dragon!`);
      record(state, killer, { type: "defeatMonster", monster: "the-dragon" });
    }
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function score(state: GameState): void {
  const R = Content.rules;
  const mult = finaleHas(state, "guessMultiplier")?.amount ?? 1;
  // guesses first: the Shadow Broker's finale depends on them
  for (const p of state.players) {
    let correct = 0;
    let teamedUpCorrect = false;
    for (const [rid, mid] of Object.entries(p.guesses ?? {})) {
      const q = state.players[Number(rid)];
      if (q && q.id !== p.id && q.mission === mid) {
        correct++;
        if (p.history.some((e) => e.type === "meetingChoice") && p.log.teamUpWith === q.id) teamedUpCorrect = true;
      }
    }
    p.log.correctGuesses = correct;
    record(state, p, { type: "finalGuess", correct, teamedUpCorrect });
  }
  const bonus = finaleScoring(state);
  const lines: ScoreLine[] = state.players.map((p) => {
    const m = p.mission ? Content.mission[p.mission] : null;
    const vp = m ? ((R.missions.vp as any)[m.tier] as number[]) : [0, 0, 0, 0];
    const flourish = !!(m?.flourish.condition && endCheck(state, p, m.flourish.condition));
    p.flourishDone = flourish;
    const missionVp =
      p.claimed.reduce((s, i) => s + vp[i], 0) +
      (p.finaleDone ? vp[3] : 0) +
      (flourish ? R.missions.flourishVp : 0) +
      (p.firstFinisher ? R.missions.firstFinisherVp : 0);
    const tvp = treasureVp(p);
    const frag = p.items.filter((i) => i.id === "taproot-fragment").length * R.scoring.unusedFragmentVp;
    const guessVp = (p.log.correctGuesses ?? 0) * R.scoring.guessVp * mult;
    const bonusVp = p.vpBonus + (bonus[p.id] ?? 0);
    return {
      player: p.id,
      name: p.name,
      cls: p.cls,
      mission: p.mission,
      tier: m?.tier ?? 0,
      milestones: p.claimed.length,
      finale: p.finaleDone,
      flourish,
      first: p.firstFinisher,
      missionVp,
      treasureVp: tvp,
      guessVp,
      fragmentVp: frag,
      bonusVp,
      total: missionVp + tvp + guessVp + frag + bonusVp,
      coin: p.coin,
      correctGuesses: p.log.correctGuesses ?? 0,
    };
  });
  state.scores = lines;
  const best = Math.max(...lines.map((l) => l.total));
  const top = lines.filter((l) => l.total === best);
  const coin = Math.max(...top.map((l) => l.coin));
  state.winner = top.filter((l) => l.coin === coin).map((l) => l.player);
  state.phase = "over";
  state.pending = [];
  log(state, `Game over. ${state.winner.map((w) => state.players[w].name).join(" and ")} win${state.winner.length > 1 ? "" : "s"} with ${best} VP.`);
}

export { itemVp, makeFrog, FINALE };

/** The character sheet to carry into the next game: grown stats, leftover Lessons, quirks. */
export function exportCharacter(state: GameState, player: number): import("./types.js").CharacterSheet {
  const p = state.players[player];
  return {
    name: p.name,
    species: p.species,
    stats: { ...p.baseStats },
    lessons: { ...p.lessons },
    quirks: p.quirks.map((q) => ({ ...q })),
    heirlooms: p.items.filter((i) => i.carriedOver).map(heirloomId),
  };
}
