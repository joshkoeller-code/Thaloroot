import { Content } from "./content.js";
import {
  addLessons,
  apply,
  gainItem,
  itemCoin,
  learnRivalTag,
  log,
  loseRandomItem,
  makeFrog,
  newItem,
  randomItemOfRarity,
  record,
  restoreStamina,
  heal,
  growthStat,
} from "./effects.js";
import { addItem, gstat, has, hasLight, removeItem, rivals, treasures } from "./player.js";
import { d6, int, pick, sample, shuffle } from "./rng.js";
import type { GameState, MarketState, MonsterOption, PlayerState, WorldCardDef } from "./types.js";

export const FINALE = "FINALE";

export function buildWorldDeck(state: GameState): string[] {
  const counts = Content.deckCounts[state.config.length];
  const regular: string[] = [];
  for (const cat of ["weather", "monster", "merchant", "rumor", "chaos"] as const) {
    regular.push(...sample(state, Content.world[cat], counts[cat]).map((c) => c.id));
  }
  shuffle(state, regular);
  const esc = sample(state, Content.world.escalation, counts.escalation).map((c) => c.id);
  const half = Math.floor(regular.length / 2);
  for (const e of esc) {
    regular.splice(int(state, half, regular.length), 0, e);
  }
  regular.push(FINALE);
  return regular;
}

/** When the first player finishes a mission, cut the World deck so only N cards remain before the Finale. */
export function moveFinale(state: GameState): void {
  const idx = state.worldDeck.indexOf(FINALE);
  const k = Content.deckCounts[state.config.length].finaleCountdown;
  if (idx > k) {
    gstat(state, "worldCardsCut", idx - k);
    state.worldDeck = [...state.worldDeck.slice(0, k), FINALE];
  }
}

function setNight(state: GameState): void {
  state.night = state.mods.some((m) => Content.worldCard[m.source]?.night);
}

/** Draw and apply the next World card. Returns true if it opened the market. */
export function drawWorldCard(state: GameState): { finale: boolean; market: boolean } {
  // "This round" and "until the next World card" both end now.
  state.mods = state.mods.filter((m) => m.until === "game");
  for (const p of state.players) {
    p.forcePass = false;
  }
  const id = state.worldDeck.shift();
  if (id === undefined || id === FINALE) {
    const fin = chooseFinale(state);
    state.finale = fin;
    state.finalRound = true;
    log(state, `World card: the Finale, ${Content.worldCard[fin].name}. ${Content.worldCard[fin].text}`);
    setNight(state);
    return { finale: true, market: startFinale(state, fin) };
  }
  state.worldDiscard.push(id);
  for (const p of state.players) p.seenWorld = Math.max(0, p.seenWorld - 1);
  const def = Content.worldCard[id];
  log(state, `World card: ${def.name}. ${def.text ?? ""}`.trim());
  gstat(state, `world:${def.category}`);
  let market = false;
  switch (def.category) {
    case "weather":
    case "chaos":
      if (def.mods || def.altExplore || def.night) state.mods.push({ source: id, mods: def.mods ?? [], until: "next" });
      if (def.instant) for (const p of state.players) instant(state, p, def);
      chaosSpecial(state, def);
      break;
    case "escalation":
      state.escalations.push(id);
      state.mods.push({ source: id, mods: def.mods ?? [], until: "game" });
      break;
    case "monster":
      state.monsters.push({ id, roundsLeft: def.rounds ?? Content.rules.monsters.defaultRounds, targets: [] });
      break;
    case "rumor":
      state.rumors.push({ id });
      break;
    case "merchant":
      openMarket(state, id);
      market = true;
      break;
  }
  setNight(state);
  return { finale: false, market };
}

