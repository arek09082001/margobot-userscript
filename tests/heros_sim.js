// Heros: synthetische Spawnliste, keine Behauptung über tatsächliche Spiel-Spawns.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace(/\}\)\(\);\s*$/,
    'W.test = { cfg, useHeros, herosPlan, herosStart, herosStop, herosTab, HEROS_SPAWNS, mergeHeros }; })();');
function setup(real = false, wall = false) {
    let now = 0, cur = 1, npcs = [], dead = false;
    const hits = [], visits = [], walks = [], sounds = [], notifications = [], timers = [];
    const synthetic = { 1: [[2, 19, 5]], 2: [[1, 0, 5]], 3: [] };
    const world = real ? JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'margobot_world.json'), 'utf8')) : Object.fromEntries([1, 2, 3].map(id => [id, [20, 10, 'Karte ' + id, synthetic[id], []]]));
    const graph = Object.fromEntries(Object.entries(world).map(([id, m]) => [id, m[3]]));
    if (real) cur = 33;
    const hero = { d: { x: 1, y: 5, lvl: 50 }, autoGoTo(p) {
        walks.push({ ...p });
        hero.d.x = p.x; hero.d.y = p.y;
        const g = graph[cur].find(g => g[1] === p.x && g[2] === p.y);
        if (g) { cur = g[0]; Engine.map.d = { id: cur, name: 'Karte ' + cur }; visits.push(cur); hero.d.x = cur === 2 ? 0 : 19; }
    }, heroAtackRequest(id) { hits.push(id); } };
    const Engine = { hero, battle: { show: false }, deadController: { isDead: () => dead }, npcs: { getDrawableList: () => npcs },
        map: { d: { id: cur, name: world[cur][2] }, size: { x: world[cur][0], y: world[cur][1] }, col: { check: (x, y) => wall && cur === 1 && x === 10 ? 1 : 0 },
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
    return { ...W.test, data, store, visits, walks, sounds, notifications, hits, hero, W,
        die: () => { dead = true; }, npcs: list => npcs = list, tick: n => { for (let i = 0; i < n; i++) { now += 200; timers[0](); } } };
}
let t = setup();
assert(t.herosTab().includes('Złodziej'));
assert(t.herosTab().includes('Karmazyn'));
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

// Nutzerliste: alle Punkte unverändert vorinstalliert, gleicher Stand wie die dokumentierte Quelle.
t = setup(true);
const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/heros-spawns.json'), 'utf8'));
assert.deepEqual(t.HEROS_SPAWNS, bundled);
assert.deepEqual(bundled.map(h => [h.name, h.points.length]), [['Złodziej', 32], ['Karmazyn', 39]]);
const world = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'margobot_world.json'), 'utf8'));
for (const h of bundled) {
    const seen = new Set();
    for (const p of h.points) {
        const m = world[p.map]; assert(m);
        assert(p.x >= 0 && p.x < m[0] && p.y >= 0 && p.y < m[1]);
        const key = `${p.map}:${p.x},${p.y}`; assert(!seen.has(key)); seen.add(key);
    }
    const plan = t.herosPlan(h.points);
    assert.equal(plan.missing.length, 0, h.name + ': bekannte Kartenwege von Eder');
    assert.equal(plan.route.length, h.points.length);
    assert(plan.after <= plan.before, h.name + ': Optimierung darf den geschätzten Kartenweg nicht verlängern');
    assert(Number.isFinite(plan.after));
    for (let i = 1; i < plan.path.length; i++) assert(world[plan.path[i - 1]][3].some(g => g[0] === plan.path[i]), 'Geplante Kartenfolge enthält echte Türen einschließlich Zwischenkarten');
    const sequence = plan.route.map(p => p.map).filter((id, i, a) => !i || id !== a[i - 1]);
    assert.equal(sequence.length, new Set(sequence).size, 'Spawnpunkte einer Karte zusammenhängend besuchen');
    assert.deepEqual(new Set(plan.route.map(p => `${p.map}:${p.x},${p.y}`)), seen);
}
assert(!bundled[0].points.some(p => p.map === 33), 'Eder ist nur eine Überschrift');
assert(!bundled[1].points.some(p => p.map === 244), 'Fort Eder ist in der zweiten Liste nur eine Überschrift');
assert.equal(bundled[0].points.filter(p => p.map === 2352).length, 2);
const custom = { name: 'Złodziej', source: 'Eigene Ergänzung', points: [{ map: 33, x: 2, y: 2 }] };
const merged = t.mergeHeros([custom]);
assert.strictEqual(merged.find(h => h.name === 'Złodziej'), custom);
assert(merged.some(h => h.name === 'Karmazyn'), 'Import darf andere mitgelieferte Heros nicht entfernen');
console.log('OK Vorgegebene Heros: 32 Złodziej- und 39 Karmazyn-Punkte, Koordinaten, Kartenwege, vollständige Besuchsreihenfolge und Import-Erhalt');
// Vorinstallierten Hero tatsächlich auswählen: Fund erkennt auch Schreibweise ohne polnische Diakritika.
t = setup(true); t.cfg.heros.selected = 'Złodziej';
assert(t.herosStart());
t.npcs([{ d: { id: 123, nick: 'ZLODZIEJ', type: 0, x: 4, y: 5 } }]); t.tick(10);
assert.equal(t.cfg.heros.on, false);
assert.equal(t.cfg.heros.found.name, 'ZLODZIEJ');
assert.equal(t.sounds.length, 3);
assert.equal(t.notifications.length, 1);
assert.equal(t.hits.length, 0);

