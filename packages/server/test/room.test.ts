import { describe, expect, it } from "vitest";
import { botAction, type GameState } from "@thaloroot/engine";
import { MOMENT_WAIT, Room, newRoom, type Clock, type Conn, type ServerMsg } from "../src/room.js";

/** A clock the test drives by hand. */
class FakeClock implements Clock {
  t = 0;
  private q: { at: number; fn: () => void; id: number }[] = [];
  private n = 0;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.n;
    this.q.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(h: unknown) {
    this.q = this.q.filter((x) => x.id !== h);
  }
  /** Run the next timer. Returns false when none are waiting. */
  tick(): boolean {
    this.q.sort((a, b) => a.at - b.at || a.id - b.id);
    const next = this.q.shift();
    if (!next) return false;
    this.t = Math.max(this.t, next.at);
    next.fn();
    return true;
  }
}

class Screen implements Conn {
  static n = 0;
  id = `c${++Screen.n}`;
  msgs: ServerMsg[] = [];
  constructor(public room: Room, public token: string, role: "tv" | "player") {
    room.connect(this);
    room.message(this, { t: "hello", role, token });
  }
  send(m: ServerMsg) {
    this.msgs.push(m);
  }
  get last() {
    return [...this.msgs].reverse().find((m) => m.t === "state") as Extract<ServerMsg, { t: "state" }>;
  }
  get errors() {
    return this.msgs.filter((m) => m.t === "error").map((m) => (m as any).message as string);
  }
  say(m: any) {
    this.room.message(this, m);
  }
}

function table(nPhones = 2, bots = 1) {
  const clock = new FakeClock();
  let r = 12345;
  const random = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648;
  const saves: number[] = [];
  const room = new Room(newRoom("BCDF", 0), { clock, random, save: (d) => saves.push(d.updated) });
  const tv = new Screen(room, "tv-token-xyz", "tv");
  const phones = Array.from({ length: nPhones }, (_, i) => new Screen(room, `phone-token-${i}`, "player"));
  phones.forEach((p, i) => p.say({ t: "join", sheet: { name: ["Ada", "Bo", "Cy", "Di"][i], species: "humans", stats: { brawn: 3, wits: 3, charm: 2, spark: 2, luck: 2 } } }));
  for (let i = 0; i < bots; i++) tv.say({ t: "host", cmd: { cmd: "addBot" } });
  return { clock, room, tv, phones, saves };
}

/** Every phone answers its own decisions the way a computer player would, until `stop`. */
function play(t: ReturnType<typeof table>, stop: (g: GameState) => boolean = (g) => g.phase === "over", max = 20000) {
  for (let i = 0; i < max; i++) {
    const g = t.room.data.game!;
    if (stop(g)) return;
    // the TV shows each World card as it comes
    const m = t.tv.last.room.moment;
    if (m !== null) t.tv.say({ t: "host", cmd: { cmd: "moment", seq: m } });
    const mine = g.pending.find((d) => t.room.data.seats[d.player].human);
    if (mine) {
      const phone = t.phones.find((p) => p.last.you.seat === mine.player)!;
      phone.say({ t: "act", action: botAction(g, mine) });
      continue;
    }
    if (!t.clock.tick()) throw new Error(`stuck: ${JSON.stringify(g.pending.map((d) => [d.player, d.kind]))}`);
  }
  throw new Error("game didn't finish");
}

describe("the lobby", () => {
  it("seats phones, adds computer players, and lets only the TV start", () => {
    const t = table(2, 1);
    const seats = t.tv.last.room.seats;
    expect(seats.map((s) => [s.name, s.human, s.connected])).toEqual([
      ["Ada", true, true],
      ["Bo", true, true],
      [seats[2].name, false, false],
    ]);
    expect(t.phones[0].last.you).toEqual({ role: "player", seat: 0, host: false });
    expect(t.tv.last.you.host).toBe(true);
    t.phones[0].say({ t: "host", cmd: { cmd: "start" } });
    expect(t.phones[0].errors.at(-1)).toMatch(/Only the TV/);
    t.tv.say({ t: "host", cmd: { cmd: "start" } });
    expect(t.room.data.phase).toBe("playing");
    expect(t.saves.length).toBeGreaterThan(3);
  });

  it("checks a new character's points", () => {
    const t = table(1, 1);
    t.phones[0].say({ t: "edit", patch: { stats: { brawn: 4, wits: 4, charm: 4, spark: 1, luck: 1 } } });
    expect(t.phones[0].errors.at(-1)).toMatch(/Spend exactly 7/);
    t.phones[0].say({ t: "edit", patch: { name: "Ada the Bold", stats: { brawn: 4, wits: 4, charm: 1, spark: 1, luck: 2 } } });
    expect(t.room.data.seats[0]).toMatchObject({ name: "Ada the Bold", stats: { brawn: 4, wits: 4 } });
  });

  it("with no TV, the first person seated runs the room", () => {
    const clock = new FakeClock();
    const room = new Room(newRoom("BCDG", 0), { clock });
    const a = new Screen(room, "phone-token-a", "player");
    const b = new Screen(room, "phone-token-b", "player");
    a.say({ t: "join" });
    b.say({ t: "join" });
    expect(a.last.you.host).toBe(true);
    expect(b.last.you.host).toBe(false);
    a.say({ t: "host", cmd: { cmd: "start" } });
    expect(room.data.phase).toBe("playing");
  });
});

