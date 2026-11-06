// Andere Spieler: kämpfen (rote Karte, höchstens +maxUp Level) oder sofort zur nächsten Karte, ohne weitere Mobs.
// Karten: 1 A ↔ 2 B ↔ 3 C. Gejagt wird auf B (Ausgang nach C fest eingestellt), dort laufen Mobs und ein anderer Spieler.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'W.__resetPk = () => { pkEsc = null; pkRouteSkip = null; for (const id in pkSeen) delete pkSeen[id]; }; })();').replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t);');
const NAMES = { 1: 'Jaskinia', 2: 'B', 3: 'C' };            // A ist eine Höhle (Versteck bei der Flucht)
const SHORT = { 1: 'A', 2: 'B', 3: 'C' };
const G = { 1: [[2, 19, 10]], 2: [[1, 0, 10], [3, 19, 10]], 3: [[2, 0, 10]] };
let keep = {}, cur = 2, npcs = [], others = [], changes = [], mobHits = [], pvpHits = [], pvp = 2, follow = false, changedAt = -1e9;
var now = 0;
const MOBS = [[3, 3], [16, 3], [3, 16], [16, 16], [10, 2], [2, 10], [17, 9], [9, 17]];
const go = m => {
    const cur0 = cur;
    changes.push(SHORT[cur] + '→' + SHORT[m]);
    cur = m; changedAt = now; Engine.map.d.name = NAMES[m]; Engine.map.d.id = m; Engine.map.d.pvp = pvp;
    keep[cur0] = npcs; npcs = keep[m] || []; others = [];     // Mobs bleiben pro Karte bestehen
    const back = G[m].find(g => g[0] === cur0); hero.d.x = back ? back[1] : 10; hero.d.y = back ? back[2] : 10;
};
const hero = { d: { id: 1, x: 10, y: 10, lvl: 18 }, autoGoTo(p) {
    hero.d.x = p.x; hero.d.y = p.y;
    const g = G[cur].find(g => g[1] === p.x && g[2] === p.y);
    if (g) go(g[0]);
}, heroAtackRequest(id) { mobHits.push(SHORT[cur] + ':' + id); npcs = npcs.filter(n => n.d.id !== id); } };
const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: () => npcs }, others: { getDrawableList: () => others },
  deadController: { isDead: () => false },
  map: { d: { id: 2, name: 'B', pvp: 2 }, size: { x: 20, y: 20 }, col: { check: () => (now - changedAt < 600 ? 1 : 0) },
    getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
const W = { Engine, _g: c => { const m = c.match(/^fight&a=attack&ff=1&id=(\d+)$/); if (m) { pvpHits.push(SHORT[cur] + ':' + m[1]); others = others.filter(o => o.d.id !== +m[1]); } } };
let K = 0;                                  // eigener ID-Bereich je Szenario (der Bot merkt sich übersprungene Mobs)
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const world = {}; for (const id in G) world[id] = [20, 20, NAMES[id], G[id], []];
const store = { mbworld: world, mbauto: { on: false, pauseMin: 1000, pauseMax: 1000 } };   // jede Aktion ~1 s wie im Spiel
const timers = [];
const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null };
const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v,
  document: doc, innerWidth: 1400, setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
const st = () => store.mbauto;
const T = n => { for (let i = 0; i < n; i++) {
    now += 200;
    // Verfolger: bleibt zwei Felder neben dem Helden
    if (follow) for (const o of others) { o.d.x = Math.min(19, hero.d.x + 2); o.d.y = hero.d.y; }
    timers[0]();
} };

let fail = 0;
function scen(name, opt, check) {
    W.__resetPk();
    K++; cur = 1; keep = {}; pvp = opt.pvp; go(2); changes = []; mobHits = []; pvpHits = [];
    npcs = MOBS.map(([x, y], i) => ({ d: { id: K * 1000 + i, nick: 'Wolf', lvl: 18, x, y, type: 2, icon: 'zwi/wilk.gif' } }));
    others = [{ d: { id: K * 1000 + 900, nick: opt.nick || 'Fremder', lvl: opt.lvl, x: opt.x ?? 13, y: opt.y ?? 10 } }];
    follow = !!opt.follow;
    Object.assign(st(), { on: true, lvlOn: true, lvlMin: 10, lvlMax: 25, exits: { B: '3' }, route: '',
                          routes: opt.route ? { Test: { maps: opt.route, mode: 'loop' } } : {}, route: opt.route ? 'Test' : '', routePos: 0,
                          pk: Object.assign({ mode: 'follow', maxUp: 5, near: 6, sec: 5, never: '' }, opt.pk || {}) });
    for (let i = 0; i < (opt.ticks || 450); i++) { T(1); if (!changes.length) mobsBeforeFlee = firstB = mobHits.filter(h => h[0] === 'B').length; }
    const res = check();
    if (!res.ok) fail = 1;
    console.log((res.ok ? 'OK    ' : 'FEHLER') + ' ' + name + ' | Wechsel: ' + (changes.join(' ') || '–') + ' | Mobs auf B: ' + mobHits.filter(h => h[0] === 'B').length + ' | PvP: ' + (pvpHits.join(' ') || '–') + (res.why ? ' | ' + res.why : ''));
    st().on = false; T(2);
}
let firstB = 0, mobsBeforeFlee = 0;
const onB = () => mobHits.filter(h => h[0] === 'B').length;
const pid = () => 'B:' + (K * 1000 + 900);

