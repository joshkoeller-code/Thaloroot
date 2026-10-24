import { Content } from "./content.js";
import type { GameState, Hook, ItemInstance, PlayerState, Stat, Tag } from "./types.js";
import { STATS } from "./types.js";

export interface SourcedHook extends Hook {
  source: string; // "class" | "species" | "item:<uid>" | "companion:<id>" | "quirk:<name>"
}

/** Every passive hook currently affecting a player. */
export function hooksOf(state: GameState, p: PlayerState): SourcedHook[] {
  const out: SourcedHook[] = [];
  if (p.cls) for (const h of Content.cls[p.cls]?.hooks ?? []) out.push({ ...h, source: "class" });
  for (const h of Content.speciesById[p.species]?.hooks ?? []) out.push({ ...h, source: "species" });
  const gearOff = worldMods(state).some((m) => m.kind === "gearOff");
  for (const it of p.items) {
    const def = Content.item[it.id];
    if (!def?.passive) continue;
    if (gearOff && def.type === "gear") continue;
    for (const h of def.passive) out.push({ ...h, source: `item:${it.uid}` });
  }
  for (const c of p.companions) {
    for (const h of Content.companion[c.id]?.passive ?? []) out.push({ ...h, source: `companion:${c.id}` });
  }
  for (const q of p.quirks) for (const h of q.quirk) out.push({ ...h, source: `quirk:${q.name}` });
  return out;
}

export function hooks(state: GameState, p: PlayerState, kind: string): SourcedHook[] {
  return hooksOf(state, p).filter((h) => h.kind === kind);
}

export function has(state: GameState, p: PlayerState, kind: string): boolean {
  return hooks(state, p, kind).length > 0;
}

/** Use a once-per-game hook if one is available. Returns true if used. */
export function useOnce(state: GameState, p: PlayerState, kind: string): boolean {
  for (const h of hooks(state, p, kind)) {
    const key = `${kind}@${h.source}`;
    if (!p.oncePerGame.includes(key)) {
      p.oncePerGame.push(key);
      return true;
    }
  }
  return false;
}

export function worldMods(state: GameState): Hook[] {
  return state.mods.flatMap((m) => m.mods);
}

export function isTreasure(it: ItemInstance): boolean {
  const d = Content.item[it.id];
  return !!d && (d.type === "treasure" || d.type === "light") && d.coin > 0;
}

export function treasures(p: PlayerState): ItemInstance[] {
  return p.items.filter(isTreasure);
}

export function hasLight(state: GameState, p: PlayerState): boolean {
  return p.items.some((i) => Content.item[i.id]?.type === "light") || has(state, p, "lightSource");
}

export function companionLimit(state: GameState, p: PlayerState): number {
  const h = hooks(state, p, "companionLimit");
  return h.length ? Math.max(...h.map((x) => x.amount)) : Content.rules.companions.limit;
}

export function itemCap(state: GameState, p: PlayerState): number {
  const h = hooks(state, p, "itemCap");
  return h.length ? Math.min(...h.map((x) => x.amount)) : Infinity;
}

export function recomputeMax(state: GameState, p: PlayerState): void {
  const kit = Content.rules.startingKit;
  p.maxHealth = kit.health + hooks(state, p, "maxHealth").reduce((s, h) => s + h.amount, 0);
  p.maxStamina = kit.stamina + hooks(state, p, "maxStamina").reduce((s, h) => s + h.amount, 0);
  p.health = Math.min(p.health, p.maxHealth);
  p.stamina = Math.min(p.stamina, p.maxStamina);
}

export function isNight(state: GameState): boolean {
  return state.night;
}

/** Does a hook's location/stat/time filter match this roll? */
export function hookMatches(
  state: GameState,
  p: PlayerState,
  h: Hook,
  ctx: { stat?: Stat | null; tags?: Tag[]; monster?: boolean; optionKind?: string },
): boolean {
  if (h.stat && h.stat !== ctx.stat) return false;
  if (h.optionKind && h.optionKind !== ctx.optionKind) return false;
  if (h.tags && !(ctx.tags ?? []).some((t) => h.tags.includes(t))) return false;
  if (h.when === "night" && !isNight(state)) return false;
  if (h.requiresLight && !hasLight(state, p)) return false;
  if (h.classes && !(p.cls && h.classes.includes(p.cls))) return false;
  return true;
}

export function bestStat(p: PlayerState, among: Stat[] = STATS): Stat {
  return among.reduce((a, b) => (p.stats[b] > p.stats[a] ? b : a));
}

export function addItem(state: GameState, p: PlayerState, inst: ItemInstance): boolean {
  if (p.items.length >= itemCap(state, p)) {
    // Ghost carries only 3: drop the least valuable to make room if the new one is better
    const worst = [...p.items].sort((a, b) => (Content.item[a.id]?.vp ?? 0) - (Content.item[b.id]?.vp ?? 0))[0];
    if (!worst || (Content.item[worst.id]?.vp ?? 0) >= (Content.item[inst.id]?.vp ?? 0)) return false;
    p.items.splice(p.items.indexOf(worst), 1);
  }
  p.items.push(inst);
  const def = Content.item[inst.id];
  if (def?.unique && !state.takenUniques.includes(inst.id)) state.takenUniques.push(inst.id);
  if (def?.passive?.some((h) => h.kind === "maxHealth" || h.kind === "maxStamina")) recomputeMax(state, p);
  return true;
}

export function removeItem(state: GameState, p: PlayerState, uid: number): ItemInstance | null {
  const i = p.items.findIndex((x) => x.uid === uid);
  if (i < 0) return null;
  const [it] = p.items.splice(i, 1);
  const def = Content.item[it.id];
  if (def?.passive?.some((h) => h.kind === "maxHealth" || h.kind === "maxStamina")) recomputeMax(state, p);
  return it;
}

export function rivals(state: GameState, p: PlayerState): PlayerState[] {
  return state.players.filter((q) => q.id !== p.id);
}

export function bump(p: PlayerState, key: string, n = 1): void {
  p.log[key] = (p.log[key] ?? 0) + n;
}

export function gstat(state: GameState, key: string, n = 1): void {
  state.stats[key] = (state.stats[key] ?? 0) + n;
}
