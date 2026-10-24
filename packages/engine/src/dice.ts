import { Content } from "./content.js";
import { hookMatches, hooksOf, worldMods } from "./player.js";
import type { ExploreCard, ExploreOption, GameState, PlayerState, Stat } from "./types.js";

export interface DiceBreakdown {
  total: number;
  parts: { source: string; dice: number }[];
}

/**
 * Dice a player rolls on an option before tokens, pushes, Meetings, and Assist.
 * Every bonus is itemized so the UI can show where the dice came from.
 */
export function dicePool(state: GameState, p: PlayerState, card: ExploreCard, opt: ExploreOption, stat: Stat): DiceBreakdown {
  const parts: { source: string; dice: number }[] = [{ source: stat, dice: p.stats[stat] }];
  const ctx = { stat, tags: card.tags, optionKind: opt.kind };
  for (const h of hooksOf(state, p)) {
    if (h.kind !== "dice" || !hookMatches(state, p, h, ctx)) continue;
    parts.push({ source: h.source, dice: h.amount });
  }
  for (const h of worldMods(state)) {
    if (h.kind !== "dice" || !hookMatches(state, p, h, ctx)) continue;
    parts.push({ source: "world", dice: h.amount });
  }
  if (p.heatReady) parts.push({ source: "heat", dice: 3 });
  if (p.nextRollDice) parts.push({ source: "item", dice: p.nextRollDice });
  if (p.stink) parts.push({ source: "stinkbomb", dice: -2 });
  const total = Math.max(0, parts.reduce((s, x) => s + x.dice, 0));
  return { total, parts };
}

export function needFor(state: GameState, card: ExploreCard, opt: ExploreOption): number {
  let need = opt.need;
  for (const h of worldMods(state)) {
    if (h.kind !== "need") continue;
    if (h.tags && !card.tags.some((t) => h.tags.includes(t))) continue;
    need += h.amount;
  }
  return need;
}

export function staminaFor(state: GameState, p: PlayerState, card: ExploreCard, opt: ExploreOption, stat?: Stat): number {
  if (opt.rest) return 0;
  let s = opt.stamina;
  const all = [...worldMods(state), ...hooksOf(state, p)];
  for (const h of all) {
    if (h.kind !== "stamina") continue;
    if (h.tags && !card.tags.some((t) => h.tags.includes(t))) continue;
    if (h.stat && h.stat !== (stat ?? opt.stats[0])) continue;
    s += h.amount;
  }
  return Math.max(0, s);
}

/** Stats a player may roll for this option (listed stats, plus any stat with Flow). */
export function allowedStats(state: GameState, p: PlayerState, opt: ExploreOption): Stat[] {
  if (opt.rest) return [];
  const flow =
    (hooksOf(state, p).some((h) => h.kind === "flow") && !p.flowUsed) ||
    (hooksOf(state, p).some((h) => h.kind === "flowOnce") && !p.oncePerGame.some((k) => k.startsWith("flowOnce@")));
  if (flow) return ["brawn", "wits", "charm", "spark", "luck"];
  return opt.stats;
}

export function countSuccesses(dice: number[], surge: boolean): number {
  return dice.reduce((s, d) => s + (d >= 5 ? (surge ? 2 : 1) : 0), 0);
}

export function sparkTriggered(state: GameState, dice: number[], card: ExploreCard, needs: number): boolean {
  const pollen = worldMods(state).some((m) => m.kind === "sparkOnFive" && (!m.tags || card.tags.some((t) => m.tags.includes(t))));
  const sparks = dice.filter((d) => d === 6 || (pollen && d === 5)).length;
  return sparks >= needs;
}

export function isMishap(dice: number[]): boolean {
  return dice.filter((d) => d === 1).length >= Content.rules.dice.mishapOnes;
}
