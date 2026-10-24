/**
 * Heuristic bots, ported from the Playtest 1-4 simulator and extended to every
 * decision the engine asks for. They are deliberately simple: good enough to
 * stress the rules and produce balance numbers, not to play well.
 */
import { Content } from "./content.js";
import { allowedStats, dicePool, needFor, staminaFor } from "./dice.js";
import { itemValue, itemVp } from "./effects.js";
import { turnOptions } from "./engine.js";
import { missionGain, missionNever, missionTags, missionWants } from "./missions.js";
import { has, hooks, isTreasure, treasures } from "./player.js";
import { pAtLeast } from "./rng.js";
import type {
  Action,
  BotPersona,
  Decision,
  Effect,
  ExploreCard,
  ExploreOption,
  GameEvent,
  GameState,
  PlayerState,
  Stat,
  Tag,
} from "./types.js";
import { STATS } from "./types.js";

/** Bot randomness that never touches the game's RNG, so bots don't change replays. */
function noise(state: GameState, p: PlayerState, salt: number): number {
  let h = (state.rng ^ Math.imul(p.id + 1, 0x9e3779b1) ^ Math.imul(salt + state.uid, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function persona(p: PlayerState): BotPersona {
  return p.bot ?? "balanced";
}

export function botAction(state: GameState, d: Decision): Action {
  const p = state.players[d.player];
  switch (d.kind) {
    case "chooseClass":
      return { player: p.id, kind: "chooseClass", cls: chooseClass(state, p, d.data.options) };
    case "chooseMission":
      return { player: p.id, kind: "chooseMission", mission: chooseMission(state, p, d.data.options) };
    case "pickTeaser":
      return { player: p.id, kind: "pickTeaser", card: pickTeaser(state, p, d.data.cards) };
    case "meetingChoice":
      return { player: p.id, kind: "meetingChoice", choice: meetingChoice(state, p) };
    case "monsterChoice":
      return { player: p.id, kind: "monsterChoice", option: monsterChoice(state, p, d.data.options) };
    case "chooseOption":
      return chooseOption(state, p, d);
    case "assistOffer":
      return { player: p.id, kind: "assistOffer", dice: assist(state, p, d) };
    case "push":
      return { player: p.id, kind: "push", push: wantPush(state, p, d) };
    case "reward":
      return { player: p.id, kind: "reward", lessonInstead: lessonInstead(state, p) };
    case "quickAction":
      return quickAction(state, p, d);
    case "market":
      return market(state, p, d);
    case "respondTrade":
      return { player: p.id, kind: "respondTrade", accept: respondTrade(state, p, d) };
    case "finalGuess":
      return { player: p.id, kind: "finalGuess", guesses: guess(state, p) };
  }
}

// ---------------------------------------------------------------------------

function chooseClass(state: GameState, p: PlayerState, options: string[]): string {
  let best = options[0];
  let bestScore = -Infinity;
  options.forEach((id, i) => {
    const mods = Content.cls[id].statMods ?? {};
    let s = noise(state, p, i) * 2;
    for (const [st, v] of Object.entries(mods)) s += (v as number) * (p.stats[st as Stat] >= 3 ? 1.2 : 0.6);
    if (s > bestScore) [best, bestScore] = [id, s];
  });
  return best;
}

function chooseMission(state: GameState, p: PlayerState, options: string[]): string {
  const pref = { cautious: [1.2, 1, 0.7], aggressive: [0.8, 1, 1.2], friendly: [1.1, 1, 0.8], balanced: [1, 1, 1] }[persona(p)];
  let best = options[0];
  let bestScore = -Infinity;
  options.forEach((id, i) => {
    const m = Content.mission[id];
    let s = pref[m.tier - 1] + noise(state, p, 10 + i) * 0.6;
    // favor missions whose stat requirements match strengths
    const text = JSON.stringify(m.milestones.map((x) => x.condition)) + JSON.stringify(m.finale.condition);
    for (const st of STATS) if (text.includes(`"${st}"`)) s += (p.stats[st] - 2.5) * 0.15;
    if (s > bestScore) [best, bestScore] = [id, s];
  });
  return best;
}

// --- valuing effects (mirrors the Python simulator) -------------------------

function val(state: GameState, p: PlayerState, effs: Effect[]): number {
  let v = 0;
  for (const e of effs) {
    switch (e.type) {
      case "item": {
        const d = Content.item[e.item];
        if (d.unique && state.takenUniques.includes(e.item) && !e.ifTaken) break;
        v += d.vp + 0.1 * d.coin + (d.type === "gear" ? 0.8 : 0) + (d.power === "oneUse" ? 0.4 : 0);
        if (e.item === "the-sunken-crown" && p.mission === "the-drowned-kings-crown") v += 6;
        break;
      }
      case "fragment":
        v += 6;
        break;
      case "coin":
        v += 0.25 * e.amount;
        break;
      case "lessons":
        v += 0.3 * e.amount;
        break;
      case "companion":
        v += p.companions.length < (has(state, p, "companionLimit") ? 3 : 2) ? 1.5 : 0.2;
        break;
      case "learnRivalTag":
        v += 0.6;
        break;
      case "heal":
        v += 0.45 * (e.amount === "all" ? p.maxHealth - p.health : Math.min(e.amount, p.maxHealth - p.health));
        break;
      case "stamina":
        v += 0.35 * (e.amount === "all" ? p.maxStamina - p.stamina : Math.min(e.amount, p.maxStamina - p.stamina));
        break;
      case "sparkTokens":
        v += 0.3 * e.amount;
        break;
      case "damage":
        v -= 0.6 * e.amount * (p.health - e.amount <= 0 ? 4 : 1);
        break;
      case "loseStamina":
        v -= 0.3 * e.amount;
        break;
      case "loseRandomItem":
        v -= p.items.length ? 1.5 : 0;
        break;
      case "frog":
        v -= missionWants(p, "frog") ? -2 : 0.8;
        break;
      case "skipExplore":
        v -= 2;
        break;
      case "peekWorld":
      case "peekTeasers":
        v += missionWants(p, "seeHidden") ? 3 : 0.3;
        break;
      case "teasersNextTurn":
        v += e.count > 2 ? 0.5 : -0.5;
        break;
      case "chance":
        v += val(state, p, e.then) * (e.faces.length / 6);
        break;
      case "quirk":
        v += missionWants(p, "quirk") ? 3 : 0.3;
        break;
      case "stealFromMostItems":
        v += 2;
        break;
    }
  }
  return v;
}

function hypothetical(state: GameState, p: PlayerState, card: ExploreCard, o: ExploreOption, stat: Stat | undefined, extra: Partial<GameEvent> = {}): GameEvent {
  return {
    type: o.rest ? "rest" : "success",
    round: state.round,
    turn: p.turns,
    tags: card.tags,
    skull: card.skull,
    stat,
    location: card.id,
    need: o.need,
    pushed: false,
    staminaSpent: o.stamina,
    startHealth: state.turn?.startHealth ?? p.health,
    startStamina: state.turn?.startStamina ?? p.stamina,
    duringMeeting: !!state.turn?.duringMeeting,
    teamUp: !!state.turn?.teamUp,
    atTrappedLocation: state.trapHistory.includes(card.id),
    sprangTrap: !!state.turn?.sprangTrap,
    ...extra,
  };
}

/** Mission VP from succeeding, including side events like finding a treasure or befriending. */
function gainFor(state: GameState, p: PlayerState, card: ExploreCard, o: ExploreOption, stat: Stat | undefined, finaleAttempt = false): number {
  let g = missionGain(state, p, hypothetical(state, p, card, o, stat, { finaleAttempt }));
  if (o.success.some((e) => e.type === "item" && isTreasure({ id: e.item } as any)))
    g += missionGain(state, p, { type: "treasure", round: state.round, turn: p.turns, tags: card.tags, skull: card.skull });
  if (o.success.some((e) => e.type === "companion"))
    g += missionGain(state, p, { type: "befriend", round: state.round, turn: p.turns, tags: card.tags });
  return g;
}

function optionEV(state: GameState, p: PlayerState, card: ExploreCard, o: ExploreOption, stat: Stat, bonus: number) {
  const need = o.rest ? 0 : needFor(state, card, o);
  const n = o.rest ? 0 : dicePool(state, p, card, o, stat).total + bonus;
  let ps = o.rest ? 1 : pAtLeast(n, need);
  let token = false;
  if (!o.rest && p.sparkTokens > 0 && ps < 0.55) {
    ps = pAtLeast(n + 1, need);
    token = true;
  }
  if (!o.rest && !has(state, p, "noPush") && !p.noPush) ps = Math.min(1, ps + 0.35 * (pAtLeast(n + 2 + (token ? 1 : 0), need) - ps));
  const cost = staminaFor(state, p, card, o, stat);
  const sparkP = o.rest ? 0 : 1 - (5 / 6) ** Math.max(n, 1);
  let ev = ps * (val(state, p, o.success) + sparkP * val(state, p, o.spark) * 0.6) + (1 - ps) * val(state, p, o.fail) - 0.3 * cost;
  ev += ps * gainFor(state, p, card, o, stat);
  if (o.rest) ev += 0.4 * Math.max(0, 2 - p.stamina) + 0.3 * Math.max(0, 3 - p.health);
  if (o.pay) ev -= 0.25 * o.pay;
  if (o.discardTreasure) ev -= Math.min(...treasures(p).map(itemVp), 3);
  return { ev, ps, token, need, n };
}

function pickTeaser(state: GameState, p: PlayerState, cards: { uid: number; card: string }[]): number {
  let best = cards[0].uid;
  let bestScore = -Infinity;
  cards.forEach((c, i) => {
    const card = Content.card[c.card];
    let s = noise(state, p, 20 + i) * 0.5;
    // teaser-level judgment: tags and skulls
    const m = p.mission ? Content.mission[p.mission] : null;
    if (m && card.tags.some((t) => m.path.includes(t))) s += 1.5;
    s += card.skull * (p.health >= 4 && p.stamina >= 3 ? 0.4 : -0.8);
    if (persona(p) === "cautious") s -= 0.3 * card.skull;
    // plus a look at the best option (players learn the cards quickly)
    const opts = card.options.map((o) => Math.max(...(o.rest ? [optionEV(state, p, card, o, "brawn", 0).ev] : o.stats.map((st) => optionEV(state, p, card, o, st, 0).ev))));
    s += 0.6 * Math.max(...opts);
    if (state.traps.some((t) => t.location === card.id && t.owner === p.id)) s -= 0.5;
    if (state.monsters.some((mo) => mo.id === "the-bog-troll-king") && card.region === "swamp") s -= 0.7;
    if (state.monsters.some((mo) => mo.id === "the-hollow-knight") && card.region === "ruins") s -= 0.7;
    if (s > bestScore) [best, bestScore] = [c.uid, s];
  });
  return best;
}

function meetingChoice(state: GameState, p: PlayerState): "ally" | "brawl" | "pass" {
  if (missionWants(p, "meetingChoice", { choice: "ally" }) || missionWants(p, "success", { teamUp: true } as any)) return "ally";
  if (missionWants(p, "meetingChoice", { choice: "brawl" }) || (missionWants(p, "winBrawl") && p.stats.brawn >= 3)) return "brawl";
  if (missionWants(p, "meetingChoice", { choice: "pass" })) return "pass";
  const w = { friendly: [0.6, 0.15, 0.25], aggressive: [0.2, 0.6, 0.2], cautious: [0.3, 0.1, 0.6], balanced: [0.45, 0.3, 0.25] }[persona(p)];
  if (missionNever(p, "meetingChoice")) w[1] = 0;
  const r = noise(state, p, 30) * (w[0] + w[1] + w[2]);
  return r < w[0] ? "ally" : r < w[0] + w[1] ? "brawl" : "pass";
}

function monsterChoice(state: GameState, p: PlayerState, options: any[]): number {
  let best = options.length - 1;
  let bestScore = -Infinity;
  for (const o of options) {
    if (!o.affordable) continue;
    let s: number;
    if (o.stat) {
      const n = p.stats[o.stat as Stat];
      const pw = pAtLeast(n, o.need);
      s = pw * (o.defeats ? 3 + (missionWants(p, "defeatMonster") ? 10 : 0) : 1) - (1 - pw) * 1.5;
    } else if (o.pay) s = -0.4 * (o.pay.coin ?? 0) - 0.8 * (o.pay.sparkTokens ?? 0);
    else s = val(state, p, o.effects ?? []);
    if (s > bestScore) [best, bestScore] = [o.index, s];
  }
  return best;
}

function chooseOption(state: GameState, p: PlayerState, d: Decision): Action {
  const { card, options } = turnOptions(state, p);
  const bonus = d.data.meetingBonus ?? 0;
  const rations = d.data.canRations && p.stamina <= 2 && p.coin >= 4;
  if (rations) p.stamina += 0; // decision only; the engine applies it
  const fc = d.data.finaleCost as Record<string, any> | null;
  let best: { idx: number; stat?: Stat; ev: number; ps: number; token: boolean; finale: boolean } | null = null;
  options.forEach((o, idx) => {
    const info = d.data.options[idx];
    const staminaAfter = p.stamina + (rations ? Content.rules.rations.stamina : 0);
    if (!info) return;
    if (!info.allowed && !(rations && info.stamina <= staminaAfter && info.stamina > p.stamina)) return;
    if (!o.rest && info.stamina > staminaAfter) return;
    const stats: (Stat | undefined)[] = o.rest ? [undefined] : allowedStats(state, p, o);
    for (const st of stats) {
      const r = optionEV(state, p, card, o, st ?? "brawn", bonus);
      let ev = r.ev;
      let finale = false;
      if (fc && !o.rest) {
        const g = gainFor(state, p, card, o, st, true) - gainFor(state, p, card, o, st, false);
        if (g > 0 && r.ps >= 0.35 && canPay(p, fc)) {
          ev += r.ps * g - costValue(p, fc);
          finale = true;
        }
      }
      if (o.alt === "taproot-reach") ev = r.ps * 8 - 1;
      if (o.alt?.startsWith("scatter:")) ev = r.ps * 2 - 0.3;
      if (!best || ev > best.ev) best = { idx, stat: st, ev, ps: r.ps, token: r.token, finale };
    }
  });
  const b = best as { idx: number; stat?: Stat; ev: number; ps: number; token: boolean; finale: boolean } | null;
  if (!b) return { player: p.id, kind: "chooseOption", option: 0, rations };
  const o = options[b.idx];
  const askAssist = !o.rest && b.ps < 0.5 && b.ev > 2 && !has(state, p, "noAssistReceive") && !missionNever(p, "receiveAssist");
  const useItems: number[] = [];
  // one-use dice boosts on big rolls
  if (!o.rest && b.ps < 0.6 && b.ev > 2) {
    const boost = p.items.find((i) => (Content.item[i.id].use ?? []).some((e) => e.type === "nextRollDice" && (!e.stat || e.stat === b.stat)));
    if (boost && !missionNever(p, "useItem")) useItems.push(boost.uid);
  }
  return {
    player: p.id,
    kind: "chooseOption",
    option: b.idx,
    stat: b.stat,
    useToken: b.token,
    rations,
    useItems,
    askAssist,
    attemptFinale: b.finale,
    lessonStat: growthFocus(p),
    bet: p.coin >= 6,
  };
}

function canPay(p: PlayerState, cost: Record<string, any>): boolean {
  if (cost.coin && p.coin < cost.coin) return false;
  if (cost.discardTreasures && treasures(p).length < cost.discardTreasures) return false;
  if (cost.giveTreasure && treasures(p).length < 1) return false;
  return true;
}

function costValue(p: PlayerState, cost: Record<string, any>): number {
  let v = 0;
  if (cost.coin) v += cost.coin * 0.25;
  const ts = treasures(p).map(itemVp).sort((a, b) => a - b);
  if (cost.discardTreasures) v += ts.slice(0, cost.discardTreasures).reduce((s, x) => s + x, 0);
  if (cost.giveTreasure) v += ts[0] ?? 0;
  if (cost.giveTreasureEachRival) v += ts.slice(0, 3).reduce((s, x) => s + x, 0);
  return v;
}

function growthFocus(p: PlayerState): Stat {
  const cap = Content.rules.character.statCap;
  return [...STATS].sort((a, b) => Number(p.stats[b] < cap) - Number(p.stats[a] < cap) || p.stats[b] - p.stats[a])[0];
}

function assist(state: GameState, p: PlayerState, d: Decision): number {
  if (missionWants(p, "lendAssist") && p.stamina >= 3) return 1;
  if (persona(p) === "friendly" && p.stamina >= 4 && noise(state, p, 40) < 0.3) return 1;
  return 0;
}

function wantPush(state: GameState, p: PlayerState, d: Decision): boolean {
  if (missionNever(p, "push") && p.mission) {
    const f = Content.mission[p.mission].flourish.condition;
    const tags = (f as any)?.never?.tags as Tag[] | undefined;
    const card = state.turn?.card ? Content.card[state.turn.card.card] : null;
    if (!tags || (card && card.tags.some((t) => tags.includes(t)))) {
      if (!(f as any)?.until || p.claimed.length < 3) return false;
    }
  }
  const gap = d.data.need - d.data.successes;
  const ones = (d.data.dice as number[]).filter((x) => x === 1).length;
  const pers = persona(p);
  if (ones > (pers === "cautious" ? 0 : 1)) return false;
  if (missionWants(p, "success", { pushed: true } as any) || missionWants(p, "push")) return gap <= 2;
  return gap === 1 || (gap === 2 && pers === "aggressive");
}

function lessonInstead(state: GameState, p: PlayerState): boolean {
  const t = state.turn!;
  const { card, options } = turnOptions(state, p);
  const o = options[t.option!];
  const evInstead: GameEvent = { type: "lessonInstead", round: state.round, turn: p.turns, stat: t.stat, tags: card.tags, skull: card.skull };
  const gInstead = missionGain(state, p, evInstead) + missionGain(state, p, hypothetical(state, p, card, o, t.stat, { lessonInstead: true }));
  const gReward = gainFor(state, p, card, o, t.stat, !!t.finaleAttempt);
  if (gInstead > gReward) return true;
  if (gReward > 0) return false;
  const small = o.success.every((e) => (e.type === "item" && Content.item[e.item].vp <= 1) || e.type === "coin");
  return small && persona(p) === "cautious" && noise(state, p, 50) < 0.5;
}

function quickAction(state: GameState, p: PlayerState, d: Decision): Action {
  const useItems: number[] = [];
  for (const it of p.items) {
    const def = Content.item[it.id];
    if (def.power !== "oneUse" || !def.use) continue;
    const heals = def.use.some((e) => e.type === "heal");
    const stam = def.use.some((e) => e.type === "stamina");
    if ((heals && p.health <= 2) || (stam && p.stamina <= 1 && def.type === "food")) useItems.push(it.uid);
    if (def.use.some((e) => e.type === "peekWorld" || e.type === "learnRivalTag") && missionWants(p, def.use[0].type === "peekWorld" ? "seeHidden" : "learnTag"))
      useItems.push(it.uid);
  }
  // Taproot Fragment: worth 5 VP unused; use only Becoming when a milestone is missing late
  const frag = p.items.find((i) => i.id === "taproot-fragment");
  if (frag && frag.fragment === "fragment-of-becoming" && p.claimed.length === 2 && state.worldDeck.length <= 4) useItems.push(frag.uid);
  const cash: number[] = [];
  if (missionWants(p, "cashIn")) {
    const t = treasures(p).sort((a, b) => itemValue(a) - itemValue(b))[0];
    if (t) cash.push(t.uid);
  }
  const coinGoal = coinTarget(p);
  if (coinGoal && p.coin < coinGoal) {
    for (const t of treasures(p).sort((a, b) => itemValue(a) - itemValue(b))) {
      if (p.coin + cash.reduce((s, u) => s + (Content.item[p.items.find((i) => i.uid === u)!.id].coin), 0) >= coinGoal) break;
      if (!cash.includes(t.uid)) cash.push(t.uid);
    }
  }
  const wantsTrap =
    !missionNever(p, "setTrap") &&
    (has(state, p, "freeTraps") ||
      missionWants(p, "setTrap") ||
      missionWants(p, "trapSprungByRival") ||
      (persona(p) === "aggressive" && noise(state, p, 60) < 0.4) ||
      (p.log.freeTrap ?? 0) > 0);
  if (d.data.canTrap && wantsTrap && p.stamina > d.data.trapCost + 1) {
    const taken = new Set(state.traps.map((t) => t.location));
    const pool = Content.cards.filter((c) => !taken.has(c.id));
    // copies make a location likelier to be drawn
    const weights = pool.map((c) => c.copies);
    let r = noise(state, p, 61) * weights.reduce((s, w) => s + w, 0);
    let card = pool[0];
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        card = pool[i];
        break;
      }
    }
    const trapType = missionWants(p, "setTrap", { trapType: "pickpocket" }) || missionWants(p, "trapSprungByRival", { trapType: "pickpocket" }) || missionWants(p, "steal")
      ? "pickpocket"
      : (["snare", "pickpocket", "stinkbomb"] as const)[Math.floor(noise(state, p, 62) * 3)];
    return { player: p.id, kind: "quickAction", action: "trap", location: card.id, trapType, useItems, cash };
  }
  if (d.data.canRations && p.stamina <= 1 && p.coin >= 4) return { player: p.id, kind: "quickAction", action: "rations", useItems, cash };
  return { player: p.id, kind: "quickAction", action: "none", useItems, cash };
}

function coinTarget(p: PlayerState): number {
  if (!p.mission) return 0;
  const text = JSON.stringify(Content.mission[p.mission]);
  const m = text.match(/"minCoin": ?(\d+)/) ?? text.match(/"coin": ?(\d+)/);
  return m ? Number(m[1]) : 0;
}

function market(state: GameState, p: PlayerState, d: Decision): Action {
  const buy: number[] = [];
  const cash: number[] = [];
  let coin = p.coin;
  const wantsBuy = missionWants(p, "buy");
  const keep = coinTarget(p);
  const stock = [...(d.data.stock as any[])].sort((a, b) => Content.item[b.id].vp - Content.item[a.id].vp);
  if (wantsBuy) {
    const cheapest = [...stock].sort((a, b) => a.price - b.price)[0];
    if (cheapest && coin >= cheapest.price) {
      buy.push(cheapest.uid);
      coin -= cheapest.price;
    }
  }
  for (const s of stock) {
    if (buy.includes(s.uid)) continue;
    const def = Content.item[s.id];
    const worth = def.vp + (def.type === "gear" ? 2 : 0);
    if (coin - s.price >= keep && coin >= s.price && worth >= 3 && s.price <= worth * 3) {
      buy.push(s.uid);
      coin -= s.price;
    }
  }
  if (d.data.merchant === "the-mudlark-barge" && !keep) {
    for (const t of treasures(p)) if (Content.item[t.id].vp <= 1) cash.push(t.uid);
  }
  const services: string[] = [];
  if ((d.data.services as any[]).some((s) => s.buy === "learnRivalTag") && coin >= 6) services.push("learnRivalTag");
  const exchange: number[] = [];
  if (d.data.trade && treasures(p).length >= 3) {
    const need = d.data.trade.give.treasures as number;
    exchange.push(...treasures(p).sort((a, b) => itemValue(a) - itemValue(b)).slice(0, need).map((i) => i.uid));
  }
  const bid = d.data.auction ? Math.max(0, Math.min(coin - keep, Content.item[d.data.auction].coin + 2)) : 0;
  const offers = [];
  if (missionWants(p, "trade")) {
    const mine = treasures(p).sort((a, b) => itemValue(a) - itemValue(b))[0];
    const partner = state.players.find((q) => q.id !== p.id && q.coin >= 2);
    if (mine && partner) offers.push({ to: partner.id, give: { items: [mine.uid], coin: 0 }, get: { items: [], coin: Math.min(partner.coin, Content.item[mine.id].coin) } });
  }
  return { player: p.id, kind: "market", buy, cash, exchange, services, bid, offers };
}

function respondTrade(state: GameState, p: PlayerState, d: Decision): boolean {
  if (missionWants(p, "trade")) return true;
  const from = state.players[d.data.from];
  const gets = (d.data.give.items as number[]).reduce((s, u) => s + itemValue(from.items.find((i) => i.uid === u) ?? ({ id: "thal-acorn" } as any)), 0) + d.data.give.coin * 0.3;
  const gives = (d.data.get.items as number[]).reduce((s, u) => s + itemValue(p.items.find((i) => i.uid === u) ?? ({ id: "thal-acorn" } as any)), 0) + d.data.get.coin * 0.3;
  return gets >= gives;
}

function guess(state: GameState, p: PlayerState): Record<number, string> {
  const picks: { rid: number; mission: string; conf: number }[] = [];
  for (const q of state.players) {
    if (q.id === p.id) continue;
    if (p.knownMissions[q.id]) {
      picks.push({ rid: q.id, mission: p.knownMissions[q.id], conf: 99 });
      continue;
    }
    const known = p.intel[q.id] ?? [];
    // public behavior: where they went and what they did
    const visits: Record<string, number> = {};
    for (const e of q.history) if (e.type === "success" || e.type === "rest") for (const t of e.tags ?? []) visits[t] = (visits[t] ?? 0) + 1;
    const total = Object.values(visits).reduce((s, x) => s + x, 0) || 1;
    let best = "";
    let bestScore = -Infinity;
    for (const m of Content.missions) {
      if (m.id === p.mission) continue;
      const tags = missionTags(m.id);
      if (!known.every((t) => tags.includes(t))) continue;
      const fit = m.path.length ? m.path.reduce((s, t) => s + (visits[t] ?? 0), 0) / total / Math.sqrt(m.path.length) : 0.15;
      const s = fit + noise(state, p, 70 + m.id.length + q.id) * 0.05 + known.length * 0.1;
      if (s > bestScore) [best, bestScore] = [m.id, s];
    }
    if (best) picks.push({ rid: q.id, mission: best, conf: bestScore });
  }
  picks.sort((a, b) => b.conf - a.conf);
  return Object.fromEntries(picks.slice(0, Content.rules.scoring.maxGuesses).map((x) => [x.rid, x.mission]));
}

export { hooks };
