import { describe, expect, it } from "vitest";
import { botAction } from "../src/bots.js";
import { Content } from "../src/content.js";
import { addLessons, damage, steal } from "../src/effects.js";
import { act as actPure, createGame, IllegalAction, newCharacterStats, step } from "../src/engine.js";
import { runGame } from "../src/sim.js";
import type { Stat } from "../src/types.js";
import { FINALE } from "../src/world.js";
import { botsUntil, optionIndex, pending, pickAll, setup, sheets } from "./helpers.js";

const FOREST_1 = ["whispering-glade", "glowcap-hollow"];
// classes with no damage or brawl quirks
const CLASSES = ["honeycake-cook", "toadstool-witch"];

describe("setup", () => {
  it("builds characters from 7 points with no stat above 4", () => {
    expect(newCharacterStats({ brawn: 3, wits: 2, luck: 2 })).toEqual({ brawn: 4, wits: 3, charm: 1, spark: 1, luck: 3 });
    expect(() => newCharacterStats({ brawn: 4, wits: 3 })).toThrow();
    expect(() => newCharacterStats({ brawn: 2 })).toThrow();
  });

  it("drafts unique classes, then secret missions, then deals 2 teasers each", () => {
    const s = createGame({ seed: 3, length: "quick", players: sheets(4) });
    expect(s.phase).toBe("classDraft");
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0].data.options).toHaveLength(3);
    while (s.phase === "classDraft") step(s, botAction(s, s.pending[0]));
    expect(new Set(s.players.map((p) => p.cls)).size).toBe(4);
    expect(s.phase).toBe("missionDraft");
    expect(s.pending).toHaveLength(4);
    const dealt = s.pending.flatMap((d) => d.data.options);
    expect(new Set(dealt).size).toBe(12);
    for (const d of [...s.pending]) step(s, botAction(s, d));
    expect(s.phase).toBe("pick");
    for (const d of s.pending) expect(d.data.cards).toHaveLength(2);
    expect(s.players.every((p) => p.health === 6 && p.coin === 3)).toBe(true);
  });

  it("builds a 15-card Quick World deck with the Finale last and Escalations in the second half", () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = createGame({ seed, length: "quick", players: sheets(3) });
      expect(s.worldDeck).toHaveLength(15);
      expect(s.worldDeck[14]).toBe(FINALE);
      s.worldDeck.forEach((id, i) => {
        if (id.startsWith("the-sky-cracks") || id === "masks-appear" || id === "the-bloom-peaks") expect(i).toBeGreaterThanOrEqual(6);
      });
    }
  });
});

