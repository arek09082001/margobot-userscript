const fs = require('fs');
let src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8');
src = src.replace(/\}\)\(\);\s*$/, 'W.__sug = suggestRoutes; })();');
const world = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'margobot_world.json'), 'utf8'));
const Engine = { hero: { d: { x: 47, y: 60, lvl: 41 } }, battle: { show: false }, npcs: { getDrawableList: () => [] },
  map: { d: { id: 2, name: 'Torneg' }, size: { x: 96, y: 64 }, col: { check: () => 0 }, getGateways: () => ({ townnames: {}, getList: () => [] }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const W = { Engine };
const store = { mbworld: world, mbauto: {} };
const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null };
const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v,
  document: doc, innerWidth: 1400, innerHeight: 900, setInterval: () => 0, performance: { now: () => Date.now() } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
for (const [lo, hi] of [[38, 44]]) {
  const t0 = Date.now(), r = W.__sug(lo, hi, 5);
  console.log(`Level ${lo}-${hi} (${Date.now() - t0} ms):`);
  for (const o of r) console.log(`   ${o.name.padEnd(28)} ${String(o.maps.length).padStart(2)} Karten ${String(o.n).padStart(4)} Mobs  ~${Math.round(o.d)} Schritte  | XP/Runde ${Math.round(o.r.xp)} · ${o.r.lvlPct.toFixed(1)} % Level · ${Math.round(o.r.eff*100)} % XP/Mob`);
}