// Kurzname in der Auswahl und vollständiger NPC-Name im Spiel.
t = setup(true); t.cfg.heros.selected = 'Karmazyn'; assert(t.herosStart());
t.npcs([{ d: { id: 124, nick: 'Karmazynowy Mściciel', type: 0, x: 4, y: 5 } }]); t.tick(10);
assert.equal(t.cfg.heros.on, false);
assert.equal(t.cfg.heros.found.name, 'Karmazynowy Mściciel');
assert.equal(t.sounds.length, 3);

// Überlappende Sichtbereiche: zwei Spawnpunkte vom selben Standpunkt prüfen, ohne hinzulaufen.
t = setup(); t.useHeros(JSON.stringify([{ name: 'Sichttest', points: [{ map: 1, x: 4, y: 5 }, { map: 1, x: 6, y: 5 }] }]));
t.cfg.heros.sight = 5; assert(t.herosStart()); t.tick(30);
assert.equal(t.cfg.heros.on, false);
assert.equal(t.cfg.heros.checked, 2);
assert.equal(t.hero.d.x, 1); assert.equal(t.hero.d.y, 5);
assert(!t.walks.some(p => p.x === 4 || p.x === 6));
// Außer Sicht: nur bis an den Rand des Sichtbereichs, nicht bis zum Spawnpunkt gehen.
t = setup(); t.useHeros(JSON.stringify([{ name: 'Sichttest', points: [{ map: 1, x: 15, y: 5 }] }]));
t.cfg.heros.sight = 5; assert(t.herosStart()); t.tick(30);
assert.equal(t.cfg.heros.checked, 1);
assert.equal(t.hero.d.x, 10);
assert(!t.walks.some(p => p.x === 15 && p.y === 5));
// Sichtbarer Hero: kein Alarm beim ersten Sehen, erst nach tatsächlicher Annäherung auf ein Feld.
t = setup(); t.useHeros(JSON.stringify([{ name: 'Sichttest', points: [{ map: 1, x: 15, y: 5 }] }]));
t.cfg.pauseMin = t.cfg.pauseMax = 0; assert(t.herosStart());
t.npcs([{ d: { id: 123, nick: 'Sichttest', type: 0, x: 15, y: 5 } }]);
t.tick(1); assert.equal(t.sounds.length, 0); assert.equal(t.cfg.heros.on, true);
t.tick(1); assert.equal(t.sounds.length, 3); assert.equal(t.cfg.heros.on, false);
assert(Math.max(Math.abs(t.hero.d.x - 15), Math.abs(t.hero.d.y - 5)) <= 1);
assert.equal(t.hits.length, 0);
console.log('OK Heros-Optimierung: Karten gebündelt, Kartenkosten verbessert, überlappende Sichtbereiche, Rand des Nebels und Fundton erst auf 1 Feld');

// Sichtbarer, aber abgeschnittener Hero: nicht fälschlich Nähe bestätigen oder angreifen.
t = setup(false, true); t.useHeros(JSON.stringify([{ name: 'Sichttest', points: [{ map: 1, x: 15, y: 5 }] }]));
t.cfg.pauseMin = t.cfg.pauseMax = 0; assert(t.herosStart());
t.npcs([{ d: { id: 123, nick: 'Sichttest', type: 0, x: 15, y: 5 } }]); t.tick(2);
assert.equal(t.cfg.heros.on, false);
assert(t.cfg.heros.status.includes('kein Weg'));
assert.equal(t.sounds.length, 0);
assert.equal(t.hits.length, 0);