describe("the state machine", () => {
  it("is deterministic for a seed", () => {
    const a = runGame({ seed: 42, players: 4 });
    const b = runGame({ seed: 42, players: 4 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = runGame({ seed: 43, players: 4 });
    expect(JSON.stringify(c.scores)).not.toBe(JSON.stringify(a.scores));
  });

  it("act() returns a new state and leaves the old one alone", () => {
    const s = createGame({ seed: 5, length: "quick", players: sheets(2) });
    const before = JSON.stringify(s);
    const next = actPure(s, botAction(s, s.pending[0]));
    expect(JSON.stringify(s)).toBe(before);
    expect(next.players.some((p) => p.cls)).toBe(true);
  });

  it("rejects actions nobody asked for", () => {
    const s = createGame({ seed: 5, length: "quick", players: sheets(2) });
    expect(() => step(s, { player: 1, kind: "pickTeaser", card: 1 })).toThrow(IllegalAction);
    expect(() => step(s, { player: s.pending[0].player, kind: "chooseClass", cls: "not-a-class" })).toThrow(IllegalAction);
  });

  it("survives serialization mid-game", () => {
    const s = setup({ players: 3, seed: 9 });
    botsUntil(s, (x) => x.round >= 4);
    const copy = JSON.parse(JSON.stringify(s));
    botsUntil(s, () => false);
    botsUntil(copy, () => false);
    expect(copy.scores).toEqual(s.scores);
  });
});

describe("Meetings", () => {
  it("happen at same-region, same-skull locations; Ally + Ally adds 2 dice each", () => {
    const s = setup({ players: 2, classes: CLASSES, hands: [FOREST_1, ["glowcap-hollow", "buttercup-hill"]] });
    pickAll(s, { 0: "whispering-glade", 1: "glowcap-hollow" });
    expect(s.phase).toBe("meeting");
    step(s, { player: 0, kind: "meetingChoice", choice: "ally" });
    step(s, { player: 1, kind: "meetingChoice", choice: "ally" });
    expect(s.meetingBonus).toEqual({ 0: 2, 1: 2 });
    const first = s.order[0];
    const d = pending(s, first, "chooseOption");
    const o = d.data.options.find((x: any) => !x.rest);
    const stat = o.stats[0] as Stat;
    expect(o.dice[stat]).toBe(s.players[first].stats[stat] + 2);
  });

  it("Ally vs Brawl is an ambush: the brawler gets +2 dice, steals, and deals 1 damage", () => {
    const s = setup({ players: 2, classes: CLASSES, hands: [FOREST_1, ["glowcap-hollow", "buttercup-hill"]] });
    pickAll(s, { 0: "whispering-glade", 1: "glowcap-hollow" });
    const [a, b] = s.meetings[0].players;
    const A = s.players[a];
    const B = s.players[b];
    B.items = [];
    B.coin = 3;
    // A brawls (Brawn + 2 ambush dice), B allies; then the steal rolls 4 coin
    s.scriptedDice = [...Array(A.stats.brawn + 2).fill(6), ...Array(B.stats.brawn).fill(1), 4];
    step(s, { player: a, kind: "meetingChoice", choice: "brawl" });
    step(s, { player: b, kind: "meetingChoice", choice: "ally" });
    expect(B.coin).toBe(0);
    expect(A.coin).toBe(6);
    expect(B.health).toBe(5);
    expect(A.history.some((e) => e.type === "winBrawl" && e.ambusher)).toBe(true);
  });

  it("a Brawl tie costs both 1 stamina", () => {
    const s = setup({ players: 2, classes: CLASSES, hands: [FOREST_1, ["glowcap-hollow", "buttercup-hill"]] });
    pickAll(s, { 0: "whispering-glade", 1: "glowcap-hollow" });
    for (const p of s.players) p.stamina = 3;
    s.scriptedDice = Array(12).fill(1);
    step(s, { player: 0, kind: "meetingChoice", choice: "brawl" });
    step(s, { player: 1, kind: "meetingChoice", choice: "brawl" });
    // the first player's turn has started (+1 stamina); the second's hasn't
    const [first, second] = s.order;
    expect(s.players[first].stamina).toBe(3);
    expect(s.players[second].stamina).toBe(2);
  });
});

describe("stealing and getting hurt", () => {
  it("steals a random item, else d6 coin, else 1 damage", () => {
    const s = setup({ players: 2 });
    const [a, b] = s.players;
    b.items = [{ uid: 900, id: "bog-pearl", foundTags: ["swamp"], foundSkull: 1, origin: "explore" }];
    steal(s, a, b, "brawl");
    expect(a.items.map((i) => i.id)).toContain("bog-pearl");
    expect(a.items.find((i) => i.id === "bog-pearl")!.stolen).toBe(true);
    b.coin = 2;
    s.scriptedDice = [5];
    steal(s, a, b, "brawl");
    expect(b.coin).toBe(0);
    const h = b.health;
    steal(s, a, b, "brawl");
    expect(b.health).toBe(h - 1);
  });

  it("never steals Taproot Fragments or companions", () => {
    const s = setup({ players: 2 });
    const [a, b] = s.players;
    b.items = [{ uid: 901, id: "taproot-fragment", foundTags: [], foundSkull: 3, origin: "explore", fragment: "fragment-of-the-surge" }];
    b.companions = [{ id: "gilly" }];
    b.coin = 0;
    steal(s, a, b, "trap");
    expect(b.items).toHaveLength(1);
    expect(b.companions).toHaveLength(1);
  });

  it("Downed: drop an item, skip the next explore, come back at half health", () => {
    const s = setup({ players: 2, classes: ["honeycake-cook", "toadstool-witch"] });
    const p = s.players[0];
    p.items = [{ uid: 902, id: "thal-acorn", foundTags: [], foundSkull: 1, origin: "explore" }];
    damage(s, p, 6, "explore");
    expect(p.health).toBe(3);
    expect(p.skipExplore).toBe(true);
    expect(p.items).toHaveLength(0);
    expect(Object.values(s.dropped).flat()).toHaveLength(1);
  });
});

describe("rolling", () => {
  it("offers a push on a failed roll and adds 2 dice", () => {
    const s = setup({ players: 2, classes: ["honeycake-cook", "toadstool-witch"], hands: [["hermits-treehouse", "buttercup-hill"], ["buttercup-hill", "echo-gorge"]] });
    pickAll(s, { 0: "hermits-treehouse", 1: "echo-gorge" });
    botsUntil(s, (x) => x.pending.some((d) => d.player === 0 && d.kind === "chooseOption"));
    const p = s.players[0];
    const idx = optionIndex(s, 0, "Climb Up"); // Brawn, 2 successes
    const n = pending(s, 0, "chooseOption").data.options[idx].dice.brawn;
    s.scriptedDice = [5, ...Array(n - 1).fill(2), 5, 3];
    step(s, { player: 0, kind: "chooseOption", option: idx, stat: "brawn" });
    expect(pending(s, 0, "push").data.successes).toBe(1);
    step(s, { player: 0, kind: "push", push: true });
    expect(p.history.some((e) => e.type === "push")).toBe(true);
    expect(pending(s, 0, "reward")).toBeTruthy();
    step(s, { player: 0, kind: "reward", lessonInstead: true });
    // 1 Lesson for succeeding + 2 for taking Lessons instead
    expect(p.lessons.brawn).toBe(3);
    expect(p.history.some((e) => e.type === "lessonInstead")).toBe(true);
  });

  it("the Moss-Footed Geomancer never gets a push", () => {
    const s = setup({ players: 2, classes: ["moss-footed-geomancer", "toadstool-witch"], hands: [["hermits-treehouse", "buttercup-hill"], ["buttercup-hill", "echo-gorge"]] });
    pickAll(s, { 0: "hermits-treehouse", 1: "echo-gorge" });
    botsUntil(s, (x) => x.pending.some((d) => d.player === 0 && d.kind === "chooseOption"));
    s.scriptedDice = Array(20).fill(2);
    step(s, { player: 0, kind: "chooseOption", option: optionIndex(s, 0, "Climb Up"), stat: "brawn" });
    expect(s.pending.some((d) => d.kind === "push")).toBe(false);
  });

  it("trail rations: pay 2 coin for 2 stamina, once per turn", () => {
    const s = setup({ players: 2, hands: [["buttercup-hill", "echo-gorge"], ["buttercup-hill", "echo-gorge"]] });
    pickAll(s, { 0: "buttercup-hill", 1: "echo-gorge" });
    botsUntil(s, (x) => x.pending.some((d) => d.player === 0 && d.kind === "chooseOption"));
    const p = s.players[0];
    p.stamina = 1;
    const coin = p.coin;
    step(s, { player: 0, kind: "chooseOption", option: optionIndex(s, 0, "Nap in the Flowers"), rations: true });
    expect(p.coin).toBe(coin - 2);
    expect(p.stamina).toBeGreaterThanOrEqual(3);
  });

  it("five Lessons raise a stat, at most twice per game, never past 6", () => {
    const s = setup({ players: 2 });
    const p = s.players[0];
    const b = p.stats.wits;
    addLessons(s, p, "wits", 5);
    expect(p.stats.wits).toBe(b + 1);
    addLessons(s, p, "wits", 10);
    expect(p.stats.wits).toBe(b + 2);
    expect(p.grownThisGame).toBe(2);
    expect(p.lessons.wits).toBe(5);
  });
});

describe("traps", () => {
  it("the next rival to pick the location springs it; the setter is told", () => {
    const s = setup({ players: 2, hands: [["buttercup-hill", "echo-gorge"], ["buttercup-hill", "echo-gorge"]] });
    s.traps.push({ owner: 1, location: "echo-gorge", type: "snare" });
    pickAll(s, { 0: "echo-gorge", 1: "buttercup-hill" });
    const p = s.players[0];
    botsUntil(s, (x) => x.pending.some((d) => d.player === 0 && d.kind === "chooseOption"));
    expect(p.history.some((e) => e.type === "springTrap" && e.trapType === "snare")).toBe(true);
    expect(s.players[1].history.some((e) => e.type === "trapSprungByRival")).toBe(true);
    expect(s.traps).toHaveLength(0);
    expect(s.trapHistory).toContain("echo-gorge");
  });
});

describe("the end of the game", () => {
  it("moves the Finale up when the first mission is completed", () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = setup({ players: 3, seed });
      let cut = false;
      botsUntil(s, (x) => {
        if (x.firstFinisher !== null && !cut) {
          cut = true;
          expect(x.worldDeck.indexOf(FINALE)).toBeLessThanOrEqual(3);
        }
        return false;
      });
      if (cut) return;
    }
    throw new Error("no game had a finisher");
  });

  it("scores missions, treasure, guesses, and fragments, and breaks ties on coin", () => {
    const s = runGame({ seed: 11, players: 4 });
    expect(s.phase).toBe("over");
    for (const l of s.scores!) expect(l.total).toBe(l.missionVp + l.treasureVp + l.guessVp + l.fragmentVp + l.bonusVp);
    const best = Math.max(...s.scores!.map((l) => l.total));
    expect(s.winner!.every((w) => s.scores![w].total === best)).toBe(true);
  });
});

