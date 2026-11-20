// Ab 7.28: Zeitlimit („bis 03:00“ / „für 4 h“), Ablauf „Bei Level-Aufstieg“ und Schritt „Beste Ausrüstung anlegen“.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t); logs.push(t);')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg, limitEndFrom, gearUpgrades, startRule }; })();');

// Uhr der Simulation: Date.now und performance.now laufen gemeinsam
const realNow = Date.now;
let clock = new Date(2026, 10, 19, 22, 0, 0).getTime();
Date.now = () => clock;

function setup({ items = [], lvl = 25, prof = 'p', settings = {}, popupText = null } = {}) {
    let perf = 0;
    const sent = [], logs = [];
    const hero = { d: { x: 5, y: 5, lvl, prof, exp: 0, warrior_stats: { hp: 100, maxhp: 100 } }, autoGoTo() {}, heroAtackRequest() {} };
    const Engine = { hero, battle: { show: false }, deadController: { isDead: () => false }, npcs: { getDrawableList: () => [] },
        items: { fetchLocationItems: l => l === 'g' ? items.map(d => ({ d })) : [] },
        map: { d: { id: 1, name: 'Start' }, size: { x: 20, y: 20 }, col: { check: () => 0 },
            getGateways: () => ({ townnames: {}, getList: () => [] }) } };
    // Anlegen wie im Spiel: das neue Teil bekommt den Platz, das alte derselben Klasse geht in die Tasche
    const SLOT = { 9: 1, 12: 2, 13: 3, 11: 4, 1: 5, 2: 5, 3: 5, 4: 5, 6: 5, 8: 6, 5: 7, 7: 7, 14: 7, 21: 7, 10: 8, 22: 9 };
    const _g = c => {
        sent.push(c);
        const m = c.match(/^moveitem&st=1&id=(\d+)$/);
        if (!m) return;
        const it = items.find(d => d.id === +m[1]);
        if (it.bind) { popup = { it, text: popupText || 'Ten przedmiot zostanie związany z Twoją postacią na stałe.' }; return; }
        wear(it);
    };
    const wear = it => { const st = SLOT[it.cl]; for (const d of items) if (d.st === st) d.st = 0; it.st = st; };
    let popup = null; const pressed = [];
    const btn = () => ({ className: 'button alert-accept-hotkey', offsetWidth: 40, innerText: 'OK', closest: () => null,
        parentElement: { innerText: popup.text + '\nOK  Anuluj', parentElement: null },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 20 }),
        dispatchEvent(ev) { if (ev.type === 'click' && popup) { pressed.push(popup.text); wear(popup.it); popup = null; } } });
    const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, closest: () => null,
        querySelector: () => null, querySelectorAll: () => [], set innerHTML(s) {} });
    const W = { Engine, _g, prompt: () => null, confirm: () => true }, timers = [];
    const store = { mbauto: Object.assign({ humanize: 0, on: false, pauseMin: 0, pauseMax: 0 }, settings) };
    const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v, GM_notification() {}, logs,
        document: { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => popup ? [btn()] : [] },
        MouseEvent: class { constructor(type) { this.type = type; } },
        innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => perf } };
    new Function(...Object.keys(sb), src)(...Object.values(sb));
    const tick = (n, ms = 200) => { for (let i = 0; i < n; i++) { perf += ms; clock += ms; timers[0](); } };
    return { tick, sent, logs, hero, items, t: W.test, pressed, showPopup: text => { popup = { it: items[0], text }; }, get popup() { return popup; } };
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
// ── Pfeile (ab 7.30): mit Bogen eigener Platz, leerer Köcher wird beim Jagen nachgelegt
const BOW = () => [
    { id: 20, name: 'Bogen', loc: 'g', st: 5, cl: 4, stat: 'lvl=20;reqp=ht' },
    { id: 21, name: 'Alte Pfeile', loc: 'g', st: 0, cl: 21, stat: 'lvl=10;amount=100' },
    { id: 22, name: 'Gute Pfeile', loc: 'g', st: 0, cl: 21, stat: 'lvl=20;amount=50;reqp=ht' },
    { id: 23, name: 'Zu hohe Pfeile', loc: 'g', st: 0, cl: 21, stat: 'lvl=40;amount=80' }
];
{
    const s = setup({ items: BOW(), prof: 'h', settings: { on: true } });
    s.tick(10);
    const eq = s.sent.filter(c => /moveitem/.test(c));
    check('Bogen ohne Pfeile: beste tragbare Pfeile angelegt', eq.length === 1 && eq[0].endsWith('id=22'), eq.join(' '));
    s.items.find(d => d.id === 22).stat = 'lvl=20;amount=0;reqp=ht';             // Köcher leer geschossen
    s.tick(30);
    const eq2 = s.sent.filter(c => /moveitem/.test(c));
    check('… leerer Köcher: nächster Stapel nachgelegt', eq2.length === 2 && eq2[1].endsWith('id=21'), eq2.join(' '));
    const n = s.sent.length; s.tick(30);
    check('… danach Ruhe, solange Pfeile da sind', s.sent.length === n);
}
{
    const items = BOW(); items[1].st = 7;                                          // alte Pfeile angelegt
    const s = setup({ items, prof: 'h' });
    s.tick(1);
    check('Beste Ausrüstung: bessere Pfeile werden vorgeschlagen', s.t.gearUpgrades().some(u => u.slot === 'Pfeile' && u.item.id === 22));
}
{
    const items = BOW(); items[0].cl = 1;                                          // Nahkampfwaffe statt Bogen
    const s = setup({ items, prof: 'h', settings: { on: true } });
    s.tick(30);
    check('Ohne Bogen: keine Pfeile anlegen', !s.sent.some(c => /moveitem/.test(c)) && !s.t.gearUpgrades().some(u => u.slot === 'Pfeile'));
}
// ── Bindung (ab 7.31): Rückfrage nach eigenem Anlegen bestätigen, sonst nichts anklicken
{
    const items = ITEMS(); items.find(d => d.id === 2).bind = 1;                    // besserer Helm fragt nach Bindung
    const s = setup({ items, settings: { on: true, rules: [{ id: 'g', on: true, when: { t: 'lvlup', n: 1 }, steps: [{ t: 'gear' }] }] } });
    s.tick(5); s.hero.d.lvl = 26; s.tick(60);
    check('Bindungs-Rückfrage bestätigt, Helm angelegt', s.pressed.length === 1 && items.find(d => d.id === 2).st > 0 && s.logs.some(l => /Bindung/.test(l)));
}
{
    const items = ITEMS(); items.find(d => d.id === 2).bind = 1;
    const s = setup({ items, popupText: 'Czy na pewno chcesz sprzedać ten przedmiot?', settings: { on: true, rules: [{ id: 'g', on: true, when: { t: 'lvlup', n: 1 }, steps: [{ t: 'gear' }] }] } });
    s.tick(5); s.hero.d.lvl = 26; s.tick(60);
    check('Andere Rückfrage (Verkaufen) wird nicht angeklickt', s.pressed.length === 0);
}
{
    const s = setup({ items: ITEMS(), settings: { on: true } });
    s.tick(3); s.showPopup('Ten przedmiot zostanie związany z Twoją postacią.'); s.tick(20);
    check('Ohne eigenes Anlegen: Bindungsfenster bleibt unberührt', s.pressed.length === 0 && s.popup);
}
{
    const items = ITEMS(); items.find(d => d.id === 2).bind = 1;
    const s = setup({ items, settings: { on: true, bindOk: false, rules: [{ id: 'g', on: true, when: { t: 'lvlup', n: 1 }, steps: [{ t: 'gear' }] }] } });
    s.tick(5); s.hero.d.lvl = 26; s.tick(60);
    check('Einstellung aus: nicht bestätigen', s.pressed.length === 0);
}
// ── Verbrauchsgegenstände (ab 7.32): nie „anlegen“ – moveitem auf einen Trank trinkt ihn
{
    const items = ITEMS().concat([
        { id: 30, name: 'Trank mit Helmklasse', loc: 'g', st: 0, cl: 9, stat: 'lvl=24;leczy=500;amount=3' },
        { id: 31, name: 'Schriftrolle', loc: 'g', st: 0, cl: 16, stat: 'lvl=24' },
        { id: 32, name: 'Stapel Ringe', loc: 'g', st: 0, cl: 12, stat: 'lvl=24;amount=10' }]);
    const s = setup({ items });
    s.tick(1);
    const up = s.t.gearUpgrades().map(u => u.item.id);
    check('Beste Ausrüstung: keine Tränke, Verbrauchs- oder Stapelteile', !up.some(id => id >= 30) && !up.includes(11), JSON.stringify(up));
}
for (const [name, why] of [['', 'leerer Name'], ['Heiltrank', 'Trank als „Ausrüsten“']]) {
    const s = setup({ items: ITEMS(), settings: { on: true, rules: [{ id: 'e', on: true, when: { t: 'hand' }, steps: [{ t: 'equip', name }] }] } });
    s.tick(2); s.t.startRule(s.t.cfg.rules[0], 'Test'); s.tick(10);
    check(`Schritt „Ausrüsten“ (${why}): nichts angelegt oder verbraucht`, !s.sent.some(c => /moveitem/.test(c)) && s.t.cfg.chain === null);
}
// ── Ab 7.45: Werte statt Level – Unikat mit weniger Level bleibt, wenn es besser ist
{
    const items = [
        { id: 40, name: 'Unikat-Helm', loc: 'g', st: 1, cl: 9, stat: 'lvl=18;rarity=unique;ac=30;hp=80;ds=4' },
        { id: 41, name: 'Common-Helm', loc: 'g', st: 0, cl: 9, stat: 'lvl=24;ac=34' },
        { id: 42, name: 'Alte Schuhe', loc: 'g', st: 1, cl: 10, stat: 'lvl=20;rarity=unique;ac=10;hp=20' },
        { id: 43, name: 'Starke Schuhe', loc: 'g', st: 0, cl: 10, stat: 'lvl=24;ac=22;hp=40' },
        { id: 44, name: 'Siła-Ring', loc: 'g', st: 0, cl: 12, stat: 'lvl=20;ds=5' },
        { id: 45, name: 'Intelekt-Ring', loc: 'g', st: 0, cl: 12, stat: 'lvl=22;di=8' },
        { id: 46, name: 'Fast gleiche Handschuhe', loc: 'g', st: 0, cl: 11, stat: 'lvl=24;ac=20' },
        { id: 47, name: 'Handschuhe', loc: 'g', st: 1, cl: 11, stat: 'lvl=15;ac=20' }];
    const s = setup({ items });                                   // Paladin: Siła ist Hauptattribut
    s.tick(1);
    const up = s.t.gearUpgrades(), ids = up.map(u => u.item.id);
    check('Werte: Unikat-Helm (niedrigeres Level, mehr Werte) bleibt', !ids.includes(41), JSON.stringify(ids));
    check('Werte: deutlich stärkere Schuhe werden angelegt', ids.includes(43));
    check('Werte: Paladin nimmt Siła-Ring vor höherem Intelekt-Ring', ids.includes(44) && !ids.includes(45));
    check('Werte: gleich starke Teile nicht tauschen, auch bei höherem Level', !ids.includes(46));
    const m = setup({ items, prof: 'm' }); m.tick(1);
    check('Werte: Magier nimmt den Intelekt-Ring', m.t.gearUpgrades().some(u => u.item.id === 45));
}
Date.now = realNow;
process.exit(fail);
