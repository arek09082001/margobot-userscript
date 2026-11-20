// Ab 7.41: Leere Karte ohne Ausgang → nicht stehen bleiben, sondern zum nächsten XP-Ort / Jagdort / zur nächsten Routenkarte.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t); logs.push(t);')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg }; })();');
// 1 ↔ 2 ↔ 3 in einer Reihe; jede Karte laut Weltkarte mit Wölfen Lvl 20
const NAMES = { 1: 'Eins', 2: 'Zwei', 3: 'Drei' };
const G = { 1: [[2, 19, 5]], 2: [[1, 0, 5], [3, 19, 5]], 3: [[2, 0, 5]] };
const world = {}; for (const id in G) world[id] = [20, 20, 'pl_' + NAMES[id], G[id], [['Wilk', 20, 6]]];
let fail = 0;
const check = (name, ok, info) => { console.log((ok ? 'OK     ' : 'FEHLER ') + name + (info ? ' | ' + info : '')); if (!ok) fail = 1; };

function setup(settings) {
    let cur = 1, now = 0, changedAt = -1e9, nextId = 100, npcs = [];
    const logs = [], visits = [], seen = new Set();
    const spawn = m => { if (seen.has(m)) return []; seen.add(m); return [0, 1].map(k => ({ d: { id: nextId++, nick: 'Wilk', lvl: 20, x: 6 + k * 4, y: 12, type: 2, icon: 'zwi/wilk.gif' } })); };
    const go = (m, from) => {
        cur = m; changedAt = now; Engine.map.d = { id: m, name: NAMES[m] }; visits.push(m); npcs = spawn(m);
        const back = from && G[m].find(g => g[0] === from);
        hero.d.x = back ? back[1] : 10; hero.d.y = back ? back[2] : 10;
    };
    const hero = { d: { x: 10, y: 10, lvl: 20, exp: 0, warrior_stats: { hp: 1000, maxhp: 1000 } },
        autoGoTo(p) { hero.d.x = p.x; hero.d.y = p.y; const g = G[cur].find(g => g[1] === p.x && g[2] === p.y); if (g) go(g[0], cur); },
        heroAtackRequest(id) { npcs = npcs.filter(n => n.d.id !== id); } };
    const Engine = { hero, battle: { show: false }, deadController: { isDead: () => false }, npcs: { getDrawableList: () => npcs },
        map: { d: { id: 1, name: 'Eins' }, size: { x: 20, y: 20 }, col: { check: () => (now - changedAt < 600 ? 1 : 0) },
            getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
    const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {} });
    const W = { Engine, _g() {}, prompt: () => null, confirm: () => true }, timers = [];
    const store = { mbworld: world, mbauto: Object.assign({ humanize: 0, on: false, pauseMin: 0, pauseMax: 0, lvlOn: true, lvlMin: 18, lvlMax: 22, fogExplore: false }, settings) };
    const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v, GM_notification() {}, logs,
        document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
        innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
    new Function(...Object.keys(sb), src)(...Object.values(sb));
    go(1);
    const T = n => { for (let i = 0; i < n; i++) { now += 200; timers[0](); } };
    T(3); W.test.cfg.on = true;
    return { T, logs, visits, t: W.test, get cur() { return cur; } };
}

{   // XP-Modus: leer → nächster XP-Ort, die zuletzt verlassenen auslassen
    const s = setup({});
    s.T(600);
    check('XP-Modus: leere Karte → weiter zu den anderen XP-Orten', s.visits.includes(2) && s.visits.includes(3) && s.logs.some(l => /Karte leer – weiter zum XP-Ort/.test(l)), s.visits.join('→'));
    const firstLeave = s.logs.findIndex(l => /Karte leer – weiter/.test(l)), lastKill = s.logs.findIndex(l => /Kampf vorbei/.test(l));
    check('… erst nach den Kämpfen auf der Karte', lastKill >= 0 && firstLeave > lastKill);
}
{   // Route mit nur einer Karte: anderer Jagdort wird zur Route
    const s = setup({ mode: 'route', route: 'Nur Eins', routes: { 'Nur Eins': { maps: [1], lvlOn: true, lvlMin: 18, lvlMax: 22 } } });
    s.T(400);
    check('Route mit einer Karte: leer → anderer Jagdort', s.t.cfg.route !== 'Nur Eins' && s.visits.length > 1 && s.logs.some(l => /weiter zum Jagdort/.test(l)), `Route „${s.t.cfg.route}“, Karten ${s.visits.join('→')}`);
}
{   // Route 1 → 3, aber Karte 1 hat keine Tür zu 3: über die Weltkarte (durch 2) hin
    const s = setup({ mode: 'route', route: 'Eins-Drei', routes: { 'Eins-Drei': { maps: [1, 3], mode: 'loop', lvlOn: true, lvlMin: 18, lvlMax: 22 } } });
    s.T(400);
    check('Route ohne direkte Tür: über Karte 2 zur nächsten Routenkarte', s.visits.includes(3) && s.visits.indexOf(2) < s.visits.indexOf(3), s.visits.join('→'));
}
process.exit(fail);
