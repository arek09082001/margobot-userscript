// Aufnahme von Abläufen: Handgriffe des Spielers werden zu Schritten und lassen sich abspielen.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t);')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg, recStart, recStop, startRule, rulesTab }; })();');
const NAMES = { 1: 'Town', 2: 'Forest' };
const G = { 1: [[2, 19, 5]], 2: [[1, 0, 5]] };
const world = {}; for (const id in G) world[id] = [20, 20, 'pl_' + NAMES[id], G[id], []];
let cur = 1, npcs = [], now = 0, changedAt = -1e9, wolfId = 70;
const wolf = id => ({ d: { id, nick: 'Wilk', lvl: 5, x: 12, y: 8, type: 2, icon: 'zwi/wilk.gif' } });
const go = (m, from) => {
    cur = m; changedAt = now; Engine.map.d.name = NAMES[m]; Engine.map.d.id = m;
    npcs = m === 1 ? [{ d: { id: 9, nick: 'Kowal', x: 5, y: 5, type: 0 } }] : [wolf(wolfId++)];
    const back = from && G[m].find(g => g[0] === from);
    hero.d.x = back ? back[1] : 10; hero.d.y = back ? back[2] : 10;
};
const attacks = [], sent = [];
const hero = { d: { x: 10, y: 10, lvl: 5, exp: 0, warrior_stats: { hp: 100, maxhp: 100 } }, autoGoTo(p) {
    hero.d.x = p.x; hero.d.y = p.y;
    const g = G[cur].find(g => g[1] === p.x && g[2] === p.y);
    if (g) go(g[0], cur);
}, heroAtackRequest(id) { attacks.push(id); npcs = npcs.filter(n => n.d.id !== id); } };
const items = [{ id: 501, name: 'Mała mikstura', loc: 'g', st: 0, stat: 'leczy=30;amount=4' }];
// Dialog-Attrappe: offen nach talk, Antworten als Elemente mit click()
let dlg = null; const clicks = [];
const answer = t => ({ textContent: '1. ' + t, querySelector: () => null, click() { clicks.push(t); dlg = null; } });
const _g = c => { sent.push(c); if (/^talk&id=9$/.test(c)) dlg = { querySelectorAll: () => [answer('Daj mi zadanie'), answer('Do widzenia')], querySelector: () => null }; };
const Engine = { hero, items: { fetchLocationItems: l => l === 'g' ? items.map(d => ({ d })) : [] }, battle: { show: false }, npcs: { getDrawableList: () => npcs }, deadController: { isDead: () => false },
  map: { d: { id: 1, name: 'Town' }, size: { x: 20, y: 20 }, col: { check: () => (now - changedAt < 600 ? 1 : 0) },
    getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const listeners = [];
const doc = { createElement: el, head: el(), body: el(), addEventListener: (t, f) => t === 'click' && listeners.push(f),
    querySelector: q => q === '.dialogue-window.is-open' ? dlg : null };
const W = { Engine, _g, prompt: () => null, confirm: () => true };
const store = { mbworld: world, mbauto: { on: false, pauseMin: 0, pauseMax: 0 } }, timers = [];
const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v,
  document: doc, innerWidth: 1400, setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
const T = n => { for (let i = 0; i < n; i++) { now += 200; timers[0](); } };
const t = W.test;
go(1); T(5);

// ── Aufnahme: laufen, NPC, Antwort, Trank, Kartenwechsel, Angriff, Beute
t.recStart(); T(2);
assert.ok(t.cfg.flow, 'Aufnahme läuft');
assert.match(t.rulesTab(), /Aufnahme beenden/);
hero.autoGoTo({ x: 5, y: 6 }); T(10);                               // stehen bleiben → Haltepunkt
W._g('talk&id=9');
const li = { closest: () => ({ querySelector: () => null, textContent: '1. Daj mi zadanie' }) };
listeners.forEach(f => f({ target: li, isTrusted: true }));
W._g('talk&id=9&c=12');                                             // Antwortklick selbst nicht doppelt
W._g('moveitem&st=1&id=501');
W._g('chat&c=hallo');                                               // Chat: nicht aufnehmen
W._g('shop&buy=5');                                                 // Handel: nie aufnehmen
hero.autoGoTo({ x: 19, y: 5 }); T(3);                               // Tür → Forest
hero.autoGoTo({ x: 11, y: 8 }); T(10);
Engine.hero.heroAtackRequest(70, true);
W._g('takeitem&id=333');
const nr = t.recStop();
const kinds = nr.steps.map(s => s.t + (s.name ? ':' + s.name : s.say ? ':' + s.say : s.cmd ? ':' + s.cmd : s.map && s.t === 'go' ? ':' + s.map : ''));
if (process.env.LOG) console.log(kinds);
assert.equal(nr.when.t, 'hand');
assert.deepEqual(kinds.filter(k => !k.startsWith('walk')), ['npc:Kowal', 'say:Daj mi zadanie', 'use:Mała mikstura', 'go:2', 'kill:Wilk', 'cmd:takeitem&id=333']);
assert.ok(nr.steps[0].t === 'walk' && nr.steps[0].x === 10, 'Startpunkt zuerst');
assert.ok(nr.steps.some(s => s.t === 'walk' && s.x === 5 && s.y === 6 && s.map === '1'), 'Haltepunkt vor dem NPC');
assert.ok(!sent.slice(0, 0).length && !kinds.some(k => /chat|shop/.test(k)), 'Chat und Handel ausgelassen');
assert.equal(t.cfg.flow, null);
t.cfg.rules = [nr]; nr.steps.splice(1, 0, { t: 'walk', map: '1', x: 7, y: 7 });
const view = t.rulesTab();
assert.match(view, /Laufen über 3 Punkte bis \(5, 6\)/, 'Haltepunkte zusammengefasst');
assert.match(view, /<span class="no">1–3<\/span>/);
assert.match(view, /10 Schritte/);
nr.steps.splice(1, 1); nr.name = 'Questreihe Anfang';
assert.match(t.rulesTab(), /<b>Questreihe Anfang<\/b>/);
console.log('OK Aufnahme: Haltepunkte, NPC über Namen, Antworttext, Gegenstand, Kartenwechsel, Angriff über Mob-Namen, Rohbefehl; Chat/Handel ausgelassen');

// ── Abspielen: zurück in die Stadt, alles neu ausführen (andere Mob-ID nach Respawn)
go(1); hero.d.x = 15; hero.d.y = 15; sent.length = 0; attacks.length = 0; clicks.length = 0; T(5);
items[0].stat = 'leczy=30;amount=4';
t.startRule(nr, 'Test');
let guard = 0;
while (t.cfg.chain && guard++ < 2000) T(1);
assert.equal(t.cfg.chain, null, 'Ablauf fertig');
assert.deepEqual(clicks, ['Daj mi zadanie']);
assert.ok(sent.includes('talk&id=9') && sent.includes('moveitem&st=1&id=501') && sent.includes('takeitem&id=333'));
assert.ok(!sent.some(c => /^shop|^chat/.test(c)));
assert.deepEqual(attacks, [71], 'Mob über Namen gefunden, neue ID');
assert.equal(cur, 2);
console.log('OK Abspielen: Laufen, NPC, Antwort, Trank, Tür, Angriff auf neue Mob-ID, Rohbefehl');

// ── Laufender Bot: keine Aufnahme
t.cfg.on = true; t.recStart(); assert.equal(t.cfg.flow, null, 'nicht während der Bot läuft'); t.cfg.on = false;
t.recStart(); T(1); t.cfg.on = true; T(1); assert.equal(t.cfg.flow, null, 'Botstart beendet die Aufnahme'); t.cfg.on = false;
console.log('OK Aufnahme nur ohne laufenden Bot');
