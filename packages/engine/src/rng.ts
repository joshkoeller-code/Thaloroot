import type { GameState } from "./types.js";

/** mulberry32: small, fast, and its whole state is one 32-bit number we keep in GameState. */
export function next(state: GameState): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function int(state: GameState, lo: number, hi: number): number {
  return lo + Math.floor(next(state) * (hi - lo + 1));
}

/** A die roll. Tests and scripted tutorials can queue results in state.scriptedDice. */
export function d6(state: GameState): number {
  if (state.scriptedDice?.length) return state.scriptedDice.shift()!;
  return int(state, 1, 6);
}

export function roll(state: GameState, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(d6(state));
  return out;
}

export function pick<T>(state: GameState, xs: T[]): T {
  return xs[Math.floor(next(state) * xs.length)];
}

export function shuffle<T>(state: GameState, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(next(state) * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

export function sample<T>(state: GameState, xs: T[], n: number): T[] {
  return shuffle(state, [...xs]).slice(0, n);
}

export function seedFrom(seed: number): number {
  // scramble small seeds so seed 1 and seed 2 start far apart
  let h = seed ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

/** P(at least k successes on n dice), success on 5 or 6. */
export function pAtLeast(n: number, k: number): number {
  if (k <= 0) return 1;
  if (n < k) return 0;
  const p = 1 / 3;
  let total = 0;
  for (let i = k; i <= n; i++) total += comb(n, i) * p ** i * (1 - p) ** (n - i);
  return total;
}

function comb(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
