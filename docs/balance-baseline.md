# Balance baseline

How the new rules engine's bot games compare with the Python simulator used for Playtests 1 to 4, and what the engine sees that the old simulator couldn't. All runs are 1,000 bot games with 4 players. Reproduce any row with `npm run sim -- --games 1000 --length <quick|standard|long> [--playtest]`.

Two engine setups:

- **Full content:** random characters (7 points, random species), the class draft from all 14 built classes, and the mission draft from all 51 missions. This is the game as designed.
- **Playtest setup** (`--playtest`): the four Playtest 1 to 4 characters and classes (Tamer, Thief, Pyromancer, Geomancer), drafting only from the 12 missions the Python simulator modeled.

## Engine (full content) vs. Playtest 4

| | Quick: Playtest 4 | Quick: engine | Standard: Playtest 4 | Standard: engine | Long: Playtest 4 | Long: engine |
| --- | --- | --- | --- | --- | --- | --- |
| Rounds per game | 13.0 | 12.3 | 16.0 | 15.2 | 18.5 | 17.7 |
| Finale completed (players) | 27% | 29% | 36% | 37% | 40% | 40% |
| Someone finishes (games) | 81% | 84% | 92% | 92% | 94% | 95% |
| Round of first finish | 8.7 | 8.0 | 10.0 | 9.0 | 10.3 | 9.6 |
| Mission VP per player | 12.6 | 13.7 | 14.4 | 15.4 | 15.2 | 16.0 |
| Kept treasure VP per player | 9.9 | 12.2 | 12.5 | 14.7 | 14.3 | 16.9 |
| Guess VP per player | 2.4 | 1.1 | 2.6 | 1.3 | 2.6 | 1.3 |
| Meetings per game | 3.9 | 4.2 | 4.9 | 5.3 | 5.7 | 6.1 |
| Winning score | 40.3 | 41.8 | 45.2 | 46.7 | 48.5 | 51.2 |
| Win margin over 2nd | 12.3 | 11.6 | 12.1 | 11.2 | 11.4 | 12.5 |

With the whole game in play, the engine lands within a round or a few points of the Playtest 4 log on almost every number. The two real differences:

- **Kept treasure is worth 2 to 3 VP more.** The engine plays every World card, merchant, Rumor, and item, so more treasure enters the game. In a Long game, kept treasure (16.9) now edges out missions (16.0), which breaks the Playtest 3 goal that missions are the biggest source of VP.
- **Guesses are worth about half as much.** The old simulator faked guessing with a probability. The engine's bots actually deduce from learned tags and where rivals went, and they're worse at it. A human table will likely do better than either.

## Playtest setup vs. Playtest 4 (Quick)

| | Playtest 4 | Engine, playtest setup |
| --- | --- | --- |
| Rounds per game | 13.0 | 10.6 |
| Finale completed | 27% | 39% |
| Someone finishes | 81% | 96% |
| Mission VP / treasure VP | 12.6 / 9.9 | 15.9 / 11.3 |
| Meetings per game | 3.9 | 3.5 |
| Class win rates | Tamer 30%, Thief 26%, Geomancer 23%, Pyromancer 21% | Geomancer 32%, Thief 29%, Tamer 26%, Pyromancer 13% |

On the same four characters and 12 missions, the engine's bots finish missions much more often. That's mostly the bots, not the rules: the old simulator's bots only steered toward "succeed at a tagged location" milestones, while the engine's bots evaluate every mission condition (take Lessons instead, rest at the right place, push when the mission wants it). Finishing earlier moves the Finale up sooner, which is why games are shorter. The Geomancer gains because the engine applies its +2 dice on Dig options, which the old simulator never modeled; the Pyromancer falls behind the other three.

## Findings worth a Playtest 5

1. **Graftwright's Folly isn't stuck after all.** It was the worst mission in Playtest 4 (7% finales), and the log listed it as a Playtest 5 candidate. With bots that know to take a Lesson instead of a reward, it completes 57% of the time on the playtest setup and 72% with the full content, with the highest win rate of any mission (60%). It may now need to be harder, not easier.
2. **Missions that need bad luck or other players rarely finish.** With the full content, these finish 7% of the time or less: The Mirror Bog (a Mishap on a three-skull Swamp success), Stormchaser (be Downed and come back), The Sleeping Giant's Dream, The Rootkeepers' Last Stand and The Rival Expedition (team-ups), Duel at Dawn, King of Thieves, The Shadow Broker, Wyrm Hunter (needs a Monster card), The Bramble Maze, and The Great Wyrm's Lair. Some of this is bots not courting trouble, but missions that depend on a rival's choices or a rare event may need a backup path.
3. **Tier 1 missions finish far more often** (45% Quick) than tier 2 (25%) and tier 3 (17%), but win rates stay close (23% to 28%). The VP tiers are doing their job.
4. **Merchants are still rarely used**: about 0.3 purchases per game. Prices of coin value +2 (+4 for rares) rarely beat keeping coin. This matches the Playtest 4 candidate.
5. **Lantern-Bound Ghost wins 12% of games** with the full content, the lowest of the 14 classes. Carrying only 3 items caps its treasure VP. Rain-Barrel Tidecaller is highest at 38%, likely because Flow lets it roll its best stat on every option.
6. **Kept treasure catches up with missions in Long games** (see above).

These come from bots, which are cautious about risk and bad at deduction, so treat them as places to look in a human playtest rather than verdicts.

## After the first digital playtest: guess lineups

Final guesses now pick from a lineup of 6 per rival (the real mission, the two the rival turned down, and three random ones) instead of all 51. Bots now guess right about half the time, and guess VP rose from 1.1 to 5.0 per player in a Quick game, about a third of what missions are worth. Bigger lineups soften it: 8 missions gives 4.4 VP, and 10 gives 3.8. If guessing feels too strong at the table, the lineup size is one number in `content/rules.json` (`scoring.lineupSize`), or each correct guess could drop to 2 VP.
