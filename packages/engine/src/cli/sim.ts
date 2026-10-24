/**
 * Bot-vs-bot balance runs.
 *
 *   npm run sim -- --games 500 --length quick --players 4
 *   npm run sim -- --playtest            # the four Playtest 1-4 characters and classes
 *   npm run sim -- --log --seed 7        # one game, full log
 *   npm run sim -- --json > out.json     # machine-readable summary
 */
import { report, runBatch, runGame, summarize } from "../sim.js";
import type { GameLength } from "../types.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const length = opt("length", "quick") as GameLength;
const players = Number(opt("players", "4"));
const playtest = flag("playtest");

if (flag("log")) {
  const s = runGame({ seed: Number(opt("seed", "7")), length, players, playtest });
  for (const e of s.log) console.log(`[r${e.round}]${e.private ? " (private)" : ""} ${e.text}`);
  console.log();
  for (const l of [...s.scores!].sort((a, b) => b.total - a.total)) console.log(l);
} else {
  const t0 = Date.now();
  const b = runBatch(Number(opt("games", "500")), { length, players, playtest, seedBase: Number(opt("seed", "1")) });
  if (flag("json")) console.log(JSON.stringify(summarize(b), null, 2));
  else {
    console.log(report(b));
    console.log(`\n(${b.games} games in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
}
