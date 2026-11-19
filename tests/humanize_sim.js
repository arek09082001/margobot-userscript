// Abwechslung (ab 7.27): Mob-Reihenfolge, Anlauf-Seite, Umwege und Feld neben dem NPC variieren –
// aber jede Runde kommt ans Ziel, nie über eine Tür, und „aus“ bleibt exakt wie vorher.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t);')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg, startRule }; })();');
const MW = 40, MH = 30, DOOR = { x: 39, y: 15 };
// Mauer mitten auf der Karte mit zwei Durchgängen (oben/unten): es gibt also wirklich verschiedene Wege.
const wall = (x, y) => x === 20 && y > 2 && y < 27 && y !== 8 && y !== 22;

function setup(humanize, { mobs = [], route = false, npc = null } = {}) {
    let now = 0, cur = 1, dest = null, npcs = mobs.map(m => ({ d: Object.assign({ lvl: 40, type: 2, icon: 'zwi/wilk.gif' }, m) }));
    if (npc) npcs.push({ d: Object.assign({ type: 0 }, npc) });
    const walks = [], attacks = [], sent = [], trail = [];
    const free = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH && !wall(x, y);
    function next(from, to) {                                   // ein Schritt auf dem kürzesten echten Weg (BFS)
        const key = (x, y) => y * MW + x, prev = new Map([[key(from.x, from.y), null]]), q = [[from.x, from.y]];
        for (let i = 0; i < q.length; i++) {
            const [x, y] = q[i];
            if (x === to.x && y === to.y) {
                let c = key(x, y), p;
                while ((p = prev.get(c)) != null && p !== key(from.x, from.y)) c = p;
                return [c % MW, (c / MW) | 0];
            }
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (!free(nx, ny) || prev.has(key(nx, ny))) continue;
                prev.set(key(nx, ny), key(x, y)); q.push([nx, ny]);
            }
        }
        return null;
    }
    const hero = { d: { x: 2, y: 15, lvl: 41, exp: 0, warrior_stats: { hp: 100, maxhp: 100 } },
        autoGoTo(p) { walks.push({ x: p.x, y: p.y }); dest = { x: p.x, y: p.y }; },
        heroAtackRequest(id) {
            const m = npcs.find(n => n.d.id === id);
            assert(m && Math.abs(m.d.x - hero.d.x) <= 1 && Math.abs(m.d.y - hero.d.y) <= 1, 'Angriff nur direkt daneben');
            attacks.push(id); npcs = npcs.filter(n => n.d.id !== id);
        } };
    const Engine = { hero, battle: { show: false }, deadController: { isDead: () => false },
        npcs: { getDrawableList: () => cur === 1 ? npcs : [] },
        map: { d: { id: 1, name: 'Start' }, size: { x: MW, y: MH }, col: { check: (x, y) => cur === 1 && wall(x, y) ? 1 : 0 },
            getGateways: () => ({ townnames: { 2: 'Ziel' }, getList: () => cur === 1 ? [{ d: { id: 2, x: DOOR.x, y: DOOR.y } }] : [] }) } };
    const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, closest: () => null,
        querySelector: () => null, querySelectorAll: () => [], set innerHTML(s) {} });
    const W = { Engine, _g: c => sent.push(c), prompt: () => null, confirm: () => true }, timers = [];
    const store = { mbauto: { humanize, on: !npc, pauseMin: 0, pauseMax: 0, lvlOn: true, lvlMin: 35, lvlMax: 45, fogExplore: false,
        routes: route ? { R: { maps: [1, 2], mode: 'loop' } } : {}, route: route ? 'R' : '' } };
    const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v,
        document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null },
        innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
    new Function(...Object.keys(sb), src)(...Object.values(sb));
    function tick(n) {
        for (let i = 0; i < n; i++) {
            now += 200;
            if (dest && cur === 1) {
                if (hero.d.x === dest.x && hero.d.y === dest.y) dest = null;
                else {
                    const s = next(hero.d, dest);
                    if (s) { [hero.d.x, hero.d.y] = s; trail.push(s.join()); } else dest = null;
                    if (hero.d.x === DOOR.x && hero.d.y === DOOR.y) { cur = 2; Engine.map.d = { id: 2, name: 'Ziel' }; dest = null; }
                }
            }
            timers[0]();
        }
    }
    return { tick, walks, attacks, sent, trail, test: W.test, hero, get cur() { return cur; } };
}

