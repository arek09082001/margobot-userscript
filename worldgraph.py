"""Weltkarte: Wege zwischen Karten und XP-Orte nach Level (Daten von world_scrape.py).

Knoten sind Karten (Spiel-ID). Kosten eines Wegs = Laufweg innerhalb jeder Karte (Luftlinie in
Kacheln zwischen Eingangs- und Ausgangstür, ×1.3 für Umwege) + 8 pro Kartenwechsel (Ladezeit).
Man kommt auf der neuen Karte an der Tür heraus, die zurück zur alten Karte führt.

    python worldgraph.py weg Torneg "Stare Ruiny"        # Weg mit Türen
    python worldgraph.py xp 15 20 [von Torneg]           # beste Karten für Level 15–20
    python worldgraph.py suche ruin                      # Karten finden (Name oder ID)
    python worldgraph.py export                          # kompakte Datei fürs Userscript
"""
import heapq
import json
import sys
import unicodedata
from pathlib import Path

FOLDER = Path(__file__).parent / "templates" / "_maps"
SRC = FOLDER / "worldgraph.json"
MINI = Path(__file__).parent / "margobot_world.json"
HOP = 8
DETOUR = 1.3


def norm(s):
    s = unicodedata.normalize("NFKD", (s or "").lower().replace("ł", "l"))
    return " ".join("".join(c for c in s if not unicodedata.combining(c)).split())