describe("hidden information", () => {
  it("a seat sees its own mission but not rivals'; the TV sees no missions", async () => {
    const { viewFor } = await import("../src/view.js");
    const s = setup({ players: 3, seed: 4 });
    botsUntil(s, (x) => x.round >= 3);
    const v0 = viewFor(s, 0);
    expect(v0.players[0].mission).toBe(s.players[0].mission);
    expect(v0.players[1].mission).toBeNull();
    expect(v0.exploreDeck.every((c) => c.card === "")).toBe(true);
    const tv = viewFor(s, "tv");
    expect(tv.players.every((p) => p.mission === null)).toBe(true);
    expect(tv.log.every((e) => !e.private)).toBe(true);
    botsUntil(s, () => false);
    expect(viewFor(s, "tv").players.every((p) => p.mission)).toBe(true);
  });
});

describe("coming back", () => {
  it("records a return after being Downed (Stormchaser)", () => {
    const s = setup({ players: 2, classes: CLASSES });
    damage(s, s.players[0], 6, "explore");
    botsUntil(s, (x) => x.players[0].history.some((e) => e.type === "downedReturn"));
    expect(s.players[0].history.some((e) => e.type === "downedReturn")).toBe(true);
  });
});

describe("the story and the final guess", () => {
  it("tells an opening for every mission, a scene for every explore, and a moment for every World card", () => {
    const s = runGame({ seed: 21, players: 3 });
    const openings = s.story.filter((b) => b.kind === "mission" && b.part === "opening");
    expect(openings).toHaveLength(3);
    const scenes = s.story.filter((b) => b.kind === "scene");
    expect(scenes.length).toBeGreaterThan(10);
    const worlds = s.story.filter((b) => b.kind === "world");
    expect(worlds.length).toBeGreaterThan(3);
    for (const p of s.players) {
      const beats = s.story.filter((b) => b.kind === "mission" && b.player === p.id && typeof b.part === "number");
      expect(beats).toHaveLength(p.claimed.length);
    }
    expect(s.story.map((b) => b.seq)).toEqual(s.story.map((_, i) => i + 1));
  });

  it("offers each rival as a lineup of 6 that includes their real mission and the two they turned down", () => {
    const s = setup({ players: 3, seed: 5 });
    botsUntil(s, (x) => x.phase === "finalGuess");
    const d = s.pending.find((x) => x.kind === "finalGuess")!;
    const lineups = d.data.lineups as { rival: number; missions: string[] }[];
    expect(lineups).toHaveLength(2);
    for (const l of lineups) {
      const q = s.players[l.rival];
      expect(l.missions).toHaveLength(6);
      expect(new Set(l.missions).size).toBe(6);
      expect(l.missions).toContain(q.mission);
      for (const m of s.missionOptions[q.id]) expect(l.missions).toContain(m);
    }
  });

  it("ignores a guess that isn't in the lineup", () => {
    const s = setup({ players: 2, seed: 6 });
    botsUntil(s, (x) => x.phase === "finalGuess");
    const d = s.pending.find((x) => x.kind === "finalGuess")!;
    const rival = d.data.rivals[0];
    const outside = Content.missions.map((m) => m.id).find((m) => !d.data.lineups[0].missions.includes(m))!;
    step(s, { player: d.player, kind: "finalGuess", guesses: { [rival]: outside } });
    expect(s.players[d.player].guesses).toEqual({});
  });

  it("keeps a public record of what each player did", async () => {
    const { publicRecord } = await import("../src/record.js");
    const s = runGame({ seed: 8, players: 3 });
    for (const p of s.players) {
      const r = publicRecord(s, p.id);
      const visits = Object.values(r.explored).reduce((a, b) => a + (b ?? 0), 0);
      expect(visits).toBeGreaterThan(0);
      expect(r.meetings.ally + r.meetings.brawl + r.meetings.pass).toBe(p.history.filter((e) => e.type === "meetingChoice").length);
    }
  });
});
