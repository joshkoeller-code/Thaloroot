# Thaloroot

A whimsical, competitive, GM-less tabletop RPG, and the code for its digital version.

Thaloroot is a realm where magic (thal) flows beneath the earth. Each game is one Bloom: treasures sprout, creatures wake, and 2 to 8 rival adventurers chase secret missions across the Forest, Meadow, Swamp, Mountain, and Ruins. The design lives in the Thaloroot Game Design doc; this repository turns it into data and a rules engine, and will grow into a phone-and-TV web game.

## What's here

```
content/            Game content as JSON, generated from the design doc
  source/           The doc exports the JSON is built from (Explore Cards, Missions, World Cards, Items, Classes)
  explore-cards.json  54 locations (63 cards with copies), every option with structured effects
  missions.json       51 missions with machine-checkable milestones, finales, and flourishes
  world-cards.json    65 World cards: weather, monsters, merchants, rumors, chaos, escalations, finales
  items.json, companions.json, classes.json, species.json, taproot-fragments.json
  rules.json          The Playtest 4 numbers: dice, VP tables, Lessons, traps, merchants, game lengths
packages/engine/    The rules engine (TypeScript): state machine, bots, simulator, tests
tools/              Python scripts that build content/*.json from the doc exports
docs/               How mission conditions work, rules interpretations, and balance baselines
```

## Quick start

You need Node 20 or newer (and Python 3 only if you rebuild the content).

```sh
npm install
npm test            # 95 tests: content checks, every mission is completable, rules, balance guardrails
npm run sim -- --games 500                      # bot games with the full content, Quick length
npm run sim -- --games 500 --playtest           # the Playtest 1-4 setup, to compare with the playtest log
npm run sim -- --games 200 --length long --players 6
npm run sim -- --log --seed 7                   # one game, every event narrated
```

A thousand bot games take about 7 seconds.

## The rules engine

The engine is a serializable state machine. Everything about a game, including the random number generator, lives in one plain `GameState` object, so a game can be saved, sent to phones, or replayed from its seed.

```ts
import { createGame, step, botAction, viewFor } from "@thaloroot/engine";

const state = createGame({
  seed: 42,
  length: "quick",
  players: [
    { name: "Mara", species: "mossfolk", stats: { brawn: 2, wits: 2, charm: 4, spark: 1, luck: 3 } },
    { name: "Tobias", species: "foxfolk", stats: { brawn: 1, wits: 4, charm: 2, spark: 2, luck: 3 }, bot: "aggressive" },
  ],
});

// state.pending lists who must decide what: a class, a teaser, Ally/Brawl/Pass, an option, a push...
const decision = state.pending[0];
step(state, botAction(state, decision)); // or an action from a player's phone

const phoneView = viewFor(state, 0); // only what Mara may see
const tvView = viewFor(state, "tv"); // only what the table may see
```

Each round follows the Quick-Start Rules: secret teaser picks, a simultaneous reveal, Meetings (Ally, Brawl, or Pass), turns in order (restore stamina, face monsters, spring traps, choose an option, roll, push your luck, take the reward or Lessons instead, one quick action), then a World card. Missions are tracked automatically from game events, the Finale moves up when the first player finishes, and the game ends with mission guesses and scoring.

The bots are heuristic players ported from the playtest simulator and taught every decision. They exist to stress the rules and produce balance numbers, not to play well.

## Content pipeline

The design doc is the source of truth. To update content after editing the doc, export the changed tabs into `content/source/` and run:

```sh
npm run content          # or: python3 tools/build_content.py --check
```

The build parses card text into effects ("Success: Bog Pearl (4 / 2)" becomes `{ "type": "item", "item": "bog-pearl" }`), attaches mission conditions from `tools/mission_rules.py`, and fails if the counts are wrong. `--check` also compares the explore cards against the Python simulator's encoding from the playtests. `python3 tools/print_cards.py Swamp` prints any cards' parsed effects for review.

## What's automated

All dice, stamina, Lessons and growth, Meetings and Brawls, traps, stealing, Downed, companions, items' passive bonuses and one-use effects, Taproot Fragments, every World card, monsters, merchants and the market, Rumors, finales, all 51 missions (milestones, finales with finale grace, and flourishes), mission guesses, and scoring. Class and species passives and weaknesses are automated; class actives and signature moves are still text only. [docs/rules-notes.md](docs/rules-notes.md) lists every interpretation the engine makes and every gap.

## Balance baseline

With the full content (51 missions, 14 classes, random characters), the engine's bot games land within a round or a few points of the Playtest 4 log on almost every number: a Quick game runs about 12 rounds, 29% of players finish their finale, and missions out-earn kept treasure 13.7 to 12.2 VP. Full numbers and the findings worth a Playtest 5 are in [docs/balance-baseline.md](docs/balance-baseline.md).

## Roadmap

1. **Rules engine** (this step): content as data, the engine, bots, simulator, tests.
2. **Pass-and-play prototype**: one browser screen, players take turns on the same device.
3. **Multiplayer**: phones as private hands, a shared TV dashboard, a room code to join.
4. **Accounts and carryover**: characters that keep their growth, quirks, and heirlooms between games.
5. **Polish**: art, sound, animation, onboarding.
