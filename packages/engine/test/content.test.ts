import { describe, expect, it } from "vitest";
import { Content } from "../src/content.js";
import type { Condition, Effect } from "../src/types.js";

const walkEffects = (effs: Effect[], f: (e: Effect) => void) => {
  for (const e of effs) {
    f(e);
    if (e.then) walkEffects(e.then, f);
  }
};

describe("content", () => {
  it("has the Playtest 4 card pool", () => {
    expect(Content.cards).toHaveLength(54);
    expect(Content.cards.reduce((s, c) => s + c.copies, 0)).toBe(63);
    for (const c of Content.cards) {
      expect(c.options.length, c.name).toBeGreaterThanOrEqual(3);
      expect([1, 2, 3]).toContain(c.skull);
      expect(c.tags).toContain(c.region);
    }
  });

  it("has 51 missions, 17 per tier, with Playtest 4 VP", () => {
    expect(Content.missions).toHaveLength(51);
    for (const t of [1, 2, 3] as const) {
      const ms = Content.missions.filter((m) => m.tier === t);
      expect(ms).toHaveLength(17);
      const vp = (Content.rules.missions.vp as any)[t];
      for (const m of ms) {
        expect(m.milestones.map((x) => x.vp), m.name).toEqual(vp.slice(0, 3));
        expect(m.finale.vp, m.name).toBe(vp[3]);
        expect(m.flourish.vp, m.name).toBe(2);
      }
    }
  });

  it("gives every mission part a machine condition", () => {
    for (const m of Content.missions) {
      for (const ms of m.milestones) expect(ms.condition, `${m.name}: ${ms.text}`).toBeTruthy();
      expect(m.finale.condition, `${m.name} finale`).toBeTruthy();
      expect(m.flourish.condition, `${m.name} flourish`).toBeTruthy();
    }
  });

  it("has 65 World cards in the right categories", () => {
    const counts = Object.fromEntries(
      (["weather", "monster", "merchant", "rumor", "chaos", "escalation", "finale"] as const).map((k) => [k, Content.world[k].length]),
    );
    expect(counts).toEqual({ weather: 12, monster: 9, merchant: 7, rumor: 10, chaos: 12, escalation: 6, finale: 9 });
    // the Quick deck is 14 cards plus the Finale
    const q = Content.deckCounts.quick;
    expect(q.weather + q.monster + q.merchant + q.rumor + q.chaos + q.escalation + 1).toBe(15);
    const s = Content.deckCounts.standard;
    expect(s.weather + s.monster + s.merchant + s.rumor + s.chaos + s.escalation + 1).toBe(20);
    const l = Content.deckCounts.long;
    expect(l.weather + l.monster + l.merchant + l.rumor + l.chaos + l.escalation + 1).toBe(25);
    for (const e of Content.world.escalation) expect(Content.world.finale.some((f) => f.name === e.finale), e.name).toBe(true);
  });

  it("references only items and companions that exist", () => {
    const check = (e: Effect, where: string) => {
      if (e.item) expect(Content.item[e.item], `${where}: ${e.item}`).toBeTruthy();
      if (e.ifTaken) expect(Content.item[e.ifTaken], `${where}: ${e.ifTaken}`).toBeTruthy();
      if (e.companion) expect(Content.companion[e.companion], `${where}: ${e.companion}`).toBeTruthy();
    };
    for (const c of Content.cards)
      for (const o of c.options)
        for (const k of ["success", "fail", "spark"] as const) walkEffects(o[k], (e) => check(e, `${c.name} / ${o.name}`));
    for (const w of [...Content.world.monster, ...Content.world.rumor]) {
      walkEffects(w.reward ?? [], (e) => check(e, w.name));
      for (const o of w.options ?? []) walkEffects(o.reward ?? [], (e) => check(e, w.name));
    }
    for (const i of Content.items) walkEffects(i.use ?? [], (e) => check(e, i.name));
    for (const s of Content.species) for (const h of s.hooks) if (h.item) expect(Content.item[h.item]).toBeTruthy();
  });

  it("has 20 species, 19 companions, 8 Taproot Fragments, and 14 built classes", () => {
    expect(Content.species).toHaveLength(20);
    expect(Content.companions).toHaveLength(19);
    expect(Content.fragments).toHaveLength(8);
    expect(Content.classes.filter((c) => c.status === "built")).toHaveLength(14);
  });

  it("keeps the Spark conversions from Playtest 2 and the Sunken Chapel change from Playtest 4", () => {
    const opt = (card: string, i: number) => Content.card[card].options[i];
    expect(opt("whispering-glade", 0).stats).toEqual(["spark"]);
    expect(opt("the-grafted-gate", 2).stats).toEqual(["spark"]);
    const dive = opt("the-sunken-chapel", 0);
    expect(dive.success).toEqual([{ type: "item", item: "the-sunken-crown", ifTaken: "drowned-reliquary" }]);
  });

  it("only uses condition keys the engine understands", () => {
    const known = new Set([
      "event", "tags", "minSkull", "stats", "stat", "count", "distinct", "requires", "previousTurn", "cost", "choice",
      "trapType", "minCorrect", "teamedUp", "asAmbusher", "minSixes", "minNeed", "noPush", "pushed", "noAssist", "noItem",
      "duringMeeting", "teamUp", "withMishap", "minStaminaSpent", "lessonInstead", "atTrappedLocation", "sprangTrapThisTurn",
      "never", "ever", "until", "end", "all", "any",
    ]);
    const walk = (c: Condition | null | undefined, where: string) => {
      if (!c) return;
      for (const k of Object.keys(c)) expect(known.has(k), `${where}: ${k}`).toBe(true);
      for (const sub of [c.previousTurn, c.never, c.ever, ...(c.all ?? []), ...(c.any ?? [])]) walk(sub, where);
    };
    for (const m of Content.missions) {
      m.milestones.forEach((x) => walk(x.condition, m.name));
      walk(m.finale.condition, m.name);
      walk(m.flourish.condition, m.name);
    }
  });
});

