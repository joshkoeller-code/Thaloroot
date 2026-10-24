"""Machine-readable conditions for all 51 missions.

The rules engine (packages/engine/src/missions.ts) evaluates these. The
vocabulary is documented in docs/mission-conditions.md. In short:

Milestones and finales are *event conditions*: they are checked whenever the
engine records a matching game event for the player, e.g.

    {"event": "success", "tags": ["swamp"], "minSkull": 2, "stats": ["charm"]}

Optional keys on an event condition:
    count / distinct   cumulative events this game (distinct by location|tag|stat)
    requires           player state when the event happens (after rewards)
    previousTurn       a condition the player's previous turn must have met
    cost               paid when the player declares a finale attempt

Flourishes are *end-of-game checks*: {"never": cond}, {"ever": cond},
{"end": state}, or {"all": [...]}.

Finale grace (one skull easier once all milestones are claimed) is applied by
the engine, not written into these conditions.
"""


def S(tags=None, minSkull=None, stats=None, **kw):
    d = {"event": "success"}
    if tags:
        d["tags"] = tags
    if minSkull:
        d["minSkull"] = minSkull
    if stats:
        d["stats"] = stats
    d.update(kw)
    return d


def E(event, **kw):
    d = {"event": event}
    d.update(kw)
    return d


def TR(*tags, minSkull=None):
    d = {"event": "treasure"}
    if tags:
        d["tags"] = list(tags)
    if minSkull:
        d["minSkull"] = minSkull
    return d


def BEF(*tags, count=None):
    d = {"event": "befriend"}
    if tags:
        d["tags"] = list(tags)
    if count:
        d["count"] = count
    return d


def REST(*tags, count=None):
    d = {"event": "rest"}
    if tags:
        d["tags"] = list(tags)
    if count:
        d["count"] = count
    return d


def MEET(choice):
    return {"event": "meetingChoice", "choice": choice}


def NEVER(c):
    return {"never": c}


def EVER(c):
    return {"ever": c}


def END(**state):
    return {"end": state}


def ALL(*xs):
    return {"all": list(xs)}


def ANY(*xs):
    return {"any": list(xs)}


def TURN(**state):
    return {"event": "turnStart", "requires": state}


F, M, SW, MT, R, C, P = "forest", "meadow", "swamp", "mountain", "ruins", "creature", "peril"

