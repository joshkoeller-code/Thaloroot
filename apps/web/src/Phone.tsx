import React, { useEffect, useState } from "react";
import { Content, STATS, type Action, type CharacterSheet, type GameState, type Stat } from "@thaloroot/engine";
import { SceneTray, cap, plural } from "./bits";
import { saveCharacter, savedCharacter, useRoom, useWakeLock, type PublicRoom, type RoomLink } from "./net";
import { DecisionPanel, HEADINGS, MissionSheet } from "./panels";
import { Scores } from "./shared";
import { Chronicle, Plot } from "./Table";

const POINTS = Content.rules.character.creationPoints;
const MAX_START = Content.rules.character.creationMax;
const spent = (s: Record<Stat, number>) => STATS.reduce((t, k) => t + s[k] - 1, 0);

function Status({ link }: { link: RoomLink }) {
  if (link.status === "open") return null;
  return <p className="banner" role="status">{link.status === "connecting" ? "Connecting..." : "Lost the connection. Reconnecting..."}</p>;
}

/** Make (or tweak) your adventurer, on your own phone. */
function CharacterEditor({ value, onChange, locked, saveNameOnBlur }: { value: { name: string; species: string; stats: Record<Stat, number> }; onChange: (v: { name?: string; species?: string; stats?: Record<Stat, number> }) => void; locked?: boolean; saveNameOnBlur?: boolean }) {
  const [name, setName] = useState(value.name);
  useEffect(() => setName(value.name), [value.name]);
  const left = POINTS - spent(value.stats);
  const bump = (k: Stat, d: number) => {
    const v = value.stats[k] + d;
    if (v < 1 || v > MAX_START || (d > 0 && left <= 0)) return;
    onChange({ stats: { ...value.stats, [k]: v } });
  };
  const shuffle = () => {
    const stats = { brawn: 1, wits: 1, charm: 1, spark: 1, luck: 1 } as Record<Stat, number>;
    let n = POINTS;
    while (n > 0) {
      const k = STATS[Math.floor(Math.random() * 5)];
      if (stats[k] < MAX_START) {
        stats[k]++;
        n--;
      }
    }
    onChange({ stats });
  };
  const sp = Content.speciesById[value.species];
  return (
    <div className="seat">
      <div className="seat-top">
        <input id="my-name" type="text" aria-label="Your adventurer's name" value={name} disabled={locked} maxLength={24} onChange={(e) => {
            setName(e.target.value);
            if (!saveNameOnBlur) onChange({ name: e.target.value });
          }} onBlur={() => saveNameOnBlur && name.trim() && name.trim() !== value.name && onChange({ name: name.trim() })} />
        <select id="my-species" aria-label="Species" value={value.species} disabled={locked} onChange={(e) => onChange({ species: e.target.value })}>
          {Content.species.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
      </div>
      {sp && <p className="small quiet">{sp.name}: {sp.trait.charAt(0).toLowerCase() + sp.trait.slice(1)}. Rivals won't know this until it matters.</p>}
      <div className="stats">
        {STATS.map((k) => (
          <div className="stepper" key={k}>
            <span className="small">{cap(k)}</span>
            <span className="v num">{value.stats[k]}</span>
            {!locked && (
              <span className="btns">
                <button aria-label={`Lower ${k}`} disabled={value.stats[k] <= 1} onClick={() => bump(k, -1)}>−</button>
                <button aria-label={`Raise ${k}`} disabled={value.stats[k] >= MAX_START || left <= 0} onClick={() => bump(k, 1)}>+</button>
              </span>
            )}
          </div>
        ))}
      </div>
      {!locked && (
        <div className="spread">
          <span className={`small ${left ? "" : "quiet"}`}>{left ? `${plural(left, "point")} left to spend` : "All points spent"}</span>
          <button className="ghost small" onClick={shuffle}>Shuffle stats</button>
        </div>
      )}
    </div>
  );
}

const NEW_CHAR = () => ({ name: "", species: Content.species[Math.floor(Math.random() * Content.species.length)].id, stats: { brawn: 3, wits: 2, charm: 2, spark: 2, luck: 3 } as Record<Stat, number> });

function JoinForm({ link, room }: { link: RoomLink; room: PublicRoom }) {
  const saved = savedCharacter();
  const [returning, setReturning] = useState(!!saved);
  const [draft, setDraft] = useState(NEW_CHAR);
  if (room.phase !== "lobby") {
    const free = room.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.human && !s.claimed);
    return (
      <main className="page phone">
        <h1>Room {room.code}</h1>
        {free.length ? (
          <>
            <p>The game has started. These seats are free; take one if it's yours:</p>
            <div className="choices">
              {free.map(({ s, i }) => (
                <button key={i} className="choice" onClick={() => link.join(undefined, i)}>
                  <h3>I'm {s.name}</h3>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="quiet">This game has already started. If you were playing, ask whoever is at the TV to free your seat (Seats and speed, then Free this seat).</p>
        )}
        {link.error && <p className="error" role="alert">{link.error}</p>}
      </main>
    );
  }
  const ok = draft.name.trim() && spent(draft.stats) === POINTS;
  return (
    <main className="page phone">
      <h1>Join room {room.code}</h1>
      {saved && returning ? (
        <section className="stack">
          <p>Welcome back. Your adventurer keeps everything they've earned.</p>
          <CharacterEditor value={{ name: saved.name ?? "", species: saved.species ?? "humans", stats: saved.stats as Record<Stat, number> }} onChange={() => {}} locked />
          <div className="row">
            <button className="primary" onClick={() => link.join(saved)}>Join as {saved.name}</button>
            <button className="ghost" onClick={() => setReturning(false)}>Make someone new</button>
          </div>
        </section>
      ) : (
        <section className="stack">
          <p className="small quiet">Every stat starts at 1. Spend {POINTS} more points, none above {MAX_START}.</p>
          <CharacterEditor value={draft} onChange={(p) => setDraft({ ...draft, ...p })} />
          <div className="row">
            <button className="primary" disabled={!ok} onClick={() => link.join({ name: draft.name.trim(), species: draft.species, stats: draft.stats, isNew: true })}>
              Sit down at the table
            </button>
            {!draft.name.trim() && <span className="small quiet">Give your adventurer a name.</span>}
            {saved && <button className="ghost" onClick={() => setReturning(true)}>Bring back {saved.name}</button>}
          </div>
        </section>
      )}
      {link.error && <p className="error" role="alert">{link.error}</p>}
    </main>
  );
}

function Seated({ link, room, seat }: { link: RoomLink; room: PublicRoom; seat: number }) {
  const s = room.seats[seat];
  return (
    <main className="page phone">
      <h1>You're at the table</h1>
      <p className="quiet">Room {room.code}. The game starts from the TV when everyone is ready.</p>
      <CharacterEditor value={s} onChange={(p) => link.edit(p)} locked={s.returning} saveNameOnBlur />
      <p className="small quiet">
        {room.seats.length} at the table: {room.seats.map((x) => x.name).join(", ")}.
      </p>
      <div className="row">
        <button className="ghost" onClick={() => link.leave()}>Leave the table</button>
      </div>
      {link.error && <p className="error" role="alert">{link.error}</p>}
    </main>
  );
}

/** The last of my own story beats I've read, remembered per room. */
function useSeen(code: string, seat: number): [number, (n: number) => void] {
  const key = `thaloroot.seen.${code}.${seat}`;
  const [n, setN] = useState(() => {
    try {
      return Number(localStorage.getItem(key) ?? 0);
    } catch {
      return 0;
    }
  });
  return [
    n,
    (v: number) => {
      setN(v);
      try {
        localStorage.setItem(key, String(v));
      } catch {
        /* fine */
      }
    },
  ];
}

function Playing({ link, room, game, seat }: { link: RoomLink; room: PublicRoom; game: GameState; seat: number }) {
  const me = game.players[seat];
  const d = game.pending.find((x) => x.player === seat && Object.keys(x.data).length > 0) ?? game.pending.find((x) => x.player === seat);
  const [seen, setSeen] = useSeen(room.code, seat);
  const latest = game.story.filter((b) => b.kind === "mission" && b.player === seat).at(-1)?.seq ?? 0;
  const submit = (a: Action) => {
    link.act(a);
    setSeen(latest);
  };
  const scene = [...game.story].reverse().find((b) => b.kind === "scene") as Extract<GameState["story"][number], { kind: "scene" }> | undefined;
  const waitingOn = [...new Set(game.pending.map((x) => x.player))].filter((p) => p !== seat).map((p) => game.players[p].name);
  // a quick buzz when it's your turn to choose
  useEffect(() => {
    if (d) navigator.vibrate?.(60);
  }, [d?.kind, game.round]);
  return (
    <main className="page phone">
      <Plot game={game} p={me} active={!!d} human />
      {d ? (
        <section className="chamber" aria-live="polite">
          {scene && d.kind !== "push" && <SceneTray game={game} beat={scene} roll={game.lastRoll ?? null} />}
          <div className="chamber-head">
            <h2>{HEADINGS[d.kind](me.name)}</h2>
          </div>
          <DecisionPanel game={game} d={d} submit={submit} seen={seen} />
          {link.error && <p className="error" role="alert">That didn't work: {link.error}</p>}
        </section>
      ) : (
        <section className="chamber" aria-live="polite">
          <p className="watch">Watch the TV.</p>
          <p className="small quiet">{waitingOn.length ? `Waiting on ${waitingOn.join(", ")}.` : "The game is moving along."}</p>
          {scene && <SceneTray game={game} beat={scene} roll={game.lastRoll ?? null} />}
          <details className="table-peek" open={latest > seen}>
            <summary>{latest > seen ? "Your tale has something new" : "Your mission"}</summary>
            <MissionSheet game={game} p={me} seen={seen} />
          </details>
          {latest > seen && (
            <button className="ghost small" onClick={() => setSeen(latest)}>Mark my tale as read</button>
          )}
        </section>
      )}
      <details className="table-peek">
        <summary>The rest of the table</summary>
        <section className="plots">
          {game.players
            .filter((p) => p.id !== seat)
            .map((p) => (
              <Plot key={p.id} game={game} p={p} active={game.turn?.player === p.id} human={!!room.seats[p.id]?.human} lessons={false} />
            ))}
        </section>
      </details>
      <details className="table-peek">
        <summary>Chronicle</summary>
        <Chronicle game={game} viewer={seat} />
      </details>
    </main>
  );
}

/** What this phone remembers to bring into the next game. */
function sheetFrom(game: GameState, seat: number): Partial<CharacterSheet> {
  const p = game.players[seat];
  return {
    name: p.name,
    species: p.species,
    stats: { ...p.baseStats },
    lessons: { ...p.lessons },
    quirks: p.quirks.map((q) => ({ ...q })),
    heirlooms: p.items.filter((i) => i.carriedOver).map((i) => (i.forged ? `${i.id}:${i.forged}` : i.id)),
    isNew: false,
  };
}

export function PhoneScreen({ code, onHome }: { code: string; onHome: () => void }) {
  const link = useRoom(code, "player");
  const { room, view, you } = link;
  useWakeLock(room?.phase === "playing");
  const seat = you?.seat ?? null;
  // remember this adventurer for next time
  useEffect(() => {
    if (room?.phase === "over" && view && seat !== null && view.players[seat]) saveCharacter(sheetFrom(view, seat));
  }, [room?.phase, view, seat]);
  if (link.status === "missing")
    return (
      <main className="page phone">
        <h1>No room called {code}</h1>
        <p className="quiet">Check the code on the TV and try again.</p>
        <button className="primary" onClick={onHome}>Enter a different code</button>
      </main>
    );
  if (!room || !you) return <main className="page phone"><Status link={link} /></main>;
  return (
    <>
      <Status link={link} />
      {seat === null && <JoinForm link={link} room={room} />}
      {seat !== null && room.phase === "lobby" && <Seated link={link} room={room} seat={seat} />}
      {seat !== null && room.phase === "playing" && view && <Playing link={link} room={room} game={view} seat={seat} />}
      {seat !== null && room.phase === "over" && view?.scores && (
        <Scores game={view} note="Your adventurer is saved on this phone for the next game. The TV can start another round with everyone." />
      )}
    </>
  );
}
