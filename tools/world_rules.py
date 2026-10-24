"""World cards: text from content/source/world-cards.md, machine effects here."""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "content", "source", "world-cards.md")


def slug(s):
    s = s.lower().replace("'", "")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


DECK_COUNTS = {
    "quick": dict(worldCards=15, weather=3, monster=2, merchant=2, rumor=2, chaos=3, escalation=2, finaleCountdown=3),
    "standard": dict(worldCards=20, weather=4, monster=3, merchant=3, rumor=3, chaos=4, escalation=2, finaleCountdown=5),
    "long": dict(worldCards=25, weather=5, monster=4, merchant=3, rumor=4, chaos=5, escalation=3, finaleCountdown=7),
}

# Machine effects. Durations: instant | round | untilNext | untilClaimed | restOfGame
WEATHER = {
    "Moonrise": dict(night=True, mods=[{"kind": "dice", "stat": "spark", "amount": 1}, {"kind": "hideOneSkullMystery"}]),
    "The Long Night": dict(night=True, mods=[{"kind": "monsterDamage", "amount": 1},
                                             {"kind": "dice", "amount": 1, "requiresLight": True}]),
    "The Eclipse": dict(night=True, mods=[{"kind": "sparkTokenDouble"}]),
    "Thal Fog": dict(mods=[{"kind": "teaserNameOnly"}]),
    "Gentle Rain": dict(mods=[{"kind": "restStamina", "amount": 2}, {"kind": "dice", "tags": ["swamp"], "amount": 1},
                              {"kind": "dice", "tags": ["mountain"], "amount": -1}]),
    "Heat Shimmer": dict(mods=[{"kind": "stamina", "stat": "brawn", "amount": 1},
                               {"kind": "classHeat", "cls": "cinder-heart-pyromancer", "amount": 1}]),
    "Thunderstorm": dict(mods=[{"kind": "need", "tags": ["mountain", "peril"], "amount": 1},
                               {"kind": "dice", "amount": 1, "classes": ["rain-barrel-tidecaller", "kite-riding-windcaller"]}]),
    "Golden Dawn": dict(instant=[{"type": "stamina", "amount": 2}, {"type": "heal", "amount": 1}]),
    "Pollen Breeze": dict(mods=[{"kind": "sparkOnFive", "tags": ["meadow"]}]),
    "First Frost": dict(mods=[{"kind": "stamina", "tags": ["swamp"], "amount": -1},
                              {"kind": "stamina", "tags": ["mountain"], "amount": 1}]),
    "Windy Day": dict(mods=[{"kind": "teasers", "count": 3},
                            {"kind": "dice", "amount": 2, "classes": ["kite-riding-windcaller"]}]),
    "Thal Tide": dict(mods=[{"kind": "treasureBonus", "coin": 2, "vp": 1}]),
}

