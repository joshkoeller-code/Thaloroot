import { botAction } from "../src/bots.js";
import { Content } from "../src/content.js";
import { createGame, step } from "../src/engine.js";
import type { Action, Decision, GameConfig, GameState, Stat } from "../src/types.js";

export const STATS4: Record<Stat, number> = { brawn: 3, wits: 3, charm: 2, spark: 2, luck: 2 };

export function sheets(n: number, classes: string[] = []): GameConfig["players"] {
  return Array.from({ length: n }, (_, i) => ({
    name: ["Ada", "Bo", "Cy", "Di", "Ed", "Fy", "Gus", "Hal"][i],
    species: "humans",
    stats: { ...STATS4 },
    bot: "balanced" as const,
    ...(classes[i] ? { cls: classes[i] } : {}),
  }));
}

/**
 * A game at the start of round 1 with the given classes and missions.
 * `hands[i]` are explore card ids dealt to seat i (in turn order) for round 1.
 */
export function setup(opts: {
  players?: number;
  classes?: string[];
  missions?: string[];
  hands?: string[][];
  seed?: number;
  length?: GameConfig["length"];
}): GameState {
  const n = opts.players ?? 2;
  const s = createGame({ seed: opts.seed ?? 1, length: opts.length ?? "quick", players: sheets(n, opts.classes ?? []) });
  while (s.phase === "classDraft") step(s, botAction(s, s.pending[0]));
  // rig the explore deck before the last mission choice deals round 1
  if (opts.hands) {
    const order = Array.from({ length: n }, (_, i) => (s.firstPlayer + i) % n);
    const stack: { uid: number; card: string }[] = [];
    for (const pid of order) {
      const hand = opts.hands[pid] ?? [];
      for (const c of hand) {
        if (!Content.card[c]) throw new Error(`no card ${c}`);
        stack.push({ uid: ++s.uid, card: c });
      }
    }
    s.exploreDeck.push(...stack.reverse());
  }
  for (const d of [...s.pending]) {
    const mission = opts.missions?.[d.player] ?? d.data.options[0];
    // allow any mission in tests, even if it wasn't dealt
    d.data.options.push(mission);
    step(s, { player: d.player, kind: "chooseMission", mission });
  }
  return s;
}

export function pending(s: GameState, player: number, kind?: Decision["kind"]): Decision {
  const d = s.pending.find((x) => x.player === player && (!kind || x.kind === kind));
  if (!d) throw new Error(`no pending ${kind ?? "decision"} for ${player}; pending: ${JSON.stringify(s.pending.map((x) => [x.player, x.kind]))}`);
  return d;
}

/** Pick, for each player, the hand card with this id. */
export function pickAll(s: GameState, picks: Record<number, string>): void {
  for (const [pid, card] of Object.entries(picks)) {
    const d = pending(s, Number(pid), "pickTeaser");
    const c = d.data.cards.find((x: any) => x.card === card);
    if (!c) throw new Error(`player ${pid} wasn't dealt ${card}`);
    step(s, { player: Number(pid), kind: "pickTeaser", card: c.uid });
  }
}

/** Let bots answer everything until `stop` returns true (or the game ends). */
export function botsUntil(s: GameState, stop: (s: GameState) => boolean, max = 5000): void {
  while (s.phase !== "over" && !stop(s) && max-- > 0) step(s, botAction(s, s.pending[0]));
}

export function act(s: GameState, a: Action): void {
  step(s, a);
}

export function optionIndex(s: GameState, player: number, name: string): number {
  const d = pending(s, player, "chooseOption");
  const o = d.data.options.find((x: any) => x.name === name);
  if (!o) throw new Error(`no option ${name}; have ${d.data.options.map((x: any) => x.name).join(", ")}`);
  return o.index;
}