class World:
    def __init__(self, data=None):
        if data is None:
            src = SRC if SRC.exists() else FOLDER / "worldgraph.partial.json"
            data = json.loads(src.read_text(encoding="utf-8"))
        self.maps = {int(k): v for k, v in data.items()}
        self.names = {}                 # zusätzliche (englische) Namen: id → name
        en = FOLDER / "worldnames_en.json"
        if en.exists():
            self.names = {int(k): v for k, v in json.loads(en.read_text(encoding="utf-8")).items()}

    def name(self, mid):
        m = self.maps.get(mid, {})
        return self.names.get(mid) or m.get("pl") or f"Karte {mid}"

    # ── Suchen ──
    def find(self, text):
        """Karten-IDs zu einem Namen/ID: exakt vor Wortanfang vor Teilstring."""
        t = str(text).strip()
        if t.isdigit() and int(t) in self.maps:
            return [int(t)]
        q = norm(t)
        exact, start, part = [], [], []
        for mid, m in self.maps.items():
            for n in (m.get("pl"), self.names.get(mid)):
                n = norm(n)
                if not n:
                    continue
                if n == q:
                    exact.append(mid)
                elif n.startswith(q):
                    start.append(mid)
                elif q in n:
                    part.append(mid)
        seen, out = set(), []
        for mid in exact + sorted(start) + sorted(part):
            if mid not in seen:
                seen.add(mid)
                out.append(mid)
        return out

    # ── Wege ──
    def doors(self, mid, to):
        return [(x, y) for t, x, y in self.maps.get(mid, {}).get("gw", []) if t == to]

    def entry(self, mid, came_from):
        """Wo man auf `mid` herauskommt, wenn man von `came_from` kommt (Tür zurück), sonst Mitte."""
        d = self.doors(mid, came_from)
        if d:
            return d[len(d) // 2]
        m = self.maps.get(mid, {})
        return (m.get("w", 0) // 2, m.get("h", 0) // 2)

    def route(self, start, goals, start_xy=None, blocked=()):
        """Kürzester Weg start → eine der goals. Rückgabe: [(karte, tür_xy zur nächsten Karte), …, (ziel, None)]."""
        goals = set(goals)
        blocked = {tuple(b) for b in blocked}
        sxy = tuple(start_xy) if start_xy else self.entry(start, None)
        best = {start: 0.0}
        prev = {start: None}
        pos = {start: sxy}
        heap = [(0.0, start)]
        while heap:
            c, mid = heapq.heappop(heap)
            if c > best.get(mid, 1e18):
                continue
            if mid in goals:
                out, cur, door = [], mid, None
                while cur is not None:
                    out.append((cur, door))
                    cur, door = prev[cur] if prev[cur] else (None, None)
                return out[::-1], c
            x0, y0 = pos[mid]
            by_target = {}
            for to, x, y in self.maps.get(mid, {}).get("gw", []):
                if to == mid or to not in self.maps or (mid, to) in blocked:
                    continue
                d = abs(x - x0) + abs(y - y0)
                if to not in by_target or d < by_target[to][0]:
                    by_target[to] = (d, (x, y))
            for to, (d, door) in by_target.items():
                nc = c + d * DETOUR + HOP
                if nc < best.get(to, 1e18):
                    best[to] = nc
                    prev[to] = (mid, door)
                    pos[to] = self.entry(to, mid)
                    heapq.heappush(heap, (nc, to))
        return None, None

    # ── XP-Orte ──
    def xp_maps(self, lmin, lmax, start=None, top=15):
        """Karten mit vielen Mobs im Level-Bereich; mit Start zusätzlich nach Entfernung gewichtet."""
        dist = self.distances(start) if start else {}
        out = []
        for mid, m in self.maps.items():
            hit = [mb for mb in m.get("mobs", []) if lmin <= mb["l"] <= lmax]
            n = sum(mb["c"] for mb in hit)
            if n < 4:
                continue
            area = max(1, m.get("w", 1) * m.get("h", 1))
            dens = n / area * 1000                      # Mobs pro 1000 Kacheln
            d = dist.get(mid)
            if start and d is None:
                continue
            out.append({"id": mid, "name": self.name(mid), "n": n, "dens": dens, "dist": d,
                        "mobs": sorted({(mb["n"], mb["l"]) for mb in hit}, key=lambda t: t[1])})
        score = (lambda o: o["n"] * min(1.0, o["dens"] / 4) / (1 + (o["dist"] or 0) / 400))
        return sorted(out, key=score, reverse=True)[:top]

    def distances(self, start):
        best, heap = {start: 0.0}, [(0.0, start, self.entry(start, None))]
        while heap:
            c, mid, (x0, y0) = heapq.heappop(heap)
            if c > best.get(mid, 1e18):
                continue
            for to, x, y in self.maps.get(mid, {}).get("gw", []):
                if to == mid or to not in self.maps:
                    continue
                nc = c + (abs(x - x0) + abs(y - y0)) * DETOUR + HOP
                if nc < best.get(to, 1e18):
                    best[to] = nc
                    heapq.heappush(heap, (nc, to, self.entry(to, mid)))
        return best

    # ── Export fürs Userscript ──
    def export(self, path=MINI):
        """{id: [w, h, name_pl, [[ziel, x, y], …], [[name, level, anzahl], …]]}"""
        mini = {mid: [m.get("w", 0), m.get("h", 0), m.get("pl", ""), m.get("gw", []),
                      [[mb["n"], mb["l"], mb["c"]] for mb in m.get("mobs", [])]]
                for mid, m in self.maps.items()}
        path.write_text(json.dumps(mini, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        return path


def _pick(w, text):
    ids = w.find(text)
    if not ids:
        sys.exit(f"Keine Karte gefunden: {text}")
    if len(ids) > 1 and norm(w.name(ids[0])) != norm(text):
        print(f"„{text}“ → {w.name(ids[0])} (#{ids[0]}); weitere: " +
              ", ".join(f"{w.name(i)} (#{i})" for i in ids[1:6]))
    return ids[0]


def main(argv):
    w = World()
    if not argv or argv[0] in ("-h", "--help", "hilfe"):
        print(__doc__)
        return
    cmd = argv[0]
    if cmd == "suche":
        for mid in w.find(" ".join(argv[1:]))[:25]:
            m = w.maps[mid]
            lv = sorted({mb["l"] for mb in m.get("mobs", [])})
            print(f"#{mid:<5} {w.name(mid)}  ({m['w']}×{m['h']}, {len(m['gw'])} Türen"
                  + (f", Mobs {lv[0]}–{lv[-1]}" if lv else "") + ")")
    elif cmd == "weg":
        a, b = _pick(w, argv[1]), _pick(w, argv[2])
        path, cost = w.route(a, [b])
        if not path:
            print("Kein Weg gefunden (Karte nicht verbunden oder nur per Teleport erreichbar).")
            return
        print(f"{len(path) - 1} Kartenwechsel, ~{cost:.0f} Schritte")
        for i, (mid, door) in enumerate(path):
            print(f"  {i + 1:>2}. {w.name(mid)}" + (f"  → Tür ({door[0]},{door[1]})" if door else "  ✔ Ziel"))
    elif cmd == "xp":
        lmin, lmax = int(argv[1]), int(argv[2])
        start = _pick(w, " ".join(argv[4:])) if len(argv) > 4 and argv[3] == "von" else None
        for o in w.xp_maps(lmin, lmax, start):
            mobs = ", ".join(f"{n} {l}" for n, l in o["mobs"][:4])
            print(f"#{o['id']:<5} {o['name'][:38]:<38} {o['n']:>3} Mobs"
                  + (f"  ~{o['dist']:.0f} Schritte" if o["dist"] is not None else "") + f"  [{mobs}]")
    elif cmd == "export":
        p = w.export()
        print(f"{p} ({p.stat().st_size // 1024} KB, {len(w.maps)} Karten)")
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