MONSTERS = {
    "The Pickle Wyrm": dict(hunts="mostCoin", options=[
        {"name": "Fight", "stat": "brawn", "need": 3, "defeats": True},
        {"name": "Bribe", "pay": {"coin": 3}},
        {"name": "Flee", "effects": [{"type": "loseStamina", "amount": 2}]}],
        reward=[{"type": "item", "item": "wyrm-scale"}]),
    "The Gloomhound": dict(hunts="mostItems", options=[
        {"name": "Fight", "stat": "brawn", "need": 2, "defeats": True},
        {"name": "Tame", "stat": "charm", "need": 2, "defeats": True, "reward": [{"type": "companion", "companion": "gloomhound"}]},
        {"name": "Flee", "effects": [{"type": "loseRandomItem"}]}],
        reward=[{"type": "item", "item": "moonfang"}]),
    "The Bog Troll King": dict(hunts="pickedSwamp", options=[
        {"name": "Fight", "stat": "brawn", "need": 3, "defeats": True},
        {"name": "Pay the Toll", "pay": {"coin": 2}},
        {"name": "Answer His Riddle", "stat": "wits", "need": 2, "onFail": [{"type": "loseStamina", "amount": 1}]}],
        reward=[{"type": "item", "item": "troll-kings-club"}]),
    "The Mimic Chest": dict(hunts="nextTreasure", options=[
        {"name": "Fight", "stat": "brawn", "need": 2, "defeats": True, "onFail": [{"type": "loseFoundTreasure"}]},
        {"name": "Give It Up", "effects": [{"type": "loseFoundTreasure"}]}],
        reward=[{"type": "coin", "amount": 8}]),
    "A Swarm of Sprites": dict(hunts="mostItems", rounds=2, scatter={"stat": "spark", "need": 2}, options=[
        {"name": "Swat", "stat": "luck", "need": 2, "defeats": True},
        {"name": "Pay a Spark token", "pay": {"sparkTokens": 1}},
        {"name": "Lose an item", "effects": [{"type": "loseRandomItem"}]}],
        reward=[{"type": "sparkTokens", "amount": 2}]),
    "The Hollow Knight": dict(hunts="pickedRuins", options=[
        {"name": "Duel", "stat": "brawn", "need": 3, "defeats": True, "onFail": [{"type": "damage", "amount": 2}]},
        {"name": "Find Its Weak Point", "stat": "wits", "need": 2, "defeats": True, "onFail": [{"type": "damage", "amount": 2}]}],
        reward=[{"type": "item", "item": "hollow-helm"}]),
    "The Thornback Matriarch": dict(hunts="mostCompanions", options=[
        {"name": "Fight", "stat": "brawn", "need": 3, "defeats": True},
        {"name": "Calm", "stat": "charm", "need": 3, "defeats": True},
        {"name": "Flee", "effects": [{"type": "companionFlees"}]}],
        reward=[{"type": "item", "item": "matriarchs-claw"}]),
    "The Stormcrow Flock": dict(hunts="pickedMountainOrPeril", rounds=2, scatter={"stat": "spark", "need": 2}, options=[
        {"name": "Lose 1 stamina", "effects": [{"type": "loseStamina", "amount": 1}]},
        {"name": "Read Their Flight", "stat": "wits", "need": 2, "onSuccess": [{"type": "peekWorld", "count": 1}],
         "onFail": [{"type": "loseStamina", "amount": 1}]}],
        reward=[{"type": "item", "item": "stormcrow-feather"}]),
    "The Hungry Mist": dict(hunts="highestSkull", options=[
        {"name": "Fight", "stat": "spark", "need": 3, "defeats": True},
        {"name": "Flee", "effects": [{"type": "damage", "amount": 2}]}],
        reward=[{"type": "item", "item": "mist-pearl"}]),
}
# Fight options without onFail: losing falls back to the monster's last (flee) option.

MERCHANTS = {
    "Mrs. Pennywhistle's Rolling Shop": dict(stock={"random": 3, "rare": 1}),
    "The Mudlark Barge": dict(stock={"common": 3}, buysTreasureBonus=2),
    "The Graftwright Tinker": dict(trade={"give": {"treasures": 2}, "get": {"randomRare": 1}}),
    "The Rootkeeper Exchange": dict(trade={"give": {"treasures": 1}, "get": {"lessons": 2}}),
    "Old Nan's Pie Cart": dict(stock={"food": 3}, price=2, sleepyOn=[1]),
    "The Shadow Market": dict(services=[{"buy": "learnRivalTag", "coin": 3}, {"buy": "learnTrapSetter", "coin": 5},
                                        {"buy": "permanentTrap", "coin": 6}]),
    "The Traveling Auction": dict(auction={"randomRare": 1}),
}

