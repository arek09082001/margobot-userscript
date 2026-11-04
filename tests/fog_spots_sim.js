// Nebel mit bekannten Mob-Plätzen (Weltkarte mit Positionen): Plätze ablaufen statt Fläche absuchen,
// nach „Nebel: weiter nach X %“ zur nächsten Karte. Vergleich: gleiche Karte ohne Positionen (altes Erkunden).
const fs = require('fs');
const SRC = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t);');
const W = 80, H = 60, wall = new Set();
for (let y = 10; y < 50; y++) if (y !== 30) wall.add('40,' + y);            // Mauer mit Lücke in der Mitte
let fail = 0;

function run(name, { pos, pct, alive }) {
    let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const spots = [];
    while (spots.length < 20) { const x = 3 + Math.floor(R() * (W - 6)), y = 3 + Math.floor(R() * (H - 6)); if (!wall.has(x + ',' + y)) spots.push([x, y]); }
    let all = spots.slice(0, alive).map(([x, y], i) => ({ d: { id: i + 1, nick: 'Ghul', lvl: 41, x, y, type: 2, icon: 'hum/ghul.gif' } }));
    let tgt = null, kills = 0, now = 0, left = null;
    const hero = { d: { x: 2, y: 2, lvl: 41, exp: 0 }, autoGoTo(p) { tgt = p; },
                   heroAtackRequest(id) { kills++; all = all.filter(n => n.d.id !== id); } };
    const near = () => all.filter(n => Math.abs(n.d.x - hero.d.x) <= 7 && Math.abs(n.d.y - hero.d.y) <= 7);
    const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: near }, deadController: {},
      map: { d: { id: 500, name: 'Grobowiec' }, size: { x: W, y: H }, col: { check: (x, y) => wall.has(x + ',' + y) ? 1 : 0 },
        getGateways: () => ({ townnames: { 501: 'Ausgang' }, getList: () => [{ d: { id: 501, x: 79, y: 30 } }] }) } };
    const mob = ['Ghul', 41, 20];
    if (pos) mob.push(spots.flat(), 'hum/ghul.gif');
    const world = { 500: [W, H, 'Grobowiec', [[501, 79, 30]], [mob]], 501: [20, 20, 'Ausgang', [[500, 0, 10]], []] };
    const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
    const store = { mbworld: world, mbauto: { on: true, pauseMin: 0, pauseMax: 0, lvlOn: true, lvlMin: 40, lvlMax: 42, exits: { Grobowiec: '501' }, fogPct: pct } };
    const timers = [];
    const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null };
    const sb = { unsafeWindow: { Engine }, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v,
      document: doc, innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
    new Function(...Object.keys(sb), SRC)(...Object.values(sb));
    for (let i = 0; i < 6000 && left == null; i++) {                     // Held läuft 1 Feld pro Takt (200 ms)
        now += 200;
        if (tgt && !(tgt.x === hero.d.x && tgt.y === hero.d.y)) {
            const prev = new Map([[hero.d.x + ',' + hero.d.y, null]]), q = [[hero.d.x, hero.d.y]]; let found = null;
            while (q.length && !found) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev.has(k) || (wall.has(k) && !(nx === tgt.x && ny === tgt.y))) continue; prev.set(k, x + ',' + y);
                if (nx === tgt.x && ny === tgt.y) { found = k; break; } q.push([nx, ny]); } }
            if (found) { let k = found; while (prev.get(k) !== hero.d.x + ',' + hero.d.y) k = prev.get(k); const [nx, ny] = k.split(',').map(Number); if (!wall.has(k)) { hero.d.x = nx; hero.d.y = ny; } }
        }
        if (hero.d.x === 79 && hero.d.y === 30) left = now;
        timers[0]();
    }
    return { kills, t: left == null ? null : Math.round(left / 1000) };
}

const show = (name, r, ok) => { if (!ok) fail = 1; console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name + ' | Kills ' + r.kills + ' | zum Ausgang nach ' + (r.t == null ? '–' : r.t + ' s')); };
// 6 von 20 Plätzen besetzt
const a = run('', { pos: true, pct: 100, alive: 6 });
show('Plätze, 100 %, 6 Mobs', a, a.kills === 6 && a.t != null);
const b = run('', { pos: true, pct: 50, alive: 6 });
show('Plätze, 50 %, 6 Mobs', b, b.t != null && b.t < a.t);
const c = run('', { pos: false, pct: 100, alive: 6 });
show('ohne Plätze (altes Erkunden), 6 Mobs', c, c.kills === 6 && c.t != null);
show('→ Plätze schneller als Fläche', { kills: a.kills, t: c.t - a.t }, a.t < c.t);
// Karte leer: alles schon weg
const d = run('', { pos: true, pct: 50, alive: 0 });
const e = run('', { pos: false, pct: 100, alive: 0 });
show('leer, Plätze 50 %', d, d.t != null && d.t < e.t);
show('leer, ohne Plätze', e, e.t != null);
process.exit(fail);
