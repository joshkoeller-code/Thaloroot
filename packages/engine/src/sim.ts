/** Bot-vs-bot games and batch statistics, for balance checks. */
import { botAction } from "./bots.js";
import { Content } from "./content.js";
import { createGame, step } from "./engine.js";
import type { BotPersona, GameConfig, GameLength, GameState, Stat } from "./types.js";
import { STATS } from "./types.js";

const NAMES = ["Mara", "Tobias", "Wren", "Bram", "Isolde", "Fennick", "Juniper", "Oswin"];
const PERSONAS: BotPersona[] = ["friendly", "aggressive", "cautious", "aggressive", "balanced", "friendly", "cautious", "balanced"];

/** Small deterministic generator for setting up characters (not used during play). */
function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function randomCharacter(seed: number, i: number): GameConfig["players"][number] {
  const r = lcg(seed * 31 + i * 7919);
  const stats = { brawn: 1, wits: 1, charm: 1, spark: 1, luck: 1 } as Record<Stat, number>;
  let pts = Content.rules.character.creationPoints;
  while (pts > 0) {
    const s = STATS[Math.floor(r() * 5)];
    if (stats[s] < Content.rules.character.creationMax) {
      stats[s]++;
      pts--;
    }
  }
  const species = Content.species[Math.floor(r() * Content.species.length)].id;
  return { name: NAMES[i % NAMES.length], species, stats, bot: PERSONAS[i % PERSONAS.length] };
}

/** The four characters from Playtests 1-4, so engine numbers can be compared with the Python simulator. */
export function playtestCharacters(): GameConfig["players"] {
  const base: [string, Record<Stat, number>][] = [
    ["bramblebeast-tamer", { charm: 4, brawn: 2, wits: 2, spark: 1, luck: 3 }],
    ["lantern-hour-thief", { wits: 4, luck: 3, charm: 2, brawn: 1, spark: 2 }],
    ["cinder-heart-pyromancer", { spark: 4, brawn: 2, wits: 2, luck: 2, charm: 2 }],
    ["moss-footed-geomancer", { brawn: 4, wits: 2, luck: 2, charm: 2, spark: 2 }],
  ];
  return base.map(([cls, stats], i) => ({ name: NAMES[i], species: "humans", stats, bot: PERSONAS[i], cls }));
}

/** The 12 missions the Python simulator modeled in Playtests 1-4. */
export const PLAYTEST_MISSIONS = [
  "moth-queens-lullaby", "mushroom-census", "mudlarks-fortune", "picnic-on-the-hill",
  "the-drowned-kings-crown", "graftwrights-folly", "echoes-in-the-old-stones", "the-cloud-kite-race",
  "steal-the-dragons-hiccup", "climb-the-great-thalowood", "frostroot-peak", "heir-of-the-gardener-kings",
];

export interface RunOptions {
  seed: number;
  length?: GameLength;
  players?: number;
  /** Playtest 1-4 setup: four fixed characters and classes, the 12 simulated missions. */
  playtest?: boolean;
  classPool?: string[];
  missionPool?: string[];
  maxSteps?: number;
}

export function runGame(opts: RunOptions): GameState {
  const n = opts.players ?? 4;
  const config: GameConfig = {
    seed: opts.seed,
    length: opts.length ?? "quick",
    players: opts.playtest ? playtestCharacters() : Array.from({ length: n }, (_, i) => randomCharacter(opts.seed, i)),
    classPool: opts.classPool,
    missionPool: opts.missionPool ?? (opts.playtest ? PLAYTEST_MISSIONS : undefined),
  };
  const state = createGame(config);
  let guard = opts.maxSteps ?? 20000;
  while (state.phase !== "over") {
    const d = state.pending[0];
    if (!d) throw new Error(`stuck in phase ${state.phase} with nothing pending (round ${state.round})`);
    step(state, botAction(state, d));
    if (--guard <= 0) throw new Error(`game ${opts.seed} did not finish`);
  }
  return state;
}

export interface BatchStats {
  games: number;
  length: GameLength;
  players: number;
  rows: Row[];
  perGame: Record<string, number>[];
}

