// Aufnahme ab 7.35: Erkennung ohne _g (Dialogfenster, verschwundener Mob, angelegter Gegenstand) und Sinn-Prüfung.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t); logs.push(t);')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg, recStart, recStop, startRule, rulesTab, flowCheck }; })();');
const NAMES = { 1: 'Town', 2: 'Forest' };
const G = { 1: [[2, 19, 5]], 2: [[1, 0, 5]] };
const world = {}; for (const id in G) world[id] = [20, 20, 'pl_' + NAMES[id], G[id], []];
let cur = 1, npcs = [], now = 0, changedAt = -1e9, wolfId = 70;
const logs = [], attacks = [], sent = [];
const wolf = id => ({ d: { id, nick: 'Wilk', lvl: 5, x: 12, y: 8, type: 2, icon: 'zwi/wilk.gif' } });
const go = (m, from) => {
    cur = m; changedAt = now; Engine.map.d.name = NAMES[m]; Engine.map.d.id = m;
    npcs = m === 1 ? [{ d: { id: 9, nick: 'Kowal', x: 5, y: 5, type: 0 } }] : [wolf(wolfId++)];
    const back = from && G[m].find(g => g[0] === from);
    hero.d.x = back ? back[1] : 10; hero.d.y = back ? back[2] : 10;
};
const hero = { d: { x: 10, y: 10, lvl: 5, exp: 0, warrior_stats: { hp: 100, maxhp: 100 } }, autoGoTo(p) {
    hero.d.x = p.x; hero.d.y = p.y;
    const g = G[cur].find(g => g[1] === p.x && g[2] === p.y);
    if (g) go(g[0], cur);
}, heroAtackRequest(id) { attacks.push(id); npcs = npcs.filter(n => n.d.id !== id); } };
const items = [{ id: 501, name: 'Mała mikstura', loc: 'g', st: 0, stat: 'leczy=30;amount=4' },
               { id: 601, name: 'Skórzany hełm', loc: 'g', st: 0, cl: 9, stat: 'lvl=3' }];
