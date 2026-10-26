import exploreCards from "@thaloroot/content/explore-cards.json" with { type: "json" };
import missions from "@thaloroot/content/missions.json" with { type: "json" };
import worldCards from "@thaloroot/content/world-cards.json" with { type: "json" };
import items from "@thaloroot/content/items.json" with { type: "json" };
import companions from "@thaloroot/content/companions.json" with { type: "json" };
import classes from "@thaloroot/content/classes.json" with { type: "json" };
import species from "@thaloroot/content/species.json" with { type: "json" };
import fragments from "@thaloroot/content/taproot-fragments.json" with { type: "json" };
import rules from "@thaloroot/content/rules.json" with { type: "json" };
import story from "@thaloroot/content/story.json" with { type: "json" };

import type {
  ClassDef,
  CompanionDef,
  ExploreCard,
  FragmentDef,
  ItemDef,
  MissionDef,
  SpeciesDef,
  WorldCardDef,
  WorldCategory,
} from "./types.js";

function index<T extends { id: string }>(xs: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of xs) out[x.id] = x;
  return out;
}

const W = worldCards as unknown as Record<WorldCategory, WorldCardDef[]> & { deckCounts: any };
const allWorld: WorldCardDef[] = (
  ["weather", "monster", "merchant", "rumor", "chaos", "escalation", "finale"] as WorldCategory[]
).flatMap((k) => W[k]);

export const Content = {
  rules: rules as typeof rules,
  cards: exploreCards as unknown as ExploreCard[],
  card: index(exploreCards as unknown as ExploreCard[]),
  missions: missions as unknown as MissionDef[],
  mission: index(missions as unknown as MissionDef[]),
  world: W,
  worldCard: index(allWorld),
  deckCounts: W.deckCounts as Record<string, Record<string, number>>,
  items: items as unknown as ItemDef[],
  item: index(items as unknown as ItemDef[]),
  companions: companions as unknown as CompanionDef[],
  companion: index(companions as unknown as CompanionDef[]),
  classes: classes as unknown as ClassDef[],
  cls: index(classes as unknown as ClassDef[]),
  species: species as unknown as SpeciesDef[],
  speciesById: index(species as unknown as SpeciesDef[]),
  fragments: fragments as unknown as FragmentDef[],
  fragment: index(fragments as unknown as FragmentDef[]),
  story: story as unknown as StoryText,
};

export interface StoryText {
  locations: Record<string, { options: Record<string, { success?: string; fail?: string; spark?: string; scene?: string }>; mishap: string | null }>;
  missions: Record<string, { opening: string; milestones: string[]; finale: string }>;
  world: Record<string, string>;
}

export type ContentT = typeof Content;

/** Classes whose passives the engine automates (actives are still text only). */
export const BUILT_CLASSES = Content.classes.filter((c) => c.status === "built").map((c) => c.id);
