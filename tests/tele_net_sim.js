// Ab 7.44: Stadt-Teleporter (Zakonnik Planu Astralnego) bieten überall dieselben Ziele → einmal lernen, in allen Städten nutzen.
// Sonderfälle: Tuzmer (nur Koncentrator), Mythar (gleicher Name, andere Ziele), Event-Ziele, fehlendes Zezwolenie, Stadt ohne NPC.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'margobot_auto.user.js'), 'utf8')
    .replace('function log(t) {', 'function log(t) { if (process.env.LOG) console.log("   log:", t); logs.push(t);')
    .replace(/\}\)\(\);\s*$/, 'W.test = { cfg, worldPath, teleNet }; })();');
let fail = 0;
const check = (name, ok, info) => { console.log((ok ? 'OK     ' : 'FEHLER ') + name + (info ? ' | ' + info : '')); if (!ok) fail = 1; };

const ZPA = 'Zakonnik Planu Astralnego';
const NAMES = { 1: 'Werbin', 2: 'Ithan', 3: 'Torneg', 10: 'Tuzmer', 11: 'Mythar', 12: 'Eder', 13: 'Góry Zrębowe', 20: 'Polana', 30: 'Wioska Halloween',
    40: 'Trakt A', 41: 'Trakt B', 42: 'Trakt C', 43: 'Trakt D', 44: 'Trakt E', 45: 'Trakt F', 50: 'Pustkowie' };
// Ithan – lange Straße – Eder – Polana; Werbin/Mythar neben Ithan, Torneg neben Werbin, Tuzmer an der Straße, Pustkowie hinter Torneg
const E_ = [[2, 40], [40, 41], [41, 42], [42, 43], [43, 44], [44, 45], [45, 12], [12, 20], [1, 2], [3, 1], [10, 40], [11, 2], [13, 45], [30, 20], [50, 3]];
const G = {}; for (const id in NAMES) G[id] = [];
for (const [a, b] of E_) { G[a].push([b, 19, 10 + G[a].length]); G[b].push([a, 0, 10 + G[b].length]); }
const world = {}; for (const id in G) world[id] = [20, 20, NAMES[id], G[id], id === '20' ? [['Wilk', 50, 6]] : []];

