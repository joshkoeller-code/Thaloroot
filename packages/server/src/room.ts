/**
 * A game room: one shared TV, a phone for each person, and computer players,
 * all kept in sync. The room owns the full GameState; every screen only ever
 * receives the view its seat is allowed to see.
 *
 * The room knows nothing about sockets or hosting. An adapter (the local Node
 * server, or a Cloudflare Durable Object) hands it connections and messages,
 * gives it a clock, and saves its data.
 */
import {
  act,
  botAction,
  Content,
  createGame,
  exportCharacter,
  IllegalAction,
  STATS,
  viewFor,
  type Action,
  type BotPersona,
  type CharacterSheet,
  type GameLength,
  type GameState,
  type Stat,
} from "@thaloroot/engine";

export type Speed = "slow" | "normal" | "fast";
export const BOT_DELAY: Record<Speed, number> = { slow: 1400, normal: 750, fast: 150 };
/** How long the game waits on the TV to show a World card before carrying on. */
export const MOMENT_WAIT = 15_000;
/** Letters for room codes: no 0/O, 1/I/L, or vowels that spell words. */
const CODE_LETTERS = "BCDFGHJKMNPQRSTVWXZ";

export interface Seat {
  name: string;
  species: string;
  stats: Record<Stat, number>;
  /** Carried over from earlier games, if the phone brought a returning character. */
  carry?: Pick<CharacterSheet, "lessons" | "quirks" | "heirlooms">;
  isNew: boolean;
  human: boolean;
  persona: BotPersona;
  /** The phone that owns this seat (a secret the phone keeps). */
  token: string | null;
}

export interface RoomData {
  version: 1;
  code: string;
  phase: "lobby" | "playing" | "over";
  length: GameLength;
  speed: Speed;
  seats: Seat[];
  game: GameState | null;
  /** The last World card moment the TV has shown. */
  seenWorld: number;
  /** When the current World card moment started waiting on the TV. */
  momentSince: number | null;
  created: number;
  updated: number;
}

export interface PublicSeat {
  name: string;
  species: string;
  stats: Record<Stat, number>;
  human: boolean;
  persona: BotPersona;
  claimed: boolean;
  connected: boolean;
  returning: boolean;
}

export interface PublicRoom {
  code: string;
  phase: RoomData["phase"];
  length: GameLength;
  speed: Speed;
  seats: PublicSeat[];
  tv: boolean;
  /** The World card moment the TV should be showing, if any. */
  moment: number | null;
}

export type Role = "tv" | "player";

export type ClientMsg =
  | { t: "hello"; role: Role; token: string }
  | { t: "join"; sheet?: Partial<CharacterSheet>; seat?: number }
  | { t: "edit"; patch: { name?: string; species?: string; stats?: Record<Stat, number> } }
  | { t: "leave" }
  | { t: "act"; action: Action }
  | { t: "host"; cmd: HostCmd }
  | { t: "ping" };

export type HostCmd =
  | { cmd: "length"; length: GameLength }
  | { cmd: "speed"; speed: Speed }
  | { cmd: "addBot"; persona?: BotPersona }
  | { cmd: "removeSeat"; seat: number }
  | { cmd: "persona"; seat: number; persona: BotPersona }
  | { cmd: "release"; seat: number }
  | { cmd: "human"; seat: number; human: boolean }
  | { cmd: "start" }
  | { cmd: "again" }
  | { cmd: "moment"; seq: number };

export type ServerMsg =
  | { t: "state"; room: PublicRoom; you: { role: Role; seat: number | null; host: boolean }; view: GameState | null }
  | { t: "error"; message: string }
  | { t: "pong" };

export interface Conn {
  readonly id: string;
  send(msg: ServerMsg): void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as any),
};

interface Session {
  conn: Conn;
  role: Role;
  token: string;
}

const POINTS = Content.rules.character.creationPoints;
const MAX_START = Content.rules.character.creationMax;
const BOT_NAMES = ["Wren", "Bram", "Isolde", "Fennick", "Juniper", "Oswin", "Mara", "Tobias"];

export function roomCode(random: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)]).join("");
}

export function newRoom(code: string, now = Date.now()): RoomData {
  return { version: 1, code, phase: "lobby", length: "quick", speed: "normal", seats: [], game: null, seenWorld: 0, momentSince: null, created: now, updated: now };
}

