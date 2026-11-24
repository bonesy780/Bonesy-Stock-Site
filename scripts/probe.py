import json, os, subprocess, sys, re
os.makedirs("site", exist_ok=True)
def run(cmd, env=None):
    print("=====", cmd, flush=True); subprocess.run(cmd, shell=True, env={**os.environ, **(env or {})})
run("python scripts/build_macro.py", {"FULL": "1"})
print(open("site/macro.json").read()[:1500])
f = json.load(open("site/funds.json")); print("etfs", len(f["etfs"]), "crypto", [c["t"] for c in f["crypto"]])
print(json.dumps(f["etfs"][0])[:1500]); print(json.dumps([e for e in f["etfs"] if e["t"]=="XEQT.TO"])[:600])
run("python scripts/build_econ.py")
e = json.load(open("site/econ.json")); print("events", len(e["events"]), "key", sum(1 for x in e["events"] if x.get("key")))
print("\n".join(f'{x["d"]} {x["c"]} {x["n"]} a={x.get("a")} fc={x.get("fc")}' for x in e["events"] if x.get("key"))[:3000])
# a mini ratings run
json.dump({"generated": "x", "fx": {"USD": 1, "CAD": 1.4, "JPY": 150}, "stocks": [{"t": t, "s": t, "n": t, "cur": c, "ix": ["sp500"], "mcapUsd": 1e12, "p": 100} for t, c in [("AAPL", "USD"), ("NVDA", "USD"), ("RY.TO", "CAD"), ("7203.T", "JPY"), ("INTC", "USD")]]}, open("site/market.json", "w"))
src = open("scripts/build_ratings.py").read().replace("COOL_DOWN = 45", "COOL_DOWN = 0")
open("/tmp/br.py", "w").write(src.replace('Path(__file__).resolve().parent.parent', 'Path(os.getcwd())').replace("import json\n", "import json\nimport os\n", 1))
run("cd scripts && python /tmp/br.py")
for t in ["AAPL", "INTC"]:
    print(t, open(f"site/ratings/{t}.json").read()[:1800])
print(open("site/insiders.json").read()[:1500]); print(open("site/surprises.json").read()[:800])
