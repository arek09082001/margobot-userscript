// Fähigkeiten-Vorschlag und „anwenden“: nur nach Rückfrage, Punkt für Punkt, hält bei jeder Abweichung an.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'W.__sk = { skillPlan, skStart, skStop, get run() { return skRun; } }; })();');
const stats = (key, a, b) => Array.from({ length: 10 }, (_, k) => key + '=' + (a + (b - a) * k / 9));
const mk = (id, name, grp, xy, c, type, reqw, lvl, st) => ({ id, name, grp, xy, cLvl: c, mLvl: 10, lvl: c + '/10', type, desc: name,
    regs: 'reqp=p;' + (reqw ? 'reqw=' + reqw + ';' : '') + 'lvl=' + lvl, allStats: st });
function setup({ lvl = 60, used = 26, total = 36, gold = 1e7, windowOpen = true, refuse = null, confirm = true } = {}) {
    const skills = {
        skill_1: mk(1, 'Feuerhieb', 9, 1, 0, 'active', 'fire', 25, stats('perdmg', 50, 90)),          // stark, aber falsches Element
        skill_2: mk(2, 'Monsterjäger', 9, 2, 8, 'passive', '', 25, stats('dmg_to_npc_per', 2, 20)),
        skill_3: mk(3, 'Spielerschutz', 9, 3, 8, 'passive', '', 25, stats('dmg_from_player_per', 2, 20)),
        skill_4: mk(4, 'Voll', 10, 1, 10, 'passive', '', 35, stats('crit', 1, 30)),
        skill_5: mk(5, 'Zäh', 10, 2, 0, 'passive', '', 35, stats('hpbon', 1, 3)),
        skill_6: mk(6, 'Zu hoch', 11, 1, 0, 'passive', '', 230, stats('perdmg', 50, 90)),               // Level fehlt
        skill_7: mk(7, 'Reihe 3', 11, 2, 0, 'passive', '', 50, stats('crit', 10, 30))                   // braucht 25 gesetzte Punkte (Level 230-Reihe)
    };
    const sent = [], logs = [];
    let now = 0, battle = false;
    const W = { Engine: null, confirm: () => { W.asked = (W.asked || 0) + 1; return confirm; }, prompt: () => null,
        _g: c => { sent.push(c); const m = c.match(/skills&learn=(\d+)&lvl=(\d+)/); if (m && !(refuse && refuse(+m[1]))) { const x = skills['skill_' + m[1]]; x.cLvl = +m[2]; x.lvl = m[2] + '/10'; } } };
    const hero = { d: { x: 5, y: 5, lvl, exp: 1, gold, nick: 'T' } };
    W.Engine = { hero, battle: { get show() { return battle; } }, npcs: { getDrawableList: () => [] }, deadController: {},
        skills: { getSkills: () => skills, getGroupedSkills: () => ({ 1: { requiredLvl: '25' }, 2: { requiredLvl: '35' }, 3: { requiredLvl: '230' } }) },
        items: { fetchLocationItems: l => l === 'g' ? [{ d: { id: 9, name: 'Kość', loc: 'g', st: 5, cl: 1, stat: 'dmg=1,2;light=3,4' } }] : [] },
        map: { d: { id: 1, name: 'Test' }, size: { x: 10, y: 10 }, col: { check: () => 0 }, getGateways: () => ({ townnames: {}, getList: () => [] }) } };
    const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, set innerHTML(v) {} });
    const win = { open: windowOpen };
    const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelectorAll: () => [],
        querySelector: q => q === '.skills_learnt' ? (win.open ? { offsetWidth: 50, textContent: String(used) } : null) : q === '.skills_total' ? (win.open ? { textContent: String(total) } : null) : null };
    const timers = [];
    const store = { mbauto: { open: true, tab: 'skills', on: false, pauseMin: 0, pauseMax: 0 } };
    const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v, document: doc, innerWidth: 1400, innerHeight: 900,
        setInterval: f => timers.push(f), performance: { now: () => now } };
    new Function(...Object.keys(sb), src.replace('function log(t) {', 'function log(t) { W.__logs = (W.__logs || []).concat(t);'))(...Object.values(sb));
    return { W, sk: W.__sk, sent, skills, win, run: n => { for (let i = 0; i < n; i++) { now += 250; timers.forEach(f => { try { f(); } catch (e) {} }); } }, setBattle: b => { battle = b; }, hero };
}
const check = (name, ok, extra) => { console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name + (extra ? ' | ' + extra : '')); if (!ok) process.exitCode = 1; };
const learns = s => s.filter(c => c.startsWith('skills&learn'));

