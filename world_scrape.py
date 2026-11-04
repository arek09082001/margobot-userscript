"""Weltkarte von Margonem aus margoworld.pl holen (einmalig, ca. 20 Minuten).

margoworld.pl führt alle Karten mit denselben IDs wie das Spiel (auch margonem.com, nur die Namen
sind polnisch). Pro Karte: Größe, alle Türen (Zielkarte + Kachel) und alle Mobs mit Level.
Ergebnis: templates/_maps/worldgraph.json – daraus rechnet worldgraph.py Wege zwischen Karten.

Langsam und höflich: eine Anfrage pro ~0,4 s, Zwischenstand wird gespeichert (abbrechen und neu
starten geht, schon geholte Karten werden übersprungen).

    python world_scrape.py            # alles holen
    python world_scrape.py 2 12       # nur einzelne Karten (zum Testen)
"""
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://margoworld.pl"
OUT = Path(__file__).parent / "templates" / "_maps" / "worldgraph.json"
CACHE = Path(__file__).parent / "templates" / "_maps" / "worldgraph.partial.json"
UA = {"User-Agent": "MargoBot-Weltkarte/1.0 (einmaliger Abruf, privat)"}


def get(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:                       # noqa: BLE001 – Netzfehler: kurz warten, nochmal
            if k == tries - 1:
                raise
            time.sleep(3 + 5 * k)


def map_list():
    page = get(BASE + "/world/list")
    out = {}
    for mid, name in re.findall(r'href="/world/view/(\d+)/[^"]*"[^>]*>([^<]+)<', page):
        out[int(mid)] = html.unescape(name).strip()
    return out


GW = re.compile(r'<div[^>]*class="object"[^>]*data-x="(\d+)" data-y="(\d+)">\s*<a[^>]*href="/world/view/(\d+)/')
NPC = re.compile(r'<div id="npc(\d+)" class="object npc" data-tip="([^"]*)"[^>]*data-x="(\d+)" data-y="(\d+)" '
                 r'data-type="(\d+)" data-icon="([^"]*)"')
SIZE = re.compile(r'class="margo-world" style="width: (\d+)px; height: (\d+)px')


def parse_frame(page):
    m = SIZE.search(page)
    w, h = (int(m.group(1)) // 32, int(m.group(2)) // 32) if m else (0, 0)
    gws, seen = [], set()
    for x, y, to in GW.findall(page):
        k = (int(to), int(x), int(y))
        if k not in seen:
            seen.add(k)
            gws.append(list(k))
    mobs = {}
    for nid, tip, x, y, typ, icon in NPC.findall(page):
        tip = html.unescape(tip)
        lv = re.search(r"(\d+)\s*lvl", tip)
        nick = re.sub(r"<[^>]+>", "", tip.split("</b>")[0]).strip()
        if not lv or typ not in ("2", "3"):          # 2/3 = angreifbar (wie im Spiel), Rest Deko/NPC
            continue
        key = (nick, int(lv.group(1)))
        e = mobs.setdefault(key, {"n": nick, "l": int(lv.group(1)), "i": icon, "c": 0, "t": int(typ), "p": []})
        e["c"] += 1
        e["p"] += [int(x), int(y)]                   # Stellplatz – für Nebel-Karten: dort gezielt nachsehen
    return {"w": w, "h": h, "gw": gws, "mobs": list(mobs.values())}


def main(only=None):
    data = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    names = map_list()
    print(f"{len(names)} Karten in der Liste, {len(data)} schon geholt")
    ids = [int(i) for i in only] if only else sorted(names)
    t0, done = time.time(), 0
    for mid in ids:
        if str(mid) in data and not only:
            continue
        try:
            d = parse_frame(get(f"{BASE}/world-frame/{mid}"))
        except Exception as e:                       # noqa: BLE001
            print(f"  {mid}: Fehler {e}")
            continue
        d["pl"] = names.get(mid, "")
        data[str(mid)] = d
        done += 1
        if done % 50 == 0:
            CACHE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            left = sum(1 for i in ids if str(i) not in data)
            print(f"  {len(data)}/{len(names)} · noch ~{left * (time.time() - t0) / done / 60:.0f} min", flush=True)
        time.sleep(0.4)
    CACHE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    if not only:
        OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"fertig: {OUT} ({OUT.stat().st_size // 1024} KB)")
    else:
        for mid in ids:
            print(mid, json.dumps(data[str(mid)], ensure_ascii=False)[:600])


if __name__ == "__main__":
    main(sys.argv[1:] or None)
