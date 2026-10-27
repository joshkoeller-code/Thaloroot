"""Parse the Story tabs (content/source/story-*.md) into content/story.json."""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "content", "source")


def slug(s):
    s = s.lower().replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def sections(path, level="###"):
    """Yield (title, body lines) for each heading at this level."""
    title, body = None, []
    for line in open(os.path.join(SRC, path)).read().splitlines():
        if line.startswith(level + " "):
            if title:
                yield title, body
            title, body = line[len(level) + 1:].strip(), []
        elif line.startswith("#"):
            if title:
                yield title, body
            title, body = None, []
        elif title:
            body.append(line)
    if title:
        yield title, body


def build(cards, missions, world, warn):
    out = {"locations": {}, "missions": {}, "world": {}}
    by_name = {c["name"]: c for c in cards}
    for title, body in sections("story-locations.md"):
        card = by_name.get(title)
        if not card:
            warn(f"story: unknown location {title}")
            continue
        entry = {"options": {}, "mishap": None}
        cur = None
        for line in body:
            m = re.match(r"\*\*(.+?)\*\*\s*$", line.strip())
            if m:
                cur = m.group(1)
                if cur != "Mishap":
                    entry["options"][cur] = {}
                continue
            m = re.match(r"- (Success|Fail|Spark|Scene): (.+)", line.strip())
            if m and cur:
                if cur == "Mishap":
                    entry["mishap"] = m.group(2)
                else:
                    entry["options"][cur][m.group(1).lower()] = m.group(2)
        for o in card["options"]:
            got = entry["options"].get(o["name"])
            if got is None:
                warn(f"story: {title} / {o['name']} has no scene")
                continue
            need = ["scene"] if o["rest"] else ["success", "fail"] + (["spark"] if o["text"]["spark"] else [])
            for k in need:
                if k not in got:
                    warn(f"story: {title} / {o['name']} is missing a {k} line")
        out["locations"][card["id"]] = entry
    for c in cards:
        if c["id"] not in out["locations"]:
            warn(f"story: no scenes for {c['name']}")

    mby = {m["name"]: m for m in missions}
    for title, body in sections("story-missions.md"):
        m = mby.get(title)
        if not m:
            warn(f"story: unknown mission {title}")
            continue
        beats = {}
        for line in body:
            mm = re.match(r"- (Opening|Milestone [123]|Finale): (.+)", line.strip())
            if mm:
                beats[mm.group(1)] = mm.group(2)
        missing = [k for k in ["Opening", "Milestone 1", "Milestone 2", "Milestone 3", "Finale"] if k not in beats]
        if missing:
            warn(f"story: {title} is missing {', '.join(missing)}")
        out["missions"][m["id"]] = {
            "opening": beats.get("Opening", ""),
            "milestones": [beats.get(f"Milestone {i}", "") for i in (1, 2, 3)],
            "finale": beats.get("Finale", ""),
        }
    for m in missions:
        if m["id"] not in out["missions"]:
            warn(f"story: no arc for {m['name']}")

    wby = {}
    for cat, cards_ in world.items():
        if isinstance(cards_, list):
            for w in cards_:
                wby[w["name"]] = w
    for title, body in sections("story-world.md"):
        w = wby.get(title)
        if not w:
            warn(f"story: unknown World card {title}")
            continue
        out["world"][w["id"]] = " ".join(l.strip() for l in body if l.strip())
    for w in wby.values():
        if w["id"] not in out["world"]:
            warn(f"story: no moment for {w['name']}")
    return out