function instant(state: GameState, p: PlayerState, def: WorldCardDef): void {
  for (const e of def.instant ?? []) {
    switch (e.type) {
      case "chanceEach": {
        if (def.id === "frog-rain" && p.cls === "toadstool-witch") {
          addLessons(state, p, growthStat(p), 1);
          break;
        }
        if (e.faces.includes(d6(state))) {
          for (const t of e.then) {
            if (t.type === "frog") makeFrog(state, p);
            if (t.type === "forcePassThisRound") p.forcePass = true;
          }
        }
        break;
      }
      case "squirrelStash": {
        const it = loseRandomItem(state, p);
        if (it) state.squirrelStash.push(it);
        break;
      }
      case "ifCompanion":
        if (p.companions.length) apply(state, p, e.then, { origin: "world" });
        break;
      case "festival":
        p.coin += hasLight(state, p) ? e.withLight : e.without;
        break;
      case "passRandomItemLeft":
        break; // handled for everyone at once in chaosSpecial
      default:
        apply(state, p, [e], { origin: "world" });
    }
  }
}

function chaosSpecial(state: GameState, def: WorldCardDef): void {
  if (def.id === "shoe-swap") {
    const n = state.players.length;
    const moved = state.players.map((p) => {
      const pool = p.items.filter((i) => !Content.item[i.id].cannotTrade && !i.protected);
      const it = pool.length ? pick(state, pool) : null;
      if (it) removeItem(state, p, it.uid);
      return it;
    });
    moved.forEach((it, i) => it && addItem(state, state.players[(i + 1) % n], it));
  }
  if (def.id === "squirrel-heist" && state.squirrelStash.length) state.rumors.push({ id: def.id });
}

function chooseFinale(state: GameState): string {
  if (state.escalations.length) {
    const last = Content.worldCard[state.escalations[state.escalations.length - 1]];
    return Content.world.finale.find((f) => f.name === last.finale)!.id;
  }
  return pick(state, Content.world.finale.filter((f) => f.general)).id;
}

function startFinale(state: GameState, fin: string): boolean {
  const def = Content.worldCard[fin];
  for (const f of def.final ?? []) {
    if (f.kind === "restoreAllStamina") for (const p of state.players) restoreStamina(p, "all");
    if (f.kind === "market") {
      openMarket(state, fin, f.stock);
      return true;
    }
  }
  return false;
}

