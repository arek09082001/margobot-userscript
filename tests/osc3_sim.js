const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8');
let seed = 11; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let npcs = [{ d: { id: 1, nick: 'Ghul', lvl: 41, x: 12, y: 5, type: 2, icon: 'hum/ghul.gif' } }, { d: { id: 2, nick: 'Ghul', lvl: 41, x: 26, y: 5, type: 2, icon: 'hum/ghul.gif' } }];
let tgt = null, now = 0, dirs = [], attacked = null, atk = [];
const hero = { d: { x: 15, y: 5, lvl: 41 }, autoGoTo(p) { tgt = p; }, heroAtackRequest(id) { atk.push(id); if (id === 2) { attacked = id; npcs = npcs.filter(n => n.d.id !== 2); } } };
const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: () => npcs }, deadController: {},
  map: { d: { id: 1, name: 'Flur' }, size: { x: 30, y: 10 }, col: { check: () => 0 }, getGateways: () => ({ townnames: {}, getList: () => [] }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const store = { mbauto: { on: true, pauseMin: 0, pauseMax: 0, lvlOn: true, lvlMin: 40, lvlMax: 42 } };
const timers = [];
const sb = { unsafeWindow: { Engine }, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v,
  document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null }, innerWidth: 1400, innerHeight: 900,
  setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
for (let i = 0; i < 600 && !attacked; i++) {
  now += 200;
  if (false) for (const n of npcs) n.d.x = Math.max(1, Math.min(28, n.d.x + (R() < 0.5 ? -1 : 1)));   // Mobs laufen etwas herum
  if (tgt && i % 3 === 0) { const dx = Math.sign(tgt.x - hero.d.x); if (dx) { dirs.push(dx); hero.d.x += dx; } }
  timers[0]();
}
let rev = 0; for (let k = 1; k < dirs.length; k++) if (dirs[k] !== dirs[k - 1]) rev++;
console.log('Angriffsversuche:', atk.join(','), '| Richtungswechsel:', rev, '| Schritte:', dirs.length, '| angegriffen:', attacked);
