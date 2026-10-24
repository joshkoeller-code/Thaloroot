/**
 * What one seat (or the shared TV) is allowed to see. The server keeps the full
 * GameState; clients only ever receive a view.
 */
import type { GameState, PlayerState } from "./types.js";

export type Viewer = number | "tv";

export function viewFor(state: GameState, viewer: Viewer): GameState {
  const v = structuredClone(state);
  const over = state.phase === "over";
  const me = (p: PlayerState) => viewer !== "tv" && p.id === viewer;
  v.rng = 0;
  delete v.scriptedDice;
  // deck order and other players' hands are secret
  v.exploreDeck = v.exploreDeck.map(() => ({ uid: 0, card: "" }));
  v.worldDeck = v.worldDeck.map((id, i) => {
    const seen = viewer !== "tv" && i < state.players[viewer].seenWorld;
    return id === "FINALE" || seen ? id : "";
  });
  for (const [pid, hand] of Object.entries(v.hands)) {
    if (viewer === "tv" || Number(pid) !== viewer) v.hands[Number(pid)] = hand.map(() => ({ uid: 0, card: "" }));
  }
  // picks are secret until everyone has picked
  if (state.phase === "pick") {
    for (const pid of Object.keys(v.picks)) if (viewer === "tv" || Number(pid) !== viewer) v.picks[Number(pid)] = null;
  }
  v.pending = v.pending.map((d) => (viewer !== "tv" && d.player === viewer ? d : { player: d.player, kind: d.kind, data: {} }));
  v.traps = v.traps.filter((t) => viewer !== "tv" && t.owner === viewer);
  v.missionOptions = viewer === "tv" ? {} : { [viewer]: v.missionOptions[viewer] };
  v.log = v.log.filter((e) => !e.private || over || (viewer !== "tv" && e.private.includes(viewer)));
  for (const p of v.players) {
    if (over || me(p)) continue;
    p.mission = null;
    p.claimed = [];
    p.finaleDone = false;
    p.history = [];
    p.intel = {};
    p.knownMissions = {};
    p.guesses = null;
    for (const it of p.items) if (it.fragment) it.fragment = "hidden";
    p.lessons = { brawn: 0, wits: 0, charm: 0, spark: 0, luck: 0 };
    p.log = {};
  }
  return v;
}
