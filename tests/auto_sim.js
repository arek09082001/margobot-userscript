// Auto-Stufe (ab 7.33): HP-Verlust pro Kampf entscheidet über stärkere oder schwächere Mobs und den XP-Ort.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t); logs.push(t);')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg, autoT }; })();');

// Start (Mobs Lvl 40); rechts Schwer (44) ↔ Schwerer (45); links Leicht (36) ↔ Leichter (35)
const NAMES = { 1: 'Start', 2: 'Schwer', 3: 'Leicht', 4: 'Schwerer', 5: 'Leichter' };
const G = { 1: [[2, 19, 5], [3, 0, 10]], 2: [[1, 0, 5], [4, 19, 15]], 3: [[1, 19, 10], [5, 0, 15]], 4: [[2, 0, 15]], 5: [[3, 19, 15]] };
const MOBLVL = { 1: 40, 2: 44, 3: 36, 4: 45, 5: 35 };
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
    check('… kaum Verlust: gleich 4 Level höher', s.t.cfg.lvlMin === 41 && s.t.cfg.lvlMax === 47, `Lvl ${s.t.cfg.lvlMin}–${s.t.cfg.lvlMax}`);
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
// Bereich weit unter dem Helden (wie 5–13 bei Lvl 13): direkt in Heldennähe statt in kleinen Schritten
{
    const s = setup({ loss: 0, settings: { lvlMin: 31, lvlMax: 40 } });
    s.tick(300);
    check('weit unter dem Helden: ein Sprung in Heldennähe', s.t.cfg.lvlMin >= 39 && s.t.cfg.lvlMax <= 51 && s.visits.includes(2),
        `Lvl ${s.t.cfg.lvlMin}–${s.t.cfg.lvlMax}, Karten ${s.visits.join('→')}`);
    check('… Karte zeigt letzte Änderung', /Zuletzt .*→ Lvl/.test(s.t.autoT.lastMsg ? 'Zuletzt ' + s.t.autoT.lastMsg : ''), s.t.autoT.lastMsg);
    s.done();
}
// mittlerer leichter Verlust (Ø 6 %): nur 2 Level
{
    const s = setup({ loss: 6 });
    s.tick(300);
    check('etwas zu leicht (Ø 6 %): 2 Level höher', s.t.cfg.lvlMin === 39 && s.t.cfg.lvlMax === 45, `Lvl ${s.t.cfg.lvlMin}–${s.t.cfg.lvlMax}`);
    s.done();
}
// mit Route: zu leicht → neue, stärkere Route aus den Vorschlägen, dorthin laufen
{
    const s = setup({ loss: 1, settings: { mode: 'route', route: 'Start', routes: { Start: { maps: [1], lvlOn: true, lvlMin: 37, lvlMax: 43 } } } });
    s.tick(400);
    const r = s.t.cfg.routes[s.t.cfg.route];
    check('Route zu leicht: neue Route mit stärkeren Karten, Bot läuft hin', s.t.cfg.route !== 'Start' && r && r.maps.some(id => id === 2 || id === 4) && s.visits.includes(2),
        `Route „${s.t.cfg.route}“ ${r && r.maps.join('→')}, Lvl ${s.t.cfg.lvlMin}–${s.t.cfg.lvlMax}, Karten ${s.visits.join('→')}`);
    check('… alte Route bleibt gespeichert', !!s.t.cfg.routes.Start);
    s.done();
}
// mit Route: zu schwer → schwächere Route
{
    const s = setup({ loss: 40, settings: { mode: 'route', route: 'Start', routes: { Start: { maps: [1], lvlOn: true, lvlMin: 37, lvlMax: 43 } } } });
    s.tick(300);
    const r = s.t.cfg.routes[s.t.cfg.route];
    check('Route zu schwer: schwächere Route', s.t.cfg.route !== 'Start' && r && r.maps.some(id => id === 3 || id === 5) && s.t.cfg.lvlMax < 40,
        `Route „${s.t.cfg.route}“ ${r && r.maps.join('→')}, Lvl ${s.t.cfg.lvlMin}–${s.t.cfg.lvlMax}`);
    s.done();
}
// „Immer die Route mit den meisten XP/Runde“: wechselt einmal auf die beste, pendelt danach nicht
{
    const s = setup({ loss: 20, settings: { mode: 'route', route: 'Start', bestRoute: true, auto: { on: false, mode: 'normal' }, lvlMin: 33, lvlMax: 47,
        routes: { Start: { maps: [1], lvlOn: true, lvlMin: 33, lvlMax: 47 } } } });
    s.tick(30);
    const r1 = s.t.cfg.route, m1 = s.t.cfg.routes[r1] && s.t.cfg.routes[r1].maps;
    check('beste Route: wechselt auf die Route mit den meisten XP', r1 !== 'Start' && m1 && new Set(m1).size > 1 && s.logs.some(l => /Bessere Route: .*XP\/Runde statt/.test(l)),
        `„${r1}“ ${m1 && m1.join('→')}`);
    s.tick(2000);                                                       // > 5 min: erneute Prüfung
    check('… bleibt danach dabei (kein Hin und Her)', s.t.cfg.route === r1, s.t.cfg.route);
    check('… Angriffsbereich unverändert', s.t.cfg.lvlMin === 33 && s.t.cfg.lvlMax === 47);
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
