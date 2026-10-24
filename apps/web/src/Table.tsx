import React from "react";
import { Content, FINALE, type GameState, type PlayerState } from "@thaloroot/engine";
import { Meter, RollTray, className, plural, worldName } from "./bits";
import { DecisionPanel, HEADINGS } from "./panels";
import { SPEED_MS, type Controller, type Speed } from "./session";

function World({ game }: { game: GameState }) {
  const left = game.worldDeck.length;
  const beforeFinale = Math.max(0, game.worldDeck.indexOf(FINALE));
  const total = Content.deckCounts[game.config.length].worldCards;
  const active = game.mods.map((m) => m.source).filter((id) => Content.worldCard[id]);
  return (
    <header className="sky">
      <div className="sky-top">
        <span className="wordmark">Thaloroot</span>
        <span>
          {game.phase === "over"
            ? "The Bloom has ended"
            : game.round === 0
              ? "Setting out"
              : game.finalRound
                ? `Round ${game.round}: the final turn`
                : `Round ${game.round}`}
        </span>
        {game.round > 0 && !game.finalRound && game.phase !== "over" && (
          <span className="small quiet">
            {beforeFinale === 0 ? "The Finale is next" : `${plural(beforeFinale, "World card")} before the Finale`}
          </span>
        )}
      </div>
      <div className="vine" role="img" aria-label={`${left} of ${total} World cards left`}>
        {Array.from({ length: total }, (_, i) => {
          const remaining = i >= total - left;
          const fin = i === total - 1;
          return <span key={i} className={`seed ${remaining ? "left" : ""} ${fin && remaining ? "finale" : ""}`} />;
        })}
      </div>
      <div className="effects">
        {game.night && <span className="chip night">Night</span>}
        {active.map((id) => (
          <span key={id} className={`chip ${Content.worldCard[id].category === "escalation" ? "peril" : "any"}`} title={Content.worldCard[id].text}>
            {worldName(id)}
          </span>
        ))}
        {game.monsters.map((m) => (
          <span key={m.id} className="chip peril" title={Content.worldCard[m.id].huntsText}>
            {worldName(m.id)} prowls ({plural(m.roundsLeft, "round")} left)
          </span>
        ))}
        {game.rumors.map((r) => (
          <span key={r.id} className="chip status" title={Content.worldCard[r.id].text}>
            Rumor: {worldName(r.id)}
          </span>
        ))}
        {game.finale && <span className="chip status">Finale: {worldName(game.finale)}</span>}
      </div>
    </header>
  );
}

function Plot({ game, p, active, human }: { game: GameState; p: PlayerState; active: boolean; human: boolean }) {
  const status = [
    p.frog && "Frog",
    p.skipExplore && "Recovering",
    p.untargetable && "Untargetable",
    game.firstFinisher === p.id && "Finished first",
  ].filter(Boolean) as string[];
  return (
    <article className={`plot ${active ? "active" : ""}`} aria-current={active ? "true" : undefined}>
      <div className="spread">
        <span className="plot-name">{p.name}</span>
        <span className="small quiet">{human ? "" : "Computer"}</span>
      </div>
      <span className="small quiet plot-sub">
        {Content.speciesById[p.species].name} {className(p.cls)}
      </span>
      <div className="stat-line">
        <span>Health</span>
        <Meter kind="health" value={p.health} max={p.maxHealth} />
        <span className="num">{p.health}/{p.maxHealth}</span>
      </div>
      <div className="stat-line">
        <span>Stamina</span>
        <Meter kind="stamina" value={p.stamina} max={p.maxStamina} />
        <span className="num">{p.stamina}/{p.maxStamina}</span>
      </div>
      <span className="small num">
        {plural(p.coin, "coin", "coin")}, {plural(p.sparkTokens, "Spark token")}, {plural(p.items.length, "item")}
      </span>
      {p.companions.length > 0 && <span className="small">With {p.companions.map((c) => Content.companion[c.id].name).join(" and ")}</span>}
      {status.length > 0 && (
        <span className="row">
          {status.map((s) => (
            <span key={s} className="chip status">{s}</span>
          ))}
        </span>
      )}
    </article>
  );
}

function Chronicle({ game, viewer }: { game: GameState; viewer: number | null }) {
  const lines = game.log
    .map((e, i) => ({ ...e, i }))
    .filter((e) => !e.private || game.phase === "over" || (viewer !== null && e.private.includes(viewer)))
    .slice(-80)
    .reverse();
  return (
    <aside className="chronicle" aria-labelledby="chron-h">
      <h2 id="chron-h">Chronicle</h2>
      <ol>
        {lines.map((e) => (
          <li key={e.i} className={e.private ? "mine" : ""}>
            <span className="r num">R{e.round} </span>
            {e.text}
          </li>
        ))}
      </ol>
    </aside>
  );
}

const SPEEDS: Speed[] = ["slow", "normal", "fast"];

export function Table({ c, onQuit }: { c: Controller; onQuit: () => void }) {
  const { session, decision } = c;
  const game = session.game;
  const activePlayer = decision?.player ?? game.turn?.player ?? null;
  const human = decision ? session.humans[decision.player] : false;
  const name = decision ? game.players[decision.player].name : "";
  const showRoll = game.lastRoll && game.lastRoll.seq > 0 && decision?.kind !== "push";
  return (
    <main className="page">
      <World game={game} />
      <section className="plots" aria-label="Adventurers">
        {game.players.map((p) => (
          <Plot key={p.id} game={game} p={p} active={p.id === activePlayer} human={session.humans[p.id]} />
        ))}
      </section>
      <div className="ground">
        <section className="chamber" aria-live="polite">
          {showRoll && <RollTray game={game} roll={game.lastRoll!} />}
          {decision && (
            <div className="chamber-head">
              <h2>{HEADINGS[decision.kind](name)}</h2>
              {!human && <p className="who">A computer player is deciding.</p>}
            </div>
          )}
          {decision && human && !c.needsHandoff && <DecisionPanel game={game} d={decision} submit={c.submit} />}
          {c.error && <p className="error" role="alert">That didn't work: {c.error}</p>}
          <div className="spread small">
            <span className="row">
              Computer speed
              {SPEEDS.map((s) => (
                <button key={s} className={session.speed === s ? "pressed" : "ghost"} aria-pressed={session.speed === s} onClick={() => c.setSpeed(s)} title={`${SPEED_MS[s]} ms per move`}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
              {!human && decision && <button onClick={c.skipAhead}>Skip to the next person</button>}
            </span>
            <button className="ghost" onClick={onQuit}>Leave game</button>
          </div>
        </section>
        <Chronicle game={game} viewer={session.holder} />
      </div>
    </main>
  );
}