// 1) Folgt, rote Karte, Lvl 20 (+2) → Kampf gegen ihn, danach weiter jagen
scen('folgt, rot, +2 → kämpfen', { pvp: 2, lvl: 20, follow: true }, () => ({ ok: pvpHits.length === 1 && pvpHits[0] === pid() && onB() === MOBS.length }));
// 2) Folgt (steht östlich), rot, +12 → Flucht nach Westen in die Höhle, verstecken, nach 30 s zurück nach B und weiter jagen
scen('folgt, rot, +12 → Flucht', { pvp: 2, lvl: 30, follow: true }, () => ({ ok: !pvpHits.length && changes[0] === 'B→A' && changes[1] === 'A→B' && onB() === MOBS.length,
    why: 'Mobs auf B vor der Flucht ' + firstB }));
// 3) Folgt, keine rote Karte → Flucht, auch wenn er schwächer ist
scen('folgt, grün, -3 → Flucht', { pvp: 0, lvl: 15, follow: true }, () => ({ ok: !pvpHits.length && changes[0] === 'B→A' }));
// 4) Steht nur nebenan (läuft nicht mit) → ignorieren, alle Mobs jagen
scen('steht nur da → ignorieren', { pvp: 2, lvl: 20, follow: false, x: 12, y: 10 }, () => ({ ok: !pvpHits.length && onB() === MOBS.length }));
// 5) Modus „jeder Spieler“: steht weit weg, rote Karte, +2 → kämpfen
scen('jeder, rot, +2 → kämpfen', { pvp: 2, lvl: 20, follow: false, x: 18, y: 18, pk: { mode: 'any' } }, () => ({ ok: pvpHits[0] === pid() && onB() === MOBS.length }));
// 6) „Jeder Spieler“, zu stark, steht am Westausgang → Flucht nach Osten (nicht an ihm vorbei)
// C ist eine Sackgasse (einzige Tür zurück nach B) → dort verstecken, nicht zurück zu ihm; nach 30 s zurück
scen('jeder, +8 am Westausgang → Osten', { pvp: 2, lvl: 26, follow: false, x: 1, y: 10, pk: { mode: 'any' } }, () => ({ ok: !pvpHits.length && changes[0] === 'B→C' && changes[1] === 'C→B' && mobsBeforeFlee === 0 }));
// 7) Name in „Nie angreifen“ → ignorieren
scen('Freund → ignorieren', { pvp: 2, lvl: 20, follow: true, nick: 'Kumpel', pk: { never: 'kumpel, Anderer' } }, () => ({ ok: !pvpHits.length && onB() === MOBS.length }));
// 8) Modus aus → wie bisher
scen('aus → wie bisher', { pvp: 2, lvl: 40, follow: true, pk: { mode: 'off' } }, () => ({ ok: !pvpHits.length && onB() === MOBS.length }));
// Gelb: im Kampf-Levelbereich statt zufälliger Höhlenflucht die nächste Routenkarte nehmen.
scen('folgt, gelb, +2 → nächste Routenkarte', { pvp: 1, lvl: 20, follow: true, route: [2, 3], ticks: 100 },
    () => ({ ok: !pvpHits.length && changes[0] === 'B→C' && !changes.includes('B→A') }));
scen('folgt, gelb, exakt +5 → nächste Routenkarte', { pvp: 1, lvl: 23, follow: true, route: [2, 3], ticks: 100 },
    () => ({ ok: !pvpHits.length && changes[0] === 'B→C' }));
scen('folgt, gelb, +6 → bisherige Flucht', { pvp: 1, lvl: 24, follow: true, route: [2, 3], ticks: 100 },
    () => ({ ok: !pvpHits.length && changes[0] === 'B→A' }));
scen('steht nur da, gelb → ignorieren', { pvp: 1, lvl: 20, follow: false, route: [2], ticks: 100 },
    () => ({ ok: !pvpHits.length && !changes.length && onB() === MOBS.length }));
process.exit(fail);