RULES = {
    # ------------------------------------------------------------- one skull
    "moth-queens-lullaby": dict(
        milestones=[S([M]), REST(count=2), BEF()],
        finale=S([M], stats=["charm"], requires={"minCompanions": 1}),
        flourish=NEVER(MEET("brawl"))),
    "the-rootkeepers-errand": dict(
        milestones=[S([F]), MEET("ally"), TR(R)],
        finale=S([F], 2, requires={"holdTreasureFrom": [R]}),
        flourish=EVER(E("lendAssist"))),
    "blue-ribbon-at-the-bloom-fair": dict(
        milestones=[TR(M), TR(F), E("buy")],
        finale=TURN(treasureCoinValue=12),
        flourish=END(minTreasures=4)),
    "the-frog-princes-pond": dict(
        milestones=[S([SW]), E("frog"), BEF(SW)],
        finale=S([SW], 2, ["charm"]),
        flourish=END(frog=True)),
    "mushroom-census": dict(
        milestones=[S([F]), S([SW]), S(stats=["wits"])],
        finale=S([F, SW], 2, ["wits"]),
        flourish={"never": E("push"), "until": "milestones"}),
    "the-shepherds-lost-flock": dict(
        milestones=[BEF(), BEF(count=2), S([M])],
        finale=S([M], 2, requires={"minCompanions": 2}),
        flourish=NEVER(E("companionFled"))),
    "the-merchants-debt": dict(
        milestones=[E("cashIn"), E("buy"), E("trade")],
        finale=TURN(minCoin=10),
        flourish=END(minCoin=15)),
    "picnic-on-the-hill": dict(
        milestones=[S([M]), S([MT]), REST(M, MT)],
        finale=S([MT], 2, requires={"healthAtTurnStart": "full"}),
        flourish=EVER(E("shareReward"))),
    "mudlarks-fortune": dict(
        milestones=[S([SW]), TR(SW), S([SW], stats=["brawn"])],
        finale=S([SW], 2, requires={"holdTreasureFrom": [SW, SW]}),
        flourish=NEVER(E("frog"))),
    "apprentices-first-spell": dict(
        milestones=[E("spark"), S(stats=["spark"]), E("lessonInstead", stat="spark")],
        finale=S(None, 2, ["spark"]),
        flourish=EVER(E("statGrowth", stat="spark"))),
    "the-couriers-parcel": dict(
        milestones=[S([F]), S([M]), S([SW])],
        finale=S([R], 2, requires={"maxItems": 2}),
        flourish=NEVER(E("stolenFrom"))),
    "trapwise-scout": dict(
        milestones=[E("springTrap"), E("setTrap"), S(atTrappedLocation=True)],
        finale=S(None, 2, sprangTrapThisTurn=True),
        flourish=ALL(EVER(E("springTrap", count=2)), NEVER(E("downed")))),
    "the-wandering-minstrels-ballad": dict(
        milestones=[MEET("ally"), MEET("brawl"), MEET("pass")],
        finale=S([M], 2, duringMeeting=True),
        flourish=ALL(EVER(E("lendAssist")), EVER(E("receiveAssist")))),
    "rootkeeper-initiate": dict(
        milestones=[REST(F), E("lessonInstead"), S([F], stats=["wits"])],
        finale=S([F], 2, noPush=True, noItem=True),
        flourish=NEVER(E("curseLocation"))),
    "little-lost-wisp": dict(
        milestones=[S([SW]), S([M]), E("gainSparkToken")],
        finale=S([M], 2, requires={"lightSource": True}),
        flourish=END(minSparkTokens=3)),
    "grumbleworts-birthday": dict(
        milestones=[BEF(), E("buy"), TR(SW)],
        finale=S([SW], 2, cost={"giveTreasure": 1}),
        flourish=END(minCompanions=1)),
    "hilltop-beacon": dict(
        milestones=[S([MT]), S(stats=["brawn"]), S(stats=["spark"])],
        finale=S([MT], 2, minStaminaSpent=3),
        flourish=NEVER(E("downed"))),
    # ------------------------------------------------------------- two skulls
    "the-drowned-kings-crown": dict(
        milestones=[TR(SW), BEF(), S([R])],
        finale=S([R], 2, requires={"holdAny": [{"item": "the-sunken-crown"}, {"treasureFrom": SW}]}),
        flourish=END(minTreasures=3)),
    "graftwrights-folly": dict(
        milestones=[S([R]), S([F]), E("lessonInstead")],
        finale=S([R, F], 2, requires={"holdTreasureFrom": [R, F]}),
        flourish=EVER(E("statGrowth"))),
    "wyrm-hunter": dict(
        milestones=[S([P]), E("winBrawl"), S([MT])],
        finale=E("defeatMonster"),
        flourish=NEVER(E("downed"))),
    "the-shadow-broker": dict(
        milestones=[E("trapSprungByRival"), E("steal"), E("learnTag")],
        finale=E("finalGuess", minCorrect=2),
        flourish=EVER(E("trapSprungByRival", count=2))),
    "ghost-of-the-gardeners-daughter": dict(
        milestones=[S([R]), TR(M), REST(R)],
        finale=S([R], 2, ["charm"], requires={"holdTreasureFrom": [M]}),
        flourish=NEVER(E("steal"))),
    "moonlit-heist": dict(
        milestones=[E("steal"), E("setTrap", trapType="pickpocket"), S([R], stats=["wits"])],
        finale=S([R], 2, requires={"minStolenItems": 1}),
        flourish=NEVER(E("stolenFrom"))),
    "seed-of-the-first-bloom": dict(
        milestones=[TR(M), S([F]), S([MT])],
        finale=S([M], 2, lessonInstead=True),
        flourish=NEVER(E("cashIn"))),
    "duel-at-dawn": dict(
        milestones=[MEET("brawl"), E("winBrawl"), E("surviveAmbush")],
        finale=E("winBrawl", minSkull=2),
        flourish=NEVER(E("setTrap"))),
    "the-cloud-kite-race": dict(
        milestones=[S([MT]), S(stats=["luck"]), S(previousTurn=S())],
        finale=S([MT], 3, ["luck"]),
        flourish=NEVER(E("rest"))),
    "the-witchs-shopping-list": dict(
        milestones=[TR(SW), TR(F), TR(M)],
        finale=S([SW], 2, cost={"discardTreasures": 2}),
        flourish=EVER(E("frog"))),
    "echoes-in-the-old-stones": dict(
        milestones=[S([R], stats=["wits"]), S([R], stats=["spark", "brawn"]), S([R], 2)],
        finale=S([R], 2, ["luck"]),
        flourish=NEVER(E("push", tags=[R]))),
    "the-rival-expedition": dict(
        milestones=[MEET("ally"), E("lendAssist"), E("learnTag")],
        finale=S(None, 2, teamUp=True),
        flourish=EVER(E("finalGuess", teamedUp=True))),
    "the-thistle-knights-oath": dict(
        milestones=[S([P]), E("heal"), S([M])],
        finale=S([P], 2, requires={"healthAtTurnStart": "halfOrLess"}),
        flourish=NEVER(E("steal"))),
    "collector-of-curiosities": dict(
        milestones=[E("buy"), BEF(), TR(minSkull=2)],
        finale=TURN(minItems=5),
        flourish=END(holdFragment=True)),
    "the-lost-graftwright": dict(
        milestones=[S([SW]), S([F]), E("seeHidden")],
        finale=S([R], 2, requires={"minCompanions": 1}),
        flourish=EVER(E("lendAssist"))),
    "stormchaser": dict(
        milestones=[S([P]), S([MT], stats=["spark"]), E("downedReturn")],
        finale=S([P], 3),
        flourish=EVER(S(minSixes=2))),
    "the-bramble-maze": dict(
        milestones=[S([F]), BEF(F), E("springTrap")],
        finale=S([F], 3, requires={"minCompanions": 1}),
        flourish=NEVER(E("downed"))),
    # ------------------------------------------------------------- three skulls
    "steal-the-dragons-hiccup": dict(
        milestones=[S([MT]), S([P], stats=["spark"]), S(None, 3)],
        finale=S([MT, P], 3, noPush=True, noAssist=True),
        flourish=NEVER(E("downed"))),
    "climb-the-great-thalowood": dict(
        milestones=[S([F], count=2, distinct="location"), TR(MT), S(None, 2, ["brawn"])],
        finale=S([F], 3, requires={"holdTreasureFrom": [MT]}),
        flourish=NEVER(E("setTrap"))),
    "taproot-whispers": dict(
        milestones=[TR(R), S([M]), E("seeHidden")],
        finale=S([R], 3, requires={"distinctSuccessTags": 5}),
        flourish=EVER(S(count=7, distinct="tag"))),
    "heir-of-the-gardener-kings": dict(
        milestones=[E("mishap"), S(pushed=True), S([SW], 2)],
        finale=S(None, 3, pushed=True),
        flourish=EVER(E("quirk"))),
    "the-sleeping-giants-dream": dict(
        milestones=[REST(count=2), E("seeHidden"), S([M], stats=["spark"])],
        finale=S([MT], 3, ["spark"], previousTurn=REST()),
        flourish=EVER(E("quirk"))),
    "heart-of-the-hollow-oak": dict(
        milestones=[S([F], 2, count=2, distinct="location"), BEF(F), E("lessonInstead")],
        finale=S([F], 3, requires={"minCompanions": 2}),
        flourish=NEVER(E("companionFled"))),
    "king-of-thieves": dict(
        milestones=[E("steal", count=2), E("trapSprungByRival", trapType="pickpocket"), E("winBrawl", asAmbusher=True)],
        finale=TURN(minStolenItems=3),
        flourish=NEVER(E("stolenFrom"))),
    "the-great-wyrms-lair": dict(
        milestones=[S([P]), S([R]), S([MT], 3)],
        finale=S([P], 3, ["brawn"], minNeed=3),
        flourish=NEVER(E("receiveAssist"))),
    "the-last-gardener-kings-vault": dict(
        milestones=[TR(R, minSkull=2), E("seeHidden"), TURN(minCoin=10)],
        finale=S([R], 3, cost={"coin": 10}),
        flourish=END(minTreasures=3)),
    "champion-of-the-bloom": dict(
        milestones=[E("winBrawl"), S(None, 3), S(count=4, distinct="tag")],
        finale=S(None, 3, requires={"noRivalFinished": True}),
        flourish=NEVER(E("downed"))),
    "the-mirror-bog": dict(
        milestones=[E("frog"), E("springTrap"), S([SW], 2, ["wits"])],
        finale=S([SW], 3, withMishap=True),
        flourish=EVER(E("quirk"))),
    "thal-diviner": dict(
        milestones=[E("spark", count=3), E("lesson", count=2, distinct="stat"), E("seeHidden")],
        finale=S(None, 3, previousTurn=S(None, 3)),
        flourish=EVER(E("statGrowth"))),
    "the-rootkeepers-last-stand": dict(
        milestones=[MEET("ally"), E("lendAssist", count=2), S([F], 3)],
        finale=S(None, 3, teamUp=True),
        flourish=NEVER(E("steal"))),
    "frostroot-peak": dict(
        milestones=[S([MT]), S([MT], 2), S([MT], stats=["brawn"])],
        finale=S([MT], 2, requires={"maxStaminaAtTurnStart": 3}),
        flourish=NEVER(E("rest"))),
    "the-thalowood-keepers-riddle": dict(
        milestones=[S(stats=["wits"], count=3, distinct="tag"), E("seeHidden"), E("learnTag")],
        finale=S(None, 3, ["wits"], minNeed=3),
        flourish=EVER(E("finalGuess", minCorrect=3))),
    "feast-of-the-bloom": dict(
        milestones=[TR(M), TR(F), TR(SW)],
        finale=S(None, 3, cost={"giveTreasureEachRival": True}),
        flourish=NEVER(E("steal"))),
    "seal-the-grafted-gate": dict(
        milestones=[S([R], 3), S([P], stats=["spark"]), E("lessonInstead")],
        finale=ANY(S([R], 3, previousTurn=S([P], 3)), S([P], 3, previousTurn=S([R], 3))),
        flourish=NEVER(E("push"))),
}