let fail = 0;
const check = (name, ok, info) => { console.log((ok ? 'OK     ' : 'FEHLER ') + name + (info ? ' | ' + info : '')); if (!ok) fail = 1; };
const nearDoor = p => Math.max(Math.abs(p.x - DOOR.x), Math.abs(p.y - DOOR.y)) <= 1 && !(p.x === DOOR.x && p.y === DOOR.y);
const MOBS = [{ id: 1, nick: 'Wilk', x: 6, y: 10 }, { id: 2, nick: 'Wilk', x: 6, y: 20 }, { id: 3, nick: 'Wilk', x: 10, y: 15 },
              { id: 4, nick: 'Wilk', x: 12, y: 8 }, { id: 5, nick: 'Wilk', x: 12, y: 22 }, { id: 6, nick: 'Wilk', x: 15, y: 15 }];

// ── Jagd: alle Mobs werden erledigt, aber nicht jedes Mal in derselben Reihenfolge / von derselben Seite
{
    const orders = new Set(), sides = new Set(); let all = true;
    for (let r = 0; r < 12; r++) {
        const t = setup(2, { mobs: MOBS }); t.tick(600);
        all = all && t.attacks.length === MOBS.length;
        orders.add(t.attacks.join()); sides.add(t.walks.map(p => p.x + ',' + p.y).join(' '));
    }
    check('Abwechslung: alle Mobs erledigt, Reihenfolge variiert', all && orders.size >= 2, `${orders.size} Reihenfolgen, ${sides.size} Wegfolgen in 12 Runden`);
    const fixed = new Set();
    for (let r = 0; r < 4; r++) { const t = setup(0, { mobs: MOBS }); t.tick(600); fixed.add(t.attacks.join() + '|' + t.walks.map(p => p.x + ',' + p.y).join(' ')); }
    check('aus: jedes Mal genau gleich', fixed.size === 1);
}

// ── Lange Wege zur Tür: manchmal über einen Zwischenpunkt, nie neben die Tür, immer angekommen
{
    const trails = new Set(); let arrived = true, doorSafe = true, detours = 0;
    for (let r = 0; r < 20; r++) {
        const t = setup(3, { route: true }); t.tick(400);
        arrived = arrived && t.cur === 2;
        doorSafe = doorSafe && !t.walks.some(nearDoor);
        if (t.walks.some(p => !(p.x === DOOR.x && p.y === DOOR.y))) detours++;
        trails.add(t.trail.join(' '));
    }
    check('Umweg: immer an der Tür angekommen, Weg variiert', arrived && detours > 0 && trails.size >= 2, `${detours}/20 mit Umweg, ${trails.size} verschiedene Wege`);
    check('Umweg: Zwischenpunkte nie direkt neben der Tür', doorSafe);
    const t0 = setup(0, { route: true }); t0.tick(400);
    check('aus: direkt zur Tür', t0.cur === 2 && t0.walks.every(p => p.x === DOOR.x && p.y === DOOR.y));
}

// ── Ablauf mit NPC: anderes Feld neben dem NPC, Gespräch trotzdem gestartet
{
    const NPC = { id: 9, nick: 'Wache', x: 10, y: 15 };
    const rule = { id: 'A', on: true, name: 'NPC', when: { t: 'hand' }, steps: [{ t: 'npc', name: 'Wache' }] };
    const spots = new Set(); let talked = true;
    for (let r = 0; r < 12; r++) {
        const t = setup(2, { npc: NPC }); t.tick(2);
        t.test.cfg.rules = [rule]; t.test.startRule(rule, 'Test'); t.tick(150);
        talked = talked && t.sent.includes('talk&id=9') && t.test.cfg.chain == null;
        spots.add(t.hero.d.x + ',' + t.hero.d.y);
    }
    check('NPC: verschiedene Felder daneben, Gespräch geführt', talked && spots.size >= 2, [...spots].join(' '));
    const t = setup(0, { npc: NPC }); t.tick(2);
    t.test.cfg.rules = [rule]; t.test.startRule(rule, 'Test'); t.tick(150);
    check('aus: wie bisher unter dem NPC', t.hero.d.x === 10 && t.hero.d.y === 16 && t.sent.includes('talk&id=9'));
}
process.exit(fail);
