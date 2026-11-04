// Mistrzostwo walk: Reihenfolge vorschlagen, nur nach Rückfrage senden.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'margobot_auto.user.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'W.__sk = { skillChain, skChainSend }; })();');
const st = (s) => Array.from({ length: 10 }, () => s);
const mk = (id, name, c, type, reqw, s) => ({ id, name, grp: 9, xy: id, cLvl: c, mLvl: 10, lvl: c + '/10', type, desc: name, regs: 'reqp=p;' + (reqw ? 'reqw=' + reqw + ';' : '') + 'lvl=25', allStats: st(s) });
function setup({ open = true, confirm = true, battle = false, slots } = {}) {
    const skills = {
        skill_1: mk(1, 'Schlag', 5, 'active', '', 'perdmg=100'),                       // ohne Abklingzeit, stark
        skill_2: mk(2, 'Großer Hieb', 5, 'active', '', 'perdmg=80;cooldown=6'),
        skill_3: mk(3, 'Kleiner Hieb', 5, 'active', '', 'perdmg=20;cooldown=2'),
        skill_4: mk(4, 'Feuerhieb', 5, 'active', 'fire', 'perdmg=500;cooldown=1'),     // falsches Element
        skill_5: mk(5, 'Ungelernt', 0, 'active', '', 'perdmg=500;cooldown=1'),
        skill_6: mk(6, 'Passiv', 5, 'passive', '', 'perdmg=500'),
        skill_7: mk(7, 'Stoß', 5, 'active', '', 'perdmg=10')
    };
    const sent = [], W = { confirm: () => { W.asked = (W.asked || 0) + 1; return confirm; }, prompt: () => null, _g: c => sent.push(c) };
    W.Engine = { hero: { d: { x: 5, y: 5, lvl: 60, exp: 1, gold: 1, nick: 'T' } }, battle: { show: battle }, npcs: { getDrawableList: () => [] }, deadController: {},
        skills: { getSkills: () => skills, getGroupedSkills: () => ({ 1: { requiredLvl: '25' } }) },
        items: { fetchLocationItems: l => l === 'g' ? [{ d: { id: 9, name: 'Kość', loc: 'g', st: 5, cl: 1, stat: 'dmg=1,2;light=3,4' } }] : [] },
        map: { d: { id: 1, name: 'Test' }, size: { x: 10, y: 10 }, col: { check: () => 0 }, getGateways: () => ({ townnames: {}, getList: () => [] }) } };
    const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, set innerHTML(v) {} });
    const store = { mbauto: { open: true, tab: 'skills', on: false, pauseMin: 0, pauseMax: 0, skSlots: slots } };
    const doc = { createElement: el, head: el(), body: el(), addEventListener() {}, querySelectorAll: () => [],
        querySelector: q => q === '.skills_learnt' && open ? { offsetWidth: 50, textContent: '25' } : q === '.skills_total' && open ? { textContent: '36' } : null };
    const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] || d, GM_setValue: (k, v) => store[k] = v, document: doc, innerWidth: 1400, innerHeight: 900, setInterval() {}, performance: { now: () => 0 } };
    new Function(...Object.keys(sb), src)(...Object.values(sb));
    return { W, sk: W.__sk, sent };
}
const check = (name, ok, extra) => { console.log((ok ? 'OK    ' : 'FEHLER') + ' ' + name + (extra ? ' | ' + extra : '')); if (!ok) process.exitCode = 1; };

let t = setup(), ids = t.sk.skillChain('xp').map(x => x.id);
check('Abklingzeit zuerst, stärkste vorn, ohne Abklingzeit danach', ids.join() === '2,3,1,7', ids.join());
check('der Vorschlag allein sendet nichts', t.sent.length === 0);
check('höchstens die freien Plätze', setup({ slots: 2 }).sk.skillChain('xp').length === 2);
t = setup(); t.sk.skChainSend('xp');
check('sendet die Kette genau einmal', t.sent.length === 1 && t.sent[0] === 'skills&battleaction=set&battleskills=2,3,1,7&rpt=1', t.sent[0]);
t = setup({ confirm: false }); t.sk.skChainSend('xp');
check('Rückfrage „nein“: nichts gesendet', t.W.asked === 1 && !t.sent.length);
t = setup({ open: false }); t.sk.skChainSend('xp');
check('Fenster zu: keine Rückfrage, nichts gesendet', !t.W.asked && !t.sent.length);
t = setup({ battle: true }); t.sk.skChainSend('xp');
check('im Kampf: nichts gesendet', !t.W.asked && !t.sent.length);
