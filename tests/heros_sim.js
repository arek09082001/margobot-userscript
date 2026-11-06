// Heros: synthetische Spawnliste, keine Behauptung über tatsächliche Spiel-Spawns.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace(/\}\)\(\);\s*$/,
    'W.test = { cfg, useHeros, herosPlan, herosStart, herosStop, herosTab }; })();');
function setup() {
    let now = 0, cur = 1, npcs = [], dead = false;
    const hits = [], visits = [], sounds = [], notifications = [], timers = [];
    const graph = { 1: [[2, 19, 5]], 2: [[1, 0, 5]], 3: [] };
    const world = Object.fromEntries([1, 2, 3].map(id => [id, [20, 10, 'Karte ' + id, graph[id], []]]));
    const hero = { d: { x: 1, y: 5, lvl: 50 }, autoGoTo(p) {
        hero.d.x = p.x; hero.d.y = p.y;
        const g = graph[cur].find(g => g[1] === p.x && g[2] === p.y);
        if (g) { cur = g[0]; Engine.map.d = { id: cur, name: 'Karte ' + cur }; visits.push(cur); hero.d.x = cur === 2 ? 0 : 19; }
    }, heroAtackRequest(id) { hits.push(id); } };
    const Engine = { hero, battle: { show: false }, deadController: { isDead: () => dead }, npcs: { getDrawableList: () => npcs },
        map: { d: { id: 1, name: 'Karte 1' }, size: { x: 20, y: 10 }, col: { check: () => 0 },
            getGateways: () => ({ townnames: { 1: 'Karte 1', 2: 'Karte 2' }, getList: () => graph[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
    class Audio {
        constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
        resume() { return Promise.resolve(); }
        createOscillator() { return { frequency: {}, connect() {}, start() { sounds.push(1); }, stop() {} }; }
        createGain() { return { gain: {}, connect() {} }; }
    }
    const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null,
        querySelectorAll: () => [], closest: () => null, set innerHTML(v) {} });
    const W = { Engine, AudioContext: Audio }, store = { mbworld: world, mbauto: {} };
    const sandbox = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v,
        GM_notification: n => notifications.push(n), document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null },
        innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
    new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
    const data = [{ name: 'Testhero', source: 'Simulationsdaten', points: [{ map: 2, x: 12, y: 5 }, { map: 1, x: 5, y: 5 }] }];
    return { ...W.test, data, store, visits, sounds, notifications, hits, hero, W,
        die: () => { dead = true; }, npcs: list => npcs = list, tick: n => { for (let i = 0; i < n; i++) { now += 200; timers[0](); } } };
}
let t = setup();
assert(t.herosTab().includes('Noch keine belegte Spawnliste'));
assert(!t.herosStart());
t.useHeros(JSON.stringify(t.data));
assert.equal(t.cfg.heros.selected, 'Testhero');
assert.equal(t.herosPlan(t.data[0].points).route[0].map, 1, 'Nächsten Spawnpunkt zuerst besuchen');
assert(t.herosStart());
t.tick(100);
assert.equal(t.cfg.heros.on, false);
assert.equal(t.cfg.heros.rounds, 1);
assert.equal(t.cfg.heros.checked, 2);
assert.deepEqual(t.visits, [2]);
assert.equal(t.sounds.length, 0, 'Kein Fundton am Rundenende');
assert.deepEqual(t.hits, [], 'Keine Mobs angreifen');
t = setup(); t.useHeros(JSON.stringify(t.data)); t.cfg.heros.repeat = true; t.herosStart(); t.tick(120);
assert(t.cfg.heros.on && t.cfg.heros.rounds >= 2, 'Mehrere Suchrunden laufen');
t.npcs([{ d: { id: 99, nick: 'Testhero', type: 0, x: 7, y: 5 } }]); t.tick(10);
assert.equal(t.cfg.heros.on, false);
assert.equal(t.cfg.heros.found.name, 'Testhero');
assert.equal(t.sounds.length, 3);
assert.equal(t.notifications.length, 1);
t.tick(20); assert.equal(t.notifications.length, 1, 'Fund nur einmal melden');
assert.equal(t.hits.length, 0);
// Andere Namen lösen den Fundalarm nicht aus.
t = setup(); t.useHeros(JSON.stringify(t.data)); t.herosStart();
t.npcs([{ d: { id: 99, nick: 'Anderer Testhero', x: 5, y: 5 } }]); t.tick(5);
assert.equal(t.notifications.length, 0);
t.herosStop('Von Hand'); t.tick(40); assert.equal(t.cfg.heros.on, false);
// Katalogimport atomar validieren; gültigen Bestand nach Fehler erhalten.
const original = t.store.mbheros;
assert.throws(() => t.useHeros(JSON.stringify([{ name: 'Falsch', points: [{ map: 999, x: 0, y: 0 }] }])));
assert.strictEqual(t.store.mbheros, original);
assert.throws(() => t.useHeros(JSON.stringify([{ name: 'Falsch', points: [{ map: 1, x: 20, y: 0 }] }])));
assert.throws(() => t.useHeros(JSON.stringify([t.data[0], t.data[0]])));
// Unbekannte Anreise als ungeprüft erhalten, nicht als abgesucht zählen.
t = setup(); t.useHeros(JSON.stringify([{ name: 'Testhero', points: [{ map: 1, x: 5, y: 5 }, { map: 3, x: 5, y: 5 }] }]));
t.herosStart(); t.tick(50);
assert.equal(t.cfg.heros.checked, 1);
assert.equal(t.cfg.heros.skipped.length, 1);
assert(t.cfg.heros.status.includes('nicht geprüft'));
t = setup(); t.useHeros(JSON.stringify(t.data)); t.cfg.e2.on = true;
assert.equal(t.herosStart(), false, 'Nicht parallel zur E2-Jagd starten');
console.log('OK Heros: Routenreihenfolge, einmal/wiederholen, Fundton, kein Angriff, Stoppen, Importvalidierung und unerreichbare Punkte');

t = setup(); t.useHeros(JSON.stringify(t.data)); t.herosStart(); t.die(); t.tick(1);
assert.equal(t.cfg.heros.on, false, 'Standardeinstellung stoppt auch Heros-Suche bei Tod');
