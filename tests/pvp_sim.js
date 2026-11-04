// Andere Spieler: kämpfen (rote Karte, höchstens +maxUp Level) oder sofort zur nächsten Karte, ohne weitere Mobs.
// Karten: 1 A ↔ 2 B ↔ 3 C. Gejagt wird auf B (Ausgang nach C fest eingestellt), dort laufen Mobs und ein anderer Spieler.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t);');
const NAMES = { 1: 'A', 2: 'B', 3: 'C' };
const G = { 1: [[2, 19, 10]], 2: [[1, 0, 10], [3, 19, 10]], 3: [[2, 0, 10]] };
let cur = 2, npcs = [], others = [], changes = [], mobHits = [], pvpHits = [], pvp = 2, follow = false, changedAt = -1e9;
var now = 0;
const MOBS = [[3, 3], [16, 3], [3, 16], [16, 16], [10, 2], [2, 10], [17, 9], [9, 17]];
const go = m => {
    changes.push(NAMES[cur] + '→' + NAMES[m]);
    cur = m; changedAt = now; Engine.map.d.name = NAMES[m]; Engine.map.d.id = m; Engine.map.d.pvp = pvp;
    npcs = []; others = [];
    hero.d.x = m === 3 ? 1 : 18; hero.d.y = 10;
};
const hero = { d: { id: 1, x: 10, y: 10, lvl: 18 }, autoGoTo(p) {
    hero.d.x = p.x; hero.d.y = p.y;
    const g = G[cur].find(g => g[1] === p.x && g[2] === p.y);
    if (g) go(g[0]);
}, heroAtackRequest(id) { mobHits.push(NAMES[cur] + ':' + id); npcs = npcs.filter(n => n.d.id !== id); } };
const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: () => npcs }, others: { getDrawableList: () => others },
  deadController: { isDead: () => false },
  map: { d: { id: 2, name: 'B', pvp: 2 }, size: { x: 20, y: 20 }, col: { check: () => (now - changedAt < 600 ? 1 : 0) },
    getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
const W = { Engine, _g: c => { const m = c.match(/^fight&a=attack&id=(\d+)$/); if (m) { pvpHits.push(NAMES[cur] + ':' + m[1]); others = others.filter(o => o.d.id !== +m[1]); } } };
let K = 0;                                  // eigener ID-Bereich je Szenario (der Bot merkt sich übersprungene Mobs)
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const store = { mbauto: { on: false, pauseMin: 1000, pauseMax: 1000 } };   // jede Aktion ~1 s wie im Spiel
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
    K++; cur = 1; pvp = opt.pvp; go(2); changes = []; mobHits = []; pvpHits = [];
    npcs = MOBS.map(([x, y], i) => ({ d: { id: K * 1000 + i, nick: 'Wolf', lvl: 18, x, y, type: 2, icon: 'zwi/wilk.gif' } }));
    others = [{ d: { id: K * 1000 + 900, nick: opt.nick || 'Fremder', lvl: opt.lvl, x: opt.x ?? 13, y: opt.y ?? 10 } }];
    follow = !!opt.follow;
    Object.assign(st(), { on: true, lvlOn: true, lvlMin: 10, lvlMax: 25, exits: { B: '3' }, route: '',
                          pk: Object.assign({ mode: 'follow', maxUp: 5, near: 6, sec: 5, never: '' }, opt.pk || {}) });
    T(opt.ticks || 250);
    const res = check();
    if (!res.ok) fail = 1;
    console.log((res.ok ? 'OK    ' : 'FEHLER') + ' ' + name + ' | Wechsel: ' + (changes.join(' ') || '–') + ' | Mobs auf B: ' + mobHits.filter(h => h[0] === 'B').length + ' | PvP: ' + (pvpHits.join(' ') || '–') + (res.why ? ' | ' + res.why : ''));
    st().on = false; T(2);
}
const onB = () => mobHits.filter(h => h[0] === 'B').length;
const pid = () => 'B:' + (K * 1000 + 900);

// 1) Folgt, rote Karte, Lvl 20 (+2) → Kampf gegen ihn, danach weiter jagen
scen('folgt, rot, +2 → kämpfen', { pvp: 2, lvl: 20, follow: true }, () => ({ ok: pvpHits.length === 1 && pvpHits[0] === pid() && onB() === MOBS.length }));
// 2) Folgt, rote Karte, Lvl 30 (+12) → sofort nach C, nicht alle Mobs
scen('folgt, rot, +12 → weg', { pvp: 2, lvl: 30, follow: true }, () => ({ ok: !pvpHits.length && changes[0] === 'B→C' && onB() < MOBS.length,
    why: 'Mobs vor dem Weggehen: ' + onB() + ' von ' + MOBS.length }));
// 3) Folgt, keine rote Karte → weg, auch wenn er schwächer ist
scen('folgt, grün, -3 → weg', { pvp: 0, lvl: 15, follow: true }, () => ({ ok: !pvpHits.length && changes[0] === 'B→C' && onB() < MOBS.length }));
// 4) Steht nur nebenan (läuft nicht mit) → ignorieren, alle Mobs jagen
scen('steht nur da → ignorieren', { pvp: 2, lvl: 20, follow: false, x: 12, y: 10 }, () => ({ ok: !pvpHits.length && onB() === MOBS.length }));
// 5) Modus „jeder Spieler“: steht weit weg, rote Karte, +2 → kämpfen
scen('jeder, rot, +2 → kämpfen', { pvp: 2, lvl: 20, follow: false, x: 18, y: 18, pk: { mode: 'any' } }, () => ({ ok: pvpHits[0] === pid() && onB() === MOBS.length }));
// 6) Modus „jeder Spieler“, zu stark → weg ohne Mobs
scen('jeder, rot, +8 → weg', { pvp: 2, lvl: 26, follow: false, x: 18, y: 18, pk: { mode: 'any' } }, () => ({ ok: !pvpHits.length && changes[0] === 'B→C' && onB() === 0 }));
// 7) Name in „Nie angreifen“ → ignorieren
scen('Freund → ignorieren', { pvp: 2, lvl: 20, follow: true, nick: 'Kumpel', pk: { never: 'kumpel, Anderer' } }, () => ({ ok: !pvpHits.length && onB() === MOBS.length }));
// 8) Modus aus → wie bisher
scen('aus → wie bisher', { pvp: 2, lvl: 40, follow: true, pk: { mode: 'off' } }, () => ({ ok: !pvpHits.length && onB() === MOBS.length }));
process.exit(fail);
