const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t);');
let seed = 3; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const W = 60, H = 40, wall = new Set();
for (let x = 10; x < 50; x++) if (x !== 30) wall.add(x + ',20');           // Mauer mit Lücke
let all = [];
for (let i = 0; i < 20; i++) { let x, y; do { x = Math.floor(R() * W); y = Math.floor(R() * H); } while (wall.has(x + ',' + y)); all.push({ d: { id: i + 1, nick: 'Ghul', lvl: 41, x, y, type: 2, icon: 'hum/ghul.gif' } }); }
const hero = { d: { x: 2, y: 2, lvl: 41, exp: 0 }, autoGoTo(p) { tgt = p; }, heroAtackRequest(id) { kills++; all = all.filter(n => n.d.id !== id); } };
let tgt = null, kills = 0, now = 0;
const near = () => all.filter(n => Math.abs(n.d.x - hero.d.x) <= 7 && Math.abs(n.d.y - hero.d.y) <= 7);   // Nebel
const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: near }, deadController: {},
  map: { d: { id: 500, name: 'Defiled Tomb' }, size: { x: W, y: H }, col: { check: (x, y) => wall.has(x + ',' + y) ? 1 : 0 },
    getGateways: () => ({ townnames: {}, getList: () => [] }) } };
const world = { 500: [W, H, 'Grobowiec', [], [['Ghul', 41, 20]]] };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const store = { mbworld: world, mbauto: { on: true, pauseMin: 0, pauseMax: 0, lvlOn: true, lvlMin: 40, lvlMax: 42 } };
const timers = [];
const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null };
const sb = { unsafeWindow: { Engine }, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v,
  document: doc, innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
// Held läuft 1 Feld pro Takt (BFS-frei, Mauer: an Lücke vorbei vereinfacht → gerade Linie, Mauer blockt)
for (let i = 0; i < 4000 && all.length; i++) {
  now += 200;
  if (tgt && !(tgt.x === hero.d.x && tgt.y === hero.d.y)) {
    const prev = new Map([[hero.d.x + ',' + hero.d.y, null]]), q = [[hero.d.x, hero.d.y]]; let found = null;
    while (q.length && !found) { const [x, y] = q.shift(); for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev.has(k) || (wall.has(k) && !(nx === tgt.x && ny === tgt.y))) continue; prev.set(k, x + ',' + y);
      if (nx === tgt.x && ny === tgt.y) { found = k; break; } q.push([nx, ny]); } }
    if (found) { let k = found; while (prev.get(k) !== hero.d.x + ',' + hero.d.y) k = prev.get(k); const [nx, ny] = k.split(',').map(Number); if (!wall.has(k)) { hero.d.x = nx; hero.d.y = ny; } }
  }
  timers[0]();
}
console.log('Kills', kills, 'von 20 | Zeit', (now / 1000).toFixed(0), 's');
