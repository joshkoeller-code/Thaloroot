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
    if (s.humans[a.player] && PRIVATE.includes(a.kind as Decision["kind"])) {
      const next = currentDecision({ ...s, game, holder: a.player });
      const sameSecret = next && next.player === a.player && isPrivate(next) && s.humans[next.player];
      if (!sameSecret) {
        holder = null;
        covered = { name: s.game.players[a.player].name };
      }
    }
    return { ...s, game, holder, covered };
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

  // computer players
  useEffect(() => {
    if (!decision || human || session.game.phase === "over") return;
    const delay = skip.current ? 0 : SPEED_MS[session.speed];
    const t = setTimeout(() => update((s) => {
      const d = currentDecision(s);
      if (!d || s.humans[d.player]) return s;
      return apply(s, botAction(s.game, d));
    }), delay);
    return () => clearTimeout(t);
  }, [session, decision, human, update, apply]);

  // skipping stops at the next person's decision
  useEffect(() => {
    if (human || session.game.phase === "over") skip.current = false;
  }, [human, session.game.phase]);

  return {
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
