import React, { useEffect, useState } from "react";
import {
  Content,
  itemLabel,
  type PowerUse,
  hasLight,
  itemCoin,
  itemVp,
  missionTags,
  pAtLeast,
  publicRecord,
  treasures,
  type Action,
  type Decision,
  type GameState,
  type MissionDef,
  type PlayerState,
  type Stat,
} from "@thaloroot/engine";
import { DiceRow, SKULL_WORD, Skulls, Tags, cap, itemName, missionBeatText, plural, taleOf } from "./bits";
import { Feast, Possess, PowerPicker, Scheme, Whisper } from "./powers";

export interface PanelProps {
  game: GameState;
  d: Decision;
  submit: (a: Action) => void;
  /** The last of this player's story beats they've already read. */
  seen?: number;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function MissionCard({ m, claimed = [], finale = false }: { m: MissionDef; claimed?: number[]; finale?: boolean }) {
  return (
    <div className="stack">
      <div className="spread">
        <h3>{m.name}</h3>
        <span className="row small">
          <Skulls n={m.tier} />
          {m.anyPath && !m.path.length ? <Tags tags={["any"]} /> : <Tags tags={[...m.path, ...(m.anyPath ? ["any"] : [])]} />}
        </span>
      </div>
      <p className="small quiet">{m.lore}</p>
      <ul className="small">
        {m.milestones.map((x, i) => (
          <li key={i}>
            {claimed.includes(i) ? "Claimed: " : ""}
            {x.text} <span className="quiet num">({x.vp} VP)</span>
          </li>
        ))}
        <li>
          {finale ? "Done: " : ""}Finale: {m.finale.text} <span className="quiet num">({m.finale.vp} VP)</span>
        </li>
        <li className="quiet">
          Flourish: {m.flourish.text} ({m.flourish.vp} VP)
        </li>
      </ul>
    </div>
  );
}

/** A player's own secrets: their tale so far, mission progress, and what they've learned. */
export function MissionSheet({ game, p, seen = 0 }: { game: GameState; p: PlayerState; seen?: number }) {
  if (!p.mission) return null;
  const m = Content.mission[p.mission];
  const intel = Object.entries(p.intel).filter(([, t]) => t.length);
  const tale = taleOf(game, p.id);
  const fresh = tale.filter((b) => b.seq > seen);
  return (
    <section className="sheet" aria-label="Your mission">
      {fresh.length > 0 && (
        <div className="journal" aria-live="polite">
          <h3>{fresh.length === 1 && fresh[0].part === "opening" ? "Your quest begins" : "New in your tale"}</h3>
          {fresh.map((b) => (
            <p key={b.seq} className="new">{missionBeatText(game, b)}</p>
          ))}
        </div>
      )}
      <MissionCard m={m} claimed={p.claimed} finale={p.finaleDone} />
      {p.claimed.length === 3 && !p.finaleDone && (
        <p className="small">All milestones claimed: you draw 3 teasers, and your finale can be done one skull easier.</p>
      )}
      {intel.length > 0 && (
        <p className="small">
          What you've learned:{" "}
          {intel.map(([rid, tags]) => `${game.players[Number(rid)].name}'s mission involves ${tags.join(" and ")}`).join("; ")}.
        </p>
      )}
      {tale.length > fresh.length && (
        <details className="small">
          <summary>Your tale so far</summary>
          <div className="journal">
            {tale.filter((b) => b.seq <= seen).map((b) => (
              <p key={b.seq}>{missionBeatText(game, b)}</p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** Press and hold to peek at your mission during a public choice. */
function HoldToPeek({ game, p }: { game: GameState; p: PlayerState }) {
  const [open, setOpen] = useState(false);
  if (!p.mission) return null;
  return (
    <div className="stack">
      <button
        className="ghost hold small"
        onPointerDown={() => setOpen(true)}
        onPointerUp={() => setOpen(false)}
        onPointerLeave={() => setOpen(false)}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setOpen(true)}
        onKeyUp={() => setOpen(false)}
        aria-pressed={open}
      >
        Hold to peek at your mission, {p.name}
      </button>
      {open && <MissionSheet game={game} p={p} seen={Infinity} />}
    </div>
  );
}

function Pack({ p }: { p: PlayerState }) {
  if (!p.items.length && !p.companions.length) return <p className="small quiet">Your pack is empty.</p>;
  return (
    <p className="small">
      Pack: {p.items.map((i) => itemLabel(i) + (itemVp(i) ? ` (${itemCoin(i)} / ${itemVp(i)})` : "")).join(", ") || "no items"}
      {p.companions.length ? `. Companions: ${p.companions.map((c) => Content.companion[c.id].name).join(", ")}` : ""}.
    </p>
  );
}

const fmtPct = (x: number) => `${Math.round(x * 100)}%`;

// ---------------------------------------------------------------------------
// Setup decisions
// ---------------------------------------------------------------------------

function ChooseClass({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  return (
    <div className="stack">
      <p>
        {p.name}, pick a class for this game. Classes are public, and no two players share one.
      </p>
      <div className="choices">
        {(d.data.options as string[]).map((id) => {
          const c = Content.cls[id];
          const mods = Object.entries(c.statMods ?? {}).map(([k, v]) => `${(v as number) > 0 ? "+" : ""}${v} ${cap(k)}`);
          return (
            <button key={id} className="choice" onClick={() => submit({ player: p.id, kind: "chooseClass", cls: id })}>
              <h3>{c.name}</h3>
              <span className="small quiet">{mods.join(", ") || "No stat changes"}</span>
              <span className="small">{c.passive}</span>
              <span className="small quiet">{c.weakness}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChooseMission({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  const [pick, setPick] = useState<string | null>(null);
  return (
    <div className="stack">
      <p>Keep one secret mission. The other two go back unseen.</p>
      <div className="choices">
        {(d.data.options as string[]).map((id) => (
          <button key={id} className={`choice ${pick === id ? "selected" : ""}`} aria-pressed={pick === id} onClick={() => setPick(id)}>
            <MissionCard m={Content.mission[id]} />
          </button>
        ))}
      </div>
      <div className="row">
        <button className="primary" disabled={!pick} onClick={() => pick && submit({ player: p.id, kind: "chooseMission", mission: pick })}>
          Keep this mission
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round decisions
// ---------------------------------------------------------------------------

function PickTeaser({ game, d, submit, seen }: PanelProps) {
  const p = game.players[d.player];
  const mods = game.mods.flatMap((m) => m.mods);
  const fog = mods.some((m) => m.kind === "teaserNameOnly") && !hasLight(game, p);
  const moon = mods.some((m) => m.kind === "hideOneSkullMystery");
  const [bridge, setBridge] = useState("");
  const bridges = (d.data.bridge ?? null) as string[] | null;
  return (
    <div className="stack">
      <p>Choose where to explore. Everyone reveals at once; picking the same region and skull rating as a rival means a Meeting.</p>
      {d.data.dreamPeek && !d.data.fullCards && (
        <div className="row small">
          <button onClick={() => submit({ player: p.id, kind: "pickTeaser", card: 0, dreamPeek: true })}>Dream Peek (1 Dream token, {p.dream} left)</button>
          <span className="quiet">See every option behind these teasers first.</span>
        </div>
      )}
      <div className="choices">
        {(d.data.cards as { uid: number; card: string }[]).map((h) => {
          const c = Content.card[h.card];
          const hideLine = fog || (moon && c.skull === 1);
          return (
            <button key={h.uid} className="choice" onClick={() => submit({ player: p.id, kind: "pickTeaser", card: h.uid })}>
              <h3>{c.name}</h3>
              {!fog && (
                <span className="row">
                  <Tags tags={c.tags} />
                  <Skulls n={c.skull} />
                </span>
              )}
              {!hideLine && <span className="teaser">{c.teaser}</span>}
              {fog && <span className="small quiet">Thal Fog: only the name shows.</span>}
              {d.data.fullCards && (
                <ul className="small">
                  {c.options.map((o) => (
                    <li key={o.name}>
                      {o.name}: {o.rest ? "no roll" : `${o.stats.map(cap).join(" or ")}, ${plural(o.need, "success", "successes")}`}
                    </li>
                  ))}
                </ul>
              )}
            </button>
          );
        })}
      </div>
      {bridges && (
        <div className="row small">
          <label className="row">
            Or Build a Bridge (2 stamina, 1 coin) back to
            <select id="bridge-loc" value={bridge} onChange={(e) => setBridge(e.target.value)}>
              <option value="">a place you've explored</option>
              {bridges.map((id) => (
                <option key={id} value={id}>
                  {Content.card[id].name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!bridge} onClick={() => submit({ player: p.id, kind: "pickTeaser", card: 0, bridge })}>
            Cross the bridge
          </button>
        </div>
      )}
      <MissionSheet game={game} p={p} seen={seen} />
    </div>
  );
}

function MeetingChoice({ game, d, submit, seen }: PanelProps) {
  const p = game.players[d.player];
  const others = (d.data.with as number[]).map((id) => game.players[id].name);
  const pick = (choice: "ally" | "brawl" | "pass") => submit({ player: p.id, kind: "meetingChoice", choice });
  return (
    <div className="stack">
      <p>
        {others.length ? `You've run into ${others.join(" and ")}.` : "Someone in a mask is here too."} Choose in secret; you both reveal at once.
      </p>
      <div className="choices">
        <button className="choice" onClick={() => pick("ally")}>
          <h3>Ally</h3>
          <span className="small">If they ally too, you each roll 2 extra dice this turn. If they brawl, you're ambushed.</span>
        </button>
        <button className="choice" onClick={() => pick("brawl")}>
          <h3>Brawl</h3>
          <span className="small">Opposed Brawn rolls. The winner steals a random item and the loser takes 1 damage. Ambush an ally for +2 dice.</span>
        </button>
        <button className="choice" onClick={() => pick("pass")}>
          <h3>Pass</h3>
          <span className="small">Go your own way. If they brawl anyway, it's a normal Brawl.</span>
        </button>
      </div>
      <MissionSheet game={game} p={p} seen={seen} />
    </div>
  );
}

function MonsterChoice({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  const m = Content.worldCard[d.data.monster];
  return (
    <div className="stack">
      <p>
        {m.name} is hunting {p.name}. {m.flavor}
      </p>
      <div className="choices">
        {(d.data.options as any[]).map((o) => (
          <button key={o.index} className="choice" disabled={!o.affordable} onClick={() => submit({ player: p.id, kind: "monsterChoice", option: o.index })}>
            <h3>{o.name}</h3>
            <span className="small">
              {o.stat
                ? `${cap(o.stat)}, ${plural(o.need, "success", "successes")}: about ${fmtPct(pAtLeast(p.stats[o.stat as Stat], o.need))} with ${plural(p.stats[o.stat as Stat], "die", "dice")}`
                : o.pay
                  ? `Pay ${o.pay.coin ? `${o.pay.coin} coin` : `${o.pay.sparkTokens} Spark token`}`
                  : "Take the loss and move on"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChooseOption({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  const card = Content.card[d.data.card];
  const opts = d.data.options as any[];
  const [sel, setSel] = useState<number | null>(null);
  const [stat, setStat] = useState<Stat | null>(null);
  const [token, setToken] = useState(false);
  const [rations, setRations] = useState(false);
  const [assist, setAssist] = useState(false);
  const [finale, setFinale] = useState(false);
  const [bet, setBet] = useState(false);
  const [stampede, setStampede] = useState(false);
  const [boosts, setBoosts] = useState<number[]>([]);
  useEffect(() => {
    setSel(null);
    setStat(null);
    setToken(false);
    setRations(false);
    setAssist(false);
    setFinale(false);
    setStampede(false);
    setBoosts([]);
  }, [d]);
  const powers = (d.data.powers ?? []) as any[];
  const stampedeP = powers.find((x) => x.id === "stampede");
  const cottage = powers.find((x) => x.id === "the-walking-cottage");
  const boostItems = ((d.data.boosts ?? []) as number[]).map((uid) => p.items.find((i) => i.uid === uid)!).filter(Boolean);
  const boostDice = boostItems.filter((i) => boosts.includes(i.uid)).reduce((n, i) => n + ((Content.item[i.id].use ?? []).find((e) => e.type === "nextRollDice")?.amount ?? 0), 0);
  const R = Content.rules.rations;
  const staminaWith = p.stamina + (rations ? R.stamina : 0);
  const usable = (o: any) => o.allowed || (d.data.canRations && !o.rest && o.stamina <= p.stamina + R.stamina && o.stamina > p.stamina);
  const chosen = sel !== null ? opts[sel] : null;
  const chosenStat: Stat | null = chosen && !chosen.rest ? stat && chosen.stats.includes(stat) ? stat : (chosen.stats as Stat[]).reduce((a, b) => (chosen.dice[b] > chosen.dice[a] ? b : a)) : null;
  const needsRations = chosen && !chosen.rest && chosen.stamina > p.stamina;
  const cardOpt = (o: any) => (o.alt ? null : card.options[o.index]);
  const go = () =>
    chosen &&
    submit({
      player: p.id,
      kind: "chooseOption",
      option: chosen.index,
      stat: chosenStat ?? undefined,
      useToken: token,
      rations: rations || !!needsRations,
      askAssist: assist,
      attemptFinale: finale,
      bet,
      useItems: boosts,
      power: stampede && !chosen.rest ? "stampede" : undefined,
    });
  return (
    <div className="stack">
      <div className="card-head">
        <div className="spread">
          <h2>{card.name}</h2>
          <span className="row">
            <Tags tags={card.tags} />
            <Skulls n={card.skull} />
          </span>
        </div>
        <p className="teaser">{card.teaser}</p>
        <p className="small quiet">{card.flavor}</p>
        {d.data.meetingBonus > 0 && <p className="small">Teamed up: +{d.data.meetingBonus} dice on this card.</p>}
        {d.data.frog && <p className="small">{p.name} is a frog: only Charm and rest options work this turn.</p>}
      </div>
      <div className="options" role="radiogroup" aria-label="Options">
        {opts.map((o) => {
          const co = cardOpt(o);
          const ok = usable(o);
          const best = o.rest ? null : (o.stats as Stat[]).reduce((a, b) => (o.dice[b] > o.dice[a] ? b : a));
          const dice = best ? o.dice[best] + (sel === o.index ? (token ? 1 : 0) + (stampede && stampedeP ? stampedeP.dice : 0) + boostDice : 0) : 0;
          return (
            <div
              key={o.index}
              className={`option ${sel === o.index ? "selected" : ""}`}
              role="radio"
              aria-checked={sel === o.index}
              aria-disabled={!ok}
              tabIndex={ok ? 0 : -1}
              onClick={() => ok && setSel(o.index)}
              onKeyDown={(e) => ok && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(o.index))}
              style={{ cursor: ok ? "pointer" : "not-allowed", opacity: ok ? 1 : 0.5 }}
            >
              <div>
                <b>{o.name}</b>{" "}
                <span className="small quiet">
                  {o.rest ? "No roll, no stamina" : `${o.stats.length > 2 ? "Any stat (Flow)" : o.stats.map(cap).join(" or ")}, ${plural(o.need, "success", "successes")}, ${o.stamina} stamina`}
                </span>
              </div>
              <div className="odds small">
                {o.rest ? "Sure thing" : `${plural(dice, "die", "dice")}, about ${fmtPct(pAtLeast(dice, o.need))}`}
              </div>
              {co && (
                <div className="results">
                  {co.rest ? (
                    <span>{co.text.success}</span>
                  ) : (
                    <>
                      <span><b>Success:</b> {co.text.success}</span>
                      {co.text.fail && <span><b>Fail:</b> {co.text.fail}</span>}
                      {co.text.spark && <span><b>Spark{co.sparkNeeds > 1 ? " (two 6s)" : ""}:</b> {co.text.spark}</span>}
                    </>
                  )}
                  {co.pay ? <span className="quiet">Costs {co.pay} coin.</span> : null}
                  {co.discardTreasure ? <span className="quiet">Costs one of your treasures.</span> : null}
                </div>
              )}
              {!co && <div className="results quiet">A World card offers this instead of exploring.</div>}
            </div>
          );
        })}
      </div>
      {chosen && !chosen.rest && chosen.stats.length > 1 && (
        <label className="row small">
          Roll with
          <select id="stat-pick" value={chosenStat ?? ""} onChange={(e) => setStat(e.target.value as Stat)}>
            {(chosen.stats as Stat[]).map((s) => (
              <option key={s} value={s}>
                {cap(s)} ({chosen.dice[s]} dice)
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="toggles small">
        <label className="check">
          <input type="checkbox" checked={token} disabled={!p.sparkTokens || !chosen || chosen.rest} onChange={(e) => setToken(e.target.checked)} />
          Spend a Spark token for +1 die ({p.sparkTokens} left)
        </label>
        <label className="check">
          <input type="checkbox" checked={rations || !!needsRations} disabled={!d.data.canRations || !!needsRations} onChange={(e) => setRations(e.target.checked)} />
          Trail rations: pay {R.coin} coin for {R.stamina} stamina ({p.coin} coin)
        </label>
        <label className="check">
          <input type="checkbox" checked={assist} disabled={!chosen || chosen.rest} onChange={(e) => setAssist(e.target.checked)} />
          Ask rivals for Assist dice
        </label>
        {d.data.finaleCost && (
          <label className="check">
            <input type="checkbox" checked={finale} disabled={!chosen || chosen.rest} onChange={(e) => setFinale(e.target.checked)} />
            Attempt my finale (pays its cost now)
          </label>
        )}
        {stampedeP && (
          <label className="check">
            <input type="checkbox" checked={stampede} disabled={!chosen || chosen.rest} onChange={(e) => setStampede(e.target.checked)} />
            Stampede (signature, once per game): +{stampedeP.dice} dice, one per companion
          </label>
        )}
        {boostItems.map((it) => (
          <label key={it.uid} className="check">
            <input type="checkbox" checked={boosts.includes(it.uid)} disabled={!chosen || chosen.rest} onChange={() => setBoosts(boosts.includes(it.uid) ? boosts.filter((x) => x !== it.uid) : [...boosts, it.uid])} />
            Use the {itemLabel(it)}: {Content.item[it.id].text}
          </label>
        ))}
        {chosen?.rest && cardOpt(chosen)?.success.some((e: any) => e.type === "bet") && (
          <label className="check">
            <input type="checkbox" checked={bet} onChange={(e) => setBet(e.target.checked)} />
            Place the bet
          </label>
        )}
      </div>
      <div className="spread">
        <span className="small quiet num">
          Stamina {staminaWith} / {p.maxStamina}, coin {p.coin}
        </span>
        <span className="row">
          {cottage && (
            <button title={cottage.text} onClick={() => submit({ player: p.id, kind: "chooseOption", option: 0, power: "the-walking-cottage" })}>
              The Walking Cottage instead (1 coin)
            </button>
          )}
          <button className="primary" disabled={!chosen} onClick={go}>
            {chosen ? (chosen.rest ? `Take it easy: ${chosen.name}` : `Roll for ${chosen.name}`) : "Choose an option"}
          </button>
        </span>
      </div>
      <Pack p={p} />
      <HoldToPeek game={game} p={p} />
    </div>
  );
}

function AssistOffer({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  const to = game.players[d.data.to];
  const max = Math.min(Content.rules.assist.maxDice, p.stamina);
  return (
    <div className="stack">
      <p>
        {to.name} asks for help with a {cap(d.data.stat)} roll at {Content.card[d.data.card].name} ({plural(d.data.need, "success", "successes")} needed). Each die you lend costs you 1 stamina. Name your price out loud first, if you like.
      </p>
      <div className="row">
        {Array.from({ length: max + 1 }, (_, n) => (
          <button key={n} className={n ? "" : "ghost"} onClick={() => submit({ player: p.id, kind: "assistOffer", dice: n })}>
            {n ? `Lend ${plural(n, "die", "dice")}` : "Don't help"}
          </button>
        ))}
      </div>
    </div>
  );
}

function Push({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  const ones = (d.data.dice as number[]).filter((x) => x === 1).length;
  return (
    <div className="stack">
      <div className="tray">
        <p className="small quiet num">
          {d.data.successes} of {d.data.need} successes so far
        </p>
        <DiceRow dice={d.data.dice} trouble={d.data.trouble} />
      </div>
      <p>
        Push your luck: roll 2 more dice. {ones ? `You already have ${plural(ones, "one")}; two or more means a Mishap.` : "More dice means more chances for a Mishap."}
      </p>
      <div className="row">
        <button className="primary" onClick={() => submit({ player: p.id, kind: "push", push: true })}>
          Push your luck
        </button>
        <button onClick={() => submit({ player: p.id, kind: "push", push: false })}>Keep this roll</button>
      </div>
    </div>
  );
}

function Reward({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  const t = game.turn!;
  const card = Content.card[t.card!.card];
  const o = card.options[t.option!];
  return (
    <div className="stack">
      <p>
        {p.name} succeeded{d.data.spark ? " with a Spark" : ""}. Every success also gives 1 Lesson in {cap(d.data.stat)}.
      </p>
      <div className="choices">
        <button className="choice" onClick={() => submit({ player: p.id, kind: "reward", lessonInstead: false })}>
          <h3>Take the reward</h3>
          <span className="small">{o?.text.success}</span>
        </button>
        <button className="choice" onClick={() => submit({ player: p.id, kind: "reward", lessonInstead: true })}>
          <h3>Take 2 Lessons instead</h3>
          <span className="small">
            In {cap(d.data.stat)}: {p.lessons[d.data.stat as Stat]} of 5 now. Five Lessons raise a stat for good.
          </span>
        </button>
      </div>
      <HoldToPeek game={game} p={p} />
    </div>
  );
}

function QuickAction({ game, d, submit, seen }: PanelProps) {
  const p = game.players[d.player];
  const [trap, setTrap] = useState(false);
  const [loc, setLoc] = useState(Content.cards[0].id);
  const [type, setType] = useState<"snare" | "pickpocket" | "stinkbomb">("snare");
  const [use, setUse] = useState<number[]>([]);
  const [cash, setCash] = useState<number[]>([]);
  const [rations, setRations] = useState(false);
  const [power, setPower] = useState<PowerUse | null>(null);
  const [targets, setTargets] = useState<Record<number, number>>({});
  const toggle = (xs: number[], set: (v: number[]) => void, v: number) => set(xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]);
  const taken = new Set(game.traps.map((t) => t.location));
  const mine = game.traps.filter((t) => t.owner === p.id);
  const rivalsOf = game.players.filter((q) => q.id !== p.id);
  return (
    <div className="stack">
      <p>One quick action before the next player goes: set a trap, use a power, or buy trail rations. Only {p.name} should be looking.</p>
      <PowerPicker game={game} p={p} powers={d.data.powers ?? []} onChange={(u) => { setPower(u); if (u) setTrap(false); }} legend="Use a power" />
      {d.data.canTrap ? (
        <div className="stack">
          <label className="check">
            <input type="checkbox" checked={trap} disabled={!!power} onChange={(e) => setTrap(e.target.checked)} />
            Set a trap {d.data.trapCost ? `(${d.data.trapCost} stamina)` : "(free)"}: the next rival to pick that location springs it
          </label>
          {trap && (
            <div className="row">
              <select id="trap-loc" aria-label="Location" value={loc} onChange={(e) => setLoc(e.target.value)}>
                {Content.cards.map((c) => (
                  <option key={c.id} value={c.id} disabled={taken.has(c.id)}>
                    {c.name} ({cap(c.region)}, {SKULL_WORD[c.skull].toLowerCase()})
                  </option>
                ))}
              </select>
              <select id="trap-type" aria-label="Trap" value={type} onChange={(e) => setType(e.target.value as any)}>
                <option value="snare">Snare: they lose 2 stamina</option>
                <option value="pickpocket">Pickpocket: you steal from them</option>
                <option value="stinkbomb">Stinkbomb: they roll 2 fewer dice</option>
              </select>
            </div>
          )}
        </div>
      ) : (
        <p className="small quiet">{mine.length ? `Your trap is waiting at ${mine.map((t) => Content.card[t.location].name).join(" and ")}.` : "You can't set a trap right now."}</p>
      )}
      {d.data.canRations && (
        <label className="check">
          <input type="checkbox" checked={rations} disabled={trap || !!power} onChange={(e) => setRations(e.target.checked)} />
          Trail rations instead: pay 2 coin for 2 stamina
        </label>
      )}
      {(d.data.usable as number[]).length > 0 && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small quiet">Use one-use items</legend>
          {(d.data.usable as number[]).map((uid) => {
            const it = p.items.find((i) => i.uid === uid)!;
            const def = Content.item[it.id];
            const aimed = (def.use ?? []).some((e) => e.type === "frogRival" || e.type === "troubleRival");
            return (
              <div key={uid} className="row">
                <label className="check small">
                  <input type="checkbox" checked={use.includes(uid)} onChange={() => toggle(use, setUse, uid)} />
                  {it.id === "taproot-fragment" ? `Taproot Fragment: ${Content.fragment[it.fragment!]?.name}. ${Content.fragment[it.fragment!]?.text}` : `${def.name}: ${def.text}`}
                </label>
                {aimed && use.includes(uid) && (
                  <select aria-label="Which rival" value={targets[uid] ?? rivalsOf[0]?.id} onChange={(e) => setTargets({ ...targets, [uid]: Number(e.target.value) })}>
                    {rivalsOf.map((q) => (
                      <option key={q.id} value={q.id}>
                        on {q.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </fieldset>
      )}
      {(d.data.cashable as number[]).length > 0 && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small quiet">Cash treasures for coin (you lose their VP)</legend>
          {(d.data.cashable as number[]).map((uid) => {
            const it = p.items.find((i) => i.uid === uid)!;
            return (
              <label key={uid} className="check small">
                <input type="checkbox" checked={cash.includes(uid)} onChange={() => toggle(cash, setCash, uid)} />
                {itemLabel(it)}: {itemCoin(it)} coin, or {itemVp(it)} VP if kept
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="row">
        <button
          className="primary"
          onClick={() =>
            submit({
              player: p.id,
              kind: "quickAction",
              action: power ? "power" : trap ? "trap" : rations ? "rations" : "none",
              power: power ?? undefined,
              location: trap ? loc : undefined,
              trapType: trap ? type : undefined,
              useItems: use,
              itemTargets: Object.fromEntries(use.map((u) => [u, targets[u] ?? rivalsOf[0]?.id])),
              cash,
            })
          }
        >
          {power ? "Use the power and end my turn" : trap ? "Set the trap and end my turn" : "End my turn"}
        </button>
      </div>
      <MissionSheet game={game} p={p} seen={seen} />
    </div>
  );
}

function Market({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  const m = Content.worldCard[d.data.merchant];
  const [buy, setBuy] = useState<number[]>([]);
  const [cash, setCash] = useState<number[]>([]);
  const [exchange, setExchange] = useState<number[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [bid, setBid] = useState(0);
  useEffect(() => {
    setBuy([]);
    setCash([]);
    setExchange([]);
    setServices([]);
    setBid(0);
  }, [d]);
  const stock = d.data.stock as { uid: number; id: string; price: number }[];
  const cost = stock.filter((s) => buy.includes(s.uid)).reduce((t, s) => t + s.price, 0);
  const tr = treasures(p);
  const sellBonus = (m as any).buysTreasureBonus ?? 0;
  const cashIn = tr.filter((t) => cash.includes(t.uid)).reduce((s, t) => s + itemCoin(t) + sellBonus, 0);
  const toggle = <T,>(xs: T[], set: (v: T[]) => void, v: T) => set(xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]);
  const services_ = (d.data.services as any[]).filter((s) => s.buy === "learnRivalTag");
  return (
    <div className="stack">
      <p>
        {m.name} is open. {m.text} {p.name} has {p.coin} coin.
      </p>
      {stock.length > 0 && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small quiet">Buy</legend>
          {stock.map((s) => {
            const def = Content.item[s.id];
            return (
              <label key={s.uid} className="check small">
                <input type="checkbox" checked={buy.includes(s.uid)} onChange={() => toggle(buy, setBuy, s.uid)} />
                {def.name} for {s.price} coin ({def.rarity}{def.vp ? `, ${def.vp} VP` : ""}){def.text ? `: ${def.text}` : ""}
              </label>
            );
          })}
        </fieldset>
      )}
      {tr.length > 0 && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small quiet">Sell treasures{sellBonus ? ` (the barge pays ${sellBonus} extra)` : ""}</legend>
          {tr.map((t) => (
            <label key={t.uid} className="check small">
              <input type="checkbox" checked={cash.includes(t.uid)} onChange={() => toggle(cash, setCash, t.uid)} />
              {itemName(t.id)}: {itemCoin(t) + sellBonus} coin, or {itemVp(t)} VP if kept
            </label>
          ))}
        </fieldset>
      )}
      {d.data.trade && tr.length >= d.data.trade.give.treasures && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small quiet">
            Trade {plural(d.data.trade.give.treasures, "treasure")} for {d.data.trade.get.randomRare ? "a random rare item" : `${d.data.trade.get.lessons} Lessons`}
          </legend>
          {tr.map((t) => (
            <label key={t.uid} className="check small">
              <input type="checkbox" checked={exchange.includes(t.uid)} onChange={() => toggle(exchange, setExchange, t.uid)} />
              {itemName(t.id)}
            </label>
          ))}
        </fieldset>
      )}
      {services_.length > 0 && (
        <label className="check small">
          <input type="checkbox" checked={services.includes("learnRivalTag")} onChange={() => toggle(services, setServices, "learnRivalTag")} />
          Buy a whisper: learn one tag of a rival's mission for {services_[0].coin} coin
        </label>
      )}
      {d.data.auction && (
        <label className="row small">
          Secret bid for the {itemName(d.data.auction)}:
          <input id="bid" type="number" min={0} max={p.coin} value={bid} onChange={(e) => setBid(Math.max(0, Math.min(p.coin, Number(e.target.value) || 0)))} style={{ width: "6rem" }} />
          coin
        </label>
      )}
      <div className="spread">
        <span className={`small num ${cost > p.coin + cashIn ? "error" : "quiet"}`}>
          Spending {cost} of {p.coin + cashIn} coin
        </span>
        <button className="primary" disabled={cost > p.coin + cashIn} onClick={() => submit({ player: p.id, kind: "market", buy, cash, exchange, services, bid })}>
          {buy.length || cash.length || exchange.length || services.length || bid ? "Make these deals" : "Leave the market"}
        </button>
      </div>
    </div>
  );
}

function RespondTrade({ game, d, submit }: PanelProps) {
  const p = game.players[d.player];
  const from = game.players[d.data.from];
  const names = (pl: PlayerState, uids: number[], coin: number) =>
    [...uids.map((u) => itemName(pl.items.find((i) => i.uid === u)?.id ?? "")), coin ? `${coin} coin` : ""].filter(Boolean).join(" and ") || "nothing";
  return (
    <div className="stack">
      <p>
        {from.name} offers {names(from, d.data.give.items, d.data.give.coin)} for your {names(p, d.data.get.items, d.data.get.coin)}.
      </p>
      <div className="row">
        <button className="primary" onClick={() => submit({ player: p.id, kind: "respondTrade", accept: true })}>Accept</button>
        <button onClick={() => submit({ player: p.id, kind: "respondTrade", accept: false })}>Decline</button>
      </div>
    </div>
  );
}

const TAG_ORDER = ["forest", "meadow", "swamp", "mountain", "ruins", "creature", "peril"] as const;

/** One line of what the table saw a rival do. */
function SeenAtTable({ game, id }: { game: GameState; id: number }) {
  const r = publicRecord(game, id);
  const where = TAG_ORDER.filter((t) => r.explored[t]).map((t) => `${cap(t)} ${r.explored[t]}`);
  const meet = (["ally", "brawl", "pass"] as const).filter((k) => r.meetings[k]).map((k) => `${cap(k)} ${r.meetings[k]}`);
  const extras = [
    r.befriended.length ? `befriended ${r.befriended.map((c) => Content.companion[c]?.name ?? c).join(" and ")}` : "",
    r.brawlsWon ? `won ${plural(r.brawlsWon, "Brawl")}` : "",
    r.rests ? `rested ${plural(r.rests, "time")}` : "",
    r.pushes ? `pushed their luck ${plural(r.pushes, "time")}` : "",
    r.frogs ? `was a frog ${plural(r.frogs, "time")}` : "",
    r.bought ? `bought ${plural(r.bought, "thing")}` : "",
  ].filter(Boolean);
  return (
    <p className="seen">
      Seen at the table: explored {where.join(", ") || "nowhere"}
      {meet.length ? `. At Meetings: ${meet.join(", ")}` : ""}
      {extras.length ? `. ${cap(extras.join(", "))}` : ""}.
    </p>
  );
}

function FinalGuess({ game, d, submit, seen }: PanelProps) {
  const p = game.players[d.player];
  const [g, setG] = useState<Record<number, string>>({});
  const lineups = (d.data.lineups ?? []) as { rival: number; missions: string[] }[];
  const chosen = Object.values(g).filter(Boolean).length;
  return (
    <div className="stack">
      <p>
        For up to {d.data.max} rivals, pick their mission from a lineup of {lineups[0]?.missions.length ?? 6}. One of them is real. Each correct guess is worth {Content.rules.scoring.guessVp} VP. Missions crossed out don't fit what you've learned.
      </p>
      {lineups.map(({ rival, missions }) => {
        const q = game.players[rival];
        const tags = p.intel[q.id] ?? [];
        const known = p.knownMissions[q.id];
        const full = !g[q.id] && chosen >= d.data.max;
        return (
          <fieldset key={q.id} className="rival" style={{ border: 0, margin: 0, padding: "0.8rem 0 0" }} disabled={full}>
            <legend>
              <b>{q.name}</b> <span className="small quiet">the {className(q.cls)}</span>
            </legend>
            {known ? (
              <p className="small">A Taproot Fragment showed you {q.name}'s mission.</p>
            ) : tags.length ? (
              <p className="small">You learned their mission involves {tags.join(" and ")}.</p>
            ) : null}
            <SeenAtTable game={game} id={q.id} />
            <div className="lineup" role="radiogroup" aria-label={`${q.name}'s mission`}>
              {missions.map((id) => {
                const m = Content.mission[id];
                const ruled = tags.some((t) => !missionTags(id).includes(t));
                return (
                  <label key={id} className={ruled ? "ruled-out" : ""}>
                    <input type="radio" name={`guess-${q.id}`} checked={g[q.id] === id} onChange={() => setG({ ...g, [q.id]: id })} />
                    <span>
                      {m.name}
                      <span className="small quiet"> {m.anyPath && !m.path.length ? "Any path" : [...m.path.map(cap), ...(m.anyPath ? ["any"] : [])].join(", ")}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {g[q.id] && (
              <button className="ghost small" type="button" onClick={() => setG(Object.fromEntries(Object.entries(g).filter(([k]) => Number(k) !== q.id)))}>
                Clear guess for {q.name}
              </button>
            )}
          </fieldset>
        );
      })}
      <div className="row">
        <button className="primary" onClick={() => submit({ player: p.id, kind: "finalGuess", guesses: g })}>
          Lock in {chosen ? plural(chosen, "guess", "guesses") : "no guesses"}
        </button>
      </div>
      <MissionSheet game={game} p={p} seen={seen} />
    </div>
  );
}

function className(id: string | null) {
  return id ? Content.cls[id]?.name ?? id : "adventurer";
}

const PANELS: Record<Decision["kind"], (p: PanelProps) => React.ReactElement> = {
  chooseClass: ChooseClass,
  chooseMission: ChooseMission,
  pickTeaser: PickTeaser,
  meetingChoice: MeetingChoice,
  monsterChoice: MonsterChoice,
  chooseOption: ChooseOption,
  assistOffer: AssistOffer,
  push: Push,
  reward: Reward,
  quickAction: QuickAction,
  market: Market,
  respondTrade: RespondTrade,
  finalGuess: FinalGuess,
  whisper: Whisper,
  scheme: Scheme,
  possess: Possess,
  feast: Feast,
};

export const HEADINGS: Record<Decision["kind"], (name: string) => string> = {
  chooseClass: (n) => `${n} chooses a class`,
  chooseMission: (n) => `${n}'s secret mission`,
  pickTeaser: (n) => `Where will ${n} explore?`,
  meetingChoice: (n) => `${n} has a Meeting`,
  monsterChoice: (n) => `${n} is being hunted`,
  chooseOption: (n) => `${n}'s turn`,
  assistOffer: (n) => `Will ${n} lend a hand?`,
  push: (n) => `${n} came up short`,
  reward: (n) => `${n}'s reward`,
  quickAction: (n) => `${n}'s quick action`,
  market: (n) => `${n} at the market`,
  respondTrade: (n) => `An offer for ${n}`,
  finalGuess: (n) => `${n}'s final guesses`,
  whisper: (n) => `The wind whispers to ${n}`,
  scheme: (n) => `${n} has a trick up their sleeve`,
  possess: (n) => `${n} possesses a rival's choice`,
  feast: (n) => `${n} is invited to a Feast`,
};

export function DecisionPanel(props: PanelProps) {
  const Panel = PANELS[props.d.kind];
  return <Panel {...props} />;
}