RUMORS = {
    "Whispers of Gold": dict(claim={"event": "success", "tags": ["ruins"]}, reward=[{"type": "randomTreasure"}]),
    "The Bog Is Burping": dict(claim={"event": "success", "tags": ["swamp"]},
                               reward=[{"type": "item", "item": "bog-pearl"}, {"type": "item", "item": "bog-pearl"}]),
    "Stars on the Mountain": dict(claim={"event": "success", "tags": ["mountain"]}, reward=[{"type": "item", "item": "star-shard"}]),
    "A Map Fragment": dict(claim={"event": "success", "minSkull": 3}, reward=[{"type": "randomRare"}]),
    "The Lost Lamb": dict(claim={"event": "befriend"}, reward=[{"type": "coin", "amount": 6}]),
    "A Hermit Is Recruiting": dict(claim={"event": "lessonInstead"}, reward=[{"type": "lessons", "amount": 2, "stat": "any"}]),
    "A Purse for a Brawler": dict(claim={"event": "winBrawl"}, reward=[{"type": "coin", "amount": 5}]),
    "The Fairies Are Dancing": dict(claim={"event": "roll", "minSixes": 2}, reward=[{"type": "item", "item": "fairy-charm"}]),
    "A Ghost Wants Company": dict(claim={"event": "rest", "tags": ["ruins"]}, reward=[{"type": "item", "item": "ghostly-locket"}]),
    "Taproot Tremors": dict(claim={"event": "success", "tags": ["forest"], "minSkull": 3},
                            reward=[{"type": "chance", "faces": [6], "then": [{"type": "fragment"}]}]),
}

CHAOS = {
    "Frog Rain": dict(instant=[{"type": "chanceEach", "faces": [1], "then": [{"type": "frog"}]}],
                      classImmune={"toadstool-witch": [{"type": "lessons", "amount": 1, "stat": "any"}]}),
    "Pass It On": dict(mods=[{"kind": "passCardsLeft"}]),
    "Gravity Hiccup": dict(mods=[{"kind": "dice", "stat": "brawn", "amount": -1}, {"kind": "dice", "stat": "spark", "amount": 1}]),
    "The Giggles": dict(instant=[{"type": "chanceEach", "faces": [1, 2], "then": [{"type": "forcePassThisRound"}]}]),
    "Squirrel Heist": dict(instant=[{"type": "squirrelStash"}], claim={"event": "success", "tags": ["forest"]},
                           reward=[{"type": "takeStash"}]),
    "Shoe Swap": dict(instant=[{"type": "passRandomItemLeft"}]),
    "Bloom Burst": dict(instant=[{"type": "sparkTokens", "amount": 1}, {"type": "coin", "amount": 2}]),
    "Talking Animals": dict(instant=[{"type": "ifCompanion", "then": [{"type": "learnRivalTag"}]}]),
    "The Wandering Door": dict(altExplore={"stat": "luck", "need": 2, "success": [{"type": "randomRare"}],
                                           "fail": [{"type": "skipExplore"}]}),
    "Backwards Day": dict(mods=[{"kind": "reverseOrder"}]),
    "Thal Hiccup": dict(mods=[{"kind": "gearOff"}]),
    "Festival of Lanterns": dict(instant=[{"type": "festival", "withLight": 3, "without": 1}]),
}

ESCALATIONS = {
    "The Sky Cracks": dict(finale="The Sky Falls", mods=[{"kind": "treasureBonus", "vp": 1}, {"kind": "stamina", "amount": 1}]),
    "The Dragon Stirs": dict(finale="The Dragon Wakes", mods=[{"kind": "monsterNeed", "amount": 1}]),
    "Masks Appear": dict(finale="The Midnight Masquerade", mods=[{"kind": "hiddenMeetings"}]),
    "The Roots Tremble": dict(finale="The Taproot Wakes", mods=[{"kind": "treasureBonus", "vp": 1, "minSkull": 3}]),
    "The Gardener-Kings Stir": dict(finale="The Last Court", mods=[{"kind": "need", "tags": ["ruins"], "amount": 1},
                                                                    {"kind": "treasureBonus", "vp": 2, "tags": ["ruins"]}]),
    "The Bloom Peaks": dict(finale="The Great Harvest", mods=[{"kind": "successCoin", "amount": 1}]),
}

