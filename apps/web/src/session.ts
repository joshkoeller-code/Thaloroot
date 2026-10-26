/**
 * A pass-and-play session: the engine's GameState plus which seats are people,
 * who is holding the device for a private choice, and how fast computer
 * players move. Everything here is plain data so it can be saved.
 */
import { act, botAction, type Action, type CharacterSheet, type Decision, type GameState } from "@thaloroot/engine";
import { useCallback, useEffect, useRef, useState } from "react";

export type Speed = "slow" | "normal" | "fast";
export const SPEED_MS: Record<Speed, number> = { slow: 1100, normal: 550, fast: 140 };

export interface Session {
  game: GameState;
  humans: boolean[];
  speed: Speed;
  /** The person currently holding the device for a private choice. */
  holder: number | null;
  /** Shown after a private choice so the next person doesn't see it. */
  covered: { name: string } | null;
  started: number;
  /** The last World card moment everyone has seen. */
  seenWorld?: number;
  /** Per player: the last of their own story beats they've read. */
  journalSeen?: Record<number, number>;
}

/** The World card moment waiting to be shown, if any. */
export function pendingMoment(s: Session) {
  const seen = s.seenWorld ?? 0;
  return s.game.story.find((b) => b.kind === "world" && b.seq > seen) ?? null;
}

/** Choices only the deciding player should see. */
export const PRIVATE: Decision["kind"][] = ["chooseMission", "pickTeaser", "meetingChoice", "quickAction", "finalGuess", "respondTrade"];

export function isPrivate(d: Decision): boolean {
  return PRIVATE.includes(d.kind);
}

/** Which decision the screen should show: computer players first, then people in order. */
export function currentDecision(s: Session): Decision | null {
  const p = s.game.pending;
  if (!p.length) return null;
  return p.find((d) => !s.humans[d.player]) ?? p.find((d) => d.player === s.holder) ?? p[0];
}

const SAVE_KEY = "thaloroot.pass-and-play.v1";

export function loadSaved(): Session | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s.game?.version === 1 ? s : null;
  } catch {
    return null;
  }
}

function save(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage is a convenience; the game works without it */
  }
}

export interface Controller {
  moment: ReturnType<typeof pendingMoment>;
  ackMoment(): void;
  session: Session;
  decision: Decision | null;
  /** True while a person must take the device before seeing this decision. */
  needsHandoff: boolean;
  submit(a: Action): void;
  takeDevice(player: number): void;
  uncover(): void;
  setSpeed(s: Speed): void;
  skipAhead(): void;
  error: string | null;
}

export function useSession(initial: Session, onChange?: (s: Session) => void): Controller {
  const [session, setSession] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const skip = useRef(false);
  const decision = currentDecision(session);
  const human = decision ? session.humans[decision.player] : false;
  const needsHandoff = !!decision && human && isPrivate(decision) && session.holder !== decision.player;

  const apply = useCallback((s: Session, a: Action): Session => {
    const game = act(s.game, a);
    let holder = s.holder;
    let covered = s.covered;
    let journalSeen = s.journalSeen ?? {};
    if (s.humans[a.player] && PRIVATE.includes(a.kind as Decision["kind"])) {
      // they just had the device: everything in their tale up to now counts as read
      const mine = s.game.story.filter((b) => b.kind === "mission" && b.player === a.player);
      if (mine.length) journalSeen = { ...journalSeen, [a.player]: mine[mine.length - 1].seq };
    }
    if (s.humans[a.player] && PRIVATE.includes(a.kind as Decision["kind"])) {
      const next = currentDecision({ ...s, game, holder: a.player });
      const sameSecret = next && next.player === a.player && isPrivate(next) && s.humans[next.player];
      if (!sameSecret) {
        holder = null;
        covered = { name: s.game.players[a.player].name };
      }
    }
    return { ...s, game, holder, covered, journalSeen };
  }, []);

  const update = useCallback(
    (fn: (s: Session) => Session) => {
      setSession((s) => {
        try {
          const n = fn(s);
          save(n);
          onChange?.(n);
          setError(null);
          return n;
        } catch (e: any) {
          setError(String(e?.message ?? e));
          return s;
        }
      });
    },
    [onChange],
  );

  const moment = pendingMoment(session);
  const anyHuman = session.humans.some(Boolean);

  // with nobody at the table, World moments dismiss themselves
  useEffect(() => {
    if (!moment || anyHuman) return;
    const t = setTimeout(() => update((s) => ({ ...s, seenWorld: moment.seq })), skip.current ? 0 : SPEED_MS[session.speed] * 4);
    return () => clearTimeout(t);
  }, [moment, anyHuman, session.speed, update]);

  // computer players
  useEffect(() => {
    if (!decision || human || session.game.phase === "over") return;
    if (moment && anyHuman) return; // wait until the table has seen the World card
    const delay = skip.current ? 0 : SPEED_MS[session.speed];
    const t = setTimeout(() => update((s) => {
      const d = currentDecision(s);
      if (!d || s.humans[d.player]) return s;
      return apply(s, botAction(s.game, d));
    }), delay);
    return () => clearTimeout(t);
  }, [session, decision, human, update, apply, moment, anyHuman]);

  // skipping stops at the next person's decision
  useEffect(() => {
    if (human || session.game.phase === "over") skip.current = false;
  }, [human, session.game.phase]);

  return {
    moment,
    ackMoment: () => update((s) => ({ ...s, seenWorld: pendingMoment(s)?.seq ?? s.seenWorld })),
    session,
    decision,
    needsHandoff,
    error,
    submit: (a) => update((s) => apply(s, a)),
    takeDevice: (player) => update((s) => ({ ...s, holder: player, covered: null })),
    uncover: () => update((s) => ({ ...s, covered: null })),
    setSpeed: (speed) => update((s) => ({ ...s, speed })),
    skipAhead: () => {
      skip.current = true;
      update((s) => ({ ...s }));
    },
  };
}

export function clearSaved(): void {
  save(null);
}

export type { CharacterSheet };
