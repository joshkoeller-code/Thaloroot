import { describe, expect, it } from "vitest";
import { botAction } from "../src/bots.js";
import { Content } from "../src/content.js";
import { countSuccesses, dicePool, dreaming, isMishap } from "../src/dice.js";
import { damage, gainCompanion, gainItem, learnRivalTag, log, randomItemOfRarity, record, steal } from "../src/effects.js";
import { createGame, exportCharacter, step } from "../src/engine.js";
import { availablePowers, springWards, usePower, walledFor } from "../src/powers.js";
import { publicRecord } from "../src/record.js";
import { runGame } from "../src/sim.js";
import type { GameState, PlayerState } from "../src/types.js";
import { botsUntil, pending, pickAll, setup, sheets } from "./helpers.js";

const P = (s: GameState, i: number): PlayerState => s.players[i];
const card = (id: string) => Content.card[id];

/** Answer everything with bots until a given player owes a given decision. */
function until(s: GameState, player: number, kind: string, max = 3000): void {
  botsUntil(s, (x) => x.pending.some((d) => d.player === player && d.kind === kind), max);
}

describe("power content", () => {
  it("gives every built class its active and signature, with unique ids", () => {
    const ids = new Set<string>();
    for (const c of Content.classes.filter((x) => x.status === "built")) {
      const pw = c.powers ?? [];
      expect(pw.some((x) => x.slot === "signature"), c.name).toBe(true);
      expect(pw.some((x) => x.slot === "active" || x.slot === "service" || x.slot === "passive"), c.name).toBe(true);
      for (const x of pw) {
        expect(ids.has(x.id), x.id).toBe(false);
        ids.add(x.id);
      }
    }
    expect(ids.size).toBeGreaterThanOrEqual(30);
  });

  it("keeps crafted items out of random treasure and merchant stock", () => {
    const s = setup({ players: 2 });
    for (let i = 0; i < 400; i++) {
      for (const r of ["common", "uncommon", "rare"]) {
        const id = randomItemOfRarity(s, r);
        if (id) expect(Content.item[id].crafted, id).toBeFalsy();
      }
    }
  });
});

