const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t);');
// 1 = Stadt (durch Mauer bei x=10 geteilt), 2 = Ziel, 3 = Höhle. Tür Stadt→Ziel liegt hinter der Mauer (x=18).
const NAMES = { 1: 'Stadt', 2: 'Ziel', 3: 'Höhle' };
const G = { 1: [[2, 18, 5], [3, 2, 9]], 2: [[1, 18, 5], [3, 0, 5]], 3: [[1, 2, 9], [2, 19, 5]] };
const wallOn = (m, x, y) => m === 1 && x === 10;
const world = {}; for (const id in G) world[id] = [20, 20, 'pl_' + NAMES[id], G[id], []];
let cur = 1, visits = [], now = 0, tgt = null;
const hero = { d: { x: 3, y: 5, lvl: 30 }, autoGoTo(p) { tgt = p; }, heroAtackRequest() {} };
const go = (m, from) => { cur = m; Engine.map.d.name = NAMES[m]; Engine.map.d.id = m; const b = G[m].find(g => g[0] === from); hero.d.x = b ? b[1] : 5; hero.d.y = b ? b[2] : 5; tgt = null; };
const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: () => [] }, deadController: {},
  map: { d: { id: 1, name: 'Stadt' }, size: { x: 20, y: 20 }, col: { check: (x, y) => wallOn(cur, x, y) ? 1 : 0 },
    getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const store = { mbworld: world, mbauto: { on: false, pauseMin: 0, pauseMax: 0 } };
const timers = [];
const sb = { unsafeWindow: { Engine }, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v,
  document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null }, innerWidth: 1400, innerHeight: 900,
  setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
const T = n => { for (let i = 0; i < n; i++) { now += 200;
  if (tgt) { // Held läuft nur, wenn das Ziel auf seiner Seite der Mauer liegt
    const side = x => cur === 1 ? (x < 10 ? 0 : 1) : 0;
    if (side(tgt.x) === side(hero.d.x)) { hero.d.x += Math.sign(tgt.x - hero.d.x); if (hero.d.x === tgt.x) hero.d.y += Math.sign(tgt.y - hero.d.y);
      const g = G[cur].find(g => g[1] === hero.d.x && g[2] === hero.d.y); if (g && hero.d.x === tgt.x && hero.d.y === tgt.y) { visits.push(NAMES[cur] + '→' + NAMES[g[0]]); go(g[0], cur); } } }
  timers[0](); } };
T(1); store.mbauto.travel = { to: [2], label: 'Ziel', then: 'stop' };
T(300);
console.log('Weg:', visits.join(' '), '| angekommen:', NAMES[cur], '| Zeit', (now / 1000).toFixed(0), 's');
