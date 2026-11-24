import json, os, subprocess, sys, re
os.makedirs("site", exist_ok=True)
def run(cmd, env=None):
    print("=====", cmd, flush=True); subprocess.run(cmd, shell=True, env={**os.environ, **(env or {})})
json.dump({"generated": "x", "fx": {"USD": 1, "CAD": 1.4, "JPY": 150}, "stocks": [{"t": t, "s": t, "n": t, "cur": c, "ix": ["sp500"], "mcapUsd": 1e12, "p": 100} for t, c in [("AAPL", "USD"), ("NVDA", "USD"), ("RY.TO", "CAD"), ("7203.T", "JPY"), ("INTC", "USD")]]}, open("site/market.json", "w"))
src = open("scripts/build_ratings.py").read().replace("COOL_DOWN = 45", "COOL_DOWN = 0")
open("scripts/br_probe.py", "w").write(src)
run("python scripts/br_probe.py")
for t in ["AAPL", "INTC", "7203.T"]:
    try: print(t, open(f"site/ratings/{t}.json").read()[:1500])
    except Exception as ex: print(t, ex)
print(open("site/insiders.json").read()[:1500]); print(open("site/surprises.json").read()[:800])
run("python scripts/build_econ.py")
e = json.load(open("site/econ.json")); print("events", len(e["events"]), "key", sum(1 for x in e["events"] if x.get("key")))
print("\n".join(f'{x["d"]} {x["c"]} {x["n"]}' for x in e["events"] if x.get("key"))[:3000])
run("python scripts/build_macro.py", {"FULL": "1"})
f = json.load(open("site/funds.json")); print("crypto", [(c["t"], c["n"]) for c in f["crypto"]])