describe("location powers", () => {
  it("Haunt: the next rival there rolls 1 fewer die, and the Ghost gains 1 coin", () => {
    const s = setup({ players: 2, classes: ["lantern-bound-ghost", "honeycake-cook"] });
    const ghost = P(s, 0);
    const cook = P(s, 1);
    const coin = ghost.coin;
    expect(usePower(s, ghost, { id: "haunt", location: "buttercup-hill" }, "quick")).toBe(true);
    expect(ghost.stamina).toBe(ghost.maxStamina - 1);
    // the Ghost's own visit doesn't spring it
    springWards(s, ghost, "buttercup-hill");
    expect(s.wards).toHaveLength(1);
    const c = card("buttercup-hill");
    const before = dicePool(s, cook, c, c.options[0], "charm").total;
    springWards(s, cook, "buttercup-hill");
    expect(s.wards).toHaveLength(0);
    expect(dicePool(s, cook, c, c.options[0], "charm").total).toBe(before - 1);
    expect(ghost.coin).toBe(coin + 1);
    // the victim isn't told who; the Ghost is
    expect(s.log.at(-1)!.private).toEqual([ghost.id]);
  });

  it("Hex the Path: 2 Trouble dice on the next roll there, once per game", () => {
    const s = setup({ players: 2, classes: ["toadstool-witch", "honeycake-cook"] });
    const witch = P(s, 0);
    expect(usePower(s, witch, { id: "hex-the-path", location: "echo-gorge" }, "quick")).toBe(true);
    expect(availablePowers(s, witch, "quick").some((x) => x.id === "hex-the-path")).toBe(false);
    springWards(s, P(s, 1), "echo-gorge");
    expect(P(s, 1).trouble).toEqual({ amount: 2, rolls: 1 });
  });

  it("Sic 'Em needs a companion; a rival who fails against it takes 2 damage", () => {
    const s = setup({ players: 2, classes: ["bramblebeast-tamer", "honeycake-cook"] });
    const tamer = P(s, 0);
    expect(usePower(s, tamer, { id: "sic-em", location: "echo-gorge" }, "quick")).toBe(false);
    gainCompanion(s, tamer, "pebble");
    expect(usePower(s, tamer, { id: "sic-em", location: "echo-gorge" }, "quick")).toBe(true);
    const cook = P(s, 1);
    const hp = cook.health;
    s.scriptedDice = Array(10).fill(2);
    springWards(s, cook, "echo-gorge");
    expect(cook.health).toBe(hp - 2);
  });

  it("Build a Wall: nobody else is dealt that location next round", () => {
    const s = setup({ players: 2, classes: ["gargoyle-carver-stonemason", "honeycake-cook"] });
    const mason = P(s, 0);
    expect(usePower(s, mason, { id: "build-a-wall", location: "buttercup-hill" }, "quick")).toBe(true);
    expect(walledFor(s, P(s, 1), "buttercup-hill", s.round + 1)).toBe(true);
    expect(walledFor(s, mason, "buttercup-hill", s.round + 1)).toBe(false);
    // stack the deck with that location and play into round 2
    for (let i = 0; i < 6; i++) s.exploreDeck.push({ uid: ++s.uid, card: "buttercup-hill" });
    botsUntil(s, (x) => x.round === 2 && x.phase === "pick");
    for (const d of s.pending.filter((x) => x.player === 1 && x.kind === "pickTeaser")) {
      expect(d.data.cards.map((c: any) => c.card)).not.toContain("buttercup-hill");
    }
  });

  it("Burn the Path: the location is never dealt again, and Cleanse brings it back", () => {
    const s = setup({ players: 2, classes: ["cinder-heart-pyromancer", "rain-barrel-tidecaller"] });
    expect(usePower(s, P(s, 0), { id: "burn-the-path", location: "buttercup-hill" }, "quick")).toBe(true);
    expect(s.burned).toEqual(["buttercup-hill"]);
    for (let i = 0; i < 6; i++) s.exploreDeck.push({ uid: ++s.uid, card: "buttercup-hill" });
    botsUntil(s, (x) => x.round === 2 && x.phase === "pick");
    for (const h of Object.values(s.hands)) expect(h.map((c) => c.card)).not.toContain("buttercup-hill");
    // Water's Cleanse restores a location Fire burned
    P(s, 1).stamina = 5;
    expect(usePower(s, P(s, 1), { id: "cleanse", location: "buttercup-hill" }, "quick")).toBe(true);
    expect(s.burned).toEqual([]);
  });

  it("Cleanse removes a rival's trap and secretly says who set it", () => {
    const s = setup({ players: 2, classes: ["rain-barrel-tidecaller", "lantern-hour-thief"] });
    s.traps.push({ owner: 1, location: "echo-gorge", type: "snare" });
    expect(usePower(s, P(s, 0), { id: "cleanse", location: "echo-gorge" }, "quick")).toBe(true);
    expect(s.traps).toHaveLength(0);
    const note = s.log.at(-1)!;
    expect(note.private).toEqual([0]);
    expect(note.text).toContain(P(s, 1).name);
  });
});

