const fs = require('fs');
const file = process.argv[2] || require('path').join(__dirname, '..', 'margobot_auto.user.js');
const src = fs.readFileSync(file, 'utf8');
let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const W = 96, H = 64, wall = new Set();
for (let i = 0; i < 900; i++) wall.add(Math.floor(R() * W) + ',' + Math.floor(R() * H));
let npcs = [];
for (let i = 0; i < 96; i++) { let x, y; do { x = Math.floor(R() * W); y = Math.floor(R() * H); } while (wall.has(x + ',' + y)); npcs.push({ d: { id: i, nick: 'Wolf', lvl: 16, x, y, type: 2, icon: 'zwi/wilk.gif' } }); }
const hero = { d: { x: 48, y: 32, lvl: 18 }, autoGoTo(p) { tgt = p; }, heroAtackRequest(id) { kills++; npcs = npcs.filter(n => n.d.id !== id); } };
let tgt = null, kills = 0;
const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: () => npcs }, deadController: {},
  map: { d: { id: 12, name: 'Old Ruins' }, size: { x: W, y: H }, col: { check: (x, y) => wall.has(x + ',' + y) ? 1 : 0 },
    getGateways: () => ({ townnames: { 2: 'Torneg' }, getList: () => [{ d: { id: 2, x: 47, y: 0 } }] }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const store = { mbauto: { on: true, pauseMin: 0, pauseMax: 0, picked: { wilk: true }, exits: { 'Old Ruins': 2 } } };
const timers = []; let now = 0;
const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null };
const sb = { unsafeWindow: { Engine }, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v,
  document: doc, innerWidth: 1400, setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
const { performance: P } = require('perf_hooks');
const times = [];
for (let i = 0; i < 3000; i++) {
  now += 200;
  if (tgt) { hero.d.x += Math.sign(tgt.x - hero.d.x); hero.d.y += Math.sign(tgt.y - hero.d.y); }
  const t0 = P.now(); timers[0](); times.push(P.now() - t0);
}
console.log('Kills in 3000 Takten:', kills, '| max Takt', Math.max(...times.slice(5)).toFixed(1), 'ms');