function setup(opt = {}) {
    let cur = opt.start || 2, now = 0, tgt = null, dlg = null, nextId = 900;
    const logs = [], visits = [], listeners = [];
    const S = { permits: new Set([1, 2, 3, 12, 10]), event: false, npcIn: new Set([1, 2, 3, 10, 11]) };   // Eder: kein Zakonnik
    const go = (m, from) => { cur = m; Engine.map.d = { id: m, name: NAMES[m] }; const b = G[m].find(g => g[0] === from); hero.d.x = b ? b[1] : 10; hero.d.y = b ? b[2] : 10; tgt = null; dlg = null; };
    const npcAt = { 1: [12, 8], 2: [5, 5], 3: [8, 14], 10: [15, 15], 11: [6, 6] };
    const npcs = () => S.npcIn.has(cur) ? [{ d: { id: 500 + cur, nick: ZPA, type: 0, x: npcAt[cur][0], y: npcAt[cur][1] } }] : [];
    const tp = to => () => { visits.push(NAMES[cur] + '⇒' + NAMES[to]); go(to, -1); };
    const menuMain = () => ({ header: ZPA, answers: [{ text: '1. Chcę się teleportować', act: () => dlg = menuTele() }, { text: '2. Do widzenia', act: () => dlg = null }] });
    function menuTele() {
        let a;
        if (cur === 10) a = [{ text: 'Astralny koncentrator (1000 zł)', act: () => { dlg = null; } }];
        else if (cur === 11) a = [{ text: 'Ithan', act: tp(2) }, { text: 'Góry Zrębowe', act: tp(13) }];
        else {
            a = [...S.permits].filter(d => d !== cur).map(d => ({ text: NAMES[d] + ' (100 zł)', act: tp(d) }));
            if (S.event) a.push({ text: 'Event: Wioska Halloween', act: tp(30) });
        }
        return { header: ZPA, answers: a.concat([{ text: 'Wróć', act: () => dlg = menuMain() }]) };
    }
    const _g = c => { const m = c.match(/talk&id=(\d+)/); const n = npcs()[0]; if (m && n && Math.abs(hero.d.x - n.d.x) <= 1 && Math.abs(hero.d.y - n.d.y) <= 1) dlg = menuMain(); };
    const liOf = a => ({ textContent: a.text, querySelector: () => null, click: () => a.act(), closest: s => s === '.dialogue-window-answer' ? liOf(a) : null });
    const dialogEl = () => ({ querySelector: s => s === '.h_content' ? { textContent: dlg.header } : null, querySelectorAll: s => s === '.dialogue-window-answer' ? dlg.answers.map(liOf) : [] });
    const hero = { d: { x: 10, y: 10, lvl: 80, exp: 1 }, autoGoTo(p) { tgt = p; }, heroAtackRequest() {} };
    const Engine = { hero, battle: { show: false }, npcs: { getDrawableList: npcs }, deadController: {},
        map: { d: { id: cur, name: NAMES[cur] }, size: { x: 20, y: 20 }, col: { check: () => 0 },
            getGateways: () => ({ townnames: Object.fromEntries(G[cur].map(g => [g[0], NAMES[g[0]]])), getList: () => G[cur].map(g => ({ d: { id: g[0], x: g[1], y: g[2] } })) }) } };
    const el = () => ({ style: {}, dataset: {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) {}, closest: () => null });
    const doc = { createElement: el, head: el(), body: el(), addEventListener: (t, f) => listeners.push([t, f]),
        querySelector: s => s === '.dialogue-window.is-open' && dlg ? dialogEl() : null, querySelectorAll: () => [] };
    const store = { mbworld: world, mbauto: Object.assign({ humanize: 0, on: false, pauseMin: 0, pauseMax: 0 }, opt.cfg || {}) };
    const timers = [], W = { Engine, _g, confirm: () => true, prompt: () => null };
    const sb = { unsafeWindow: W, GM_getValue: (k, d) => store[k] ?? d, GM_setValue: (k, v) => store[k] = v, GM_notification() {},
        document: doc, innerWidth: 1400, innerHeight: 900, setInterval: f => timers.push(f), performance: { now: () => now }, logs };
    new Function(...Object.keys(sb), src)(...Object.values(sb));
    const T = n => { for (let i = 0; i < n; i++) { now += 200;
        if (tgt) { hero.d.x += Math.sign(tgt.x - hero.d.x); hero.d.y += Math.sign(tgt.y - hero.d.y);
            const g = G[cur].find(g => g[1] === hero.d.x && g[2] === hero.d.y); if (g && hero.d.x === tgt.x && hero.d.y === tgt.y) { visits.push(NAMES[cur] + '→' + NAMES[g[0]]); go(g[0], cur); } }
        timers[0](); } };
    const userClick = text => { const a = dlg.answers.find(x => x.text.includes(text)); const li = liOf(a); for (const [t, f] of listeners) if (t === 'click') f({ target: li, isTrusted: true }); a.act(); };
    // Spieler öffnet beim Zakonnik auf Karte m die Zielliste (reist nicht)
    const learnAt = m => { go(m); const n = npcs()[0]; hero.d.x = n.d.x; hero.d.y = n.d.y + 1; T(2); _g('talk&id=' + n.d.id); T(6); userClick('Chcę'); T(8); userClick('Wróć'); T(2); userClick('Do widzenia'); T(15); };
    const travel = (to, n = 600) => { visits.length = 0; W.test.cfg.travel = { to: [to], label: NAMES[to], then: 'stop' }; T(n); };
    go(cur); T(2);
    return { S, T, go, logs, visits, learnAt, travel, t: W.test, store, get cur() { return cur; } };
}