let dlg = null; const clicks = [];
const answer = t => ({ textContent: '1. ' + t, querySelector: () => null, click() { clicks.push(t); dlg = null; } });
const openDlg = () => { dlg = { querySelectorAll: () => [answer('Daj mi zadanie'), answer('Do widzenia')], querySelector: () => null }; };
// Das Spiel benutzt seine eigene Kopie: W._g wird beim Spielen von Hand NICHT aufgerufen. Nur der Bot ruft _g.
const _g = c => {
    sent.push(c);
    if (/^talk&id=9$/.test(c)) openDlg();
    const m = c.match(/^moveitem&st=1&id=(\d+)$/); if (m) { const it = items.find(d => d.id === +m[1]); if (it && it.cl) it.st = 1; }
};
const Engine = { hero, items: { fetchLocationItems: l => l === 'g' ? items.map(d => ({ d })) : [] }, battle: { show: false }, npcs: { getDrawableList: () => npcs }, deadController: { isDead: () => false },
  map: { d: { id: 1, name: 'Town' }, size: { x: 20, y: 20 }, col: { check: () => (now - changedAt < 600 ? 1 : 0) },
    getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const listeners = [];
const doc = { createElement: el, head: el(), body: el(), addEventListener: (t, f) => t === 'click' && listeners.push(f),
    querySelector: q => q === '.dialogue-window.is-open' ? dlg : null, querySelectorAll: () => [] };
const W = { Engine, _g, prompt: () => null, confirm: () => true };
const store = { mbworld: world, mbauto: { humanize: 0, on: false, pauseMin: 0, pauseMax: 0 } }, timers = [];
const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v, GM_notification() {}, logs,
  document: doc, innerWidth: 1400, setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
const T = n => { for (let i = 0; i < n; i++) { now += 200; timers[0](); } };
const t = W.test;
const gameG = W._g;                              // was das Spiel intern hätte: am Hook vorbei
go(1); T(5);

// ── Aufnahme, ohne dass das Spiel W._g aufruft
t.recStart(); T(2);
hero.d.x = 5; hero.d.y = 6; T(10);                                  // zum Schmied, stehen bleiben
openDlg(); T(3);                                                    // Dialog geht auf (Spiel hat talk selbst gesendet)
const li = { closest: () => ({ querySelector: () => null, textContent: '1. Daj mi zadanie' }) };
listeners.forEach(f => f({ target: li, isTrusted: true })); dlg = null; T(3);
items[1].st = 1; T(3);                                              // Helm angelegt (über das Spiel)
items[0].stat = 'leczy=30;amount=3'; T(3);                         // Trank getrunken (Menge −1): nicht aufnehmen
hero.d.x = 19; hero.d.y = 5; T(1); go(2, 1); T(5);                  // Tür → Forest
hero.d.x = 11; hero.d.y = 8; T(10);                                 // neben den Wolf
npcs = []; T(3);                                                    // Kampf ohne Fenster: Wolf weg
let nr = t.recStop();
const kinds = nr.steps.map(s => s.t + (s.name ? ':' + s.name : s.say ? ':' + s.say : s.t === 'go' ? ':' + s.map : ''));
if (process.env.LOG) console.log(kinds, logs.slice(-5));
assert.deepEqual(kinds.filter(k => !k.startsWith('walk')), ['npc:Kowal', 'say:Daj mi zadanie', 'equip:Skórzany hełm', 'go:2', 'kill:Wilk']);
assert.match(t.rulesTab(), /Noch keine Spielbefehle gesehen|Aufnahme starten/);
console.log('OK Aufnahme ohne _g: Gespräch am Fenster, Antwort, Anlegen, Tür, Kampf am verschwundenen Mob; Trank ausgelassen');

// ── Abspielen der Aufnahme
go(1); hero.d.x = 15; hero.d.y = 15; items[1].st = 0; sent.length = 0; attacks.length = 0; clicks.length = 0; T(5);
t.cfg.rules = [nr]; t.startRule(nr, 'Test');
let guard = 0; while (t.cfg.chain && guard++ < 2000) T(1);
assert.equal(t.cfg.chain, null, 'Ablauf fertig');
assert.ok(sent.includes('talk&id=9') && sent.includes('moveitem&st=1&id=601') && !sent.includes('moveitem&st=1&id=501'));
assert.deepEqual(clicks, ['Daj mi zadanie']);
assert.equal(attacks.length, 1); assert.equal(cur, 2);
console.log('OK Abspielen: NPC, Antwort, Helm, Tür, Angriff');

// ── Sinn-Prüfung
const chk = t.flowCheck([
    { t: 'walk', map: '1', x: 5, y: 5 },
    { t: 'say', say: 'Ohne Gespräch' },                              // keine NPC davor
    { t: 'cmd', cmd: 'ev&x=1' }, { t: 'cmd', cmd: 'look&a=1' },        // Abfragen
    { t: 'cmd', cmd: 'loot&id=1' }, { t: 'cmd', cmd: 'loot&id=1' }, { t: 'cmd', cmd: 'loot&id=1' },   // ständig wiederholt
    { t: 'use', name: 'Duża mikstura' },                             // Trank
    { t: 'walk', map: '1', x: 18, y: 5 }, { t: 'go', map: '2' },      // Laufpunkt vor Tür
    { t: 'walk', map: '2', x: 1, y: 5 }, { t: 'go', map: '1' },       // hin und zurück ohne Handlung
    { t: 'npc', name: 'Kowal' }, { t: 'say', say: 'Daj mi zadanie' }, { t: 'say', say: 'Dalej' },
    { t: 'use', name: 'Zwój teleportacji' },                         // kein Trank: bleibt
    { t: 'walk', map: '1', x: 3, y: 3 }, { t: 'walk', map: '1', x: 4, y: 4 }]);
const k2 = chk.steps.map(s => s.t + (s.name ? ':' + s.name : s.say ? ':' + s.say : s.cmd ? ':' + s.cmd : s.t === 'go' ? ':' + s.map : ''));
if (process.env.LOG) console.log(k2, chk.note);
assert.deepEqual(k2, ['walk', 'npc:Kowal', 'say:Daj mi zadanie', 'say:Dalej', 'use:Zwój teleportacji', 'walk']);
assert.match(chk.note, /Antworten ohne Gespräch/); assert.match(chk.note, /Tränke/); assert.match(chk.note, /Hin und zurück/); assert.match(chk.note, /Spielabfragen/);
console.log('OK Sinn-Prüfung: Antwort ohne Gespräch, Abfragen, Trank, Laufpunkt vor Tür, Hin und zurück entfernt; Gespräch und Schriftrolle bleiben');
