#!/usr/bin/env python3
"""Build content/*.json from the design-doc exports in content/source/.

    python3 tools/build_content.py           # writes content/*.json
    python3 tools/build_content.py --check   # also cross-checks against the
                                             # Playtest 4 simulator encoding

Explore cards are parsed from explore-cards.md, missions from missions.html
(text) plus tools/mission_rules.py (machine conditions). Items, classes,
species and companions come from tools/authored.py.
"""
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "content", "source")
OUT = os.path.join(ROOT, "content")
sys.path.insert(0, HERE)

import authored  # noqa: E402
import mission_rules  # noqa: E402

WARNINGS = []


def warn(msg):
    WARNINGS.append(msg)


def slug(s):
    s = s.lower().replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


STATS = {"brawn": "brawn", "wits": "wits", "charm": "charm", "spark": "spark", "luck": "luck"}
REGIONS = ["forest", "meadow", "swamp", "mountain", "ruins"]
NUM = {"one": 1, "two": 2, "three": 3, "a": 1, "an": 1, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6}
SKULLS = {"One skull": 1, "Two skulls": 2, "Three skulls": 3}

# ---------------------------------------------------------------------------
# Items / companions lookup
# ---------------------------------------------------------------------------

ITEMS = []
for it in authored.ITEMS:
    d = dict(it)
    d["id"] = slug(d["name"])
    ITEMS.append(d)
ITEM_BY_ID = {i["id"]: i for i in ITEMS}
ITEM_NAMES = sorted(((i["name"], i["id"]) for i in ITEMS), key=lambda x: -len(x[0]))

COMPANIONS = []
for c in authored.COMPANIONS:
    d = dict(c)
    d["id"] = slug(d["name"])
    COMPANIONS.append(d)
COMP_ALIASES = {
    "old mossback": "old-mossback", "bramble hare": "bramble-hare", "judge owlbeard": "judge-owlbeard",
    "thornback bear": "thornback-bear", "buzzbelle": "buzzbelle", "gilly": "gilly", "moon moth": "moon-moth",
    "grumblewort": "grumblewort", "wisp": "wisp", "sir croaksworth": "sir-croaksworth",
    "prince ribbon": "prince-ribbon", "captain snapjaw": "captain-snapjaw", "gulp": "gulp",
    "biscuit": "biscuit-the-goat", "marmot": "marmot", "pebble": "pebble", "wyrmling": "wyrmling",
    "hedge hound": "hedge-hound",
}

# ---------------------------------------------------------------------------
# Effect text -> effect objects
# ---------------------------------------------------------------------------


def find_items(text):
    """Return item ids named in text, in order, honoring 'a second X'."""
    found = []
    t = text
    while True:
        best = None
        for name, iid in ITEM_NAMES:
            m = re.search(re.escape(name), t, re.I)
            if m and (best is None or m.start() < best[0].start() or
                      (m.start() == best[0].start() and len(name) > len(best[1]))):
                best = (m, name, iid)
        if not best:
            break
        m, name, iid = best
        found.append(iid)
        t = t[:m.start()] + " " * len(name) + t[m.end():]
    return found


