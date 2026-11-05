"""Expowiska (XP-Gebiete) von margoworld.pl → margobot_expowiska.json fürs Skript.

margoworld führt die Expowiska als Tags („Expowisko - grobowce (18lvl)“), jede Tag-Seite listet die Karten
(Karten-IDs wie im Spiel). Daraus wird pro Expowisko eine ablaufbare Route gebaut: ein Rundgang durch alle
Karten über die Türen der Weltkarte (bei Verzweigungen hin und zurück), getrennte Teile über den kürzesten
Weg verbunden. Dazu der Level-Bereich der normalen Mobs (ohne Elity/Bosse).

    python expowiska.py          # holt die Seiten (~1 min, mit Cache) und schreibt margobot_expowiska.json

Braucht margobot_world.json (worldgraph.py export).
"""
import html
import json
import re
import time
import urllib.request
from collections import deque
from pathlib import Path

HERE = Path(__file__).parent
BASE = "https://margoworld.pl"
CACHE = HERE / "templates" / "_maps" / "expowiska_cache"
OUT = HERE / "margobot_expowiska.json"
UA = {"User-Agent": "MargoBot-Expowiska/1.0 (einmaliger Abruf, privat)"}
BOSS = re.compile(r"^(e\d|tytani?|herosi?|kolos\w*|heros)/", re.I)   # Elity/Bosse nicht in den Level-Bereich


def get(path):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (re.sub(r"[^a-z0-9-]+", "_", path.lower()).strip("_") + ".html")
    if f.exists():
        return f.read_text(encoding="utf-8")
    with urllib.request.urlopen(urllib.request.Request(BASE + path, headers=UA), timeout=30) as r:
        t = r.read().decode("utf-8")
    f.write_text(t, encoding="utf-8")
    time.sleep(0.4)
    return t


def scrape():
    page = get("/npc/exp")
    out = []
    for href, name in re.findall(r'<td><a\s+href="(/tags/view/exp-[^"]+)">([^<]+)</a></td>', page):
        body = get(href)
        body = body[body.find('<div class="container-fluid content">'):]
        maps = []
        for mid in re.findall(r'href="/world/view/(\d+)/', body):
            if int(mid) not in maps:
                maps.append(int(mid))
        nm = html.unescape(name).strip()
        m = re.match(r"Expowisko - (.+?) \((\d+)\s*lvl\)", nm)
        out.append({"name": (m.group(1) if m else nm).replace("-", " "), "lvl": int(m.group(2)) if m else 0, "maps": maps})
    return out


def neighbors(world, mid):
    return list(dict.fromkeys(str(g[0]) for g in world.get(mid, [0, 0, "", []])[3] if str(g[0]) in world and str(g[0]) != mid))


def shortest(world, a, goals, limit=12):
    """Kürzester Kartenweg von a zu einer der goals (nur Kartenwechsel zählen)."""
    prev, q = {a: None}, deque([a])
    while q:
        x = q.popleft()
        if x in goals and x != a:
            path = [x]
            while prev[path[-1]] is not None:
                path.append(prev[path[-1]])
            return path[::-1]
        if len(prev) > 4000:
            break
        for y in neighbors(world, x):
            if y not in prev:
                prev[y] = x
                q.append(y)
    return None


def tour(world, ids):
    """Rundgang durch alle Karten: Tiefensuche, bei Sackgassen zurück. Teile ohne direkte Tür werden über den
    kürzesten Weg durch andere Karten verbunden. Ergebnis als Kreis (letzte Karte hat eine Tür zur ersten)."""
    ids = [str(i) for i in ids if str(i) in world]
    if not ids:
        return []
    todo, seq = set(ids), []

    def dfs(x, via):
        seq.append(x)
        todo.discard(x)
        for y in neighbors(world, x):
            if y in todo:
                dfs(y, x)
                seq.append(x)

    # Start: Karte mit den meisten Türen ins Expowisko (meist der Eingang/Knoten)
    start = max(ids, key=lambda i: sum(1 for y in neighbors(world, i) if y in set(ids)))
    dfs(start, None)
    while todo:                                    # getrennter Teil: Weg dorthin, dort weiter, wieder zurück
        p = shortest(world, seq[-1], todo)
        if not p:
            break
        seq.extend(p[1:-1])
        dfs(p[-1], None)
        back = shortest(world, seq[-1], {start})
        if back:
            seq.extend(back[1:-1])
    while len(seq) > 1 and seq[-1] == seq[0]:
        seq.pop()
    if len(seq) > 1 and seq[0] not in neighbors(world, seq[-1]):   # Kreis schließen
        back = shortest(world, seq[-1], {seq[0]})
        if back:
            seq.extend(back[1:-1])
    return [int(x) for x in seq]


def main():
    world = json.loads((HERE / "margobot_world.json").read_text(encoding="utf-8"))
    out = []
    for e in scrape():
        route = tour(world, e["maps"])
        # Kernbereich der Mob-Level: 10.–90. Perzentil nach Anzahl, höchstens ±15 um das Expowisko-Level –
        # einzelne Frösche (Lvl 2) oder Quest-Gegner auf denselben Karten sollen den Bereich nicht aufblähen
        pool = sorted((m[1], m[2]) for i in e["maps"] if str(i) in world for m in world[str(i)][4]
                      if not BOSS.match(m[4] if len(m) > 4 and m[4] else "") and abs(m[1] - e["lvl"]) <= 15)
        total, acc, lv = sum(c for _, c in pool), 0, []
        for l, c in pool:
            acc += c
            if acc >= total * 0.1 and not lv:
                lv.append(l)
            if acc >= total * 0.9 and len(lv) == 1:
                lv.append(l)
        lv = lv if len(lv) == 2 else [e["lvl"], e["lvl"]]
        extra = [i for i in route if i not in e["maps"]]
        out.append({"name": e["name"], "lvl": e["lvl"], "maps": e["maps"], "route": route, "via": sorted(set(extra)),
                    "lv": lv})
        print(f"{e['lvl']:>3} {e['name']:<28} {len(e['maps']):>2} Karten, Route {len(route):>3}" + (f", über {len(set(extra))} weitere" if extra else ""))
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"fertig: {OUT} ({OUT.stat().st_size // 1024} KB, {len(out)} Expowiska)")


if __name__ == "__main__":
    main()
