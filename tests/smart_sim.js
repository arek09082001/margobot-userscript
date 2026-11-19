// Ab 7.28: Zeitlimit („bis 03:00“ / „für 4 h“), Ablauf „Bei Level-Aufstieg“ und Schritt „Beste Ausrüstung anlegen“.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t); logs.push(t);')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg, limitEndFrom, gearUpgrades, startRule }; })();');

// Uhr der Simulation: Date.now und performance.now laufen gemeinsam
const realNow = Date.now;
let clock = new Date(2026, 10, 19, 22, 0, 0).getTime();
Date.now = () => clock;

function setup({ items = [], lvl = 25, prof = 'p', settings = {} } = {}) {
    let perf = 0;
    const sent = [], logs = [];
    const hero = { d: { x: 5, y: 5, lvl, prof, exp: 0, warrior_stats: { hp: 100, maxhp: 100 } }, autoGoTo() {}, heroAtackRequest() {} };
    const Engine = { hero, battle: { show: false }, deadController: { isDead: () => false }, npcs: { getDrawableList: () => [] },
        items: { fetchLocationItems: l => l === 'g' ? items.map(d => ({ d })) : [] },
        map: { d: { id: 1, name: 'Start' }, size: { x: 20, y: 20 }, col: { check: () => 0 },
            getGateways: () => ({ townnames: {}, getList: () => [] }) } };
    // Anlegen wie im Spiel: das neue Teil bekommt den Platz, das alte derselben Klasse geht in die Tasche
    const SLOT = { 9: 1, 12: 2, 13: 3, 11: 4, 1: 5, 2: 5, 3: 5, 4: 5, 6: 5, 8: 6, 5: 7, 7: 7, 14: 7, 10: 8, 22: 9 };
    const _g = c => {
        sent.push(c);
        const m = c.match(/^moveitem&st=1&id=(\d+)$/);
        if (!m) return;
        const it = items.find(d => d.id === +m[1]), st = SLOT[it.cl];
        for (const d of items) if (d.st === st) d.st = 0;
        it.st = st;
    };
    const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, closest: () => null,
        querySelector: () => null, querySelectorAll: () => [], set innerHTML(s) {} });
    const W = { Engine, _g, prompt: () => null, confirm: () => true }, timers = [];
    const store = { mbauto: Object.assign({ humanize: 0, on: false, pauseMin: 0, pauseMax: 0 }, settings) };
    const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v, GM_notification() {}, logs,
        document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null },
        innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => perf } };
    new Function(...Object.keys(sb), src)(...Object.values(sb));
    const tick = (n, ms = 200) => { for (let i = 0; i < n; i++) { perf += ms; clock += ms; timers[0](); } };
    return { tick, sent, logs, hero, items, t: W.test };
}
let fail = 0;
const check = (name, ok, info) => { console.log((ok ? 'OK     ' : 'FEHLER ') + name + (info ? ' | ' + info : '')); if (!ok) fail = 1; };

// ── Zeitlimit „für“: stoppt nach der Dauer, gilt ab dem Start
{
    const s = setup({ settings: { limit: { mode: 'for', hours: 0.5, at: '03:00' } } });
    s.tick(2);
    s.t.cfg.on = true;
    s.tick(5);
    const end = s.t.cfg.limitEnd;
    check('für 0,5 h: Ende ab Start gesetzt', Math.abs(end - (clock + 30 * 60000)) < 3000, new Date(end).toTimeString().slice(0, 5));
    s.tick(29 * 60 * 5, 200);                                             // 29 min
    check('… nach 29 min läuft er noch', s.t.cfg.on === true);
    s.tick(2 * 60 * 5, 200);                                              // weitere 2 min
    check('… nach 31 min gestoppt, Grund im Verlauf', s.t.cfg.on === false && s.t.cfg.limitEnd === 0 && s.logs.some(l => /Zeitlimit erreicht/.test(l)));
}
// ── Zeitlimit „bis“: nächstes Vorkommen der Uhrzeit, auch über Mitternacht
{
    const s = setup({ settings: { limit: { mode: 'until', at: '03:00', hours: 4 } } });
    const at22 = new Date(2026, 10, 19, 22, 0, 0).getTime(), at04 = new Date(2026, 10, 20, 4, 0, 0).getTime();
    check('bis 03:00 um 22:00 → in 5 h', s.t.limitEndFrom(at22) === new Date(2026, 10, 20, 3, 0, 0).getTime());
    check('bis 03:00 um 04:00 → nächste Nacht', s.t.limitEndFrom(at04) === new Date(2026, 10, 21, 3, 0, 0).getTime());
    s.tick(1); s.t.cfg.on = true; s.tick(2);
    const left = s.t.cfg.limitEnd - clock;
    s.tick(Math.ceil(left / 200) + 5);
    check('… stoppt um 03:00', s.t.cfg.on === false);
    s.t.cfg.limit.mode = 'off'; s.t.cfg.on = true; s.tick(5);
    check('ohne Zeitlimit: kein Ende gesetzt', s.t.cfg.limitEnd === 0 && s.t.cfg.on === true);
}