def parse_clause(c, ctx):
    """Parse one clause into a list of effect objects (may be empty)."""
    c = c.strip().rstrip(".").strip()
    low = re.sub(r"\([^()]*\)", "", c).lower()
    low = re.sub(r"\s+", " ", low).strip()
    low = re.sub(r"^(also|then|and)\s+", "", low)
    out = []
    if not low or low in ("nothing", "nothing happens", "you lose the bet", "a free ride") or low.startswith("it keeps your treasure"):
        return out

    # chance: "Roll 1 die: on a 1, you're a frog..."
    m = re.match(r"roll 1 die: on an? (\d(?: or \d)?)(?:,| )\s*(.*)", low)
    if m:
        faces = [int(x) for x in re.findall(r"\d", m.group(1))]
        inner = parse_text(m.group(2), ctx)
        return [dict(type="chance", faces=faces, then=inner)]
    m = re.match(r"you may bet (\d+) coin and roll 1 die: on an? (\d) or (\d), gain (\d+) coin", low)
    if m:
        return [dict(type="bet", cost=int(m.group(1)), faces=[int(m.group(2)), int(m.group(3))],
                     then=[dict(type="coin", amount=int(m.group(4)))])]

    # quirks
    m = re.search(r"permanent quirk, ([\w\-' ]+?) \((.*)\)", c)
    if m:
        out.append(dict(type="quirk", name=m.group(1).strip(), text=m.group(2), quirk=parse_quirk(m.group(2))))
        rest = c[:m.start()].lower()
        if "lose 3 health" in rest:
            out.insert(0, dict(type="damage", amount=3))
        return out

    if "taproot fragment" in low:
        return [dict(type="fragment")]
    if "sunken crown" in low:
        if "drowned reliquary" in low:
            return [dict(type="item", item="the-sunken-crown", ifTaken="drowned-reliquary")]
        return [dict(type="item", item="the-sunken-crown", ifTaken=None)]

    # companions
    m = re.search(r"befriend (?:the |a |an )?([\w' ]+?)(?:,| \(|$)", low)
    if m or "the wisp stays" in low:
        name = "wisp" if not m else m.group(1).strip()
        cid = COMP_ALIASES.get(name) or COMP_ALIASES.get(name.split(" the ")[0]) or COMP_ALIASES.get(name.split()[0])
        if not cid:
            warn(f"{ctx}: unknown companion '{name}'")
        out.append(dict(type="companion", companion=cid))
        return out

    # coin
    m = re.search(r"(?:gain|find) (\d+) (?:more )?coin", low) or re.search(r"for (\d+) coin", low) \
        or re.search(r"plus (\d+) coin", low) or re.search(r"worth (\d+) coin", low)
    coin_gain = int(m.group(1)) if m else 0
    if not coin_gain:
        m = re.search(r"(?<!lose )(?<!pay )(?<!bet )(?<!eats )\b(\d+) coin\b", low)
        coin_gain = int(m.group(1)) if m else 0
    m2 = re.search(r"(?:lose|eats) (\d+)(?: of your)? coin", low)

    items = find_items(c)
    if re.search(r"a second ", low) and items:
        items = items[:1]
    for iid in items:
        if iid == "taproot-fragment":
            continue
        out.append(dict(type="item", item=iid))

    if coin_gain:
        out.append(dict(type="coin", amount=coin_gain))
    if m2:
        out.append(dict(type="coin", amount=-int(m2.group(1))))

    # lessons
    for m in re.finditer(r"(\d+) lessons? in (any one stat|any stat|one stat|\w+)", low):
        st = m.group(2)
        stat = "any" if st in ("any one stat", "any stat", "one stat") else STATS.get(st)
        if stat is None:
            warn(f"{ctx}: lesson stat '{st}'")
        out.append(dict(type="lessons", amount=int(m.group(1)), stat=stat))
    m = re.search(r"gain (\d+) lessons instead", low)
    if m:
        out.append(dict(type="lessons", amount=int(m.group(1)), stat="any", replaces=True))

    # health / stamina
    if re.search(r"restore all health and all stamina|restore all health and stamina", low):
        out += [dict(type="heal", amount="all"), dict(type="stamina", amount="all")]
    else:
        if re.search(r"restore all stamina", low):
            out.append(dict(type="stamina", amount="all"))
        if re.search(r"restore all health", low):
            out.append(dict(type="heal", amount="all"))
        for m in re.finditer(r"restore (\d+) (stamina|health)(?: and (\d+) (stamina|health))?", low):
            out.append(dict(type="stamina" if m.group(2) == "stamina" else "heal", amount=int(m.group(1))))
            if m.group(3):
                out.append(dict(type="stamina" if m.group(4) == "stamina" else "heal", amount=int(m.group(3))))
        m = re.search(r"restore (?:all health and )?(\d+) stamina", low)
        if m and "restore all health and" in low:
            out.append(dict(type="stamina", amount=int(m.group(1))))
        m = re.search(r"and (\d+) health", low)
        if m and "restore" in low and not any(e["type"] == "heal" for e in out):
            out.append(dict(type="heal", amount=int(m.group(1))))

    for m in re.finditer(r"(?:gain|and|plus) (\d+) spark tokens?", low):
        out.append(dict(type="sparkTokens", amount=int(m.group(1))))
    if re.match(r"(?:gain )?1 spark token$", low) and not any(e["type"] == "sparkTokens" for e in out):
        out.append(dict(type="sparkTokens", amount=1))

    for m in re.finditer(r"lose (\d+) health", low):
        out.append(dict(type="damage", amount=int(m.group(1))))
    for m in re.finditer(r"lose \d+ health and (\d+) stamina", low):
        out.append(dict(type="loseStamina", amount=int(m.group(1))))
    if re.search(r"lose \d+ health and a random item", low):
        out.append(dict(type="loseRandomItem"))
    for m in re.finditer(r"lose (\d+) stamina", low):
        out.append(dict(type="loseStamina", amount=int(m.group(1))))
    if re.search(r"(?:take|takes|swallows|eats|steals|grabs|lose) a random item", low) and "rival holding" not in low:
        out.append(dict(type="loseRandomItem"))
    if "you're a frog" in low:
        out.append(dict(type="frog"))

    # information
    if "learn one tag from" in low or "whispers one tag" in low or "tell you one tag" in low or \
            "tells you one tag" in low or "learn one tag" in low:
        out.append(dict(type="learnRivalTag"))
    if "a random rival learns one tag from your mission" in low:
        out.append(dict(type="revealOwnTag"))
    m = re.search(r"see the next (\d+ )?world cards?", low)
    if m:
        out.append(dict(type="peekWorld", count=int(m.group(1)) if m.group(1) else 1))
    if "shows you the next world card" in low:
        out.append(dict(type="peekWorld", count=1))
    m = re.search(r"see the full card behind (?:both teasers|every teaser)(?: you draw)?(?: for your next (\d+) turns| next turn)", low)
    if m:
        out.append(dict(type="peekTeasers", turns=int(m.group(1)) if m.group(1) else 1))
    if re.search(r"draw 3 teasers next turn", low):
        out.append(dict(type="teasersNextTurn", count=3))
    if re.search(r"see only 1 teaser next turn", low):
        out.append(dict(type="teasersNextTurn", count=1))

    # misc
    if "skip your next explore" in low:
        out.append(dict(type="skipExplore", keepItems=True))
    m = re.search(r"add 1 trouble die to your next (\d+ )?rolls?", low)
    if m:
        out.append(dict(type="trouble", amount=1, rolls=int(m.group(1)) if m.group(1) else 1))
    if "lose your quick action" in low:
        out.append(dict(type="loseQuickAction"))
    if "set a trap on any location name for 0 stamina" in low:
        out.append(dict(type="freeTrap"))
    if "take a random item from the rival holding the most items" in low:
        out.append(dict(type="stealFromMostItems"))
    if "rivals can't target you" in low:
        out.append(dict(type="untargetable"))
    if "costs you 2 health" in low:
        out.append(dict(type="damage", amount=2))
    return out


