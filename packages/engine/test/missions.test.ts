import { describe, expect, it } from "vitest";
import { Content } from "../src/content.js";
import { checkMission, endCheck, eventMeets } from "../src/missions.js";
import type { Condition, GameEvent, GameState, PlayerState, Tag } from "../src/types.js";
import { setup } from "./helpers.js";

function fresh(mission: string): { s: GameState; p: PlayerState } {
  const s = setup({ players: 2, missions: [mission, "mushroom-census"] });
  const p = s.players[0];
  p.history = [];
  p.claimed = [];
  p.items = [];
  p.companions = [];
  return { s, p };
}

let uid = 1000;
const treasureFrom = (tag: Tag) => ({ uid: ++uid, id: "bog-pearl", foundTags: [tag], foundSkull: 2, origin: "explore" as const });

/** Build an event (and player state) that satisfies a condition, to prove every condition is reachable. */
function satisfy(s: GameState, p: PlayerState, c: Condition, turn: number): GameEvent[] {
  if (c.any) return satisfy(s, p, c.any[0], turn);
  const ev: GameEvent = { type: c.event!, round: turn, turn };
  if (c.tags) ev.tags = [c.tags[0]];
  else ev.tags = ["forest"];
  ev.skull = c.minSkull ?? 1;
  if (c.stats) ev.stat = c.stats[0];
  if (c.stat) ev.stat = c.stat;
  if (c.choice) ev.choice = c.choice;
  if (c.trapType) ev.trapType = c.trapType;
  if (c.minCorrect) ev.correct = c.minCorrect;
  if (c.teamedUp) ev.teamedUpCorrect = true;
  if (c.asAmbusher) ev.ambusher = true;
  if (c.minSixes) ev.sixes = c.minSixes;
  if (c.minNeed) ev.need = c.minNeed;
  if (c.minStaminaSpent) ev.staminaSpent = c.minStaminaSpent;
  for (const k of ["pushed", "duringMeeting", "teamUp", "lessonInstead", "atTrappedLocation"]) if (c[k]) ev[k] = true;
  if (c.withMishap) ev.mishap = true;
  if (c.sprangTrapThisTurn) ev.sprangTrap = true;
  if (c.cost) ev.finaleAttempt = true;
  ev.location = `loc-${turn}`;
  const out: GameEvent[] = [];
  if (c.previousTurn) out.push(...satisfy(s, p, c.previousTurn, turn - 1));
  const n = c.count ?? 1;
  for (let i = 1; i < n; i++) {
    const extra: GameEvent = { ...ev, location: `loc-${turn}-${i}` };
    if (c.distinct === "tag") extra.tags = [(["forest", "meadow", "swamp", "mountain", "ruins", "creature", "peril"] as Tag[])[i]];
    if (c.distinct === "stat") extra.stat = (["brawn", "wits", "charm", "spark", "luck"] as const)[i];
    out.push(extra);
  }
  if (c.distinct === "stat" && !ev.stat) ev.stat = "brawn";
  out.push(ev);
  const r = c.requires ?? {};
  if (r.minCompanions) p.companions = Array.from({ length: r.minCompanions }, (_, i) => ({ id: ["buzzbelle", "gilly", "pebble"][i] }));
  if (r.holdTreasureFrom) for (const t of r.holdTreasureFrom) p.items.push(treasureFrom(t));
  if (r.holdAny) p.items.push(treasureFrom(r.holdAny[1].treasureFrom));
  if (r.lightSource) p.items.push({ uid: ++uid, id: "firefly-jar", foundTags: [], foundSkull: 1, origin: "explore" });
  if (r.minItems) for (let i = 0; i < r.minItems; i++) p.items.push(treasureFrom("forest"));
  if (r.minCoin) p.coin = r.minCoin;
  if (r.treasureCoinValue) for (let i = 0; i < 4; i++) p.items.push(treasureFrom("meadow"));
  if (r.healthAtTurnStart === "full") ev.startHealth = p.maxHealth;
  if (r.healthAtTurnStart === "halfOrLess") ev.startHealth = 2;
  if (r.maxStaminaAtTurnStart) ev.startStamina = 1;
  if (r.minStolenItems) for (let i = 0; i < r.minStolenItems; i++) p.items.push({ ...treasureFrom("ruins"), stolen: true });
  if (r.distinctSuccessTags)
    for (const t of ["forest", "meadow", "swamp", "mountain", "ruins"] as Tag[])
      out.unshift({ type: "success", round: 0, turn: 0, tags: [t], skull: 1 });
  return out;
}

