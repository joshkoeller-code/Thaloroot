import { Content } from "./content.js";
import { hasLight, isTreasure, treasures } from "./player.js";
import type { Condition, GameEvent, GameState, PlayerState } from "./types.js";

/** Fields of an event that a condition key filters on. */
function fieldMatch(cond: Condition, ev: GameEvent, grace: number): boolean {
  if (cond.event && cond.event !== ev.type) return false;
  if (cond.tags && !(ev.tags ?? []).some((t) => cond.tags!.includes(t))) return false;
  if (cond.minSkull && (ev.skull ?? 0) < cond.minSkull - grace) return false;
  if (cond.stats && !(ev.stat && cond.stats.includes(ev.stat))) return false;
  if (cond.stat && ev.stat !== cond.stat) return false;
  if (cond.choice && ev.choice !== cond.choice) return false;
  if (cond.trapType && ev.trapType !== cond.trapType) return false;
  if (cond.minCorrect && (ev.correct ?? 0) < cond.minCorrect) return false;
  if (cond.teamedUp && !ev.teamedUpCorrect) return false;
  if (cond.asAmbusher && !ev.ambusher) return false;
  if (cond.minSixes && (ev.sixes ?? 0) < cond.minSixes) return false;
  if (cond.minNeed && (ev.need ?? 0) < cond.minNeed) return false;
  if (cond.noPush && ev.pushed) return false;
  if (cond.pushed && !ev.pushed) return false;
  if (cond.noAssist && ev.assisted) return false;
  if (cond.noItem && ev.usedItem) return false;
  if (cond.duringMeeting && !ev.duringMeeting) return false;
  if (cond.teamUp && !ev.teamUp) return false;
  if (cond.withMishap && !ev.mishap) return false;
  if (cond.minStaminaSpent && (ev.staminaSpent ?? 0) < cond.minStaminaSpent) return false;
  if (cond.lessonInstead && !ev.lessonInstead) return false;
  if (cond.atTrappedLocation && !ev.atTrappedLocation) return false;
  if (cond.sprangTrapThisTurn && !ev.sprangTrap) return false;
  if (cond.cost && !ev.finaleAttempt) return false;
  return true;
}

export function requiresMet(state: GameState, p: PlayerState, req: Record<string, any>, ev?: GameEvent): boolean {
  for (const [k, v] of Object.entries(req)) {
    switch (k) {
      case "minCompanions":
        if (p.companions.length < v) return false;
        break;
      case "holdTreasureFrom": {
        // each listed tag needs its own treasure
        const pool = treasures(p).map((t) => t.foundTags);
        for (const tag of v as string[]) {
          const i = pool.findIndex((tags) => tags.includes(tag as any));
          if (i < 0) return false;
          pool.splice(i, 1);
        }
        break;
      }
      case "holdAny": {
        const ok = (v as any[]).some((alt) =>
          alt.item
            ? p.items.some((i) => i.id === alt.item)
            : treasures(p).some((t) => t.foundTags.includes(alt.treasureFrom)),
        );
        if (!ok) return false;
        break;
      }
      case "lightSource":
        if (!hasLight(state, p)) return false;
        break;
      case "maxItems":
        if (p.items.length > v) return false;
        break;
      case "minItems":
        if (p.items.length < v) return false;
        break;
      case "minCoin":
        if (p.coin < v) return false;
        break;
      case "treasureCoinValue":
        if (treasures(p).reduce((s, t) => s + Content.item[t.id].coin, 0) < v) return false;
        break;
      case "healthAtTurnStart": {
        const h = ev?.startHealth ?? p.health;
        if (v === "full" && h < p.maxHealth) return false;
        if (v === "halfOrLess" && h > p.maxHealth / 2) return false;
        break;
      }
      case "maxStaminaAtTurnStart":
        if ((ev?.startStamina ?? p.stamina) > v) return false;
        break;
      case "minStolenItems":
        if (p.items.filter((i) => i.stolen).length < v) return false;
        break;
      case "noRivalFinished":
        if (state.players.some((q) => q.id !== p.id && q.finaleDone)) return false;
        break;
      case "distinctSuccessTags": {
        const tags = new Set(p.history.filter((e) => e.type === "success").flatMap((e) => e.tags ?? []));
        if (tags.size < v) return false;
        break;
      }
      default:
        return false; // unknown requirement: never satisfied, so it is visible in tests
    }
  }
  return true;
}

function distinctKey(e: GameEvent, by: string): string[] {
  if (by === "location") return [e.location ?? ""];
  if (by === "stat") return [e.stat ?? ""];
  if (by === "tag") return (e.tags ?? []).map(String);
  return [""];
}

/**
 * Does this event (just recorded, or hypothetical) satisfy an event condition?
 * `history` must already include `ev` when it is a real event.
 */
export function eventMeets(
  state: GameState,
  p: PlayerState,
  cond: Condition,
  ev: GameEvent,
  grace = 0,
  history: GameEvent[] = p.history,
): boolean {
  if (cond.any) return cond.any.some((c) => eventMeets(state, p, c, ev, grace, history));
  if (cond.all) return cond.all.every((c) => eventMeets(state, p, c, ev, grace, history));
  if (!fieldMatch(cond, ev, grace)) return false;
  if (cond.requires && !requiresMet(state, p, cond.requires, ev)) return false;
  if (cond.previousTurn) {
    const prev = history.filter((e) => e.turn === ev.turn - 1);
    if (!prev.some((e) => fieldMatch(cond.previousTurn!, e, 0))) return false;
  }
  if (cond.count && cond.count > 1) {
    const hist = history.includes(ev) ? history : [...history, ev];
    const matching = hist.filter((e) => fieldMatch(cond, e, grace));
    if (cond.distinct) {
      const keys = new Set(matching.flatMap((e) => distinctKey(e, cond.distinct!)).filter((k) => k));
      if (cond.distinct === "tag" && cond.tags) for (const k of [...keys]) if (!cond.tags.includes(k as any)) keys.delete(k);
      if (keys.size < cond.count) return false;
    } else if (matching.length < cond.count) return false;
  }
  return true;
}

