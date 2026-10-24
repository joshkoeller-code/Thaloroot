import React, { useState } from "react";
import { Content, STATS, createGame, type BotPersona, type GameLength, type Stat } from "@thaloroot/engine";
import { cap } from "./bits";
import type { Session } from "./session";

interface SeatDraft {
  name: string;
  species: string;
  stats: Record<Stat, number>;
  human: boolean;
  persona: BotPersona;
}

const POINTS = Content.rules.character.creationPoints;
const MAX_START = Content.rules.character.creationMax;

const EXAMPLES: SeatDraft[] = [
  { name: "Mara", species: "mossfolk", stats: { brawn: 2, wits: 2, charm: 4, spark: 1, luck: 3 }, human: true, persona: "friendly" },
  { name: "Tobias", species: "foxfolk", stats: { brawn: 1, wits: 4, charm: 2, spark: 2, luck: 3 }, human: true, persona: "aggressive" },
  { name: "Wren", species: "owlkin", stats: { brawn: 2, wits: 3, charm: 2, spark: 3, luck: 2 }, human: false, persona: "cautious" },
  { name: "Bram", species: "stonebacks", stats: { brawn: 4, wits: 2, charm: 2, spark: 2, luck: 2 }, human: false, persona: "aggressive" },
];
const MORE_NAMES = ["Isolde", "Fennick", "Juniper", "Oswin"];

const spent = (s: Record<Stat, number>) => STATS.reduce((t, k) => t + s[k] - 1, 0);

const LENGTHS: { id: GameLength; label: string; detail: string }[] = [
  { id: "quick", label: "Quick", detail: "15 World cards, about an hour" },
  { id: "standard", label: "Standard", detail: "20 World cards, about 90 minutes" },
  { id: "long", label: "Long", detail: "25 World cards, about 2 hours" },
];

