// E2-Jagd: zur Karte der E2 reisen, neben den Spawnpunkt stellen, warten, angreifen; Respawn-Timer und Messung;
// mit „Spiel verlassen“: nach dem Kill offline gehen (Seite wechselt) und Erinnerung vor dem Respawn.
// Karten: 1 A ↔ 2 B. Die E2 „Mushita“ steht auf B bei 15,15; Respawn im Spiel nach 20 min.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace('function log(t) {', 'function log(t) { globalThis.__logs.push(t); if (process.env.LOG) console.log("   log:", t);').replace(/\}\)\(\);\s*$/, 'W.__e2state = () => e2rt; W.__reloadCols = () => loadCols(true); })();');
const logs = globalThis.__logs = [];
const NAMES = { 1: 'A', 2: 'B' };
const G = { 1: [[2, 19, 10]], 2: [[1, 0, 10]] };
const moves = [], pageLeaves = [];
let cur = 1, npcs = [], changedAt = -1e9, hits = [];
var now = 0;
const BASE = Date.UTC(2026, 10, 4, 10, 0, 0);
class FakeDate extends Date { constructor(...a) { a.length ? super(...a) : super(BASE + now); } static now() { return BASE + now; } }
const go = m => {
    const c0 = cur; cur = m; changedAt = now; Engine.map.d.name = NAMES[m]; Engine.map.d.id = m;
    const back = G[m].find(g => g[0] === c0); hero.d.x = back ? back[1] : 10; hero.d.y = back ? back[2] : 10;
};
const boss = (nick, x, y) => ({ d: { id: 777 + hits.length, nick: nick || 'Mushita', lvl: 23, x: x ?? 15, y: y ?? 15, type: 2, icon: 'e2/st-puma.gif' } });
let fogR = 0;                                   // Nebel: das Spiel liefert nur Mobs bis fogR Felder um den Helden
const hero = { d: { id: 1, x: 5, y: 5, lvl: 25 }, autoGoTo(p) {
    moves.push({ at: BASE + now, x: p.x, y: p.y });
    hero.d.x = p.x; hero.d.y = p.y;
    const g = G[cur].find(g => g[1] === p.x && g[2] === p.y);
    if (g) go(g[0]);
}, heroAtackRequest(id) { hits.push(now); npcs = npcs.filter(n => n.d.id !== id); } };   // Kampf ohne Fenster: Gruppe verschwindet
const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: () => cur !== 2 ? [] : fogR ? npcs.filter(n => Math.max(Math.abs(n.d.x - hero.d.x), Math.abs(n.d.y - hero.d.y)) <= fogR) : npcs }, deadController: { isDead: () => false },
  map: { d: { id: 1, name: 'A' }, size: { x: 20, y: 20 }, col: { check: () => (now - changedAt < 600 ? 1 : 0) },
    getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
const W = { Engine, _g: () => {} };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const world = { 1: [20, 20, 'A', G[1], []], 2: [20, 20, 'B', G[2], [['Mushita', 23, 1, [15, 15], 'e2/st-puma.gif']]] };
const store = { mbworld: world, mbauto: { on: false, pauseMin: 300, pauseMax: 300 } };
const timers = [], later = [];
let left = false;                              // Seitenwechsel: ab dann läuft das Spiel nicht mehr
const loc = { _h: 'https://jaruna.margonem.pl/', get href() { return this._h; }, set href(v) { pageLeaves.push(BASE + now); this._h = v; left = true; W.Engine = undefined; },
  get hostname() { return this._h.split('/')[2]; }, get origin() { return this._h.replace(/\/$/, ''); } };
const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null };
// Der Test ändert Einstellungen direkt in store.mbauto (am Panel vorbei) – die Helden-Ablage daraus lesen, wie im Spiel beide gleich sind
const sb = { unsafeWindow: W, GM_getValue: (k, d) => (/^mbhero:/.test(k) ? store.mbauto : store[k]) || d, GM_setValue: (k, v) => store[k] = v, GM_notification: o => notes.push(o.text),
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
const cheb = () => Math.max(Math.abs(hero.d.x - 15), Math.abs(hero.d.y - 15)), nearSpawn = () => cheb() >= 1 && cheb() <= 2;
const spot = nearSpawn() ? 1 : 0;
ok(cur === 2 && spot === 1, 'Reise nach B, wartet 1–2 Felder neben dem Spawnpunkt', `Karte ${NAMES[cur]}, Held ${hero.d.x},${hero.d.y}`);

// 2) E2 erscheint → Angriff → verschwindet → Timer läuft
npcs = [boss()];
T(7); const early = hits.length;               // 1,4 s nach dem Erscheinen: noch in der Reaktionszeit (2–6 s)
ok(early === 0, 'Reaktionszeit: greift nicht sofort an', `nach 1,4 s: ${early} Angriffe`);
min(0.2);
const reactS = (hits[0] - (now - 0.2 * 60000 - 1400)) / 1000;
ok(reactS >= 2 && reactS <= 6.6, 'Angriff nach 2–6 s Reaktionszeit', `nach ${reactS.toFixed(1)} s`);
ok(hits.length === 1 && t().kills === 1 && Math.abs(t().lastKill - (BASE + hits[0])) < 2000, 'angegriffen, Tod erkannt, Timer gestartet',
   `Angriffe ${hits.length}, Kills ${t().kills}, Respawn ${new FakeDate(t().lastKill + 15 * 60000).toISOString().slice(11, 16)}–${new FakeDate(t().lastKill + 30 * 60000).toISOString().slice(11, 16)} UTC`);

// 3) Respawn nach 20 min → gemessen, wieder angegriffen
min(20); npcs = [boss()]; min(0.2);
ok(hits.length === 2 && t().kills === 2 && t().meas.length === 1 && Math.abs(t().meas[0] - 20) < 0.3, 'Respawn gemessen und wieder angegriffen', `gemessen ${t().meas.join(', ')} min, Kills ${t().kills}`);

// 3a) Warteplatz nach jedem Kampf neu ausgelost: zufällig, 1–2 Felder vom Spawn, nicht immer dasselbe Feld
const spots = new Set(); let allNear = true;
for (let i = 0; i < 6; i++) { npcs = [boss()]; min(0.2); min(0.3); spots.add(hero.d.x + ',' + hero.d.y); if (!nearSpawn()) allNear = false; }
ok(allNear && spots.size >= 3, 'Warteplatz nach dem Kampf zufällig, 1–2 Felder vom Spawn', [...spots].join(' '));

// 3b) Name im Spiel weicht ab (anderer Name, passende E2-Grafik) → an Grafik erkannt und angegriffen
npcs = [boss('Dzika Mushita', 14, 13)]; min(0.3);
ok(hits.length === 9 && t().gameNick === 'Dzika Mushita' && logs.some(l => /erkannt über Grafik/.test(l)), 'anderer Name im Spiel: an Grafik erkannt, angegriffen', 'Name gemerkt: ' + t().gameNick);

// 3c) Nebel: E2 erscheint 10 Felder vom Spawn, der Bot sieht nur 8 Felder weit → Runde um den Spawnpunkt, findet sie
fogR = 8; min(15.5); npcs = [boss('Mushita', 5, 15)]; min(2);
ok(hits.length === 10 && logs.some(l => /Runde um den Spawnpunkt/.test(l)), 'Nebel: Runde um den Spawnpunkt, gefunden und angegriffen', `Angriffe ${hits.length}`);
fogR = 0; min(0.3);

// Neue Seite = Skript frisch geladen; game = ob dort das Spiel läuft (sonst Startseite oder Anmeldung)
const newPage = game => { W.Engine = game ? Engine : undefined; left = false; tickIdx = timers.length; new Function(...Object.keys(sb), src)(...Object.values(sb)); };
const SERVER = 'https://jaruna.margonem.pl/';
const leaveCycle = () => {                      // E2 erscheint, wird getötet → Bot geht offline
    npcs = [boss()]; min(0.2); min(0.1);
    return { killAt: t().lastKill, wake: e2().wakeAt };
};

// 4) „Spiel verlassen“: nach dem Kill von [server].margonem.pl auf die Hauptseite, Rückkehr 2–4 min vor dem Respawn
e2().away = 'leave';
let c = leaveCycle(), lead = (c.killAt + 15 * 60000 - c.wake) / 60000;
ok(e2().offline && loc.href === 'https://www.margonem.pl/' && e2().back === SERVER && lead >= 2 && lead <= 4, 'geht von jaruna.margonem.pl auf www.margonem.pl',
   `Seite ${loc.href}, zurück nach ${e2().back}, ${lead.toFixed(1)} min vor dem frühesten Respawn`);

// 5) Hauptseite (kein Spiel): zur Rückkehrzeit wieder die Spielseite öffnen
newPage(false);
min((c.wake - (BASE + now)) / 60000 + 0.1);
ok(loc.href === SERVER && notes.some(n => /zurück ins Spiel/.test(n)), 'öffnet zur Rückkehrzeit wieder die Spielseite', 'Seite ' + loc.href);

// 6) Spielseite lädt mit bestehender Sitzung → Bot macht am Spawnpunkt weiter
newPage(true); min(0.2);
ok(!e2().offline && e2().on && nearSpawn(), 'zurück im Spiel, weiter am Spawnpunkt', 'offline=' + e2().offline + ', Held ' + hero.d.x + ',' + hero.d.y);

// 7) Sitzung abgelaufen: Spielseite zeigt eine Anmeldung → kein zweiter Seitenwechsel, nur Erinnerung
c = leaveCycle(); newPage(false);
min((c.wake - (BASE + now)) / 60000 + 0.1);
const n0 = notes.length; newPage(false); min(1.5);
ok(loc.href === SERVER && !left && notes.slice(n0).some(n => /jetzt einloggen/.test(n)), 'Anmeldung statt Spiel: bleibt dort, erinnert nur', 'Seite ' + loc.href + ' · ' + notes.slice(-1)[0]);

// 8) Rückkehr aus: nur Erinnerung auf der Hauptseite
newPage(true); min(0.2); e2().autoBack = false;
c = leaveCycle(); newPage(false);
min((c.wake - (BASE + now)) / 60000 + 0.1);
ok(loc.href === 'https://www.margonem.pl/' && /jetzt einloggen/.test(notes.slice(-1)[0]), 'ohne Rückkehr: Erinnerung auf der Hauptseite', notes.slice(-1)[0]);

// 10) Sofort zurückgeleitet: zwei Minuten Pause gegen Neulade-Kreis, dann automatisch erneut versuchen.
newPage(true); min(0.2); e2().autoBack = true; e2().leaveMin = 1;
c = leaveCycle();
loc._h = SERVER; newPage(true); min(0.1);
const retryAt = e2().noLeaveUntil;
ok(!left && !e2().offline && retryAt > BASE + now && retryAt <= BASE + now + 2 * 60000,
   'Fehlgeschlagenes Verlassen: höchstens 2 min Pause');
min((retryAt - (BASE + now) - 2000) / 60000);
ok(!left && !e2().offline, 'Vor Ablauf der 2 min kein erneuter Seitenwechsel');
min(0.1);
ok(left && e2().offline && loc.href === 'https://www.margonem.pl/',
   'Nach 2 min automatisch erneut verlassen, ohne neuen Kill');
// Bereits gespeicherte 30-Minuten-Sperren werden beim Laden gekürzt.
e2().noLeaveUntil = BASE + now + 30 * 60000;
const loadedAt = BASE + now; newPage(false);
ok(e2().noLeaveUntil === loadedAt + 2 * 60000, 'Alte 30-min-Sperre auf 2 min gekürzt');
// Weiterer Kill: eigene Adresse zum Verlassen bleibt nutzbar.
e2().offline = false; e2().wakeAt = 0; e2().noLeaveUntil = 0; e2().leaveMin = 10;
e2().leaveUrl = 'https://www.margonem.pl/news'; loc._h = SERVER; newPage(true);
c = leaveCycle();
ok(left && loc.href === 'https://www.margonem.pl/news', 'eigene Adresse zum Verlassen', 'Seite ' + loc.href);

// 11) Rückkehr 1 min vor dem frühesten Respawn (alter Standard 2–4 min wird beim Laden umgestellt)
e2().remindMin = 2; e2().remindMax = 4; delete e2().remindV; e2().leaveUrl = ''; e2().offline = false; e2().wakeAt = 0;
loc._h = SERVER; newPage(true); e2().noLeaveUntil = 0; min(0.2);
c = leaveCycle(); lead = (c.killAt + 15 * 60000 - c.wake) / 60000;
ok(e2().remindMin === 1 && e2().remindMax === 1 && Math.abs(lead - 1) < 0.05, 'Rückkehr 1 min vor dem Respawn (alter Standard umgestellt)', lead.toFixed(2) + ' min vorher');

// 9) Richtwert für den Respawn gegen die Messungen auf margoatlas.pl („ok. X min“, Welt mit normalem Tempo)
const fsrc = src.match(/const e2Resp = [^\n]*\n/)[0];
const e2Resp = new Function('cfg', fsrc + 'return e2Resp;')({ e2: { speed: 1 } });
const ATLAS = [[23, 4.5], [37, 7], [57, 9.5], [75, 12], [105, 15], [131, 17], [160, 18], [183, 19], [237, 19], [300, 19]];
const bad = ATLAS.filter(([l, m]) => Math.abs(e2Resp(l) - m) > 0.6);
ok(!bad.length, 'Respawn-Richtwert passt zu margoatlas', ATLAS.map(([l, m]) => `${l}: ${e2Resp(l).toFixed(1)}/${m}`).join(' · '));
// 12) Nach dem Kill einmal 1,5–2,5 s warten: weder Warteplatz noch Logout vorher starten.
const prepareKill = away => {
    e2().on = true; e2().offline = false; e2().wakeAt = 0; e2().noLeaveUntil = 0; e2().away = away;
    e2().reactMin = e2().reactMax = 0; e2().leaveMin = 1;
    t().x = t().y = 15; t().lastKill = 0; npcs = []; fogR = 0;
    store.mbauto.pauseMin = store.mbauto.pauseMax = 0;
    loc._h = SERVER; newPage(true); T(2);
    const beforeHits = hits.length; npcs = [boss()];
    for (let i = 0; i < 20 && hits.length === beforeHits; i++) T(1);
    T(1); // Verschwinden bemerken, Kill-Zeit setzen
    return { at: t().lastKill, until: W.__e2state().afterKillUntil, moves: moves.length, left: pageLeaves.length };
};
let pause = prepareKill('stay');
ok(pause.until - pause.at >= 1500 && pause.until - pause.at <= 2500, 'Kill-Pause zufällig zwischen 1,5 und 2,5 s');
while (BASE + now + 200 < pause.until) T(1);
ok(moves.length === pause.moves && pageLeaves.length === pause.left, 'Während Kill-Pause weder weglaufen noch ausloggen');
T(1);
ok(moves.length > pause.moves && moves[pause.moves].at >= pause.until && nearSpawn(), 'Nach Kill-Pause zufälligen nahen Warteplatz anlaufen');
const chosen = W.__e2state().spot, previous = W.__e2state().previousSpot;
ok(!previous || chosen[0] !== previous[0] || chosen[1] !== previous[1], 'Anderen Warteplatz wählen, wenn Alternativen vorhanden sind');
pause = prepareKill('leave');
while (BASE + now + 200 < pause.until) T(1);
ok(!e2().offline && !left && moves.length === pause.moves, 'Logout verwendet dieselbe Kill-Pause wie Weglaufen');
T(25);
ok(left && pageLeaves[pause.left] >= pause.until + 1500 && pageLeaves[pause.left] <= pause.until + 2500,
    'Logout nach Kill-Pause plus bestehender Seitenwechsel-Frist', ((pageLeaves[pause.left] - pause.at) / 1000).toFixed(1) + ' s nach Kill');
// 13) Ein Münzwurf je Minutenfenster; Bewegung lokal und durch Sichtung/Logout abbrechbar.
prepareKill('stay'); T(25);
const originalRandom = Math.random;
try {
    let draws = 0; Math.random = () => { draws++; return 0.9; };
    let rt = W.__e2state(); rt.nextIdleAt = BASE + now - 1;
    const beforeMoves = moves.length; T(1);
    const afterDraw = draws;
    ok(!rt.idle && rt.nextIdleAt - (BASE + now) >= 55000 && rt.nextIdleAt - (BASE + now) <= 75000,
       '50%-Entscheidung: stehen bleiben und nächstes Minutenfenster setzen');
    T(200);
    ok(draws === afterDraw && moves.length === beforeMoves, 'Bei Nicht-Bewegen keine erneute Chance in jedem Takt');
    Math.random = () => 0.1;
    rt.nextIdleAt = BASE + now - 1;
    const walkStart = moves.length, home = [hero.d.x, hero.d.y];
    const nearbyDoor = [1, home[0], home[1] + 1]; G[cur].push(nearbyDoor);
    T(1);
    ok(!!rt.idle, '50%-Entscheidung: kurze Warterunde starten');
    for (let i = 0; i < 100 && rt.idle; i++) T(1);
    const walk = moves.slice(walkStart);
    ok(!rt.idle && walk.length > 1 && hero.d.x === home[0] && hero.d.y === home[1], 'Warterunde endet wieder am Warteplatz');
    ok(walk.every(p => Math.max(Math.abs(p.x - t().x), Math.abs(p.y - t().y)) <= 5
        && !(p.x === t().x && p.y === t().y) && !G[cur].some(g => g[1] === p.x && g[2] === p.y)),
        'Warterunde bleibt nah am Spawn und meidet Spawnkachel und Türen');
    G[cur].splice(G[cur].indexOf(nearbyDoor), 1);
    // Keine passende lokale Fläche: nicht gegen Wände laufen.
    const colCheck = Engine.map.col.check, anchor = [hero.d.x, hero.d.y];
    Engine.map.col.check = (x, y) => Math.max(Math.abs(x - t().x), Math.abs(y - t().y)) <= 5 && !(x === anchor[0] && y === anchor[1]) ? 1 : 0;
    W.__reloadCols(); rt.nextIdleAt = BASE + now - 1;
    const blockedMoves = moves.length; T(1);
    ok(!rt.idle && moves.length === blockedMoves, 'Ohne lokale begehbare Runde stehen bleiben');
    Engine.map.col.check = colCheck; W.__reloadCols();
    rt.nextIdleAt = BASE + now - 1; T(1); const beforeHit = hits.length;
    npcs = [boss()]; T(5);
    ok(!rt.idle && hits.length === beforeHit + 1, 'Sichtbare E2 unterbricht Warterunde sofort');
    prepareKill('stay'); T(25); rt = W.__e2state(); rt.nextIdleAt = BASE + now - 1; T(1);
    ok(!!rt.idle, 'Warterunde vor Logout-Test aktiv');
    e2().away = 'leave'; T(35);
    ok(left && e2().offline && !rt.idle, 'Fälliger Logout hat Vorrang vor Warterunde');
} finally { Math.random = originalRandom; }
if (fail) process.exit(1);
