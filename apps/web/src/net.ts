/**
 * The live link between a screen (the TV or a phone) and its game room.
 * It reconnects on its own, and each phone keeps a secret token so it gets its
 * seat back after a reload, a locked screen, or a dropped signal.
 */
import type { Action, CharacterSheet, GameState, Stat } from "@thaloroot/engine";
import { useCallback, useEffect, useRef, useState } from "react";

// These mirror packages/server/src/room.ts.
export type Role = "tv" | "player";
export type Speed = "slow" | "normal" | "fast";
export interface PublicSeat {
  name: string;
  species: string;
  stats: Record<Stat, number>;
  human: boolean;
  persona: "friendly" | "aggressive" | "cautious" | "balanced";
  claimed: boolean;
  connected: boolean;
  returning: boolean;
}
export interface PublicRoom {
  code: string;
  phase: "lobby" | "playing" | "over";
  length: "quick" | "standard" | "long";
  speed: Speed;
  seats: PublicSeat[];
  tv: boolean;
  moment: number | null;
}
export type HostCmd =
  | { cmd: "length"; length: PublicRoom["length"] }
  | { cmd: "speed"; speed: Speed }
  | { cmd: "addBot"; persona?: PublicSeat["persona"] }
  | { cmd: "removeSeat"; seat: number }
  | { cmd: "persona"; seat: number; persona: PublicSeat["persona"] }
  | { cmd: "release"; seat: number }
  | { cmd: "human"; seat: number; human: boolean }
  | { cmd: "start" }
  | { cmd: "again" }
  | { cmd: "moment"; seq: number };

export interface RoomLink {
  status: "connecting" | "open" | "lost" | "missing";
  room: PublicRoom | null;
  view: GameState | null;
  you: { role: Role; seat: number | null; host: boolean } | null;
  error: string | null;
  clearError(): void;
  join(sheet?: Partial<CharacterSheet>, seat?: number): void;
  edit(patch: { name?: string; species?: string; stats?: Record<Stat, number> }): void;
  leave(): void;
  act(a: Action): void;
  host(c: HostCmd): void;
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** This device's secret for a room: the same phone gets the same seat back. */
export function tokenFor(code: string, role: Role): string {
  const key = `thaloroot.token.${role}.${code}`;
  const s = store();
  let t = s?.getItem(key) ?? null;
  if (!t) {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    t = Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
    try {
      s?.setItem(key, t);
    } catch {
      /* without storage, a reload means rejoining as someone new */
    }
  }
  return t;
}

export function wsUrl(code: string): string {
  const base = (import.meta as any).env?.VITE_SERVER as string | undefined;
  const u = new URL(base ?? window.location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = `/ws/${code}`;
  u.search = "";
  u.hash = "";
  return u.toString();
}

export function apiUrl(path: string): string {
  const base = (import.meta as any).env?.VITE_SERVER as string | undefined;
  return new URL(path, base ?? window.location.href).toString();
}

/** Is there a game server behind this page? (The Claude-hosted page has none.) */
export async function serverAvailable(): Promise<boolean> {
  if (window.location.protocol === "file:") return false;
  try {
    const r = await fetch(apiUrl("/api/health"), { cache: "no-store" });
    return r.ok && (await r.json()).ok === true;
  } catch {
    return false;
  }
}

export async function openRoom(): Promise<string> {
  const r = await fetch(apiUrl("/api/rooms"), { method: "POST" });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? "Couldn't open a room.");
  return body.code as string;
}

export function useRoom(code: string, role: Role): RoomLink {
  const [status, setStatus] = useState<RoomLink["status"]>("connecting");
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [view, setView] = useState<GameState | null>(null);
  const [you, setYou] = useState<RoomLink["you"]>(null);
  const [error, setError] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const outbox = useRef<string[]>([]);

  useEffect(() => {
    let closed = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const token = tokenFor(code, role);
    const connect = () => {
      const sock = new WebSocket(wsUrl(code));
      ws.current = sock;
      sock.onopen = () => {
        tries = 0;
        setStatus("open");
        sock.send(JSON.stringify({ t: "hello", role, token }));
        for (const m of outbox.current.splice(0)) sock.send(m);
      };
      sock.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.t === "state") {
          setRoom(m.room);
          setView(m.view);
          setYou(m.you);
        } else if (m.t === "error") setError(m.message);
      };
      sock.onclose = (e) => {
        if (closed) return;
        ws.current = null;
        // a room that never opened, or was forgotten
        if (e.code === 1006 && tries > 2 && !room) setStatus("missing");
        else setStatus("lost");
        tries++;
        timer = setTimeout(connect, Math.min(5000, 400 * 2 ** Math.min(tries, 4)));
      };
    };
    // check the room exists before connecting, so a typo gets a clear message
    fetch(apiUrl(`/api/rooms/${code}`))
      .then((r) => {
        if (closed) return;
        if (r.status === 404) setStatus("missing");
        else connect();
      })
      .catch(() => !closed && connect());
    // a phone that wakes up should reconnect right away
    const wake = () => {
      if (document.visibilityState === "visible" && !ws.current && !closed) {
        if (timer) clearTimeout(timer);
        connect();
      }
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      ws.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, role]);

  const send = useCallback((m: unknown) => {
    const s = JSON.stringify(m);
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(s);
    else outbox.current.push(s);
  }, []);

  return {
    status,
    room,
    view,
    you,
    error,
    clearError: () => setError(null),
    join: (sheet, seat) => send({ t: "join", sheet, seat }),
    edit: (patch) => send({ t: "edit", patch }),
    leave: () => send({ t: "leave" }),
    act: (action) => {
      setError(null);
      send({ t: "act", action });
    },
    host: (cmd) => {
      setError(null);
      send({ t: "host", cmd });
    },
  };
}

/** Keep the screen from sleeping while a game is on (where the browser allows it). */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    let lock: any = null;
    const get = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request("screen");
      } catch {
        /* not allowed here; the game still works */
      }
    };
    get();
    const again = () => document.visibilityState === "visible" && get();
    document.addEventListener("visibilitychange", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      lock?.release?.().catch?.(() => {});
    };
  }, [on]);
}

// A returning character, remembered on this phone between games.
const CHAR_KEY = "thaloroot.character.v1";

export function savedCharacter(): Partial<CharacterSheet> | null {
  try {
    const raw = store()?.getItem(CHAR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCharacter(sheet: Partial<CharacterSheet> | null): void {
  try {
    if (sheet) store()?.setItem(CHAR_KEY, JSON.stringify(sheet));
    else store()?.removeItem(CHAR_KEY);
  } catch {
    /* storage is a convenience */
  }
}
