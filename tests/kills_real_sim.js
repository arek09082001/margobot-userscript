const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'W.__sess = sess; })();');
let npcs = [5, 6, 7].map((id, k) => ({ d: { id, nick: 'Aligator', lvl: 225, x: 10 + k, y: 5, type: 2, grp: 9, icon: 'x/aligator.gif' } }))
  .concat([{ d: { id: 8, nick: 'Krokodyl', lvl: 225, x: 20, y: 5, type: 2, grp: 0, icon: 'x/krok.gif' } }]);
let tgt = null, now = 0, fightLeft = 0, fightIds = [], pendingXp = 0;
const battle = { show: false };
const hero = { d: { x: 8, y: 5, lvl: 225, exp: 0 }, autoGoTo(p) { tgt = p; },
  heroAtackRequest(id) { const m = npcs.find(n => n.d.id === id); if (!m) return; fightIds = m.d.grp ? npcs.filter(n => n.d.grp === m.d.grp).map(n => n.d.id) : [id]; fightLeft = 4; pendingXp = 150000 * fightIds.length; } };
const Engine = { hero, battle, npcs: { getDrawableList: () => npcs }, deadController: {},
  map: { d: { id: 1, name: 'Bagno' }, size: { x: 30, y: 10 }, col: { check: () => 0 }, getGateways: () => ({ townnames: {}, getList: () => [] }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const W = { Engine };
const store = { mbauto: { on: true, pauseMin: 800, pauseMax: 800, lvlOn: true, lvlMin: 220, lvlMax: 230 } };
const timers = [];
const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v,
  document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null }, innerWidth: 1400, innerHeight: 900,
  setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
hero.d.exp = 2.56e9; hero.d.lvl = 226;
for (let i = 0; i < 400; i++) {
  now += 200;
  if (fightIds.length && --fightLeft < 0) { npcs = npcs.filter(n => !fightIds.includes(n.d.id)); hero.d.exp += pendingXp; fightIds = []; }   // Kampf ohne Fenster: Gruppe weg, XP dazu
  if (i === 200) hero.d.exp += 5e9;   // Sprung (z. B. Neuladen) darf nicht zählen
  if (tgt && !battle.show) { hero.d.x += Math.sign(tgt.x - hero.d.x); }
  timers[0]();
}
console.log('Kills gezählt:', W.__sess.kills, '(erwartet 4) | XP gezählt:', W.__sess.xp, '(erwartet 600000) | Mobs übrig:', npcs.length);
