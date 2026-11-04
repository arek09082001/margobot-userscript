const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t);');
// Karten: 1 Stadt, 2 Wald, 3 A, 4 B, 5 Umweg (lang), 6 Sumpf (nur von 5)
// Spiel-Türen: id = Zielkarte
const NAMES = { 1: 'Town', 2: 'Forest', 3: 'A', 4: 'B', 5: 'Detour', 6: 'Swamp' };
const G = { 1: [[2, 19, 5], [5, 0, 5]], 2: [[1, 0, 5], [3, 19, 5]], 3: [[2, 0, 5], [4, 19, 5]], 4: [[3, 0, 5], [5, 19, 9]],
            5: [[1, 19, 5], [4, 0, 9], [6, 10, 0]], 6: [[5, 10, 19]] };
const world = {};
for (const id in G) world[id] = [20, 20, 'pl_' + NAMES[id], G[id], id === '4' ? [['Wolf', 16, 12]] : id === '6' ? [['Frog', 15, 30]] : []];
const LOCKED = new Set(['5>6']);           // Tür, die nicht aufgeht
let cur = 1, npcs = [], visits = [], dead = false, changedAt = -1e9, attacks = 0, attackedOn = [];
const go = (m, from) => {
    cur = m; changedAt = now; npcs = m !== 4 ? [{ d: { id: 100 + m, nick: 'Wegmob', lvl: 16, x: 6, y: 6, type: 2, icon: 'zwi/x.gif' } }] : [{ d: { id: 77, nick: 'Wolf', lvl: 16, x: 8, y: 6, type: 2, icon: 'zwi/wilk.gif' } }, { d: { id: 78, nick: 'Wolf', lvl: 16, x: 3, y: 12, type: 2, icon: 'zwi/wilk.gif' } }]; Engine.map.d.name = NAMES[m]; Engine.map.d.id = m;
    const back = from && G[m].find(g => g[0] === from);
    hero.d.x = back ? back[1] : 10; hero.d.y = back ? back[2] : 10;
};
const hero = { d: { x: 10, y: 10, lvl: 18 }, autoGoTo(p) {
    hero.d.x = p.x; hero.d.y = p.y;
    const g = G[cur].find(g => g[1] === p.x && g[2] === p.y);
    if (g && !LOCKED.has(cur + '>' + g[0])) { visits.push(NAMES[cur] + '→' + NAMES[g[0]]); go(g[0], cur); }
}, heroAtackRequest(id) { attacks++; attackedOn.push(NAMES[cur] + ':' + id); npcs = npcs.filter(n => n.d.id !== id); } };
const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: () => npcs }, deadController: { isDead: () => dead },
  map: { d: { id: 1, name: 'Town' }, size: { x: 20, y: 20 }, col: { check: () => (now - changedAt < 1000 ? 1 : 0) },
    getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const store = { mbworld: world, mbauto: { on: false, pauseMin: 0, pauseMax: 0 } };
const timers = []; var now = 0;
const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null };
const sb = { unsafeWindow: { Engine }, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v,
  document: doc, innerWidth: 1400, setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
const T = n => { for (let i = 0; i < n; i++) { now += 200; timers[0](); } };
const st = () => store.mbauto;


go(1); T(1); st().lvlOn = true; st().lvlMin = 14; st().lvlMax = 20;
st().routes = { R: { maps: [4], mode: 'back' } }; st().route = 'R'; st().on = true;
T(200);
console.log('Route [B]:', visits.join(' '), '| Angriffe:', attackedOn.join(' '));
// kein Weg: Route auf eine Karte, die es nicht gibt → nichts angreifen, warten
visits = []; attackedOn = []; st().routes = { R2: { maps: [999] } }; st().route = 'R2'; go(1); T(60);
console.log('Route ohne Weg:', visits.join(' ') || '(bleibt stehen)', '| Angriffe:', attackedOn.join(' ') || 'keine');
