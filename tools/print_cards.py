"""Print every explore option with its parsed effects, for reviewing the build."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def f(effs):
    out = []
    for e in effs:
        d = dict(e); t = d.pop("type")
        if "then" in d:
            d["then"] = "[" + f(d["then"]) + "]"
        if "quirk" in d:
            d.pop("text", None); d["quirk"] = len(d["quirk"])
        out.append(t + ("(" + ",".join(f"{k}={v}" for k, v in d.items()) + ")" if d else ""))
    return " ".join(out)


for c in json.load(open(os.path.join(ROOT, "content", "explore-cards.json"))):
    if len(sys.argv) > 1 and not any(a.lower() in c["name"].lower() for a in sys.argv[1:]):
        continue
    print("##", c["name"], c["tags"], c["skull"], ("mishap: " + f(c["mishap"]["effects"])) if c["mishap"] else "")
    for o in c["options"]:
        h = "REST" if o["rest"] else f"{'/'.join(o['stats'])} {o['need']}s {o['stamina']}st"
        if o["pay"]: h += f" pay{o['pay']}"
        if o["discardTreasure"]: h += " discardT"
        print(f"  {o['name']} [{h}] S: {f(o['success'])} | F: {f(o['fail'])} | K{o['sparkNeeds']}: {f(o['spark'])}")
