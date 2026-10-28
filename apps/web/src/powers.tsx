import React, { useEffect, useState } from "react";
import {
  Content,
  itemLabel,
  powersOf,
  signatureUsed,
  type AvailablePower,
  type GameState,
  type PlayerState,
  type PowerUse,
  type Stat,
  STATS,
} from "@thaloroot/engine";
import { SKULL_WORD, cap, plural } from "./bits";
import type { PanelProps } from "./panels";

const SLOT: Record<string, string> = { active: "Active", signature: "Signature, once per game", service: "Service", passive: "Passive" };

export function costText(c: AvailablePower["cost"]): string {
  const parts = [
    c.stamina ? `${c.stamina} stamina` : "",
    c.dream ? plural(c.dream, "Dream token") : "",
    c.coin ? `${c.coin} coin` : "",
    c.ingredients ? plural(c.ingredients, "ingredient") : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" + ") : "free";
}

function LocationSelect({ value, onChange, only, id }: { value: string; onChange: (v: string) => void; only?: string[]; id: string }) {
  const cards = Content.cards.filter((c) => !only || only.includes(c.id));
  return (
    <select id={id} aria-label="Location" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a location</option>
      {(["forest", "meadow", "swamp", "mountain", "ruins"] as const).map((r) => {
        const here = cards.filter((c) => c.region === r);
        if (!here.length) return null;
        return (
          <optgroup key={r} label={cap(r)}>
            {here.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({SKULL_WORD[c.skull].toLowerCase()})
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

/** Is this power use complete enough to submit? */
export function ready(av: AvailablePower | undefined, u: PowerUse | null): boolean {
  if (!av || !u) return false;
  if (av.choices && !u.choice) return false;
  const needsRival = av.target === "rival" || av.target === "rivalItem" || (av.id === "cook" && u.choice === "scones");
  if (needsRival && u.target === undefined) return false;
  if (av.target === "rivalItem" && u.targetItem === undefined) return false;
  if ((av.target === "treasure" || av.target === "item" || av.target === "rivalItem") && u.item === undefined) return false;
  if ((av.id === "reforge" || av.id === "smithing-for-hire") && !u.stat) return false;
  if (av.target === "location" && !u.location && !u.self) return false;
  return true;
}

/** Choose one power from a list and fill in what it needs. */
export function PowerPicker({ game, p, powers, onChange, legend }: { game: GameState; p: PlayerState; powers: AvailablePower[]; onChange: (u: PowerUse | null) => void; legend: string }) {
  const [sel, setSel] = useState<string>("");
  const [u, setU] = useState<PowerUse | null>(null);
  useEffect(() => {
    setSel("");
    setU(null);
  }, [powers.map((x) => x.id + (x.owner ?? "")).join()]);
  const key = (x: AvailablePower) => `${x.id}:${x.owner ?? ""}`;
  const av = powers.find((x) => key(x) === sel);
  const set = (patch: Partial<PowerUse>) => {
    const next = { ...(u ?? { id: av!.id, ...(av!.owner !== undefined ? { target: av!.owner } : {}) }), ...patch } as PowerUse;
    setU(next);
    onChange(ready(av, next) ? next : null);
  };
  const choose = (k: string) => {
    setSel(k);
    const x = powers.find((y) => key(y) === k);
    const base: PowerUse | null = x ? { id: x.id, ...(x.owner !== undefined ? { target: x.owner } : {}) } : null;
    setU(base);
    onChange(x && ready(x, base) ? base : null);
  };
  if (!powers.length) return null;
  const rival = u?.target !== undefined && av?.owner === undefined ? game.players[u.target] : undefined;
  return (
    <fieldset className="stack powers" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="small quiet">{legend}</legend>
      <label className="check small">
        <input type="radio" name={`power-${p.id}`} checked={!sel} onChange={() => choose("")} />
        No power this time
      </label>
      {powers.map((x) => (
        <label key={key(x)} className="check small">
          <input type="radio" name={`power-${p.id}`} checked={sel === key(x)} onChange={() => choose(key(x))} />
          <span>
            <b>{x.name}</b>
            {x.owner !== undefined ? ` from ${game.players[x.owner].name} (${x.params?.price ?? 0} coin)` : ` (${x.slot === "signature" ? "signature, once per game" : costText(x.cost)})`}: {x.text}
          </span>
        </label>
      ))}
      {av && (
        <div className="row power-fields">
          {av.choices && (
            <select id="power-choice" aria-label="Which" value={u?.choice ?? ""} onChange={(e) => set({ choice: e.target.value })}>
              <option value="">Choose one</option>
              {av.choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}: {c.text}
                </option>
              ))}
            </select>
          )}
          {av.target === "location" && (
            <>
              <LocationSelect id="power-loc" value={u?.location ?? ""} only={av.locations} onChange={(v) => set({ location: v || undefined, self: false })} />
              {av.id === "cleanse" && (
                <label className="check small">
                  <input type="checkbox" checked={!!u?.self} onChange={(e) => set({ self: e.target.checked, location: undefined })} />
                  Clear my own Trouble dice instead
                </label>
              )}
            </>
          )}
          {(av.target === "rival" || av.target === "rivalItem" || (av.id === "cook" && u?.choice === "scones")) && (
            <select id="power-rival" aria-label="Rival" value={u?.target ?? ""} onChange={(e) => set({ target: e.target.value === "" ? undefined : Number(e.target.value), targetItem: undefined })}>
              <option value="">Choose a rival</option>
              {(av.rivals ?? []).map((id) => (
                <option key={id} value={id}>
                  {game.players[id].name}
                </option>
              ))}
            </select>
          )}
          {(av.target === "treasure" || av.target === "item" || av.target === "rivalItem") && (
            <select id="power-item" aria-label="Your item" value={u?.item ?? ""} onChange={(e) => set({ item: e.target.value === "" ? undefined : Number(e.target.value) })}>
              <option value="">{av.target === "rivalItem" ? "Give one of yours" : "Choose an item"}</option>
              {(av.items ?? []).map((uid) => {
                const it = p.items.find((i) => i.uid === uid)!;
                return (
                  <option key={uid} value={uid}>
                    {itemLabel(it)}
                  </option>
                );
              })}
            </select>
          )}
          {av.target === "rivalItem" && rival && (
            <select id="power-their-item" aria-label="Their item" value={u?.targetItem ?? ""} onChange={(e) => set({ targetItem: e.target.value === "" ? undefined : Number(e.target.value) })}>
              <option value="">Take one of {rival.name}'s</option>
              {rival.items
                .filter((i) => !Content.item[i.id].cannotSteal && !Content.item[i.id].cannotTrade && Content.item[i.id].type !== "relic" && !i.protected)
                .map((i) => (
                  <option key={i.uid} value={i.uid}>
                    {itemLabel(i)}
                  </option>
                ))}
            </select>
          )}
          {(av.id === "reforge" || av.id === "smithing-for-hire") && (
            <select id="power-stat" aria-label="Stat" value={u?.stat ?? ""} onChange={(e) => set({ stat: (e.target.value || undefined) as Stat })}>
              <option value="">+1 die to which stat?</option>
              {STATS.map((s) => (
                <option key={s} value={s}>
                  {cap(s)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** Every power a player's class has, with what's spent, for the character card. */
export function PowerList({ p }: { p: PlayerState }) {
  // passives are already written out from the class card
  const list = powersOf(p).filter((x) => x.slot !== "passive");
  if (!list.length) return null;
  const extras = [
    p.dream ? plural(p.dream, "Dream token") : "",
    p.ingredients ? plural(p.ingredients, "ingredient") : "",
    p.heat ? `${p.heat} Heat` : "",
  ].filter(Boolean);
  return (
    <details className="pack">
      <summary className="small">
        Powers{extras.length ? `: ${extras.join(", ")}` : ""}
      </summary>
      <ul className="small">
        {Content.cls[p.cls!]?.passive && (
          <li>
            <span className="quiet">Passive.</span> {Content.cls[p.cls!].passive}
          </li>
        )}
        {list.map((x) => {
          const spent = x.slot === "signature" && signatureUsed(p, x.id);
          return (
            <li key={x.id} className={spent ? "spent" : ""}>
              <b>{x.name}</b> <span className="quiet">({SLOT[x.slot]}{x.slot === "active" || x.slot === "service" ? `, ${x.slot === "service" ? `${x.params?.price ?? 0} coin` : costText(x.cost)}` : ""}{spent ? ", used" : ""})</span>. {x.text}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export function Whisper({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  return (
    <div className="stack">
      <p>Whispers on the Wind: everyone has picked. Choose one rival, and the wind tells you where they're headed before the reveal.</p>
      <div className="choices">
        {(d.data.rivals as number[]).map((id) => (
          <button key={id} className="choice" onClick={() => submit({ player: p.id, kind: "whisper", rival: id })}>
            <h3>Listen for {game.players[id].name}</h3>
            <span className="small quiet">the {Content.cls[game.players[id].cls!]?.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Scheme({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  const [use, setUse] = useState<PowerUse | null>(null);
  const heard = [...game.log].reverse().find((e) => e.private?.includes(p.id) && e.round === game.round && e.text.startsWith("The wind whispers"));
  const mine = game.picks[p.id];
  return (
    <div className="stack">
      <p>Everyone has picked, and nothing is revealed yet. {mine ? `You're headed to ${Content.card[mine.card].name}.` : ""}</p>
      {heard && <p className="small journal">{heard.text}</p>}
      <PowerPicker game={game} p={p} powers={d.data.powers} onChange={setUse} legend="Before the reveal" />
      <div className="row">
        <button className="primary" onClick={() => submit({ player: p.id, kind: "scheme", power: use })}>
          {use ? "Use it" : "Do nothing and reveal"}
        </button>
      </div>
    </div>
  );
}

export function Possess({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  const q = game.players[d.data.rival];
  return (
    <div className="stack">
      <p>Possession: {q.name} drew these teasers. You choose which one they get.</p>
      <div className="choices">
        {(d.data.cards as { uid: number; card: string }[]).map((h) => {
          const c = Content.card[h.card];
          return (
            <button key={h.uid} className="choice" onClick={() => submit({ player: p.id, kind: "possess", card: h.uid })}>
              <h3>{c.name}</h3>
              <span className="small quiet">
                {c.tags.map(cap).join(", ")}, {SKULL_WORD[c.skull].toLowerCase()}
              </span>
              <span className="teaser">{c.teaser}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Feast({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  const cook = game.players[d.data.cook];
  return (
    <div className="stack">
      <p>
        {cook.name} invites everyone to a Feast. Come, and you restore all your stamina ({p.stamina} of {p.maxStamina} now), but {cook.name} gains {d.data.vp} VP for every guest.
      </p>
      <div className="row">
        <button className="primary" onClick={() => submit({ player: p.id, kind: "feast", accept: true })}>
          Come to the Feast
        </button>
        <button onClick={() => submit({ player: p.id, kind: "feast", accept: false })}>Stay away</button>
      </div>
    </div>
  );
}