describe("playing", () => {
  it("plays a whole game: phones answer their own choices, computers take turns", () => {
    const t = table(2, 2);
    t.tv.say({ t: "host", cmd: { cmd: "start" } });
    play(t);
    expect(t.room.data.phase).toBe("over");
    expect(t.room.data.game!.scores).toHaveLength(4);
    expect(t.tv.last.view!.phase).toBe("over");
  });

  it("each screen sees only what its seat may see", () => {
    const t = table(2, 1);
    t.tv.say({ t: "host", cmd: { cmd: "start" } });
    play(t, (g) => g.phase === "pick");
    const [a, b] = t.phones.map((p) => p.last.view!);
    expect(a.players[0].mission).toBeTruthy();
    expect(a.players[1].mission).toBe(null);
    expect(b.players[0].mission).toBe(null);
    expect(t.tv.last.view!.players.every((p) => p.mission === null)).toBe(true);
    // only your own decision carries its details
    expect(a.pending.find((d) => d.player === 0)!.data.cards).toHaveLength(2);
    expect(a.pending.find((d) => d.player === 1)!.data).toEqual({});
  });

  it("refuses choices made for someone else", () => {
    const t = table(2, 1);
    t.tv.say({ t: "host", cmd: { cmd: "start" } });
    play(t, (g) => g.phase === "pick");
    const g = t.room.data.game!;
    const theirs = g.pending.find((d) => d.player === 1)!;
    t.phones[0].say({ t: "act", action: botAction(g, theirs) });
    expect(t.phones[0].errors.at(-1)).toMatch(/isn't your choice/);
  });

  it("waits for the TV to show a World card, but not forever", () => {
    const t = table(1, 2);
    t.tv.say({ t: "host", cmd: { cmd: "start" } });
    // play until a World card is waiting, without acknowledging it
    for (let i = 0; i < 5000 && t.room.pendingMoment() === null; i++) {
      const g = t.room.data.game!;
      const mine = g.pending.find((d) => d.player === 0);
      if (mine) t.phones[0].say({ t: "act", action: botAction(g, mine) });
      else t.clock.tick();
    }
    const seq = t.room.pendingMoment();
    expect(seq).not.toBe(null);
    expect(t.tv.last.room.moment).toBe(seq);
    const at = t.clock.t;
    // computer players hold still until the wait runs out
    t.clock.tick();
    expect(t.clock.t - at).toBeGreaterThanOrEqual(MOMENT_WAIT - 1);
    expect(t.room.pendingMoment()).not.toBe(seq);
  });
});

describe("dropping out and coming back", () => {
  it("a phone that reconnects gets its seat back", () => {
    const t = table(2, 1);
    t.tv.say({ t: "host", cmd: { cmd: "start" } });
    play(t, (g) => g.round >= 2);
    t.room.disconnect(t.phones[1]);
    expect(t.tv.last.room.seats[1].connected).toBe(false);
    const again = new Screen(t.room, "phone-token-1", "player");
    expect(again.last.you.seat).toBe(1);
    expect(again.last.view!.players[1].mission).toBeTruthy();
    expect(t.tv.last.room.seats[1].connected).toBe(true);
  });

  it("the TV can free a seat for a new phone, or hand it to a computer player", () => {
    const t = table(2, 1);
    t.tv.say({ t: "host", cmd: { cmd: "start" } });
    play(t, (g) => g.round >= 2);
    t.tv.say({ t: "host", cmd: { cmd: "release", seat: 1 } });
    const fresh = new Screen(t.room, "new-phone-token", "player");
    fresh.say({ t: "join", seat: 1 });
    expect(fresh.last.you.seat).toBe(1);
    t.phones[1] = fresh;
    // and Ada leaves: a computer finishes her game
    t.tv.say({ t: "host", cmd: { cmd: "human", seat: 0, human: false } });
    play(t);
    expect(t.room.data.phase).toBe("over");
  });

  it("a room saved mid-game picks up where it left off", () => {
    const t = table(1, 2);
    t.tv.say({ t: "host", cmd: { cmd: "start" } });
    play(t, (g) => g.round >= 2);
    const copy = JSON.parse(JSON.stringify(t.room.data));
    t.room.close();
    const clock = new FakeClock();
    const room = new Room(copy, { clock });
    room.resume();
    const phone = new Screen(room, "phone-token-0", "player");
    expect(phone.last.you.seat).toBe(0);
    expect(phone.last.view!.round).toBe(copy.game.round);
  });
});

describe("playing again", () => {
  it("keeps everyone's growth for the next game", () => {
    const t = table(1, 1);
    t.tv.say({ t: "host", cmd: { cmd: "start" } });
    play(t);
    const before = t.room.data.game!.players.map((p) => ({ ...p.baseStats }));
    t.tv.say({ t: "host", cmd: { cmd: "again" } });
    expect(t.room.data.phase).toBe("playing");
    expect(t.room.data.game!.players.map((p) => p.baseStats)).toEqual(before);
    expect(t.room.data.seats.every((s) => !s.isNew)).toBe(true);
  });
});