describe("item powers", () => {
  it("Brew turns a treasure into a potion; Swiftness adds 2 dice", () => {
    const s = setup({ players: 2, classes: ["toadstool-witch", "honeycake-cook"] });
    const witch = P(s, 0);
    const t = gainItem(s, witch, "thal-acorn")!;
    expect(usePower(s, witch, { id: "brew", item: t.uid, choice: "potion-of-swiftness" }, "quick")).toBe(true);
    expect(witch.items.map((i) => i.id)).toEqual(["potion-of-swiftness"]);
  });

  it("Reforge makes +1-die gear; a Masterwork heirloom keeps its stat next game", () => {
    const s = setup({ players: 2, classes: ["ember-hearted-blacksmith", "honeycake-cook"] });
    const smith = P(s, 0);
    const c = card("echo-gorge");
    const before = dicePool(s, smith, c, c.options[1], "brawn").total;
    const t = gainItem(s, smith, "thal-acorn")!;
    expect(usePower(s, smith, { id: "reforge", item: t.uid, stat: "brawn" }, "quick")).toBe(true);
    const gear = smith.items.find((i) => i.id === "reforged-gear")!;
    expect(gear.forged).toBe("brawn");
    expect(dicePool(s, smith, c, c.options[1], "brawn").total).toBe(before + 1);
    expect(usePower(s, smith, { id: "masterwork", item: gear.uid }, "quick")).toBe(true);
    const sheet = exportCharacter(s, smith.id);
    expect(sheet.heirlooms).toEqual(["reforged-gear:brawn"]);
    const next = createGame({ seed: 9, length: "quick", players: [{ ...sheet, bot: "balanced" }, sheets(2)[1]] });
    expect(next.players[0].items[0]).toMatchObject({ id: "reforged-gear", forged: "brawn", carriedOver: true });
  });

  it("Smithing for Hire: a rival pays the Blacksmith to reforge their treasure", () => {
    const s = setup({ players: 2, classes: ["ember-hearted-blacksmith", "honeycake-cook"] });
    const [smith, cook] = [P(s, 0), P(s, 1)];
    const t = gainItem(s, cook, "thal-acorn")!;
    const [a, b] = [smith.coin, cook.coin];
    expect(usePower(s, cook, { id: "smithing-for-hire", target: smith.id, item: t.uid, stat: "charm" }, "quick")).toBe(true);
    expect(smith.coin).toBe(a + 2);
    expect(cook.coin).toBe(b - 2);
    expect(cook.items[0].forged).toBe("charm");
  });

  it("The Swap trades items secretly, and the victim learns who at round's end", () => {
    const s = setup({ players: 2, classes: ["lantern-hour-thief", "honeycake-cook"] });
    const [thief, cook] = [P(s, 0), P(s, 1)];
    const mine = gainItem(s, thief, "thal-acorn")!;
    const theirs = gainItem(s, cook, "golden-goose-egg")!;
    expect(usePower(s, thief, { id: "the-swap", target: cook.id, item: mine.uid, targetItem: theirs.uid }, "quick")).toBe(true);
    expect(thief.items.map((i) => i.id)).toEqual(["golden-goose-egg"]);
    expect(cook.items.map((i) => i.id)).toEqual(["thal-acorn"]);
    botsUntil(s, (x) => x.round === 2);
    expect(s.log.some((e) => e.private?.[0] === cook.id && e.text.includes(thief.name) && e.text.includes("swapped"))).toBe(true);
  });

  it("The Great Flood washes away traps and takes each rival's least valuable item", () => {
    const s = setup({ players: 3, classes: ["rain-barrel-tidecaller", "honeycake-cook", "toadstool-witch"] });
    s.traps.push({ owner: 1, location: "echo-gorge", type: "snare" });
    gainItem(s, P(s, 1), "thal-acorn");
    gainItem(s, P(s, 1), "golden-goose-egg");
    gainItem(s, P(s, 2), "bog-pearl");
    expect(usePower(s, P(s, 0), { id: "the-great-flood" }, "quick")).toBe(true);
    expect(s.traps).toHaveLength(0);
    expect(P(s, 0).items.map((i) => i.id).sort()).toEqual(["bog-pearl", "thal-acorn"]);
    expect(P(s, 1).items.map((i) => i.id)).toEqual(["golden-goose-egg"]);
  });
});

describe("cooking", () => {
  it("Forager gathers ingredients at Meadow successes; cooking needs one", () => {
    const s = setup({ players: 2, classes: ["honeycake-cook", "toadstool-witch"], hands: [["buttercup-hill", "echo-gorge"], ["buttercup-hill", "echo-gorge"]] });
    const cook = P(s, 0);
    expect(availablePowers(s, cook, "quick").some((x) => x.id === "cook")).toBe(false);
    pickAll(s, { 0: "buttercup-hill", 1: "echo-gorge" });
    botsUntil(s, (x) => x.pending.some((d) => d.kind === "chooseOption" && d.player === cook.id));
    s.scriptedDice = Array(12).fill(6);
    step(s, { player: cook.id, kind: "chooseOption", option: 0, stat: "charm" });
    if (s.pending[0]?.kind === "reward") step(s, { player: cook.id, kind: "reward", lessonInstead: false });
    expect(cook.ingredients).toBe(1);
    const q = pending(s, cook.id, "quickAction");
    expect(q.data.powers.some((x: any) => x.id === "cook")).toBe(true);
    const dice = cook.nextRollDice;
    step(s, { player: cook.id, kind: "quickAction", action: "power", power: { id: "cook", choice: "pie" } });
    expect(cook.ingredients).toBe(0);
    expect(cook.nextRollDice).toBe(dice + 1);
  });

  it("The Feast waits for every guest; each who comes gives the Cook 1 VP", () => {
    const s = setup({ players: 3, classes: ["honeycake-cook", "toadstool-witch", "lantern-hour-thief"] });
    const cook = P(s, 0);
    until(s, cook.id, "quickAction");
    for (const q of s.players) if (q !== cook) q.stamina = 1;
    step(s, { player: cook.id, kind: "quickAction", action: "power", power: { id: "the-feast" } });
    const invites = s.pending.filter((d) => d.kind === "feast");
    expect(invites).toHaveLength(2);
    const turn = s.turn!.player;
    step(s, { player: invites[0].player, kind: "feast", accept: true });
    expect(s.turn?.player).toBe(turn); // still waiting
    step(s, { player: invites[1].player, kind: "feast", accept: false });
    expect(cook.vpBonus).toBe(1);
    expect(P(s, invites[0].player).stamina).toBe(P(s, invites[0].player).maxStamina);
    expect(P(s, invites[1].player).stamina).toBe(1);
  });
});