function randomStats(random: () => number = Math.random): Record<Stat, number> {
  const stats = { brawn: 1, wits: 1, charm: 1, spark: 1, luck: 1 } as Record<Stat, number>;
  let left = POINTS;
  while (left > 0) {
    const k = STATS[Math.floor(random() * 5)];
    if (stats[k] < MAX_START) {
      stats[k]++;
      left--;
    }
  }
  return stats;
}

/** A returning character may have grown past the starting limits; a new one must follow them. */
function validStats(stats: Record<Stat, number> | undefined, isNew: boolean): boolean {
  if (!stats) return false;
  const cap = Content.rules.character.statCap;
  if (!STATS.every((k) => Number.isInteger(stats[k]) && stats[k] >= 1 && stats[k] <= cap)) return false;
  if (!isNew) return true;
  return STATS.every((k) => stats[k] <= MAX_START) && STATS.reduce((t, k) => t + stats[k] - 1, 0) === POINTS;
}

export class Room {
  data: RoomData;
  private sessions = new Map<string, Session>();
  private timer: unknown = null;
  private clock: Clock;
  private save: (d: RoomData) => void;
  private random: () => number;

  constructor(data: RoomData, opts: { clock?: Clock; save?: (d: RoomData) => void; random?: () => number } = {}) {
    this.data = data;
    this.clock = opts.clock ?? realClock;
    this.save = opts.save ?? (() => {});
    this.random = opts.random ?? Math.random;
  }

  // ---------------------------------------------------------------------------
  // Connections
  // ---------------------------------------------------------------------------

  connect(conn: Conn): void {
    // nothing is known until the screen says hello
    this.sessions.set(conn.id, { conn, role: "player", token: "" });
  }

  disconnect(conn: Conn): void {
    this.sessions.delete(conn.id);
    this.broadcast();
    this.pump();
  }

  get connections(): number {
    return this.sessions.size;
  }

  private seatOf(token: string): number | null {
    if (!token) return null;
    const i = this.data.seats.findIndex((s) => s.token === token);
    return i < 0 ? null : i;
  }

  private connected(token: string | null): boolean {
    if (!token) return false;
    for (const s of this.sessions.values()) if (s.token === token) return true;
    return false;
  }

  private tvConnected(): boolean {
    for (const s of this.sessions.values()) if (s.role === "tv") return true;
    return false;
  }

