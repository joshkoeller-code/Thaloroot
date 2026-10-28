import React, { useEffect, useState } from "react";
import { createGame, exportCharacter } from "@thaloroot/engine";
import { Curtain, Scores, WorldMoment } from "./shared";
import { Setup } from "./Setup";
import { Table } from "./Table";
import { openRoom, serverAvailable } from "./net";
import { PhoneScreen } from "./Phone";
import { TvScreen } from "./Tv";
import { clearSaved, loadSaved, useSession, type Controller, type Session } from "./session";

function Game({ initial, onExit, onAgain }: { initial: Session; onExit: () => void; onAgain: (s: Session) => void }) {
  const c: Controller = useSession(initial);
  const { session, decision } = c;
  const game = session.game;
  if (game.phase === "over" && game.scores) {
    return <Scores game={game} onAgain={() => onAgain(session)} onNew={onExit} />;
  }
  return (
    <>
      <Table c={c} onQuit={onExit} />
      {c.moment && c.moment.kind === "world" && (
        <Curtain>
          <WorldMoment id={c.moment.card} />
          <button className="primary" onClick={c.ackMoment} autoFocus>
            Continue
          </button>
        </Curtain>
      )}
      {!c.moment && session.covered && (
        <Curtain>
          <h1>{session.covered.name} has chosen</h1>
          <p className="quiet">Turn the screen back to the table before continuing.</p>
          <button className="primary" onClick={c.uncover}>Continue</button>
        </Curtain>
      )}
      {!c.moment && !session.covered && c.needsHandoff && decision && (
        <Curtain>
          <h1>Pass to {game.players[decision.player].name}</h1>
          <p className="quiet">This choice is secret. Everyone else, look away.</p>
          <button className="primary" onClick={() => c.takeDevice(decision.player)}>
            I'm {game.players[decision.player].name}, show me
          </button>
        </Curtain>
      )}
    </>
  );
}

function PassAndPlay() {
  const [saved] = useState(() => loadSaved());
  const [session, setSession] = useState<Session | null>(null);
  const [key, setKey] = useState(0);
  const start = (s: Session) => {
    setSession(s);
    setKey((k) => k + 1);
  };
  if (!session) return <Setup saved={saved} onResume={() => saved && start(saved)} onStart={start} />;
  return (
    <Game
      key={key}
      initial={session}
      onExit={() => {
        setSession(null);
      }}
      onAgain={(s) => {
        clearSaved();
        // returning characters keep their growth, leftover Lessons, and quirks
        const game = createGame({
          seed: Math.floor(Math.random() * 2 ** 31),
          length: s.game.config.length,
          players: s.game.players.map((p) => ({ ...exportCharacter(s.game, p.id), bot: p.bot ?? "balanced" })),
        });
        start({ ...s, game, holder: null, covered: null, started: Date.now() });
      }}
    />
  );
}

type Route = { kind: "home" } | { kind: "local" } | { kind: "tv"; code: string } | { kind: "play"; code: string };

function parse(hash: string): Route {
  const m = hash.match(/^#\/(tv|play)\/([A-Za-z]{4})$/);
  if (m) return { kind: m[1] as "tv" | "play", code: m[2].toUpperCase() };
  if (hash === "#/local") return { kind: "local" };
  return { kind: "home" };
}

function useRoute(): [Route, (hash: string) => void] {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, (hash) => (window.location.hash = hash)];
}

/** Choose how to play: a TV with phones (when a game server is behind this page), or one shared device. */
function Home({ go }: { go: (hash: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = async () => {
    setBusy(true);
    setError(null);
    try {
      go(`#/tv/${await openRoom()}`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  };
  const ok = /^[A-Za-z]{4}$/.test(code.trim());
  return (
    <main className="page home">
      <header className="setup-hero">
        <h1>Thaloroot</h1>
        <p className="quiet">The thal is surging and the Bloom has begun.</p>
      </header>
      <div className="choices">
        <section className="choice-card stack">
          <h2>Join a game</h2>
          <p className="small quiet">On your phone: enter the code shown on the TV.</p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (ok) go(`#/play/${code.trim().toUpperCase()}`);
            }}
          >
            <input id="room-code" className="code-input" aria-label="Room code" autoCapitalize="characters" autoComplete="off" maxLength={4} placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button className="primary" disabled={!ok}>Join</button>
          </form>
        </section>
        <section className="choice-card stack">
          <h2>Host on this screen</h2>
          <p className="small quiet">Put this on the TV. Everyone joins on their phone, and the TV becomes the table.</p>
          <button className="primary" disabled={busy} onClick={host}>{busy ? "Opening a room..." : "Open a table"}</button>
        </section>
        <section className="choice-card stack">
          <h2>Play on one device</h2>
          <p className="small quiet">Everyone shares this screen and passes it for secret choices.</p>
          <button onClick={() => go("#/local")}>Pass and play</button>
        </section>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}

export function App() {
  const [route, go] = useRoute();
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    serverAvailable().then(setOnline);
  }, []);
  if (route.kind === "tv") return <TvScreen key={route.code} code={route.code} onHome={() => go("#/")} />;
  if (route.kind === "play") return <PhoneScreen key={route.code} code={route.code} onHome={() => go("#/")} />;
  if (route.kind === "local" || online === false) return <PassAndPlay />;
  if (online === null) return <main className="page" aria-busy="true" />;
  return <Home go={go} />;
}
