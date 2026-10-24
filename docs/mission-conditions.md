# Mission conditions

Every milestone, finale, and flourish in `content/missions.json` carries a `condition` the engine checks automatically. Conditions are written in `tools/mission_rules.py` and copied into the JSON by `tools/build_content.py`. The engine's checker is `packages/engine/src/missions.ts`.

## Event conditions (milestones and finales)

The engine records an event whenever something happens to a player. A milestone or finale is claimed the moment an event matches its condition.

```json
{ "event": "success", "tags": ["swamp"], "minSkull": 2, "stats": ["charm"] }
```

reads "succeed on a Charm option at a two-skull or harder Swamp location."

### Events

| Event | When it's recorded | Useful fields |
| --- | --- | --- |
| `success` | A successful explore roll, after rewards | tags, skull, stat, location, need, and the flags below |
| `rest` | A rest or no-roll option | tags, skull, location |
| `treasure` | A treasure gained from an explore option | tags, skull (of the location) |
| `befriend` | A companion joins you | tags |
| `meetingChoice` | You choose at a Meeting | choice: `ally`, `brawl`, `pass` |
| `winBrawl` | You win a Brawl | ambusher, skull |
| `surviveAmbush` | You chose Ally, a rival chose Brawl, and you weren't Downed that turn | |
| `lendAssist` / `receiveAssist` | Assist dice change hands | |
| `setTrap` / `springTrap` / `trapSprungByRival` | Traps | trapType |
| `steal` / `stolenFrom` | Any theft | how: `brawl`, `trap`, `card` |
| `buy` / `cashIn` / `trade` / `giveTreasure` | Market and deals | |
| `lesson` / `lessonInstead` / `statGrowth` / `quirk` | Growth | stat |
| `spark` / `mishap` / `push` / `roll` | Dice | sixes (on `roll`), tags (on `push`) |
| `frog` / `heal` / `gainSparkToken` / `learnTag` / `seeHidden` | Small things | |
| `downed` / `downedReturn` / `companionFled` / `defeatMonster` | Setbacks and triumphs | |
| `turnStart` | The start of every one of your turns | startHealth, startStamina |
| `finalGuess` | Mission guesses at the end | correct, teamedUpCorrect |

### Filters

| Key | Meaning |
| --- | --- |
| `tags` | The location has at least one of these tags |
| `minSkull` | Skull rating at least this (finale grace lowers it by one) |
| `stats` | Rolled one of these stats |
| `stat` | Exactly this stat (Lessons, growth) |
| `choice`, `trapType` | Meeting choice, trap type |
| `minNeed` | The option needed at least this many successes |
| `minStaminaSpent` | Spent at least this much stamina on the option |
| `minSixes` | Rolled at least this many 6s |
| `pushed`, `noPush`, `noAssist`, `noItem` | How the roll was made |
| `duringMeeting`, `teamUp` | You were at a Meeting / teamed up (Ally + Ally) this turn |
| `withMishap`, `lessonInstead` | The successful roll also Mishapped / you took Lessons instead |
| `atTrappedLocation`, `sprangTrapThisTurn` | Trap history |
| `asAmbusher`, `minCorrect`, `teamedUp` | Brawl and guess details |

### Extras

- `count`: needs this many matching events over the game. Add `distinct: "location" | "tag" | "stat"` to count different ones ("succeed at two different Forest locations").
- `requires`: the player's state when the event happens, after rewards. Keys: `minCompanions`, `holdTreasureFrom` (a list; each tag needs its own treasure), `holdAny` (alternatives), `lightSource`, `minItems`, `maxItems`, `minCoin`, `treasureCoinValue`, `healthAtTurnStart` (`full` or `halfOrLess`), `maxStaminaAtTurnStart`, `minStolenItems`, `noRivalFinished`, `distinctSuccessTags`.
- `previousTurn`: a condition your previous turn must have met ("succeed on two turns in a row").
- `cost`: paid up front when you declare a finale attempt (`coin`, `discardTreasures`, `giveTreasure`, `giveTreasureEachRival`). The success only counts if you declared it, and the cost isn't refunded if you fail.
- `any` / `all`: combine conditions.

## Flourishes (checked at the end of the game)

| Shape | Meaning |
| --- | --- |
| `{ "never": cond }` | No event all game matched. Add `"until": "milestones"` to look only until your third milestone. |
| `{ "ever": cond }` | Some event matched (counts allowed). |
| `{ "end": { ... } }` | Final state: `minTreasures`, `frog`, `minCoin`, `minSparkTokens`, `minCompanions`, `holdFragment`. |
| `{ "all": [...] }` | Every part holds. |

## Adding or changing a mission

1. Edit the mission text in the design doc and export the Missions tab to `content/source/missions.html`.
2. Write or update its entry in `tools/mission_rules.py`, keyed by the mission's id (its name, lowercased with dashes).
3. Run `npm run content`, then `npm test`. The test "every mission can be completed" builds events from each condition and fails if any part can't be satisfied; another test fails if a condition listens for an event the engine never records.
