const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8');
function run(loopDoor, mode) {
  const L = ['A', 'B', 'C', 'D', 'E', 'F'];
  const MAPS = {};
  L.forEach((m, i) => { MAPS[m] = { gws: [] }; if (i) MAPS[m].gws.push({ id: i * 10 + 1, x: 0, y: 5, to: L[i - 1] }); if (i < 5) MAPS[m].gws.push({ id: i * 10 + 2, x: 9, y: 5, to: L[i + 1] }); });
  if (loopDoor) { MAPS.F.gws.push({ id: 99, x: 5, y: 9, to: 'A' }); MAPS.A.gws.push({ id: 98, x: 5, y: 0, to: 'F' }); }
  let cur = 'A', visits = [], now = 0;
  const hero = { d: { x: 5, y: 5, lvl: 10 }, autoGoTo(p) { hero.d.x = p.x; hero.d.y = p.y; const g = MAPS[cur].gws.find(g => g.x === p.x && g.y === p.y); if (g) { visits.push(g.to); cur = g.to; Engine.map.d.name = cur; Engine.map.d.id = cur; hero.d.x = 5; hero.d.y = 5; } }, heroAtackRequest() {} };
  const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: () => [] }, deadController: {},
    map: { d: { id: 'A', name: 'A' }, size: { x: 10, y: 10 }, col: { check: () => 0 },
      getGateways: () => ({ townnames: Object.fromEntries(MAPS[cur].gws.map(g => [g.id, g.to])), getList: () => MAPS[cur].gws.map(g => ({ d: g })) }) } };
  const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
  const route = { maps: ['A', null, 'B', 'B', 'C', 'null', 'D', 'E', 'F'] }; if (mode) route.mode = mode;
  const store = { mbauto: { on: true, pauseMin: 0, pauseMax: 0, routes: { R: route }, route: 'R' } };
  const timers = [];
  const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null };
  const sb = { unsafeWindow: { Engine }, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v,
    document: doc, innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
  new Function(...Object.keys(sb), src)(...Object.values(sb));
  for (let i = 0; i < 400; i++) { now += 200; timers[0](); }
  return 'A ' + visits.join(' ');
}
console.log('ohne Tür F→A, Standard  :', run(false));
console.log('mit Tür F→A, „im Kreis“ :', run(true, 'loop'));
console.log('mit Tür F→A, „zurück“   :', run(true, 'back'));
