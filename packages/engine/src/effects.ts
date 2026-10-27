import { Content } from "./content.js";
import { checkMission, eventMeets, missionTags } from "./missions.js";
import {
  addItem,
  bump,
  companionLimit,
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
import { d6, int, pick, shuffle } from "./rng.js";
import type { Effect, GameEvent, GameState, ItemInstance, PlayerState, Stat, StoryBeat, Tag } from "./types.js";
import { STATS } from "./types.js";
import { moveFinale } from "./world.js";

// ---------------------------------------------------------------------------
// Logging and events
// ---------------------------------------------------------------------------

export function tell(state: GameState, beat: DistributiveOmit<StoryBeat, "seq" | "round">): void {
  (state.story ??= []).push({ ...beat, seq: (state.story.at(-1)?.seq ?? 0) + 1, round: state.round } as StoryBeat);
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export function log(state: GameState, text: string, privateTo?: number[]): void {
  state.log.push({ round: state.round, text, ...(privateTo ? { private: privateTo } : {}) });
}

/** Record a game event for a player, then check their mission and any open Rumors. */
export function record(state: GameState, p: PlayerState, ev: Omit<GameEvent, "round" | "turn">): GameEvent {
  const full: GameEvent = { ...ev, round: state.round, turn: p.turns } as GameEvent;
  p.history.push(full);
  const res = checkMission(state, p, full);
  for (const i of res.milestones) {
    log(state, `${p.name} claims a milestone: ${Content.mission[p.mission!].milestones[i].text}.`, [p.id]);
    tell(state, { kind: "mission", player: p.id, mission: p.mission!, part: i as 0 | 1 | 2, private: [p.id] });
    bump(p, "milestones");
  }
  if (res.finale) {
    log(state, `${p.name} completes the finale of ${Content.mission[p.mission!].name}!`, [p.id]);
    tell(state, { kind: "mission", player: p.id, mission: p.mission!, part: "finale", private: [p.id] });
    if (state.firstFinisher === null) {
      state.firstFinisher = p.id;
      p.firstFinisher = true;
      state.stats.firstFinishRound = state.round;
      log(state, `${p.name} is the first to complete a mission. The Finale moves up!`);
      moveFinale(state);
    }
  }
  checkRumors(state, p, full);
  return full;
}

function checkRumors(state: GameState, p: PlayerState, ev: GameEvent): void {
  for (const r of [...state.rumors]) {
    const def = Content.worldCard[r.id];
    if (!def?.claim) continue;
    const c = def.claim;
    const matches =
      c.event === "roll" ? ev.type === "roll" && (ev.sixes ?? 0) >= (c.minSixes ?? 2) : eventMeets(state, p, c, ev);
    if (!matches) continue;
    state.rumors = state.rumors.filter((x) => x !== r);
    gstat(state, "rumorsClaimed");
    log(state, `${p.name} claims the Rumor "${def.name}".`);
    if (r.id === "squirrel-heist") {
      for (const it of state.squirrelStash) addItem(state, p, { ...it, origin: "world" });
      state.squirrelStash = [];
    } else {
      apply(state, p, def.reward ?? [], { foundTags: ev.tags ?? [], foundSkull: ev.skull ?? 0, origin: "rumor" });
    }
  }
}

// ---------------------------------------------------------------------------
// Applying effects
// ---------------------------------------------------------------------------

export interface EffectCtx {
  foundTags?: Tag[];
  foundSkull?: number;
  location?: string;
  lessonStat?: Stat;
  origin?: ItemInstance["origin"];
  /** The Great Harvest: rewards count double. */
  mult?: number;
  /** Did the player choose to take the bet on this option? */
  bet?: boolean;
}

export interface EffectResult {
  items: ItemInstance[];
  treasure: boolean;
  companion: boolean;
}

export function newItem(state: GameState, id: string, ctx: EffectCtx = {}): ItemInstance {
  const inst: ItemInstance = {
    uid: ++state.uid,
    id,
    foundTags: ctx.foundTags ?? [],
    foundSkull: ctx.foundSkull ?? 0,
    origin: ctx.origin ?? "explore",
  };
  if (id === "taproot-fragment") {
    const drawn = new Set(state.players.flatMap((q) => q.items.map((i) => i.fragment).filter(Boolean)));
    const left = Content.fragments.filter((f) => !drawn.has(f.id));
    inst.fragment = pick(state, left.length ? left : Content.fragments).id;
  }
  return inst;
}

function treasureBonus(state: GameState, inst: ItemInstance): void {
  if (!isTreasure(inst)) return;
  let vp = 0;
  let coin = 0;
  for (const m of worldMods(state)) {
    if (m.kind !== "treasureBonus") continue;
    if (m.minSkull && inst.foundSkull < m.minSkull) continue;
    if (m.tags && !inst.foundTags.some((t) => m.tags.includes(t))) continue;
    vp += m.vp ?? 0;
    coin += m.coin ?? 0;
  }
  if (vp) inst.bonusVp = vp;
  if (coin) inst.bonusCoin = coin;
}

export function gainItem(state: GameState, p: PlayerState, id: string, ctx: EffectCtx = {}): ItemInstance | null {
  const def = Content.item[id];
  if (!def) throw new Error(`unknown item ${id}`);
  if (def.unique && state.takenUniques.includes(id)) return null;
  const inst = newItem(state, id, ctx);
  if (ctx.origin === "explore" || ctx.origin === undefined) treasureBonus(state, inst);
  if (!addItem(state, p, inst)) {
    log(state, `${p.name} can't carry the ${def.name}.`);
    return null;
  }
  if (id !== "taproot-fragment") log(state, `${p.name} gains the ${def.name}.`);
  if (id === "taproot-fragment") {
    gstat(state, "fragments");
    log(state, `${p.name} finds a Taproot Fragment. It whispers: "${Content.fragment[inst.fragment!].whisper}"`, [p.id]);
  }
  return inst;
}

export function gainCompanion(state: GameState, p: PlayerState, id: string, tags: Tag[] = []): boolean {
  if (p.companions.some((c) => c.id === id)) return false;
  if (p.companions.length >= companionLimit(state, p)) {
    log(state, `${p.name} has no room for another companion.`);
    return false;
  }
  const def = Content.companion[id];
  p.companions.push({ id, ...(def.turns ? { turnsLeft: def.turns } : {}) });
  gstat(state, "companions");
  log(state, `${p.name} befriends ${def.name}.`);
  record(state, p, { type: "befriend", tags, companion: id });
  return true;
}

export function companionFlees(state: GameState, p: PlayerState, id?: string): void {
  if (!p.companions.length) return;
  const c = id ? p.companions.find((x) => x.id === id) : pick(state, p.companions);
  if (!c) return;
  p.companions = p.companions.filter((x) => x !== c);
  log(state, `${Content.companion[c.id].name} flees from ${p.name}.`);
  record(state, p, { type: "companionFled", companion: c.id });
}

export function addLessons(state: GameState, p: PlayerState, stat: Stat, n: number): void {
  p.lessons[stat] += n;
  record(state, p, { type: "lesson", stat, amount: n });
  const per = Content.rules.lessons.perStat;
  while (
    p.lessons[stat] >= per &&
    p.grownThisGame < Content.rules.lessons.maxGrowthPerGame &&
    p.stats[stat] < Content.rules.character.statCap
  ) {
    p.lessons[stat] -= per;
    p.stats[stat] += 1;
    p.baseStats[stat] += 1;
    p.grownThisGame += 1;
    p.growth.push(stat);
    log(state, `${p.name}'s ${stat} grows permanently to ${p.stats[stat]}!`);
    record(state, p, { type: "statGrowth", stat });
  }
}

/** The stat a player's "any stat" Lessons go to when they don't say. */
export function growthStat(p: PlayerState, preferred?: Stat): Stat {
  if (preferred) return preferred;
  const cap = Content.rules.character.statCap;
  return [...STATS].sort((a, b) => {
    const ca = p.stats[a] < cap ? 1 : 0;
    const cb = p.stats[b] < cap ? 1 : 0;
    return cb - ca || p.lessons[b] - p.lessons[a] || p.stats[b] - p.stats[a];
  })[0];
}

export function heal(state: GameState, p: PlayerState, n: number | "all"): void {
  const before = p.health;
  p.health = n === "all" ? p.maxHealth : Math.min(p.maxHealth, p.health + n);
  if (p.health > before) record(state, p, { type: "heal", amount: p.health - before });
}

export function restoreStamina(p: PlayerState, n: number | "all"): void {
  p.stamina = n === "all" ? p.maxStamina : Math.min(p.maxStamina, p.stamina + n);
}

export function loseStamina(state: GameState, p: PlayerState, n: number): void {
  p.stamina = Math.max(0, p.stamina - n);
}

export function damage(state: GameState, p: PlayerState, n: number, source: "explore" | "brawl" | "monster" | "trap" | "other" = "other"): void {
  if (n <= 0) return;
  if (source === "brawl" && has(state, p, "noBrawlDamage")) return;
  if (source === "brawl" && n >= 1 && useOnce(state, p, "ignoreBrawlDamageOnce")) {
    log(state, `${p.name} shrugs off the blow.`);
    return;
  }
  if (source === "monster") n += worldMods(state).filter((m) => m.kind === "monsterDamage").reduce((s, m) => s + m.amount, 0);
  if (has(state, p, "ignoreFirstDamageEachTurn") && !p.rootedUsed) {
    p.rootedUsed = true;
    n -= 1;
    if (n <= 0) return;
  }
  // "Ignore all damage from one source": save it for a hit that would hurt.
  if ((n >= 2 || p.health - n <= 0) && useOnce(state, p, "ignoreDamageOnce")) {
    log(state, `${p.name} ignores the damage.`);
    return;
  }
  p.health -= n;
  p.damageThisTurn += n;
  bump(p, "damageTaken", n);
  for (const h of hooks(state, p, "fleesOnDamage")) {
    if (p.damageThisTurn >= h.amount) {
      if (h.source === "class") companionFlees(state, p);
      else if (h.source.startsWith("companion:")) companionFlees(state, p, h.source.slice("companion:".length));
    }
  }
  if (p.health <= 0) downed(state, p);
}

export function downed(state: GameState, p: PlayerState): void {
  bump(p, "downed");
  gstat(state, "downed");
  if (!has(state, p, "keepItemWhenDowned")) {
    const it = randomStealable(state, p, false);
    if (it) {
      removeItem(state, p, it.uid);
      const loc = state.turn?.card ? state.turn.card.card : "nowhere";
      (state.dropped[loc] ??= []).push({ ...it, origin: "dropped" });
    }
  }
  p.skipExplore = true;
  p.log.downedPending = 1;
  p.health = Math.ceil(p.maxHealth / 2);
  log(state, `${p.name} is Downed: drops an item and will skip their next explore.`);
  record(state, p, { type: "downed" });
}

/** Squirrelfolk keep their most valuable item safe from thieves. */
function protectedUid(state: GameState, p: PlayerState): number | null {
  if (!has(state, p, "protectOneItem") || !p.items.length) return null;
  return [...p.items].sort((a, b) => itemValue(b) - itemValue(a))[0].uid;
}

function randomStealable(state: GameState, p: PlayerState, forTheft: boolean): ItemInstance | null {
  const safe = forTheft ? protectedUid(state, p) : null;
  const pool = p.items.filter((i) => {
    const d = Content.item[i.id];
    if (d.cannotSteal || d.type === "relic") return false;
    if (forTheft && (i.protected || i.uid === safe)) return false;
    return true;
  });
  return pool.length ? pick(state, pool) : null;
}

export function loseRandomItem(state: GameState, p: PlayerState): ItemInstance | null {
  const it = randomStealable(state, p, false);
  if (it) {
    removeItem(state, p, it.uid);
    log(state, `${p.name} loses the ${Content.item[it.id].name}.`);
  }
  return it;
}

/** Steal by Brawl, Pickpocket trap, or card effect. */
export function steal(state: GameState, thief: PlayerState, victim: PlayerState, how: "brawl" | "trap" | "card"): string {
  if (victim.untargetable) return `${victim.name} can't be targeted`;
  let it: ItemInstance | null = null;
  if (!(how === "brawl" && has(state, victim, "brawlTheftImmune"))) {
    const safe = protectedUid(state, victim);
    const pool = victim.items.filter((i) => !Content.item[i.id].cannotSteal && Content.item[i.id].type !== "relic" && !i.protected && i.uid !== safe);
    if (pool.length) {
      it = has(state, thief, "chooseStolenItem")
        ? pool.sort((a, b) => itemValue(b) - itemValue(a))[0]
        : pick(state, pool);
    }
  }
  record(state, thief, { type: "steal", how });
  if (it) {
    removeItem(state, victim, it.uid);
    it.stolen = true;
    addItem(state, thief, it);
    record(state, victim, { type: "stolenFrom", how });
    gstat(state, "steals");
    return `steals the ${Content.item[it.id].name}`;
  }
  if (victim.coin > 0) {
    const amt = Math.min(victim.coin, d6(state));
    victim.coin -= amt;
    thief.coin += amt;
    record(state, victim, { type: "stolenFrom", how });
    return `steals ${amt} coin`;
  }
  damage(state, victim, 1, "other");
  return `finds nothing, and ${victim.name} takes 1 damage`;
}

export function itemValue(it: ItemInstance): number {
  const d = Content.item[it.id];
  return (d?.vp ?? 0) + (it.bonusVp ?? 0) + (d?.type === "gear" ? 2 : 0) + (it.id === "taproot-fragment" ? 6 : 0);
}

export function itemVp(it: ItemInstance): number {
  if (!isTreasure(it)) return 0;
  return Content.item[it.id].vp + (it.bonusVp ?? 0);
}

export function itemCoin(it: ItemInstance): number {
  return Content.item[it.id].coin + (it.bonusCoin ?? 0);
}

export function learnRivalTag(state: GameState, p: PlayerState, target?: PlayerState): void {
  const pool = rivals(state, p).filter((q) => q.mission);
  if (!pool.length) return;
  // learn about the rival you know least about
  const q =
    target ??
    shuffle(state, pool).sort((a, b) => (p.intel[a.id]?.length ?? 0) - (p.intel[b.id]?.length ?? 0))[0];
  const tags = missionTags(q.mission!);
  const known = (p.intel[q.id] ??= []);
  const unknown = tags.filter((t) => !known.includes(t));
  const t = unknown.length ? pick(state, unknown) : pick(state, tags);
  if (!known.includes(t)) known.push(t);
  gstat(state, "intel");
  log(state, `${p.name} learns that ${q.name}'s mission involves ${t}.`, [p.id]);
  record(state, p, { type: "learnTag", rival: q.id, tag: t });
}

export function makeFrog(state: GameState, p: PlayerState): void {
  if (has(state, p, "frogImmune")) return;
  if (!p.frog) {
    p.frog = true;
    p.log.frogOwn = state.turn?.player === p.id ? 1 : 0;
    gstat(state, "frogs");
    log(state, `${p.name} is a frog until their next turn.`);
  }
  record(state, p, { type: "frog" });
}

export function randomItemOfRarity(state: GameState, rarity: string, filter: (id: string) => boolean = () => true): string | null {
  const pool = Content.items.filter(
    (i) => i.rarity === rarity && !i.unique && i.id !== "taproot-fragment" && i.id !== "fallen-star" && !i.carryover && filter(i.id),
  );
  return pool.length ? pick(state, pool).id : null;
}

/** Apply a list of effects. Treasure and companion gains are reported for missions. */
export function apply(state: GameState, p: PlayerState, effects: Effect[], ctx: EffectCtx = {}): EffectResult {
  const res: EffectResult = { items: [], treasure: false, companion: false };
  const mult = ctx.mult ?? 1;
  const gotItem = (inst: ItemInstance | null) => {
    if (!inst) return;
    res.items.push(inst);
    if (isTreasure(inst) && (ctx.origin ?? "explore") === "explore") res.treasure = true;
  };
  for (const e of effects) {
    switch (e.type) {
      case "item": {
        for (let i = 0; i < mult; i++) {
          let id = e.item as string;
          if (Content.item[id].unique && state.takenUniques.includes(id)) {
            if (!e.ifTaken) continue;
            id = e.ifTaken;
          }
          gotItem(gainItem(state, p, id, ctx));
        }
        break;
      }
      case "fragment":
        gotItem(gainItem(state, p, "taproot-fragment", ctx));
        break;
      case "randomTreasure": {
        const id = randomItemOfRarity(state, pick(state, ["common", "uncommon"]), (x) => Content.item[x].type === "treasure");
        if (id) gotItem(gainItem(state, p, id, ctx));
        break;
      }
      case "randomRare": {
        const id = randomItemOfRarity(state, "rare");
        if (id) gotItem(gainItem(state, p, id, { ...ctx, origin: ctx.origin ?? "world" }));
        break;
      }
      case "coin":
        p.coin = Math.max(0, p.coin + e.amount * (e.amount > 0 ? mult : 1));
        break;
      case "lessons": {
        const stat: Stat = e.stat && e.stat !== "any" ? e.stat : growthStat(p, ctx.lessonStat);
        addLessons(state, p, stat, e.amount * mult);
        break;
      }
      case "companion":
        if (gainCompanion(state, p, e.companion, ctx.foundTags)) res.companion = true;
        break;
      case "learnRivalTag":
        learnRivalTag(state, p);
        break;
      case "revealOwnTag": {
        const q = pick(state, rivals(state, p));
        learnRivalTag(state, q, p);
        break;
      }
      case "heal":
        heal(state, p, e.amount);
        break;
      case "stamina":
        restoreStamina(p, e.amount);
        break;
      case "sparkTokens":
        p.sparkTokens += e.amount * mult;
        record(state, p, { type: "gainSparkToken", amount: e.amount });
        break;
      case "damage":
        damage(state, p, e.amount, "explore");
        break;
      case "loseStamina":
        loseStamina(state, p, e.amount);
        break;
      case "loseRandomItem":
        loseRandomItem(state, p);
        break;
      case "frog":
        makeFrog(state, p);
        break;
      case "peekWorld":
        p.seenWorld = Math.max(p.seenWorld, e.count ?? 1);
        log(state, `${p.name} sees the next ${e.count ?? 1} World card(s): ${state.worldDeck.slice(0, e.count ?? 1).map((id) => (id === "FINALE" ? "the Finale" : Content.worldCard[id].name)).join(", ")}.`, [p.id]);
        record(state, p, { type: "seeHidden", what: "world" });
        break;
      case "peekTeasers":
      case "peekNextTurn":
        p.peekTurns = Math.max(p.peekTurns, e.turns ?? 1);
        record(state, p, { type: "seeHidden", what: "teasers" });
        break;
      case "teasersNextTurn":
        p.teasersNext = e.count;
        break;
      case "skipExplore":
        p.skipExplore = true;
        break;
      case "trouble":
        p.trouble = { amount: p.trouble.amount + e.amount, rolls: Math.max(p.trouble.rolls, e.rolls ?? 1) };
        break;
      case "loseQuickAction":
        p.quickActionLost = true;
        break;
      case "freeTrap":
        p.log.freeTrap = (p.log.freeTrap ?? 0) + 1;
        break;
      case "stealFromMostItems": {
        const rs = rivals(state, p).filter((q) => q.items.length);
        if (rs.length) {
          const q = rs.sort((a, b) => b.items.length - a.items.length)[0];
          log(state, `${p.name} ${steal(state, p, q, "card")} from ${q.name}.`);
        }
        break;
      }
      case "untargetable":
        p.untargetable = true;
        break;
      case "quirk":
        if (!p.quirks.some((q) => q.name === e.name)) {
          p.quirks.push({ name: e.name, text: e.text, quirk: e.quirk });
          log(state, `${p.name} gains a permanent quirk: ${e.name} (${e.text}).`);
          record(state, p, { type: "quirk", name: e.name });
        }
        break;
      case "chance": {
        const r = d6(state);
        if (e.faces.includes(r)) apply(state, p, e.then, ctx);
        break;
      }
      case "bet":
        if (ctx.bet && p.coin >= e.cost) {
          p.coin -= e.cost;
          const r = d6(state);
          if (e.faces.includes(r)) apply(state, p, e.then, ctx);
          log(state, `${p.name} bets ${e.cost} coin and rolls a ${r}.`);
        }
        break;
      case "nextRollDice":
        p.nextRollDice += e.amount;
        break;
      case "brawlDice":
        p.brawlDice += e.amount;
        break;
      case "troubleRival": {
        const q = e.target !== undefined ? state.players[e.target] : pick(state, rivals(state, p));
        q.trouble = { amount: q.trouble.amount + e.amount, rolls: Math.max(q.trouble.rolls, 1) };
        break;
      }
      case "frogRival": {
        const q = e.target !== undefined ? state.players[e.target] : pick(state, rivals(state, p));
        makeFrog(state, q);
        break;
      }
      case "damageRivalHere": {
        const here = state.picks[p.id]?.card;
        const qs = rivals(state, p).filter((q) => state.picks[q.id]?.card === here);
        if (qs.length) damage(state, pick(state, qs), e.amount, "other");
        break;
      }
      case "companionFlees":
        companionFlees(state, p);
        break;
      case "permanentStat": {
        const st = ctx.lessonStat ?? growthStat(p);
        if (p.stats[st] < Content.rules.character.statCap) {
          p.stats[st] += 1;
          p.baseStats[st] += 1;
          record(state, p, { type: "statGrowth", stat: st, fragment: true });
        }
        break;
      }
      case "heatBonus":
        p.heat += e.amount;
        break;
      default:
        // Effects the engine doesn't automate yet are logged so playtesters can resolve them by hand.
        log(state, `(${p.name}: "${e.type}" must be resolved by hand.)`);
    }
  }
  if (res.treasure) {
    const r = res.items.find(isTreasure)!;
    record(state, p, { type: "treasure", tags: r.foundTags, skull: r.foundSkull, item: r.id, location: ctx.location });
    // The Mimic Chest hunts the next player who finds a treasure
    const mimic = state.monsters.find((m) => m.id === "the-mimic-chest" && m.targets.length === 0);
    if (mimic) {
      mimic.targets = [p.id];
      p.log.mimicTreasure = r.uid;
    }
  }
  return res;
}

/** Use a one-use item from a player's pack. Returns false if it can't be used now. */
export function useItem(state: GameState, p: PlayerState, uid: number, ctx: EffectCtx = {}): boolean {
  const it = p.items.find((i) => i.uid === uid);
  if (!it) return false;
  if (it.id === "taproot-fragment") return useFragment(state, p, it, ctx);
  const def = Content.item[it.id];
  if (def.power !== "oneUse" || !def.use) return false;
  removeItem(state, p, uid);
  log(state, `${p.name} uses the ${def.name}.`);
  bump(p, "itemsUsed");
  apply(state, p, def.use, { ...ctx, origin: "world" });
  if (def.type === "gear" || def.type === "food") record(state, p, { type: "useItem", item: it.id });
  else record(state, p, { type: "useItem", item: it.id });
  return true;
}

export function useFragment(state: GameState, p: PlayerState, it: ItemInstance, ctx: EffectCtx = {}): boolean {
  const f = Content.fragment[it.fragment ?? ""] ?? Content.fragments[0];
  removeItem(state, p, it.uid);
  p.noPush = true;
  gstat(state, "fragmentsUsed");
  log(state, `${p.name} uses a Taproot Fragment: ${f.name}! ${f.text}.`);
  record(state, p, { type: "useItem", item: it.id, fragment: f.id });
  switch (f.effect.type) {
    case "claimMilestone": {
      const m = p.mission ? Content.mission[p.mission] : null;
      const i = m ? [0, 1, 2].find((x) => !p.claimed.includes(x)) : undefined;
      if (i !== undefined) {
        p.claimed.push(i);
        if (p.claimed.length === 3) p.log.allClaimedAt = p.history.length;
      }
      break;
    }
    case "revealAllMissions":
      for (const q of rivals(state, p)) if (q.mission) p.knownMissions[q.id] = q.mission;
      record(state, p, { type: "seeHidden", what: "missions" });
      break;
    case "rearrangeWorld":
      // Bots and the prototype keep the order but see everything.
      p.seenWorld = state.worldDeck.length;
      record(state, p, { type: "seeHidden", what: "world" });
      break;
    case "swapPacks": {
      const q = rivals(state, p).sort((a, b) => b.items.reduce((s, i) => s + itemValue(i), 0) - a.items.reduce((s, i) => s + itemValue(i), 0))[0];
      if (q) [p.items, q.items] = [q.items, p.items];
      recomputeMax(state, p);
      if (q) recomputeMax(state, q);
      break;
    }
    case "surge":
      p.surgeTurns = f.effect.turns ?? 3;
      break;
    case "permanentStat":
      apply(state, p, [{ type: "permanentStat" }], ctx);
      break;
    case "rewild":
      state.traps = [];
      state.sealed = [];
      p.log.freeTrap = (p.log.freeTrap ?? 0) + 2;
      break;
    case "chooseAnyCard":
      p.nextRollDice += f.effect.dice ?? 3;
      p.teasersNext = 5;
      break;
  }
  return true;
}

export function treasureVp(p: PlayerState): number {
  return treasures(p).reduce((s, t) => s + itemVp(t), 0);
}

export { int };
