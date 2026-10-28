/**
 * Class actives, signatures, and services. Each power's costs, timing, and
 * tunable numbers live in content/classes.json (from tools/authored.py); this
 * module decides what a player can use right now and carries it out.
 *
 * When powers happen:
 *   pick    while choosing a teaser (Dream Peek, Build a Bridge)
 *   scheme  after everyone picks, before the reveal (Whispers, Switcheroo, Gust, Cyclone)
 *   roll    when choosing an option (Stampede, The Walking Cottage)
 *   quick   as your quick action, instead of setting a trap (most of them)
 *   auto    the engine applies it (Phoenix, Bluff, Forager, Sneaky Traps)
 */
import { Content } from "./content.js";
import { countSuccesses, dreaming } from "./dice.js";
import { damage, gainItem, itemValue, learnRivalTag, log, makeFrog, newItem, record, restoreStamina } from "./effects.js";
import { addItem, bestStat, gstat, isTreasure, recomputeMax, removeItem, rivals, treasures } from "./player.js";
import { pick, roll, shuffle } from "./rng.js";
import type { CardInstance, GameState, ItemInstance, PlayerState, PowerDef, PowerUse, Stat, Ward } from "./types.js";
import { STATS } from "./types.js";

export function powersOf(p: PlayerState): PowerDef[] {
  return p.cls ? Content.cls[p.cls]?.powers ?? [] : [];
}

export function powerDef(id: string): PowerDef | undefined {
  for (const c of Content.classes) for (const pw of c.powers ?? []) if (pw.id === id) return pw;
  return undefined;
}

export function hasPower(p: PlayerState, id: string): boolean {
  return powersOf(p).some((x) => x.id === id);
}

const SIG = (id: string) => `power:${id}`;

export function signatureUsed(p: PlayerState, id: string): boolean {
  return p.oncePerGame.includes(SIG(id));
}

function markSignature(p: PlayerState, id: string): void {
  if (!p.oncePerGame.includes(SIG(id))) p.oncePerGame.push(SIG(id));
}

function affordable(p: PlayerState, def: PowerDef): boolean {
  const c = def.cost ?? {};
  return (c.stamina ?? 0) <= p.stamina && (c.dream ?? 0) <= p.dream && (c.coin ?? 0) <= p.coin && (c.ingredients ?? 0) <= p.ingredients;
}

function payCost(p: PlayerState, def: PowerDef): void {
  const c = def.cost ?? {};
  p.stamina -= c.stamina ?? 0;
  p.dream -= c.dream ?? 0;
  p.coin -= c.coin ?? 0;
  p.ingredients -= c.ingredients ?? 0;
}

/** Items a rival could lose to a swap, flood, or tremor. */
function movable(it: ItemInstance): boolean {
  const d = Content.item[it.id];
  return !!d && !d.cannotSteal && !d.cannotTrade && d.type !== "relic" && !it.protected;
}

/** Locations a player has explored this game (for Build a Bridge). */
export function exploredLocations(p: PlayerState): string[] {
  const out: string[] = [];
  for (const e of p.history) if ((e.type === "roll" || e.type === "rest") && e.location && Content.card[e.location] && !out.includes(e.location)) out.push(e.location);
  return out;
}

/** The Geomancer is Rooted: Gust can't move them. */
function rooted(q: PlayerState): boolean {
  return q.cls === "moss-footed-geomancer";
}

export interface AvailablePower {
  id: string;
  name: string;
  text: string;
  slot: PowerDef["slot"];
  target: PowerDef["target"];
  cost: PowerDef["cost"];
  choices?: PowerDef["choices"];
  /** Rivals it can target. */
  rivals?: number[];
  /** Your items it can use. */
  items?: number[];
  /** Locations it can target, when not every location. */
  locations?: string[];
  /** For a service: whose service it is. */
  owner?: number;
  params?: Record<string, any>;
}

function entry(def: PowerDef, extra: Partial<AvailablePower> = {}): AvailablePower {
  return { id: def.id, name: def.name, text: def.text, slot: def.slot, target: def.target, cost: def.cost, choices: def.choices, params: def.params, ...extra };
}