interface Row {
  game: number;
  win: boolean;
  margin: number | null;
  cls: string;
  mission: string;
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
  log: Record<string, number>;
  items: number;
  companions: number;
  grown: number;
}

export function runBatch(n: number, opts: Omit<RunOptions, "seed"> & { seedBase?: number }): BatchStats {
  const rows: Row[] = [];
  const perGame: Record<string, number>[] = [];
  for (let g = 0; g < n; g++) {
    const s = runGame({ ...opts, seed: (opts.seedBase ?? 1) + g * 7919 });
    const sorted = [...s.scores!].sort((a, b) => b.total - a.total || b.coin - a.coin);
    for (const line of s.scores!) {
      const p = s.players[line.player];
      rows.push({
        game: g,
        win: s.winner!.includes(line.player),
        margin: sorted[0].player === line.player ? sorted[0].total - sorted[1].total : null,
        cls: line.cls ?? "",
        mission: line.mission ?? "",
        tier: line.tier,
        milestones: line.milestones,
        finale: line.finale,
        flourish: line.flourish,
        first: line.first,
        missionVp: line.missionVp,
        treasureVp: line.treasureVp,
        guessVp: line.guessVp,
        fragmentVp: line.fragmentVp,
        bonusVp: line.bonusVp,
        total: line.total,
        coin: line.coin,
        correctGuesses: line.correctGuesses,
        log: p.log,
        items: p.items.length,
        companions: p.companions.length,
        grown: p.grownThisGame,
      });
    }
    perGame.push({ ...s.stats, rounds: s.round, firstFinishRound: s.stats.firstFinishRound ?? 0 });
  }
  return { games: n, length: opts.length ?? "quick", players: opts.players ?? 4, rows, perGame };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const pct = (x: number) => `${Math.round(100 * x)}%`;
const f1 = (x: number) => x.toFixed(1);

export interface Summary {
  rounds: number;
  winningScore: number;
  margin: number;
  missionVp: number;
  treasureVp: number;
  guessVp: number;
  fragmentVp: number;
  bonusVp: number;
  finaleRate: number;
  finisherRate: number;
  firstFinishRound: number;
  meetings: number;
  byTier: Record<number, { milestones: number; finale: number; total: number; win: number }>;
  byClass: Record<string, { win: number; avg: number; n: number }>;
  byMission: Record<string, { finale: number; milestones: number; win: number; n: number }>;
  perPlayer: Record<string, number>;
  perGame: Record<string, number>;
}

export function summarize(b: BatchStats): Summary {
  const R = b.rows;
  const winners = R.filter((r) => r.margin !== null);
  const byTier: Summary["byTier"] = {};
  for (const t of [1, 2, 3]) {
    const sub = R.filter((r) => r.tier === t);
    byTier[t] = {
      milestones: mean(sub.map((r) => r.milestones)),
      finale: mean(sub.map((r) => +r.finale)),
      total: mean(sub.map((r) => r.total)),
      win: mean(sub.map((r) => +r.win)),
    };
  }
  const group = <K extends string>(key: (r: Row) => K) => {
    const out: Record<string, Row[]> = {};
    for (const r of R) (out[key(r)] ??= []).push(r);
    return out;
  };
  const byClass: Summary["byClass"] = {};
  for (const [k, sub] of Object.entries(group((r) => r.cls)))
    byClass[k] = { win: mean(sub.map((r) => +r.win)), avg: mean(sub.map((r) => r.total)), n: sub.length };
  const byMission: Summary["byMission"] = {};
  for (const [k, sub] of Object.entries(group((r) => r.mission)))
    byMission[k] = { finale: mean(sub.map((r) => +r.finale)), milestones: mean(sub.map((r) => r.milestones)), win: mean(sub.map((r) => +r.win)), n: sub.length };
  const perPlayer: Record<string, number> = {};
  for (const k of ["attempts", "successes", "rests", "pushes", "mishaps", "downed", "rations", "itemsUsed"])
    perPlayer[k] = mean(R.map((r) => r.log[k] ?? 0));
  perPlayer.coin = mean(R.map((r) => r.coin));
  perPlayer.items = mean(R.map((r) => r.items));
  perPlayer.companions = mean(R.map((r) => r.companions));
  perPlayer.grown = mean(R.map((r) => r.grown));
  perPlayer.correctGuesses = mean(R.map((r) => r.correctGuesses));
  perPlayer.flourish = mean(R.map((r) => +r.flourish));
  const perGame: Record<string, number> = {};
  const keys = new Set(b.perGame.flatMap((g) => Object.keys(g)));
  for (const k of keys) perGame[k] = mean(b.perGame.map((g) => g[k] ?? 0));
  const ff = b.perGame.map((g) => g.firstFinishRound).filter((x) => x > 0);
  return {
    rounds: perGame.rounds,
    winningScore: mean(winners.map((r) => r.total)),
    margin: mean(winners.map((r) => r.margin!)),
    missionVp: mean(R.map((r) => r.missionVp)),
    treasureVp: mean(R.map((r) => r.treasureVp)),
    guessVp: mean(R.map((r) => r.guessVp)),
    fragmentVp: mean(R.map((r) => r.fragmentVp)),
    bonusVp: mean(R.map((r) => r.bonusVp)),
    finaleRate: mean(R.map((r) => +r.finale)),
    finisherRate: ff.length / b.games,
    firstFinishRound: mean(ff),
    meetings: perGame.meetings ?? 0,
    byTier,
    byClass,
    byMission,
    perPlayer,
    perGame,
  };
}

export function report(b: BatchStats): string {
  const s = summarize(b);
  const name = (id: string) => Content.cls[id]?.name ?? Content.mission[id]?.name ?? id;
  const lines = [
    `Games: ${b.games}, ${b.players} players, ${b.length} (${Content.deckCounts[b.length].worldCards} World cards)`,
    `Rounds per game: ${f1(s.rounds)}`,
    `Winning score: ${f1(s.winningScore)}, win margin over 2nd: ${f1(s.margin)}`,
    "",
    "VP sources (average per player):",
    `  missions ${f1(s.missionVp)}, kept treasure ${f1(s.treasureVp)}, guesses ${f1(s.guessVp)}, fragments ${f1(s.fragmentVp)}, finale/other ${f1(s.bonusVp)}`,
    "",
    "Missions:",
    `  finale completed by ${pct(s.finaleRate)} of players; someone finishes in ${pct(s.finisherRate)} of games (round ${f1(s.firstFinishRound)})`,
    `  flourish earned by ${pct(s.perPlayer.flourish)} of players`,
    ...[1, 2, 3].map(
      (t) =>
        `  tier ${t}: milestones ${f1(s.byTier[t].milestones)}/3, finale ${pct(s.byTier[t].finale)}, avg total ${f1(s.byTier[t].total)}, win ${pct(s.byTier[t].win)}`,
    ),
    "",
    "By class:",
    ...Object.entries(s.byClass)
      .sort((a, b) => b[1].win - a[1].win)
      .map(([k, v]) => `  ${name(k).padEnd(28)} win ${pct(v.win).padStart(4)}  avg ${f1(v.avg).padStart(5)}  (n=${v.n})`),
    "",
    "By mission (finale rate, lowest first):",
    ...Object.entries(s.byMission)
      .sort((a, b) => a[1].finale - b[1].finale)
      .map(([k, v]) => `  ${name(k).padEnd(34)} finale ${pct(v.finale).padStart(4)}  milestones ${f1(v.milestones)}  win ${pct(v.win).padStart(4)}  (n=${v.n})`),
    "",
    "Per player per game: " + Object.entries(s.perPlayer).map(([k, v]) => `${k} ${f1(v)}`).join(", "),
    "Per game: " +
      Object.entries(s.perGame)
        .filter(([k]) => !k.startsWith("world:") && k !== "firstFinishRound")
        .sort()
        .map(([k, v]) => `${k} ${f1(v)}`)
        .join(", "),
  ];
  return lines.join("\n");
}