  /** The TV runs the room; with no TV, the first person seated does. */
  private isHost(s: Session): boolean {
    if (s.role === "tv") return true;
    if (this.tvConnected()) return false;
    const first = this.data.seats.findIndex((x) => x.human && this.connected(x.token));
    return first >= 0 && this.data.seats[first].token === s.token;
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  message(conn: Conn, msg: ClientMsg): void {
    const s = this.sessions.get(conn.id);
    if (!s) return;
    try {
      this.handle(s, msg);
    } catch (e: any) {
      conn.send({ t: "error", message: e instanceof IllegalAction || e instanceof RoomError ? e.message : `Something went wrong: ${e?.message ?? e}` });
      this.send(s);
    }
  }

  private handle(s: Session, msg: ClientMsg): void {
    const d = this.data;
    switch (msg.t) {
      case "ping":
        s.conn.send({ t: "pong" });
        return;
      case "hello":
        if (typeof msg.token !== "string" || msg.token.length < 8) throw new RoomError("That screen needs a longer token.");
        s.role = msg.role === "tv" ? "tv" : "player";
        s.token = msg.token;
        this.changed();
        return;
      case "join": {
        if (s.role !== "player" || !s.token) throw new RoomError("Say hello first.");
        if (this.seatOf(s.token) !== null) return this.send(s);
        if (msg.seat !== undefined) {
          // take over a seat the table has freed up (a new phone, or a lost one)
          const seat = d.seats[msg.seat];
          if (!seat || seat.token || !seat.human) throw new RoomError("That seat isn't free.");
          seat.token = s.token;
          this.changed();
          return;
        }
        if (d.phase !== "lobby") throw new RoomError("This game has already started. Ask the table to free up a seat for you.");
        if (d.seats.length >= Content.rules.players.max) throw new RoomError(`The table is full (${Content.rules.players.max} adventurers).`);
        const sh = msg.sheet ?? {};
        const returning = !!sh.stats && !sh.isNew && validStats(sh.stats, false) && !validStats(sh.stats, true);
        const species = sh.species && Content.speciesById[sh.species] ? sh.species : Content.species[Math.floor(this.random() * Content.species.length)].id;
        d.seats.push({
          name: (sh.name ?? "").trim().slice(0, 24) || `Adventurer ${d.seats.length + 1}`,
          species,
          stats: sh.stats && validStats(sh.stats, !returning) ? { ...sh.stats } : randomStats(this.random),
          carry: returning || sh.lessons || sh.quirks || sh.heirlooms ? { lessons: sh.lessons, quirks: sh.quirks, heirlooms: sh.heirlooms } : undefined,
          isNew: !returning,
          human: true,
          persona: "balanced",
          token: s.token,
        });
        this.changed();
        return;
      }
      case "edit": {
        const i = this.seatOf(s.token);
        if (i === null) throw new RoomError("You don't have a seat yet.");
        if (d.phase !== "lobby") throw new RoomError("Characters are locked once the game starts.");
        const seat = d.seats[i];
        const p = msg.patch ?? {};
        if (p.name !== undefined) seat.name = String(p.name).slice(0, 24);
        if (p.species && Content.speciesById[p.species]) seat.species = p.species;
        if (p.stats) {
          if (!validStats(p.stats, seat.isNew)) throw new RoomError(`Spend exactly ${POINTS} points, with no stat above ${MAX_START}.`);
          seat.stats = { ...p.stats };
        }
        this.changed();
        return;
      }
      case "leave": {
        const i = this.seatOf(s.token);
        if (i === null) return;
        if (d.phase === "lobby") d.seats.splice(i, 1);
        else d.seats[i].token = null;
        this.changed();
        return;
      }
      case "act": {
        const i = this.seatOf(s.token);
        if (i === null || !d.game) throw new RoomError("You aren't playing in this game.");
        const a = msg.action;
        if (!a || a.player !== i) throw new RoomError("That isn't your choice to make.");
        if (!d.seats[i].human) throw new RoomError("A computer player has this seat.");
        d.game = act(d.game, a);
        this.afterAction();
        return;
      }
      case "host":
        if (!this.isHost(s)) throw new RoomError("Only the TV (or the first player, with no TV) can do that.");
        this.host(msg.cmd);
        return;
      default:
        throw new RoomError("Unknown message.");
    }
  }

  private host(c: HostCmd): void {
    const d = this.data;
    switch (c.cmd) {
      case "length":
        if (d.phase !== "lobby") throw new RoomError("The game has already started.");
        if (!["quick", "standard", "long"].includes(c.length)) throw new RoomError("Unknown game length.");
        d.length = c.length;
        break;
      case "speed":
        if (!BOT_DELAY[c.speed]) throw new RoomError("Unknown speed.");
        d.speed = c.speed;
        break;
      case "addBot": {
        if (d.phase !== "lobby") throw new RoomError("The game has already started.");
        if (d.seats.length >= Content.rules.players.max) throw new RoomError("The table is full.");
        const used = new Set(d.seats.map((x) => x.name));
        d.seats.push({
          name: BOT_NAMES.find((n) => !used.has(n)) ?? `Computer ${d.seats.length + 1}`,
          species: Content.species[Math.floor(this.random() * Content.species.length)].id,
          stats: randomStats(this.random),
          isNew: true,
          human: false,
          persona: c.persona ?? "balanced",
          token: null,
        });
        break;
      }
      case "removeSeat":
        if (d.phase !== "lobby") throw new RoomError("Seats can't be removed once the game starts.");
        if (!d.seats[c.seat]) throw new RoomError("No such seat.");
        d.seats.splice(c.seat, 1);
        break;
      case "persona": {
        const seat = d.seats[c.seat];
        if (!seat || seat.human) throw new RoomError("Only computer seats have a personality.");
        seat.persona = c.persona;
        break;
      }
      case "release": {
        // free a person's seat so another phone can take it (a lost phone, a new player)
        const seat = d.seats[c.seat];
        if (!seat) throw new RoomError("No such seat.");
        seat.token = null;
        break;
      }
      case "human": {
        // hand a seat to a computer player (someone had to leave), or back to a person
        const seat = d.seats[c.seat];
        if (!seat) throw new RoomError("No such seat.");
        seat.human = c.human;
        if (!c.human) seat.token = null;
        break;
      }
      case "start": {
        if (d.phase !== "lobby") throw new RoomError("The game has already started.");
        const min = Content.rules.players.min;
        if (d.seats.length < min) throw new RoomError(`Thaloroot needs at least ${min} adventurers.`);
        if (!d.seats.some((x) => x.human)) throw new RoomError("Nobody has joined from a phone yet.");
        if (d.seats.some((x) => !x.name.trim())) throw new RoomError("Every adventurer needs a name.");
        this.startGame();
        break;
      }
      case "again": {
        if (d.phase !== "over" || !d.game) throw new RoomError("The game isn't over yet.");
        // everyone keeps their growth, leftover Lessons, quirks, and heirlooms
        const g = d.game;
        d.seats = d.seats.map((seat, i) => {
          const sheet = exportCharacter(g, i);
          return { ...seat, stats: sheet.stats, isNew: false, carry: { lessons: sheet.lessons, quirks: sheet.quirks, heirlooms: sheet.heirlooms } };
        });
        this.startGame();
        break;
      }
      case "moment":
        d.seenWorld = Math.max(d.seenWorld, c.seq);
        d.momentSince = null;
        break;
      default:
        throw new RoomError("Unknown command.");
    }
    this.changed();
  }

  private startGame(): void {
    const d = this.data;
    d.game = createGame({
      seed: Math.floor(this.random() * 2 ** 31),
      length: d.length,
      players: d.seats.map((s) => ({
        name: s.name.trim(),
        species: s.species,
        stats: { ...s.stats },
        bot: s.persona,
        isNew: s.isNew,
        ...(s.carry ?? {}),
      })),
    });
    d.phase = "playing";
    d.seenWorld = 0;
    d.momentSince = null;
  }

  private afterAction(): void {
    const d = this.data;
    if (d.game?.phase === "over") d.phase = "over";
    this.changed();
  }

  // ---------------------------------------------------------------------------
  // Computer players and World card moments
  // ---------------------------------------------------------------------------

  /** The World card moment the TV hasn't shown yet. */
  pendingMoment(): number | null {
    const g = this.data.game;
    if (!g) return null;
    const b = g.story.find((x) => x.kind === "world" && x.seq > this.data.seenWorld);
    return b ? b.seq : null;
  }

  /** Schedule the next computer move, if one is due. */
  private pump(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    const d = this.data;
    const g = d.game;
    if (!g || d.phase !== "playing") return;
    const moment = this.pendingMoment();
    if (moment !== null) {
      if (!this.tvConnected()) {
        d.seenWorld = moment;
        d.momentSince = null;
      } else {
        // give the TV time to show the World card before the computers move on
        d.momentSince ??= this.clock.now();
        const left = d.momentSince + MOMENT_WAIT - this.clock.now();
        if (left > 0) {
          this.timer = this.clock.setTimeout(() => {
            this.timer = null;
            this.pump();
          }, left);
          return;
        }
        d.seenWorld = moment;
        d.momentSince = null;
      }
    }
    const next = g.pending.find((x) => !d.seats[x.player]?.human);
    if (!next) return;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      const cur = this.data.game;
      if (!cur || this.data.phase !== "playing") return;
      const dd = cur.pending.find((x) => !this.data.seats[x.player]?.human);
      if (!dd) return;
      this.data.game = act(cur, botAction(cur, dd));
      this.afterAction();
    }, BOT_DELAY[d.speed]);
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  private changed(): void {
    this.data.updated = this.clock.now();
    this.save(this.data);
    this.broadcast();
    this.pump();
  }

  publicRoom(): PublicRoom {
    const d = this.data;
    return {
      code: d.code,
      phase: d.phase,
      length: d.length,
      speed: d.speed,
      tv: this.tvConnected(),
      moment: this.tvConnected() ? this.pendingMoment() : null,
      seats: d.seats.map((s) => ({
        name: s.name,
        species: s.species,
        stats: s.stats,
        human: s.human,
        persona: s.persona,
        claimed: !!s.token,
        connected: this.connected(s.token),
        returning: !s.isNew,
      })),
    };
  }

  private send(s: Session): void {
    const seat = s.role === "player" ? this.seatOf(s.token) : null;
    const g = this.data.game;
    const view = g ? viewFor(g, s.role === "tv" ? "tv" : seat ?? "tv") : null;
    s.conn.send({ t: "state", room: this.publicRoom(), you: { role: s.role, seat, host: this.isHost(s) }, view });
  }

  private broadcast(): void {
    for (const s of this.sessions.values()) if (s.token) this.send(s);
  }

  /** Pick up where the room left off (after loading it from storage). */
  resume(): void {
    this.pump();
  }

  /** Stop timers (when an adapter shuts the room down). */
  close(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}

export class RoomError extends Error {}