/** Powers a player can use right now at this moment of the round. */
export function availablePowers(state: GameState, p: PlayerState, when: PowerDef["when"]): AvailablePower[] {
  const out: AvailablePower[] = [];
  const targets = rivals(state, p).filter((q) => !q.untargetable);
  for (const def of powersOf(p)) {
    if (def.when !== when || def.slot === "passive" || def.slot === "service") continue;
    if (def.slot === "signature" && signatureUsed(p, def.id)) continue;
    if (!affordable(p, def)) continue;
    const ok = (x: AvailablePower | null) => x && out.push(x);
    switch (def.id) {
      case "sic-em":
        if (p.companions.length) ok(entry(def));
        break;
      case "stampede":
        if (p.companions.length) ok(entry(def));
        break;
      case "the-swap": {
        const mine = p.items.filter(movable).map((i) => i.uid);
        const rs = targets.filter((q) => q.items.some(movable)).map((q) => q.id);
        if (mine.length && rs.length) ok(entry(def, { items: mine, rivals: rs }));
        break;
      }
      case "brew":
      case "reforge": {
        const ts = treasures(p).map((i) => i.uid);
        if (ts.length) ok(entry(def, { items: ts }));
        break;
      }
      case "switcheroo": {
        const rs = targets.filter((q) => state.picks[q.id]).map((q) => q.id);
        if (state.picks[p.id] && rs.length) ok(entry(def, { rivals: rs }));
        break;
      }
      case "mistaken-identity":
        if (targets.length) ok(entry(def, { rivals: rivals(state, p).map((q) => q.id) }));
        break;
      case "possession": {
        const rs = targets.filter((q) => state.possess[q.id] === undefined).map((q) => q.id);
        if (rs.length && !Object.values(state.possess).includes(p.id)) ok(entry(def, { rivals: rs }));
        break;
      }
      case "dream-walk": {
        const rs = targets.filter((q) => q.mission).map((q) => q.id);
        if (rs.length) ok(entry(def, { rivals: rs }));
        break;
      }
      case "build-a-bridge": {
        const locs = exploredLocations(p).filter((l) => !state.burned.includes(l) && !walledFor(state, p, l));
        if (locs.length) ok(entry(def, { locations: locs }));
        break;
      }
      case "masterwork": {
        const its = p.items.filter((i) => !i.carriedOver && i.id !== "taproot-fragment").map((i) => i.uid);
        if (its.length) ok(entry(def, { items: its }));
        break;
      }
      case "cook":
        ok(entry(def, { rivals: targets.map((q) => q.id) }));
        break;
      case "tremor": {
        const rs = shareRegion(state, p);
        if (rs.length) ok(entry(def, { rivals: rs.map((q) => q.id) }));
        break;
      }
      case "burn-the-path":
        ok(entry(def, { locations: Content.cards.map((c) => c.id).filter((l) => !state.burned.includes(l)) }));
        break;
      case "gust": {
        const rs = targets.filter((q) => !rooted(q) && state.picks[q.id] && (state.passed[q.id] ?? []).length).map((q) => q.id);
        if (rs.length) ok(entry(def, { rivals: rs }));
        break;
      }
      case "cyclone":
        if (Object.values(state.picks).filter(Boolean).length >= 2) ok(entry(def));
        break;
      default:
        ok(entry(def));
    }
  }
  // services other players offer
  if (when === "quick") {
    for (const q of rivals(state, p)) {
      for (const def of powersOf(q)) {
        if (def.slot !== "service") continue;
        const price = def.params?.price ?? 0;
        if (def.id === "smithing-for-hire" && p.coin >= price && treasures(p).length)
          out.push(entry(def, { owner: q.id, items: treasures(p).map((i) => i.uid) }));
      }
    }
  }
  return out;
}

/** Rivals at a shared location: the same region and skull rating as you this round, like a Meeting. */
function shareRegion(state: GameState, p: PlayerState): PlayerState[] {
  const mine = state.picks[p.id];
  if (!mine) return [];
  const { region, skull } = Content.card[mine.card];
  return rivals(state, p).filter((q) => {
    const c = state.picks[q.id] ? Content.card[state.picks[q.id]!.card] : null;
    return !q.untargetable && c && c.region === region && c.skull === skull;
  });
}

/** Is this location walled off for this player this round? */
export function walledFor(state: GameState, p: PlayerState, location: string, round = state.round): boolean {
  return state.walls.some((w) => w.location === location && w.round === round && w.owner !== p.id);
}