export function finaleHas(state: GameState, kind: string): any {
  if (!state.finale) return null;
  return (Content.worldCard[state.finale].final ?? []).find((f: any) => f.kind === kind) ?? null;
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

export function monsterDef(id: string): WorldCardDef & { options: MonsterOption[]; reward: any[] } {
  return Content.worldCard[id] as any;
}

/** Decide who each monster hunts this round. Called after the reveal. */
export function assignHunts(state: GameState): void {
  const targetable = state.players.filter((p) => !p.untargetable);
  const top = (score: (p: PlayerState) => number) => {
    if (!targetable.length) return [];
    const best = Math.max(...targetable.map(score));
    const tied = targetable.filter((p) => score(p) === best);
    return [pick(state, tied).id];
  };
  for (const m of state.monsters) {
    const def = monsterDef(m.id);
    const pickOf = (p: PlayerState) => {
      const c = state.picks[p.id];
      return c ? Content.card[c.card] : null;
    };
    switch (def.hunts) {
      case "mostCoin":
        m.targets = top((p) => p.coin);
        break;
      case "mostItems":
        m.targets = top((p) => p.items.length);
        break;
      case "mostCompanions":
        m.targets = top((p) => p.companions.length);
        break;
      case "pickedSwamp":
        m.targets = targetable.filter((p) => pickOf(p)?.region === "swamp").map((p) => p.id);
        break;
      case "pickedRuins":
        m.targets = targetable.filter((p) => pickOf(p)?.region === "ruins").map((p) => p.id);
        break;
      case "pickedMountainOrPeril":
        m.targets = targetable.filter((p) => pickOf(p)?.tags.some((t) => t === "mountain" || t === "peril")).map((p) => p.id);
        break;
      case "highestSkull":
        m.targets = top((p) => pickOf(p)?.skull ?? 0);
        break;
      case "nextTreasure":
        // set when someone finds a treasure (effects.apply); keep until faced
        break;
    }
  }
}

export function endRoundMonsters(state: GameState): void {
  for (const m of state.monsters) m.roundsLeft -= 1;
  const gone = state.monsters.filter((m) => m.roundsLeft <= 0);
  for (const m of gone) log(state, `${monsterDef(m.id).name} wanders off.`);
  state.monsters = state.monsters.filter((m) => m.roundsLeft > 0);
  for (const m of state.monsters) if (m.id !== "the-mimic-chest") m.targets = [];
}

export function monsterNeedBonus(state: GameState): number {
  return state.mods.flatMap((m) => m.mods).filter((m) => m.kind === "monsterNeed").reduce((s, m) => s + m.amount, 0);
}

export function monsterDice(state: GameState, p: PlayerState, stat: string): number {
  let n = p.stats[stat as keyof typeof p.stats] ?? 0;
  for (const c of p.companions) {
    for (const h of Content.companion[c.id].passive) if (h.kind === "monsterDice") n += h.amount;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Merchants and the market
// ---------------------------------------------------------------------------

export function price(state: GameState, p: PlayerState, id: string): number {
  const def = Content.item[id];
  const r = Content.rules.merchant;
  let cost: number;
  if (def.coin > 0) cost = def.coin + (def.rarity === "rare" || def.rarity === "legendary" ? r.rareMarkup : r.markup);
  else cost = (r.noValuePrice as any)[def.rarity] ?? r.noValuePrice.rare;
  if (has(state, p, "merchantSurcharge")) cost += 1;
  return cost;
}

function openMarket(state: GameState, merchant: string, extraStock?: Record<string, number>): void {
  const def = Content.worldCard[merchant];
  const stockIds: string[] = [];
  const add = (rarity: string, n: number, filter?: (id: string) => boolean) => {
    for (let i = 0; i < n; i++) {
      const id = randomItemOfRarity(state, rarity, filter);
      if (id) stockIds.push(id);
    }
  };
  const s = def.stock ?? {};
  if (merchant === "mrs-pennywhistles-rolling-shop") {
    add("common", 1);
    add("uncommon", 1);
    add("rare", 1);
  } else if (s.common) add("common", s.common);
  if (s.food) add("common", s.food, (id) => Content.item[id].type === "food");
  if (extraStock) {
    const d = Content.rules.merchant.stock;
    add("common", d.common);
    add("uncommon", d.uncommon);
    add("rare", extraStock.rare ?? 0);
  }
  const stock = stockIds.map((id) => ({ uid: ++state.uid, id, price: def.price ?? 0 }));
  const market: MarketState = {
    merchant,
    stock,
    auction: def.auction ? { id: randomItemOfRarity(state, "rare") ?? "lucky-thimble" } : null,
    pending: state.players.map((p) => p.id),
  };
  state.market = market;
}

export interface MarketChoice {
  buy?: number[];
  cash?: number[];
  exchange?: number[];
  bid?: number;
  services?: string[];
}

/** Resolve every player's market choices in turn order. */
export function resolveMarket(state: GameState, choices: Record<number, MarketChoice>): void {
  const m = state.market;
  if (!m) return;
  const def = Content.worldCard[m.merchant];
  const order = state.order.length ? state.order : state.players.map((p) => p.id);
  for (const pid of order) {
    const p = state.players[pid];
    const c = choices[pid] ?? {};
    // cash first, so the coin can be spent
    for (const uid of c.cash ?? []) {
      const it = p.items.find((i) => i.uid === uid);
      if (!it || Content.item[it.id].cannotCash || !treasures(p).includes(it)) continue;
      removeItem(state, p, uid);
      const coin = itemCoin(it) + (def.buysTreasureBonus ?? 0) + (has(state, p, "cashBonus") ? 1 : 0);
      p.coin += coin;
      log(state, `${p.name} sells the ${Content.item[it.id].name} for ${coin} coin.`);
      record(state, p, { type: "cashIn", item: it.id });
    }
    let discountUsed = false;
    for (const suid of c.buy ?? []) {
      const s = m.stock.find((x) => x.uid === suid && !x.sold);
      if (!s) continue;
      let cost = s.price || price(state, p, s.id);
      if (!discountUsed && has(state, p, "merchantDiscount")) {
        cost = Math.max(0, cost - 2);
        discountUsed = true;
      }
      if (p.coin < cost) continue;
      p.coin -= cost;
      s.sold = true;
      const inst = gainItem(state, p, s.id, { origin: "bought" });
      if (!inst) {
        p.coin += cost;
        s.sold = false;
        continue;
      }
      gstat(state, "purchases");
      log(state, `${p.name} buys the ${Content.item[s.id].name} for ${cost} coin.`);
      if (m.merchant === "old-nans-pie-cart" && d6(state) === 1) {
        p.quickActionLost = true;
        log(state, `It was a Sleepy Scone. ${p.name} will lose their next quick action.`);
      }
      record(state, p, { type: "buy", item: s.id });
    }
    if (c.exchange?.length && def.trade) {
      const need = def.trade.give.treasures as number;
      const give = c.exchange.map((uid) => p.items.find((i) => i.uid === uid)).filter((x): x is NonNullable<typeof x> => !!x && treasures(p).includes(x));
      if (give.length >= need) {
        for (const it of give.slice(0, need)) removeItem(state, p, it.uid);
        if (def.trade.get.randomRare) {
          const id = randomItemOfRarity(state, "rare");
          if (id) gainItem(state, p, id, { origin: "bought" });
        }
        if (def.trade.get.lessons) addLessons(state, p, growthStat(p), def.trade.get.lessons);
        log(state, `${p.name} trades with the ${def.name}.`);
        record(state, p, { type: "buy", exchange: true });
      }
    }
    for (const svc of c.services ?? []) {
      const s = (def.services ?? []).find((x: any) => x.buy === svc);
      if (!s || p.coin < s.coin) continue;
      p.coin -= s.coin;
      if (svc === "learnRivalTag") learnRivalTag(state, p);
      record(state, p, { type: "buy", service: svc });
    }
  }
  if (m.auction) {
    const bids = order.map((pid) => ({ pid, bid: Math.min(choices[pid]?.bid ?? 0, state.players[pid].coin) })).filter((b) => b.bid > 0);
    if (bids.length) {
      const best = Math.max(...bids.map((b) => b.bid));
      const w = bids.find((b) => b.bid === best)!;
      const p = state.players[w.pid];
      p.coin -= best;
      gainItem(state, p, m.auction.id, { origin: "bought" });
      log(state, `${p.name} wins the auction (${best} coin) for the ${Content.item[m.auction.id].name}.`);
      record(state, p, { type: "buy", auction: true });
    }
  }
  state.market = null;
}

/** Score-time finale bonuses. */
export function finaleScoring(state: GameState): Record<number, number> {
  const bonus: Record<number, number> = {};
  for (const p of state.players) bonus[p.id] = 0;
  const lastCourt = finaleHas(state, "lastCourt");
  if (lastCourt) {
    const holders = state.players.filter((p) => treasures(p).length);
    if (holders.length) {
      const val = (p: PlayerState) => Math.max(...treasures(p).map((t) => itemCoin(t)));
      const best = Math.max(...holders.map(val));
      let given = false;
      for (const p of holders) {
        if (!given && val(p) === best) {
          bonus[p.id] += lastCourt.top;
          given = true;
        } else bonus[p.id] += lastCourt.others;
      }
    }
  }
  const lightVp = finaleHas(state, "lightVp");
  if (lightVp) {
    for (const p of state.players) {
      const n = p.items.filter((i) => Content.item[i.id].type === "light").length;
      bonus[p.id] += n * lightVp.amount;
    }
  }
  return bonus;
}

export { newItem, rivals };
