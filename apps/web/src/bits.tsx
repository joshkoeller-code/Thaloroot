import React from "react";
import { Content, type GameState, type LastRoll, type Tag } from "@thaloroot/engine";

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const SKULL_WORD = ["", "One skull", "Two skulls", "Three skulls"];
export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function Skulls({ n }: { n: number }) {
  return (
    <span className="skulls" role="img" aria-label={SKULL_WORD[n]}>
      {Array.from({ length: n }, (_, i) => (
        <svg key={i} width="14" height="15" viewBox="0 0 14 15" aria-hidden="true">
          <path d="M7 1C3.7 1 1.5 3.3 1.5 6.3c0 1.9.9 3.2 2.1 4V13h1.6v-1.4h1v1.4h1.6v-1.4h1V13h1.6v-2.7c1.2-.8 2.1-2.1 2.1-4C12.5 3.3 10.3 1 7 1z" fill="currentColor" />
          <circle cx="4.9" cy="6.6" r="1.3" fill="var(--bark)" />
          <circle cx="9.1" cy="6.6" r="1.3" fill="var(--bark)" />
        </svg>
      ))}
    </span>
  );
}

export function Tags({ tags }: { tags: (Tag | string)[] }) {
  return (
    <span className="row">
      {tags.map((t) => (
        <span key={t} className={`chip ${t}`}>{cap(t)}</span>
      ))}
    </span>
  );
}

export function Meter({ kind, value, max }: { kind: "health" | "stamina"; value: number; max: number }) {
  return (
    <span className={`meter ${kind}`} role="img" aria-label={`${cap(kind)} ${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => <i key={i} className={i < value ? "on" : ""} />)}
    </span>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

export function Die({ value, trouble, delay = 0 }: { value: number; trouble?: boolean; delay?: number }) {
  const cls = trouble ? "trouble" : value >= 5 ? (value === 6 ? "hit spark" : "hit") : value === 1 ? "one" : "";
  const label = `${value}${trouble ? " (Trouble)" : value >= 5 ? ", a success" : value === 1 ? ", a one" : ""}`;
  return (
    <svg className={`die ${cls}`} viewBox="0 0 100 100" role="img" aria-label={label} style={{ animationDelay: `${delay}ms` }}>
      {PIPS[value].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="9" />)}
    </svg>
  );
}

export function DiceRow({ dice, trouble = [], animate = true }: { dice: number[]; trouble?: number[]; animate?: boolean }) {
  return (
    <div className={`dice ${animate ? "tumble" : ""}`}>
      {dice.map((d, i) => <Die key={`d${i}`} value={d} delay={i * 45} />)}
      {trouble.map((d, i) => <Die key={`t${i}`} value={d} trouble delay={(dice.length + i) * 45} />)}
    </div>
  );
}

/**
 * The latest scene: what happened, told as story, with the dice that decided it.
 * This is the one moment the screen gets loud.
 */
export function SceneTray({ game, beat, roll }: { game: GameState; beat: Extract<GameState["story"][number], { kind: "scene" }>; roll: LastRoll | null }) {
  // Mistaken Identity: the table sees another name
  const p = game.players[beat.as ?? beat.player];
  const card = Content.card[beat.card];
  const opt = card.options.find((o) => o.name === beat.option);
  const lines = sceneText(game, beat);
  const rolled = beat.outcome !== "rest" && roll && roll.card === beat.card && roll.option === beat.option && roll.player === beat.player;
  const result = beat.outcome === "rest" ? opt?.text.success : beat.outcome === "success" ? opt?.text.success : opt?.text.fail;
  const notes = rolled ? [roll!.pushed && "pushed their luck", roll!.spark && "Spark", roll!.mishap && "Mishap"].filter(Boolean) : [];
  return (
    <section className="tray" aria-live="polite" aria-label="What just happened">
      <p className="small quiet">
        {p.name} at {card.name}: {beat.option}
      </p>
      <div className="scene" key={beat.seq}>
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      {rolled && (
        <div className="spread">
          <DiceRow key={roll!.seq} dice={roll!.dice} trouble={roll!.trouble} />
          <span className={`verdict ${roll!.ok ? "ok" : ""}`}>
            {roll!.ok ? "Success" : "Not this time"}
            <span className="small quiet num verdict-note">
              {" "}
              {roll!.successes} of {roll!.need} with {cap(roll!.stat)}
              {notes.length ? `, ${notes.join(", ")}` : ""}
            </span>
          </span>
        </div>
      )}
      {result && <p className="small result">{beat.outcome === "fail" ? "Fail: " : ""}{result}</p>}
      {beat.spark && opt?.text.spark && <p className="small result">Spark: {opt.text.spark}</p>}
    </section>
  );
}

export function itemName(id: string): string {
  return Content.item[id]?.name ?? id;
}

export function className(id: string | null): string {
  return id ? Content.cls[id]?.name ?? id : "No class yet";
}

export function worldName(id: string): string {
  return Content.worldCard[id]?.name ?? id;
}

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------

export function fill(text: string | null | undefined, name: string): string {
  return (text ?? "").replaceAll("{name}", name);
}

type Beat = GameState["story"][number];

/** The prose for a scene beat: the outcome line, plus the Spark or Mishap line when they happened. */
export function sceneText(game: GameState, beat: Extract<Beat, { kind: "scene" }>): string[] {
  const name = game.players[beat.as ?? beat.player].name;
  const loc = Content.story.locations[beat.card];
  const t = loc?.options[beat.option];
  if (!t) return [];
  const out: string[] = [];
  if (beat.outcome === "rest") out.push(fill(t.scene, name));
  else out.push(fill(beat.outcome === "success" ? t.success : t.fail, name));
  if (beat.spark && t.spark) out.push(fill(t.spark, name));
  if (beat.mishap && loc.mishap) out.push(fill(loc.mishap, name));
  return out.filter(Boolean);
}

export function missionBeatText(game: GameState, beat: Extract<Beat, { kind: "mission" }>): string {
  const arc = Content.story.missions[beat.mission];
  const name = game.players[beat.player].name;
  if (!arc) return "";
  if (beat.part === "opening") return fill(arc.opening, name);
  if (beat.part === "finale") return fill(arc.finale, name);
  return fill(arc.milestones[beat.part], name);
}

/** A player's mission story so far, in the order it happened. */
export function taleOf(game: GameState, player: number) {
  return game.story.filter((b): b is Extract<Beat, { kind: "mission" }> => b.kind === "mission" && b.player === player);
}
