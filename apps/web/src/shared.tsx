import React from "react";
import { Content, type GameState } from "@thaloroot/engine";
import { className, missionBeatText, taleOf } from "./bits";

export function Curtain({ children }: { children: React.ReactNode }) {
  return (
    <div className="curtain" role="dialog" aria-modal="true">
      <div className="curtain-inner">{children}</div>
    </div>
  );
}

const KIND: Record<string, string> = {
  weather: "The weather turns",
  monster: "A monster appears",
  merchant: "A merchant arrives",
  rumor: "A rumor spreads",
  chaos: "Chaos in Thaloroot",
  escalation: "The Bloom grows stronger",
  finale: "The Finale",
};

export function WorldMoment({ id }: { id: string }) {
  const def = Content.worldCard[id];
  return (
    <>
      <p className="moment-kind">{KIND[def.category] ?? "The World turns"}</p>
      <h1>{def.name}</h1>
      <p className="moment-text">{Content.story.world[id]}</p>
      <div className="moment-effect stack">
        {def.flavor && <p className="small quiet"><i>{def.flavor}</i></p>}
        {def.text && <p className="small">{def.text}</p>}
        {def.category === "monster" && (
          <p className="small">
            Hunts {def.huntsText.charAt(0).toLowerCase() + def.huntsText.slice(1)}. {def.optionsText}. Defeat it for {def.rewardText}.
          </p>
        )}
      </div>
    </>
  );
}

export function Scores({ game, onAgain, onNew, note }: { game: GameState; onAgain?: () => void; onNew?: () => void; note?: string }) {
  const lines = [...game.scores!].sort((a, b) => b.total - a.total || b.coin - a.coin);
  const winners = game.winner!.map((w) => game.players[w].name);
  return (
    <main className="page">
      <header className="setup-hero">
        <h1>{winners.join(" and ")} {winners.length > 1 ? "share" : "wins"} the Bloom</h1>
        <p className="quiet">Every mission is revealed. Here is how the points came together.</p>
      </header>
      <div className="table-wrap">
        <table className="scores">
          <thead>
            <tr>
              <th scope="col">Adventurer</th>
              <th scope="col" className="text">Mission</th>
              <th scope="col">Milestones</th>
              <th scope="col">Mission VP</th>
              <th scope="col">Treasure</th>
              <th scope="col">Guesses</th>
              <th scope="col">Other</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.player} className={game.winner!.includes(l.player) ? "winner" : ""}>
                <td>
                  {l.name}
                  <div className="small quiet">{className(l.cls)}</div>
                </td>
                <td className="text">
                  {l.mission ? Content.mission[l.mission].name : ""}
                  <div className="small quiet">
                    {[l.finale && "finale done", l.flourish && "flourish", l.first && "finished first"].filter(Boolean).join(", ") || "finale not reached"}
                  </div>
                </td>
                <td>{l.milestones}/3</td>
                <td>{l.missionVp}</td>
                <td>{l.treasureVp}</td>
                <td>{l.guessVp}</td>
                <td>{l.fragmentVp + l.bonusVp}</td>
                <td>{l.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small quiet">Ties go to the player with the most coin.</p>
      <section className="stack" aria-labelledby="tales-h">
        <h2 id="tales-h">Tales of the Bloom</h2>
        <div className="tales">
          {lines.map((l) => {
            const tale = taleOf(game, l.player);
            const name = game.players[l.player].name;
            const p = game.players[l.player];
            return (
              <article className="tale" key={l.player}>
                <h3>{name} and {l.mission ? Content.mission[l.mission].name : "no mission"}</h3>
                {tale.map((b) => (
                  <p key={b.seq}>{missionBeatText(game, b)}</p>
                ))}
                {!p.finaleDone && <p className="quiet">The Bloom faded before {name} could finish the quest. There is always another Bloom.</p>}
              </article>
            );
          })}
        </div>
      </section>
      <div className="row">
        {onAgain && <button className="primary" onClick={onAgain}>Play again with the same adventurers</button>}
        {onNew && <button onClick={onNew}>Back to setup</button>}
        {note && <p className="small quiet">{note}</p>}
      </div>
    </main>
  );
}

