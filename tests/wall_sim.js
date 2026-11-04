// Mobs und Ausgänge hinter einer Wand: Der Held darf nie dauerhaft davor stehen bleiben.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t); W.__logs = (W.__logs || []).concat(t);');
const check = (name, ok, extra) => { console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name + (extra ? ' | ' + extra : '')); if (!ok) process.exitCode = 1; };

/* maps: {id: {name, wall(x,y), doors: [[Ziel, x, y, Ankunft-x, Ankunft-y]]}}. hidden(x,y) = Wand, die das Spiel kennt,
   col.check aber nicht meldet. Der Held läuft wie im Spiel selbst per Wegsuche, steht er auf einer Tür, wechselt die Karte. */
function setup({ maps, start, xy, mobs = {}, world = true, route = null, hidden = null, late = 0, cfg = {} }) {
    const S = 30, now = { t: 0 }, W = {};
    let cur = start, tgt = null, atk = [], visits = [start], onDoorOk = false;
    const blocked = (x, y) => x < 0 || y < 0 || x >= S || y >= S || maps[cur].wall(x, y) || (hidden && hidden(cur, x, y));
    const stepTo = (hx, hy, g) => {                     // Breitensuche des Spiels (kennt alle Wände)
        const q = [[g.x, g.y]], seen = new Map([[g.x + ',' + g.y, 0]]);
        while (q.length) {
            const [x, y] = q.shift(), d = seen.get(x + ',' + y);
            for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + a, ny = y + b, k = nx + ',' + ny;
                if (seen.has(k) || blocked(nx, ny)) continue;
                seen.set(k, d + 1); q.push([nx, ny]);
            }
        }
        let best = null, bd = seen.get(hx + ',' + hy);
        if (bd === undefined) return null;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = seen.get((hx + a) + ',' + (hy + b)); if (v !== undefined && v < bd) { bd = v; best = [hx + a, hy + b]; } }
        return best;
    };
    const hero = { d: { x: xy[0], y: xy[1], lvl: 30, exp: 1, nick: 'T' }, autoGoTo(p) { tgt = p; },
        heroAtackRequest(id) { atk.push(id); const m = (mobs[cur] || []); const i = m.findIndex(x => x.id === id); if (i >= 0) m.splice(i, 1); } };
    const Engine = { hero, battle: { show: false }, deadController: {}, npcs: { getDrawableList: () => (mobs[cur] || []).map(d => ({ d: Object.assign({ type: 2, icon: 'a.gif', lvl: 30, nick: 'Mob' }, d) })) },
        map: { d: { id: start, name: maps[start].name }, size: { x: S, y: S },
            col: { check: (x, y) => (now.t < late ? 0 : maps[cur].wall(x, y) ? 1 : 0) },
            getGateways: () => ({ townnames: Object.fromEntries(maps[cur].doors.map(g => [g[0], maps[g[0]] ? maps[g[0]].name : 'Tür'])), getList: () => maps[cur].doors.map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
    W.Engine = Engine; W.confirm = () => true;
    const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, set innerHTML(v) {} });
    const wj = {}; for (const id in maps) wj[id] = [S, S, maps[id].name, maps[id].doors.map(g => g.slice(0, 3)), []];
    const store = { mbauto: Object.assign({ on: true, lvlOn: true, lvlMin: 1, lvlMax: 100, pauseMin: 0, pauseMax: 0, fogExplore: false }, route ? { routes: { R: { maps: route, mode: 'back' } }, route: 'R' } : {}, cfg) };
    if (world) store.mbworld = wj;
    const timers = [];
    const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v, innerWidth: 1400, innerHeight: 900,
        document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }, setInterval: f => timers.push(f), performance: { now: () => now.t } };
    new Function(...Object.keys(sb), src)(...Object.values(sb));
    const run = ms => { for (const end = now.t + ms; now.t < end;) {
        now.t += 200;
        if (tgt) {
            const s = stepTo(hero.d.x, hero.d.y, tgt);
            if (s) { hero.d.x = s[0]; hero.d.y = s[1]; }
            if (hero.d.x === tgt.x && hero.d.y === tgt.y) tgt = null;
            const dr = maps[cur].doors.find(g => g[1] === hero.d.x && g[2] === hero.d.y);
            if (dr && s) { cur = dr[0]; Engine.map.d.id = cur; Engine.map.d.name = maps[cur].name; hero.d.x = dr[3]; hero.d.y = dr[4]; tgt = null; visits.push(cur); }
        }
        timers.forEach(f => { try { f(); } catch (e) { console.log('Absturz:', e.message); process.exitCode = 1; } });
    } };
    return { run, hero, get atk() { return atk; }, visits, get cur() { return cur; }, logs: () => W.__logs || [], store };
}
const midWall = (x, y) => x === 15;
const free = () => false;