def parse_quirk(text):
    q = []
    for m in re.finditer(r"([+-]\d) die on (\w+)(?: rolls)?(?: at (\w+) locations)?", text):
        if m.group(2).lower() == "any":
            continue
        stat = STATS.get(m.group(2).lower())
        tag = m.group(3).lower() if m.group(3) else None
        q.append(dict(kind="dice", amount=int(m.group(1)), stat=stat, tags=[tag] if tag else None))
    m = re.search(r"([+-]\d) die on any roll at a (\w+) location", text)
    if m:
        q.append(dict(kind="dice", amount=int(m.group(1)), stat=None, tags=[m.group(2).lower()]))
    return q


def split_clauses(text):
    # protect parentheses
    depth, buf, parts = 0, "", []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == ";" and depth == 0:
            parts.append(buf)
            buf = ""
        else:
            buf += ch
    parts.append(buf)
    out = []
    for p in parts:
        # split ", and " / " and " at top level when followed by a verb
        out += re.split(r",? and (?=(?:see|draw|gain|restore|learn|rivals|you're|lose)\b)", p)
    return [p for p in out if p.strip()]


def parse_text(text, ctx):
    # A chance ("Roll 1 die: on a 1, ...") applies to the rest of its sentence.
    text = re.sub(r",? then (roll 1 die:)", r". Roll 1 die:", text)
    effs = []
    for sent in re.split(r"(?<=\.) (?=[A-Z])", text):
        if re.match(r"(?i)roll 1 die:|you may bet", sent.strip()):
            effs += parse_clause(sent, ctx)
            continue
        for cl in split_clauses(sent):
            effs += parse_clause(cl, ctx)
    return effs


# ---------------------------------------------------------------------------
# Explore cards
# ---------------------------------------------------------------------------

OPT_RE = re.compile(r"^- \*\*(.+?)\*\* \((.*?)\)\. (.*)$")