function cardName(id: string): string {
  return Content.card[id]?.name ?? id;
}

/**
 * Use a power. Returns false (and changes nothing) if it isn't available or the
 * use is missing what it needs. The Feast returns true and leaves decisions
 * pending for the guests.
 */
export function usePower(state: GameState, p: PlayerState, use: PowerUse, when: PowerDef["when"]): boolean {
  const av = availablePowers(state, p, when).find((x) => x.id === use.id && (x.owner === undefined || x.owner === use.target));
  if (!av) return false;
  const def = powerDef(use.id)!;
  const prm = def.params ?? {};
  const rival = use.target !== undefined ? state.players[use.target] : undefined;
  const validRival = () => !!rival && (av.rivals ?? []).includes(rival.id);
  const validLocation = () => !!use.location && !!Content.card[use.location] && (!av.locations || av.locations.includes(use.location));
  const mine = use.item !== undefined ? p.items.find((i) => i.uid === use.item) : undefined;
  const validItem = () => !!mine && (av.items ?? []).includes(mine.uid);
  const done = () => {
    if (def.slot === "signature") markSignature(p, def.id);
    record(state, p, { type: "usePower", power: def.id });
    gstat(state, "powersUsed");
    gstat(state, `power:${def.id}`);
  };

  switch (def.id) {
    // ---- locations -------------------------------------------------------
    case "sic-em":
    case "haunt":
    case "hex-the-path":
    case "living-gargoyle": {
      if (!validLocation()) return false;
      payCost(p, def);
      state.wards.push({ owner: p.id, location: use.location!, kind: def.id as Ward["kind"] });
      const what: Record<string, string> = {
        "sic-em": "sends a companion to stand guard somewhere",
        haunt: "drifts off to haunt somewhere",
        "hex-the-path": "hexes a path somewhere",
        "living-gargoyle": "carves a gargoyle and hides it somewhere",
      };
      log(state, `${p.name} ${what[def.id]}.`);
      log(state, `${def.name} waits at ${cardName(use.location!)}.`, [p.id]);
      done();
      return true;
    }
    case "build-a-wall": {
      if (!validLocation()) return false;
      payCost(p, def);
      state.walls.push({ owner: p.id, location: use.location!, round: state.round + 1 });
      log(state, `${p.name} walls off ${cardName(use.location!)}: nobody else can draw it next round.`);
      done();
      return true;
    }
    case "burn-the-path": {
      if (!validLocation()) return false;
      payCost(p, def);
      state.burned.push(use.location!);
      log(state, `${p.name} burns the path to ${cardName(use.location!)}. It's gone from the deck.`);
      done();
      return true;
    }
    case "cleanse": {
      payCost(p, def);
      if (use.self || !use.location) {
        p.trouble = { amount: 0, rolls: 0 };
        log(state, `${p.name} washes away their Trouble.`);
        done();
        return true;
      }
      if (!Content.card[use.location]) return false;
      const loc = use.location;
      const traps = state.traps.filter((t) => t.location === loc && t.owner !== p.id);
      const wards = state.wards.filter((w) => w.location === loc && w.owner !== p.id);
      state.traps = state.traps.filter((t) => !traps.includes(t));
      state.wards = state.wards.filter((w) => !wards.includes(w));
      const restored = state.burned.includes(loc);
      if (restored) state.burned = state.burned.filter((x) => x !== loc);
      const found = [
        ...traps.map((t) => `a ${t.type} set by ${state.players[t.owner].name}`),
        ...wards.map((w) => `${powerDef(w.kind)!.name} from ${state.players[w.owner].name}`),
      ];
      log(state, `${p.name} cleanses ${cardName(loc)}${restored ? ", and the burned path grows back" : ""}.`);
      log(state, found.length ? `At ${cardName(loc)} you wash away ${found.join(" and ")}.` : `${cardName(loc)} was already clean.`, [p.id]);
      done();
      return true;
    }
    // ---- rivals ----------------------------------------------------------
    case "switcheroo": {
      if (!validRival()) return false;
      payCost(p, def);
      [state.picks[p.id], state.picks[rival!.id]] = [state.picks[rival!.id], state.picks[p.id]];
      [state.passed[p.id], state.passed[rival!.id]] = [[], []];
      log(state, `${p.name} pulls a Switcheroo on ${rival!.name}: they've traded explore cards.`);
      done();
      return true;
    }
    case "gust": {
      if (!validRival()) return false;
      payCost(p, def);
      const other = state.passed[rival!.id].shift()!;
      state.exploreDiscard = state.exploreDiscard.filter((c) => c.uid !== other.uid);
      const was = state.picks[rival!.id]!;
      if (!was.virtual) state.exploreDiscard.push(was);
      state.picks[rival!.id] = other;
      state.passed[rival!.id] = [];
      log(state, `${p.name}'s Gust blows ${rival!.name} off course: they take their other teaser.`);
      done();
      return true;
    }
    case "cyclone": {
      payCost(p, def);
      const ids = state.order.filter((pid) => state.picks[pid]);
      const cards = shuffle(state, ids.map((pid) => state.picks[pid]!));
      ids.forEach((pid, i) => {
        state.picks[pid] = cards[i];
        state.passed[pid] = [];
      });
      log(state, `${p.name} calls a Cyclone! Every chosen card is swept up and dealt out again.`);
      done();
      return true;
    }
    case "mistaken-identity": {
      if (!validRival()) return false;
      payCost(p, def);
      state.disguise = { player: p.id, as: rival!.id, round: state.round + 1 };
      log(state, `Next round, the table will see your actions under ${rival!.name}'s name.`, [p.id]);
      done();
      return true;
    }
    case "possession": {
      if (!validRival()) return false;
      payCost(p, def);
      state.possess[rival!.id] = p.id;
      log(state, `The next time ${rival!.name} draws teasers, you'll choose which one they get.`, [p.id]);
      done();
      return true;
    }
    case "dream-walk": {
      if (!validRival() || (use.choice !== "learn" && use.choice !== "trouble")) return false;
      payCost(p, def);
      if (use.choice === "learn") learnRivalTag(state, p, rival!);
      else {
        rival!.trouble = { amount: rival!.trouble.amount + 1, rolls: Math.max(1, rival!.trouble.rolls) };
        log(state, `You slip a bad dream to ${rival!.name}: a Trouble die on their next roll.`, [p.id]);
      }
      log(state, `${p.name} walks in someone's dreams.`);
      done();
      return true;
    }
    case "the-swap": {
      if (!validRival() || !validItem()) return false;
      const theirs = rival!.items.find((i) => i.uid === use.targetItem && movable(i));
      if (!theirs) return false;
      payCost(p, def);
      removeItem(state, p, mine!.uid);
      removeItem(state, rival!, theirs.uid);
      addItem(state, p, theirs);
      addItem(state, rival!, mine!);
      state.swaps.push({ thief: p.id, victim: rival!.id });
      log(state, `You swap your ${Content.item[mine!.id].name} for ${rival!.name}'s ${Content.item[theirs.id].name}.`, [p.id]);
      record(state, p, { type: "steal", how: "swap" });
      done();
      return true;
    }
    // ---- items -----------------------------------------------------------
    case "brew": {
      const potion = def.choices?.find((c) => c.id === use.choice);
      if (!validItem() || !potion) return false;
      payCost(p, def);
      removeItem(state, p, mine!.uid);
      gainItem(state, p, potion.id, { origin: "crafted" });
      log(state, `${p.name} brews the ${Content.item[mine!.id].name} into a potion.`);
      done();
      return true;
    }
    case "reforge":
    case "smithing-for-hire": {
      if (!validItem() || !use.stat || !STATS.includes(use.stat)) return false;
      if (def.id === "smithing-for-hire") {
        const smith = state.players[av.owner!];
        const price = prm.price ?? 0;
        p.coin -= price;
        smith.coin += price;
        log(state, `${p.name} pays ${smith.name} ${price} coin to reforge the ${Content.item[mine!.id].name}.`);
        record(state, smith, { type: "service", power: def.id, for: p.id });
      } else payCost(p, def);
      forge(state, p, mine!, use.stat);
      done();
      return true;
    }
    case "masterwork": {
      if (!validItem()) return false;
      payCost(p, def);
      mine!.carriedOver = true;
      log(state, `${p.name}'s ${itemLabel(mine!)} becomes an Heirloom. It will carry into future games.`);
      done();
      return true;
    }
    // ---- self ------------------------------------------------------------
    case "cook": {
      const dish = def.choices?.find((c) => c.id === use.choice);
      if (!dish) return false;
      if (dish.id === "scones" && !validRival()) return false;
      payCost(p, def);
      if (dish.id === "stew") restoreStamina(p, 3);
      if (dish.id === "pie") p.nextRollDice += 1;
      if (dish.id === "scones") rival!.quickActionLost = true;
      log(state, `${p.name} cooks ${dish.name}${dish.id === "scones" ? ` for ${rival!.name}, who will doze through their next quick action` : ""}.`);
      done();
      return true;
    }
    case "the-feast": {
      payCost(p, def);
      restoreStamina(p, "all");
      log(state, `${p.name} throws a Feast! Every rival is invited.`);
      for (const q of rivals(state, p)) state.pending.push({ player: q.id, kind: "feast", data: { cook: p.id, vp: prm.vpPerGuest ?? 1 } });
      state.collect = {};
      done();
      return true;
    }
    case "the-great-flood": {
      payCost(p, def);
      const traps = state.traps.length + state.wards.length;
      state.traps = [];
      state.wards = [];
      const drift: string[] = [];
      for (const q of rivals(state, p)) {
        if (q.untargetable) continue;
        const it = [...q.items].filter(movable).sort((a, b) => itemValue(a) - itemValue(b))[0];
        if (!it) continue;
        removeItem(state, q, it.uid);
        addItem(state, p, it);
        drift.push(`${q.name}'s ${Content.item[it.id].name}`);
      }
      log(state, `${p.name} calls the Great Flood! ${traps ? "Every trap and curse washes away. " : ""}${drift.length ? `${drift.join(", ")} drift to ${p.name}.` : "Nothing drifts their way."}`);
      done();
      return true;
    }
    case "tremor": {
      payCost(p, def);
      const dropped: { it: ItemInstance; at: string }[] = [];
      const hit: string[] = [];
      for (const q of shareRegion(state, p)) {
        q.stamina = Math.max(0, q.stamina - 1);
        hit.push(q.name);
        const pool = q.items.filter(movable);
        if (!pool.length) continue;
        const it = pick(state, pool);
        removeItem(state, q, it.uid);
        dropped.push({ it, at: state.picks[q.id]!.card });
      }
      dropped.sort((a, b) => itemValue(b.it) - itemValue(a.it));
      const best = dropped.shift();
      if (best) addItem(state, p, { ...best.it, origin: "dropped" });
      for (const d of dropped) (state.dropped[d.at] ??= []).push({ ...d.it, origin: "dropped" });
      log(state, `${p.name}'s Tremor shakes ${hit.join(" and ")}: each loses 1 stamina${dropped.length + (best ? 1 : 0) ? " and drops an item" : ""}.${best ? ` ${p.name} picks up the ${Content.item[best.it.id].name}.` : ""}`);
      done();
      return true;
    }
    case "mountain-heart": {
      payCost(p, def);
      p.stats.brawn = Math.min(Content.rules.character.statCap + 1, p.stats.brawn + 1);
      p.boons.push({ kind: "maxStamina", amount: 1 });
      recomputeMax(state, p);
      restoreStamina(p, 1);
      log(state, `${p.name} finds the Mountain Heart: +1 Brawn and +1 max stamina for the rest of the game.`);
      done();
      return true;
    }
    case "the-shared-dream": {
      payCost(p, def);
      state.sharedDream = state.round + 1;
      log(state, `${p.name} weaves the Shared Dream. Next round, 1s count as successes, and two 6s cause a Mishap, for everyone.`);
      done();
      return true;
    }
    // ---- roll-time and pick-time powers are carried out by the engine ------
    case "stampede":
    case "the-walking-cottage":
    case "build-a-bridge":
    case "dream-peek":
      payCost(p, def);
      done();
      return true;
  }
  return false;
}

