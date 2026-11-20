// Ab 7.40: Nach dem Wiederbeleben kann sich der Held eine Weile nicht bewegen. Dabei darf keine Tür als
// „nicht erreichbar“ gesperrt werden, sonst findet die Reise danach den direkten Weg nicht mehr.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t); logs.push(t);')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg }; })();');
// Stadt (1) ↔ Wald (2) ↔ Jagd (3); längerer Umweg Stadt ↔ Sumpf (4) ↔ Moor (5) ↔ Jagd
const NAMES = { 1: 'Stadt', 2: 'Wald', 3: 'Jagd', 4: 'Sumpf', 5: 'Moor' };
const G = { 1: [[2, 19, 5], [4, 10, 19]], 2: [[1, 0, 5], [3, 19, 5]], 3: [[2, 0, 5], [5, 10, 19]], 4: [[1, 10, 0], [5, 19, 10]], 5: [[4, 0, 10], [3, 10, 0]] };
const world = {}; for (const id in G) world[id] = [20, 20, 'pl_' + NAMES[id], G[id], id === '3' ? [['Wilk', 20, 10]] : []];
let cur = 1, now = 0, changedAt = -1e9, dead = false, frozenUntil = 0, killHero = false;
const logs = [], visits = [];
let npcs = [];
const wolves = () => Array.from({ length: 4 }, (_, k) => ({ d: { id: 500 + k + Math.floor(now / 1000) * 10, nick: 'Wilk', lvl: 20, x: 4 + k * 3, y: 12, type: 2, icon: 'zwi/wilk.gif' } }));
const go = (m, from) => {
    cur = m; changedAt = now; Engine.map.d = { id: m, name: NAMES[m] }; visits.push(m);
    npcs = m === 3 ? wolves() : [];
    const back = from && G[m].find(g => g[0] === from);
    hero.d.x = back ? back[1] : 10; hero.d.y = back ? back[2] : 10;
};
const hero = { d: { x: 10, y: 10, lvl: 20, exp: 0, warrior_stats: { hp: 1000, maxhp: 1000 } },
    autoGoTo(p) {
        if (dead || now < frozenUntil) return;                          // betäubt: Befehl kommt nicht an
        hero.d.x = p.x; hero.d.y = p.y;
        const g = G[cur].find(g => g[1] === p.x && g[2] === p.y);
        if (g) go(g[0], cur);
    },
    heroAtackRequest(id) {
        if (killHero) { killHero = false; dead = true; return; }
        npcs = npcs.filter(n => n.d.id !== id);
        if (!npcs.length) npcs = wolves();
    } };
const Engine = { hero, battle: { show: false }, deadController: { isDead: () => dead }, npcs: { getDrawableList: () => npcs },
    map: { d: { id: 1, name: 'Stadt' }, size: { x: 20, y: 20 }, col: { check: () => (now - changedAt < 600 ? 1 : 0) },
        getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {} });
const W = { Engine, _g() {}, prompt: () => null, confirm: () => true }, timers = [];
const store = { mbworld: world, mbauto: { humanize: 0, on: false, pauseMin: 0, pauseMax: 0, lvlOn: true, lvlMin: 18, lvlMax: 22, onDeath: 'back', fogExplore: false } };
const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v, GM_notification() {}, logs,
    document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
const t = W.test;
const T = n => { for (let i = 0; i < n; i++) { now += 200; timers[0](); } };

go(3); T(3); t.cfg.on = true; T(30);
assert.equal(cur, 3, 'jagt auf der Jagdkarte');
// Tod: im nächsten Kampf verlieren, in der Stadt aufwachen, 15 s betäubt
killHero = true; T(20);
assert.ok(dead, 'gestorben');
go(1); T(10);                                                          // Leiche → Stadt
dead = false; frozenUntil = now + 15000; visits.length = 0;
T(500);
let ok = true;
const check = (name, c, info) => { console.log((c ? 'OK     ' : 'FEHLER ') + name + (info ? ' | ' + info : '')); if (!c) ok = false; };
check('keine Tür gesperrt, obwohl der Held 15 s nicht laufen konnte', !(t.cfg.blocked || []).length, JSON.stringify(t.cfg.blocked));
check('… direkter Weg Stadt → Wald → Jagd, kein Umweg über Sumpf und Moor', visits[0] === 2 && visits.includes(3) && !visits.includes(4) && !visits.includes(5), visits.join('→'));
check('… danach wird wieder gejagt', cur === 3 && t.cfg.back == null);
process.exit(ok ? 0 : 1);
