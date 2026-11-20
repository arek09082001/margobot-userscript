// Ab 7.36: Bosse (E2) beim Expen nie angreifen; nach einer Niederlage eine Weile vorsichtiger (Level + Gruppen).
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t); logs.push(t);')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg }; })();');
let fail = 0;
const check = (name, ok, info) => { console.log((ok ? 'OK     ' : 'FEHLER ') + name + (info ? ' | ' + info : '')); if (!ok) fail = 1; };

const mob = (id, nick, lvl, x, y, extra = {}) => ({ d: Object.assign({ id, nick, lvl, x, y, type: 2, icon: 'zwi/' + id + '.gif' }, extra) });
let now = 0, clock = 1.8e12, dead = false, dieOnGroup = true;
const logs = [], attacks = [];
let npcs = [
    mob(1, 'Mushita', 30, 11, 10, { icon: 'e2/mushita.gif' }),       // E2 an der Grafik
    mob(2, 'Strażnik', 29, 9, 10, { wt: 21 }),                       // Boss an der Stärke-Angabe
    mob(10, 'Vile Cutthroat', 35, 10, 12, { grp: 7 }), mob(11, 'Old Brigand', 33, 11, 12, { grp: 7 }), mob(12, 'Brigand', 35, 9, 12, { grp: 7 }),
    mob(20, 'Wilk', 31, 4, 4), mob(21, 'Wilk', 32, 16, 4), mob(22, 'Niedźwiedź', 34, 16, 16)
];
const hero = { d: { x: 10, y: 11, lvl: 30, prof: 't', exp: 0, warrior_stats: { hp: 1000, maxhp: 1000 } },
    autoGoTo(p) { hero.d.x = p.x; hero.d.y = p.y; },
    heroAtackRequest(id) {
        attacks.push(id);
        const m = npcs.find(n => n.d.id === id);
        if (m && m.d.grp === 7 && dieOnGroup) { dead = true; return; }        // gegen die Gruppe verloren
        npcs = npcs.filter(n => n.d.id !== id && !(m && m.d.grp && n.d.grp === m.d.grp));
    } };
const Engine = { hero, battle: { show: false }, deadController: { isDead: () => dead }, npcs: { getDrawableList: () => npcs },
    map: { d: { id: 1, name: 'Las' }, size: { x: 20, y: 20 }, col: { check: () => 0 },
        getGateways: () => ({ townnames: {}, getList: () => [] }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {} });
const W = { Engine, _g() {}, prompt: () => null, confirm: () => true }, timers = [];
const store = { mbauto: { humanize: 0, on: true, pauseMin: 0, pauseMax: 0, lvlOn: true, lvlMin: 28, lvlMax: 36, fogExplore: false, onDeath: 'back' } };
const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v, GM_notification() {}, logs,
    document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
const realNow = Date.now; Date.now = () => clock;
new Function(...Object.keys(sb), src)(...Object.values(sb));
const t = W.test;
const T = n => { for (let i = 0; i < n; i++) { now += 200; clock += 200; if (dead && i % 15 === 14) dead = false; timers[0](); } };

let g = 0; while (!t.cfg.lossCap && g++ < 200) T(1);
const before = attacks.length;
check('Gruppe angegriffen und verloren', attacks.some(id => id >= 10 && id <= 12) && t.cfg.lossCap, JSON.stringify(t.cfg.lossCap));
check('… Vorsicht: Mobs bis Lvl 32, 3er-Gruppen bis Lvl 30', t.cfg.lossCap && t.cfg.lossCap.lvl === 32 && t.cfg.lossCap.size === 3 && t.cfg.lossCap.hero === 30);
check('… Grund im Verlauf', logs.some(l => /Vorsicht nach der Niederlage gegen Lvl 35 \(3er-Gruppe\): 45 min nur Mobs bis Lvl 32, Gruppen ab 3 nur bis Lvl 30/.test(l)));
T(300);
const after = attacks.slice(before);
check('danach nur Lvl 31 und 32 angegriffen, nicht 34 und nicht die Gruppe', after.includes(20) && after.includes(21) && !after.includes(22) && !after.some(id => id >= 10 && id <= 12), after.join(','));
check('Bosse nie angegriffen (E2-Grafik, Stärke-Angabe)', !attacks.includes(1) && !attacks.includes(2), attacks.join(','));
// Level-Aufstieg beendet die Vorsicht
hero.d.lvl = 31; dieOnGroup = false; T(200);
check('Level-Aufstieg: Vorsicht vorbei, Lvl 34 und Gruppe wieder Ziel', !t.cfg.lossCap && attacks.includes(22), attacks.slice(before).join(','));
check('Bosse weiterhin nie angegriffen', !attacks.includes(1) && !attacks.includes(2));
Date.now = realNow;
process.exit(fail);