// Vorschlag
let t = setup();
let xp = t.sk.skillPlan('xp'), pvp = t.sk.skillPlan('pvp');
check('verteilt höchstens die freien Punkte', xp.steps.length <= 10 && xp.free === 10, xp.steps.length + ' von ' + xp.free);
check('XP nimmt zuerst Monster-Schaden', xp.steps[0].id === 2, xp.steps[0].name);
check('PvP nimmt zuerst Spieler-Schutz', pvp.steps[0].id === 3, pvp.steps[0].name);
check('nie falsches Element, volle oder gesperrte Fähigkeit', !xp.steps.concat(pvp.steps).some(s => [1, 4, 6, 7].includes(s.id)));
check('Stufen steigen lückenlos', xp.steps.filter(s => s.id === 2).map(s => s.to).join() === '9,10');
check('der Vorschlag allein schickt nichts', t.sent.length === 0);
t = setup({ lvl: 240, used: 24, total: 216 });
check('Reihe öffnet erst mit genug gesetzten Punkten, dann nutzbar', (() => { const p = t.sk.skillPlan('xp'); const first7 = p.steps.findIndex(s => s.id === 7); return first7 >= 1; })());

// Anwenden
t = setup({ confirm: false }); t.sk.skStart(xp.steps); t.run(20);
check('Rückfrage „nein“: nichts gesendet', t.W.asked === 1 && t.sent.length === 0);
t = setup({ windowOpen: false }); t.sk.skStart(xp.steps); t.run(20);
check('Fenster zu: keine Rückfrage, nichts gesendet', !t.W.asked && t.sent.length === 0);
t = setup({ gold: 100 }); t.sk.skStart(xp.steps); t.run(20);
check('zu wenig Gold: nichts gesendet', t.sent.length === 0);
t = setup(); let pl = t.sk.skillPlan('xp'); t.sk.skStart(pl.steps.slice(0, 1)); t.run(40);
check('„nur den nächsten“: genau ein Befehl', learns(t.sent).length === 1 && t.sent[0] === 'skills&learn=2&lvl=9', t.sent.join());
t = setup(); pl = t.sk.skillPlan('xp'); t.sk.skStart(pl.steps); t.run(200);
check('alle Punkte einzeln, in Reihenfolge', learns(t.sent).length === pl.steps.length && t.sent[0] === 'skills&learn=2&lvl=9' && t.sent[1] === 'skills&learn=2&lvl=10' && !t.sk.run, learns(t.sent).length + ' Befehle');
t = setup({ refuse: id => id === 2 }); pl = t.sk.skillPlan('xp'); t.sk.skStart(pl.steps); t.run(120);
check('Spiel lehnt ab: hält an, sendet nicht weiter', learns(t.sent).length === 1 && !t.sk.run, (t.W.__logs || []).slice(-1)[0]);
t = setup(); pl = t.sk.skillPlan('xp'); t.setBattle(true); t.sk.skStart(pl.steps); t.run(40);
check('im Kampf: wartet', learns(t.sent).length === 0 && !!t.sk.run);
t.setBattle(false); t.run(10);
check('nach dem Kampf: geht weiter', learns(t.sent).length >= 1);
t = setup(); pl = t.sk.skillPlan('xp'); t.sk.skStart(pl.steps); t.skills.skill_2.cLvl = 9; t.run(20);
check('Stufe anders als geplant: hält an', learns(t.sent).length === 0 && !t.sk.run, (t.W.__logs || []).slice(-1)[0]);
t = setup(); pl = t.sk.skillPlan('xp'); t.sk.skStart(pl.steps); t.run(3); t.win.open = false; t.run(30);
check('Fenster währenddessen zu: hält an', !t.sk.run && learns(t.sent).length < pl.steps.length, learns(t.sent).length + ' von ' + pl.steps.length);
t = setup(); pl = t.sk.skillPlan('xp'); t.sk.skStart(pl.steps); t.run(3); t.sk.skStop('angehalten'); const n0 = t.sent.length; t.run(30);
check('Anhalten: kein weiterer Befehl', t.sent.length === n0);
