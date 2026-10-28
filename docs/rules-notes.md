# Rules notes

Where the design doc leaves room for interpretation, the engine has to pick one. This page lists those choices and everything the engine doesn't automate yet, so a playtest can confirm or overrule them.

## Interpretations

**Turn structure**
- Meetings pair up in turn order within each region-and-skull group. If three players share a group, the first two meet and the third doesn't.
- All Meetings resolve right after the reveal, before anyone resolves a card.
- "This round" and "until the next World card" both end when the next World card is drawn, since one is drawn per round.
- Pass It On hands the chosen cards left before Meetings are worked out.

**Dice**
- Each success on a Trouble die cancels one of your successes.
- A Spark result that says "instead" (Hermit's Treehouse) replaces the success's Lessons.
- Lucky Button and Lucky Thimble reroll automatically: the worst dice of a roll that missed by 1 or 2, once per game.
- Lessons in "any stat" go to the stat the player names, or to their highest stat below 6.

**Classes, species, and companions**
- Bramblebeast Tamer: +2 dice on any option at a Creature-tagged location, as the class says. The "Bramblebeast Tamer +2 dice" notes on cards are this same bonus, not an extra one.
- Lantern-Bound Ghost: picking up a fourth item drops the least valuable one if the new one is worth more; otherwise the new item is left behind.
- Squirrelfolk automatically protect their most valuable item.
- Once-per-game shields fire on their own: "ignore all damage from one source" (Old Mossback, Wyrm Scale) on the first hit of 2 or more damage or one that would Down you; Pebble on the first Brawl hit; Capfolk on the first Mishap; Burrowkin and Gulp on the first trap; Hollowkin on the first monster hunt.
- Pillow-Prophet Dreamweaver: starting a turn at 0 stamina means sleeping through it (skip the explore) and waking with 2 Dream tokens.

**Status effects**
- A frog from your own turn (a failed roll, a rest option) ends when your next turn begins. A frog from anything else (Frog Rain, a rival's item) lasts through your next turn and limits you to Charm and rest options.
- "Rivals can't target you this round" blocks traps and steals until the round ends.

**Treasure and missions**
- A treasure "found at a Swamp location" counts every tag of the location it came from, so a Sunken Chapel treasure counts for Swamp and Ruins.
- Finale costs (the Vault's 10 coin, the Witch's 2 treasures, gifts for Grumblewort and the Feast) are paid when you declare the attempt, and aren't refunded if the roll fails.
- When you're Downed, the item you drop stays at that location, and the next player to resolve there picks it up.

**Monsters**
- Monsters pick their targets at the reveal and confront them at the start of the target's turn.
- Losing a fight applies the monster's last option (usually Flee), unless the fight has its own failure result.
- The Mimic Chest hunts the next player who finds a treasure, at the start of their next turn, and only if they still hold that treasure.

**Market and deals**
- Everyone chooses at once when a Merchant opens the market. Choices resolve in turn order: cash in first, then buy. Stock is first come, first served.
- Trades are proposed during the market and answered one at a time.

**Taproot Fragments**
- Fragment of the Turning Season shows the whole World deck but doesn't reorder it yet.
- Fragment of the Gardener-Kings gives 5 teasers and +3 dice next turn instead of a search through the whole deck.
- Fragment of Exchange swaps with the rival carrying the most valuable pack.

**Class powers** (the numbers live in `tools/authored.py`, under `POWERS`)
- Using an active or signature power is your quick action, instead of a trap or trail rations. Powers with their own moment don't use it up: Dream Peek and Build a Bridge (while picking), Whispers, Switcheroo, Gust, and Cyclone (after everyone picks, before the reveal, in turn order), and Stampede and The Walking Cottage (when choosing an option).
- Sic 'Em, Haunt, Hex the Path, and Living Gargoyle work like traps: secret, one use, sprung by the next rival to resolve there. The victim learns something was waiting, not who left it.
- Sic 'Em: the rival rolls their better of Brawn or Charm and needs 2 successes, or takes 2 damage. Living Gargoyle: Brawn, 2 successes, or 3 damage.
- Tremor's "shared location" means a Meeting's match: the same region and skull rating as you this round.
- Build a Wall lasts for the next round: no one else is dealt that location. Burn the Path removes every copy for the rest of the game.
- Build a Bridge costs 2 stamina plus 1 coin (the Carpenter's weakness) and replaces your teaser pick. The Walking Cottage costs 1 coin and protects everything you carry at that moment for the rest of the game.
- Brew turns any treasure into a potion item you use later. Ribbit needs a target when you drink it.
- Reforge is a free quick action. Smithing for Hire costs the rival 2 coin, paid to the Blacksmith. Gear can be stolen. A Masterwork heirloom keeps its stat in the next game.
- Each Cook dish needs 1 ingredient. Sleepy Scones cost the rival their next quick action, not their explore. Courage Pie is +1 die on your next roll. The Feast is free; guests restore all stamina, and the Cook gains 1 VP per guest.
- Bluff: each milestone the Trickster claims plants one fake mission tag. The next rival to learn a tag about the Trickster hears the fake one.
- Mistaken Identity and The Shared Dream take effect in the round after you use them. During Mistaken Identity, the Chronicle, the scene, and "Seen at the table" all show the other player's name.
- The Shared Dream: 1s count as successes, and a Mishap comes from two 6s instead of two 1s. 6s still succeed and still Spark.
- Possession is used as a quick action and applies the next time that rival draws teasers.
- Whispers on the Wind: you choose which rival to hear.
- Cleanse removes everything at one location (traps and powers), or clears your own Trouble dice. Mountain Heart can lift Brawn above 6 for this game.
- The elemental rivalries are rules: Cleanse brings back a burned location, Gust can't move the Rooted Geomancer, and the Pyromancer gains no Heat at Swamp locations.

**Final guesses**
- Each rival's lineup is built separately for each guesser, so two players guessing the same rival see different decoys. A guess outside the lineup doesn't count.

**Finales**
- The Dragon Wakes: after the final turn, everyone rolls their better of Brawn or Spark. A tie for the killing blow is broken at random.

## Not automated yet

These show as text only. (If a card or item effect the engine doesn't know ever comes up, it logs a "resolve by hand" note instead of failing.)

- Foxfolk's swap after the reveal.
- Reusable once-per-game peeks and table powers: Judge Owlbeard, the Glowcap, Starlit, and Moth Queen's Lanterns, Racer's Ribbon, Garden Key, Taproot Star-Chart, Ghostly Locket, Gatekeeper's Seal, and the Crown of the Gardener-King.
- Redraw items: Fairy Charm, Wishbone, and the setup redraws (Fortune-Teller's Deck, Two-Headed Coin).
- The Shadow Market's trap services. Its mission-tag service works.
- Table talk: negotiated prices for Assist dice, trades at Meetings, and splitting team-up rewards. Picnic on the Hill's flourish can't be earned until reward sharing exists.
- Display rules for the UI: Moonrise and Thal Fog hiding teaser text, Masks Appear hiding who you're meeting.
- Carrying characters between games: `exportCharacter()` returns the updated sheet (grown stats, leftover Lessons, quirks), but nothing stores it yet.

## Open questions the engine surfaced

- What happens when three or more players share a Meeting?
- Should a finale's cost be refunded if the roll fails?
- Can a frog do anything besides Charm and rest options?
