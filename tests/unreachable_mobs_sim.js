// Reale Takt-Schleife: unerreichbare Mobs dürfen weder Jagd noch Route festhalten.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(process.env.MARGOBOT_SCRIPT || path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg, get skipped() { return skipUntil; }, get fog() { return fog; } }; })();');
function setup({ wall = false, rejected = false, blockedTile = false, route = true, delayed = false, empty = false } = {}) {
    let now = 0, current = 1, destination = null;
    const attacks = [], visits = [], walks = [];
    let npcs = [{ d: { id: 99, nick: 'Abseits', lvl: 40, x: 15, y: 5, type: 2, icon: 'zwi/test.gif' } }];
    if (empty) npcs = [];
    const collision = (x, y) => current === 1 && ((wall && x === 10) || (blockedTile && x === 15 && y === 5)) ? 1 : 0;
    function distance(from, to) {
        if (collision(to.x, to.y)) return null;
        const q = [[from.x, from.y]], seen = new Set([from.x + ',' + from.y]);
        for (let i = 0; i < q.length; i++) {
            const [x, y] = q[i];
            if (x === to.x && y === to.y) return q[i];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy, key = nx + ',' + ny;
                if (nx < 0 || nx >= 20 || ny < 0 || ny >= 10 || collision(nx, ny) || seen.has(key)) continue;
                seen.add(key); q.push([nx, ny]);
            }
        }
        return null;
    }
    const hero = { d: { x: 2, y: 5, lvl: 41 },
        autoGoTo(p) {
            walks.push({ ...p, at: now });
            if ((rejected && p.x === 15 && p.y === 5 && current === 1) || !distance(hero.d, p)) return false;
            destination = { ...p }; // Die Simulations-Engine folgt nur akzeptierten Laufaufträgen.
        },
        heroAtackRequest(id) {
            const m = npcs.find(n => n.d.id === id);
            assert(m && Math.abs(m.d.x - hero.d.x) <= 1 && Math.abs(m.d.y - hero.d.y) <= 1);
            attacks.push(id); npcs = npcs.filter(n => n.d.id !== id);
        } };
    const Engine = { hero, battle: { show: false }, deadController: {}, npcs: { getDrawableList: () => current === 1 ? npcs : [] },
        map: { d: { id: 1, name: 'Start' }, size: { x: 20, y: 10 },
            col: { check: (x, y) => delayed && now < 2000 ? 1 : collision(x, y) },
            getGateways: () => ({ townnames: { 2: 'Weiter' }, getList: () => current === 1 ? [{ d: { id: 2, x: 0, y: 5 } }] : [] }) } };
    const element = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, closest: () => null,
        querySelector: () => null, querySelectorAll: () => [], set innerHTML(s) {} });
    const W = { Engine }, timers = [];
    const store = { mbauto: { on: true, pauseMin: 0, pauseMax: 0, lvlOn: true, lvlMin: 35, lvlMax: 45,
        fogExplore: false, routes: route ? { R: { maps: [1, 2], mode: 'loop' } } : {}, route: route ? 'R' : '' } };
    const sandbox = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v,
        document: { createElement: element, head: element(), body: element(), addEventListener() {}, querySelector: () => null },
        innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
    new Function(...Object.keys(sandbox), source)(...Object.values(sandbox));
    function tick(n) {
        for (let i = 0; i < n; i++) {
            now += 200;
            if (destination) {
                // Schritt entlang eines kürzeren echten Weges, auch um Hindernisse herum.
                if (hero.d.x === destination.x && hero.d.y === destination.y) destination = null;
                else {
                    const candidates = [[hero.d.x + 1, hero.d.y], [hero.d.x - 1, hero.d.y], [hero.d.x, hero.d.y + 1], [hero.d.x, hero.d.y - 1]];
                    const next = candidates.filter(([x, y]) => x >= 0 && x < 20 && y >= 0 && y < 10 && !collision(x, y))
                        .sort((a, b) => Math.abs(a[0] - destination.x) + Math.abs(a[1] - destination.y) - Math.abs(b[0] - destination.x) - Math.abs(b[1] - destination.y))[0];
                    if (next) [hero.d.x, hero.d.y] = next;
                    if (current === 1 && hero.d.x === 0 && hero.d.y === 5) {
                        current = 2; Engine.map.d = { id: 2, name: 'Weiter' }; destination = null; visits.push(current);
                    }
                }
            }
            timers[0]();
        }
    }
    return { tick, attacks, visits, walks, test: W.test, hero, openWall: () => { wall = false; }, add: m => npcs.push({ d: m }), get now() { return now; } };
}
let t = setup({ wall: true });
t.tick(100);
assert.deepEqual(t.attacks, []);
assert.deepEqual(t.visits, [2], 'Nur isolierte Mobs übrig: Route muss weitergehen');
t = setup({ rejected: true });
t.tick(100);
assert.deepEqual(t.visits, [2], 'Abgelehnter Laufauftrag darf keine Endlosschleife erzeugen');
assert(t.walks.filter(p => p.x === 15).length < 12, 'Kein unendliches Neu-Anstoßen');
t = setup({ rejected: true, route: false });
t.add({ id: 50, nick: 'Weiter weg, aber erreichbar', lvl: 40, x: 18, y: 8, type: 2, icon: 'zwi/test.gif' });
t.tick(100);
assert.deepEqual(t.attacks, [50], 'Nach erfolglosem Anlaufen ein anderes erreichbares Ziel wählen');
t = setup({ wall: true, route: false });
t.add({ id: 50, nick: 'Erreichbar', lvl: 40, x: 5, y: 5, type: 2, icon: 'zwi/test.gif' });
t.tick(100);
assert.deepEqual(t.attacks, [50]);
assert(t.test.skipped[99] > t.now, 'Isoliertes Ziel vorübergehend ignorieren');
// Nach der Abkühlzeit erneut prüfen: ein inzwischen geöffneter Weg wird benutzt.
t.openWall();
t.tick(100);
assert.deepEqual(t.attacks, [50, 99], 'Nach Ablauf der Sperre muss der neue Weg wieder nutzbar sein');
t = setup({ blockedTile: true, route: false });
t.tick(100);
assert.deepEqual(t.attacks, [99], 'Erreichbares Nachbarfeld statt blockierter Mob-Kachel anlaufen');
t = setup({ delayed: true, route: false });
t.tick(100);
assert.deepEqual(t.attacks, [99], 'Nachladende Kollisionsdaten dürfen keinen erreichbaren Mob dauerhaft ausschließen');
// Lange vorher gestanden: ein neuer Laufauftrag bekommt trotzdem seine eigene Frist.
t = setup({ rejected: true, route: false, empty: true });
t.tick(40);
t.add({ id: 99, nick: 'Neu', lvl: 40, x: 15, y: 5, type: 2, icon: 'zwi/test.gif' });
t.tick(10);
assert(!t.test.skipped[99], 'Erste Frist nicht vom vorherigen Stillstand ableiten');
t.tick(25);
assert(t.test.skipped[99] > t.now);
console.log('OK Unerreichbare Mobs: Mauer, abgelehnter Weg, erreichbare Alternativen, Nachbarfeld, Nachladen, Abkühlzeit und Route');