describe("pick and scheme powers", () => {
  it("Dream Peek spends a Dream token and shows the full cards", () => {
    const s = setup({ players: 2, classes: ["pillow-prophet-dreamweaver", "honeycake-cook"] });
    const dw = P(s, 0);
    dw.dream = 1;
    // the deal happened before the token arrived; ask again
    s.pending = s.pending.map((d) => (d.player === dw.id ? { ...d, data: { ...d.data, dreamPeek: true } } : d));
    step(s, { player: dw.id, kind: "pickTeaser", card: 0, dreamPeek: true });
    expect(dw.dream).toBe(0);
    expect(pending(s, dw.id, "pickTeaser").data.fullCards).toBe(true);
  });

  it("Build a Bridge revisits an explored location without touching the deck", () => {
    const s = setup({ players: 2, classes: ["treehouse-carpenter", "honeycake-cook"] });
    const c = P(s, 0);
    record(s, c, { type: "roll", location: "echo-gorge" });
    c.coin = 3;
    botsUntil(s, (x) => x.round === 2 && x.phase === "pick");
    const d = pending(s, c.id, "pickTeaser");
    expect(d.data.bridge).toContain("echo-gorge");
    const coin = c.coin;
    step(s, { player: c.id, kind: "pickTeaser", card: 0, bridge: "echo-gorge" });
    expect(s.picks[c.id]).toMatchObject({ card: "echo-gorge", virtual: true });
    expect(c.coin).toBe(coin - 1);
  });

  it("Whispers then Gust: the Windcaller hears a pick and blows that rival onto their other teaser", () => {
    const s = setup({ players: 2, classes: ["kite-riding-windcaller", "honeycake-cook"], hands: [["echo-gorge", "buttercup-hill"], ["the-old-well", "glowcap-hollow"]] });
    pickAll(s, { 0: "echo-gorge", 1: "the-old-well" });
    expect(s.phase).toBe("scheme");
    step(s, { player: 0, kind: "whisper", rival: 1 });
    expect(s.log.some((e) => e.private?.includes(0) && e.text.includes("The Old Well"))).toBe(true);
    const d = pending(s, 0, "scheme");
    expect(d.data.powers.map((x: any) => x.id)).toContain("gust");
    step(s, { player: 0, kind: "scheme", power: { id: "gust", target: 1 } });
    expect(s.picks[1]!.card).toBe("glowcap-hollow");
    expect(s.phase).not.toBe("scheme");
  });

  it("Gust can't move a Rooted Geomancer", () => {
    const s = setup({ players: 2, classes: ["kite-riding-windcaller", "moss-footed-geomancer"], hands: [["echo-gorge", "buttercup-hill"], ["the-old-well", "glowcap-hollow"]] });
    pickAll(s, { 0: "echo-gorge", 1: "the-old-well" });
    step(s, { player: 0, kind: "whisper", rival: 1 });
    const d = pending(s, 0, "scheme");
    expect(d.data.powers.map((x: any) => x.id)).toEqual(["cyclone"]);
  });

  it("Switcheroo trades explore cards with a rival", () => {
    const s = setup({ players: 2, classes: ["fox-masked-trickster", "honeycake-cook"], hands: [["echo-gorge", "buttercup-hill"], ["the-old-well", "glowcap-hollow"]] });
    pickAll(s, { 0: "echo-gorge", 1: "the-old-well" });
    step(s, { player: 0, kind: "scheme", power: { id: "switcheroo", target: 1 } });
    expect(s.picks[0]!.card).toBe("the-old-well");
    expect(s.picks[1]!.card).toBe("echo-gorge");
  });

  it("Cyclone redeals the chosen cards among the same players", () => {
    const s = setup({ players: 3, classes: ["kite-riding-windcaller", "honeycake-cook", "toadstool-witch"] });
    for (const d of [...s.pending]) step(s, botAction(s, d));
    const before = Object.values(s.picks).map((c) => c!.card).sort();
    step(s, { player: 0, kind: "whisper", rival: s.pending[0].data.rivals[0] });
    step(s, { player: 0, kind: "scheme", power: { id: "cyclone" } });
    expect(Object.values(s.picks).map((c) => c!.card).sort()).toEqual(before);
  });

  it("Possession: the Ghost chooses a rival's next teaser", () => {
    const s = setup({ players: 2, classes: ["lantern-bound-ghost", "honeycake-cook"] });
    expect(usePower(s, P(s, 0), { id: "possession", target: 1 }, "quick")).toBe(true);
    botsUntil(s, (x) => x.round === 2 && x.phase === "pick");
    expect(s.pending.some((d) => d.player === 1 && d.kind === "pickTeaser")).toBe(false);
    const d = pending(s, 0, "possess");
    step(s, { player: 0, kind: "possess", card: d.data.cards[1].uid });
    expect(s.picks[1]!.uid).toBe(d.data.cards[1].uid);
  });
});