describe("engine coverage", () => {
  it("emits every event a mission or Rumor listens for", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = new URL("../src/", import.meta.url);
    const src = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
    const emitted = new Set([...src.matchAll(/type: "(\w+)"/g)].map((m) => m[1]));
    const used = new Set<string>();
    const walk = (c: Condition | null | undefined) => {
      if (!c) return;
      if (c.event) used.add(c.event);
      for (const sub of [c.previousTurn, c.never, c.ever, ...(c.all ?? []), ...(c.any ?? [])]) walk(sub);
    };
    for (const m of Content.missions) {
      m.milestones.forEach((x) => walk(x.condition));
      walk(m.finale.condition);
      walk(m.flourish.condition);
    }
    for (const r of Content.world.rumor) walk(r.claim);
    // Known gaps: these come from class actives and table talk the engine doesn't automate yet.
    const notYet = new Set(["curseLocation", "shareReward"]);
    const missing = [...used].filter((e) => !emitted.has(e) && !notYet.has(e) && e !== "roll");
    expect(missing).toEqual([]);
  });
});

describe("story", () => {
  it("has a scene for every option, an arc for every mission, and a moment for every World card", () => {
    for (const c of Content.cards) {
      const loc = Content.story.locations[c.id];
      expect(loc, c.name).toBeTruthy();
      for (const o of c.options) {
        const t = loc.options[o.name];
        expect(t, `${c.name} / ${o.name}`).toBeTruthy();
        if (o.rest) expect(t.scene, `${c.name} / ${o.name}`).toBeTruthy();
        else {
          expect(t.success, `${c.name} / ${o.name}`).toBeTruthy();
          expect(t.fail, `${c.name} / ${o.name}`).toBeTruthy();
          if (o.spark.length) expect(t.spark, `${c.name} / ${o.name} spark`).toBeTruthy();
        }
      }
    }
    for (const m of Content.missions) {
      const a = Content.story.missions[m.id];
      expect(a.opening && a.finale && a.milestones.every(Boolean), m.name).toBeTruthy();
    }
    for (const w of Object.values(Content.worldCard)) expect(Content.story.world[w.id], w.name).toBeTruthy();
  });
});
