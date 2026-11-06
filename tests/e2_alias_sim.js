// .com: gleicher Mob-Level darf weder Name noch Laufziel einer E2 vortäuschen.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg, e2Find, e2Hits }; })();');
let npcs = [], now = 0;
const walks = [], attacks = [], timers = [];
const t = { nick: 'Szczęt alias Gładki', lvl: 47, map: 2308, x: 12, y: 76, gameNick: 'Zwykły zbir' };
const E2 = { on: true, sel: 'test', away: 'stay', reactMin: 0, reactMax: 0, list: { test: t } };
const hero = { d: { x: 5, y: 5, lvl: 50 }, autoGoTo(p) { walks.push({ ...p }); hero.d.x = p.x; hero.d.y = p.y; },
    heroAtackRequest(id) { attacks.push(id); } };
const Engine = { hero, battle: { show: false }, deadController: {}, npcs: { getDrawableList: () => npcs.map(d => ({ d })) },
    map: { d: { id: 2308, name: 'Old Merchant Trail' }, size: { x: 96, y: 100 }, col: { check: () => 0 }, getGateways: () => ({ townnames: {}, getList: () => [] }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, set innerHTML(v) {} });
const W = { Engine }, store = { mbworld: { 2308: [96, 100, 'Stary Kupiecki Trakt', [], [['Szczęt alias Gładki', 47, 1, [12, 76], 'e2/zbir-szczet.gif']]] },
    mbauto: { e2: E2, pauseMin: 0, pauseMax: 0 } };
const sandbox = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v,
    document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null },
    innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
const target = W.test.cfg.e2.list.test;
assert.equal(W.test.e2Hits('Smoothly')[0].nick, 'Szczęt alias Gładki');
assert.equal(target.gameNick, undefined, 'Alten nur per Level gelernten Namen entfernen');
const ordinary = { id: 1, nick: 'Zwykły zbir', lvl: 47, type: 2, x: 12, y: 76, icon: 'hum/zbir.gif' };
const real = { id: 2, nick: 'Raze aka Smoothly', lvl: 47, type: 0, x: 60, y: 20, icon: 'https://micc.garmory-cdn.cloud/obrazki/npc/e2/zbir-szczet.gif?v=7' };
npcs = [ordinary];
assert.equal(W.test.e2Find(target), null, 'Normalen Mob gleichen Levels nicht als E2 erkennen');
target.gameNick = ordinary.nick; // Auch ein noch nicht migrierter/falsch gelernter Altwert zählt nicht.
assert.equal(W.test.e2Find(target), null);
npcs = [ordinary, real];
assert.equal(W.test.e2Find(target).id, 2, 'Englischen Alias außerhalb des alten Spawnradius erkennen');
const translated = { ...real, nick: 'Andere Übersetzung' };
npcs = [ordinary, translated];
assert.equal(W.test.e2Find(target).id, 2);
assert.equal(W.test.e2Find(target).how, 'Grafik');
npcs = [{ ...translated, icon: 'e2/andere-e2.gif' }, ordinary];
assert.equal(W.test.e2Find(target), null, 'Andere E2 gleichen Levels nicht verwechseln');
// Echte Takt-Schleife: vom alten Spawn zum sichtbaren richtigen Gegner, nicht zum normalen Mob.
npcs = [ordinary, real];
for (let i = 0; i < 20; i++) { now += 200; timers[0](); }
assert(walks.some(p => p.x === real.x && p.y === real.y));
assert(!walks.some(p => p.x === ordinary.x && p.y === ordinary.y));
assert(attacks.includes(real.id));
assert(!attacks.includes(ordinary.id));
assert.equal(target.x, real.x);
assert.equal(target.y, real.y);
assert.equal(target.gameNick, real.nick);
assert.equal(target.gameNickVerified, true);
console.log('OK E2 .com: Alias, konkrete Grafik, entfernte Position, korrigierter Spawn und kein falsches Level-Ziel');
