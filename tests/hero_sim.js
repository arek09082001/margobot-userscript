// Einstellungen pro Held: zwei Helden in derselben Welt, Wechsel per Neuladen der Seite, Startseite (E2 offline) dazwischen.
// GM-Speicher wie in Tampermonkey: Werte werden als JSON abgelegt (Kopie, nie dasselbe Objekt).
const fs = require('fs');
const SRC = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'W.__cfg = cfg; W.__save = save; })();');
const gm = {};
const GM_getValue = (k, d) => (k in gm ? JSON.parse(gm[k]) : d), GM_setValue = (k, v) => { gm[k] = JSON.stringify(v); };
// Stand vor dem Update: eine gemeinsame Einstellung für alle
GM_setValue('mbauto', { route: 'Alt', routes: { Alt: { maps: ['A'] } }, lvlMin: 20, lvlMax: 25, on: true, graph: { A: ['B'] }, x: 50,
                        e2: { list: { 'Mushita|2': { nick: 'Mushita', map: 2 } }, sel: 'Mushita|2' } });
let fail = 0;
const ok = (c, name, why) => { if (!c) fail = 1; console.log((c ? 'OK    ' : 'FEHLER') + ' ' + name + (why ? ' | ' + why : '')); };
const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null, referrer: '' };
function page(hero) {                            // Seite laden: hero = { id, nick } im Spiel, null = Startseite ohne Spiel
    const timers = [];
    const Engine = hero && { hero: { d: Object.assign({ x: 5, y: 5, lvl: 30 }, hero), autoGoTo() {} }, battle: { show: false },
        npcs: { getDrawableList: () => [] }, map: { d: { id: 1, name: 'A' }, size: { x: 20, y: 20 }, col: { check: () => 0 },
        getGateways: () => ({ townnames: {}, getList: () => [] }) } };
    const W = { Engine };
    const sb = { unsafeWindow: W, GM_getValue, GM_setValue, GM_notification() {}, document: doc, innerWidth: 1400, innerHeight: 900,
        setInterval: f => timers.push(f), setTimeout() {}, performance: { now: () => 0 },
        location: { hostname: hero ? 'cronus.margonem.com' : 'www.margonem.com', href: '', origin: '' } };
    new Function(...Object.keys(sb), SRC)(...Object.values(sb));
    if (hero) timers[0]();                       // ein Takt: Held erkannt → Einstellungen gebunden
    return W;
}
const AREK = { id: 11, nick: 'arek rambo' }, ZWEI = { id: 22, nick: 'Zweiter' };

// 1) Erster Held nach dem Update: übernimmt alles, wie es war
let w = page(AREK), c = w.__cfg;
ok(c.route === 'Alt' && c.lvlMin === 20 && c.on === true && c.e2.list['Mushita|2'], 'erster Held übernimmt die bisherigen Einstellungen', `Route ${c.route}, Lvl ${c.lvlMin}`);
c.route = 'ArekRoute'; c.routes.ArekRoute = { maps: ['X', 'Y'] }; c.lvlMin = 40; c.x = 123; w.__save();

// 2) Anderer Held: startet mit Kopie, aber nichts läuft
w = page(ZWEI); c = w.__cfg;
ok(c.route === 'ArekRoute' && c.on === false && c.x === 123, 'neuer Held: Vorlage = letzte Einstellungen, Bot aus', `Route ${c.route}, on=${c.on}`);
c.route = 'ZweiRoute'; c.routes.ZweiRoute = { maps: ['Z'] }; c.lvlMin = 70; c.e2.list = { 'Boss|9': { nick: 'Boss', map: 9 } }; c.e2.sel = 'Boss|9';
c.graph.Q = ['R']; c.x = 222; w.__save();

// 3) Zurück zu arek rambo: seine Route, sein Level, seine E2 – gemeinsames Kartenwissen und Panel-Lage vom Zweiten
w = page(AREK); c = w.__cfg;
ok(c.route === 'ArekRoute' && c.lvlMin === 40 && c.e2.sel === 'Mushita|2' && !c.e2.list['Boss|9'], 'arek rambo: eigene Route, Level, E2', `Route ${c.route}, Lvl ${c.lvlMin}, E2 ${c.e2.sel}`);
ok(c.graph.Q && c.x === 222, 'Kartenwissen und Panel-Lage gemeinsam', `graph.Q=${JSON.stringify(c.graph.Q)}, x=${c.x}`);

// 4) E2 offline mit arek rambo → Startseite ohne Spiel nutzt seinen Stand
c.e2.offline = true; c.e2.wakeAt = 123456; w.__save();
w = page(null); c = w.__cfg;
ok(c.e2.offline && c.e2.wakeAt === 123456 && c.route === 'ArekRoute', 'Startseite (E2 offline): Stand des zuletzt aktiven Helden', `offline=${c.e2.offline}, Route ${c.route}`);

// 5) Danach der Zweite: sein Stand, kein Offline-Warten von arek
w = page(ZWEI); c = w.__cfg;
ok(c.route === 'ZweiRoute' && c.lvlMin === 70 && !c.e2.offline && c.e2.sel === 'Boss|9', 'Zweiter: eigener Stand, nicht arek’s Offline-Warten', `Route ${c.route}, offline=${c.e2.offline}`);
process.exit(fail);
