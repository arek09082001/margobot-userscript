// Automatische Rundgänge: Verzweigungen, Einbahnstraßen, Sperren, Übernahme und Routenpositionen.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'W.test = { suggestRoutes, forumRoutes, takeSuggestion, suggestionRange, suggestionsHtml, routeStep, trackMaps, routeSeq, cfg }; })();');
function setup(world, settings = {}) {
    const element = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {},
        querySelector: () => null, querySelectorAll: () => [], closest: () => null, set innerHTML(s) { this.html = s; } });
    const Engine = { hero: { d: { x: 1, y: 1, lvl: 41 } }, battle: { show: false }, npcs: { getDrawableList: () => [] },
        map: { d: { id: 1, name: 'Start' }, size: { x: 20, y: 20 }, col: { check: () => 0 },
            getGateways: () => ({ townnames: {}, getList: () => [] }) } };
    const W = { Engine };
    const store = { mbworld: world, mbauto: settings };
    const sandbox = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v,
        document: { createElement: element, head: element(), body: element(), addEventListener() {}, querySelector: () => null },
        innerWidth: 1400, innerHeight: 900, setInterval: () => 0, performance: { now: () => 0 } };
    new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
    return { ...W.test, Engine };
}
function verify(world, o) {
    assert.equal(o.mode, 'loop');
    const ids = [...new Set(o.maps)];
    assert.equal(o.cards, ids.length);
    assert.equal(o.n, ids.reduce((n, id) => n + world[id][4].filter(m => m[1] >= o.lv[0] && m[1] <= o.lv[1]).reduce((s, m) => s + m[2], 0), 0));
    for (let i = 0; i < o.maps.length; i++) {
        const a = o.maps[i], b = o.maps[(i + 1) % o.maps.length];
        assert.notEqual(a, b);
        assert(world[a][3].some(g => g[0] === b), `Tür ${a}→${b} fehlt`);
    }
}
const graph = { 1: [2], 2: [1, 3, 4], 3: [2], 4: [2, 5], 5: [6], 6: [] };
const world = Object.fromEntries(Object.entries(graph).map(([id, to]) => [id,
    [20, 20, 'Karte ' + id, to.map(t => [t, 1, 1]), [['Wolf', 40, 5]]]]));
let t = setup(world), list = t.suggestRoutes(36, 44, 5);
assert.equal(list.length, 1);
let o = list[0]; verify(world, o);
assert.deepEqual([...new Set(o.maps)].sort(), [1, 2, 3, 4]);
assert.equal(o.n, 20, 'Rückwege dürfen Mobs nicht verdoppeln');
assert.equal(o.maps[0], 1, 'Beginn auf nächster erreichbarer Karte');
assert.equal(t.suggestRoutes(1, 3).length, 0);
assert(t.suggestionsHtml().includes('Aus der Weltkarte berechnet'));
assert(t.suggestionsHtml().includes('data-a="sugtake"'));
// Manuell gespeicherte Route gleichen Namens nicht überschreiben.
const own = { maps: o.maps.slice(), mode: 'back', lvlMin: 1, lvlMax: 300 };
t.cfg.routes[o.name] = own;
assert(t.takeSuggestion(o));
assert.strictEqual(t.cfg.routes[o.name], own);
assert.equal(t.cfg.route, o.name + ' (2)');
assert.equal(t.cfg.on, false, 'Übernahme darf nicht starten');
assert.equal(t.cfg.lvlMin, 40);
assert.equal(t.cfg.lvlMax, 40);
assert.equal(t.cfg.lvlOn, true);
const saved = t.cfg.routes[t.cfg.route];
assert.notStrictEqual(saved.maps, o.maps);
assert.deepEqual(t.routeSeq(saved), o.maps);
// Drei Runden: wiederholte Kreuzungskarten müssen zum richtigen nächsten Ausgang führen.
for (let i = 0; i < o.maps.length * 3; i++) {
    const pos = i % o.maps.length;
    t.Engine.map.d.id = o.maps[pos]; t.Engine.map.d.name = 'Karte ' + o.maps[pos];
    t.trackMaps();
    const step = t.routeStep();
    assert.equal(step.pos, pos);
    assert.equal(step.nextE, o.maps[(pos + 1) % o.maps.length]);
}
t.cfg.on = true;
assert.equal(t.takeSuggestion(o), false);
assert(t.suggestionsHtml().includes('disabled'));
t.cfg.on = false;
assert.deepEqual(t.suggestionRange(), [36, 44]);
t.Engine.hero.d.lvl = 50;
assert.deepEqual(t.suggestionRange(), [45, 53]);
t.cfg.suggestAuto = false; t.cfg.lvlMin = 12; t.cfg.lvlMax = 18;
assert.deepEqual(t.suggestionRange(), [12, 18]);
// Bekannte gesperrte Rücktür schließt die gesamte Verbindung aus.
t = setup(world, { blocked: ['3>2'], blockedAt: { '3>2': Date.now() } });
o = t.suggestRoutes(36, 44)[0]; verify(world, o);
assert(!o.maps.includes(3));
// Ein großer verzweigter Bereich wird vollständig abgedeckt, ohne Zehn-Karten-Grenze.
const large = {};
for (let id = 1; id <= 31; id++) large[id] = [20, 20, 'Karte ' + id,
    [Math.floor(id / 2), id * 2, id * 2 + 1].filter(x => x >= 1 && x <= 31).map(x => [x, 1, 1]), [['Wolf', 40, 5]]];