function forge(state: GameState, p: PlayerState, it: ItemInstance, stat: Stat): void {
  removeItem(state, p, it.uid);
  const gear = newItem(state, "reforged-gear", { origin: "crafted" });
  gear.forged = stat;
  addItem(state, p, gear);
  log(state, `The ${Content.item[it.id].name} is reforged into gear: +1 die on ${stat} rolls for the rest of the game.`);
  record(state, p, { type: "reforge", stat });
}

export function itemLabel(it: ItemInstance): string {
  const name = Content.item[it.id]?.name ?? it.id;
  return it.forged ? `${name} (+1 ${it.forged.charAt(0).toUpperCase() + it.forged.slice(1)})` : name;
}

/** Spring any class wards at a location on the player who just arrived there. */
export function springWards(state: GameState, p: PlayerState, location: string): void {
  const here = state.wards.filter((w) => w.location === location && w.owner !== p.id);
  if (!here.length) return;
  state.wards = state.wards.filter((w) => !here.includes(w));
  for (const w of here) {
    const owner = state.players[w.owner];
    const def = powerDef(w.kind)!;
    const prm = def.params ?? {};
    if (p.untargetable) {
      log(state, `Something was waiting for ${p.name} at ${cardName(location)}, but it can't touch them.`);
      continue;
    }
    gstat(state, "wardsSprung");
    let txt = "";
    switch (w.kind) {
      case "sic-em":
      case "living-gargoyle": {
        const stat = bestStat(p, prm.stats ?? ["brawn"]);
        const dice = roll(state, p.stats[stat]);
        const ok = countSuccesses(dice, false, dreaming(state)) >= (prm.need ?? 2);
        const foe = w.kind === "sic-em" ? `a guard-beast` : "a living gargoyle";
        if (ok) txt = `faces ${foe} and gets past it (${stat}: ${dice.join(" ") || "no dice"})`;
        else {
          txt = `is attacked by ${foe} (${stat}: ${dice.join(" ") || "no dice"}) and takes ${prm.damage ?? 2} damage`;
          damage(state, p, prm.damage ?? 2, "other");
        }
        break;
      }
      case "haunt":
        p.haunted += -(prm.dice ?? -1);
        owner.coin += prm.coin ?? 1;
        txt = `is haunted: ${-(prm.dice ?? -1)} fewer die this turn`;
        break;
      case "hex-the-path":
        p.trouble = { amount: p.trouble.amount + (prm.trouble ?? 2), rolls: Math.max(1, p.trouble.rolls) };
        txt = `walks into a hex: ${prm.trouble ?? 2} Trouble dice on this roll`;
        break;
    }
    log(state, `${p.name} ${txt} at ${cardName(location)}.`);
    log(state, `Your ${def.name} caught ${p.name}.`, [owner.id]);
    record(state, p, { type: "springWard", ward: w.kind, location });
    record(state, owner, { type: "wardSprungByRival", ward: w.kind, victim: p.id });
  }
}