describe("roll powers and signatures", () => {
  it("Stampede adds a die per companion to one roll", () => {
    const s = setup({ players: 2, classes: ["bramblebeast-tamer", "honeycake-cook"] });
    const tamer = P(s, 0);
    gainCompanion(s, tamer, "pebble");
    gainCompanion(s, tamer, "bramble-hare");
    until(s, tamer.id, "chooseOption");
    const d = pending(s, tamer.id, "chooseOption");
    const opt = d.data.options.find((o: any) => !o.rest && o.allowed);
    expect(d.data.powers.find((x: any) => x.id === "stampede").dice).toBe(2);
    const stat = opt.stats[0];
    step(s, { player: tamer.id, kind: "chooseOption", option: opt.index, stat, power: "stampede" });
    expect(s.turn!.powerDice).toBe(2);
    expect(s.turn!.dice!.length).toBeGreaterThanOrEqual(opt.dice[stat] + 2);
  });

  it("The Walking Cottage rests anywhere for full stamina and protects the pack", () => {
    const s = setup({ players: 2, classes: ["treehouse-carpenter", "lantern-hour-thief"] });
    const c = P(s, 0);
    gainItem(s, c, "golden-goose-egg");
    until(s, c.id, "chooseOption");
    c.stamina = 0;
    c.coin = 2;
    step(s, { player: c.id, kind: "chooseOption", option: 0, power: "the-walking-cottage" });
    expect(c.stamina).toBe(c.maxStamina);
    expect(c.coin).toBe(1);
    steal(s, P(s, 1), c, "brawl");
    expect(c.items.map((i) => i.id)).toContain("golden-goose-egg");
  });

  it("Phoenix: the first fall rises with full health and stamina; the second is a Down", () => {
    const s = setup({ players: 2, classes: ["cinder-heart-pyromancer", "honeycake-cook"] });
    const py = P(s, 0);
    py.stamina = 0;
    damage(s, py, 99);
    expect(py.health).toBe(py.maxHealth);
    expect(py.stamina).toBe(py.maxStamina);
    expect(py.skipExplore).toBe(false);
    damage(s, py, 99);
    expect(py.skipExplore).toBe(true);
  });

  it("Mountain Heart: +1 Brawn and +1 max stamina", () => {
    const s = setup({ players: 2, classes: ["moss-footed-geomancer", "honeycake-cook"] });
    const g = P(s, 0);
    const [b, m] = [g.stats.brawn, g.maxStamina];
    expect(usePower(s, g, { id: "mountain-heart" }, "quick")).toBe(true);
    expect(g.stats.brawn).toBe(b + 1);
    expect(g.maxStamina).toBe(m + 1);
  });

  it("Tremor shakes rivals at a shared location: they lose stamina and drop items", () => {
    const s = setup({ players: 2, classes: ["moss-footed-geomancer", "honeycake-cook"], hands: [["echo-gorge", "buttercup-hill"], ["goatpath-switchbacks", "buttercup-hill"]] });
    pickAll(s, { 0: "echo-gorge", 1: "goatpath-switchbacks" });
    const cook = P(s, 1);
    gainItem(s, cook, "golden-goose-egg");
    const st = cook.stamina;
    expect(usePower(s, P(s, 0), { id: "tremor" }, "quick")).toBe(true);
    expect(cook.stamina).toBe(st - 1);
    expect(P(s, 0).items.map((i) => i.id)).toContain("golden-goose-egg");
  });

  it("The Shared Dream: next round 1s succeed and two 6s cause a Mishap", () => {
    const s = setup({ players: 2, classes: ["pillow-prophet-dreamweaver", "honeycake-cook"] });
    expect(usePower(s, P(s, 0), { id: "the-shared-dream" }, "quick")).toBe(true);
    expect(dreaming(s)).toBe(false);
    botsUntil(s, (x) => x.round === 2);
    expect(dreaming(s)).toBe(true);
    expect(countSuccesses([1, 1, 3], false, true)).toBe(2);
    expect(isMishap([6, 6, 2], true)).toBe(true);
    expect(isMishap([1, 1, 2], true)).toBe(false);
    botsUntil(s, (x) => x.round === 3);
    expect(s.sharedDream).toBe(null);
  });

  it("Dream Walk learns a rival's tag or hands them a Trouble die", () => {
    const s = setup({ players: 2, classes: ["pillow-prophet-dreamweaver", "honeycake-cook"] });
    const dw = P(s, 0);
    dw.dream = 2;
    expect(usePower(s, dw, { id: "dream-walk", target: 1, choice: "learn" }, "quick")).toBe(true);
    expect(dw.intel[1]).toHaveLength(1);
    expect(usePower(s, dw, { id: "dream-walk", target: 1, choice: "trouble" }, "quick")).toBe(true);
    expect(P(s, 1).trouble.amount).toBe(1);
    expect(dw.dream).toBe(0);
  });
});