def parse_head(head):
    """'Charm, 1 success, 1 stamina; Bramblebeast Tamer +2 dice' and variants."""
    o = dict(stats=[], need=0, stamina=0, rest=False, pay=None, discardTreasure=False, classBonus=None)
    parts = head.split(";")
    if len(parts) > 1:
        m = re.match(r"\s*(.+?) \+(\d) dice", parts[1])
        o["classBonus"] = dict(cls=slug(m.group(1)), dice=int(m.group(2)))
    h = parts[0]
    m = re.match(r"pay (\d+) coin, (?:then )?", h)
    if m:
        o["pay"] = int(m.group(1))
        h = h[m.end():]
    if h.startswith("discard a treasure, "):
        o["discardTreasure"] = True
        h = h[len("discard a treasure, "):].removeprefix("then ")
    if h.strip() == "no roll":
        o["rest"] = True
        return o
    m = re.match(r"(.+?), (\d) success(?:es)?, (\d) stamina", h)
    if not m:
        raise ValueError(head)
    o["stats"] = [STATS[s.strip().lower()] for s in m.group(1).split(" or ")]
    o["need"] = int(m.group(2))
    o["stamina"] = int(m.group(3))
    return o


def parse_results(body, ctx):
    res = {"success": None, "fail": None, "spark": None, "sparkNeeds": 1}
    # Rest options have no labels
    if not body.startswith("Success:"):
        res["success"] = body.strip()
        return res
    m = re.match(r"Success: (.*?)(?: Fail: (.*?))?(?: Spark( \(two or more 6s\))?: (.*))?$", body)
    if not m:
        raise ValueError(body)
    res["success"], res["fail"], res["spark"] = m.group(1), m.group(2), m.group(4)
    if m.group(3):
        res["sparkNeeds"] = 2
    return res


def build_cards():
    md = open(os.path.join(SRC, "explore-cards.md")).read().splitlines()
    cards, cur = [], None
    for i, line in enumerate(md):
        if line.startswith("### "):
            cur = dict(name=line[4:].strip(), options=[], mishap=None)
            cards.append(cur)
            continue
        if cur is None:
            continue
        if " · " in line and "tags" not in cur:
            bits = line.split(" · ")
            tags = [t.strip().lower() for t in bits[0].split(",")]
            cur["tags"] = tags
            cur["region"] = next(t for t in tags if t in REGIONS)
            cur["skull"] = SKULLS[bits[1].strip()]
            cur["copies"] = int(bits[2].split()[0]) if len(bits) > 2 else 1
            continue
        m = re.match(r"^\*Teaser: (.*?)\*\s*(.*)$", line)
        if m:
            cur["teaser"], cur["flavor"] = m.group(1), m.group(2)
            continue
        if line.startswith("- **Mishap:**"):
            t = line[len("- **Mishap:**"):].strip()
            cur["mishap"] = dict(text=t, effects=parse_text(t, cur["name"] + " mishap"))
            continue
        m = OPT_RE.match(line)
        if m and "tags" in cur:
            name, head, body = m.groups()
            ctx = f"{cur['name']} / {name}"
            o = dict(name=name, **parse_head(head))
            r = parse_results(body, ctx)
            o["text"] = dict(success=r["success"], fail=r["fail"], spark=r["spark"])
            o["sparkNeeds"] = r["sparkNeeds"]
            o["success"] = parse_text(r["success"], ctx) if r["success"] else []
            o["fail"] = parse_text(r["fail"], ctx) if r["fail"] else []
            o["spark"] = parse_text(r["spark"], ctx) if r["spark"] else []
            o["kind"] = option_kind(name, o)
            cur["options"].append(o)
    cards = [c for c in cards if c.get("options")]
    for c in cards:
        c["id"] = slug(c["name"])
        for o in c["options"]:
            for k in ("success", "fail", "spark"):
                if o["text"][k] and o["text"][k].lower() not in ("nothing", "nothing happens", "nothing happens.") \
                        and not o[k] and "you lose the bet" not in o["text"][k] and "free ride" not in o["text"][k] \
                        and "nothing" not in o["text"][k].lower():
                    warn(f"{c['name']} / {o['name']}: no effects parsed from {k}: {o['text'][k]!r}")
    return [order_card(c) for c in cards]


def option_kind(name, o):
    n = name.lower()
    if o["rest"]:
        return "rest"
    if re.search(r"\bdig\b|\bmine\b|\bpan\b|dive", n):
        return "dig"
    if re.search(r"climb|joust|wrestle|fight|lift|rip|hold", n):
        return "climb"
    if any(e["type"] == "companion" for e in o["success"]):
        return "befriend"
    return "explore"


