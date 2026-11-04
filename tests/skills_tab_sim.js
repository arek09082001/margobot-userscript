// Tab „Fähigkeiten“: zeigt die Daten richtig an und schickt nichts ans Spiel.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8');
const stat = 'sa_per=2;energy=18';
const mk = (id, name, grp, xy, c, type, regs) => ({ id, name, grp, xy, cLvl: c, mLvl: 10, lvl: c + '/10', type, regs, desc: 'Text <b>fett</b>', allStats: Array.from({ length: 10 }, (_, k) => 'sa_per=' + (2 * (k + 1)) + ';cooldown=2') });
const skills = {
    'skill_-1': { id: -1, name: 'Zwykły atak', lvl: '1/1' },
    skill_99: mk(99, 'Gorące uderzenie', 9, 1, 0, 'active', 'reqp=p;reqw=fire;lvl=25'),
    skill_112: mk(112, 'Porażający cios', 9, 3, 10, 'active', 'reqp=p;reqw=light;lvl=25'),
    skill_25: mk(25, 'Prowokujący okrzyk', 10, 5, 0, 'active', 'reqp=p;reqw=sh;lvl=35'),
    skill_301: mk(301, 'Napięcie bojowe', 15, 3, 0, 'passive', 'reqp=p;reqw=light;lvl=230')
};
const sent = [], gear = [{ id: 1, name: 'Kość', loc: 'g', st: 5, cl: 1, stat: 'dmg=1,2;light=3,4' }];
let html = '', loaded = true;
const hero = { d: { x: 5, y: 5, lvl: 40, exp: 1, gold: 1 }, autoGoTo() { sent.push('walk'); }, heroAtackRequest() { sent.push('attack'); } };
const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: () => [] }, deadController: {},
    skills: { getSkills: () => loaded ? skills : {}, getGroupedSkills: () => ({ 1: { requiredLvl: '25' }, 2: { requiredLvl: '35' }, 3: { requiredLvl: '230' } }) },
    items: { fetchLocationItems: l => l === 'g' ? gear.map(d => ({ d })) : [] },
    map: { d: { id: 1, name: 'Test' }, size: { x: 10, y: 10 }, col: { check: () => 0 }, getGateways: () => ({ townnames: {}, getList: () => [] }) } };
const listeners = {};
const el = () => ({ style: {}, dataset: {}, addEventListener(t, f) { listeners[t] = f; }, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, set innerHTML(v) { if (v) html = v; }, get innerHTML() { return html; } });
const store = { mbauto: { open: true, tab: 'skills', on: false, pauseMin: 0, pauseMax: 0 } };
const timers = [];
const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
const W = { Engine, _g: c => sent.push(c), confirm: () => true, prompt: () => null };
const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v, document: doc, innerWidth: 1400, innerHeight: 900,
    setInterval: f => timers.push(f), performance: { now: () => 0 } };
new Function(...Object.keys(sb), src)(...Object.values(sb));
const render = () => timers.forEach(f => { try { f(); } catch (e) {} });
const check = (name, ok) => { console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name); if (!ok) process.exitCode = 1; };

render();
const rowOf = n => html.split('<div class="skr').slice(1)[n - 1] || '';
check('Punkte frei: 16 von ~16, 10 gesetzt → 6 frei', /<b>6<\/b>/.test(html) && html.includes('10 von ~16'));
check('Waffe mit Klasse und Element', html.includes('Kość · Einhand · Blitz'));
check('Reihe 1 offen, Stufe 10/10', html.includes('10/10') && !rowOf(1).startsWith(' lock'));
check('Feuer-Fähigkeit passt nicht zur Blitz-Waffe', /Gorące uderzenie[\s\S]*?passt nicht/.test(rowOf(1)));
check('Blitz-Fähigkeit passt', !/Porażający cios<\/span>\s*<span class="tg">[^<]*<i>/.test(rowOf(1)));
check('Schild-Fähigkeit passt ohne Schild nicht', rowOf(2).includes('passt nicht'));
check('Reihe 3 wegen Level gesperrt', rowOf(3).startsWith(' lock') && rowOf(3).includes('gesperrt: Lvl 230'));
check('Grundangriff nicht in der Liste', !html.includes('Zwykły atak'));

gear.push({ id: 2, name: 'Schild', loc: 'g', st: 7, cl: 14, stat: '' }); hero.d.lvl = 240;
render();
check('mit Schild passt die Schild-Fähigkeit', !rowOf(2).includes('passt nicht'));
check('Reihe 3 trotz Level gesperrt: zu wenig Punkte gesetzt', rowOf(3).startsWith(' lock') && rowOf(3).includes('25 gesetzte Punkte'));

const clickOn = i => listeners.click({ target: { closest: () => ({ dataset: { a: 'skopen', i: String(i) }, tagName: 'BUTTON' }) } });
clickOn(112); render();
check('Klick zeigt Details, HTML aus dem Spiel ist entschärft', html.includes('Text  fett') && !html.includes('Text <b>'));
check('letzte Stufe zeigt keinen nächsten Wert', html.includes('Stufe 10') && !html.includes('Stufe 11'));
clickOn(112); render();
check('zweiter Klick schließt die Details', !html.includes('class="skd"'));
clickOn(99); render();
check('Stufe 0 zeigt den Wert der ersten Stufe', html.includes('Stufe 1') && html.includes('sa_per'));

loaded = false; hero.d.lvl = 41; render();
check('ohne Daten: Hinweis statt Fehler', html.includes('Fähigkeiten-Fenster') && html.includes('Kość'));
check('nichts ans Spiel geschickt', sent.length === 0);
if (sent.length) console.log('gesendet:', sent);