// A ist durch eine Mauer geteilt, beide Seiten hängen an der Höhle C
const split = () => ({
    1: { name: 'A', wall: midWall, doors: [[2, 3, 3, 1, 15], [2, 26, 3, 28, 15]] },
    2: { name: 'C', wall: free, doors: [[1, 1, 15, 3, 3], [1, 28, 15, 26, 3]] }
});

// 1. Alle Mobs hinter der Mauer, Weg über die Höhle
let t = setup({ maps: split(), start: 1, xy: [5, 5], mobs: { 1: [{ id: 11, x: 25, y: 20 }] } });
t.run(90000);
check('Mob hinter der Mauer: läuft über die Höhle und greift an', t.atk.includes(11), 'Karten ' + t.visits.join('→'));
check('kommt auf der anderen Seite an', t.cur === 1 && t.hero.d.x > 15, 'x=' + t.hero.d.x);

// 2. Erst die erreichbaren Mobs, dann der Umweg
t = setup({ maps: split(), start: 1, xy: [5, 5], mobs: { 1: [{ id: 11, x: 25, y: 20 }, { id: 12, x: 8, y: 8 }] } });
t.run(90000);
check('erst der Mob auf der eigenen Seite, dann der Umweg', t.atk[0] === 12 && t.atk[1] === 11, t.atk.join());

// 3. Umweg abgeschaltet: bleibt auf der Karte, kein Absturz
t = setup({ maps: split(), start: 1, xy: [5, 5], mobs: { 1: [{ id: 11, x: 25, y: 20 }] }, cfg: { detour: false } });
t.run(30000);
check('Umweg aus: verlässt die Karte nicht', t.visits.length === 1 && !t.atk.length);

// 4. Route: alle Mobs hinter der Mauer, kein Weg dorthin → weiter zur nächsten Karte statt stehen zu bleiben
let m4 = { 1: { name: 'A', wall: midWall, doors: [[3, 3, 3, 5, 5]] }, 3: { name: 'B', wall: free, doors: [[1, 5, 5, 3, 3]] } };
t = setup({ maps: m4, start: 1, xy: [5, 5], mobs: { 1: [{ id: 11, x: 25, y: 20 }] }, route: ['A', 'B'], world: true });
t.run(25000);
check('kein Umweg bekannt: geht zum Ausgang der Route', t.visits.includes(3), t.visits.join('→'));

// 5. Tür der Route liegt hinter der Mauer: außen herum über die Höhle (Route-Karte B hängt an der rechten Seite von A)
let m5 = { 1: { name: 'A', wall: midWall, doors: [[3, 26, 3, 5, 5], [2, 3, 3, 15, 1]] },
           2: { name: 'C', wall: free, doors: [[1, 15, 1, 3, 3], [3, 28, 28, 5, 6]] },
           3: { name: 'B', wall: free, doors: [[1, 5, 5, 26, 3], [2, 5, 6, 28, 28]] } };
t = setup({ maps: m5, start: 1, xy: [5, 5], route: ['A', 'B'] });
t.run(60000);
check('Tür der Route hinter der Mauer: außen herum', t.visits.join('→').startsWith('1→2→3'), t.visits.join('→'));

// 6. Spiel kennt eine Wand, die col.check nicht meldet: nach ein paar Sekunden aufgeben, nächsten Mob nehmen
let m6 = { 1: { name: 'A', wall: free, doors: [] } };
t = setup({ maps: m6, start: 1, xy: [5, 5], mobs: { 1: [{ id: 11, x: 20, y: 5 }, { id: 12, x: 5, y: 25 }] }, hidden: (m, x) => x === 15 });
t.run(45000);
check('verdeckte Wand: gibt den Mob auf und nimmt den nächsten', t.atk.includes(12) && !t.atk.includes(11), t.logs().filter(l => /nicht hin/.test(l)).slice(-1)[0]);

// 7. Wände werden zu spät geladen: Mob ist in Wahrheit hinter der Mauer, Neueinlesen erkennt das und nimmt den Umweg
t = setup({ maps: split(), start: 1, xy: [5, 5], mobs: { 1: [{ id: 11, x: 25, y: 20 }] }, late: 2500 });
t.run(90000);
check('Wände spät geladen: erkennt die Mauer und nimmt den Umweg', t.atk.includes(11), t.visits.join('→'));

// 8. Einzige Rücktür führt wieder auf die eigene Seite: begrenzt versuchen, dann aufhören
let m8 = { 1: { name: 'A', wall: midWall, doors: [[2, 3, 3, 1, 15], [2, 26, 3, 1, 15]] }, 2: { name: 'C', wall: free, doors: [[1, 1, 15, 3, 3]] } };
t = setup({ maps: m8, start: 1, xy: [5, 5], mobs: { 1: [{ id: 11, x: 25, y: 20 }] } });
t.run(120000);
const trips = t.visits.filter(v => v === 2).length;
check('Rücktür führt falsch: keine Endlosschleife, zurück auf der Karte', trips <= 2 && t.cur === 1, trips + '× Höhle, ' + t.logs().filter(l => /Umweg/.test(l)).slice(-1)[0]);
