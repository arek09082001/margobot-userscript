const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t);');
// Karten: 1 Werbin (Teleporter), 2 Ithan, 3 Torneg, 4..8 lange Fußstrecke, 9 Route (neben Torneg und am Ende der Fußstrecke)
const NAMES = { 1: 'Werbin', 2: 'Ithan', 3: 'Torneg', 4: 'Las A', 5: 'Las B', 6: 'Las C', 7: 'Las D', 8: 'Las E', 9: 'Bagna Umarlych' };
const G = { 1: [[4, 19, 10]], 4: [[1, 0, 10], [5, 19, 10]], 5: [[4, 0, 10], [6, 19, 10]], 6: [[5, 0, 10], [7, 19, 10]], 7: [[6, 0, 10], [8, 19, 10]],
            8: [[7, 0, 10], [9, 19, 10]], 9: [[8, 0, 10], [3, 10, 0]], 3: [[9, 10, 19]], 2: [] };
const world = {}; for (const id in G) world[id] = [20, 20, NAMES[id], G[id], id === '9' ? [['Ghul', 220, 30]] : []];
let cur = 1, visits = [], now = 0, tgt = null, gold = 1000, arrived = 0;
const hero = { d: { x: 10, y: 10, lvl: 222, exp: 1 }, autoGoTo(p) { tgt = p; }, heroAtackRequest() {} };
const go = (m, from) => { if (m === 9 && !arrived) arrived = now; cur = m; Engine.map.d.name = NAMES[m]; Engine.map.d.id = m; const b = G[m].find(g => g[0] === from); hero.d.x = b ? b[1] : 10; hero.d.y = b ? b[2] : 10; tgt = null; dlg = null; };
// Teleport-NPC in Werbin bei (12,8)
const npcs = () => cur === 1 ? [{ d: { id: 500, nick: 'Teleporter Werbin', type: 0, x: 12, y: 8 } }] : [];
let dlg = null;   // { header, answers: [{text, act}] }
const menuMain = () => ({ header: 'Teleporter Werbin', answers: [{ text: '1. Teleport', act: () => dlg = menuTele() }, { text: '2. Do widzenia', act: () => dlg = null }] });
const menuTele = () => ({ header: 'Teleporter Werbin', answers: [{ text: '1. Ithan (100 zł)', act: () => { dlg = null; visits.push('Werbin⇒Ithan'); go(2, -1); } },
                                                                  { text: '2. Torneg (100 zł)', act: () => { dlg = null; visits.push('Werbin⇒Torneg'); go(3, -1); } },
                                                                  { text: '3. Wróć', act: () => dlg = menuMain() }] });
const _g = c => { const m = c.match(/talk&id=(\d+)/); if (m && cur === 1 && Math.abs(hero.d.x - 12) <= 1 && Math.abs(hero.d.y - 8) <= 1) dlg = menuMain(); };
const liOf = (a, i) => ({ textContent: a.text, querySelector: () => null, click: () => a.act(), closest: s => s === '.dialogue-window-answer' ? liOf(a, i) : null, _a: a });
const dialogEl = () => ({ querySelector: s => s === '.h_content' ? { textContent: dlg.header } : null, querySelectorAll: s => s === '.dialogue-window-answer' ? dlg.answers.map(liOf) : [] });
const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: () => npcs() }, deadController: {},
  map: { d: { id: 1, name: 'Werbin' }, size: { x: 20, y: 20 }, col: { check: () => 0 },
    getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const listeners = [];
const doc = { createElement: el, head: el(), body: el(), addEventListener: (t, f) => listeners.push([t, f]),
  querySelector: s => s === '.dialogue-window.is-open' && dlg ? dialogEl() : null, querySelectorAll: () => [] };
const store = { mbworld: world, mbauto: { on: false, pauseMin: 0, pauseMax: 0 } };
const timers = [];
const sb = { unsafeWindow: { Engine, _g, confirm: () => true, prompt: () => null }, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v,
  document: doc, innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
const T = n => { for (let i = 0; i < n; i++) { now += 200;
  if (tgt) { hero.d.x += Math.sign(tgt.x - hero.d.x); hero.d.y += Math.sign(tgt.y - hero.d.y);
    const g = G[cur].find(g => g[1] === hero.d.x && g[2] === hero.d.y); if (g && hero.d.x === tgt.x && hero.d.y === tgt.y) { visits.push(NAMES[cur] + '→' + NAMES[g[0]]); go(g[0], cur); } }
  timers[0](); } };
const userClick = text => { const a = dlg.answers.find(x => x.text.includes(text)); const li = liOf(a); for (const [t, f] of listeners) if (t === 'click') f({ target: li, isTrusted: true }); a.act(); };

// 0) Ohne Teleporter: Fußweg
T(2); store.mbauto.travel = { to: [9], label: 'Route', then: 'stop' }; T(400);
console.log('ohne Teleporter:', visits.join(' '), '| angekommen nach', (arrived / 1000).toFixed(0), 's');
// 1) Spieler spricht in Werbin mit dem Teleporter und schaut sich die Zielliste an (reist nicht)
visits = []; go(1); hero.d.x = 12; hero.d.y = 9; T(2);
_g('talk&id=500'); T(6); userClick('Teleport'); T(8); userClick('Wróć'); T(2); userClick('Do widzenia'); T(15);
console.log('gelernt:', JSON.stringify(store.mbauto.tele));
// 2) Bot reist von Werbin zur Route
const t0 = now; visits = []; arrived = 0; hero.d.x = 3; hero.d.y = 3;
store.mbauto.travel = { to: [9], label: 'Route', then: 'stop' }; T(400);
console.log('mit Teleporter:', visits.join(' '), '| angekommen auf', NAMES[cur], '| angekommen nach', ((arrived - t0) / 1000).toFixed(0), 's');