/** End-of-game check for flourishes. */
export function endCheck(state: GameState, p: PlayerState, cond: Condition): boolean {
  if (cond.all) return cond.all.every((c) => endCheck(state, p, c));
  if (cond.any) return cond.any.some((c) => endCheck(state, p, c));
  if (cond.never) {
    let hist = p.history;
    if (cond.until === "milestones") {
      const at = p.log.allClaimedAt;
      if (at === undefined) return false; // never claimed every milestone
      hist = hist.slice(0, at);
    }
    return !hist.some((e) => eventMeets(state, p, { ...cond.never!, count: undefined }, e, 0, hist));
  }
  if (cond.ever) {
    return p.history.some((e) => eventMeets(state, p, cond.ever!, e, 0, p.history));
  }
  if (cond.end) {
    for (const [k, v] of Object.entries(cond.end)) {
      if (k === "minTreasures" && treasures(p).length < v) return false;
      if (k === "frog" && !p.frog) return false;
      if (k === "minCoin" && p.coin < v) return false;
      if (k === "minSparkTokens" && p.sparkTokens < v) return false;
      if (k === "minCompanions" && p.companions.length < v) return false;
      if (k === "holdFragment" && !p.items.some((i) => i.id === "taproot-fragment")) return false;
    }
    return true;
  }
  return false;
}

export interface MissionProgress {
  milestones: number[];
  finale: boolean;
}

/**
 * Check a player's mission against an event. Returns what was newly claimed.
 * The engine calls this after pushing `ev` into the player's history.
 */
export function checkMission(state: GameState, p: PlayerState, ev: GameEvent): MissionProgress {
  const res: MissionProgress = { milestones: [], finale: false };
  if (!p.mission) return res;
  const m = Content.mission[p.mission];
  m.milestones.forEach((ms, i) => {
    if (p.claimed.includes(i) || !ms.condition) return;
    if (eventMeets(state, p, ms.condition, ev)) {
      p.claimed.push(i);
      res.milestones.push(i);
    }
  });
  if (p.claimed.length === 3 && p.log.allClaimedAt === undefined) p.log.allClaimedAt = p.history.length;
  if (p.claimed.length === 3 && !p.finaleDone && m.finale.condition) {
    if (eventMeets(state, p, m.finale.condition, ev, Content.rules.missions.finaleGrace)) {
      p.finaleDone = true;
      res.finale = true;
    }
  }
  return res;
}

/** VP a player would gain from a hypothetical event (used by bots). */
export function missionGain(state: GameState, p: PlayerState, ev: GameEvent): number {
  if (!p.mission) return 0;
  const m = Content.mission[p.mission];
  const vp = (Content.rules.missions.vp as any)[m.tier] as number[];
  let g = 0;
  const hist = [...p.history, ev];
  let claimed = p.claimed.length;
  m.milestones.forEach((ms, i) => {
    if (!p.claimed.includes(i) && ms.condition && eventMeets(state, p, ms.condition, ev, 0, hist)) {
      g += vp[i];
      claimed++;
    }
  });
  if (claimed === 3 && !p.finaleDone && m.finale.condition) {
    if (eventMeets(state, p, m.finale.condition, ev, Content.rules.missions.finaleGrace, hist)) {
      g += vp[3] + (state.firstFinisher === null ? Content.rules.missions.firstFinisherVp : 0);
    }
  }
  return g;
}

/** Does the mission care about this event type at all (bots use this to steer)? */
export function missionWants(p: PlayerState, eventType: string, extra: Partial<Condition> = {}): boolean {
  if (!p.mission) return false;
  const m = Content.mission[p.mission];
  const conds: Condition[] = m.milestones.filter((_, i) => !p.claimed.includes(i)).map((x) => x.condition!).filter(Boolean);
  if (p.claimed.length === 3 && !p.finaleDone && m.finale.condition) conds.push(m.finale.condition);
  const flat = (c: Condition): Condition[] => [c, ...(c.any ?? []).flatMap(flat), ...(c.all ?? []).flatMap(flat)];
  return conds.flatMap(flat).some((c) => c.event === eventType && Object.entries(extra).every(([k, v]) => c[k] === v));
}

export function missionNever(p: PlayerState, eventType: string): boolean {
  if (!p.mission) return false;
  const f = Content.mission[p.mission].flourish.condition;
  const flat = (c: Condition | null | undefined): Condition[] =>
    c ? [c, ...(c.all ?? []).flatMap(flat), ...(c.any ?? []).flatMap(flat)] : [];
  return flat(f).some((c) => c.never?.event === eventType);
}

/** Mission tags a rival could learn ("any" missions without tags reveal "any"). */
export function missionTags(missionId: string): string[] {
  const m = Content.mission[missionId];
  const tags: string[] = [...m.path];
  if (m.anyPath || !tags.length) tags.push("any");
  return tags;
}

export { isTreasure };
