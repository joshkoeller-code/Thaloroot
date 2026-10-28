import React, { useEffect, useMemo, useState } from "react";
import { Content, type GameState } from "@thaloroot/engine";
import qrcode from "qrcode-generator";
import { SceneTray, cap } from "./bits";
import { useRoom, useWakeLock, type PublicRoom, type PublicSeat, type RoomLink } from "./net";
import { HEADINGS } from "./panels";
import { Curtain, Scores, WorldMoment } from "./shared";
import { Chronicle, Plot, World } from "./Table";

export function joinUrl(code: string): string {
  const u = new URL(window.location.href);
  u.hash = `#/play/${code}`;
  u.search = "";
  return u.toString();
}

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }, [text]);
  return <div className="qr" role="img" aria-label={`QR code for ${text}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const PERSONAS: PublicSeat["persona"][] = ["friendly", "balanced", "cautious", "aggressive"];
const LENGTHS = [
  { id: "quick", label: "Quick", detail: "about an hour" },
  { id: "standard", label: "Standard", detail: "about 90 minutes" },
  { id: "long", label: "Long", detail: "about 2 hours" },
] as const;

function Status({ link }: { link: RoomLink }) {
  if (link.status === "open") return null;
  return <p className="banner" role="status">{link.status === "connecting" ? "Connecting to the game..." : "Lost the connection. Reconnecting..."}</p>;
}

function SeatLine({ s, i, link, lobby }: { s: PublicSeat; i: number; link: RoomLink; lobby: boolean }) {
  const sp = Content.speciesById[s.species];
  return (
    <li className="seatline">
      <span className={`dot ${s.human ? (s.connected ? "on" : "off") : "bot"}`} aria-hidden="true" />
      <span className="grow">
        <b>{s.name}</b> <span className="small quiet">{sp?.name}{s.returning ? ", returning" : ""}</span>
        <span className="small quiet block">
          {s.human ? (s.connected ? "On their phone" : s.claimed ? "Phone disconnected" : "Seat is free: join with the code") : `Computer, ${s.persona}`}
        </span>
      </span>
      {lobby && !s.human && (
        <select aria-label={`${s.name}'s personality`} value={s.persona} onChange={(e) => link.host({ cmd: "persona", seat: i, persona: e.target.value as PublicSeat["persona"] })}>
          {PERSONAS.map((p) => (
            <option key={p} value={p}>{cap(p)}</option>
          ))}
        </select>
      )}
      {lobby && (
        <button className="ghost small" onClick={() => link.host({ cmd: "removeSeat", seat: i })} aria-label={`Remove ${s.name}`}>
          Remove
        </button>
      )}
      {!lobby && s.human && s.claimed && !s.connected && (
        <button className="ghost small" onClick={() => link.host({ cmd: "release", seat: i })}>Free this seat</button>
      )}
      {!lobby && s.human && (
        <button className="ghost small" onClick={() => link.host({ cmd: "human", seat: i, human: false })}>A computer takes over</button>
      )}
      {!lobby && !s.human && (
        <button className="ghost small" onClick={() => link.host({ cmd: "human", seat: i, human: true })}>A person takes over</button>
      )}
    </li>
  );
}