export function Setup({ onStart, saved, onResume }: { onStart: (s: Session) => void; saved: Session | null; onResume: () => void }) {
  const [seats, setSeats] = useState<SeatDraft[]>(EXAMPLES.map((s) => ({ ...s, stats: { ...s.stats } })));
  const [length, setLength] = useState<GameLength>("quick");
  const [error, setError] = useState<string | null>(null);

  const edit = (i: number, patch: Partial<SeatDraft>) => setSeats((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const bump = (i: number, stat: Stat, d: number) => {
    const s = seats[i];
    const v = s.stats[stat] + d;
    if (v < 1 || v > MAX_START) return;
    if (d > 0 && spent(s.stats) >= POINTS) return;
    edit(i, { stats: { ...s.stats, [stat]: v } });
  };
  const randomize = (i: number) => {
    const stats = { brawn: 1, wits: 1, charm: 1, spark: 1, luck: 1 } as Record<Stat, number>;
    let left = POINTS;
    while (left > 0) {
      const k = STATS[Math.floor(Math.random() * 5)];
      if (stats[k] < MAX_START) {
        stats[k]++;
        left--;
      }
    }
    edit(i, { stats });
  };
  const add = () =>
    setSeats((xs) => [
      ...xs,
      { name: MORE_NAMES[xs.length - 4] ?? `Player ${xs.length + 1}`, species: Content.species[xs.length % 20].id, stats: { brawn: 3, wits: 2, charm: 2, spark: 2, luck: 3 }, human: false, persona: "balanced" },
    ]);

  const start = (watch = false) => {
    const bad = seats.find((s) => spent(s.stats) !== POINTS);
    if (bad) return setError(`${bad.name} has ${POINTS - spent(bad.stats)} points left to spend.`);
    if (seats.some((s) => !s.name.trim())) return setError("Every adventurer needs a name.");
    try {
      const game = createGame({
        seed: Math.floor(Math.random() * 2 ** 31),
        length,
        players: seats.map((s) => ({ name: s.name.trim(), species: s.species, stats: s.stats, bot: s.persona, isNew: true })),
      });
      onStart({ game, humans: seats.map((s) => !watch && s.human), speed: watch ? "fast" : "normal", holder: null, covered: null, started: Date.now() });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const humans = seats.filter((s) => s.human).length;

  return (
    <main className="page">
      <header className="setup-hero">
        <h1>Thaloroot</h1>
        <p className="quiet" style={{ maxWidth: "38rem" }}>
          The thal is surging and the Bloom has begun. Everyone plays at one screen and passes it for secret choices. Seats you mark as computer players take their own turns.
        </p>
        {saved && saved.game.phase !== "over" && (
          <div className="row">
            <button className="primary" onClick={onResume}>
              Resume the game in round {saved.game.round}
            </button>
            <span className="small quiet">{saved.game.players.map((p) => p.name).join(", ")}</span>
          </div>
        )}
      </header>

      <section className="stack" aria-labelledby="length-h">
        <h2 id="length-h">How long is this Bloom?</h2>
        <div className="segmented" role="radiogroup" aria-labelledby="length-h">
          {LENGTHS.map((l) => (
            <button key={l.id} role="radio" aria-checked={length === l.id} className={length === l.id ? "pressed" : ""} onClick={() => setLength(l.id)}>
              <b>{l.label}</b> <span className="small quiet">{l.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="stack" aria-labelledby="seats-h">
        <div className="spread">
          <h2 id="seats-h">Adventurers</h2>
          <span className="small quiet">2 to 8 players. Start every stat at 1 and spend {POINTS} points, none above {MAX_START}.</span>
        </div>
        <div className="seats">
          {seats.map((s, i) => {
            const left = POINTS - spent(s.stats);
            const sp = Content.speciesById[s.species];
            return (
              <div className="seat" key={i}>
                <div className="seat-top">
                  <input id={`name-${i}`} type="text" aria-label="Name" value={s.name} onChange={(e) => edit(i, { name: e.target.value })} />
                  <select id={`species-${i}`} aria-label="Species" value={s.species} onChange={(e) => edit(i, { species: e.target.value })}>
                    {Content.species.map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </select>
                  <select id={`who-${i}`} aria-label="Who plays this seat" value={s.human ? "human" : s.persona} onChange={(e) => (e.target.value === "human" ? edit(i, { human: true }) : edit(i, { human: false, persona: e.target.value as BotPersona }))}>
                    <option value="human">A person</option>
                    <option value="friendly">Computer, friendly</option>
                    <option value="balanced">Computer, balanced</option>
                    <option value="cautious">Computer, cautious</option>
                    <option value="aggressive">Computer, aggressive</option>
                  </select>
                  <button className="ghost" disabled={seats.length <= 2} onClick={() => setSeats((xs) => xs.filter((_, j) => j !== i))} aria-label={`Remove ${s.name}`}>
                    Remove
                  </button>
                </div>
                <p className="small quiet">{sp.name}: {sp.trait.charAt(0).toLowerCase() + sp.trait.slice(1)}. Rivals won't know this until it matters.</p>
                <div className="stats">
                  {STATS.map((k) => (
                    <div className="stepper" key={k}>
                      <span className="small">{cap(k)}</span>
                      <span className="v num">{s.stats[k]}</span>
                      <span className="btns">
                        <button aria-label={`Lower ${k}`} disabled={s.stats[k] <= 1} onClick={() => bump(i, k, -1)}>−</button>
                        <button aria-label={`Raise ${k}`} disabled={s.stats[k] >= MAX_START || left <= 0} onClick={() => bump(i, k, 1)}>+</button>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="spread">
                  <span className={`small ${left ? "" : "quiet"}`}>{left ? `${left} point${left === 1 ? "" : "s"} left` : "All points spent"}</span>
                  <button className="ghost small" onClick={() => randomize(i)}>Shuffle stats</button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="row">
          <button onClick={add} disabled={seats.length >= 8}>Add an adventurer</button>
        </div>
      </section>

      <section className="row">
        <button className="primary" onClick={() => start(false)} disabled={humans === 0}>Start the Bloom</button>
        <button onClick={() => start(true)}>Watch computer players</button>
        {error && <p className="error" role="alert">{error}</p>}
        {humans === 0 && !error && <p className="small quiet">Mark at least one seat as a person to play, or watch the computer players.</p>}
      </section>
    </main>
  );
}
