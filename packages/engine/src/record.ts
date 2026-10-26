import { Content } from "./content.js";
import type { GameState, Tag } from "./types.js";

/** What the table saw a player do: the things a person sitting there would remember. */
export interface PublicRecord {
  /** Locations visited (a roll or a rest), counted by tag. */
  explored: Partial<Record<Tag, number>>;
  /** Successful rolls, counted by tag. */
  succeeded: Partial<Record<Tag, number>>;
  rests: number;
  meetings: { ally: number; brawl: number; pass: number };
  brawlsWon: number;
  befriended: string[];
  frogs: number;
  pushes: number;
  bought: number;
}

/** Event types everyone at the table can see happen. */
const PUBLIC = new Set(["success", "rest", "meetingChoice", "winBrawl", "befriend", "frog", "push", "buy", "roll"]);

export function publicRecord(state: GameState, player: number): PublicRecord {
  const p = state.players[player];
  const r: PublicRecord = {
    explored: {},
    succeeded: {},
    rests: 0,
    meetings: { ally: 0, brawl: 0, pass: 0 },
    brawlsWon: 0,
    befriended: [],
    frogs: 0,
    pushes: 0,
    bought: 0,
  };
  for (const e of p.history) {
    if (!PUBLIC.has(e.type)) continue;
    if ((e.type === "roll" || e.type === "rest") && e.location && Content.card[e.location]) {
      for (const t of Content.card[e.location].tags) r.explored[t] = (r.explored[t] ?? 0) + 1;
    }
    if (e.type === "success") for (const t of e.tags ?? []) r.succeeded[t] = (r.succeeded[t] ?? 0) + 1;
    if (e.type === "rest") r.rests++;
    if (e.type === "meetingChoice" && (e.choice === "ally" || e.choice === "brawl" || e.choice === "pass")) r.meetings[e.choice as "ally" | "brawl" | "pass"]++;
    if (e.type === "winBrawl") r.brawlsWon++;
    if (e.type === "befriend" && e.companion) r.befriended.push(e.companion);
    if (e.type === "frog") r.frogs++;
    if (e.type === "push") r.pushes++;
    if (e.type === "buy") r.bought++;
  }
  return r;
}