function Lobby({ link, room }: { link: RoomLink; room: PublicRoom }) {
  const url = joinUrl(room.code);
  const [persona, setPersona] = useState<PublicSeat["persona"]>("balanced");
  const people = room.seats.filter((s) => s.human).length;
  return (
    <main className="page tv">
      <header className="setup-hero">
        <h1>Thaloroot</h1>
        <p className="quiet">Everyone joins on their phone. The TV is the table: everyone sees it, and nobody's secrets show up here.</p>
      </header>
      <div className="lobby">
        <section className="join-card" aria-labelledby="join-h">
          <h2 id="join-h">Join on your phone</h2>
          <Qr text={url} />
          <p className="code" aria-label={`Room code ${room.code.split("").join(" ")}`}>{room.code}</p>
          <p className="small quiet">Scan the code, or open <b>{url.replace(/#.*$/, "")}</b> and enter the room code.</p>
        </section>
        <section className="stack" aria-labelledby="seats-h">
          <h2 id="seats-h">At the table</h2>
          {room.seats.length ? (
            <ul className="seatlist">
              {room.seats.map((s, i) => (
                <SeatLine key={i} s={s} i={i} link={link} lobby />
              ))}
            </ul>
          ) : (
            <p className="quiet">Nobody yet. Scan the code to sit down.</p>
          )}
          <div className="row">
            <select aria-label="Computer personality" value={persona} onChange={(e) => setPersona(e.target.value as PublicSeat["persona"])}>
              {PERSONAS.map((p) => (
                <option key={p} value={p}>{cap(p)}</option>
              ))}
            </select>
            <button onClick={() => link.host({ cmd: "addBot", persona })} disabled={room.seats.length >= 8}>
              Add a computer player
            </button>
          </div>
          <h2 id="length-h">How long is this Bloom?</h2>
          <div className="segmented" role="radiogroup" aria-labelledby="length-h">
            {LENGTHS.map((l) => (
              <button key={l.id} role="radio" aria-checked={room.length === l.id} className={room.length === l.id ? "pressed" : ""} onClick={() => link.host({ cmd: "length", length: l.id })}>
                <b>{l.label}</b> <span className="small quiet">{l.detail}</span>
              </button>
            ))}
          </div>
          <div className="row">
            <button className="primary" disabled={room.seats.length < 2 || people === 0} onClick={() => link.host({ cmd: "start" })}>
              Start the Bloom
            </button>
            {room.seats.length < 2 && <span className="small quiet">At least 2 adventurers, and at least one on a phone.</span>}
          </div>
          {link.error && <p className="error" role="alert">{link.error}</p>}
        </section>
      </div>
    </main>
  );
}

/** Who the table is waiting on, without saying what they're deciding in secret. */
function Waiting({ game, room }: { game: GameState; room: PublicRoom }) {
  const who = new Map<number, string>();
  for (const d of game.pending) if (!who.has(d.player)) who.set(d.player, d.kind);
  if (!who.size) return null;
  return (
    <ul className="waiting" aria-live="polite">
      {[...who].map(([pid, kind]) => {
        const name = game.players[pid].name;
        const seat = room.seats[pid];
        return (
          <li key={pid}>
            {HEADINGS[kind as keyof typeof HEADINGS](name)}
            <span className="small quiet">
              {" "}
              {seat?.human ? (seat.connected ? "on their phone" : "(their phone is disconnected)") : "(computer)"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Board({ link, room, game }: { link: RoomLink; room: PublicRoom; game: GameState }) {
  const scene = [...game.story].reverse().find((b) => b.kind === "scene") as Extract<GameState["story"][number], { kind: "scene" }> | undefined;
  const active = game.turn?.player ?? null;
  const moment = room.moment !== null ? game.story.find((b) => b.seq === room.moment && b.kind === "world") : null;
  // the World card stays up for a while, then the game carries on by itself
  useEffect(() => {
    if (room.moment === null) return;
    const seq = room.moment;
    const t = setTimeout(() => link.host({ cmd: "moment", seq }), 12_000);
    return () => clearTimeout(t);
  }, [room.moment]);
  return (
    <main className="page tv">
      <World game={game} />
      <section className="plots" aria-label="Adventurers">
        {game.players.map((p) => {
          const s = room.seats[p.id];
          return <Plot key={p.id} game={game} p={p} active={p.id === active} human={!!s?.human} who={s?.human ? (s.connected ? "" : "Disconnected") : "Computer"} lessons={false} />;
        })}
      </section>
      <div className="ground">
        <section className="chamber">
          {scene && <SceneTray game={game} beat={scene} roll={game.lastRoll ?? null} />}
          <Waiting game={game} room={room} />
          <details className="small">
            <summary>Seats and speed</summary>
            <ul className="seatlist">
              {room.seats.map((s, i) => (
                <SeatLine key={i} s={s} i={i} link={link} lobby={false} />
              ))}
            </ul>
            <div className="row">
              Computer speed
              {(["slow", "normal", "fast"] as const).map((sp) => (
                <button key={sp} className={room.speed === sp ? "pressed" : "ghost"} aria-pressed={room.speed === sp} onClick={() => link.host({ cmd: "speed", speed: sp })}>
                  {cap(sp)}
                </button>
              ))}
            </div>
          </details>
          {link.error && <p className="error" role="alert">{link.error}</p>}
        </section>
        <Chronicle game={game} viewer={null} />
      </div>
      {moment && moment.kind === "world" && (
        <Curtain>
          <WorldMoment id={moment.card} />
          <button className="primary" onClick={() => link.host({ cmd: "moment", seq: moment.seq })} autoFocus>
            Continue
          </button>
        </Curtain>
      )}
    </main>
  );
}

export function TvScreen({ code, onHome }: { code: string; onHome: () => void }) {
  const link = useRoom(code, "tv");
  const { room, view } = link;
  useWakeLock(room?.phase === "playing");
  if (link.status === "missing")
    return (
      <main className="page">
        <h1>No room called {code}</h1>
        <p className="quiet">It may have closed after a long time without players.</p>
        <button className="primary" onClick={onHome}>Open a new table</button>
      </main>
    );
  if (!room) return <main className="page"><Status link={link} /></main>;
  return (
    <>
      <Status link={link} />
      {room.phase === "lobby" && <Lobby link={link} room={room} />}
      {room.phase === "playing" && view && <Board link={link} room={room} game={view} />}
      {room.phase === "over" && view?.scores && (
        <Scores game={view} onAgain={() => link.host({ cmd: "again" })} onNew={onHome} note={`Room ${room.code}`} />
      )}
    </>
  );
}