describe("every mission can be completed", () => {
  for (const m of Content.missions) {
    it(m.name, () => {
      const { s, p } = fresh(m.id);
      let turn = 10;
      for (const ms of m.milestones) {
        const evs = satisfy(s, p, ms.condition!, (turn += 5));
        for (const e of evs) {
          p.history.push(e);
          checkMission(s, p, e);
        }
      }
      expect(p.claimed.sort(), `${m.name} milestones`).toEqual([0, 1, 2]);
      const evs = satisfy(s, p, m.finale.condition!, (turn += 5));
      for (const e of evs) {
        p.history.push(e);
        checkMission(s, p, e);
      }
      expect(p.finaleDone, `${m.name} finale`).toBe(true);
    });
  }
});

describe("mission conditions", () => {
  it("applies finale grace: a two-skull finale works at a one-skull location once milestones are claimed", () => {
    const { s, p } = fresh("mushroom-census");
    const fin = Content.mission["mushroom-census"].finale.condition!;
    const ev: GameEvent = { type: "success", round: 1, turn: 1, tags: ["swamp"], skull: 1, stat: "wits" };
    expect(eventMeets(s, p, fin, ev, 0)).toBe(false);
    expect(eventMeets(s, p, fin, ev, 1)).toBe(true);
    p.claimed = [0, 1, 2];
    p.history.push(ev);
    expect(checkMission(s, p, ev).finale).toBe(true);
  });

  it("counts distinct locations", () => {
    const { s, p } = fresh("climb-the-great-thalowood");
    const c = Content.mission["climb-the-great-thalowood"].milestones[0].condition!;
    const a: GameEvent = { type: "success", round: 1, turn: 1, tags: ["forest"], skull: 1, location: "whispering-glade" };
    const b: GameEvent = { ...a, round: 2, turn: 2 };
    p.history.push(a, b);
    expect(eventMeets(s, p, c, b)).toBe(false); // same place twice
    const c2: GameEvent = { ...a, round: 3, turn: 3, location: "glowcap-hollow" };
    p.history.push(c2);
    expect(eventMeets(s, p, c, c2)).toBe(true);
  });

  it("checks the previous turn for streaks", () => {
    const { s, p } = fresh("the-cloud-kite-race");
    const c = Content.mission["the-cloud-kite-race"].milestones[2].condition!;
    const a: GameEvent = { type: "success", round: 1, turn: 1, tags: ["meadow"], skull: 1 };
    const b: GameEvent = { ...a, round: 3, turn: 3 };
    p.history.push(a, b);
    expect(eventMeets(s, p, c, b)).toBe(false);
    const d: GameEvent = { ...a, round: 4, turn: 4 };
    p.history.push(d);
    expect(eventMeets(s, p, c, d)).toBe(true);
  });

  it("needs a separate treasure for each tag (Mudlark's Fortune)", () => {
    const { s, p } = fresh("mudlarks-fortune");
    const fin = Content.mission["mudlarks-fortune"].finale.condition!;
    const ev: GameEvent = { type: "success", round: 1, turn: 1, tags: ["swamp"], skull: 2 };
    p.items = [treasureFrom("swamp")];
    expect(eventMeets(s, p, fin, ev)).toBe(false);
    p.items.push(treasureFrom("swamp"));
    expect(eventMeets(s, p, fin, ev)).toBe(true);
  });

  it("evaluates flourishes at the end of the game", () => {
    const { s, p } = fresh("moth-queens-lullaby");
    const f = Content.mission["moth-queens-lullaby"].flourish.condition!; // never choose Brawl
    expect(endCheck(s, p, f)).toBe(true);
    p.history.push({ type: "meetingChoice", choice: "brawl", round: 2, turn: 2 });
    expect(endCheck(s, p, f)).toBe(false);

    const t = fresh("trapwise-scout");
    const tf = Content.mission["trapwise-scout"].flourish.condition!; // spring 2 traps, never Downed
    t.p.history.push({ type: "springTrap", round: 1, turn: 1 }, { type: "springTrap", round: 2, turn: 2 });
    expect(endCheck(t.s, t.p, tf)).toBe(true);
    t.p.history.push({ type: "downed", round: 3, turn: 3 });
    expect(endCheck(t.s, t.p, tf)).toBe(false);

    const c = fresh("the-merchants-debt");
    const cf = Content.mission["the-merchants-debt"].flourish.condition!; // end with 15+ coin
    c.p.coin = 14;
    expect(endCheck(c.s, c.p, cf)).toBe(false);
    c.p.coin = 15;
    expect(endCheck(c.s, c.p, cf)).toBe(true);
  });

  it("Mushroom Census's flourish only counts pushes before the last milestone", () => {
    const { s, p } = fresh("mushroom-census");
    const f = Content.mission["mushroom-census"].flourish.condition!;
    expect(endCheck(s, p, f)).toBe(false); // milestones never all claimed
    p.history.push({ type: "success", round: 1, turn: 1, tags: ["forest"], skull: 1, stat: "wits" });
    p.log.allClaimedAt = p.history.length;
    p.history.push({ type: "push", round: 2, turn: 2 });
    expect(endCheck(s, p, f)).toBe(true);
  });
});
