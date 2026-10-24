/**
 * Balance guardrails. These run bot games and check the numbers stay inside a
 * wide band around Playtest 4, so a rules or content change that breaks the
 * game's shape fails CI. They are not precise balance targets; use
 * `npm run sim` for real analysis.
 */
import { describe, expect, it } from "vitest";
import { runBatch, summarize } from "../src/sim.js";

describe("balance guardrails (Playtest 4 setup, Quick)", () => {
  const s = summarize(runBatch(300, { length: "quick", playtest: true, seedBase: 101 }));

  it("missions are the biggest source of VP", () => {
    expect(s.missionVp).toBeGreaterThan(s.treasureVp);
  });

  it("finales are reachable but not automatic", () => {
    expect(s.finaleRate).toBeGreaterThan(0.2);
    expect(s.finaleRate).toBeLessThan(0.6);
    expect(s.finisherRate).toBeGreaterThan(0.7);
  });

  it("Meetings happen a few times a game", () => {
    expect(s.meetings).toBeGreaterThan(2);
    expect(s.meetings).toBeLessThan(7);
  });

  it("a Quick game lasts about 10 to 14 rounds", () => {
    expect(s.rounds).toBeGreaterThan(9);
    expect(s.rounds).toBeLessThan(15);
  });

  it("no class dominates or collapses", () => {
    for (const [cls, v] of Object.entries(s.byClass)) {
      expect(v.win, cls).toBeGreaterThan(0.05);
      expect(v.win, cls).toBeLessThan(0.5);
    }
  });

  it("winners don't run away with it", () => {
    expect(s.margin).toBeLessThan(18);
  });
});

describe("balance guardrails (full content)", () => {
  it("plays 2 to 8 players without stalling", () => {
    for (const players of [2, 3, 6, 8]) {
      const s = summarize(runBatch(25, { length: "quick", players, seedBase: 7 + players }));
      expect(s.rounds, `${players} players`).toBeGreaterThan(6);
      expect(s.missionVp, `${players} players`).toBeGreaterThan(5);
    }
  });
});