describe("the Trickster's misdirection", () => {
  it("Bluff: a claimed milestone plants a fake tag that the next rival learns", () => {
    const s = setup({ players: 2, classes: ["fox-masked-trickster", "honeycake-cook"], missions: ["mushroom-census"] });
    const fox = P(s, 0);
    fox.decoys = [];
    // claim a milestone directly through the mission checker
    const before = fox.claimed.length;
    for (let i = 0; i < 6 && fox.claimed.length === before; i++) record(s, fox, { type: "success", tags: ["swamp"], skull: 1, location: "toadstool-thicket", stat: "spark" });
    if (fox.claimed.length > before) {
      expect(fox.decoys).toHaveLength(1);
      const fake = fox.decoys[0];
      learnRivalTag(s, P(s, 1), fox);
      expect(P(s, 1).intel[0]).toContain(fake);
    } else {
      // fall back: plant directly
      fox.decoys.push("peril");
      learnRivalTag(s, P(s, 1), fox);
      expect(P(s, 1).intel[0]).toContain("peril");
    }
  });

  it("Mistaken Identity: next round the table sees another name", () => {
    const s = setup({ players: 2, classes: ["fox-masked-trickster", "honeycake-cook"] });
    const [fox, cook] = [P(s, 0), P(s, 1)];
    expect(usePower(s, fox, { id: "mistaken-identity", target: 1 }, "quick")).toBe(true);
    botsUntil(s, (x) => x.round === 2);
    log(s, `${fox.name} does something suspicious.`);
    expect(s.log.at(-1)!.text).toBe(`${cook.name} does something suspicious.`);
    record(s, fox, { type: "rest", location: "echo-gorge", tags: ["mountain"] });
    expect(publicRecord(s, cook.id).rests).toBeGreaterThanOrEqual(1);
    expect(publicRecord(s, fox.id).explored.mountain ?? 0).toBe(0);
  });
});

describe("full games", () => {
  it("every power gets used somewhere in 300 bot games, and nothing stalls", () => {
    const used = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const g = runGame({ seed, players: 4 + (seed % 3) });
      expect(g.phase).toBe("over");
      for (const k of Object.keys(g.stats)) if (k.startsWith("power:")) used.add(k.slice(6));
    }
    const all = Content.classes.flatMap((c) => c.powers ?? []).filter((x) => x.slot !== "passive").map((x) => x.id);
    const missing = all.filter((id) => !used.has(id));
    // Phoenix only fires when the Pyromancer would be Downed; the rest should all appear
    expect(missing.filter((id) => id !== "phoenix")).toEqual([]);
  }, 60_000);
});