def order_card(c):
    keys = ["id", "name", "region", "tags", "skull", "copies", "teaser", "flavor", "mishap", "options"]
    return {k: c.get(k) for k in keys}


# ---------------------------------------------------------------------------
# Missions
# ---------------------------------------------------------------------------


def build_missions():
    s = open(os.path.join(SRC, "missions.html")).read()
    parts = re.split(r"(<h[23][^>]*>.*?</h[23]>)", s)
    glance = {}
    gm = re.search(r'id="at-a-glance".*?<table>(.*?)</table>', s, re.S)
    for row in re.findall(r"<tr>(.*?)</tr>", gm.group(1), re.S)[1:]:
        cells = [html.unescape(re.sub("<[^>]+>", "", c)) for c in re.findall(r"<td>(.*?)</td>", row, re.S)]
        glance[cells[0]] = cells[3]
    tier = None
    out = []
    for i, p in enumerate(parts):
        m = re.match(r"<h([23])[^>]*>(.*?)</h\1>", p)
        if not m:
            continue
        title = html.unescape(re.sub("<[^>]+>", "", m.group(2)))
        if m.group(1) == "2":
            tier = {"One-skull missions": 1, "Two-skull missions": 2, "Three-skull missions": 3}.get(title)
            continue
        if tier is None:
            continue
        body = parts[i + 1]
        paras = [html.unescape(re.sub("<[^>]+>", "", x)).strip() for x in re.findall(r"<p>(.*?)</p>", body, re.S)]
        lis = [html.unescape(re.sub("<[^>]+>", "", x)).strip() for x in re.findall(r"<li>(.*?)</li>", body, re.S)]
        nm = re.match(r"(.*) \((.*)\)$", title)
        name, path = nm.group(1), nm.group(2)
        lore = paras[0] if paras else ""
        items = lis or paras[1:]
        ms, fin, flo = [], None, None
        for li in items:
            vm = re.search(r"\((\d+) VP(?:,[^)]*)?\)\.?$", li)
            vp = int(vm.group(1)) if vm else None
            text = re.sub(r"\s*\(\d+ VP(?:,[^)]*)?\)\.?$", "", li).strip()
            if text.startswith("Finale:"):
                fin = dict(text=text[len("Finale:"):].strip(), vp=vp)
            elif text.startswith("Flourish:"):
                flo = dict(text=text[len("Flourish:"):].strip(), vp=vp)
            elif text:
                ms.append(dict(text=text.rstrip("."), vp=vp))
        mid = slug(name)
        rules = mission_rules.RULES.get(mid)
        if rules is None:
            warn(f"mission {name}: no machine rules")
            rules = dict(milestones=[None] * 3, finale=None, flourish=None)
        for k, m_ in enumerate(ms):
            m_["condition"] = rules["milestones"][k]
        fin["condition"] = rules["finale"]
        flo["condition"] = rules["flourish"]
        tags = [t.strip().lower() for t in path.replace(" path", "").split(",")]
        out.append(dict(id=mid, name=name, tier=tier,
                        path=[t for t in tags if t != "any"], anyPath="any" in tags,
                        playsLike=glance.get(name, ""), lore=lore, milestones=ms, finale=fin, flourish=flo))
    return out


# ---------------------------------------------------------------------------
# World cards
# ---------------------------------------------------------------------------


def build_world():
    import world_rules
    return world_rules.build()


# ---------------------------------------------------------------------------
# Cross-check against the Python simulator encoding (Playtest 4)
# ---------------------------------------------------------------------------


