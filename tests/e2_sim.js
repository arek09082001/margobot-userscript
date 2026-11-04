// E2-Jagd: zur Karte der E2 reisen, neben den Spawnpunkt stellen, warten, angreifen; Respawn-Timer und Messung;
// mit „Spiel verlassen“: nach dem Kill offline gehen (Seite wechselt) und Erinnerung vor dem Respawn.
// Karten: 1 A ↔ 2 B. Die E2 „Mushita“ steht auf B bei 15,15; Respawn im Spiel nach 20 min.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace('function log(t) {', 'function log(t) { globalThis.__logs.push(t); if (process.env.LOG) console.log("   log:", t);');
const logs = globalThis.__logs = [];
const NAMES = { 1: 'A', 2: 'B' };
const G = { 1: [[2, 19, 10]], 2: [[1, 0, 10]] };
let cur = 1, npcs = [], changedAt = -1e9, hits = [];
var now = 0;
const BASE = Date.UTC(2026, 10, 4, 10, 0, 0);
class FakeDate extends Date { constructor(...a) { a.length ? super(...a) : super(BASE + now); } static now() { return BASE + now; } }
const go = m => {
    const c0 = cur; cur = m; changedAt = now; Engine.map.d.name = NAMES[m]; Engine.map.d.id = m;
    const back = G[m].find(g => g[0] === c0); hero.d.x = back ? back[1] : 10; hero.d.y = back ? back[2] : 10;
};
const boss = () => ({ d: { id: 777 + hits.length, nick: 'Mushita', lvl: 23, x: 15, y: 15, type: 2, icon: 'e2/st-puma.gif' } });
const hero = { d: { id: 1, x: 5, y: 5, lvl: 25 }, autoGoTo(p) {
    hero.d.x = p.x; hero.d.y = p.y;
    const g = G[cur].find(g => g[1] === p.x && g[2] === p.y);
    if (g) go(g[0]);
}, heroAtackRequest(id) { hits.push(now); npcs = npcs.filter(n => n.d.id !== id); } };   // Kampf ohne Fenster: Gruppe verschwindet
const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: () => cur === 2 ? npcs : [] }, deadController: { isDead: () => false },
  map: { d: { id: 1, name: 'A' }, size: { x: 20, y: 20 }, col: { check: () => (now - changedAt < 600 ? 1 : 0) },
    getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
const W = { Engine, _g: () => {} };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const world = { 1: [20, 20, 'A', G[1], []], 2: [20, 20, 'B', G[2], [['Mushita', 23, 1, [15, 15], 'e2/st-puma.gif']]] };
const store = { mbworld: world, mbauto: { on: false, pauseMin: 300, pauseMax: 300 } };
const timers = [], later = [];
let left = false;                              // Seitenwechsel: ab dann läuft das Spiel nicht mehr
const loc = { hostname: 'jaruna.margonem.pl', _h: 'https://jaruna.margonem.pl/', get href() { return this._h; }, set href(v) { this._h = v; left = true; W.Engine = undefined; } };
const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null };
const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v, GM_notification: o => notes.push(o.text),
  document: doc, innerWidth: 1400, setInterval: f => timers.push(f), setTimeout: (f, ms) => later.push([now + (ms || 0), f]),
  performance: { now: () => now }, Date: FakeDate, location: loc, navigator: {} };
const notes = [];
new Function(...Object.keys(sb), src)(...Object.values(sb));
const T = n => { for (let i = 0; i < n; i++) {
    now += 200;
    for (let k = later.length - 1; k >= 0; k--) if (later[k][0] <= now) { const f = later[k][1]; later.splice(k, 1); f(); }
    timers[tickIdx]();
} };
let tickIdx = 0;
const min = m => T(Math.round(m * 60000 / 200));
let fail = 0;
const ok = (c, name, why) => { if (!c) fail = 1; console.log((c ? 'OK    ' : 'FEHLER') + ' ' + name + (why ? ' | ' + why : '')); };