FINALES = {
    "The Sky Falls": dict(final=[{"kind": "successItem", "item": "fallen-star"}]),
    "The Dragon Wakes": dict(final=[{"kind": "boss", "stats": ["brawn", "spark"], "vpPerSuccess": 1, "killBonus": 5}]),
    "The Midnight Masquerade": dict(final=[{"kind": "guessMultiplier", "amount": 2}]),
    "The Taproot Wakes": dict(final=[{"kind": "taprootReach", "stat": "spark", "need": 4, "stamina": "all", "vp": 8}]),
    "The Last Court": dict(final=[{"kind": "lastCourt", "top": 6, "others": 2}]),
    "The Great Harvest": dict(final=[{"kind": "doubleRewards"}]),
    "The Bloom Fades": dict(general=True, final=[{"kind": "restoreAllStamina"}]),
    "Last Light": dict(general=True, final=[{"kind": "lightVp", "amount": 2}]),
    "The Grand Bazaar": dict(general=True, final=[{"kind": "market", "stock": {"rare": 2}}]),
}

DURATIONS = {"Instant": "instant", "This round": "round", "Until the next World card": "untilNext",
             "Until claimed": "untilClaimed", "Rest of game": "restOfGame"}


def rows(md, heading):
    i = md.index(heading)
    out, started = [], False
    for line in md[i:].splitlines()[1:]:
        if line.startswith("#") or (started and not line.startswith("|")):
            break
        if line.startswith("| ") and not line.startswith("| ---"):
            started = True
            out.append([c.strip() for c in line.strip().strip("|").split("|")])
    return out[1:]


def clean(s):
    return s.replace("**", "").strip("* ").strip()


def build():
    md = open(SRC).read()
    out = {"deckCounts": DECK_COUNTS}

    w = []
    for name, dur, flavor, text in rows(md, "### Weather and Time"):
        night = "(Night)" in name
        n = name.replace(" (Night)", "")
        spec = WEATHER[n]
        w.append(dict(id=slug(n), name=n, category="weather", night=night, duration=DURATIONS[dur],
                      flavor=clean(flavor), text=text, **{k: v for k, v in spec.items() if k != "night"}))
    out["weather"] = w

    mo = []
    for name, hunts, opts, reward in rows(md, "### Monsters"):
        m = re.match(r"\*\*(.+?)\*\* \*\((.*)\)\*", name)
        n, flavor = m.group(1), m.group(2)
        spec = MONSTERS[n]
        mo.append(dict(id=slug(n), name=n, category="monster", duration="rounds", rounds=spec.get("rounds", 3),
                       flavor=flavor, huntsText=hunts, optionsText=opts, rewardText=reward,
                       **{k: v for k, v in spec.items() if k != "rounds"}))
    out["monster"] = mo

    me = []
    for name, dur, flavor, text in rows(md, "### Merchants"):
        me.append(dict(id=slug(name), name=name, category="merchant", duration=DURATIONS[dur], flavor=clean(flavor),
                       text=text, **MERCHANTS[name]))
    out["merchant"] = me

    ru = []
    for name, flavor, who, reward in rows(md, "### Rumors"):
        ru.append(dict(id=slug(name), name=name, category="rumor", duration="untilClaimed", flavor=clean(flavor),
                       text=f"{who}: {reward}", **RUMORS[name]))
    out["rumor"] = ru

    ch = []
    for name, dur, flavor, text in rows(md, "### Chaos"):
        ch.append(dict(id=slug(name), name=name, category="chaos", duration=DURATIONS[dur], flavor=clean(flavor),
                       text=text, **CHAOS[name]))
    out["chaos"] = ch

    es, fi = [], []
    for esc, fin in rows(md, "## Choosing the finale"):
        en, et = re.match(r"\*\*(.+?):\*\* (.*)", esc).groups()
        fn, ft = re.match(r"\*\*(.+?):\*\* (.*)", fin).groups()
        es.append(dict(id=slug(en), name=en, category="escalation", duration="restOfGame", text=et, **ESCALATIONS[en]))
        fi.append(dict(id=slug(fn), name=fn, category="finale", text=ft, matches=en, **FINALES[fn]))
    for fn, ft in rows(md, "**General finales**"):
        n = clean(fn)
        fi.append(dict(id=slug(n), name=n, category="finale", text=ft, **FINALES[n]))
    out["escalation"] = es
    out["finale"] = fi

    expect = dict(weather=12, monster=9, merchant=7, rumor=10, chaos=12, escalation=6, finale=9)
    for k, v in expect.items():
        assert len(out[k]) == v, (k, len(out[k]))
    return out
