// Auto-Stufe (ab 7.33): HP-Verlust pro Kampf entscheidet über stärkere oder schwächere Mobs und den XP-Ort.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t); logs.push(t);')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg, autoT }; })();');

// Drei Karten: Start (Mobs Lvl 40), Schwer (Lvl 44, rechts), Leicht (Lvl 36, links)
const NAMES = { 1: 'Start', 2: 'Schwer', 3: 'Leicht' };
const G = { 1: [[2, 19, 5], [3, 0, 10]], 2: [[1, 0, 5]], 3: [[1, 19, 10]] };
const MOBLVL = { 1: 40, 2: 44, 3: 36 };
const world = {};
for (const id in G) world[id] = [20, 20, 'pl_' + NAMES[id], G[id], [['Wilk', MOBLVL[id], 10]]];

let fail = 0;
const check = (name, ok, info) => { console.log((ok ? 'OK     ' : 'FEHLER ') + name + (info ? ' | ' + info : '')); if (!ok) fail = 1; };

function setup({ loss = 2, lossOf = null, settings = {}, dieAt = 0 } = {}) {
    let now = 0, cur = 1, nextId = 100, fights = 0;
    const logs = [], visits = [];
    const mobsFor = m => Array.from({ length: 6 }, (_, k) => ({ d: { id: nextId++, nick: 'Wilk', lvl: MOBLVL[m], x: 4 + k * 2, y: 14, type: 2, icon: 'zwi/wilk.gif' } }));
    let npcs = mobsFor(1);
    const hero = { d: { x: 10, y: 10, lvl: 41, exp: 0, warrior_stats: { hp: 1000, maxhp: 1000 } },
        autoGoTo(p) {
            // direkt hin (Simulation), Tür = Kartenwechsel
            hero.d.x = p.x; hero.d.y = p.y;
            const g = G[cur].find(g => g[1] === p.x && g[2] === p.y);
            if (g) { const from = cur; cur = g[0]; visits.push(cur); Engine.map.d = { id: cur, name: NAMES[cur] }; npcs = mobsFor(cur);
                const back = G[cur].find(x => x[0] === from); hero.d.x = back ? back[1] : 10; hero.d.y = back ? back[2] : 10; }
        },
        heroAtackRequest(id) {
            fights++;
            const l = lossOf ? lossOf(fights, cur) : loss;
            hero.d.warrior_stats.hp = Math.max(0, hero.d.warrior_stats.hp - l * 10);
            if (dieAt && fights === dieAt) dead = true;
            npcs = npcs.filter(n => n.d.id !== id);
            heal = 2;                                                     // das Spiel heilt kurz danach wieder
        } };
    let heal = 0, dead = false;
    const Engine = { hero, battle: { show: false }, deadController: { isDead: () => dead }, npcs: { getDrawableList: () => npcs },
        map: { d: { id: 1, name: 'Start' }, size: { x: 20, y: 20 }, col: { check: () => 0 },
            getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
    const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, closest: () => null,
        querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {} });
    const W = { Engine, _g() {}, prompt: () => null, confirm: () => true }, timers = [];
    const store = { mbworld: world, mbauto: Object.assign({ humanize: 0, on: true, pauseMin: 0, pauseMax: 0, lvlOn: true, lvlMin: 37, lvlMax: 43,
        mode: 'xp', fogExplore: false, onDeath: 'back', auto: { on: true, mode: 'normal' } }, settings) };
    const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v, GM_notification() {}, logs,
        document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
        innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
    const realNow = Date.now; let clock = 1.8e12; Date.now = () => clock;
    new Function(...Object.keys(sb), src)(...Object.values(sb));
    function tick(n) {
        for (let i = 0; i < n; i++) {
            now += 200; clock += 200;
            if (heal && !--heal) hero.d.warrior_stats.hp = 1000;
            if (dead && i % 25 === 24) { dead = false; hero.d.warrior_stats.hp = 1000; }  // Wiederbelebung
            if (npcs.filter(n => n.d.type === 2).length < 3) npcs = npcs.concat(mobsFor(cur).slice(0, 3));   // Respawn
            timers[0]();
        }
    }
    return { tick, logs, visits, t: W.test, get cur() { return cur; }, get fights() { return fights; }, done: () => { Date.now = realNow; } };
}

// zu leicht: kaum HP-Verlust → Bereich hoch, Reise zur stärkeren Karte
{
    const s = setup({ loss: 2 });
    s.tick(300);
    check('zu leicht: Bereich nach 8 Kämpfen hoch, neuer XP-Ort', s.t.cfg.lvlMin > 37 && s.visits.includes(2),
        `Lvl ${s.t.cfg.lvlMin}–${s.t.cfg.lvlMax}, Karten ${s.visits.join('→') || '–'}`);
    check('… Grund im Verlauf', s.logs.some(l => /Auto-Stufe: .*zu leicht/.test(l)));
    s.done();
}
// passt: mittlerer Verlust → nichts ändern
{
    const s = setup({ loss: 20 });
    s.tick(400);
    check('passend (Ø 20 %): Bereich bleibt, kein Ortswechsel', s.t.cfg.lvlMin === 37 && s.t.cfg.lvlMax === 43 && !s.visits.length, `${s.fights} Kämpfe`);
    s.done();
}
// zu schwer: hoher Verlust → runter, unter das Mob-Level, zur leichteren Karte
{
    const s = setup({ loss: 40 });
    s.tick(300);
    check('zu schwer: Bereich unter Lvl 40, leichtere Karte', s.t.cfg.lvlMax < 40 && s.visits.includes(3), `Lvl ${s.t.cfg.lvlMin}–${s.t.cfg.lvlMax}, Karten ${s.visits.join('→')}`);
    s.done();
}
// ein gefährlicher Kampf reicht
{
    const s = setup({ lossOf: n => n === 3 ? 75 : 5 });
    s.tick(60);
    check('ein Kampf ≥ 60 %: sofort runter', s.t.cfg.lvlMax < 40, `Lvl ${s.t.cfg.lvlMin}–${s.t.cfg.lvlMax} nach ${s.fights} Kämpfen`);
    s.done();
}
// Tod: nicht zurück auf die Todeskarte, sondern tiefer
{
    const s = setup({ loss: 5, dieAt: 2 });
    s.tick(200);
    check('Tod: Bereich runter, kein Rückweg zur Todeskarte', s.t.cfg.lvlMax < 40 && s.t.cfg.back == null && s.visits.includes(3), `Lvl ${s.t.cfg.lvlMin}–${s.t.cfg.lvlMax}, Karten ${s.visits.join('→')}`);
    s.done();
}
// Obergrenze: höchstens Heldenlevel + 5 bei „vorsichtig“
{
    const s = setup({ loss: 1, settings: { lvlMin: 40, lvlMax: 46, auto: { on: true, mode: 'safe' } } });
    s.tick(400);
    check('vorsichtig: nie über Lvl 46 (41 + 5)', s.t.cfg.lvlMax <= 46, `Lvl ${s.t.cfg.lvlMin}–${s.t.cfg.lvlMax}`);
    s.done();
}
// aus bzw. Route: nichts anfassen
{
    const s = setup({ loss: 1, settings: { auto: { on: false, mode: 'normal' } } });
    s.tick(300);
    check('Auto-Stufe aus: Bereich bleibt', s.t.cfg.lvlMin === 37 && !s.visits.length);
    s.done();
}
process.exit(fail);