def check_against_sim(cards):
    simdir = os.environ.get("THALOROOT_SIM", "/home/claude/sim")
    sys.path.insert(0, simdir)
    try:
        import cards as simcards  # type: ignore
    except ImportError:
        print("simulator encoding not found; skipping cross-check")
        return
    spark_conv = [("Whispering Glade", 0), ("The Fairy Ring", 1), ("Toadstool Thicket", 0), ("Witchlight Marsh", 1),
                  ("The Old Well", 0), ("Echo Gorge", 0), ("The Overgrown Library", 2), ("The Grafted Garden", 2),
                  ("The Thalowood Roots", 1), ("The Grafted Gate", 2)]
    sim = {c["name"]: c for c in simcards.parse()}
    for n, i in spark_conv:
        sim[n]["options"][i]["stat"] = "S"
    code = {"brawn": "B", "wits": "W", "charm": "Ch", "spark": "S", "luck": "L"}
    problems = 0
    for c in cards:
        s = sim.get(c["name"])
        if not s:
            print("not in sim:", c["name"]); problems += 1; continue
        if s["skull"] != c["skull"] or s["copies"] != c["copies"]:
            print("skull/copies differ:", c["name"]); problems += 1
        for o, so in zip(c["options"], s["options"]):
            st = "R" if o["rest"] else code[o["stats"][0]]
            if so["stat"] != st and not (o["pay"] and so["stat"] == "R"):
                print(f"stat differs: {c['name']} / {o['name']}: doc {st} sim {so['stat']}"); problems += 1
            if not o["rest"] and (so["need"], so["stam"]) != (o["need"], o["stamina"]):
                print(f"need/stamina differ: {c['name']} / {o['name']}"); problems += 1
            # treasure VP total on success
            def tvp(effs):
                v = 0
                for e in effs:
                    if e["type"] == "item":
                        it = ITEM_BY_ID[e["item"]]
                        if it["type"] in ("treasure", "light") or e["item"] == "the-sunken-crown":
                            v += it["vp"]
                return v
            sv = sum(int(x[1:].split("/")[1]) for x in so["win"] if x.startswith("T")) + \
                (4 if any(x in ("Crown", "CrownT") for x in so["win"]) else 0)
            if tvp(o["success"]) != sv:
                print(f"treasure VP differs: {c['name']} / {o['name']}: doc {tvp(o['success'])} sim {sv}"); problems += 1
            sc = sum(int(x[1:]) for x in so["win"] if re.match(r"C-?\d", x) and not x.startswith("C-"))
            dc = sum(e["amount"] for e in o["success"] if e["type"] == "coin" and e["amount"] > 0)
            if sc != dc:
                print(f"coin differs: {c['name']} / {o['name']}: doc {dc} sim {sc}"); problems += 1
            sd = sum(int(x[1:]) for x in so["fail"] if re.match(r"D\d", x))
            dd = sum(e["amount"] for e in o["fail"] if e["type"] == "damage")
            if sd != dd:
                print(f"fail damage differs: {c['name']} / {o['name']}: doc {dd} sim {sd}"); problems += 1
    print(f"cross-check: {problems} differences")


# ---------------------------------------------------------------------------


def dump(name, data):
    path = os.path.join(OUT, name)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return path


def main():
    cards = build_cards()
    missions = build_missions()
    world = build_world()
    classes = []
    for k in authored.CLASSES:
        d = dict(k)
        d["id"] = slug(d["name"])
        classes.append(d)
    for name, group, idea, q in authored.CONCEPT_CLASSES:
        classes.append(dict(id=slug(name), name=name, group=group, status="concept", idea=idea, openQuestion=q))
    species = [dict(id=slug(n), name=n, trait=t, hooks=h) for n, t, h in authored.SPECIES]
    fragments = [dict(id=slug(f["name"]), **f) for f in authored.TAPROOT_FRAGMENTS]

    dump("explore-cards.json", cards)
    dump("missions.json", missions)
    dump("world-cards.json", world)
    dump("items.json", ITEMS)
    dump("taproot-fragments.json", fragments)
    dump("companions.json", COMPANIONS)
    dump("classes.json", classes)
    dump("species.json", species)

    uniq = len(cards)
    total = sum(c["copies"] for c in cards)
    print(f"explore cards: {uniq} unique, {total} total")
    print(f"missions: {len(missions)} ({', '.join(str(sum(1 for m in missions if m['tier'] == t)) for t in (1, 2, 3))} by tier)")
    print(f"world cards: {sum(len(v) for k, v in world.items() if isinstance(v, list))}")
    print(f"items: {len(ITEMS)}, companions: {len(COMPANIONS)}, classes: {len(classes)}, species: {len(species)}")
    manual = [f"{m['name']}: {part}" for m in missions
              for part, cond in [("finale", m["finale"]["condition"]), ("flourish", m["flourish"]["condition"])] +
              [(f"milestone {i+1}", x["condition"]) for i, x in enumerate(m["milestones"])]
              if cond is None]
    if manual:
        print(f"mission conditions left manual: {len(manual)}")
        for x in manual:
            print("  ", x)
    if "--check" in sys.argv:
        check_against_sim(cards)
    for w in WARNINGS:
        print("WARN", w)
    if uniq != 54 or total != 63 or len(missions) != 51:
        sys.exit("content counts are wrong")


if __name__ == "__main__":
    main()