// Panel-Klick nachstellen geht hier nicht – E2 direkt eintragen wie e2Add()
store.mbauto.e2 = { on: true, sel: 'Mushita|2', away: 'stay', leaveMin: 10, remindMin: 2, remindMax: 4,
                    list: { 'Mushita|2': { nick: 'Mushita', lvl: 23, map: 2, x: 15, y: 15, respMin: 15, respMax: 30, lastKill: 0, kills: 0, meas: [] } } };
const e2 = () => store.mbauto.e2, t = () => e2().list['Mushita|2'];
T(10);                                 // nach der ersten Speicherung ist store.mbauto das cfg-Objekt des Skripts

// 1) Anreise und Warten neben dem Spawnpunkt (E2 noch nicht da)
min(0.5);
const spot = Math.abs(hero.d.x - 15) + Math.abs(hero.d.y - 15);
ok(cur === 2 && spot === 1, 'Reise nach B, wartet neben dem Spawnpunkt', `Karte ${NAMES[cur]}, Held ${hero.d.x},${hero.d.y}`);

// 2) E2 erscheint → Angriff → verschwindet → Timer läuft
npcs = [boss()];
min(0.2);
ok(hits.length === 1 && t().kills === 1 && Math.abs(t().lastKill - (BASE + hits[0])) < 2000, 'angegriffen, Tod erkannt, Timer gestartet',
   `Angriffe ${hits.length}, Kills ${t().kills}, Respawn ${new FakeDate(t().lastKill + 15 * 60000).toISOString().slice(11, 16)}–${new FakeDate(t().lastKill + 30 * 60000).toISOString().slice(11, 16)} UTC`);

// 3) Respawn nach 20 min → gemessen, wieder angegriffen
min(20); npcs = [boss()]; min(0.2);
ok(hits.length === 2 && t().kills === 2 && t().meas.length === 1 && Math.abs(t().meas[0] - 20) < 0.3, 'Respawn gemessen und wieder angegriffen', `gemessen ${t().meas.join(', ')} min, Kills ${t().kills}`);

// 4) „Spiel verlassen“: nach dem Kill offline, Erinnerung 2–4 min vor frühestem Respawn
e2().away = 'leave'; npcs = [boss()]; min(0.2); min(0.1);
const killAt = t().lastKill, wake = e2().wakeAt, lead = (killAt + 15 * 60000 - wake) / 60000;
ok(e2().offline && loc.href === 'https://www.margonem.pl/' && lead >= 2 && lead <= 4, 'geht offline zur Startseite, Erinnerung vor dem Respawn',
   `Seite ${loc.href}, erinnert ${lead.toFixed(1)} min vor dem frühesten Respawn`);

// 5) Erinnerung auf der Startseite (kein Spiel, Engine ist seit dem Seitenwechsel weg): bis zur Erinnerung vorspulen
min((wake - (BASE + now)) / 60000 + 0.1);
ok(notes.some(n => /jetzt einloggen/.test(n)), 'Erinnerung auf der Startseite', notes.slice(-1)[0]);

// 6) Selbst wieder eingeloggt (neue Seite = Skript frisch geladen) → Bot macht weiter
ok(e2().offline && left, 'bleibt offline, bis du dich einloggst', 'offline=' + e2().offline);
W.Engine = Engine;
tickIdx = timers.length;                       // ab jetzt nur noch der Takt der neuen Seite
new Function(...Object.keys(sb), src)(...Object.values(sb));
const e2n = () => store.mbauto.e2;
min(0.2);
ok(!e2n().offline && e2n().on && Math.abs(hero.d.x - 15) + Math.abs(hero.d.y - 15) === 1, 'nach dem Einloggen weiter am Spawnpunkt', 'offline=' + e2n().offline + ', Held ' + hero.d.x + ',' + hero.d.y);
if (fail) process.exit(1);
