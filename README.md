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
packages/server/    Game rooms: the TV, the phones, and computer players kept in sync, plus a local server
apps/web/           The web app (React + Vite): TV board, phone hands, and pass-and-play on one screen
tools/              Python scripts that build content/*.json from the doc exports
docs/               How mission conditions work, rules interpretations, and balance baselines
```

## Quick start

You need Node 20 or newer (and Python 3 only if you rebuild the content).

```sh
npm install
npm run serve       # the whole game at http://localhost:8080: open it on a TV, join from phones on the same Wi-Fi
npm run dev         # the web app at http://localhost:5173 (run `npm run dev -w @thaloroot/server` too, for rooms)
npm test            # engine and room tests: content, every mission, rules, powers, balance, rooms, the server
npm run sim -- --games 500                      # bot games with the full content, Quick length
npm run sim -- --games 500 --playtest           # the Playtest 1-4 setup, to compare with the playtest log
npm run sim -- --games 200 --length long --players 6
npm run sim -- --log --seed 7                   # one game, every event narrated
```

A thousand bot games take about 7 seconds.

## Playing with phones and a TV

`npm run serve` builds everything and starts a small server (set `PORT`, and `DATA_DIR` to keep rooms across restarts). Open it on the TV and choose **Open a table**: the TV shows a room code and a QR code. Each person scans it (or opens the same address on their phone and types the code), makes their adventurer, and sits down. The TV adds computer players, picks the game length, and starts the Bloom.

From then on, every choice happens on the phone it belongs to: picks, Meetings, options, powers, quick actions, guesses. The TV is the shared table: everyone's character card, the World track, the latest scene with its dice, World card moments, who the table is waiting on, and the final scores and tales. Nothing secret ever reaches the TV; the room sends each screen only what its seat may see (`viewFor`).

Phones keep a secret token, so a reload, a locked screen, or a dropped signal puts them back in their seat. If someone leaves for good, the TV can free their seat for another phone or hand it to a computer player. At the end, "Play again" keeps everyone's growth, and each phone remembers its adventurer for the next table.

To reach the server from phones, they need to be on the same network as the computer running it, using its local address (like `http://192.168.1.20:8080`). Putting the game online is the next step.

## The pass-and-play prototype

`apps/web` runs a whole game on one screen. Set up 2 to 8 adventurers (any mix of people and computer players), then pass the device around: before each secret choice (a mission, a teaser, Ally/Brawl/Pass, a trap, final guesses) the screen asks everyone else to look away and the right person to tap in. Public choices, like which option to try at a location, happen in front of everyone, with a press-and-hold button to peek at your mission. Computer players move on their own at a speed you pick, and a game in progress is saved in the browser so you can resume it.

`npm run build -w @thaloroot/web` produces a single `apps/web/dist/index.html` you can open or host anywhere. `npm run build:artifact -w @thaloroot/web` produces the version published as a shareable page, with React loaded from a CDN.

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

All dice, stamina, Lessons and growth, Meetings and Brawls, traps, stealing, Downed, companions, items' passive bonuses and one-use effects, Taproot Fragments, every World card, monsters, merchants and the market, Rumors, finales, all 51 missions (milestones, finales with finale grace, and flourishes), mission guesses, and scoring. Class and species passives, weaknesses, actives, signature moves, and services are all automated. [docs/rules-notes.md](docs/rules-notes.md) lists every interpretation the engine makes and every gap.

## Balance baseline

With the full content (51 missions, 14 classes, random characters), the engine's bot games land within a round or a few points of the Playtest 4 log on almost every number: a Quick game runs about 12 rounds, 29% of players finish their finale, and missions out-earn kept treasure 13.7 to 12.2 VP. Full numbers and the findings worth a Playtest 5 are in [docs/balance-baseline.md](docs/balance-baseline.md).

## Roadmap

1. **Rules engine** (done): content as data, the engine, bots, simulator, tests.
2. **Pass-and-play prototype** (done): one browser screen, players take turns on the same device.
3. **Multiplayer** (in progress): phones as private hands and a room code to join (done), the TV board and trades at Meetings, then putting it online.
4. **Accounts and carryover**: characters that keep their growth, quirks, and heirlooms between games.
5. **Polish**: art, sound, animation, onboarding.