t = setup(large); o = t.suggestRoutes(36, 44)[0]; verify(large, o);
assert.equal(o.cards, 31);
assert.equal(o.maps.length, 60);
assert.equal(o.n, 155);
// Reale Daten über alle Levelbereiche prüfen, einschließlich Rundenschluss.
const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'margobot_world.json'), 'utf8'));
t = setup(real); t.Engine.map.d.id = 2;
let count = 0;
for (let level = 10; level <= 300; level += 10) {
    t.Engine.hero.d.lvl = level;
    for (const route of t.suggestRoutes(level - 5, level + 3, 1000)) { verify(real, route); count++; }
}
assert(count > 0);
console.log(`OK XP-Rundgänge: Verzweigungen, Sperren, Einbahnstraßen, 31 Karten, Übernahme, drei Runden; ${count} reale Vorschläge validiert`);

// Der Forum-Katalog steht ohne fetch/GM_xmlhttpRequest direkt im Userscript bereit.
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'margobot_expowiska.json'), 'utf8'));
const all = t.forumRoutes(1, 300, true);
const found = new Set(all.map(o => o.forumId));
assert.equal(found.size, 119, 'Jedes Forum-Gebiet muss im Katalog erscheinen');
for (const route of all) {
    assert.equal(route.source, 'forum');
    if (route.maps.length > 1) verify(real, route);
    else { assert.equal(route.cards, 1); assert(real[route.maps[0]]); }
    const entry = catalog.entries.find(e => e.id === route.forumId);
    assert.equal(route.recommended, entry.recommended);
    assert.equal(route.level, entry.level);
    assert.deepEqual(route.lv, entry.lv);
    assert(route.maps.every(id => entry.maps.includes(id)));
    assert(route.cards <= route.totalCards);
}
t.Engine.hero.d.lvl = 41;
const picks = t.forumRoutes(36, 44);
assert(picks.length > 0);
assert(picks.every(o => Number.isFinite(o.d) && o.lv[0] <= 44 && o.lv[1] >= 36));
assert(picks.some(o => o.name.startsWith('Odyńce')));
assert(picks.some(o => o.name.startsWith('Ghule')));
assert(t.suggestionsHtml().includes('Forum'));
// Ohne bekannten Weg nur im vollständigen Katalog anzeigen, keine Übernahme starten.
const unavailable = all.find(o => !Number.isFinite(o.d));
assert(unavailable);
assert.equal(t.takeSuggestion(unavailable), false);
console.log(`OK Forum: alle 119 Gebiete, ${all.length} Teilrouten, Empfehlungen, Level, Karten, Offline-Laden und Anreise geprüft`);

t.cfg.expoAll = true;
const html = t.suggestionsHtml();
assert(html.includes('Mob-Daten fehlen'));
assert(html.includes('Anreise nicht bekannt'));
const missing = t.forumRoutes(1, 300, true).find(o => o.forumId === 49);
assert.equal(missing.n, 0);
assert.equal(t.takeSuggestion(missing), false);
const single = all.find(o => o.maps.length === 1 && o.n && Number.isFinite(o.d));
assert(single);
assert(t.takeSuggestion(single));
t.Engine.map.d.id = single.maps[0];
t.Engine.map.d.name = real[single.maps[0]][2];
assert.equal(t.routeStep().n, 1);
assert.equal(t.routeStep().nextE, single.maps[0]);