{   // 1) Werbin gelernt → in Ithan (nie angesprochen) denselben Teleporter nutzen
    const s = setup();
    s.learnAt(1);
    const net = s.t.teleNet();
    check('Netz aus einem Teleporter: Ziele Ithan, Torneg, Eder, Tuzmer', net.kinds.length === 1 && ['2', '3', '12', '10'].every(d => d in net.kinds[0].to), JSON.stringify(Object.keys(net.kinds[0] ? net.kinds[0].to : {})));
    check('… nutzbar auch in Ithan, Torneg (Ziele sind Städte), nicht in Tuzmer', net.useAt.has(2) && net.useAt.has(3) && !net.useAt.has(10));
    s.go(2); s.T(2);
    s.travel(20);
    check('Ithan → Polana: Zakonnik in Ithan → Eder, dann zu Fuß', s.visits[0] === 'Ithan⇒Eder' && s.cur === 20, s.visits.join(' '));
    check('… Lage des Zakonnik in Ithan gemerkt', s.t.cfg.teleAt && s.t.cfg.teleAt[2] && s.t.cfg.teleAt[2].x === 5);
}
{   // 2) Tuzmer: der Zakonnik dort führt nur zum Koncentrator – kein Netz, zu Fuß
    const s = setup({ start: 10 });
    s.learnAt(1); s.go(10); s.T(2);
    const p = s.t.worldPath([20]);
    check('Tuzmer: Weg ohne Netz-Teleport ab Tuzmer', p && !p.path[0].tele, p && p.path.map(x => x.id + (x.tele ? '⇒' : '')).join(' '));
}
{   // 3) Mythar: gleicher Name, aber nur Ithan + Góry Zrębowe → eigene Liste, Góry nicht im Netz
    const s = setup();
    s.learnAt(1); s.learnAt(11);
    const net = s.t.teleNet(), k = net.kinds[0];
    check('Mythar ist Sonderfall mit eigener Liste', k && k.own.includes(11) && !('13' in k.to), `own=${k && k.own} ziele=${k && Object.keys(k.to)}`);
    s.go(2); s.T(2);
    const p = s.t.worldPath([13]);
    check('… von Ithan nach Góry Zrębowe kein Netz-Sprung direkt dorthin', p && !p.path.some(x => x.tele && x.tele.net && x.tele.to === 13), p && p.path.map(x => x.id + (x.tele ? '⇒' : '')).join(' '));
}
{   // 4) Event-Ziel: nur beim gelernten Teleporter, nicht im Netz; nach dem Event vergessen
    const s = setup();
    s.S.event = true; s.learnAt(1);
    const k = s.t.teleNet().kinds[0];
    check('Event-Ziel nicht im Netz', k && !('30' in k.to) && s.t.cfg.tele[1][ZPA].to[30]);
    s.S.event = false; s.learnAt(1);
    check('… nach dem Event aus dem gelernten Werbin-Teleporter entfernt', !s.t.cfg.tele[1][ZPA].to[30] && s.logs.some(l => /nicht mehr im Angebot/.test(l)));
}
{   // 5) Held hat das Zezwolenie nicht (mehr): Ziel fehlt im Menü → zu Fuß, 12 h nicht mehr übers Netz
    const s = setup();
    s.learnAt(1); s.S.permits.delete(12);
    s.go(2); s.T(2);
    s.travel(20, 900);
    check('Fehlendes Ziel: erst versucht, dann zu Fuß angekommen', s.cur === 20 && !s.visits.includes('Ithan⇒Eder') && s.t.cfg.teleMiss && s.t.cfg.teleMiss[12], s.visits.join(' '));
    const p = s.t.worldPath([12]);
    check('… danach kein Netz-Sprung nach Eder geplant', p && !p.path.some(x => x.tele && x.tele.to === 12));
}
{   // 6) Stadt ohne Zakonnik (Eder): nicht gefunden → dort nicht mehr übers Netz
    const s = setup({ start: 12 });
    s.learnAt(1); s.go(12); s.T(2);
    s.travel(50, 1200);
    check('Eder ohne Zakonnik: gemerkt, trotzdem angekommen', s.t.cfg.teleNo && s.t.cfg.teleNo[12] && s.cur === 50, s.visits.join(' '));
    check('… Eder danach keine Netz-Stadt mehr', !s.t.teleNet().useAt.has(12));
}
process.exit(fail);