// ── Beste Ausrüstung: nur tragbare, bessere Teile; Waffenklasse und Profession beachten
const ITEMS = () => [
    { id: 1, name: 'Alter Helm', loc: 'g', st: 1, cl: 9, stat: 'lvl=10' },
    { id: 2, name: 'Besserer Helm', loc: 'g', st: 0, cl: 9, stat: 'lvl=20' },
    { id: 3, name: 'Zu hoher Helm', loc: 'g', st: 0, cl: 9, stat: 'lvl=40' },
    { id: 4, name: 'Altes Schwert', loc: 'g', st: 5, cl: 1, stat: 'lvl=15' },
    { id: 5, name: 'Kriegerschwert', loc: 'g', st: 0, cl: 1, stat: 'lvl=25;reqp=w' },
    { id: 6, name: 'Paladinschwert', loc: 'g', st: 0, cl: 1, stat: 'lvl=22;reqp=wp' },
    { id: 7, name: 'Zweihänder', loc: 'g', st: 0, cl: 2, stat: 'lvl=25' },
    { id: 8, name: 'Holzschild', loc: 'g', st: 0, cl: 14, stat: 'lvl=12' },
    { id: 9, name: 'Seltener Ring', loc: 'g', st: 2, cl: 12, stat: 'lvl=18;rarity=unique' },
    { id: 10, name: 'Normaler Ring', loc: 'g', st: 0, cl: 12, stat: 'lvl=21' },
    { id: 11, name: 'Heiltrank', loc: 'g', st: 0, stat: 'leczy=50;amount=5' }
];
{
    const s = setup({ items: ITEMS() });
    s.tick(1);
    const up = s.t.gearUpgrades().map(u => u.item.id).sort((a, b) => a - b);
    check('Vorschlag: Helm 20, Paladinschwert, Schild – nicht zu hoch, nicht fremde Klasse/Profession, Unikat-Ring bleibt', JSON.stringify(up) === '[2,6,8]', JSON.stringify(up));
}

// ── Ablauf „Bei jedem Level-Aufstieg“ → Beste Ausrüstung
{
    const s = setup({ items: ITEMS(), settings: { on: true, rules: [{ id: 'g', on: true, when: { t: 'lvlup', n: 1 }, steps: [{ t: 'gear' }] }] } });
    s.tick(5);
    check('Level-Aufstieg: bei gleichem Level nichts', !s.sent.some(c => /moveitem/.test(c)));
    s.hero.d.lvl = 26; s.tick(40);
    const eq = s.sent.filter(c => /moveitem/.test(c)).map(c => +c.split('=').pop()).sort((a, b) => a - b);
    check('Level 26: drei bessere Teile angelegt, Ablauf fertig', JSON.stringify(eq) === '[2,6,8]' && s.t.cfg.chain === null, JSON.stringify(eq));
    check('… danach trägt der Held sie', [2, 6, 8].every(id => s.items.find(d => d.id === id).st > 0));
    const n = s.sent.length; s.tick(20);
    check('… kein zweites Auslösen ohne neues Level', s.sent.length === n);
}
// ── Alle 2 Level
{
    const s = setup({ items: ITEMS(), settings: { on: true, rules: [{ id: 'g', on: true, when: { t: 'lvlup', n: 2 }, steps: [{ t: 'gear' }] }] } });
    s.tick(5); s.hero.d.lvl = 26; s.tick(20);
    check('alle 2 Level: bei +1 nichts', !s.sent.some(c => /moveitem/.test(c)));
    s.hero.d.lvl = 27; s.tick(40);
    check('… bei +2 ausgelöst', s.sent.some(c => /moveitem/.test(c)));
}
Date.now = realNow;
process.exit(fail);
