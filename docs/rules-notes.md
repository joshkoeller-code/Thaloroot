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

**Finales**
- The Dragon Wakes: after the final turn, everyone rolls their better of Brawn or Spark. A tie for the killing blow is broken at random.

## Not automated yet

These show as text only. (If a card or item effect the engine doesn't know ever comes up, it logs a "resolve by hand" note instead of failing.)

- Class actives and signature moves for all 14 classes, including the Blacksmith's reforging, the Cook's ingredients, the Dreamweaver's Dream powers (Dream tokens are tracked), and the Thief's Swap.
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