/** Phoenix: the first time the Pyromancer would be Downed, they rise instead. */
export function phoenix(state: GameState, p: PlayerState): boolean {
  if (!hasPower(p, "phoenix") || signatureUsed(p, "phoenix")) return false;
  markSignature(p, "phoenix");
  p.health = p.maxHealth;
  p.stamina = p.maxStamina;
  gstat(state, "power:phoenix");
  log(state, `${p.name} bursts into flame and rises like a Phoenix, with full health and stamina!`);
  record(state, p, { type: "usePower", power: "phoenix" });
  return true;
}

/** Bluff: each milestone the Trickster claims plants a fake tag. */
export function plantDecoy(state: GameState, p: PlayerState, realTags: string[]): void {
  if (!hasPower(p, "bluff")) return;
  const fake = ["forest", "meadow", "swamp", "mountain", "ruins", "creature", "peril"].filter((t) => !realTags.includes(t) && !p.decoys.includes(t as any));
  if (!fake.length) return;
  const t = pick(state, fake) as any;
  p.decoys.push(t);
  log(state, `You drop a fake milestone: the next rival to learn about your mission will hear "${t}".`, [p.id]);
}

/** Forager: successes at these tags give the Cook an ingredient. */
export function forage(state: GameState, p: PlayerState, tags: string[]): void {
  const def = powersOf(p).find((x) => x.id === "forager");
  if (!def) return;
  if (!tags.some((t) => (def.params?.tags ?? []).includes(t))) return;
  p.ingredients += 1;
  log(state, `${p.name} forages an ingredient (${p.ingredients} now).`);
}

/** Possession: if a Ghost has claimed this rival's next draw, the Ghost picks. */
export function possessor(state: GameState, rivalId: number): number | undefined {
  return state.possess[rivalId];
}

export function heirloomId(it: ItemInstance): string {
  return it.forged ? `${it.id}:${it.forged}` : it.id;
}

export type { CardInstance };
export { isTreasure, makeFrog };
