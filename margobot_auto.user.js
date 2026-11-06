// ==UserScript==
// @name         MargoBot Auto
// @description  Jagt Mobs direkt im Spiel (ohne Maus): Route über alle Mobs bis zum Ausgang, Panel im Spielfenster
// @version      7.12
// @updateURL    https://raw.githubusercontent.com/arek09082001/margobot-userscript/main/margobot_auto.user.js
// @downloadURL  https://raw.githubusercontent.com/arek09082001/margobot-userscript/main/margobot_auto.user.js
// @match        https://*.margonem.com/*
// @match        https://*.margonem.pl/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

/*
 * Ablauf (alle ~200 ms, mit zufälliger Pause zwischen den Aktionen):
 *   Kampf läuft      → abwarten; ist er vorbei, Kampffenster schließen
 *   Ziel angrenzend  → angreifen (mit Auto-Kampf)
 *   Ziel weiter weg  → hinlaufen (Spiel-Wegsuche)
 *   keine Ziele      → zur nächsten Karte der Route (oder zur pro Karte gewählten Tür) oder warten
 * Routen: einmal selbst ablaufen und aufnehmen (nur die Kartenfolge – die Türen kennt das Spiel).
 * Hin und zurück (A→B→C→B→A) und Runden gehen, weil die Tür nach der NÄCHSTEN Karte der Route gewählt
 * wird, nicht pro Karte fest. Jede Route merkt sich ihre Mob-Auswahl und den Level-Bereich (XP-Ort).
 * Reihenfolge: kürzester Gesamtweg vom Helden über ALLE Ziele bis zur Ausgangstür (echte Laufwege auf
 * der Kollisionskarte; bis 11 Mobs exakt, darüber Nächster-Nachbar + 2-opt + Or-opt aus mehreren Starts).
 * Ein angelaufenes Ziel wird beibehalten, solange seine Route höchstens 2 Felder schlechter ist (kein Hin und Her).
 * Wahlweise „immer nächster Mob" (nächster, dessen Route höchstens 15 % schlechter ist).
 */
(function () {
    'use strict';
    const W = unsafeWindow;

    // ── Einstellungen ───────────────────────────────────────────
    const DEF = { on: false, picked: {}, lvlOn: false, lvlMin: 1, lvlMax: 300, pauseMin: 300, pauseMax: 900,
                  exits: {}, closeBattle: true, x: null, y: null, open: true,
                  routes: {}, route: '', routePos: 0, rec: null, suggestAuto: true, expoAll: false,
                  onDeath: 'stop', deaths: [], graph: {}, back: null, optimal: true,
                  names: {}, travel: null, blocked: [], tab: 'xp', logOpen: false, tele: {},
                  rules: [], chain: null, autoCaptcha: false, autoCaptchaConfirm: false, captchaWarn: true,
                  pk: { mode: 'off', maxUp: 5, near: 6, sec: 5, never: '' } };
    const cfg = Object.assign({}, DEF, GM_getValue('mbauto', {}));
    /* E2-Jagd: list = gemerkte Bosse (Schlüssel „Name|Karte“), sel = aktiver. away: 'stay' = am Spawnpunkt
       warten, 'leave' = bei langer Wartezeit das Spiel verlassen und rechtzeitig erinnern. back = Adresse der
       Spielseite ([server].margonem.pl), autoBack = zur Erinnerungszeit diese Seite wieder öffnen. */
    const E2DEF = { on: false, sel: '', list: {}, away: 'stay', leaveMin: 10, remindMin: 1, remindMax: 1, wakeAt: 0, offline: false, autoBack: true, back: '', returned: false, leftAt: 0, noLeaveUntil: 0, leaveUrl: '', speed: 1, reactMin: 2, reactMax: 6 };
    // Routen bereinigen: leere Einträge (Kartenwechsel beim Aufnehmen) raus, doppelte direkt hintereinander zusammenfassen
    const cleanMaps = m => (m || []).filter(x => x && x !== 'null' && x !== 'undefined')
        .filter((x, i, a) => !i || String(x).trim().toLowerCase() !== String(a[i - 1]).trim().toLowerCase());
    function normCfg() {                            // Unterobjekte mit Standardwerten auffüllen (nach Laden/Heldwechsel)
        cfg.pk = Object.assign({}, DEF.pk, cfg.pk || {});
        cfg.e2 = Object.assign({}, E2DEF, cfg.e2 || {});
        // Rückkehr früher Standard 2–4 min vor dem Respawn → jetzt 1 min (Wunsch: nicht so lange vorher warten).
        // Nur den alten Standard umstellen, selbst gewählte Werte bleiben.
        if (cfg.e2.remindV !== 2) { if (cfg.e2.remindMin === 2 && cfg.e2.remindMax === 4) { cfg.e2.remindMin = 1; cfg.e2.remindMax = 1; } cfg.e2.remindV = 2; }
        for (const k in cfg.routes || {}) cfg.routes[k].maps = cleanMaps(cfg.routes[k].maps);
    }
    /* Einstellungen pro Held: Wer mehrere Helden spielt, will je Held eigene Routen, Level, E2 usw.
       Gemeinsam bleibt, was zur Welt oder zum Gerät gehört (gelerntes Kartenwissen, Panel-Lage, Handel).
       Gespeichert unter „mbhero:<Welt>#<Held-ID>“; „mbauto“ behält wie bisher alles (Stand des zuletzt aktiven
       Helden) – daraus startet ein neuer Held. Auf Seiten ohne Spiel (E2 offline) gilt der zuletzt aktive Held. */
    const GLOBAL = new Set(['graph', 'names', 'tele', 'npcs', 'dlg', 'shops', 'blocked', 'blockedAt', 'x', 'y', 'open', 'tab',
                            'logOpen', 'trade', 'captchaClick']);
    const heroPart = () => { const o = {}; for (const k in cfg) if (!GLOBAL.has(k)) o[k] = cfg[k]; return o; };
    function applyHero(data) {
        data = JSON.parse(JSON.stringify(data || {}));   // Kopie: nie dasselbe Objekt wie cfg verändern
        for (const k of Object.keys(cfg)) if (!GLOBAL.has(k)) delete cfg[k];
        for (const k in DEF) if (!GLOBAL.has(k) && !(k in data)) cfg[k] = JSON.parse(JSON.stringify(DEF[k]));
        Object.assign(cfg, data);
        normCfg();
    }
    let heroKey = '', heroNick = '';
    try {
        const last = GM_getValue('mbauto_last', '');
        const d = last && GM_getValue('mbhero:' + last, null);
        if (d) { heroKey = last; heroNick = d.heroNick || ''; applyHero(d); }
    } catch (e) { }
    normCfg();
    /* Seitenfolge beim Verlassen (Fehlersuche): Jede Seite, auf der das Skript startet, solange der Bot offline sein
       will, wird gemerkt – so sieht man, ob die Startseite überhaupt geladen wurde oder wer zurück ins Spiel geführt hat. */
    if (cfg.e2.offline) {
        try {
            const h = s => String(s || '').replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 60);
            cfg.e2.trace = (cfg.e2.trace || []).concat([h(location.href) + (document.referrer ? ' ← ' + h(document.referrer) : '')]).slice(-6);
            GM_setValue('mbauto', cfg);
            if (heroKey) GM_setValue('mbhero:' + heroKey, heroPart());
        } catch (e) { }
    }
    const running = () => !!(cfg.on || cfg.travel || cfg.chain || cfg.e2.on);
    const save = () => { GM_setValue('mbauto', cfg); if (heroKey) GM_setValue('mbhero:' + heroKey, heroPart()); };
    const rnd = (a, b) => a + Math.random() * Math.max(0, b - a);
    const pause = () => rnd(cfg.pauseMin, cfg.pauseMax);

    // ── Spieldaten ──────────────────────────────────────────────
    const E = () => W.Engine;
    function ok() { const e = E(); return e && e.hero && e.hero.d && e.map && e.map.d && e.map.size && e.npcs; }
    function bindHero() {
        /* Im Spiel: zum eingeloggten Helden die passenden Einstellungen laden (anderer Held als zuletzt → umschalten). */
        const h = E().hero.d;
        if (h.id == null) return;
        let host = '';
        try { host = location.hostname || ''; } catch (e) { }
        const key = host + '#' + h.id;
        if (key === heroKey) return;
        const known = GM_getValue('mbheroes', []), d = GM_getValue('mbhero:' + key, null);
        if (d) applyHero(d);
        else if (known.length) {
            // neuer Held: aktuelle Einstellungen als Vorlage, aber nichts „Laufendes“ übernehmen
            Object.assign(cfg, { on: false, travel: null, chain: null, back: null, rec: null, routePos: 0, lastHome: null, sess: null, deaths: [] });
            cfg.e2 = Object.assign({}, cfg.e2, { on: false, offline: false, wakeAt: 0, returned: false, noLeaveUntil: 0, trace: [] });
        }                                           // allererster Held: alles so übernehmen, wie es war
        heroKey = key; heroNick = h.nick || ''; cfg.heroNick = heroNick;
        if (!known.includes(key)) GM_setValue('mbheroes', known.concat([key]));
        GM_setValue('mbauto_last', key);
        save();
        lastStatic = '';
        heroSwitched = d ? 'geladen' : known.length ? 'neu (Vorlage: letzte Einstellungen)' : 'übernommen';
    }
    let heroSwitched = '';
    function heroXY() { const h = E().hero.d; return [h.x, h.y]; }
    function mobKey(icon) {                       // hum/ghul1-a.gif → ghul (wie MargoBot)
        let s = (icon || '').split('/').pop().replace(/\.\w+$/, '');
        s = s.replace(/(\d)[-_]?[a-z]$/i, '$1').replace(/([a-z])[-_][ab]$/i, '$1').replace(/([a-z])1$/i, '$1');
        return s;
    }
    function mobs() {
        const out = [];
        for (const n of E().npcs.getDrawableList()) {
            const d = n.d;
            if (!d || (d.type !== 2 && d.type !== 3)) continue;
            out.push({ id: d.id, nick: d.nick, lvl: d.lvl || 0, x: d.x, y: d.y, key: mobKey(d.icon) });
        }
        return out;
    }
    function wanted(m) {
        if (cfg.lvlOn && m.lvl >= cfg.lvlMin && m.lvl <= cfg.lvlMax) return true;
        return !!cfg.picked[m.key];
    }
    function gateways() {
        try {
            const g = E().map.getGateways(), L = g.getList(), names = g.townnames || {};
            return (Array.isArray(L) ? L : Object.values(L)).map(x => { const d = x.d || x; return { id: d.id, x: d.x, y: d.y, name: names[d.id] || ('Tür ' + d.id) }; });
        } catch (e) { return []; }
    }
    function mapName() { return E().map.d.name; }
    /* Andere Spieler (noch nicht im Spiel geprüft): Engine.others wie Engine.npcs, Einträge mit .d (id, nick, lvl, x, y). */
    function players() {
        const o = E().others, me = E().hero.d.id;
        if (!o) return [];
        let L = [];
        try { L = typeof o.getDrawableList === 'function' ? o.getDrawableList() : typeof o.check === 'function' ? Object.values(o.check() || {}) : []; } catch (e) { }
        return (L || []).map(p => p && (p.d || p)).filter(d => d && d.nick && d.id != null && d.id !== me && d.x != null)
            .map(d => ({ id: d.id, nick: d.nick, lvl: +d.lvl || 0, x: +d.x, y: +d.y }));
    }
    // PvP-Stufe der Karte (noch nicht im Spiel geprüft): 2 = rot (freies PvP). Wird im Panel angezeigt, damit man es prüfen kann.
    const mapPvp = () => { const v = E().map.d.pvp; return v == null ? null : +v; };
    const isRed = () => mapPvp() === 2;
    function inBattle() { const b = E().battle; return !!(b && b.show); }
    function isDead() {
        /* Mehrere Signale, weil das Spiel den Tod an verschiedenen Stellen führt:
           deadController (Engine), Felder am Helden, Lebenspunkte 0, Tod-Fenster im HTML. */
        const e = E();
        try {
            const dc = e.deadController;
            if (dc) {
                for (const k of ['isDead', 'getDead', 'checkIsDead', 'getIsDead', 'isHeroDead'])
                    if (typeof dc[k] === 'function' && dc[k]() === true) return true;
                if (dc.dead === true || dc.isDeadNow === true) return true;
            }
        } catch (er) {}
        const d = e.hero.d || {};
        if (d.dead === 1 || d.dead === true || (d.dazed && d.dazed > 0)) return true;
        const ws = d.warrior_stats || {};
        if (typeof ws.hp === 'number' && ws.hp <= 0 && ws.maxhp > 0) return true;
        const el = document.querySelector('#dazed, .dazed, .dead-window, .death-window, [class*="dead-info"]');
        return !!(el && el.offsetWidth);
    }
    function learnGraph() {
        /* Jede Karte kennt ihre Türen samt Zielkarte → daraus wächst eine Weltkarte für den Rückweg. */
        const mn = mapName(), names = gateways().map(g => g.name).filter(Boolean);
        const cur = cfg.graph[mn] || [];
        if (names.some(n => !cur.includes(n))) { cfg.graph[mn] = Array.from(new Set(cur.concat(names))); save(); }
    }
    function mapPath(from, targets) {
        /* Kürzeste Kartenfolge from → eine der targets (Breitensuche über gelernte Türen). */
        const goal = new Set(targets.map(t => t.trim().toLowerCase()));
        const prev = { [from]: null }, q = [from];
        while (q.length) {
            const c = q.shift();
            if (goal.has(c.trim().toLowerCase())) {
                const path = [c];
                while (prev[path[0]] !== null) path.unshift(prev[path[0]]);
                return path;
            }
            for (const n of cfg.graph[c] || []) if (!(n in prev)) { prev[n] = c; q.push(n); }
        }
        return null;
    }

    // ── Weltkarte (margobot_world.json aus worldgraph.py) ───────
    /* {id: [breite, höhe, name_pl, [[zielkarte, x, y], …], [[mob, level, anzahl], …]]}. Gleiche IDs wie im
       Spiel; englische Namen lernt das Skript unterwegs (Kartenname + Türnamen), sonst polnischer Name. */
    let world = GM_getValue('mbworld', null);
    const worldN = () => world ? Object.keys(world).length : 0;
    const mapId = () => E().map.d.id;
    const wname = id => cfg.names[id] || (world && world[id] ? world[id][2] : 'Karte ' + id);
    function learnNames() {
        const e = E();
        let ch = false;
        const put = (id, n) => { if (id && n && !/^Tür \d+$/.test(n) && cfg.names[id] !== n) { cfg.names[id] = n; ch = true; } };
        put(e.map.d.id, e.map.d.name);
        for (const g of gateways()) put(g.id, g.name);
        if (ch) save();
    }
    const fold = s => (s || '').toLowerCase().normalize('NFKD').replace(/ł/g, 'l').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
    function findMaps(text) {
        /* Karten-IDs zu Name (englisch gelernt oder polnisch) oder ID: exakt vor Wortanfang vor Teilstring. */
        const q = fold(text);
        if (!q) return [];
        if (/^\d+$/.test(q) && world && world[q]) return [+q];
        const ex = [], st = [], pa = [];
        const ids = new Set(Object.keys(world || {}).concat(Object.keys(cfg.names)));
        for (const id of ids) {
            for (const n of [cfg.names[id], world && world[id] && world[id][2]]) {
                const f = fold(n);
                if (!f) continue;
                if (f === q) { ex.push(+id); break; }
                if (f.startsWith(q)) { st.push(+id); break; }
                if (f.includes(q)) { pa.push(+id); break; }
            }
        }
        return Array.from(new Set(ex.concat(st, pa)));
    }
    function entryXY(id, from) {                   // man kommt an der Tür heraus, die zurück führt
        const m = world[id];
        if (!m) return [0, 0];
        const d = m[3].filter(g => g[0] === from);
        return d.length ? [d[d.length >> 1][1], d[d.length >> 1][2]] : [m[0] >> 1, m[1] >> 1];
    }
    const TELE_COST = 30;
    function worldSearch(start, sxy, goals) {
        /* Dijkstra über alle Karten: Laufweg in der Karte (Luftlinie ×1.3) + 8 je Kartenwechsel.
           Rückgabe: {best, prev} – prev[id] = [vorige Karte, Tür auf der vorigen Karte]. */
        const at = cfg.blockedAt || {};
        cfg.blocked = (cfg.blocked || []).filter(k => at[k] && Date.now() - at[k] < 15 * 60000);
        const blocked = new Set(cfg.blocked), goal = goals ? new Set(goals.map(Number)) : null;
        const best = { [start]: 0 }, prev = { [start]: null }, pos = { [start]: sxy };
        const heap = [[0, start]];
        const push = it => { heap.push(it); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
        const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
        while (heap.length) {
            const [c, id] = pop();
            if (c > best[id]) continue;
            if (goal && goal.has(id)) return { best, prev, end: id };
            const m = world[id];
            if (!m) continue;
            const [x0, y0] = pos[id], near = {};
            for (const [to, x, y] of m[3]) {
                if (to === id || !world[to] || blocked.has(id + '>' + to)) continue;
                const d = Math.abs(x - x0) + Math.abs(y - y0);
                if (!near[to] || d < near[to][0]) near[to] = [d, x, y];
            }
            for (const to in near) {
                const [d, x, y] = near[to], nc = c + d * 1.3 + 8, t = +to;
                if (best[t] === undefined || nc < best[t]) {
                    best[t] = nc; prev[t] = [id, x, y]; pos[t] = entryXY(t, id); push([nc, t]);
                }
            }
            // Teleport-NPCs (gelernt): zum NPC laufen + Teleport ≈ 30 Schritte, egal wie weit das Ziel ist
            const tl = (cfg.tele || {})[id];
            if (tl) for (const npc in tl) {
                const tp = tl[npc], dw = Math.abs(tp.x - x0) + Math.abs(tp.y - y0);
                for (const to in tp.to) {
                    const t = +to;
                    if (!world[t] || t === id || blocked.has(id + '~' + t)) continue;
                    const nc = c + dw * 1.3 + TELE_COST;
                    if (best[t] === undefined || nc < best[t]) {
                        best[t] = nc; prev[t] = [id, tp.x, tp.y, { npc, to: t }]; pos[t] = entryXY(t, -1); push([nc, t]);
                    }
                }
            }
        }
        return { best, prev, end: null };
    }
    function worldPath(goals) {
        /* Kartenfolge von hier zu einer der goals: [{id, door:[x,y]|null}, …] oder null. */
        if (!world) return null;
        const r = worldSearch(mapId(), heroXY(), goals);
        if (r.end === null) return null;
        const out = [];
        for (let id = r.end, door = null, tele = null; id !== undefined && id !== null;) {
            out.unshift({ id, door, tele });             // door/tele: wie es von dieser Karte zur nächsten geht
            const p = r.prev[id];
            if (!p) break;
            door = [p[1], p[2]]; tele = p[3] || null; id = p[0];
        }
        return { path: out, cost: r.best[r.end] };
    }
    // BEGIN FORUM EXPOWISKA (generated by expowiska.py)
    const FORUM_EXPOWISKA = [{"id":1,"name":"Mrówki","level":20,"recommended":true,"lv":[19,21],"maps":[2491,2523,2529,2783]},{"id":2,"name":"Pumy","level":21,"recommended":false,"lv":[16,22],"maps":[1060,1108]},{"id":3,"name":"Tygrysy","level":22,"recommended":false,"lv":[22,22],"maps":[1108,1263,1264,4798]},{"id":4,"name":"Niedźwiedzie","level":23,"recommended":false,"lv":[22,24],"maps":[3,583,631]},{"id":5,"name":"Nietoperze","level":25,"recommended":false,"lv":[25,25],"maps":[143,144,145,146,147,2521]},{"id":6,"name":"Bazyliszki","level":26,"recommended":false,"lv":[26,27],"maps":[632]},{"id":7,"name":"Mulusy","level":28,"recommended":true,"lv":[25,31],"maps":[1267,1285,3361]},{"id":8,"name":"Demony","level":29,"recommended":true,"lv":[28,30],"maps":[5733,5734,5735,5736,5737,5738,5739,5740]},{"id":9,"name":"Rozbójnicy","level":32,"recommended":true,"lv":[30,35],"maps":[4,110,115,244,2524,2530,2531,2532]},{"id":10,"name":"Gobliny","level":34,"recommended":true,"lv":[34,36],"maps":[725,726,727,3149]},{"id":11,"name":"Puffy, Onyksowe Skorpiony","level":37,"recommended":false,"lv":[36,38],"maps":[1664,1665,1667,1668,1670,1688]},{"id":12,"name":"Warany","level":38,"recommended":false,"lv":[38,39],"maps":[214,222,223,226,347]},{"id":13,"name":"Ghule","level":40,"recommended":false,"lv":[40,42],"maps":[111,112,702,703,704,705,3402]},{"id":14,"name":"Odyńce","level":40,"recommended":true,"lv":[39,41],"maps":[214,361,4154,4155,4156,4157]},{"id":15,"name":"Wilcze Plemię","level":44,"recommended":true,"lv":[43,45],"maps":[154,155,156,2536,2537,2538,4546,4547]},{"id":16,"name":"Tolloki","level":45,"recommended":false,"lv":[44,45],"maps":[5293,5948]},{"id":17,"name":"Zbiry","level":46,"recommended":true,"lv":[45,47],"maps":[2308,2324,2350,2351,2352,4151]},{"id":18,"name":"Orkowie","level":47,"recommended":true,"lv":[46,48],"maps":[116,117,118,119,120,122,124,125,126,127,129,130,131,2730,2731,2732,2733]},{"id":19,"name":"Grzechotniki, Kobry","level":48,"recommended":false,"lv":[48,48],"maps":[140,141,142,150,179,188,189]},{"id":20,"name":"Harpie","level":49,"recommended":false,"lv":[49,49],"maps":[140]},{"id":21,"name":"Galarety","level":50,"recommended":false,"lv":[49,51],"maps":[176,177,4262,4550,4582]},{"id":22,"name":"Pokątniki","level":52,"recommended":false,"lv":[52,53],"maps":[6473,6474,6475]},{"id":23,"name":"Górskie/Czarne Orły","level":53,"recommended":false,"lv":[53,54],"maps":[150]},{"id":24,"name":"Koboldy","level":54,"recommended":true,"lv":[54,56],"maps":[814,815,816,2729,3869]},{"id":25,"name":"Żądłaki","level":58,"recommended":true,"lv":[58,59],"maps":[138,5394,5395,5396,5397,5398,5399]},{"id":26,"name":"Bazyliszki","level":61,"recommended":true,"lv":[60,62],"maps":[199,200,201,202,3883,3884]},{"id":27,"name":"Tygrysy","level":62,"recommended":false,"lv":[62,71],"maps":[180,1387,1730]},{"id":28,"name":"Gnolle","level":64,"recommended":false,"lv":[62,66],"maps":[276,333,341,1654,2646,3300,3436,3437,3438,3439,3440,3441,3442]},{"id":29,"name":"Tańczące Płomienie","level":65,"recommended":false,"lv":[64,67],"maps":[599,845,1761]},{"id":30,"name":"Rosomaki","level":66,"recommended":false,"lv":[65,66],"maps":[8,2520]},{"id":31,"name":"Szare Mrówki","level":67,"recommended":false,"lv":[66,67],"maps":[6540,6541,6542,6543,6544,6545,6546]},{"id":32,"name":"Olbrzymy","level":68,"recommended":false,"lv":[67,69],"maps":[6535,6536,6537,6628,6629]},{"id":33,"name":"Mieszkańcy Andarum i okolic","level":70,"recommended":false,"lv":[70,71],"maps":[180,1387,1730,4548]},{"id":34,"name":"Niedźwiedzie","level":70,"recommended":false,"lv":[67,73],"maps":[361,500,576,600,730]},{"id":35,"name":"Tolloki","level":71,"recommended":false,"lv":[71,72],"maps":[6628,6629,6630,6631,6632,6633]},{"id":36,"name":"Demilisze","level":72,"recommended":false,"lv":[72,73],"maps":[6624,6625,6626,6627]},{"id":37,"name":"Mnisi","level":74,"recommended":false,"lv":[73,75],"maps":[6608,6609,6610,6611,6612,6613,6614,6615,6616]},{"id":38,"name":"Mnisi","level":75,"recommended":false,"lv":[75,76],"maps":[6612]},{"id":39,"name":"Magazynierzy","level":77,"recommended":true,"lv":[76,78],"maps":[6613,6614,6615]},{"id":40,"name":"Erem","level":80,"recommended":true,"lv":[78,80],"maps":[6617,6618,6619,6620,6621,6622,6623]},{"id":41,"name":"Minotaury","level":81,"recommended":false,"lv":[80,83],"maps":[846,847,848,849]},{"id":42,"name":"Mykonidy","level":82,"recommended":false,"lv":[82,83],"maps":[284,285,286,287]},{"id":43,"name":"Dławiciele","level":83,"recommended":false,"lv":[83,84],"maps":[6628,6634,6635,6636]},{"id":44,"name":"Niedźwiedziołaki","level":83,"recommended":true,"lv":[81,83],"maps":[1193,1204,1733,1734,1735,1736,3530]},{"id":45,"name":"Wermonty","level":85,"recommended":false,"lv":[84,85],"maps":[6628,6629]},{"id":46,"name":"Krasnoludy","level":86,"recommended":false,"lv":[85,86],"maps":[6771,6772,6773,6774]},{"id":47,"name":"Darhouny","level":87,"recommended":false,"lv":[87,88],"maps":[6775,6776]},{"id":48,"name":"Grexy, Volmaty, Urgrapy","level":89,"recommended":true,"lv":[89,96],"maps":[1353,1354,1355,3457,3464,3465,3466,3473]},{"id":49,"name":"Orły","level":90,"recommended":false,"lv":[85,95],"maps":[530]},{"id":50,"name":"Leszy","level":91,"recommended":false,"lv":[91,92],"maps":[500,701,1137,1323,1324,1325,3890]},{"id":51,"name":"Południce, Wieczornice","level":92,"recommended":false,"lv":[92,93],"maps":[1141,1144,1145,1146,1147,1153,3758,3759,3760]},{"id":52,"name":"Gnomy","level":94,"recommended":true,"lv":[93,95],"maps":[246,339,3758,3759,6777,6778,6779,6780,6781]},{"id":53,"name":"Błotniste Gady","level":96,"recommended":false,"lv":[96,97],"maps":[246,339]},{"id":54,"name":"Ogniki","level":96,"recommended":false,"lv":[96,97],"maps":[246,339]},{"id":55,"name":"Centaury","level":98,"recommended":true,"lv":[97,99],"maps":[268,330,331,332,3765]},{"id":56,"name":"Małe gady i płazy","level":99,"recommended":false,"lv":[99,100],"maps":[332,3766]},{"id":57,"name":"Bandyci","level":100,"recommended":false,"lv":[100,101],"maps":[226,229,3766]},{"id":58,"name":"Molochy","level":103,"recommended":false,"lv":[102,104],"maps":[6934,6935,6936,6937,6938]},{"id":59,"name":"Dwugłowe olbrzymy","level":105,"recommended":false,"lv":[105,106],"maps":[253,298,299,332]},{"id":60,"name":"Gady i płazy","level":106,"recommended":false,"lv":[105,107],"maps":[330,336,337,338,6939,6940,6941,6942,6943,6944,6945,6946]},{"id":61,"name":"Błotniaki","level":107,"recommended":false,"lv":[107,108],"maps":[6941,6942,6943,6944,6945,6946]},{"id":62,"name":"Pustynne kotowate","level":108,"recommended":false,"lv":[108,109],"maps":[1141,1233,2864,2865,2866,2869,2871,2872,2887]},{"id":63,"name":"Pustynne Szkielety","level":110,"recommended":false,"lv":[108,112],"maps":[2864,2865]},{"id":64,"name":"Alghule","level":111,"recommended":false,"lv":[111,112],"maps":[1663,7063,7064,7065,7066]},{"id":65,"name":"Mumie","level":114,"recommended":false,"lv":[113,115],"maps":[2866,2867,2868,2869,2870,3328,7067,7068,7069]},{"id":66,"name":"Morskie stwory","level":117,"recommended":false,"lv":[116,118],"maps":[1739,7355,7356,7357]},{"id":67,"name":"Rogogłowi","level":121,"recommended":false,"lv":[119,122],"maps":[1740,7358,7359,7360,7361,7362,7363,7364,7365,7366,7367,7368]},{"id":68,"name":"Gliniane golemy","level":124,"recommended":false,"lv":[123,125],"maps":[1742]},{"id":69,"name":"Skorpiony, Feniksy","level":127,"recommended":false,"lv":[126,128],"maps":[1743,7055,7056,7057,7058,7059]},{"id":70,"name":"Szkielety Piratów","level":128,"recommended":true,"lv":[128,129],"maps":[1744,7070,7071]},{"id":71,"name":"Piraci","level":130,"recommended":true,"lv":[130,131],"maps":[1337,1338,1339,1340,1341,1342,1343,1344,1345,1525,1526,1527,1528,3220,3409]},{"id":72,"name":"Piaskowe potwory","level":133,"recommended":true,"lv":[132,134],"maps":[2871,2872,2873,3598,7351,7352]},{"id":73,"name":"Korredy","level":134,"recommended":true,"lv":[134,135],"maps":[6953,6954,6955,6956]},{"id":74,"name":"Impy","level":136,"recommended":false,"lv":[135,137],"maps":[7455,7456,7457,7458,7459]},{"id":75,"name":"Ognie","level":137,"recommended":false,"lv":[137,138],"maps":[7460,7461,7462,7463,7464,7465,7466]},{"id":76,"name":"Ogniste golemy","level":138,"recommended":false,"lv":[138,139],"maps":[7463,7464,7465,7466]},{"id":77,"name":"Pająki","level":139,"recommended":false,"lv":[127,140],"maps":[3467,3468,3469,3470,3471,3472]},{"id":78,"name":"Ważki","level":140,"recommended":false,"lv":[140,141],"maps":[349,350,351,352]},{"id":79,"name":"Górale","level":143,"recommended":false,"lv":[141,144],"maps":[350,351,352,7334,7335,7336,7337,7339]},{"id":80,"name":"Berserkowie","level":146,"recommended":true,"lv":[145,148],"maps":[1104,1105,1106,1107,4548,7440,7441,7442,7443,7444,7445,7446,7447,7448,7450,7451,7452,7453,7454]},{"id":81,"name":"Duchy eteryczne","level":149,"recommended":false,"lv":[148,150],"maps":[7480,7481,7482,7483,7484]},{"id":82,"name":"Mechaniczne Gobliny","level":151,"recommended":false,"lv":[150,152],"maps":[7470,7471,7472,7473,7474,7475,7476,7477,7478]},{"id":83,"name":"Dusze","level":152,"recommended":false,"lv":[152,153],"maps":[1202,1293,1294,1297]},{"id":84,"name":"Wiedźmy","level":154,"recommended":false,"lv":[153,155],"maps":[1202,1293,1294,1297,1298,1299,1300,1301,1302,1303,1304,1305,1306,1307,1308,1315,1322]},{"id":85,"name":"Czerwoni Orkowie","level":157,"recommended":true,"lv":[156,159],"maps":[355,356,357,5847,5848,5849,5850,5851,5852,5853,5854,5855]},{"id":86,"name":"Hydry i Mantikory","level":161,"recommended":false,"lv":[160,161],"maps":[261,262,263]},{"id":87,"name":"Duchy Praorków","level":163,"recommended":true,"lv":[163,165],"maps":[5857,5866,5867,5868,5869,5870,5871,5872]},{"id":88,"name":"Pradawni Orkowie","level":168,"recommended":true,"lv":[166,170],"maps":[5857,5858,5859,5860,5861,5866,5867,5868,5869,5870,5871,5872]},{"id":89,"name":"Gwardziści","level":172,"recommended":true,"lv":[171,173],"maps":[5862,5863,5864,5865]},{"id":90,"name":"Nimfy, Golemy","level":174,"recommended":true,"lv":[173,175],"maps":[7341,7342,7343,7344,7345,7346,7347,7348,7349,7350]},{"id":91,"name":"Driady","level":177,"recommended":true,"lv":[175,180],"maps":[5982,5983,5984,5985,5986,6054,6055,6056,6057]},{"id":92,"name":"Ogry","level":181,"recommended":false,"lv":[180,182],"maps":[7690,7691,7692,7693]},{"id":93,"name":"Patrycjusze","level":183,"recommended":true,"lv":[182,185],"maps":[4196,6049,6050,6051,6052,6053]},{"id":94,"name":"Zmutowane rośliny","level":186,"recommended":false,"lv":[186,187],"maps":[344,530,576,1116,4155,4185]},{"id":95,"name":"Drakowie","level":189,"recommended":false,"lv":[187,191],"maps":[2056,2063,4548,4549,5986]},{"id":96,"name":"Mroczny Las","level":192,"recommended":true,"lv":[191,193],"maps":[530,7680,7681,7682,7683,7684,7685,7686,7687,7688,7689,7832,8536,8537]},{"id":97,"name":"Myświóry","level":196,"recommended":true,"lv":[194,197],"maps":[7696,7697,7698,7699,7700,7701]},{"id":98,"name":"Hurysy","level":199,"recommended":true,"lv":[198,200],"maps":[5938,5939,5940,5945]},{"id":99,"name":"Sekta","level":200,"recommended":true,"lv":[200,205],"maps":[5938,5939,5941,5942,5943,5944,5945,5946,7694,7695]},{"id":100,"name":"Furbole","level":208,"recommended":true,"lv":[206,209],"maps":[1111,1115,1912,3733,3734,3735,3736]},{"id":101,"name":"Arachnitopia","level":212,"recommended":false,"lv":[210,215],"maps":[1115,1131,1132,1136,1138,1140,1142,1159,3736,3737,3738,4206]},{"id":102,"name":"Drowy","level":216,"recommended":true,"lv":[214,217],"maps":[7854,7855,7856,7857,7858,7859,7860]},{"id":103,"name":"Dridery","level":216,"recommended":false,"lv":[216,220],"maps":[7860,7861,7862,7863,7865]},{"id":104,"name":"Anuraki","level":224,"recommended":true,"lv":[221,224],"maps":[3327,7824,7825,7826,7828,7829]},{"id":105,"name":"Maddoki, Krokodyle","level":228,"recommended":true,"lv":[225,229],"maps":[7830,7831,7832,7833,7834,7835,7836,7837,7838,7839,7840,7841,7842,7843,7844,7845,7846,7847,7850,7851,7852,7853,8537]},{"id":106,"name":"Zainfekowana Puszcza","level":233,"recommended":false,"lv":[230,234],"maps":[8166,8167,8168,8169,8176,8177,8178,8179,8180,8181]},{"id":107,"name":"Elgary","level":236,"recommended":true,"lv":[235,238],"maps":[8171,8172,8173,8174,8175,8182,8183,8184,8185,8555,8556]},{"id":108,"name":"Dendrostwory","level":239,"recommended":false,"lv":[238,240],"maps":[3594,3595,3596,3597,3598,3610,3611,3612,3614,3615,3620,3621,3622,3623,3624,3625,3626,3627]},{"id":109,"name":"Egzotyczne istoty","level":242,"recommended":true,"lv":[242,244],"maps":[1924,5653,5654,5655,5656,5657,5658,5659,5660,5661,5662]},{"id":110,"name":"Mahoptekowie","level":249,"recommended":true,"lv":[247,249],"maps":[1901,1924,5663,5664,5665,5666,5667,5668,5669,5670,5671,5672,5673,5674,5675]},{"id":111,"name":"Mahoptecka starszyzna","level":252,"recommended":true,"lv":[250,254],"maps":[1901,1926,5677,5678,5679,5680,5681,5682,5683,5684,5687,5688,5689,5690,5691,5692,5693,5694,5695,5696,5697,5698,5699,5700,5701,5702,5703,5704,5705,5706,5707,5708,5709]},{"id":112,"name":"Wiedźmie potwory","level":258,"recommended":true,"lv":[255,259],"maps":[4049,4050,4051,4052,4270,4271,8186]},{"id":113,"name":"Potępione Wiedźmy","level":262,"recommended":false,"lv":[259,262],"maps":[4048,4053,4054,4055,4056,4057,4058,4059,4060,4061,4062,4063,4064,8188,8189,8190,8191,8192,8193]},{"id":114,"name":"Skalne Pustkowie","level":264,"recommended":false,"lv":[262,266],"maps":[8536,8537,8538,8539,8540,8541,8542]},{"id":115,"name":"Przestraszeni","level":267,"recommended":false,"lv":[266,269],"maps":[8544,8545,8546,8547,8548,8549,8550,8551,8552,8553,8554]},{"id":116,"name":"Pustynne Katakumby","level":272,"recommended":true,"lv":[270,274],"maps":[3029,3030,3031,3032,3033,3034,3035,3036,3037,3038,3039,3040,3041,3042,3043,4268,4269]},{"id":117,"name":"Smokoludzie","level":277,"recommended":false,"lv":[276,279],"maps":[3315,3316,3317,3318,3319,3320,3321,3322,3323,3325,3326,3327,3328,3329,3330,3331,3332,3333,3334,3335,3336,3337,3338,3339,3340,3341]},{"id":118,"name":"Wodniki i topielce","level":282,"recommended":false,"lv":[280,284],"maps":[8530,8531,8532,8533,8534,8535]},{"id":119,"name":"Mroczne Driady","level":286,"recommended":true,"lv":[284,287],"maps":[5987,5988,5989,6059,6060,6061,6062,6063,6064,6065]}];
    // END FORUM EXPOWISKA

    // ── XP nach offizieller Formel (pomoc.margonem.pl, „Mechanika walk“ 1.6) ──
    // XP pro Mob = Mob-Level^1.80276 × (1 − 4 % je Level, das der Held über dem Mob ist); kein Bonus für
    // stärkere Mobs; über Level 300 zählt 300. Zum Aufstieg auf Level L braucht man (L−1)^4 + 10 XP insgesamt.
    // Weltfaktor, Segen/Ausrüstung, Klan- und Gruppenbonus kommen im Spiel noch dazu – hier nicht eingerechnet.
    const XPE = 1.80276;
    function mobXp(ml, pl) {
        const m = Math.min(ml, 300), h = Math.min(pl || m, 300);
        return Math.pow(m, XPE) * Math.max(0, 1 - 0.04 * Math.max(0, h - m));
    }
    const lvlXp = L => Math.pow(L, 4) - Math.pow(L - 1, 4);          // XP von Level L auf L+1
    function rateXp(mobsList, pl) {
        /* mobsList: [[name, level, anzahl], …] → XP pro Runde, Ø je Mob, Güte (Ø je Mob ÷ bester Mob = eigenes Level). */
        let xp = 0, n = 0;
        for (const [, l, c] of mobsList) { xp += mobXp(l, pl) * c; n += c; }
        const best = Math.pow(Math.min(pl || 1, 300), XPE);
        return { xp, per: n ? xp / n : 0, eff: n && best ? xp / n / best : 0, lvlPct: pl ? xp / lvlXp(pl) * 100 : 0 };
    }
    const fmtXp = x => x >= 1e6 ? (x / 1e6).toFixed(1).replace('.', ',') + ' Mio' : x >= 1e4 ? Math.round(x / 1e3) + 'k' : fmt(x);
    function xpLine(r) {
        return `≈ ${fmtXp(r.xp)} XP pro Runde · ${r.lvlPct >= 10 ? Math.round(r.lvlPct) : r.lvlPct.toFixed(1).replace('.', ',')} % Level · ${Math.round(r.eff * 100)} % XP/Mob`;
    }

    function xpMaps(lmin, lmax, top) {
        /* Karten mit Mobs im Level-Bereich, sortiert nach XP pro Runde (offizielle Formel), Dichte und Entfernung. */
        if (!world) return [];
        const dist = worldSearch(mapId(), heroXY(), null).best, out = [], pl = heroLvl();
        for (const id in world) {
            const m = world[id], d = dist[id];
            if (d === undefined) continue;
            const hit = m[4].filter(x => x[1] >= lmin && x[1] <= lmax), n = hit.reduce((s, x) => s + x[2], 0);
            if (n < 4) continue;
            const dens = n / Math.max(1, m[0] * m[1]) * 1000, r = rateXp(hit, pl);
            out.push({ id: +id, n, d, r, score: r.xp * Math.min(1, dens / 4) / (1 + d / 400),
                       lv: [Math.min(...hit.map(x => x[1])), Math.max(...hit.map(x => x[1]))],
                       mobs: Array.from(new Set(hit.map(x => x[0]))).slice(0, 3) });
        }
        return out.sort((a, b) => b.score - a.score).slice(0, top || 8);
    }
    function suggestRoutes(lo, hi, top, area = null) {
        /* Aus der Weltkarte berechnete Rundgänge, keine geprüfte Expowisko-Liste.
           Nur beidseitige Türen verwenden: Rückwege durch Verzweigungen müssen möglich sein.
           Ein Tiefensuch-Rundgang besucht jede passende Karte, auch jenseits der früheren 10-Karten-Grenze. */
        if (!world) return [];
        const dist = (area && area.dist) || worldSearch(mapId(), heroXY(), null).best, cnt = {}, blocked = new Set(cfg.blocked || []);
        const allowed = area && new Set(area.maps);
        for (const id of allowed || Object.keys(world)) {
            if (!world[id]) continue;
            const n = world[id][4].reduce((t, x) => t + (x[1] >= lo && x[1] <= hi ? x[2] : 0), 0);
            if ((!allowed && n >= 4) || (allowed && allowed.has(+id))) cnt[id] = n;
        }
        const doors = {};
        for (const id in cnt) doors[id] = new Set(world[id][3].map(g => String(g[0])));
        const adj = {};
        for (const id in cnt) adj[id] = [...doors[id]].filter(t => t !== id && Object.prototype.hasOwnProperty.call(cnt, t) && doors[t].has(id)
            && !blocked.has(id + '>' + t) && !blocked.has(t + '>' + id))
            .sort((a, b) => cnt[b] - cnt[a] || +a - +b);
        const seen = new Set(), out = [];
        for (const id in cnt) {
            if (seen.has(id)) continue;
            const c = [], q = [id]; seen.add(id);
            while (q.length) {
                const x = q.pop(); c.push(x);
                for (const y of adj[x]) if (!seen.has(y)) { seen.add(y); q.push(y); }
            }
            const reachable = c.filter(x => dist[x] !== undefined).sort((a, b) => dist[a] - dist[b] || +a - +b);
            if ((!area && c.length < 2) || (!reachable.length && !(area && area.all))) continue;
            const root = reachable[0] || c.slice().sort((a, b) => +a - +b)[0], walk = [root], visited = new Set([root]);
            // Expliziter Stack: auch große Gruppen ohne Rekursionstiefe durchlaufen.
            const stack = [{ id: root, i: 0 }];
            while (stack.length) {
                const f = stack[stack.length - 1], y = adj[f.id][f.i++];
                if (y === undefined) {
                    stack.pop();
                    if (stack.length) walk.push(stack[stack.length - 1].id);
                } else if (!visited.has(y)) {
                    visited.add(y); walk.push(y); stack.push({ id: y, i: 0 });
                }
            }
            if (walk.length > 1) walk.pop();          // letzte Tür schließt den Kreis zur ersten Karte
            // XP nur einmal pro Karte zählen: Rückweg bedeutet nicht sofort neue Mobs.
            const mobsIn = c.flatMap(x => world[x][4].filter(m => m[1] >= lo && m[1] <= hi));
            if (!mobsIn.length && !(area && area.all)) continue;
            const byName = {};
            for (const x of mobsIn) byName[x[0]] = (byName[x[0]] || 0) + x[2];
            const main = Object.entries(byName).sort((a, b) => b[1] - a[1]).map(e => e[0]);
            const lv = area ? area.lv.slice() : [Math.min(...mobsIn.map(x => x[1])), Math.max(...mobsIn.map(x => x[1]))];
            const d = dist[root] ?? Infinity, r = rateXp(mobsIn, heroLvl());
            out.push({ maps: walk.map(Number), mode: 'loop', cards: c.length, n: c.reduce((n, x) => n + cnt[x], 0),
                lv, d, r, mobs: main.slice(0, 3), source: area ? 'forum' : 'world', forumId: area && area.id, recommended: !!(area && area.recommended), level: area && area.level, totalCards: area && area.maps.length,
                name: area ? area.name + ' (~' + area.level + ') · ' + wname(+root) : main[0] + ' ' + (lv[0] === lv[1] ? lv[0] : lv[0] + '–' + lv[1]), score: r.xp / (1 + d / 600) });
        }
        return out.sort((a, b) => b.score - a.score).slice(0, top || 5);
    }
    function forumRoutes(lo, hi, all = false) {
        if (!world) return [];
        const dist = worldSearch(mapId(), heroXY(), null).best;
        const out = FORUM_EXPOWISKA.filter(e => all || (e.lv[0] <= hi && e.lv[1] >= lo))
            .flatMap(e => suggestRoutes(e.lv[0], e.lv[1], 1000, Object.assign({ all, dist }, e)));
        return out.sort((a, b) => (Number.isFinite(b.d) - Number.isFinite(a.d)) ||
            (+b.recommended - +a.recommended) || b.score - a.score || a.forumId - b.forumId);
    }
    function startTravel(ids, label, then) {
        cfg.travel = { to: ids.map(Number), label, then: then || 'stop', since: Date.now() };
        travelDoor = null;
        log('Reise nach ' + label + ' gestartet');
        save(); lastStatic = '';
    }
    let travelDoor = null;                         // {key, since, still}: gerade angelaufene Tür (Hänger erkennen)
    function travelStep(goals, label) {
        /* Einen Schritt Richtung goals (Karten-IDs). Rückgabe: 'da' | 'läuft' | 'kein Weg'. */
        if (goals.includes(mapId())) return 'da';
        // Weg nur einmal pro Karte rechnen (Dijkstra über ~2800 Karten kostet sonst jeden Takt Zeit)
        const ck = mapId() + '|' + goals.join(',') + '|' + (cfg.blocked || []).length;
        if (!travelCache || travelCache.key !== ck) travelCache = { key: ck, r: worldPath(goals) };
        let r = travelCache.r;
        if ((!r || r.path.length < 2) && (cfg.blocked || []).length && unblockedFor !== goals.join(',')) {
            unblockedFor = goals.join(',');                  // nur einmal pro Ziel – sonst endlos bei wirklich zuer Tür
            log('Kein Weg mit gesperrten Türen – Sperren aufgehoben, suche neu');
            cfg.blocked = []; cfg.blockedAt = {}; save();
            travelCache = { key: mapId() + '|' + goals.join(',') + '|0', r: worldPath(goals) };
            r = travelCache.r;
        }
        if (!r || r.path.length < 2) {
            if (!world[mapId()]) log(`Karte „${mapName()}“ (#${mapId()}) fehlt in der Weltkarte`);
            return 'kein Weg';
        }
        const next = r.path[1].id, [hx, hy] = heroXY(), now = performance.now();
        lastTravel = { left: r.path.length - 1, next: wname(next), label, tele: r.path.filter(x => x.tele).length };
        if (r.path[0].tele) return teleStep(r.path[0].tele);
        if (!teleHinted && !Object.keys(cfg.tele || {}).length && r.path.length > 6) {
            teleHinted = true;
            log('Tipp: Sprich einmal mit dem Teleport-NPC einer Stadt und öffne seine Zielliste – dann nutzt der Bot Teleports statt langer Fußwege.');
        }
        const key = mapId() + '>' + next;
        const block = why => {
            cfg.blocked = Array.from(new Set((cfg.blocked || []).concat([key])));
            cfg.blockedAt = Object.assign(cfg.blockedAt || {}, { [key]: Date.now() });
            log('Tür nach ' + wname(next) + ' ' + why + ' – suche anderen Weg');
            travelDoor = null; travelCache = null; save();
            return 'läuft';
        };
        // Zu Fuß erreichbar? Karten können geteilt sein (z. B. nur durch eine Höhle verbunden) – dann sofort
        // anderen Weg suchen statt vor einer unerreichbaren Tür stehen zu bleiben.
        let live = gateways().filter(g => +g.id === next);
        if (!live.length && r.path[0].door) live = [{ x: r.path[0].door[0], y: r.path[0].door[1] }];
        let door = null;
        if (walls && MW) {
            const field = bfs(hx, hy);
            const reach = live.map(g => [g, cost(field, g.x, g.y)]).filter(t => t[1] < Infinity).sort((a, b) => a[1] - b[1]);
            if (live.length && !reach.length) {
                // Direkt nach dem Kartenwechsel sind die Wände oft erst halb geladen → erst nach 4 s und
                // einem frischen Neueinlesen glauben, dass die Tür wirklich nicht erreichbar ist.
                if (now - mapAt < 4000) return 'läuft';
                if (!unreachAt || unreachKey !== key) { unreachAt = now; unreachKey = key; loadCols(true); return 'läuft'; }
                if (now - unreachAt < 2000) return 'läuft';
                unreachAt = 0;
                return block('ist von hier zu Fuß nicht erreichbar');
            }
            unreachAt = 0;
            door = reach.length ? reach[0][0] : null;
        }
        if (!door) door = live.sort((a, b) => (Math.abs(a.x - hx) + Math.abs(a.y - hy)) - (Math.abs(b.x - hx) + Math.abs(b.y - hy)))[0];
        if (!door) return block('fehlt auf dieser Karte');
        if (!travelDoor || travelDoor.key !== key) travelDoor = { key, since: now, pos: hx + ',' + hy, moved: now };
        if (travelDoor.pos !== hx + ',' + hy) { travelDoor.pos = hx + ',' + hy; travelDoor.moved = now; }
        // Held kommt nicht voran (10 s kein Schritt) oder Tür geht nicht auf (Level, Schlüssel, Quest; 45 s)
        if (now - travelDoor.moved > 10000 && Math.abs(hx - door.x) + Math.abs(hy - door.y) > 1) return block('ist nicht erreichbar (Held kommt nicht weiter)');
        if (now - travelDoor.since > 45000) return block('geht nicht');
        lastTravel = { left: r.path.length - 1, next: wname(next), label };
        useDoor(door.x, door.y, '→ ' + wname(next));
        return 'läuft';
    }
    let lastTravel = null, destText = '', xpList = null, travelCache = null, unreachAt = 0, unreachKey = '', unblockedFor = '';
    let teleHinted = false, tst = null;
    function teleStep(tp) {
        /* Zum Teleport-NPC laufen, ansprechen, gelernten Dialogweg anklicken, auf den Kartenwechsel warten.
           Klappt es nicht (NPC weg, Antwort fehlt, zu wenig Gold …), wird dieser Teleport 15 min gesperrt. */
        const now = performance.now(), here = mapId(), key = here + '~' + tp.to;
        const info = ((cfg.tele || {})[here] || {})[tp.npc], opt = info && info.to[tp.to];
        const fail = why => {
            cfg.blocked = Array.from(new Set((cfg.blocked || []).concat([key])));
            cfg.blockedAt = Object.assign(cfg.blockedAt || {}, { [key]: Date.now() });
            log(`Teleport nach ${wname(tp.to)} ${why} – nehme anderen Weg`);
            tst = null; travelCache = null; save();
            return 'läuft';
        };
        if (!opt) return fail('unbekannt');
        if (!tst || tst.key !== key) tst = { key, t0: now, talk: 0, i: 0, clickAt: 0 };
        if (now - tst.t0 > 45000) return fail('hat nicht geklappt');
        const n = npcList().filter(d => d.nick === tp.npc).sort((a, b) => (Math.abs(a.x - info.x) + Math.abs(a.y - info.y)) - (Math.abs(b.x - info.x) + Math.abs(b.y - info.y)))[0];
        if (!n) return now - tst.t0 > 8000 ? fail(`– ${tp.npc} nicht gefunden`) : 'läuft';
        const [hx, hy] = heroXY();
        if (Math.abs(n.x - hx) > 1 || Math.abs(n.y - hy) > 1) { walkTo(n.x, n.y + 1, tp.npc + ' (Teleport)'); return 'läuft'; }
        const d = dialogOpen();
        if (!d) {
            if (!tst.talk || now - tst.talk > 5000) { send('talk&id=' + n.id); tst.talk = now; tst.i = 0; log(`Teleport: spreche mit ${tp.npc} → ${wname(tp.to)}`); }
            return 'läuft';
        }
        if (now - tst.clickAt < 900) return 'läuft';
        const steps = (opt.path || []).concat([opt.text]);
        const want = fold(steps[Math.min(tst.i, steps.length - 1)]);
        const li = [...d.querySelectorAll('.dialogue-window-answer')].find(x => fold(answerOf(x)) === want)
            || [...d.querySelectorAll('.dialogue-window-answer')].find(x => fold(answerOf(x)).includes(want));
        if (!li) return now - tst.talk > 6000 ? fail(`– Antwort „${steps[tst.i]}“ fehlt`) : 'läuft';
        li.click(); tst.clickAt = now; tst.i++;
        const ok = confirmPopup();                      // „Kosten X Gold, sicher?“ → ja
        return 'läuft';
    }
    let onDoor = null;
    function useDoor(x, y, why) {
        /* Zur Tür laufen. Steht der Held schon darauf (z. B. gerade durch genau diese Tür gekommen und die Route
           geht zurück), passiert nichts – das Spiel wechselt nur beim Betreten. Dann kurz runter und wieder drauf. */
        const [hx, hy] = heroXY(), now = performance.now();
        if (hx !== x || hy !== y) { onDoor = null; walkTo(x, y, why); return; }
        const k = mapId() + ':' + x + ',' + y;
        if (!onDoor || onDoor.k !== k) { onDoor = { k, at: now }; return; }
        if (now - onDoor.at < 1500) return;                    // Wechsel läuft vielleicht gerade
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || (walls && walls[ny * MW + nx])) continue;
            goal = null; walkTo(nx, ny, 'kurz von der Tür');
            onDoor = { k, at: now + 1500 };                     // danach wieder auf die Tür
            return;
        }
    }

    // ── Wege: BFS auf der Kollisionskarte ───────────────────────
    let colKey = '', walls = null, MW = 0, MH = 0;
    let colAt = 0, mapAt = 0;                      // wann Kollisionen gelesen / Karte gewechselt
    function loadCols(force) {
        /* Nach einem Kartenwechsel lädt das Spiel die Kollisionen erst nach und nach. Deshalb: Karte, die
           (fast) nur aus Wand besteht, gilt als „noch nicht da“, und 1,5 s nach dem Wechsel wird einmal
           nachgelesen – sonst ist kein Mob erreichbar und der Held bleibt stehen. Rückgabe: bereit? */
        const e = E(), now = performance.now(), key = e.map.d.id + ':' + e.map.size.x + 'x' + e.map.size.y;
        const stale = mapAt && colAt - mapAt < 1500 && now - mapAt >= 1500;
        if (key === colKey && !force && !stale) return true;
        colKey = key; colAt = now; MW = e.map.size.x; MH = e.map.size.y; fieldCache.clear(); travelCache = null;
        walls = new Uint8Array(MW * MH);
        let n = 0;
        for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
            let c = 0; try { c = e.map.col.check(x, y); } catch (er) {}
            walls[y * MW + x] = c ? 1 : 0; n += c ? 1 : 0;
        }
        if (!MW || !MH || n > MW * MH * 0.97) { colKey = ''; return false; }
        return true;
    }
    function bfs(sx, sy) {                       // Abstand zu allen Feldern (Mob-Felder selbst erreichbar)
        const d = new Int32Array(MW * MH).fill(-1), q = new Int32Array(MW * MH);
        let h = 0, t = 0;
        if (sx < 0 || sy < 0 || sx >= MW || sy >= MH) return d;
        d[sy * MW + sx] = 0; q[t++] = sy * MW + sx;
        while (h < t) {
            const c = q[h++], cx = c % MW, cy = (c / MW) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
                const n = ny * MW + nx;
                if (d[n] >= 0 || walls[n]) continue;
                d[n] = d[c] + 1; q[t++] = n;
            }
        }
        return d;
    }
    function cost(dist, x, y) {                  // Mob steht auf (x,y): Feld selbst oder Nachbarfeld
        let best = Infinity;
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
            const v = dist[ny * MW + nx];
            if (v >= 0) best = Math.min(best, v + (dx || dy ? 1 : 0));
        }
        return best;
    }

    // ── Nebel-Karten erkunden ───────────────────────────────────
    /* Auf manchen Karten liefert das Spiel nur Mobs in Sichtweite (erkannt in den ersten Sekunden: viel weniger
       sichtbar als die Weltkarte kennt, und alles Sichtbare steht nah).
       Erste Runde: Ziel ist der Punkt mit dem besten Verhältnis „neu sichtbare Fläche ÷ Laufweg“ (Kandidaten im
       4er-Raster, Fläche per Summentabelle in O(1)) – der Held deckt große Flächen ab, statt Ecken einzeln abzulaufen.
       Sichtweite wird gemessen (weitester Abstand, in dem ein Mob neu auftaucht).
       Danach: Mobs erscheinen immer an denselben Stellen → nur noch diese Stellen ablaufen (nächste zuerst),
       jede höchstens alle 25 s – statt die ganze Karte neu abzusuchen. */
    const fog = { key: '', t0: 0, maxVis: 0, on: false, seen: null, goal: null, goalAt: 0, goalGain: 0, doneAt: 0, pct: 0,
                  sight: 8, known: new Set(), spawns: new Map(), mem: new Map() };
    function fogUpdate(hx, hy) {
        const now = performance.now();
        if (fog.key !== colKey) Object.assign(fog, { key: colKey, t0: now, maxVis: 0, far: 0, on: false, seen: new Uint8Array(MW * MH),
                                                     goal: null, doneAt: 0, pct: 0, known: new Set(), spawns: new Map(), mem: new Map(), wspots: null, noRed: false });
        const visL = E().npcs.getDrawableList().filter(n => n.d && (n.d.type === 2 || n.d.type === 3)).map(n => n.d);
        fog.maxVis = Math.max(fog.maxVis, visL.length);
        // typisch für Nebel: alles Sichtbare steht nah am Helden. Ein einziger weit entfernter Mob = kein Nebel.
        for (const d of visL) fog.far = Math.max(fog.far || 0, Math.max(Math.abs(d.x - hx), Math.abs(d.y - hy)));
        const wm = world && world[mapId()], total = wm ? wm[4].reduce((n, x) => n + x[2], 0) : 0;
        const big = MW * MH >= 40 * 40;
        if (!fog.on && cfg.fogExplore !== false && big && now - fog.t0 > 2500 && now - fog.t0 < 4000 && total >= 8
            && fog.maxVis < total * 0.3 && (fog.far || 0) <= 12 && !fog.noRed) {
            /* Begrenzte Sicht gibt es nur auf roten Karten (PvP). Auf gelben/grünen sind wenige sichtbare Mobs
               einfach wenige Mobs – dann nicht die Karte absuchen. Ohne PvP-Angabe wie bisher (Feld noch ungeprüft). */
            const pv = mapPvp();
            if (pv != null && pv !== 2) {
                fog.noRed = true;
                log(`Wenig Mobs auf ${mapName()} (${fog.maxVis} von ~${total}), aber keine rote Karte (PvP-Stufe ${pv}) – kein Nebel, suche nicht`);
            } else {
                fog.on = true; fog.sight = Math.max(5, Math.min(12, fog.far || 8));
                log('Nebel auf ' + mapName() + ': sehe ' + fog.maxVis + ' von ~' + total + ' Mobs – erkunde die Karte');
            }
        }
        for (const d of visL) if (wanted(d) || cfg.picked[mobKey(d.icon)]) {   // von Anfang an merken, auch vor der Nebel-Erkennung
            fog.mem.set(d.id, { x: d.x, y: d.y, at: now, nick: d.nick, lvl: d.lvl || 0 });
            if (d.id === committed) fog.chase = d.id;
        }
        if (!fog.on) return;
        /* Gemerkte Mobs, die nicht mehr zu sehen sind: Steht der Held so nah an der Stelle, dass er den Mob sehen
           müsste, ist er wirklich weg (getötet, weitergelaufen). Sonst ist er nur hinter der Sichtgrenze – dann bleibt
           er ein Ziel, z. B. nach einem Umweg um eine Mauer. */
        const vis = new Set(visL.map(d => d.id)), R = Math.max(2, (fog.sight || 5) - 2);
        for (const [id, m] of fog.mem) if (!vis.has(id) && (Math.max(Math.abs(m.x - hx), Math.abs(m.y - hy)) <= R || now - m.at > 120000)) fog.mem.delete(id);
        if (!fog.wspots) fog.wspots = worldSpots();
        for (const d of visL) {                    // Sichtweite lernen + Fundstellen merken
            if (!fog.known.has(d.id)) {
                fog.known.add(d.id);
                const dist = Math.max(Math.abs(d.x - hx), Math.abs(d.y - hy));
                if (dist > fog.sight && dist <= 14) fog.sight = dist;
            }
            if (wanted(d) || cfg.picked[mobKey(d.icon)]) {
                const k = (d.x >> 1) + ',' + (d.y >> 1);                       // 2×2-Raster: Mobs laufen etwas herum
                if (!fog.spawns.has(k)) fog.spawns.set(k, { x: d.x, y: d.y, at: 0 });
            }
        }
        const S = Math.max(4, fog.sight - 1);         // 1 Feld Sicherheitsabstand: Sichtweite ist nur geschätzt
        for (let y = Math.max(0, hy - S); y <= Math.min(MH - 1, hy + S); y++)
            for (let x = Math.max(0, hx - S); x <= Math.min(MW - 1, hx + S); x++) fog.seen[y * MW + x] = 1;
        for (const p of fog.spawns.values()) if (Math.abs(p.x - hx) <= S - 1 && Math.abs(p.y - hy) <= S - 1) p.at = now;
        for (const p of fog.wspots) if (!p.done && Math.abs(p.x - hx) <= S - 1 && Math.abs(p.y - hy) <= S - 1) p.done = true;
    }
    function worldSpots() {
        /* Stellplätze der gewünschten Mobs laut Weltkarte (margoworld). Im Nebel sieht der Held nur seine Umgebung,
           die Plätze sind aber bekannt: gezielt dort nachsehen statt die ganze Fläche abzulaufen. */
        const wm = world && world[mapId()], out = [], seen = new Set();
        if (!wm) return out;
        for (const m of wm[4]) {
            const P = m[3];
            if (!Array.isArray(P) || !wanted({ lvl: m[1], key: m[4] ? mobKey(m[4]) : '' })) continue;
            for (let i = 0; i + 1 < P.length; i += 2) {
                const x = P[i], y = P[i + 1], k = (x >> 1) + ',' + (y >> 1);
                if (seen.has(k) || x >= MW || y >= MH) continue;
                seen.add(k); out.push({ x, y, done: false });
            }
        }
        return out;
    }
    function exploreStep(hx, hy, hasExit) {
        /* true = läuft, false = nichts zu tun (Karte abgesucht und keine Fundstelle fällig). */
        const now = performance.now();
        const go = (i, why) => { fog.goal = i; fog.goalAt = now; walkTo(i % MW, (i / MW) | 0, why); return true; };
        // Mob gesehen, jetzt außer Sicht (Sichtgrenze, Umweg um eine Mauer): EINEN davon fest verfolgen, bis der
        // Held dort ist – nicht nach jedem Schritt neu wählen, sonst Hin und Her. Gewählt nach echtem Laufweg;
        // gemerkt 2 min; kommt der Held 10 s nicht voran oder ist die Stelle unerreichbar → aufgeben.
        const alive = new Set(mobRaw().map(d => d.id));
        for (const [id, m] of fog.mem) {
            if (skipUntil[id] > now || now - m.at > 120000 || (Math.abs(m.x - hx) <= 1 && Math.abs(m.y - hy) <= 1 && !alive.has(id))) fog.mem.delete(id);
        }
        if (fog.chase != null && !fog.mem.has(fog.chase)) fog.chase = null;
        if (fog.chase == null && fog.mem.size) {
            const d = bfs(hx, hy);
            const best = [...fog.mem.entries()].map(([id, m]) => [id, cost(d, m.x, m.y)]).filter(t => t[1] < Infinity).sort((a, b) => a[1] - b[1])[0];
            if (best) { fog.chase = best[0]; fog.chaseMoved = now; fog.chasePos = hx + ',' + hy; }
            else fog.mem.clear();
        }
        if (fog.chase != null) {
            const m = fog.mem.get(fog.chase);
            if (fog.chasePos !== hx + ',' + hy) { fog.chasePos = hx + ',' + hy; fog.chaseMoved = now; }
            if (now - fog.chaseMoved > 10000) { fog.mem.delete(fog.chase); fog.chase = null; }
            else { walkTo(m.x, m.y, 'Mob zuletzt gesehen'); return true; }
        }
        if (!fog.doneAt && fog.wspots && fog.wspots.length) {
            /* Mob-Plätze der Reihe nach ansehen (immer den nächsten). Sind genug davon abgesucht – Einstellung
               „Nebel: absuchen bis“ – und nichts mehr zu sehen, geht es weiter zur nächsten Karte. */
            const d = bfs(hx, hy);
            if (fog.goal != null && now - fog.goalAt >= 15000) {      // kommt nicht hin → Platz aufgeben
                const g = fog.wspots.find(p => p.y * MW + p.x === fog.goal);
                if (g) g.done = true;
                fog.goal = null;
            }
            const reach = fog.wspots.filter(p => p.done || cost(d, p.x, p.y) < Infinity);
            const open = reach.filter(p => !p.done);
            fog.pct = reach.length ? Math.round((reach.length - open.length) / reach.length * 100) : 100;
            if (!open.length || fog.pct >= (+cfg.fogPct || 100)) {
                fog.doneAt = now; fog.goal = null;
                for (const p of fog.wspots) { const k = (p.x >> 1) + ',' + (p.y >> 1); if (!fog.spawns.has(k)) fog.spawns.set(k, { x: p.x, y: p.y, at: now }); }
                log(`Nebel: ${fog.pct} % der Mob-Plätze abgesucht` + (hasExit ? ' – weiter zum Ausgang' : ' – laufe ab jetzt die Plätze ab'));
                return exploreStep(hx, hy, hasExit);
            }
            const g = fog.goal != null && open.find(p => p.y * MW + p.x === fog.goal);
            if (g) { walkTo(g.x, g.y, 'Mob-Platz'); return true; }
            const best = open.map(p => [p, cost(d, p.x, p.y)]).sort((a, b) => a[1] - b[1])[0][0];
            return go(best.y * MW + best.x, `Mob-Platz (${fog.pct} % abgesucht)`);
        }
        if (fog.doneAt) {
            if (hasExit) return false;
            // Patrouille über die bekannten Fundstellen: nächste fällige (≥ 25 s nicht gesehen)
            const due = [...fog.spawns.values()].filter(p => now - p.at > 25000);
            if (!due.length) return false;
            if (fog.goal != null && now - fog.goalAt < 15000 && due.some(p => p.y * MW + p.x === fog.goal)) { walkTo(fog.goal % MW, (fog.goal / MW) | 0, 'Fundstelle'); return true; }
            const d = bfs(hx, hy);
            const best = due.map(p => [p, cost(d, p.x, p.y)]).filter(t => t[1] < Infinity).sort((a, b) => a[1] - b[1])[0];
            if (!best) return false;
            return go(best[0].y * MW + best[0].x, 'Fundstelle');
        }
        // Summentabelle der ungesehenen begehbaren Felder → Fläche jedes Quadrats in O(1)
        const W2 = MW + 1, P = new Int32Array(W2 * (MH + 1));
        for (let y = 0; y < MH; y++) {
            let row = 0;
            for (let x = 0; x < MW; x++) {
                const i = y * MW + x;
                row += !fog.seen[i] && !walls[i] ? 1 : 0;
                P[(y + 1) * W2 + x + 1] = P[y * W2 + x + 1] + row;
            }
        }
        const S = Math.max(4, fog.sight - 1), area = (x, y) => {
            const x0 = Math.max(0, x - S), y0 = Math.max(0, y - S), x1 = Math.min(MW, x + S + 1), y1 = Math.min(MH, y + S + 1);
            return P[y1 * W2 + x1] - P[y0 * W2 + x1] - P[y1 * W2 + x0] + P[y0 * W2 + x0];
        };
        const left = P[MH * W2 + MW];
        // aktuelles Ziel behalten, solange dort noch genug Neues zu sehen ist
        if (fog.goal != null && now - fog.goalAt < 20000) {
            const gx = fog.goal % MW, gy = (fog.goal / MW) | 0;
            const keep = fog.goalGain <= 1 ? !fog.seen[fog.goal] : area(gx, gy) >= Math.max(4, fog.goalGain * 0.35) && Math.max(Math.abs(gx - hx), Math.abs(gy - hy)) > 2;
            if (keep) { walkTo(gx, gy, 'Erkunden'); return true; }
        }
        const d = bfs(hx, hy);
        let all = 0;
        for (let i = 0; i < d.length; i++) if (d[i] >= 0 && !walls[i]) all++;
        fog.pct = all ? Math.round((1 - left / all) * 100) : 100;
        let best = -1, bs = 0, bg = 0;
        for (let y = 1; y < MH; y += 3) for (let x = 1; x < MW; x += 3) {
            const i = y * MW + x;
            if (d[i] < 0 || walls[i]) continue;
            const g = area(x, y);
            if (g < 6) continue;
            const sc = g / (d[i] + 10);
            if (sc > bs) { bs = sc; best = i; bg = g; }
        }
        if (best < 0) {                            // nur noch kleine Reste (Ecken, Ränder): nächstes ungesehenes Feld
            let near = -1;
            for (let i = 0; i < d.length; i++) if (d[i] >= 0 && !walls[i] && !fog.seen[i] && (near < 0 || d[i] < d[near])) near = i;
            if (near >= 0) { fog.goalGain = 1; return go(near, 'Erkunden'); }
        }
        if (best < 0) {
            fog.doneAt = now; fog.goal = null;
            log('Karte abgesucht (' + fog.spawns.size + ' Fundstellen)' + (hasExit ? ' – weiter zum Ausgang' : ' – laufe ab jetzt die Fundstellen ab'));
            return exploreStep(hx, hy, hasExit);
        }
        fog.goalGain = bg;
        return go(best, 'Erkunden');
    }

    // ── Reihenfolge: Start → alle Ziele → Ausgang ───────────────
    const fieldCache = new Map();                  // BFS-Felder ab Mob-Kacheln (Mobs stehen meist still) – pro Karte
    function field(x, y) {
        const k = x + ',' + y;
        let f = fieldCache.get(k);
        if (!f) {
            f = bfs(x, y); fieldCache.set(k, f);
            if (fieldCache.size > 120) fieldCache.delete(fieldCache.keys().next().value);
        }
        return f;
    }
    const PLAN_K = 10;                             // exakt über die 10 nächsten Ziele (nach jedem Kampf neu geplant)
    function plan(all, exit) {
        /* Rollende Planung: Held-Karp über die PLAN_K nächsten erreichbaren Ziele + Ausgang. Auf großen Karten
           (90+ Mobs) bleibt das wenige ms statt Sekunden – sonst blockiert die Planung den Spiel-Thread (Ruckeln). */
        const [hx, hy] = heroXY();
        const d0f = bfs(hx, hy);
        const near = all.map(m => [m, cost(d0f, m.x, m.y)]).filter(t => t[1] < Infinity)
            .sort((a, b) => a[1] - b[1]).slice(0, PLAN_K);
        if (!near.length) return null;
        const targets = near.map(t => t[0]), d0 = near.map(t => t[1]), n = targets.length;
        const fields = targets.map(m => field(m.x, m.y));
        const D = targets.map((a, i) => targets.map((b, j) => i === j ? 0 : cost(fields[i], b.x, b.y)));
        const dend = targets.map((a, i) => exit ? cost(fields[i], exit.x, exit.y) : 0);
        const S = 1 << n, g = new Float64Array(S * n).fill(Infinity), nx = new Int8Array(S * n).fill(-1);
        for (let i = 0; i < n; i++) g[(1 << i) * n + i] = dend[i];
        for (let m = 1; m < S; m++) for (let i = 0; i < n; i++) {
            if (!(m >> i & 1) || m === 1 << i) continue;
            const r = m ^ (1 << i), Di = D[i], at = m * n + i;
            for (let j = 0; j < n; j++) if (r >> j & 1) {
                const v = Di[j] + g[r * n + j];
                if (v < g[at]) { g[at] = v; nx[at] = j; }
            }
        }
        const totals = [], routes = [];
        for (let i = 0; i < n; i++) {
            totals[i] = d0[i] + g[(S - 1) * n + i];
            const o = [i]; let m = S - 1, k = i;
            while (nx[m * n + k] >= 0) { const j = nx[m * n + k]; m ^= 1 << k; k = j; o.push(k); }
            routes[i] = o;
        }
        const best = Math.min(...totals), idx = [...Array(n).keys()];
        let first;
        if (cfg.optimal) first = idx.sort((a, b) => totals[a] - totals[b] || d0[a] - d0[b])[0];
        else first = idx.filter(i => totals[i] <= best * 1.15 || totals[i] <= best + 3).sort((a, b) => d0[a] - d0[b] || totals[a] - totals[b])[0];
        // schon angelaufenes Ziel behalten, wenn es kaum schlechter ist – sonst pendelt der Held zwischen zwei Zielen
        const keep = targets.findIndex(m => m.id === committed);
        if (keep >= 0 && keep !== first && totals[keep] <= totals[first] + 2) first = keep;
        return { order: routes[first].map(i => targets[i]), total: totals[first], more: all.length - n };
    }

    // ── Routen ──────────────────────────────────────────────────
    const nameEq = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
    let lastMap = null;
    // Routen-Eintrag: Kartenname (selbst aufgenommen) oder Karten-ID (fertige Route aus der Weltkarte)
    const isId = e => typeof e === 'number';
    const mapIs = e => isId(e) ? e === mapId() : nameEq(e, mapName());
    const entryName = e => isId(e) ? wname(e) : e;
    const entryIds = e => isId(e) ? [e] : idsByName(e);
    function routeStep() {
        /* Position in der aktiven Route an die aktuelle Karte anpassen. Rückgabe: {pos, next} oder null. */
        const r = cfg.routes[cfg.route];
        if (!r || !r.maps.length) return null;
        const S = routeSeq(r), mn = mapName(), n = S.length;
        if (!mapIs(S[cfg.routePos % n])) {
            // nächstes Vorkommen dieser Karte ab der gemerkten Stelle (wichtig bei hin und zurück)
            let found = -1;
            for (let k = 1; k <= n; k++) if (mapIs(S[(cfg.routePos + k) % n])) { found = (cfg.routePos + k) % n; break; }
            if (found < 0) return null;
            cfg.routePos = found; save();
        }
        const nx = S[(cfg.routePos + 1) % n];
        return { pos: cfg.routePos % n, next: entryName(nx), nextE: nx, n, back: cfg.routePos % n >= r.maps.length };
    }
    function routeMode(r) {
        /* 'back' = am Ende zurücklaufen (A…F, E…B, A…), 'loop' = im Kreis (F → A). Ohne Einstellung:
           im Kreis nur, wenn die letzte Karte eine Tür zur ersten hat (Weltkarte). */
        if (r.mode) return r.mode;
        if (r.maps.length < 3 || !world) return 'back';
        const last = entryIds(r.maps[r.maps.length - 1]), first = new Set(entryIds(r.maps[0]));
        return last.some(id => world[id] && world[id][3].some(g => first.has(g[0]))) ? 'loop' : 'back';
    }
    function routeSeq(r) {                         // Kartenfolge, die der Bot tatsächlich abläuft
        const m = r.maps;
        return routeMode(r) === 'back' && m.length > 2 ? m.concat(m.slice(1, -1).reverse()) : m;
    }
    function currentExit() {
        const rs = routeStep(), gws = gateways();
        if (rs) return gws.find(g => isId(rs.nextE) ? +g.id === rs.nextE : nameEq(g.name, rs.nextE)) || null;
        const id = cfg.exits[mapName()];
        return id ? gws.find(g => String(g.id) === String(id)) || null : null;
    }
    function trackMaps() {
        /* Kartenwechsel: Aufnahme fortschreiben, Route einen Schritt weiter. */
        const mn = mapName();
        if (!mn || mn === lastMap) return;                 // während des Ladens kein Name → nicht als Karte zählen
        const prev = lastMap;
        lastMap = mn;
        // neue Karte: alte Laufziele vergessen, kurz warten, bis das Spiel die Karte geladen hat
        mapAt = performance.now(); goal = null; committed = null; lastPlan = null; travelDoor = null;
        skipUntil = {}; atkTries = {}; chaseAt = mapAt;
        if (prev) busyUntil = Math.max(busyUntil, mapAt + 900);
        if (cfg.rec) {
            if (cfg.rec[cfg.rec.length - 1] !== mn) { cfg.rec.push(mn); save(); log('Aufnahme: ' + cfg.rec.join(' → ')); }
        }
        const r = cfg.routes[cfg.route];
        const S = r && r.maps.length ? routeSeq(r) : null;
        if (prev && S && mapIs(S[(cfg.routePos + 1) % S.length])) {
            cfg.routePos = (cfg.routePos + 1) % S.length; save();
        }
    }

    // ── Ablauf ──────────────────────────────────────────────────
    let chaseAt = 0;                           // Laufauftrag zum aktuellen Mob, getrennt vom letzten Heldenschritt
    let committed = null, planAt = 0, renderAt = 0, offRoute = null, offRouteLog = null, atkTries = {}, skipUntil = {};                          // Ziel, zu dem der Held gerade läuft
    let busyUntil = 0, goal = null, goalSince = 0, lastHero = '', heroStill = 0, lastPlan = null, battleSeen = false;
    /* Andere Spieler beobachten: wer seit sec Sekunden höchstens near Felder entfernt ist und dabei selbst
       mindestens 3 Felder gelaufen ist, folgt uns (ein Spieler, der nur nebenan steht und jagt, zählt nicht). */
    const pkSeen = {};                              // id → { since, x0, y0, last, moved }
    let pkRouteSkip = null;                         // gelbe Karte wegen Verfolger entlang der Route verlassen
    let pkEsc = null, pkTries = {}, pkLog = '';
    function watchPlayers() {
        if (cfg.pk.mode === 'off' || !ok()) return;
        const now = performance.now(), [hx, hy] = heroXY(), near = Math.max(1, +cfg.pk.near || 6);
        for (const p of players()) {
            const close = Math.max(Math.abs(p.x - hx), Math.abs(p.y - hy)) <= near;
            let r = pkSeen[p.id];
            if (!close) { if (r && now - r.last > 1500) delete pkSeen[p.id]; continue; }
            if (!r || r.map !== mapId()) r = pkSeen[p.id] = { since: now, x0: p.x, y0: p.y, moved: 0, map: mapId() };
            r.last = now; r.moved = Math.max(r.moved, Math.abs(p.x - r.x0), Math.abs(p.y - r.y0));
        }
        for (const id in pkSeen) if (now - pkSeen[id].last > 3000) delete pkSeen[id];
    }
    const neverSet = () => new Set(String(cfg.pk.never || '').split(/[,;\n]/).map(x => fold(x)).filter(Boolean));
    function follows(p) { const r = pkSeen[p.id]; return !!r && performance.now() - r.since >= (+cfg.pk.sec || 5) * 1000 && r.moved >= 3; }
    function pkThreat() {                           // der Spieler, auf den der Bot gerade reagieren soll
        if (cfg.pk.mode === 'off') return null;
        const nv = neverSet(), [hx, hy] = heroXY();
        const L = players().filter(p => !nv.has(fold(p.nick)) && (cfg.pk.mode === 'any' || follows(p)));
        L.sort((a, b) => Math.max(Math.abs(a.x - hx), Math.abs(a.y - hy)) - Math.max(Math.abs(b.x - hx), Math.abs(b.y - hy)));
        return L[0] || null;
    }
    function pkStep(hx, hy, exit) {
        /* Gibt true zurück, wenn der Bot sich in diesem Takt um einen Spieler kümmert (kämpfen oder Karte verlassen). */
        if (cfg.pk.mode === 'off') return false;
        const now = performance.now();
        {
            const t = pkThreat();
            if (!t) return false;
            const up = Math.max(0, +cfg.pk.maxUp || 0), tries = pkTries[t.id] || { n: 0, at: 0 };
            const rs = routeStep();
            if (mapPvp() === 1 && cfg.pk.mode === 'follow' && t.lvl <= heroLvl() + up && rs && rs.n > 1) {
                pkRouteSkip = { map: mapId(), route: cfg.route, nextE: rs.nextE, next: rs.next, warned: false };
                committed = null; lastPlan = null; goal = null;
                log(`${t.nick} (${t.lvl}) folgt mir – gelbe Karte → nächste Routenkarte ${rs.next}`);
                return skipFollowedMap();
            }
            const fight = isRed() && t.lvl <= heroLvl() + up && tries.n < 3;
            if (fight) {
                const adj = Math.abs(t.x - hx) <= 1 && Math.abs(t.y - hy) <= 1;
                if (!adj) { committed = null; lastPlan = null; walkTo(t.x, t.y, 'Spieler ' + t.nick); return true; }
                if (now - tries.at < 2500) return true;                // letzter Versuch läuft noch
                tries.n++; tries.at = now; pkTries[t.id] = tries;
                /* Spieler-Angriff (noch nicht im Spiel geprüft): wie „Atakuj“ im Spiel-Menü, Spieler-ID positiv.
                   ff=1 = schnelle Walka (wie heroAtackRequest(id, true) bei Mobs) – der Bot spielt keine Runden selbst. */
                act(() => send('fight&a=attack&ff=1&id=' + t.id), 'Angriff auf Spieler');
                log(`Kämpfe gegen ${t.nick} (${t.lvl})` + (cfg.pk.mode === 'follow' ? ' – folgt mir' : '') + (tries.n > 1 ? ` – Versuch ${tries.n}` : ''));
                goal = null;
                return true;
            }
            const why = !isRed() ? 'keine rote Karte' : tries.n >= 3 ? 'Angriff klappt nicht' : `Lvl ${t.lvl} ist mehr als +${up} über mir`;
            log(`${t.nick} (${t.lvl})${cfg.pk.mode === 'follow' ? ' folgt mir' : ' ist hier'} – ${why} → Flucht`);
            pkEsc = { id: t.id, nick: t.nick, lvl: t.lvl, lastSeen: now, at: now, home: mapId(), homeName: mapName(),
                      x: t.x, y: t.y, mapAt: null, cur: null, prev: null, door: null, hide: null, maps: 0 };
            return escapeStep();
        }
    }
    function skipFollowedMap() {
        const s = pkRouteSkip;
        if (!s) return false;
        if (!cfg.on || cfg.route !== s.route || mapId() !== s.map) { pkRouteSkip = null; goal = null; return false; }
        committed = null; lastPlan = null;
        const door = gateways().find(g => isId(s.nextE) ? +g.id === s.nextE : nameEq(g.name, s.nextE));
        if (door) useDoor(door.x, door.y, 'nächste Routenkarte ' + s.next);
        else if (!s.warned) { s.warned = true; log('Nächste Routenkarte ' + s.next + ': Tür nicht gefunden – ich warte'); }
        return true;
    }
    /* Flucht vor einem zu starken Spieler: durch eine Tür, die von ihm weg führt (nicht zurück, woher wir kamen),
       Höhlen bevorzugt. Ist er auf der neuen Karte nicht zu sehen und es ist eine Höhle → in die hinterste Ecke und
       warten. Sonst weiter von Karte zu Karte, bis er 30 s nicht mehr zu sehen war; dann zurück zum Jagdort. */
    const CAVE = /jaskin|grot|pieczar|kopalni|loch|lochy|podziem|tunel|krypt|grobow|nora|piwnic|\bcave|grotto|\bmine|\blair|tunnel|dungeon|crypt|tomb|cellar|cavern|burrow/i;
    const mapLabel = id => ((world && world[id] && world[id][2]) || '') + ' ' + ((cfg.names || {})[id] || '');
    const isCave = id => CAVE.test(mapLabel(id));
    const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
    function escapeStep() {
        const now = performance.now(), [hx, hy] = heroXY(), e = pkEsc;
        committed = null; lastPlan = null;
        const seen = players().find(p => p.id === e.id || nameEq(p.nick, e.nick));
        if (seen) { e.lastSeen = now; e.x = seen.x; e.y = seen.y; }
        if (e.mapAt !== mapAt) {                                   // neue Karte: Eingang merken (dort käme er nach)
            if (e.cur != null && e.cur !== mapId()) e.prev = e.cur;
            e.cur = mapId(); e.mapAt = mapAt; e.entry = [hx, hy]; e.door = null; e.hide = null;
            if (e.maps++) log('Flucht: ' + mapName() + (seen ? ` – ${e.nick} ist auch hier` : ''));
        }
        if (now - e.lastSeen >= 30000 || now - e.at > 300000) {
            log(`${e.nick} seit 30 s nicht gesehen – Flucht vorbei`);
            pkEsc = null; goal = null;
            const r = cfg.routes[cfg.route];
            if (!(r && r.maps.length) && e.home !== mapId() && world && world[e.home]) startTravel([e.home], e.homeName, 'hunt');
            return true;
        }
        // Gefahrenpunkt: wo er steht, sonst der Eingang dieser Karte
        const [dx, dy] = seen ? [seen.x, seen.y] : e.entry;
        // Höhle oder Sackgasse (einzige Tür führt zurück zu ihm) und er ist nicht hier:
        // verstecken (hinterste Ecke vom Eingang aus) und abwarten
        const deadEnd = e.prev != null && gateways().every(g => String(g.id) === String(e.prev));
        if (!seen && (isCave(mapId()) || deadEnd) && walls) {
            if (!e.hide) {
                const d = bfs(e.entry[0], e.entry[1]), gw = new Set(gateways().map(g => g.y * MW + g.x));
                let best = -1;
                for (let i = 0; i < d.length; i++) if (d[i] > 0 && !walls[i] && !gw.has(i) && (best < 0 || d[i] > d[best])) best = i;
                e.hide = best >= 0 ? [best % MW, (best / MW) | 0] : [hx, hy];
                log(`Verstecke mich in ${mapName()}${deadEnd && !isCave(mapId()) ? ' (Sackgasse)' : ''} – warte, bis ${e.nick} 30 s weg ist`);
            }
            if (hx !== e.hide[0] || hy !== e.hide[1]) walkTo(e.hide[0], e.hide[1], 'Versteck');
            render();
            return true;
        }
        e.hide = null;
        // Tür wählen: weit weg von ihm, nah bei mir, nicht zurück; Höhlen bevorzugt, etwas Zufall
        const gws = gateways();
        const pick = () => {
            const sc = gws.map(g => {
                const dh = cheb(hx, hy, g.x, g.y), dd = cheb(dx, dy, g.x, g.y);
                let v = (dd - dh) + (isCave(g.id) ? 15 : 0) + Math.random() * 6;
                if (String(g.id) === String(e.prev) && gws.length > 1) v -= 1000;   // nicht zurück zu ihm
                if (dd <= 2) v -= 500;                                             // er steht an der Tür
                return [g, v];
            }).sort((a, b) => b[1] - a[1]);
            return sc.length ? sc[0][0] : null;
        };
        if (!e.door || (seen && cheb(dx, dy, e.door.x, e.door.y) < cheb(hx, hy, e.door.x, e.door.y))) {
            const old = e.door; e.door = pick();
            if (e.door && (!old || old.id !== e.door.id)) log(`Flucht → ${e.door.name}${isCave(e.door.id) ? ' (Höhle)' : ''}`);
        }
        if (e.door) useDoor(e.door.x, e.door.y, 'Flucht → ' + e.door.name);
        else if (pkLog !== 'nodoor' + mapAt) { pkLog = 'nodoor' + mapAt; log('Keine Tür gefunden – ich bleibe stehen'); }
        render();
        return true;
    }
    const logLines = [];
    function log(t) { logLines.unshift(new Date().toLocaleTimeString() + '  ' + t); logLines.length = Math.min(logLines.length, 6); render(); }

    function act(fn, what) {                      // Aktion ausführen, danach zufällige Pause
        try { fn(); } catch (e) { log('Fehler bei ' + what + ': ' + e.message); }
        busyUntil = performance.now() + pause();
    }
    function walkTo(x, y, why) {
        const key = x + ',' + y;
        // läuft schon dorthin: nicht neu anstoßen (das Spiel würde den Weg neu starten → Stocken),
        // außer der Held steht seit über 1,2 s
        if (goal === key && (performance.now() - goalSince < 1200 || performance.now() - heroStill < 1200)) return;
        goal = key; goalSince = performance.now();
        act(() => E().hero.autoGoTo({ x, y }, false), 'Laufen');
        log('Laufe zu ' + why + ' (' + x + ',' + y + ')');
    }

    let recBattle = false;
    function recordFights() {
        /* Während der Aufnahme: Mobs, die du selbst angreifst, werden für die Route angehakt. */
        if (!cfg.rec) return;
        const b = inBattle();
        if (b && !recBattle) {
            const [hx, hy] = heroXY();
            const near = mobs().filter(m => Math.abs(m.x - hx) <= 2 && Math.abs(m.y - hy) <= 2)
                .sort((a, c) => (Math.abs(a.x - hx) + Math.abs(a.y - hy)) - (Math.abs(c.x - hx) + Math.abs(c.y - hy)))[0];
            if (near && !cfg.picked[near.key]) {
                cfg.picked[near.key] = true; save(); lastStatic = '';
                log('Aufnahme: ' + near.nick + ' (' + near.lvl + ') angehakt');
            }
        }
        recBattle = b;
    }

    let deadNow = false, revived = false;
    function checkDeath() {
        const dead = isDead();
        if (dead && !deadNow) {
            const [hx, hy] = heroXY();
            const t = lastPlan && lastPlan.order[0];
            const rec = { time: new Date().toLocaleString(), map: mapName(), x: hx, y: hy, route: cfg.route || '',
                          target: t ? t.nick + ' (' + t.lvl + ')' : '', lvl: (E().hero.d || {}).lvl };
            cfg.deaths = [rec].concat(cfg.deaths || []).slice(0, 20);
            log('☠ Gestorben auf ' + rec.map + ' (' + hx + ',' + hy + ')' + (rec.target ? ' gegen ' + rec.target : ''));
            if (cfg.on && cfg.onDeath === 'back') {
                cfg.back = { map: rec.map, id: mapId(), since: Date.now() };
                log('Nach der Wiederbelebung geht es zurück nach ' + rec.map);
            } else if (cfg.on && !(cfg.rules || []).some(r => r.on && r.when.t === 'death' && r.steps.length)) {
                cfg.on = false;
                log('Bot gestoppt (Tod)');
            }
            if (cfg.e2.on && cfg.onDeath !== 'back') { cfg.e2.on = false; log('E2-Jagd gestoppt (Tod)'); }
            save(); lastStatic = '';
        }
        if (!dead && deadNow) revived = true;
        deadNow = dead;
        return dead;
    }
    function idsByName(n) {                        // Karten-IDs mit genau diesem Namen (englisch oder polnisch)
        const q = fold(n), out = new Set();
        for (const id in cfg.names) if (fold(cfg.names[id]) === q) out.add(+id);
        if (world) for (const id in world) if (fold(world[id][2]) === q) out.add(+id);
        return Array.from(out);
    }
    function routeIds(r) { return Array.from(new Set(r.maps.flatMap(entryIds))); }
    // ── Abläufe: Wenn <Bedingung> → Schritte der Reihe nach ─────
    /* Regel: {id, on, when:{t, n}, steps:[{t, …}], done}. Ausgelöst wird beim Übergang „Bedingung wird
       wahr“ (nicht dauernd), Level-Regeln nur einmal. Während ein Ablauf läuft, ruht die Jagd; danach
       geht es weiter. Spielbefehle über _g (wie das Spiel selbst), Dialog/Shop über das HTML-Fenster. */
    const COND = {
        lvl:   { label: 'Level erreicht', unit: '', def: 25, test: n => heroLvl() >= n, once: true },
        heal:  { label: 'Heiltränke unter', unit: 'Stk.', def: 5, test: n => potionCount() < n },
        hp:    { label: 'Leben unter', unit: '%', def: 30, test: n => hpPct() < n },
        gold:  { label: 'Gold mindestens', unit: '', def: 10000, test: n => ((E().hero.d || {}).gold || 0) >= n },
        death: { label: 'Nach dem Tod', unit: null, test: () => false },
        hand:  { label: 'Nur von Hand', unit: null, test: () => false }
    };
    const STEP = {
        equip: { label: 'Ausrüsten', f: [['name', 'Gegenstand']] },
        use:   { label: 'Benutzen', f: [['name', 'Gegenstand']] },
        fill:  { label: 'Heilen bis voll', f: [] },
        go:    { label: 'Zu Karte laufen', f: [['map', 'Karte']] },
        npc:   { label: 'NPC ansprechen', f: [['name', 'NPC'], ['say', 'Antwort (optional)']] },
        sell:  { label: 'Verkaufen', f: [['what', 'Was']] },
        buy:   { label: 'Kaufen', f: [['n', 'Anzahl', 'num'], ['name', 'Gegenstand']] },
        close: { label: 'Laden schließen', f: [] },
        xp:    { label: 'Zum XP-Ort & jagen', f: [['min', 'Lvl von', 'num'], ['max', 'bis', 'num']] },
        back:  { label: 'Zurück zum Jagdort', f: [] },
        wait:  { label: 'Warten', f: [['s', 'Sekunden', 'num']] },
        hunt:  { label: 'Jagen', f: [] },
        stop:  { label: 'Bot stoppen', f: [] }
    };
    function stepText(s) {
        switch (s.t) {
            case 'equip': return 'Ausrüsten: ' + (s.name || '?');
            case 'use': return 'Benutzen: ' + (s.name || '?');
            case 'go': return 'Laufen nach ' + (/^\d+$/.test(String(s.map || '')) ? wname(+s.map) : (s.map || '?'));
            case 'npc': return 'Sprechen mit ' + (s.name || '?') + (s.say ? ' → „' + s.say + '“' : '');
            case 'buy': return 'Kaufen: ' + (s.n || 1) + '× ' + (s.name || '?') + (s.closeAfter ? ' · danach Laden zu' : '');
            case 'sell': return 'Verkaufen: ' + (SELL[s.what || 'gear'] || SELL.gear).label + (s.closeAfter ? ' · danach Laden zu' : '');
            case 'xp': return s.min ? `XP-Ort Lvl ${s.min}–${s.max || s.min} & jagen` : 'XP-Ort um mein Level & jagen';
            case 'wait': return 'Warten ' + (s.s || 1) + ' s';
            default: return STEP[s.t] ? STEP[s.t].label : s.t;
        }
    }
    function whenText(w) {
        const c = COND[w.t];
        if (!c) return '?';
        return c.unit === null ? c.label : c.label + ' ' + fmtN(w.n) + (c.unit ? ' ' + c.unit : '');
    }
    const fmtN = n => Number(n || 0).toLocaleString('de-DE');

    // Spielzugriff (defensiv: mehrere bekannte Wege, Fehler landen im Verlauf)
    function send(cmd) {
        if (typeof W._g === 'function') return W._g(cmd);
        throw new Error('Spielbefehl _g nicht gefunden');
    }
    function parseStat(s) {
        const o = {};
        for (const p of String(s || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = p.slice(i + 1); else if (p) o[p] = true; }
        return o;
    }
    function allItems() {
        const it = E().items, out = [];
        if (!it) return out;
        const add = x => { const d = x && (x.d || x); if (d && d.id) out.push(d); };
        try {
            if (typeof it.fetchLocationItems === 'function') for (const l of ['g', 'n', 's']) (it.fetchLocationItems(l) || []).forEach(add);
        } catch (e) {}
        if (!out.length) for (const k of ['items', 'list', 'itemsList']) if (it[k]) Object.values(it[k]).forEach(add);
        return out;
    }
    function itemById(id) {
        /* Einzelner Gegenstand (auch Ladenartikel): bekannte Wege, sonst alle Sammlungen der Engine absuchen. */
        id = String(id);
        const e = E(), it = e.items;
        const hit = allItems().find(d => String(d.id) === id);
        if (hit) return hit;
        try { if (it && typeof it.getItemById === 'function') { const x = it.getItemById(+id); if (x) return x.d || x; } } catch (er) {}
        for (const src of [it, e.shop]) {
            if (!src) continue;
            for (const v of Object.values(src)) {
                const vals = v instanceof Map ? [...v.values()] : v && typeof v === 'object' ? Object.values(v) : [];
                for (const x of vals) { const d = x && (x.d || x); if (d && String(d.id) === id && d.name) return d; }
            }
        }
        return null;
    }
    function shopEntries() {
        /* Artikel im offenen Laden: [{id, name, el, stack}] – Name aus der Engine, notfalls aus dem Tooltip-Attribut. */
        const g = shopOpen();
        if (!g) return [];
        return [...g.querySelectorAll('.item')].filter(el => el.offsetWidth).map(el => {
            const id = ([...el.classList].find(c => /^item-id-\d+$/.test(c)) || '').replace('item-id-', '');
            const d = id ? itemById(id) : null;
            const tip = (el.getAttribute('tip') || el.getAttribute('data-tip') || '').replace(/<[^>]+>/g, ' ').trim();
            const amt = +((el.querySelector('.amount, [class*="amount"]') || {}).textContent || 0) || +(d && parseStat(d.stat).amount) || 1;
            return { id, name: (d && d.name) || tip.split('  ')[0] || '', el, stack: amt };
        }).filter(x => x.name);
    }
    function nearNpcName() {                       // NPC direkt neben dem Helden (der Händler, bei dem der Laden offen ist)
        const [hx, hy] = heroXY();
        const n = npcList().filter(d => Math.abs(d.x - hx) <= 2 && Math.abs(d.y - hy) <= 2)
            .sort((a, b) => (Math.abs(a.x - hx) + Math.abs(a.y - hy)) - (Math.abs(b.x - hx) + Math.abs(b.y - hy)))[0];
        return n ? n.nick : '';
    }
    const bag = () => allItems().filter(d => (d.loc === 'g' || !d.loc) && !(+d.st > 0));
    const worn = () => allItems().filter(d => (d.loc === 'g' || !d.loc) && +d.st > 0);
    const findItem = (list, name) => { const q = fold(name); return list.find(d => fold(d.name) === q) || list.find(d => fold(d.name).includes(q)); };
    /* Verkaufen: nur Ausrüstung aus der Tasche (Waffen, Rüstung, Schmuck, Talismane – Klassen 1–14, 22),
       nie angelegte Sachen, Tränke, Quest-, Schlüssel- oder Verbrauchsgegenstände. Seltenheit aus dem Stat
       (rarity=… bzw. unique/heroic/legendary); „normal“ behält alles Seltene. */
    const GEAR_CL = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 22]);
    function rarity(d) {
        const p = parseStat(d.stat);
        if (p.rarity) return String(p.rarity);
        return p.legendary ? 'legendary' : p.heroic ? 'heroic' : p.upgraded ? 'upgraded' : p.unique ? 'unique' : p.artefact ? 'artefact' : 'common';
    }
    const SELL = {
        quick123: { label: 'Schnellverkauf: Taschen 1, 2 und 3', bags: [1, 2, 3] },
        quick12:  { label: 'Schnellverkauf: Taschen 1 und 2', bags: [1, 2] },
        quick1:   { label: 'Schnellverkauf: nur Tasche 1', bags: [1] },
        gear:    { label: 'normale Ausrüstung', ok: d => rarity(d) === 'common' },
        gearuni: { label: 'Ausrüstung bis Unikat', ok: d => ['common', 'unique'].includes(rarity(d)) },
        gearall: { label: 'alle Ausrüstung außer legendär', ok: d => !['legendary', 'artefact'].includes(rarity(d)) }
    };
    function sellList(what) {
        if (SELL[what] && SELL[what].bags) return [];
        const rule = (SELL[what] || SELL.gear).ok;
        return bag().filter(d => GEAR_CL.has(+d.cl) && !isPotion(d) && !parseStat(d.stat).quest && !parseStat(d.stat).soulbound && rule(d));
    }
    function isPotion(d) { const s = parseStat(d.stat); return !!(s.leczy || s.fullheal || s.perheal); }
    function potionCount() { return bag().filter(isPotion).reduce((n, d) => n + (+parseStat(d.stat).amount || 1), 0); }
    function hpPct() { const w = (E().hero.d || {}).warrior_stats || {}; return w.maxhp ? w.hp / w.maxhp * 100 : 100; }
    function npcList() {
        return E().npcs.getDrawableList().map(n => n.d).filter(d => d && d.type !== 2 && d.type !== 3 && d.nick);
    }
    /* Schnellverkauf: Der Laden hat pro Tasche einen Knopf „alles aus dieser Tasche verkaufen“ und einen
       Knopf zum Bestätigen. Die Klassennamen sind nicht dokumentiert – gefunden wird über Tooltip/Text:
       Verkaufen-Knöpfe enthalten „sprzeda/sell/verkauf“, sortiert von links nach rechts = Tasche 1, 2, 3. */
    const tipOf = el => (el.getAttribute('tip') || el.getAttribute('data-tip') || el.getAttribute('title') || '').replace(/<[^>]+>/g, ' ');
    function shopRoot() {
        const g = shopOpen();
        if (!g) return null;
        // bis zum Ladenfenster hochgehen: das kleinste Element, das auch den „Accept“-Knopf enthält
        // (nicht weiter – sonst kämen die Taschen-Zähler rechts im Inventar mit hinein)
        let r = g;
        for (let k = 0; k < 12 && r.parentElement && r.parentElement !== document.body; k++) {
            r = r.parentElement;
            if (/(^|\n)\s*(accept|akceptuj|zaakceptuj|akzeptieren)\s*($|\n)/i.test(r.innerText || '')) break;
        }
        return r;
    }
    function shopButtons() {
        const r = shopRoot();
        if (!r) return { sell: [], bag: {}, accept: null, all: [] };
        const vis = el => el.offsetWidth > 0 && el.offsetHeight > 0;
        const cand = [...r.querySelectorAll('[tip], [data-tip], [title], button, .button, [class*="btn"], [class*="button"]')]
            .filter(el => vis(el) && !el.closest('.shop-items') && !el.closest('#mba'));
        const label = el => (tipOf(el) + ' ' + (el.innerText || '') + ' ' + (el.className || '')).toLowerCase();
        const sell = cand.filter(el => /sprzeda|sell|verkauf/.test(label(el)) && !/\bkup|\bbuy/.test(tipOf(el).toLowerCase()))
            .filter((el, i, a) => !a.some(o => o !== el && o.contains(el)))          // innerstes Element
            .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left || a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const accept = [...document.querySelectorAll('.finalize-button .button')].find(vis) || cand.find(el => /^(akceptuj|zaakceptuj|accept|finali[sz]e|potwierd|confirm|ok|akzept)/.test((el.innerText || tipOf(el)).trim().toLowerCase()))
            || cand.find(el => /accept|finali|confirm/.test(String(el.className).toLowerCase()));
        // Taschen-Knöpfe: im Spiel .great-merchamp .grab-bag-N; sonst kleine sichtbare Elemente mit genau „1“, „2“, „3“
        const bag = {};
        for (const el of document.querySelectorAll('.great-merchamp [class*="grab-bag-"]')) {
            const m = String(el.className).match(/grab-bag-(\d+)/);
            if (m && vis(el)) bag[m[1]] = el;
        }
        for (const el of r.querySelectorAll('*')) {
            if (!vis(el) || el.closest('.shop-items') || el.closest('.item') || el.closest('#mba')) continue;
            const t = (el.innerText || '').trim();
            if (!/^[1-9]$/.test(t) || el.offsetWidth > 60) continue;
            if ([...el.children].some(c => (c.innerText || '').trim() === t)) continue;   // innerstes Element mit der Zahl
            if (!bag[t]) bag[t] = el.closest('button, .button, [class*="btn"], [class*="button"], [tip]') || el;
        }
        // Tooltip-Treffer füllen fehlende Taschen auf (von links nach rechts)
        sell.forEach((el, i) => { if (!bag[i + 1]) bag[i + 1] = el; });
        return { sell, bag, accept, all: cand };
    }
    function bagItemEl(id) {                       // Gegenstand in der Tasche (nicht im Laden, nicht angelegt)
        return [...document.querySelectorAll('.item-id-' + id)].find(el => el.offsetWidth && !el.closest('.shop-items') && !el.closest('#mba')) || null;
    }
    function basketCount() {                       // Gegenstände im Kauf-/Verkaufskorb des Ladens
        const sellGrid = document.querySelector('.sell-items');
        if (sellGrid) return [...sellGrid.querySelectorAll('.item')].filter(el => el.offsetWidth).length;
        const r = shopRoot();
        return r ? [...r.querySelectorAll('.item')].filter(el => el.offsetWidth && !el.closest('.shop-items')).length : 0;
    }
    function press(el) {                           // wie ein echter Klick (das Spiel hört teils auf mousedown)
        const r = el.getBoundingClientRect(), o = { bubbles: true, cancelable: true, view: W, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
        for (const t of ['mouseover', 'mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o));
    }
    function closeShop() {
        const g = shopOpen();
        if (!g) return false;
        const w = g.closest('.c-window') || shopRoot();
        const x = w && (w.querySelector('.close-button') || [...w.querySelectorAll('[class*="close"]')].find(el => el.offsetWidth));
        if (x) { press(x); return true; }
        return false;
    }
    function confirmPopup() {                      // „Czy na pewno …?“ → Ja
        const b = [...document.querySelectorAll('.alert-window button, .mAlert button, [class*="confirm"] button, [class*="alert"] .button, .question-wnd button')]
            .find(el => el.offsetWidth && /^(tak|yes|ok|ja|potwierd)/i.test((el.innerText || '').trim()));
        if (b) { press(b); return true; }
        return false;
    }
    function dialogOpen() { return document.querySelector('.dialogue-window.is-open'); }
    function shopOpen() { const g = document.querySelector('.shop-items'); return g && g.offsetWidth ? g : null; }

    // ein Schritt: 'ok' (fertig) | 'run' (noch dran) | Fehlertext
    function doStep(s, st) {
        const now = performance.now(), age = now - st.t0;
        switch (s.t) {
            case 'equip': case 'use': {
                if (!st.sent) {
                    const d = findItem(bag(), s.name);
                    if (!d) return s.t === 'equip' && findItem(worn(), s.name) ? 'ok' : `„${s.name}“ nicht in der Tasche`;
                    st.id = d.id; send('moveitem&st=1&id=' + d.id); st.sent = now;
                    log((s.t === 'equip' ? 'Rüste aus: ' : 'Benutze: ') + d.name);
                    return 'run';
                }
                if (s.t === 'equip' && worn().some(d => d.id === st.id)) return 'ok';
                return now - st.sent > 1500 ? 'ok' : 'run';
            }
            case 'fill': {
                if (hpPct() >= 99.5) return 'ok';
                if (st.sent && now - st.sent < 1200) return 'run';
                const w = (E().hero.d || {}).warrior_stats || {}, miss = (w.maxhp || 0) - (w.hp || 0);
                const pots = bag().filter(isPotion);
                if (!pots.length) return 'keine Heiltränke mehr';
                // Trank, der am wenigsten überheilt (Vollheilung zuletzt)
                const heal = d => { const p = parseStat(d.stat); return p.fullheal ? 1e9 : p.perheal ? w.maxhp * p.perheal / 100 : +p.leczy; };
                const d = pots.sort((a, b) => Math.abs(heal(a) - miss) - Math.abs(heal(b) - miss))[0];
                send('moveitem&st=1&id=' + d.id); st.sent = now; st.n = (st.n || 0) + 1;
                return st.n > 25 ? 'Heilen bricht ab (25 Tränke)' : 'run';
            }
            case 'go': {
                if (shopOpen()) { closeShop(); st.t0 = now; return 'run'; }
                const ids = findMaps(s.map);
                if (!ids.length) return `Karte „${s.map}“ unbekannt`;
                const r = travelStep([ids[0]], wname(ids[0]));
                return r === 'da' ? 'ok' : r === 'kein Weg' ? 'kein Weg nach ' + s.map : 'run';
            }
            case 'back': case 'xp': {
                if (shopOpen()) { closeShop(); return 'run'; }
                if (!st.goal) {
                    if (s.t === 'back') {
                        const home = chainHome || cfg.lastHome;
                        if (!home) return 'kein Jagdort gemerkt';
                        if (home.route && cfg.routes[home.route]) cfg.route = home.route;
                        Object.assign(cfg, home.lvl);
                        const rt = cfg.routes[cfg.route];
                        st.goal = rt ? routeIds(rt) : [home.map];
                        if (!st.goal.length) st.goal = [home.map];
                        log('Zurück ' + (rt ? 'zur Route „' + cfg.route + '“' : 'nach ' + (home.name || wname(home.map))));
                    } else {
                        const l = heroLvl(), lo = +s.min || Math.max(1, l - 5), hi = +s.max || (s.min ? lo : l + 3);
                        cfg.lvlMin = lo; cfg.lvlMax = Math.max(lo, hi); cfg.lvlOn = true; cfg.route = ''; cfg.mode = 'xp';
                        const o = xpMaps(cfg.lvlMin, cfg.lvlMax, 1)[0];
                        if (!o) return `kein XP-Ort für Level ${cfg.lvlMin}–${cfg.lvlMax}`;
                        st.goal = [o.id]; log('XP-Ort: ' + wname(o.id) + ' (Lvl ' + cfg.lvlMin + '–' + cfg.lvlMax + ')');
                    }
                    xpKey = '';
                }
                const r = travelStep(st.goal, wname(st.goal[0]));
                if (r === 'kein Weg') return 'kein Weg nach ' + wname(st.goal[0]);
                if (r !== 'da') return 'run';
                cfg.on = true; if (!sess.t0) startSession();
                return 'ok';
            }
            case 'npc': {
                const q = fold(s.name), n = npcList().find(d => fold(d.nick) === q) || npcList().find(d => fold(d.nick).includes(q));
                if (!n) return `NPC „${s.name}“ nicht auf dieser Karte`;
                const [hx, hy] = heroXY();
                if (Math.abs(n.x - hx) > 1 || Math.abs(n.y - hy) > 1) {
                    if (age > 60000) return `${n.nick} nicht erreicht`;
                    walkTo(n.x, n.y + 1, n.nick); return 'run';
                }
                if (!st.talk) { send('talk&id=' + n.id); st.talk = now; log('Spreche mit ' + n.nick); return 'run'; }
                if (shopOpen()) return 'ok';                               // Laden offen → Dialog ist zu, Schritt erledigt
                if (!s.say) return now - st.talk > 1200 ? 'ok' : 'run';
                const d = dialogOpen();
                if (!d) return st.said ? (now - st.said > 2500 ? 'ok' : 'run') : now - st.talk > 4000 ? 'Dialog ging nicht auf' : 'run';
                if (st.said && now - st.said < 1200) return 'run';
                const want = fold(s.say);
                const li = [...d.querySelectorAll('.dialogue-window-answer')].find(x => fold(x.textContent).includes(want));
                if (li) { li.click(); st.said = now; st.clicks = (st.clicks || 0) + 1; log('Antwort: ' + li.textContent.trim().slice(0, 40)); }
                if (shopOpen() || (st.said && !li)) return 'ok';          // Shop offen oder Gespräch durch
                return (st.clicks || 0) > 4 || now - st.talk > 15000 ? `Antwort „${s.say}“ nicht gefunden` : 'run';
            }
            case 'sell': {
                /* Wie von Hand: Gegenstände in den Verkaufskorb legen (Taschen-Knöpfe 1/2/3 beim „Sell“-Feld oder
                   einzelne Gegenstände in der Tasche anklicken), dann „Accept“, dann eine Rückfrage bejahen. */
                if (!shopOpen()) return age > 4000 ? 'kein Laden offen (vorher NPC ansprechen)' : 'run';
                if (st.wait && now < st.wait) return 'run';
                const qs = SELL[s.what] && SELL[s.what].bags, sb = shopButtons();
                if (!st.filled) {
                    if (qs) {
                        /* Ein Druck auf „1“ legt nur einen Teil der Tasche in den Korb. Darum pro Tasche:
                           Knopf → Accept → Rückfrage → nachzählen, und wiederholen, solange danach weniger
                           Gegenstände in den Taschen sind. Bleibt die Zahl gleich, ist die Tasche fertig. */
                        st.k = st.k || 0; st.ph = st.ph || 'press'; st.round = st.round || 0; st.sold = st.sold || 0;
                        if (st.k >= qs.length) { log('Schnellverkauf fertig: ' + st.sold + ' Gegenstände verkauft'); return 'ok'; }
                        const bn = qs[st.k];
                        if (st.ph === 'press') {
                            const btn = sb.bag[bn];
                            if (!btn) return `Knopf für Tasche ${bn} nicht gefunden – „Spieldaten prüfen“ bei offenem Laden`;
                            st.before = bag().length; st.re = 0;
                            press(btn); st.ph = 'accept'; st.wait = now + 450;
                            return 'run';
                        }
                        if (st.ph === 'accept') {
                            if (!sb.accept) return '„Accept“-Knopf im Laden nicht gefunden';
                            press(sb.accept); st.ph = 'confirm'; st.wait = now + 600;
                            return 'run';
                        }
                        if (st.ph === 'confirm') { confirmPopup(); st.ph = 'check'; st.wait = now + 900; return 'run'; }
                        const diff = st.before - bag().length;
                        if (diff <= 0 && st.re < 2) { st.re++; st.wait = now + 700; return 'run'; }   // Tasche evtl. noch nicht aktualisiert
                        if (diff > 0 && ++st.round < 25) {
                            st.sold += diff; log(`Tasche ${bn}: ${diff} verkauft – nochmal`); st.ph = 'press';
                            return 'run';
                        }
                        log(`Tasche ${bn} fertig`);
                        st.k++; st.round = 0; st.ph = 'press';
                        return 'run';
                    } else {
                        if (!st.list) {
                            st.list = sellList(s.what).map(d => d.id); st.k = 0; st.ok = 0;
                            if (!st.list.length) { log('Nichts zu verkaufen'); return 'ok'; }
                            log('Lege ' + st.list.length + ' Gegenstände in den Verkauf');
                        }
                        if (st.k < st.list.length) {
                            const el = bagItemEl(st.list[st.k]), before = basketCount();
                            if (el) { press(el); st.check = before; }
                            st.k++; st.wait = now + 160;
                            return 'run';
                        }
                    }
                    st.filled = now; st.wait = now + 400;
                    return 'run';
                }
                if (!st.acc) {
                    if (!qs && basketCount() === 0) return 'Gegenstände kamen nicht in den Verkaufskorb (Klick auf Tasche wirkt nicht) – Schnellverkauf nutzen';
                    if (!sb.accept) return '„Accept“-Knopf im Laden nicht gefunden';
                    press(sb.accept); st.acc = now; st.wait = now + 700; log('Verkauf bestätigt');
                    return 'run';
                }
                confirmPopup();
                return now - st.acc > 1500 ? 'ok' : 'run';
            }
            case 'buy': {
                /* Wie von Hand: Artikel im Laden anklicken – jeder Klick legt einen Stapel (z. B. 5 Tränke) in den
                   Kaufkorb –, so oft bis die Anzahl erreicht ist, dann „Accept“ und eine Rückfrage bejahen. */
                if (!shopOpen()) return age > 4000 ? 'kein Laden offen (vorher NPC ansprechen)' : 'run';
                if (st.wait && now < st.wait) return 'run';
                if (!st.it) {
                    const list = shopEntries(), q = fold(s.name);
                    const hit = list.find(x => fold(x.name) === q) || list.find(x => fold(x.name).includes(q));
                    if (!hit) return `„${s.name}“ gibt es in diesem Laden nicht` + (list.length ? '' : ' (Artikel nicht lesbar)');
                    const want = Math.max(1, +s.n || 1);
                    st.it = hit; st.clicks = Math.max(1, Math.ceil(want / hit.stack)); st.k = 0; st.before = potionCount();
                    log(`Kaufe ${want}× ${hit.name} (${st.clicks} Klicks à ${hit.stack})`);
                }
                if (st.k < st.clicks) {
                    const el = shopEntries().find(x => x.id === st.it.id) || st.it;
                    press(el.el); st.k++; st.wait = now + 180;
                    return 'run';
                }
                if (!st.acc) {
                    const sb = shopButtons();
                    if (!sb.accept) return '„Accept“-Knopf im Laden nicht gefunden';
                    press(sb.accept); st.acc = now; st.wait = now + 600;
                    return 'run';
                }
                confirmPopup();
                if (now - st.acc < 1500) return 'run';
                if (isPotion(st.it) || /mikstur|potion|eliksir|heal/i.test(st.it.name)) log('Heiltränke jetzt: ' + potionCount() + ' (vorher ' + st.before + ')');
                return 'ok';
            }
            case 'close': {
                if (!shopOpen()) return 'ok';
                if (!st.sent) { if (!closeShop()) return 'Schließen-Knopf des Ladens nicht gefunden'; st.sent = now; log('Laden geschlossen'); }
                return !shopOpen() ? 'ok' : now - st.sent > 2000 ? 'Laden ging nicht zu' : 'run';
            }
            case 'wait': return age >= (+s.s || 1) * 1000 ? 'ok' : 'run';
            case 'hunt': cfg.on = true; if (!sess.t0) startSession(); return 'ok';
            case 'stop': cfg.on = false; return 'ok';
        }
        return 'unbekannter Schritt';
    }

    let learnAt = 0, talkNpc = '';
    const answerOf = li => ((li.querySelector('.answer-text') || li).textContent || '').replace(/^\s*\d+\.\s*/, '').trim();
    let convPath = [], convWho = '', convLastOpen = 0;
    document.addEventListener('click', ev => {             // deine Klicks im Dialog = Weg zum Teleport-Menü
        const li = ev.target && ev.target.closest && ev.target.closest('.dialogue-window-answer');
        if (li && ev.isTrusted) convPath.push(answerOf(li));
    }, true);
    let townIdx = null;
    function mapInText(t) {
        /* Kartenname, der im Antworttext vorkommt (längster Treffer, mind. 4 Zeichen, als ganzes Wort). */
        if (!world) return null;
        if (!townIdx) {
            townIdx = [];
            for (const id in world) { const n = fold(world[id][2]); if (n.length >= 4) townIdx.push([n, +id]); }
            for (const id in cfg.names) { const n = fold(cfg.names[id]); if (n.length >= 4) townIdx.push([n, +id]); }
            townIdx.sort((a, b) => b[0].length - a[0].length);
        }
        const f = ' ' + fold(t).replace(/[^\p{L}\p{N} -]/gu, ' ') + ' ';
        for (const [n, id] of townIdx) if (f.includes(' ' + n + ' ')) return id;
        return null;
    }
    function learnTeleport(d, who) {
        /* Ein Dialog, in dem mindestens 2 Antworten verschiedene Karten nennen, ist ein Teleport-Menü. */
        const ans = [...d.querySelectorAll('.dialogue-window-answer')].map(answerOf);
        const hits = ans.map(a => [a, mapInText(a)]).filter(h => h[1] && h[1] !== mapId());
        if (new Set(hits.map(h => h[1])).size < 2) return false;
        const n = npcList().filter(x => x.nick === who).sort((a, b) => Math.abs(a.x - heroXY()[0]) + Math.abs(a.y - heroXY()[1]) - Math.abs(b.x - heroXY()[0]) - Math.abs(b.y - heroXY()[1]))[0];
        if (!n) return false;
        cfg.tele = cfg.tele || {};
        const m = cfg.tele[mapId()] = cfg.tele[mapId()] || {};
        const e = m[who] = m[who] || { x: n.x, y: n.y, to: {} };
        let added = 0;
        for (const [a, id] of hits) if (!e.to[id]) { e.to[id] = { path: convPath.slice(), text: a }; added++; }
        if (added) { log(`Teleporter gelernt: ${who} (${mapName()}) → ${hits.map(h => wname(h[1])).join(', ')}`); travelCache = null; lastStatic = ''; }
        return added > 0;
    }
    function learnWorldBits() {
        /* Für die Auswahllisten der Abläufe: was der Spieler gesehen hat, wird gemerkt (1×/s, nur bei Änderung gespeichert). */
        const now = performance.now();
        if (now - learnAt < 1000) return;
        learnAt = now;
        let ch = false;
        cfg.npcs = cfg.npcs || {}; cfg.dlg = cfg.dlg || {}; cfg.shops = cfg.shops || {};
        const id = mapId(), here = npcList().map(d => d.nick).filter(n => n && !/^\d+$/.test(n));
        const old = cfg.npcs[id] || [], add = here.filter(n => !old.includes(n));
        if (add.length) { cfg.npcs[id] = old.concat(add).slice(0, 40); ch = true; }
        const d = dialogOpen();
        if (!d && now - convLastOpen > 2500) { convPath = []; convWho = ''; }
        if (d) {
            const who = ((d.querySelector('.h_content') || {}).textContent || talkNpc || '').trim();
            convLastOpen = now;
            if (who && who !== convWho) { convWho = who; convPath = []; }
            if (who && learnTeleport(d, who)) ch = true;
            if (who) {
                talkNpc = who;
                const ans = [...d.querySelectorAll('.dialogue-window-answer')].map(x => x.textContent.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean);
                const o = cfg.dlg[who] || [], na = ans.filter(a => !o.includes(a));
                if (na.length) { cfg.dlg[who] = o.concat(na).slice(-30); ch = true; }
            }
        }
        const sh = shopOpen(), who = sh ? (nearNpcName() || talkNpc) : '';
        if (sh && who) {
            const names = Array.from(new Set(shopEntries().map(x => x.name)));
            const o = cfg.shops[who] || [], nn = names.filter(n => !o.includes(n));
            if (nn.length) { cfg.shops[who] = o.concat(nn).slice(0, 80); ch = true; lastStatic = ''; }
        }
        if (ch) save();
    }
    let chainSt = null, chainHome = null, lastCond = {};
    function startRule(r, why) {
        if (!r.steps.length) return;
        chainHome = cfg.lastHome || { map: mapId(), name: mapName(), route: cfg.route || '', lvl: { lvlMin: cfg.lvlMin, lvlMax: cfg.lvlMax, lvlOn: cfg.lvlOn } };
        cfg.chain = { rid: r.id, i: 0, wasOn: cfg.on }; chainSt = { t0: performance.now() };
        cfg.travel = null; goal = null; lastPlan = null;
        log('▸ Ablauf „' + whenText(r.when) + '“' + (why ? ' (' + why + ')' : ''));
        save(); lastStatic = '';
    }
    function endChain(msg) {
        const r = cfg.rules.find(x => x.id === cfg.chain.rid);
        if (r && COND[r.when.t] && COND[r.when.t].once && !msg) r.done = true;
        if (shopOpen()) closeShop();
        log(msg ? '✕ Ablauf abgebrochen: ' + msg : '✓ Ablauf fertig');
        cfg.chain = null; chainSt = null; goal = null; lastPlan = null; travelCache = null;
        save(); lastStatic = '';
    }
    function runChain() {
        const r = cfg.rules.find(x => x.id === cfg.chain.rid);
        if (!r) { cfg.chain = null; return; }
        const s = r.steps[cfg.chain.i];
        if (!s) return endChain();
        if (!chainSt) chainSt = { t0: performance.now() };
        let res;
        try { res = doStep(s, chainSt); } catch (e) { res = e.message; }
        if (res === 'run') return;
        if (res !== 'ok') return endChain('Schritt ' + (cfg.chain.i + 1) + ': ' + res);
        if ((s.t === 'sell' || s.t === 'buy') && s.closeAfter && shopOpen()) { closeShop(); log('Laden geschlossen'); }
        cfg.chain.i++; chainSt = { t0: performance.now() }; busyUntil = performance.now() + pause();
        save(); lastStatic = '';
    }
    function checkRules(justRevived) {
        /* Auslöser prüfen (nur bei laufendem Bot, außerhalb von Kämpfen, kein anderer Ablauf aktiv). */
        for (const r of cfg.rules || []) {
            const c = COND[r.when.t];
            if (!r.on || !c || !r.steps.length || (c.once && r.done)) continue;
            const now = r.when.t === 'death' ? !!justRevived : !!c.test(+r.when.n);
            const was = lastCond[r.id];
            lastCond[r.id] = now;
            if (now && !was) { startRule(r, whenText(r.when)); return true; }
        }
        return false;
    }

    // ── E2-Jagd: einen Elite-II-Boss abpassen ───────────────────
    /* Ablauf: zur Karte reisen → neben den Spawnpunkt stellen → warten → angreifen, sobald die E2 da ist.
       Verschwindet sie (Kampf ohne Fenster, wie bei allen Mobs), gilt sie als tot und der Respawn-Timer läuft
       ab diesem Moment – auch wenn ein anderer Spieler sie erlegt hat. Wann sie wieder erscheint, ist pro E2
       einstellbar (von–bis); gemessene Zeiten werden angezeigt, damit man den Bereich nachstellen kann.
       Spiel verlassen: der Bot geht vom Spawnpunkt offline (Seite wechselt zur Startseite) und erinnert
       vor dem Respawn. Wieder einloggen tut er NICHT selbst (feste Regel: nie für den Nutzer einloggen). */
    let e2rt = null, e2Leaving = false, e2NoWay = 0, e2Remind = 0;
    const e2Key = (nick, map) => nick + '|' + map;
    const e2Cur = () => cfg.e2.list[cfg.e2.sel] || null;
    let e2WorldCache = null;
    function e2World() {
        /* Alle E2 der Weltkarte: Icon-Ordner „e2/“ (margoworld), mit Spawnpunkt. */
        if (!world) return [];
        if (e2WorldCache && e2WorldCache.n === worldN()) return e2WorldCache.l;
        const l = [];
        for (const id in world) for (const m of world[id][4]) {
            if (!m[4] || !String(m[4]).startsWith('e2/')) continue;
            const p = Array.isArray(m[3]) && m[3].length >= 2 ? m[3] : null;
            l.push({ nick: m[0], lvl: m[1], map: +id, x: p ? p[0] : null, y: p ? p[1] : null });
        }
        l.sort((a, b) => a.lvl - b.lvl);
        e2WorldCache = { n: worldN(), l };
        return l;
    }
    /* Richtwert für den Respawn (Minuten): t = 0,7 + 0,18·lvl − 0,00045·lvl², gilt laut Spieler-Wiki für Mobs und
       Elity; deckt sich mit den Messungen auf margoatlas.pl für E2 (Lvl 23 ≈ 4,5 min, 57 ≈ 9,5, 105 ≈ 15, 160 ≈ 18).
       Ab Lvl 200 bleibt es beim Höchstwert (~18,7 min, margoatlas: ab Lvl 183 „ok. 19 min“). Werte gelten für
       Welten mit normalem Tempo – auf schnelleren Welten (z. B. Respawn ×3) durch das Tempo teilen. */
    const e2Resp = lvl => { const l = Math.min(Math.max(1, +lvl || 1), 200); return (0.7 + 0.18 * l - 0.00045 * l * l) / Math.max(1, +cfg.e2.speed || 1); };
    function e2AutoResp(t) {                       // Fenster ±1 min um den Richtwert („ok. X min“ ist gerundet und streut)
        const r = e2Resp(t.lvl);
        t.respMin = Math.max(1, Math.floor(r - 1)); t.respMax = Math.max(t.respMin + 1, Math.ceil(r + 1)); t.respAuto = true;
    }
    function e2Add(o) {
        const k = e2Key(o.nick, o.map);
        if (!cfg.e2.list[k]) cfg.e2.list[k] = { nick: o.nick, lvl: o.lvl || 0, map: +o.map, x: o.x ?? null, y: o.y ?? null,
                                                respMin: 15, respMax: 30, lastKill: 0, by: '', kills: 0, meas: [] };
        if (!cfg.e2.list[k].lastKill && cfg.e2.list[k].respAuto !== false) e2AutoResp(cfg.e2.list[k]);
        cfg.e2.sel = k;
        log(`E2 gemerkt: ${o.nick} (${o.lvl || '?'}) auf ${wname(+o.map)}`);
    }
    function e2Window(t) {
        if (!t || !t.lastKill) return null;
        return { start: t.lastKill + t.respMin * 60000, end: t.lastKill + t.respMax * 60000 };
    }
    const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? Math.floor(s / 3600) + ' h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ' min'
                                                                       : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    const clock = t => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    function e2Spot(t) {
        /* Warteplatz: zufälliges begehbares, erreichbares Feld höchstens 2 Felder vom Spawnpunkt (nicht darauf – dort
           erscheint die E2). Nicht immer dasselbe Feld: Der Platz wird nach jedem Kampf neu ausgelost und bis dahin
           behalten (sonst würde der Held hin und her laufen). */
        if (e2rt && e2rt.spot && e2rt.spotFor === t.x + ',' + t.y) return e2rt.spot;
        const [hx, hy] = heroXY(), d = walls ? bfs(hx, hy) : null, opts = [];
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const x = t.x + dx, y = t.y + dy;
            if ((!dx && !dy) || x < 0 || y < 0 || x >= MW || y >= MH) continue;
            if (walls && (walls[y * MW + x] || d[y * MW + x] < 0)) continue;
            opts.push([x, y]);
        }
        const spot = opts.length ? opts[Math.floor(Math.random() * opts.length)] : [t.x, t.y];
        if (e2rt) { e2rt.spot = spot; e2rt.spotFor = t.x + ',' + t.y; }
        return spot;
    }
    function e2Text() {
        /* Statuszeile für Panel und Kopfbereich. */
        const t = e2Cur();
        if (!t) return 'keine E2 gewählt';
        const w = e2Window(t), now = Date.now();
        if (e2rt && e2rt.alive) return `${t.nick} ist da – greife an`;
        if (mapId() !== t.map) return `Reise nach ${wname(t.map)}` + (lastTravel ? ` · noch ${lastTravel.left} ${lastTravel.left === 1 ? 'Karte' : 'Karten'}` : '');
        if (!w) return `warte am Spawnpunkt · Respawn unbekannt`;
        if (now < w.start) return `Respawn in ${mmss(w.start - now)} (bis ${clock(w.end)})`;
        if (now < w.end) return `Respawn jederzeit · Fenster bis ${clock(w.end)}`;
        return `überfällig seit ${mmss(now - w.end)} – warte weiter`;
    }
    function e2Find(t) {
        /* E2 auf der Karte suchen. Erst nach Namen (auch dem im Spiel gelernten), ohne Typ-Filter – falls das Spiel
           die E2 anders einordnet als normale Mobs. Sonst ein Mob mit genau ihrem Level nah am Spawnpunkt: der Name
           auf margoworld kann vom Namen im Spiel abweichen. */
        const L = E().npcs.getDrawableList().map(n => n.d).filter(d => d && d.nick && d.x != null);
        const names = [fold(t.nick), fold(t.gameNick || '')].filter(Boolean);
        let d = L.find(x => names.includes(fold(x.nick))), how = 'Name';
        if (!d && t.x != null && t.lvl) {
            d = L.filter(x => (+x.lvl || 0) === +t.lvl && Math.max(Math.abs(x.x - t.x), Math.abs(x.y - t.y)) <= 12)
                 .sort((a, b) => Math.max(Math.abs(a.x - t.x), Math.abs(a.y - t.y)) - Math.max(Math.abs(b.x - t.x), Math.abs(b.y - t.y)))[0];
            how = 'Level';
        }
        return d ? { id: d.id, nick: d.nick, lvl: +d.lvl || 0, x: d.x, y: d.y, how } : null;
    }
    function e2Seen(t) {
        /* Für die Anzeige: Mobs nah am Spawnpunkt (bzw. am Helden), damit man sieht, was der Bot erkennt. */
        const [hx, hy] = heroXY(), cx = t && t.x != null ? t.x : hx, cy = t && t.x != null ? t.y : hy;
        return E().npcs.getDrawableList().map(n => n.d).filter(d => d && d.nick && d.x != null && (d.type === 2 || d.type === 3 || +d.lvl > 0))
            .map(d => [d, Math.max(Math.abs(d.x - cx), Math.abs(d.y - cy))]).sort((a, b) => a[1] - b[1]).slice(0, 5)
            .map(([d, r]) => `${d.nick} (${d.lvl || '?'}, ${r} Felder)`);
    }
    function e2Stop(why) { cfg.e2.on = false; cfg.e2.offline = false; cfg.e2.wakeAt = 0; e2rt = null; goal = null; log('E2-Jagd gestoppt' + (why ? ' (' + why + ')' : '')); save(); lastStatic = ''; }
    function e2Step() {
        const E2 = cfg.e2, t = e2Cur(), now = Date.now();
        if (!t) return e2Stop('keine E2 gewählt');
        if (e2Leaving) return;                            // Seite wechselt gleich – Offline-Merker nicht anrühren
        if (E2.offline) {
            /* Schon kurz nach dem Verlassen wieder im Spiel, ohne dass der Bot zurück wollte: Die Startseite hat
               eingeloggte Spieler direkt ins Spiel geleitet (so z. B. auf margonem.com). Sonst verlässt der Bot sofort
               wieder → Endlos-Neuladen. Darum bis zum Respawn online bleiben. */
            if (!E2.returned && now < E2.wakeAt && now - (E2.leftAt || 0) < 90000) {
                E2.noLeaveUntil = E2.wakeAt + 30 * 60000;
                log(`E2: wieder im Spiel statt auf ${E2.leaveUrl || 'der Startseite'} – bleibe diesmal online. Seitenfolge: ${(E2.trace || []).join(' → ') || '–'}`);
            } else log('E2: wieder im Spiel – weiter mit ' + t.nick);
            E2.offline = false; E2.wakeAt = 0; E2.returned = false; save();
        }
        if (mapId() !== t.map) {
            e2rt = null;
            const r = world ? travelStep([t.map], wname(t.map)) : 'kein Weg';
            if (r === 'kein Weg' && performance.now() - mapAt > 5000 && now - e2NoWay > 60000) {
                e2NoWay = now;
                log(`E2: kein Weg nach ${wname(t.map)} bekannt – bitte selbst hinlaufen, der Bot wartet dann dort` + (world ? '' : ' (Weltkarte fehlt)'));
            }
            return;
        }
        lastTravel = null;
        if (!e2rt || e2rt.mapAt !== mapAt) e2rt = { mapAt, since: now, alive: false, atk: 0, tries: 0 };
        const [hx, hy] = heroXY();
        const m = e2Find(t);
        if (m && m.how === 'Level' && fold(m.nick) !== fold(t.gameNick || '')) {
            t.gameNick = m.nick; save();
            log(`E2: im Spiel heißt sie „${m.nick}“ (Lvl ${m.lvl}) – erkannt am Level, Name gemerkt`);
        }
        if (m) {
            e2rt.patrol = null;
            if (!e2rt.alive) {
                e2rt.alive = true; e2rt.tries = 0;
                // Reaktionszeit: nicht im selben Augenblick losrennen, in dem sie erscheint – ein Mensch braucht ein paar Sekunden
                const ra = Number.isFinite(+E2.reactMin) ? +E2.reactMin : 2, rb = Number.isFinite(+E2.reactMax) ? +E2.reactMax : 6;
                const lo = Math.min(ra, rb), hi = Math.max(ra, rb);
                e2rt.reactAt = now + rnd(lo, hi) * 1000;
                // Respawn messen – nur, wenn der Bot schon vorher hier gewartet hat (sonst ist es nur der Zeitpunkt der Ankunft)
                if (t.lastKill && now - e2rt.since > 60000) {
                    const min = Math.round((now - t.lastKill) / 6000) / 10;
                    t.meas = (t.meas || []).concat([min]).slice(-6);
                    log(`E2: ${t.nick} ist da – Respawn nach ${String(min).replace('.', ',')} min gemessen`);
                } else log(`E2: ${t.nick} ist da`);
                e2Notify(`E2 ${t.nick} ist da`);
                if (t.x == null) { t.x = m.x; t.y = m.y; }
                save(); lastStatic = '';
            }
            e2rt.id = m.id; e2rt.x = m.x; e2rt.y = m.y; e2rt.lastSeen = now;
            if (now < (e2rt.reactAt || 0)) return;            // noch in der Reaktionszeit
            if (Math.abs(m.x - hx) <= 1 && Math.abs(m.y - hy) <= 1) {
                if (now - e2rt.atk < 2500) return;               // letzter Versuch läuft noch
                if (++e2rt.tries > 5 && e2rt.tries % 10) return;   // klappt nicht (anderer kämpft?) → seltener versuchen
                e2rt.atk = now;
                act(() => E().hero.heroAtackRequest(m.id, true), 'Angriff');
                noteAttack(m.id);
                log(`E2: Angriff auf ${t.nick} (${m.lvl})` + (e2rt.tries > 1 ? ' – Versuch ' + e2rt.tries : ''));
                goal = null;
            } else walkTo(m.x, m.y, t.nick);
            return;
        }
        if (e2rt.alive) {
            e2rt.alive = false;
            // Nur als Tod zählen, wenn der Held nah dran war – sonst ist sie bloß außer Sicht (Nebel)
            if (Math.max(Math.abs(hx - e2rt.x), Math.abs(hy - e2rt.y)) <= 12) {
                const mine = now - e2rt.atk < 30000;
                t.lastKill = now; t.by = mine ? 'bot' : 'other';
                e2rt.spot = null;                              // nach dem Kampf neuen Warteplatz auslosen
                if (mine) t.kills = (t.kills || 0) + 1;
                const w = e2Window(t);
                log(`E2: ${t.nick} ${mine ? 'besiegt' : 'von jemand anderem erlegt'} – Respawn ${clock(w.start)}–${clock(w.end)}`);
                save(); lastStatic = '';
            }
        }
        // Warteplatz neben dem Spawnpunkt
        const w0 = e2Window(t);
        if (t.x != null && !e2Patrol(t, w0, hx, hy, now)) {
            const [sx, sy] = e2Spot(t);
            if (hx !== sx || hy !== sy) { walkTo(sx, sy, 'Warteplatz ' + t.nick); return; }
        }
        if (e2rt.patrol) return;
        // Lange Wartezeit → Spiel verlassen, Erinnerung vor dem Respawn
        const w = e2Window(t);
        if (E2.away === 'leave' && w && !inBattle() && now >= (E2.noLeaveUntil || 0)) {
            const lead = rnd(Math.min(E2.remindMin, E2.remindMax), Math.max(E2.remindMin, E2.remindMax)) * 60000;
            const wake = w.start - lead;
            if (wake - now > E2.leaveMin * 60000) {
                e2Leaving = true;
                // Von [server].margonem.pl auf die Hauptseite – dort ist man nicht mehr in der Spielwelt
                E2.wakeAt = wake; E2.offline = true; E2.returned = false; E2.back = location.origin + '/'; E2.leftAt = now; E2.trace = []; save();
                log(`E2: Respawn frühestens ${clock(w.start)} – verlasse das Spiel, ${E2.autoBack ? 'zurück' : 'Erinnerung'} um ${clock(wake)}`);
                const home = e2LeaveUrl();
                setTimeout(() => { location.href = home; }, 1500);
            }
        }
    }
    function e2LeaveUrl() {
        /* Ziel beim Verlassen: eingestellte Adresse, sonst die Startseite der Domain. Nur Seiten auf margonem.pl/.com,
           denn nur dort läuft das Skript weiter und kann zur Rückkehrzeit die Spielseite öffnen. */
        const u = (cfg.e2.leaveUrl || '').trim();
        if (/^https:\/\/([a-z0-9-]+\.)*margonem\.(pl|com)(\/|$)/i.test(u)) return u;
        return /margonem\.com$/.test(location.hostname) ? 'https://www.margonem.com/' : 'https://www.margonem.pl/';
    }
    function e2Patrol(t, w, hx, hy, now) {
        /* Die E2 erscheint 2–10 Felder neben ihrem festen Platz (margoatlas). Auf Karten mit Nebel liefert das Spiel
           nur Mobs in Sichtweite – dann sieht der Bot sie vom Warteplatz aus womöglich nicht. Deshalb: ist das
           Respawn-Fenster offen (oder unbekannt) und seit 20 s nichts zu sehen, eine Runde um den Spawnpunkt laufen.
           Nicht nötig, wenn das Spiel auch weit entfernte Mobs liefert (kein Nebel). Rückgabe: true = läuft gerade. */
        const open = !w || now >= w.start;
        const far = E().npcs.getDrawableList().some(n => n.d && n.d.x != null && Math.max(Math.abs(n.d.x - hx), Math.abs(n.d.y - hy)) > 15);
        if (!open || far || now - (e2rt.lastSeen || e2rt.since) < 20000) { e2rt.patrol = null; return false; }
        let P = e2rt.patrol;
        if (!P) {
            if (e2rt.patrolDone && now - e2rt.patrolDone < 25000) return false;    // nach einer Runde kurz am Warteplatz bleiben
            const field = bfs(hx, hy), pts = [];
            for (const [dx, dy] of [[6, 0], [4, 5], [0, 6], [-4, 5], [-6, 0], [-4, -5], [0, -6], [4, -5]]) {
                const x = t.x + dx, y = t.y + dy;
                if (x < 0 || y < 0 || x >= MW || y >= MH || walls[y * MW + x] || cost(field, x, y) === Infinity) continue;
                pts.push([x, y]);
            }
            if (!pts.length) return false;
            P = e2rt.patrol = { pts, i: 0, at: now };
            log(`E2: ${t.nick} nicht zu sehen – laufe eine Runde um den Spawnpunkt (${pts.length} Punkte)`);
        }
        const [px, py] = P.pts[P.i];
        if (Math.max(Math.abs(px - hx), Math.abs(py - hy)) <= 1 || now - P.at > 10000) {
            P.i++; P.at = now;
            if (P.i >= P.pts.length) { e2rt.patrol = null; e2rt.patrolDone = now; return false; }
        }
        walkTo(P.pts[P.i][0], P.pts[P.i][1], 'Runde um ' + t.nick);
        return true;
    }
    function e2Away() {
        /* Läuft auf Seiten ohne Spiel (Startseite nach dem Verlassen): Erinnerung zur gemerkten Zeit,
           danach jede Minute erneut, bis man wieder im Spiel ist. */
        const E2 = cfg.e2;
        if (!E2.offline || !E2.wakeAt || ok()) return;
        const now = Date.now();
        if (now < E2.wakeAt) return;
        /* Zurück: nur die gemerkte Spielseite öffnen (bestehende Sitzung). Login-Formulare fasst der Bot nie an –
           steht dort statt des Spiels eine Anmeldung, bleibt es bei der Erinnerung. Nur ein Versuch pro Wartezeit. */
        if (E2.autoBack && E2.back && !E2.returned && /^https:\/\/[a-z0-9-]+\.margonem\.(pl|com)\/$/.test(E2.back)) {
            E2.returned = true; save();
            e2Notify(`E2 ${(e2Cur() || {}).nick || ''}: zurück ins Spiel`);
            setTimeout(() => { location.href = E2.back; }, 800);
            return;
        }
        if (E2.returned && performance.now() < 30000) return;      // Spielseite lädt noch – nicht gleich drängeln
        if (now - e2Remind > 60000) {
            e2Remind = now;
            const t = e2Cur(), w = e2Window(t);
            e2Notify(`E2 ${t ? t.nick : ''}: jetzt einloggen – Respawn ${w && w.start > now ? 'in ca. ' + Math.ceil((w.start - now) / 60000) + ' min' : 'jederzeit'}`);
        }
    }
    function e2Notify(msg) {                       // Benachrichtigung, kurzer Ton, am Handy Vibration
        try { GM_notification({ title: 'MargoBot', text: msg, onclick: () => W.focus() }); } catch (e) {}
        {
            try {
                const ac = new (W.AudioContext || W.webkitAudioContext)(), o = ac.createOscillator(), g = ac.createGain();
                o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.value = 0.2;
                o.start(); o.stop(ac.currentTime + 0.5); setTimeout(() => ac.close(), 1500);
            } catch (e) {}
            try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) {}
        }
    }
    function renderAway() {
        /* Kleines Panel auf der Startseite: Countdown bis zur Erinnerung. */
        const t = e2Cur(), w = e2Window(t), now = Date.now(), left = cfg.e2.wakeAt - now;
        const html = `<div class="hd"><div class="brand"><span class="dot trv"></span>MargoBot · E2</div>
            <button class="mini stop" data-a="e2stop">${ico('stop')}Abbrechen</button></div>
            <div class="bd"><div class="now"><div class="st">${left > 0 ? 'Offline bis ' + clock(cfg.e2.wakeAt) : cfg.e2.returned ? 'Bitte selbst einloggen' : 'Jetzt einloggen!'}</div>
              <div class="dt">${t ? esc(t.nick) + ' · ' + esc(wname(t.map)) : ''}</div>
              <div class="dt">${left > 0 ? 'Erinnerung in ' + mmss(left) : ''}${w ? ' · Respawn ' + clock(w.start) + '–' + clock(w.end) : ''}</div></div>
              <div class="hint">Diese Seite offen lassen. ${cfg.e2.autoBack ? `Um ${clock(cfg.e2.wakeAt)} öffnet der Bot wieder ${esc(cfg.e2.back.replace(/^https:\/\/|\/$/g, '') || 'die Spielseite')}. Ist die Sitzung abgelaufen, loggst du dich selbst ein.`
                : 'Einloggen tust du selbst.'} Danach wartet der Bot weiter am Spawnpunkt.</div></div>`;
        if (box.dataset.away !== html) { box.dataset.away = html; box.innerHTML = html; }
    }

    function tick() {
        e2Away();
        if (ok()) {
            bindHero();
            if (heroSwitched) { log(`Einstellungen für ${heroNick || 'diesen Helden'}: ${heroSwitched}`); heroSwitched = ''; }
            trackMaps(); recordFights(); learnGraph(); learnNames(); learnWorldBits();
        }
        if (!ok() || checkDeath()) return;
        watchBattle();
        watchPlayers();
        if (watchCaptcha()) return;                                // Rätsel offen → nichts tun, bis es gelöst ist
        if (!running() || performance.now() < busyUntil) return;
        const e = E();
        if (!loadCols()) return;                                       // Karte lädt noch
        // Kampf (auch unterwegs, falls ein Mob angreift)
        if (inBattle()) {
            battleSeen = true;
            const b = e.battle;
            if (b.endBattle && cfg.closeBattle) {
                act(() => { if (b.canLeaveBattle) b.leaveBattle(); else b.close(); }, 'Kampf schließen');
            }
            return;
        }
        if (battleSeen) { battleSeen = false; atkTries = {}; pkTries = {}; committed = null; lastPlan = null; goal = null; busyUntil = performance.now() + pause(); return; }
        // Ablauf läuft → nur der; sonst Auslöser prüfen (nur wenn der Bot jagt)
        if (cfg.chain) { runChain(); if (performance.now() - renderAt > 400) { renderAt = performance.now(); render(); } return; }
        if (cfg.on) {
            const rev = revived; revived = false;
            if (checkRules(rev)) { if (rev) cfg.back = null; return; }
        }
        // E2-Jagd hat Vorrang vor Reise und normaler Jagd
        if (cfg.e2.on) { e2Step(); if (performance.now() - renderAt > 500) { renderAt = performance.now(); render(); } return; }
        // Reise zu einer Karte (Weltkarte)
        if (cfg.travel) {
            const s = travelStep(cfg.travel.to, cfg.travel.label);
            if (s === 'da') {
                const then = cfg.travel.then;
                log('Angekommen: ' + mapName());
                cfg.travel = null; lastTravel = null;
                if (then === 'hunt') { cfg.on = true; log('Jage hier weiter'); }
                save(); lastStatic = '';
            } else if (s === 'kein Weg' && performance.now() - mapAt > 5000) {
                log('Kein Weg nach ' + cfg.travel.label + ' (nur per Teleport erreichbar?)');
                cfg.travel = null; lastTravel = null; save(); lastStatic = '';
            }
            lastPlan = null; render();
            return;
        }
        if (!cfg.on) return;
        if (pkRouteSkip) {
            if (cfg.pk.mode !== 'follow') pkRouteSkip = null;
            else if (skipFollowedMap()) return;
        }
        if (pkEsc && cfg.pk.mode !== 'off') { if (loadCols()) escapeStep(); return; }   // Flucht vor einem Spieler hat Vorrang
        // Rückweg nach dem Tod: zur Todeskarte bzw. zur nächsten Karte der Route
        if (cfg.back) {
            const r = cfg.routes[cfg.route];
            const targets = r ? r.maps.map(entryName) : [cfg.back.map];
            const mn = mapName();
            if (r ? r.maps.some(mapIs) : nameEq(cfg.back.map, mn)) {
                log('Zurück auf ' + mn + ' – weiter wie gewohnt');
                cfg.back = null; save();
            } else {
                const ids = r ? routeIds(r) : (cfg.back.id ? [cfg.back.id] : idsByName(cfg.back.map));
                const s = world && ids.length ? travelStep(ids, targets[0]) : 'kein Weg';
                if (s === 'kein Weg') {                      // ohne Weltkarte: nur gelernte Türen
                    const path = mapPath(mn, targets);
                    if (!path || path.length < 2) {
                        log('Kein bekannter Weg von ' + mn + ' zurück – Bot gestoppt');
                        cfg.on = false; cfg.back = null; save(); lastStatic = '';
                        return;
                    }
                    const g = gateways().find(x => nameEq(x.name, path[1]));
                    if (g) {
                        const [hx, hy] = heroXY();
                        useDoor(g.x, g.y, 'Rückweg → ' + path[1]);
                    }
                }
                lastPlan = null; render();
                return;
            }
        }
        // Route gewählt, aber diese Karte gehört nicht dazu → nur hinlaufen, NICHTS angreifen.
        // Gejagt wird ausschließlich auf den Karten der Route (vorher fiel der Bot ohne Weg in den Jagdmodus).
        const rt = cfg.routes[cfg.route];
        if (rt && rt.maps.length && !routeStep()) {
            const ids = routeIds(rt);
            const r = world && ids.length ? travelStep(ids, cfg.route) : 'kein Weg';
            offRoute = { map: mapId(), way: r !== 'kein Weg' };
            if (r === 'kein Weg' && offRouteLog !== mapId() && performance.now() - mapAt > 5000) {
                offRouteLog = mapId();
                log(`${mapName()} gehört nicht zur Route „${cfg.route}“ und ich kenne keinen Weg dorthin – ich warte (greife hier nichts an)`);
            }
            lastPlan = null; render();
            return;
        }
        offRoute = null;
        // Hier wird gejagt → als Jagdort merken (Ziel für „Zurück zum Jagdort“, auch nach dem Tod)
        if (!cfg.lastHome || cfg.lastHome.map !== mapId()) {
            cfg.lastHome = { map: mapId(), name: mapName(), route: cfg.route || '', lvl: { lvlMin: cfg.lvlMin, lvlMax: cfg.lvlMax, lvlOn: cfg.lvlOn } };
            save();
        }
        // Held steht?
        const [hx, hy] = heroXY(), hk = hx + ',' + hy;
        if (hk !== lastHero) { lastHero = hk; heroStill = performance.now(); }
        const still = performance.now() - heroStill;
        const exit = currentExit();
        if (pkStep(hx, hy, exit)) return;                              // anderer Spieler: kämpfen oder weg von hier
        const targets = mobs().filter(m => wanted(m) && !(skipUntil[m.id] > performance.now()));
        fogUpdate(hx, hy);
        if (fog.on) {                                                  // im Nebel verschwundene Mobs bleiben Ziele
            const vis = new Set(mobRaw().map(d => d.id));
            for (const [id, m] of fog.mem) if (!vis.has(id) && !(skipUntil[id] > performance.now()))
                targets.push({ id, nick: m.nick || 'Mob', lvl: m.lvl, x: m.x, y: m.y, ghost: true });
        }
        if (!targets.length) {
            lastPlan = null;
            // Nebel: das Spiel zeigt nur Mobs in Sichtweite → Karte ablaufen, bevor sie als leer gilt
            if (fog.on && cfg.fogExplore !== false && exploreStep(hx, hy, !!exit)) { render(); return; }
            if (exit) {
                useDoor(exit.x, exit.y, 'Ausgang ' + exit.name);
            }
            render();
            return;
        }
        // Ziel festhalten: Ist ein Mob gewählt, läuft der Held zu ihm, bis er angegriffen wird oder verschwindet –
        // kein Umplanen unterwegs (sonst pendelt er zwischen zwei fast gleich guten Mobs). Ausnahmen: ein anderer
        // gewünschter Mob steht direkt neben dem Helden (gleich mitnehmen), oder der Held kommt 6 s nicht voran.
        const tNow = performance.now();
        let p = lastPlan;
        const keepT = committed != null && targets.find(m => m.id === committed);
        if (keepT && (Math.abs(keepT.x - hx) > 1 || Math.abs(keepT.y - hy) > 1)
            && tNow - Math.max(heroStill, chaseAt) >= 6000) {
            skipUntil[keepT.id] = tNow + 30000;
            committed = null; goal = null; lastPlan = null;
            loadCols(true);
            log(keepT.nick + ' nicht erreicht (6 s ohne Bewegung) – überspringe ihn 30 s');
            return;
        }
        const adjT = targets.find(m => Math.abs(m.x - hx) <= 1 && Math.abs(m.y - hy) <= 1);
        if (adjT && (!keepT || adjT.id !== keepT.id)) p = { order: [adjT], total: 0, more: targets.length - 1 };
        else if (keepT && still < 6000) { p = p && p.order ? p : { order: [keepT], total: 0, more: targets.length - 1 }; p.order[0] = keepT; }
        else { p = plan(targets, exit); planAt = tNow; }
        lastPlan = p;
        if (tNow - renderAt > 500) { renderAt = tNow; render(); }
        if (!p) {
            // Kollisionen können nachladen: vor dem Überspringen einmal mit frischen Daten prüfen.
            if (tNow - mapAt >= 3000) { loadCols(true); p = plan(targets, exit); lastPlan = p; }
            if (!p) {
                if (tNow - mapAt < 3000) return;
                for (const m of targets) skipUntil[m.id] = tNow + 30000;
                committed = null; goal = null; lastPlan = null;
                log('Kein Weg zu den übrigen Mobs – überspringe sie 30 s');
                // Im nächsten Takt greift der normale Ablauf für eine leere Karte:
                // erreichbare Nebelbereiche absuchen bzw. zur nächsten Routenkarte weitergehen.
                return;
            }
        }
        const t = p.order[0];
        const adj = Math.abs(t.x - hx) <= 1 && Math.abs(t.y - hy) <= 1;
        if (adj && t.ghost) { fog.mem.delete(t.id); committed = null; lastPlan = null; return; }   // dort, aber nicht mehr da
        if (adj) {
            if (still < 150) return;                                  // erst stehen bleiben
            // Angriff ohne Kampf (Mob läuft weiter, anderer Spieler …): beim selben Mob bleiben und nochmal versuchen,
            // nach 3 Versuchen 30 s überspringen – nicht zum nächsten Mob wechseln und zurück (Hin und Her).
            const tr = atkTries[t.id] || (atkTries[t.id] = { n: 0, at: 0 });
            if (tNow - tr.at < 2500) return;                          // letzter Versuch läuft noch
            if (tr.n >= 3) {
                skipUntil[t.id] = tNow + 30000; delete atkTries[t.id]; committed = null; lastPlan = null;
                log(t.nick + ' lässt sich nicht angreifen – überspringe ihn kurz');
                return;
            }
            tr.n++; tr.at = tNow;
            act(() => e.hero.heroAtackRequest(t.id, true), 'Angriff');
            if (!kw.ids.includes(t.id)) noteAttack(t.id);
            log('Angriff: ' + t.nick + ' (' + t.lvl + ')' + (tr.n > 1 ? ` – Versuch ${tr.n}` : ''));
            goal = null; committed = t.id; chaseAt = tNow;
        } else {
            if (committed !== t.id) chaseAt = tNow;
            committed = t.id;
            // Besetzte/gesperrte Mob-Kachel muss nicht betreten werden: von einem erreichbaren
            // Nachbarfeld aus angreifen. Das Spiel kann den Auftrag zur Mob-Kachel ablehnen.
            let tx = t.x, ty = t.y;
            if (walls[t.y * MW + t.x]) {
                const d = bfs(hx, hy), near = [];
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    const x = t.x + dx, y = t.y + dy;
                    if ((!dx && !dy) || x < 0 || y < 0 || x >= MW || y >= MH) continue;
                    const n = d[y * MW + x];
                    if (n >= 0) near.push({ x, y, n });
                }
                near.sort((a, b) => a.n - b.n);
                if (near.length) { tx = near[0].x; ty = near[0].y; }
            }
            walkTo(tx, ty, t.nick + (t.ghost ? ' (zuletzt gesehen)' : ''));
        }
    }
    /* Kills zählen: Bei Kampfbeginn merken, welche Mobs beteiligt sind (der Mob neben dem Helden und alle seiner
       Gruppe – grp), 1 s nach Kampfende nachsehen, wie viele davon verschwunden sind. Läuft in jedem Takt,
       auch während der Pausen – sonst gingen kurze Kämpfe verloren. */
    /* Kills zählen (im Spiel geprüft): Das Kampffenster erscheint meist gar nicht – der Kampf läuft sofort ab,
       danach verschwindet die ganze angegriffene Gruppe von der Karte. Darum: beim Angriff die Gruppe merken
       (alle Mobs mit gleicher grp), dann zählen, wie viele davon innerhalb von 12 s verschwinden. */
    const kw = { map: null, ids: [], at: 0 };
    function mobRaw() { return E().npcs.getDrawableList().map(n => n.d).filter(d => d && (d.type === 2 || d.type === 3)); }
    function settleKills(final) {
        if (!kw.ids.length) return;
        if (mapId() !== kw.map) { kw.ids = []; return; }                 // Kartenwechsel: nicht zählen
        const alive = new Set(mobRaw().map(d => d.id)), gone = kw.ids.filter(id => !alive.has(id));
        if (!final && gone.length < kw.ids.length && performance.now() - kw.at < 12000) return;
        if (gone.length && !deadNow && sess.t0) {
            sess.kills += gone.length; saveSess();
            log(`Kampf vorbei: ${gone.length} ${gone.length === 1 ? 'Mob' : 'Mobs'} besiegt`);
        }
        kw.ids = [];
    }
    function noteAttack(id) {
        settleKills(true);
        const raw = mobRaw(), t = raw.find(d => d.id === id);
        kw.map = mapId(); kw.at = performance.now();
        kw.ids = t && t.grp ? raw.filter(d => d.grp === t.grp).map(d => d.id) : [id];
    }
    function watchBattle() { settleKills(false); }
    /* Zagadka (Captcha des Spiels):
       'soon' = Hinweis „Zagadka pojawi się za …s“ oben im Spiel (Bot jagt weiter, Vorwarnung),
       'open' = Rätsel ist offen (Antwort-Knöpfe sichtbar) → Bot pausiert.
       autoCaptcha: klickt alle Antworten mit *…* (*e*, *f* …), am Handy per Touch.
       autoCaptchaConfirm: klickt danach auch „Potwierdzam“ (sonst selbst). */
    const capt = { state: '', text: '', at: 0, warnedSoon: false, warnedOpen: false, checkAt: 0, solving: false, solvedAt: 0 };
    function captchaText() {
        if (!document.evaluate) return '';
        const r = document.evaluate("//*[not(self::script) and not(self::style) and not(self::textarea) and (contains(text(),'Zagadka') or contains(text(),'zagadk') or contains(text(),'Riddle') or contains(text(),'riddle'))]",
            document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < r.snapshotLength; i++) {
            const el = r.snapshotItem(i);
            if (el.closest && el.closest('#mba')) continue;
            const t = (el.innerText || '').trim();          // nur sichtbarer, kurzer Text (kein Programmcode)
            if (el.offsetWidth && t && t.length < 120) return t.slice(0, 60);
        }
        return '';
    }
    function reallyVisible(el) {
        /* Wirklich zu sehen: Größe > 0, im Bild, und kein Vorfahre ist ausgeblendet (display/visibility/opacity). */
        if (!el.offsetWidth || !el.offsetHeight) return false;
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
        for (let x = el; x && x !== document.body; x = x.parentElement) {
            const cs = getComputedStyle(x);
            if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
        }
        return true;
    }
    function captchaOpen() {
        /* Offen ist das Rätsel nur, wenn die Antwort-Knöpfe (.captcha__buttons) sichtbar sind und Knöpfe enthalten.
           Andere Elemente mit „captcha“ im Namen sind auch ohne Rätsel im Spiel vorhanden (Fehlalarm). */
        if (!document.querySelectorAll) return null;
        return [...document.querySelectorAll('.captcha__buttons')].find(el =>
            !el.closest('#mba') && el.querySelector('.button') && reallyVisible(el)) || null;
    }
    const touchDev = () => { try { return 'ontouchstart' in W || (W.matchMedia && W.matchMedia('(pointer:coarse)').matches); } catch (e) { return false; } };
    /* Klick-Arten für die Zagadka. Welche das Spiel annimmt, ist nicht bekannt (am Handy kam der Klick mit der
       ersten Fassung nicht an: das Spiel fängt Touch-Gesten auf der ganzen Seite ab und ruft preventDefault –
       der Bot hat daraufhin keinen click mehr geschickt). Darum probiert der Bot sie der Reihe nach und prüft
       nach jeder, ob sich der Knopf sichtbar geändert hat (Klasse, Stil). Die erste, die wirkt, merkt er sich. */
    function evAt(el) {
        const tgt = el.querySelector('.label') || el, r = tgt.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        return { tgt, x, y, o: { bubbles: true, cancelable: true, view: W, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: 1 } };
    }
    const P = () => typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    const up = o => Object.assign({}, o, { buttons: 0 });
    const CLICKS = {
        click: el => { const { tgt, o } = evAt(el); tgt.dispatchEvent(new MouseEvent('click', up(o))); },
        maus: el => {
            const { tgt, o } = evAt(el), po = Object.assign({ pointerId: 1, isPrimary: true, pointerType: 'mouse' }, o);
            tgt.dispatchEvent(new (P())('pointerover', po)); tgt.dispatchEvent(new (P())('pointerdown', po));
            tgt.dispatchEvent(new MouseEvent('mouseover', o)); tgt.dispatchEvent(new MouseEvent('mousedown', o));
            tgt.dispatchEvent(new (P())('pointerup', up(po))); tgt.dispatchEvent(new MouseEvent('mouseup', up(o)));
            tgt.dispatchEvent(new MouseEvent('click', up(o)));
        },
        touch: el => {
            // Finger-Tipp, danach IMMER click – auch wenn das Spiel touchend abfängt
            const { tgt, x, y, o } = evAt(el), po = Object.assign({ pointerId: 2, isPrimary: true, pointerType: 'touch' }, o);
            tgt.dispatchEvent(new (P())('pointerdown', po));
            if (typeof TouchEvent === 'function' && typeof Touch === 'function') {
                const t = new Touch({ identifier: Date.now(), target: tgt, clientX: x, clientY: y, pageX: x + scrollX, pageY: y + scrollY });
                tgt.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
                tgt.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
            }
            tgt.dispatchEvent(new (P())('pointerup', up(po)));
            tgt.dispatchEvent(new MouseEvent('mousedown', o)); tgt.dispatchEvent(new MouseEvent('mouseup', up(o)));
            tgt.dispatchEvent(new MouseEvent('click', up(o)));
        },
        jquery: el => {
            // Spiel-Knöpfe hängen oft an jQuery: trigger ruft deren Handler direkt auf
            const $ = W.jQuery || W.$;
            if (typeof $ !== 'function' || !$.fn || !$.fn.trigger) throw new Error('kein jQuery');
            $(el).trigger('mousedown').trigger('mouseup').trigger('click');
        },
        nativ: el => { (el.querySelector('.label') || el).click(); el.click(); }
    };
    const capLabel = b => { const l = b.querySelector('.label') || b; return (l.innerText || l.textContent || '').trim(); };
    const isStar = l => /^\*[^*]+\*$/.test(l);
    const capBtn = lab => { const c = captchaOpen(); return c && [...c.querySelectorAll('.button')].find(x => capLabel(x) === lab) || null; };
    const btnLook = b => {
        if (!b) return '';
        let st = ''; try { const cs = getComputedStyle(b), cb = getComputedStyle(b.querySelector('.background') || b);
            st = [cs.backgroundColor, cs.backgroundImage, cs.filter, cs.opacity, cs.boxShadow, cs.borderColor, cb.backgroundColor, cb.backgroundImage, cb.opacity].join('|'); } catch (e) {}
        // Hover-/Fokus-Klassen zählen nicht – die setzt schon mouseover, ohne dass etwas gewählt ist
        const cls = el => String(el.className || '').split(/\s+/).filter(c => c && !/hover|focus/i.test(c)).sort().join('.');
        return [b, ...b.querySelectorAll('*')].map(el => cls(el) + '{' + (el.getAttribute('style') || '') + '}').join('') + '#' + st;
    };
    function clickOrder() {
        const all = Object.keys(CLICKS), first = touchDev() ? ['touch', 'click', 'jquery', 'maus', 'nativ'] : ['maus', 'click', 'jquery', 'nativ', 'touch'];
        const o = first.filter(k => all.includes(k));
        return cfg.captchaClick && CLICKS[cfg.captchaClick] ? [cfg.captchaClick].concat(o.filter(k => k !== cfg.captchaClick)) : o;
    }
    function pressFull(el) { (CLICKS[cfg.captchaClick] || CLICKS[clickOrder()[0]])(el); }
    function clickStar(lab, done) {
        /* Einen Knopf wählen: Klick-Arten der Reihe nach, nach jeder 350 ms warten und vergleichen. */
        const order = clickOrder(), tried = [];
        const step = i => {
            const b = capBtn(lab);
            if (!b) { log('Zagadka: Knopf ' + lab + ' nicht mehr da'); return done(false); }
            if (i >= order.length) { log('Zagadka: ' + lab + ' – keine Klick-Art wirkt (' + tried.join(', ') + ')'); return done(false); }
            const before = btnLook(b), k = order[i];
            try { CLICKS[k](b); tried.push(k); } catch (e) { tried.push(k + ' ✕'); return step(i + 1); }
            setTimeout(() => {
                const now = capBtn(lab);
                if (!captchaOpen()) { log('Zagadka: ' + lab + ' per ' + k + ' – Fenster zu'); cfg.captchaClick = k; save(); return done(true); }
                if (now && btnLook(now) !== before) {
                    log('Zagadka: ' + lab + ' gewählt (per ' + k + ')');
                    if (cfg.captchaClick !== k) { cfg.captchaClick = k; save(); }
                    return done(true);
                }
                step(i + 1);
            }, 350 + Math.random() * 150);
        };
        step(0);
    }
    function solveCaptchaIfPossible() {
        /* Wählt alle Knöpfe, deren Label mit * beginnt und endet (*e*, *f* …), prüft nach jedem Klick, ob er
           ankam, und klickt „Potwierdzam“ nur, wenn autoCaptchaConfirm an ist und alle Antworten gewählt sind.
           Höchstens 2 Durchgänge pro Rätsel. */
        if (!cfg.autoCaptcha || capt.solving) return false;
        const box = captchaOpen();
        if (!box) return false;
        const labels = [...box.querySelectorAll('.button')].map(capLabel), star = labels.filter(isStar);
        if (!star.length) {
            log('Zagadka: keine *…* in [' + labels.join(', ') + '] – bitte selbst lösen');
            capt.solvedAt = performance.now(); capt.tries = 99;
            return false;
        }
        if ((capt.tries = (capt.tries || 0) + 1) > 2) return false;
        capt.solving = true;
        log('Zagadka: ' + star.join(', ') + ' gefunden – klicke (' + (touchDev() ? 'Handy' : 'PC') + (cfg.captchaClick ? ', zuletzt ' + cfg.captchaClick : '') + ')');
        let okN = 0;
        const next = i => {
            if (i >= star.length) return finish();
            setTimeout(() => clickStar(star[i], ok => { if (ok) okN++; next(i + 1); }), 150 + Math.random() * 250);
        };
        const finish = () => {
            capt.solving = false; capt.solvedAt = performance.now();
            if (okN < star.length) {
                capt.tries = 99;                            // nicht weiter herumklicken – sonst wird Gewähltes wieder abgewählt
                log('Zagadka: Das Spiel nimmt die Klicks des Bots nicht an – bitte selbst lösen. „Spieldaten prüfen“ zeigt Details.');
                return;
            }
            if (!cfg.autoCaptchaConfirm) return log('Zagadka: Antworten gewählt – bitte selbst Potwierdzam');
            setTimeout(() => {
                const confirm = document.querySelector('.captcha__confirm .button');
                if (confirm && reallyVisible(confirm)) {
                    try { pressFull(confirm); log('Zagadka: Potwierdzam geklickt (per ' + (cfg.captchaClick || clickOrder()[0]) + ')'); } catch (e) {}
                } else log('Zagadka: Potwierdzam-Knopf nicht gefunden');
                capt.solvedAt = performance.now();
            }, 300 + Math.random() * 300);
        };
        next(0);
        return true;
    }
    function watchCaptcha() {
        const now = performance.now();
        if (now < capt.checkAt) return capt.state === 'open';
        capt.checkAt = now + 700;
        const box2 = captchaOpen();
        const txt = box2 ? '' : captchaText();
        const st = box2 ? 'open' : txt ? 'soon' : '';
        if (st !== capt.state) {
            if (st === 'open') {
                log(cfg.autoCaptcha ? 'Zagadka offen – versuche *…* zu klicken' : 'Zagadka offen – Bot pausiert, bitte selbst lösen');
                if (!capt.warnedOpen) alarm(cfg.autoCaptcha ? 'Zagadka – klicke Antworten…' : 'Zagadka ist offen – bitte jetzt lösen. Der Bot wartet.', true);
                capt.warnedOpen = true; capt.tries = 0; capt.solvedAt = now;
                // kurz warten: das Fenster baut sich gerade erst auf
                if (cfg.autoCaptcha) setTimeout(solveCaptchaIfPossible, 300 + Math.random() * 400);
            }
            else if (st === 'soon') {
                log('Zagadka kommt bald: ' + txt);
                if (!capt.warnedSoon) alarm('Zagadka kommt bald (' + txt.replace(/^.*?(\d+\s*s).*$/, '$1') + ')', false);
                capt.warnedSoon = true;
            }
            else if (capt.state === 'open') {
                log('Zagadka gelöst – weiter');
                capt.warnedOpen = false;
                capt.warnedSoon = false;
                capt.solving = false;
                busyUntil = now + pause();
            }
            else { capt.warnedSoon = false; }
            capt.state = st; capt.at = now; lastStatic = '';
        } else if (st === 'open' && cfg.autoCaptcha && !capt.solving && now - capt.solvedAt > 4000 && (capt.tries || 0) < 2) {
            // Fenster hängt noch (Klick kam nicht an) oder Einstellung erst später eingeschaltet → nochmal
            solveCaptchaIfPossible();
        }
        capt.text = txt;
        return st === 'open';
    }
    function alarm(msg, loud) {
        if (cfg.captchaWarn === false || !running()) return;
        try {                                       // kurzer Ton (dreimal bei offenem Rätsel)
            const ac = new (W.AudioContext || W.webkitAudioContext)();
            const beep = (t, f) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; o.connect(g); g.connect(ac.destination);
                g.gain.setValueAtTime(0.0001, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.35); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.4); };
            beep(0, 880); if (loud) { beep(0.45, 880); beep(0.9, 1175); }
            setTimeout(() => ac.close(), 2000);
        } catch (e) {}
        try { GM_notification({ title: 'MargoBot', text: msg, silent: true, onclick: () => W.focus() }); } catch (e) {}
    }
    let tickMs = 0;                                // gleitender Mittelwert der Rechenzeit pro Takt (im Panel)
    function timedTick() {
        const t0 = performance.now();
        try { tick(); } catch (e) { log('Fehler: ' + e.message); }
        tickMs = tickMs * 0.9 + (performance.now() - t0) * 0.1;
    }
    // Takt aus einem Web Worker: Chrome bremst setInterval in Hintergrund-Tabs auf 1×/s (später 1×/min),
    // Worker-Timer laufen ungebremst weiter.
    try {
        const wk = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 200)'], { type: 'text/javascript' })));
        wk.onmessage = () => timedTick();
    } catch (e) { setInterval(timedTick, 200); }

    // ── Handel: Auktionshaus scannen, Marktpreise merken, günstige Angebote finden ──
    /* Im Spiel geprüft (classic.margonem.pl): Kategorie-Wechsel = Klick auf .one-category-auction (Anfrage ah&cat=…),
       15 Angebote pro Seite, nächste Seite über E().auctions.getAuctionPages().getNextPageAction() (hängt an).
       Gegenstände liegen in Engine.items, Ort 'a' (Name, Werte mit rarity=…, NPC-Wert pr); Preise stehen in der
       Zeile (.item-bid-td, .item-buy-now). Gekauft wird NIE vom Bot – nur angezeigt. */
    const MK = { scan: null, stat: '', deals: [], dealKey: '' };
    let market = GM_getValue('mbmarket', null) || { items: {}, scans: 0, last: 0 };
    const saveMarket = () => { try { GM_setValue('mbmarket', market); } catch (e) {} };
    const tradeCfg = () => Object.assign({ pages: 15, allCats: true, fee: 0, npcPct: 50, minOff: 35, minN: 3, tempo: 'normal' }, cfg.trade || {});
    const auctionOpen = () => { const s = document.querySelector('.all-auction-section'); return s && s.offsetWidth ? s : null; };
    const priceNum = t => {
        const m = String(t || '').toLowerCase().replace(/\s/g, '').replace(',', '.').match(/([\d.]+)(k|m|g|b)?/);
        return m ? Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6, g: 1e9, b: 1e9 }[m[2]] || 1)) : 0;
    };
    const itemKey = d => {
        const st = parseStat(d.stat);
        return [d.name, st.rarity || 'common', st.enhancement_upgrade_lvl || ''].join('|');
    };
    function readOffers() {
        /* Alle sichtbaren Angebote der Liste: {id, key, name, rarity, lvl, npc, bid, buy, left(s)}. */
        const sec = auctionOpen();
        if (!sec) return [];
        const items = {};
        try { for (const x of E().items.fetchLocationItems('a') || []) { const d = x.d || x; items[String(d.id)] = d; } } catch (e) {}
        const out = [];
        for (const el of sec.querySelectorAll('.item')) {
            const id = (String(el.className).match(/item-id-(\d+)/) || [])[1], d = items[id];
            if (!d) continue;
            let row = el;
            for (let k = 0; k < 8 && row; k++) { row = row.parentElement; if (row && row.querySelector('.item-buy-now-td, .item-bid-td')) break; }
            if (!row) continue;
            const cell = c => (row.querySelector(c) || {}).innerText || '';
            const tm = cell('.item-time-td'), st = parseStat(d.stat);
            const left = (+(tm.match(/(\d+)\s*h/) || [0, 0])[1]) * 3600 + (+(tm.match(/(\d+)\s*m(?!s)/) || [0, 0])[1]) * 60 + (+(tm.match(/(\d+)\s*s/) || [0, 0])[1]);
            out.push({ id, key: itemKey(d), name: d.name, rarity: st.rarity || 'common', lvl: +st.lvl || 0, npc: +d.pr || 0,
                       bid: priceNum(cell('.item-bid-td')), buy: priceNum(cell('.item-buy-now-td').replace(/kup teraz/i, '')), left, el });
        }
        return out;
    }
    function remember(offers) {
        /* Preise je Gegenstand merken (Sofortkauf, max. 40 Einträge, älter als 7 Tage fliegen raus). */
        const now = Date.now(), week = 7 * 864e5;
        for (const o of offers) {
            if (!o.buy) continue;
            const m = market.items[o.key] || (market.items[o.key] = { n: o.name, r: o.rarity, l: o.lvl, npc: o.npc, p: [] });
            const ex = m.p.find(p => p[2] === o.id);
            if (ex) { ex[0] = o.buy; ex[1] = now; } else m.p.push([o.buy, now, o.id]);
            m.p = m.p.filter(p => now - p[1] < week).slice(-40);
        }
    }
    function marketPrice(key, exceptId) {
        const m = market.items[key];
        if (!m) return null;
        const ps = m.p.filter(p => p[2] !== exceptId).map(p => p[0]).sort((a, b) => a - b);
        if (!ps.length) return null;
        return { med: ps[ps.length >> 1], n: ps.length, low: ps[0] };
    }
    function findDeals(offers) {
        /* Drei Arten: Markt (Sofortkauf deutlich unter Median gleicher Gegenstände), NPC (unter Händler-Ankauf),
           Endet bald (Gebot weit unter Median, < 15 min Restzeit). Gewinn nach Gebühr, absteigend. */
        const tc = tradeCfg(), out = [];
        for (const o of offers) {
            const mp = marketPrice(o.key, o.id), npcBuy = o.npc * tc.npcPct / 100;
            if (o.buy && npcBuy > o.buy * 1.03)
                out.push(Object.assign({}, o, { kind: 'npc', price: o.buy, worth: npcBuy, gain: npcBuy - o.buy, n: 0 }));
            if (mp && mp.n >= tc.minN) {
                const sell = mp.med * (1 - tc.fee / 100);
                if (o.buy && o.buy <= mp.med * (1 - tc.minOff / 100) && sell > o.buy)
                    out.push(Object.assign({}, o, { kind: 'markt', price: o.buy, worth: mp.med, gain: sell - o.buy, n: mp.n }));
                const bidNow = o.bid || 0;
                if (bidNow && o.left && o.left < 900 && bidNow <= mp.med * 0.6 && sell > bidNow * 1.1)
                    out.push(Object.assign({}, o, { kind: 'bald', price: bidNow, worth: mp.med, gain: sell - bidNow * 1.1, n: mp.n }));
            }
        }
        const best = {};
        for (const d of out) if (!best[d.id + d.kind] || best[d.id + d.kind].gain < d.gain) best[d.id + d.kind] = d;
        return Object.values(best).sort((a, b) => b.gain - a.gain).slice(0, 40);
    }

    // Scanner: läuft nur bei offenem Auktionsfenster, eigener Takt (1,4–2,2 s je Seite, wie von Hand)
    function dealPool() { return MK.lastOffers || []; }
    function startScan() {
        if (!auctionOpen()) { log('Auktionsfenster ist zu – erst beim Aukcjoner „Pokaż mi aukcje“ öffnen'); return; }
        const cats = [...document.querySelectorAll('.one-category-auction')].filter(e => e.offsetWidth);
        const tc = tradeCfg();
        MK.scan = { cats: tc.allCats ? cats.length : 1, ci: tc.allCats ? 0 : -1, page: 0, seen: new Set(), offers: [], next: performance.now(), t0: Date.now() };
        log('Scan gestartet: ' + (tc.allCats ? cats.length + ' Kategorien' : 'aktuelle Kategorie') + ', bis ' + tc.pages + ' Seiten je Kategorie');
        lastStatic = '';
    }
    function stopScan(msg) {
        if (!MK.scan) return;
        const sc = MK.scan;
        market.scans++; market.last = Date.now(); saveMarket();
        MK.lastOffers = sc.offers;
        MK.deals = findDeals(sc.offers); MK.dealKey = '';
        log((msg || 'Scan fertig') + `: ${sc.offers.length} Angebote in ${Math.round((Date.now() - sc.t0) / 1000)} s, ${MK.deals.length} Gelegenheiten`);
        MK.scan = null; lastStatic = '';
    }
    /* Tempo: nicht pauschal warten, sondern bis die neue Seite da ist (mehr Zeilen bzw. andere erste Zeile),
       danach eine kurze, zufällige Pause. Nacheinander, nie parallel – das Spiel hat nur eine Auktionsliste. */
    const TEMPO = { ruhig: [1400, 800, 'ruhig (~2 s/Seite)'], normal: [500, 400, 'normal (~1 s/Seite)'], schnell: [150, 200, 'schnell (~0,5 s/Seite)'] };
    const listSig = () => { const sec = auctionOpen(), its = sec ? sec.querySelectorAll('.item') : []; return its.length + ':' + (its[0] ? its[0].className : ''); };
    function scanStep() {
        const sc = MK.scan;
        if (!sc) return;
        const now = performance.now();
        if (sc.waitSig !== undefined) {                       // auf die Antwort des Spiels warten
            if (listSig() === sc.waitSig && now - sc.waitAt < 4000) return;
            const t = TEMPO[tradeCfg().tempo] || TEMPO.normal;
            delete sc.waitSig; sc.next = now + t[0] + Math.random() * t[1];
        }
        if (now < sc.next) return;
        if (!auctionOpen()) return stopScan('Scan abgebrochen (Auktionsfenster zu)');
        const tc = tradeCfg(), expect = () => { sc.waitSig = listSig(); sc.waitAt = performance.now(); };
        // neue Angebote der aktuellen Liste einsammeln
        const fresh = readOffers().filter(o => !sc.seen.has(o.id));
        for (const o of fresh) { sc.seen.add(o.id); delete o.el; sc.offers.push(o); }
        remember(fresh);
        let P = null;
        try { P = E().auctions.getAuctionPages(); } catch (e) {}
        if (sc.page === 0) {                                  // Kategorie (neu) laden
            if (sc.ci >= 0) {
                const cats = [...document.querySelectorAll('.one-category-auction')].filter(e => e.offsetWidth);
                if (sc.ci >= cats.length) return stopScan();
                expect(); cats[sc.ci].click();
            }
            sc.page = 1; return;
        }
        const cur = P ? P.getCurrentPage() : sc.page, max = P ? P.getMaxPage() : 1;
        const secs = (Date.now() - sc.t0) / 1000;
        MK.stat = `Kategorie ${sc.ci >= 0 ? sc.ci + 1 : 1}/${sc.cats} · Seite ${cur}/${Math.min(max, tc.pages)} · ${sc.offers.length} Angebote · ${Math.round(secs)} s`;
        if (P && cur < Math.min(max, tc.pages)) { expect(); P.getNextPageAction(); sc.page++; return; }
        if (sc.ci < 0 || sc.ci + 1 >= sc.cats) return stopScan();
        sc.ci++; sc.page = 0;
    }
    setInterval(() => { try { scanStep(); } catch (e) { log('Scan-Fehler: ' + e.message); MK.scan = null; } }, 100);

    function showOffer(dl) {
        /* Angebot im Auktionsfenster sichtbar machen: Namen ins Suchfeld, „Odśwież“ – kaufen tust du selbst. */
        const sec = auctionOpen();
        if (!sec) { log('Auktionsfenster ist zu'); return; }
        const w = sec.closest('.c-window') || document;
        const inp = [...w.querySelectorAll('input')].find(i => i.offsetWidth && /nazwa|name/i.test(i.placeholder || '')) || [...w.querySelectorAll('input')].find(i => i.offsetWidth && i.type !== 'checkbox');
        if (inp) { inp.value = dl.name; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
        const btn = [...w.querySelectorAll('.button, button')].find(b => b.offsetWidth && /odśwież|refresh|szukaj|search/i.test(b.innerText || ''));
        if (btn) press(btn);
        log('Gesucht: ' + dl.name + ' – Preis ' + fmtXp(dl.price));
    }

    // ── Panel ───────────────────────────────────────────────────
    /* Zwei Tabs: „XP“ (Level-Bereich → XP-Ort → Los) ist der Alltag, „Einstellungen“ alles andere.
       Statischer Teil wird nur bei Änderungen neu gebaut (sonst springt der Fokus), Live-Werte jede Sekunde. */
    const font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&display=swap';
    document.head.appendChild(font);
    const css = document.createElement('style');
    css.textContent = `
    #mba{--bg:#16130f;--bg2:#1f1b15;--bg3:#2a241c;--line:#3a3227;--tx:#efe8da;--mut:#b3a892;--dim:#857a66;
         --amb:#e8a93c;--amb2:#f4c46a;--ambtx:#1d1408;--ok:#7fcf8a;--bad:#ec7a6a;--blue:#8fb4ef;
         --disp:'Barlow Semi Condensed','Segoe UI',system-ui,sans-serif;
         position:fixed;z-index:100000;width:min(360px,calc(100vw - 16px));background:var(--bg);color:var(--tx);
         font:12.5px/1.4 'Segoe UI',system-ui,sans-serif;border:1px solid var(--line);border-radius:12px;
         box-shadow:0 12px 32px -8px rgba(0,0,0,.65),0 2px 6px rgba(0,0,0,.4);user-select:none;overflow:hidden}
    #mba *{box-sizing:border-box}
    #mba svg{width:15px;height:15px;flex:none;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    #mba button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
    #mba button:focus-visible,#mba input:focus-visible,#mba select:focus-visible{outline:2px solid var(--amb);outline-offset:1px}

    #mba .hd{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 12px;cursor:move;background:var(--bg2);touch-action:none}
    #mba .brand{font:700 15px/1 var(--disp);letter-spacing:.01em;flex:1;display:flex;align-items:center;gap:8px}
    #mba .dot{width:8px;height:8px;border-radius:50%;background:var(--dim)}
    #mba .dot.run{background:var(--ok);animation:mbaPulse 2.4s cubic-bezier(.16,1,.3,1) infinite}
    #mba .dot.trv{background:var(--blue)} #mba .dot.dead{background:var(--bad)}
    @keyframes mbaPulse{0%{box-shadow:0 0 0 0 rgba(127,207,138,.55)}70%{box-shadow:0 0 0 7px rgba(127,207,138,0)}100%{box-shadow:0 0 0 0 rgba(127,207,138,0)}}
    @media (prefers-reduced-motion:reduce){#mba .dot.run{animation:none}}
    #mba .ib{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;color:var(--mut)}
    #mba .ib:hover{background:var(--bg3);color:var(--tx)}
    #mba .mini{font:600 12.5px/1 var(--disp);padding:6px 10px;border-radius:7px;background:var(--amb);color:var(--ambtx);display:inline-flex;align-items:center;gap:5px}
    #mba .mini svg{width:12px;height:12px;stroke-width:2.4}
    #mba .mini.stop{background:var(--bad);color:#2a0d08}

    #mba .deal{padding:9px 10px;border-radius:9px;background:var(--bg2);margin-bottom:5px}
    #mba .deal .dh{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
    #mba .deal .dh b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #mba .deal .g{font:700 14px/1 var(--disp);color:var(--ok);white-space:nowrap;font-variant-numeric:tabular-nums}
    #mba .deal .dm{color:var(--mut);font-size:11.5px;margin:3px 0 6px;font-variant-numeric:tabular-nums}
    #mba .deal .kd{font-weight:600}
    #mba .capt{padding:9px 12px;display:flex;flex-direction:column;gap:2px;border-bottom:1px solid var(--line)}
    #mba .capt b{font:700 14px/1.2 var(--disp)} #mba .capt span{font-size:11.5px}
    #mba .capt.open{background:rgba(236,122,106,.16);color:#ffb3a8} #mba .capt.open b{color:var(--bad)}
    #mba .capt.soon{background:rgba(232,169,60,.12);color:var(--amb2)}
    #mba .skp{display:flex;align-items:center;gap:11px;background:var(--bg2);border-radius:10px;padding:10px 12px}
    #mba .skp>b{font:700 28px/1 var(--disp);color:var(--amb2);font-variant-numeric:tabular-nums}
    #mba .skp strong{display:block;font:700 15px/1.2 var(--disp)} #mba .skp span{color:var(--mut);font-size:11.5px}
    #mba .skg{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin:10px 2px 0;font-size:12px}
    #mba .skg span{color:var(--dim)} #mba .skg b{font-weight:500;min-width:0;overflow-wrap:anywhere}
    #mba .sks{margin-top:14px} #mba .ski{display:flex;justify-content:space-between;gap:10px;padding:3px 2px}
    #mba .ski b{font:700 13px/1.3 var(--disp);color:var(--amb2);white-space:nowrap;font-variant-numeric:tabular-nums}
    #mba .skr{margin-top:16px} #mba .skr.lock .skl{opacity:.5}
    #mba .skh{display:flex;justify-content:space-between;gap:8px;align-items:baseline;padding:0 2px 5px}
    #mba .skh b{font:600 12px/1 var(--disp);letter-spacing:.06em;text-transform:uppercase;color:var(--mut)} #mba .skh span{color:var(--dim);font-size:11px;text-align:right}
    #mba .skl{display:grid;grid-template-columns:1fr auto;gap:1px 8px;width:100%;text-align:left;padding:6px 8px 7px;border-radius:7px}
    #mba .skl:hover,#mba .skl[aria-expanded=true]{background:var(--bg2)}
    #mba .skl .nm{font-weight:500;min-width:0} #mba .skl .lv{grid-row:1/3;grid-column:2;align-self:center;font:700 14px/1 var(--disp);color:var(--dim);font-variant-numeric:tabular-nums}
    #mba .skl.full .lv{color:var(--ok)} #mba .skl.some .lv{color:var(--amb2)}
    #mba .skl .tg{grid-column:1;color:var(--dim);font-size:11px} #mba .skl .tg i{font-style:normal;color:var(--bad)}
    #mba .skl .br{grid-column:1/-1;height:3px;margin-top:4px;border-radius:2px;background:var(--bg3);overflow:hidden}
    #mba .skl .br u{display:block;height:100%;background:var(--amb);text-decoration:none} #mba .skl.full .br u{background:var(--ok)}
    #mba .skd{padding:4px 8px 10px;font-size:11.5px;color:var(--mut)} #mba .skd .sdsc{line-height:1.45}
    #mba .skd table{width:100%;border-collapse:collapse;margin-top:6px;font-variant-numeric:tabular-nums}
    #mba .skd th{text-align:right;font-weight:500;color:var(--dim);padding:2px 0 2px 8px} #mba .skd th:first-child,#mba .skd td:first-child{text-align:left;padding-left:0;overflow-wrap:anywhere}
    #mba .skd td{text-align:right;padding:2px 0 2px 8px;color:var(--tx)} #mba .skd td:first-child{color:var(--mut)}
    #mba .tabs{display:flex;gap:2px;padding:0 10px;overflow-x:auto;scrollbar-width:none;background:var(--bg2);border-bottom:1px solid var(--line)}
    #mba .tab{white-space:nowrap;flex:none;font:600 13px/1 var(--disp);letter-spacing:.02em;color:var(--dim);padding:8px 7px 9px;border-bottom:2px solid transparent;margin-bottom:-1px}
    #mba .tab:hover{color:var(--mut)} #mba .tab.on{color:var(--tx);border-bottom-color:var(--amb)}

    #mba .bd{padding:12px;max-height:68vh;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--line) transparent;overscroll-behavior:contain}
    /* Handy/Tablet: Finger statt Maus – größere Tippflächen, Kopfzeile ist Griff, Inhalt scrollt per Wischen (siehe touch-Handler) */
    @media (pointer:coarse){
      #mba .ib{width:34px;height:34px}
      #mba .mini{padding:9px 12px}
      #mba .tab{padding:11px 10px 12px}
      #mba .bd{max-height:60vh;touch-action:none}
    }
    @media (max-height:500px){#mba .bd{max-height:calc(100vh - 140px)}}
    #mba h4{font:600 12px/1 var(--disp);letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:18px 0 8px}
    #mba h4:first-child{margin-top:2px}

    #mba .now{background:var(--bg2);border-radius:10px;padding:10px 11px}
    #mba .now .st{font:700 17px/1.15 var(--disp);display:flex;align-items:center;gap:7px}
    #mba .now .dt2{color:var(--mut);margin-top:3px;min-height:17px}
    #mba .now .dt{color:var(--mut);margin-top:3px;min-height:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #mba .now .kp{display:flex;gap:14px;margin-top:8px;padding-top:8px;border-top:1px solid var(--line);color:var(--mut);font-size:11.5px}
    #mba .now .kp{flex-wrap:wrap}
    #mba .now .eta{flex-basis:100%;display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 8px;margin-top:2px}
    #mba .now .eta .bar{flex-basis:100%;height:4px;border-radius:3px;background:var(--bg3);overflow:hidden}
    #mba .now .eta .bar i{display:block;height:100%;background:var(--amb);border-radius:3px;transition:width .6s cubic-bezier(.16,1,.3,1)}
    #mba .now .eta span{color:var(--tx);font-weight:600} #mba .now .eta .r{color:var(--mut);font-weight:400;font-variant-numeric:tabular-nums}
    #mba .now .kp b{font:700 14px/1 var(--disp);color:var(--tx);margin-right:3px;font-variant-numeric:tabular-nums}

    #mba .rg{display:flex;align-items:center;gap:6px}
    #mba .stp{display:flex;align-items:center;background:var(--bg2);border:1px solid var(--line);border-radius:8px;overflow:hidden}
    #mba .stp button{width:24px;height:30px;color:var(--mut);font:600 15px/1 var(--disp)} #mba .stp button:hover{background:var(--bg3);color:var(--tx)}
    #mba .stp input{width:36px;height:30px;text-align:center;background:none;border:0;color:var(--tx);font:700 16px/1 var(--disp);
         font-variant-numeric:tabular-nums;-moz-appearance:textfield}
    #mba .stp input::-webkit-inner-spin-button{-webkit-appearance:none}
    #mba .rg .to{color:var(--dim)}
    #mba .chip{margin-left:auto;font-size:11.5px;color:var(--amb2);padding:5px 8px;border-radius:7px}
    #mba .chip:hover{background:var(--bg3)}

    #mba .spots{display:flex;flex-direction:column;gap:3px}
    #mba .spot{display:grid;grid-template-columns:1fr auto;gap:1px 8px;text-align:left;padding:8px 10px;border-radius:9px;
         border:1px solid transparent;transition:background .15s,border-color .15s}
    #mba .spot:hover{background:var(--bg2)}
    #mba .spot.sel{background:var(--bg3);border-color:rgba(232,169,60,.55)}
    #mba .spot .nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #mba .spot .ds{font:600 12.5px/1.4 var(--disp);color:var(--mut);font-variant-numeric:tabular-nums;text-align:right}
    #mba .spot.here .ds{color:var(--ok)}
    #mba .seg{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px}
    #mba .seg button{display:flex;flex-direction:column;gap:2px;text-align:left;padding:9px 11px;border-radius:10px;background:var(--bg2);
         border:1px solid transparent;transition:background .15s,border-color .15s}
    #mba .seg button:hover{background:var(--bg3)}
    #mba .seg b{font:700 14px/1.15 var(--disp);color:var(--mut)} #mba .seg span{font-size:11px;color:var(--dim)}
    #mba .seg .on{background:var(--bg3);border-color:rgba(232,169,60,.6)} #mba .seg .on b{color:var(--amb2)} #mba .seg .on span{color:var(--mut)}
    #mba .spot.route{cursor:default;margin-top:6px}
    #mba .spot .xpl{color:var(--amb2);opacity:.85;font-variant-numeric:tabular-nums} #mba .spot .rprog{color:var(--blue)}
    #mba .spot .mt{grid-column:1/-1;color:var(--dim);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

    #mba .cta{width:100%;margin-top:12px;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 12px;border-radius:10px;
         background:var(--amb);color:var(--ambtx);font:700 15px/1.1 var(--disp);letter-spacing:.01em;
         box-shadow:0 4px 12px -4px rgba(232,169,60,.45);transition:background .15s,transform .1s}
    #mba .cta:hover{background:var(--amb2)} #mba .cta:active{transform:translateY(1px)}
    #mba .cta.stop{background:var(--bad);color:#2a0d08;box-shadow:0 4px 12px -4px rgba(236,122,106,.45)}
    #mba .cta svg{width:16px;height:16px;stroke-width:2.2}
    #mba .sub{display:block;margin:7px auto 0;color:var(--mut);font-size:12px;padding:4px 8px;border-radius:6px}
    #mba .sub:hover{color:var(--tx);background:var(--bg2)}
    #mba .empty{color:var(--mut);padding:4px 2px 2px}
    #mba .empty b{color:var(--tx)}

    #mba details{margin-top:14px;border-top:1px solid var(--line);padding-top:8px}
    #mba summary{cursor:pointer;color:var(--dim);font-size:11.5px;list-style:none;display:flex;align-items:center;gap:6px}
    #mba summary::-webkit-details-marker{display:none} #mba summary:hover{color:var(--mut)}
    #mba .log{color:var(--mut);font-size:11px;white-space:pre-wrap;margin-top:6px;font-variant-numeric:tabular-nums}

    #mba .fld{display:flex;align-items:center;gap:8px;margin:6px 0}
    #mba .fld > span{flex:1;color:var(--mut)}
    #mba select,#mba input[type=text],#mba .num{background:var(--bg2);color:var(--tx);border:1px solid var(--line);border-radius:7px;padding:5px 7px;font:inherit}
    #mba select{width:100%} #mba input[type=text]{flex:1;min-width:0} #mba .num{width:58px;text-align:right;font-variant-numeric:tabular-nums}
    #mba .btn{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:7px;background:var(--bg3);color:var(--tx);white-space:nowrap}
    #mba .btn:hover{background:#352d23} #mba .btn.rec{color:var(--bad)} #mba .btn.pri{background:var(--amb);color:var(--ambtx);font-weight:600}
    #mba .chk{display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer}
    #mba .chk input{accent-color:var(--amb);width:14px;height:14px;margin:0}
    #mba .chk .lv{margin-left:auto;color:var(--dim);font-variant-numeric:tabular-nums}
    #mba .hint{color:var(--dim);font-size:11.5px;margin:4px 0}
    #mba .deaths{color:var(--bad);font-size:11.5px;line-height:1.5}
    #mba .ib:disabled{opacity:.3;cursor:default}
    #mba .rule{padding:10px 10px 8px;border-radius:10px;background:var(--bg2);margin-bottom:6px}
    #mba .rule.off{opacity:.55} #mba .rule.run{box-shadow:inset 0 0 0 1px var(--blue)}
    #mba .rule.edit{box-shadow:inset 0 0 0 1px rgba(232,169,60,.55)}
    #mba .rh{display:flex;align-items:center;gap:6px}
    #mba .rt2{flex:1;min-width:0;font:600 13.5px/1.2 var(--disp);display:flex;align-items:center;gap:6px}
    #mba .tag{font:600 10.5px/1 'Segoe UI',sans-serif;color:var(--ok);background:rgba(127,207,138,.12);padding:3px 6px;border-radius:5px}
    #mba .sw{position:relative;width:28px;height:16px;flex:none;cursor:pointer}
    #mba .sw input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer;z-index:1}
    #mba .sw i{position:absolute;inset:0;border-radius:9px;background:var(--line);transition:background .15s}
    #mba .sw i::after{content:'';position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:var(--tx);transition:transform .2s cubic-bezier(.16,1,.3,1)}
    #mba .sw input:checked + i{background:var(--amb)} #mba .sw input:checked + i::after{transform:translateX(12px);background:var(--ambtx)}
    #mba .sw input:focus-visible + i{outline:2px solid var(--amb);outline-offset:1px}
    #mba .steps{list-style:none;margin:8px 0 0;padding:0;position:relative}
    #mba .steps:not(.ed)::before{content:'';position:absolute;left:8.5px;top:10px;bottom:10px;width:1px;background:var(--line)}
    #mba .steps li{display:flex;align-items:center;gap:8px;padding:2px 0;color:var(--mut);position:relative}
    #mba .steps .no{width:18px;height:18px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--bg3);color:var(--mut);
         font:700 11px/1 var(--disp);font-variant-numeric:tabular-nums}
    #mba .steps li.cur{color:var(--tx)} #mba .steps li.cur .no{background:var(--blue);color:#0d1626}
    #mba .steps li.past{color:var(--dim)}
    #mba .steps.ed li{display:block;padding:6px 0;border-top:1px solid var(--line)} #mba .steps.ed li:first-child{border-top:0}
    #mba .steps.ed .fld{margin:0} #mba .steps.ed .sf{margin:5px 0 0 26px}
    #mba .steps.ed select{flex:1;width:auto}
    #mba .num.sm{width:52px}
    #mba .steps.ed .sf{display:flex;flex-direction:column;gap:6px} #mba .steps.ed .sf select{width:100%;flex:none}
    #mba .steps.ed .sf .fld{margin:0} #mba .steps.ed .sf .fld select{flex:1;width:auto;min-width:0}
    #mba .stp.sm button{width:22px;height:27px} #mba .stp.sm input{width:44px;height:27px;font-size:14px}
    #mba input.q{background:var(--bg);border:1px dashed var(--line);border-radius:7px;padding:4px 7px;color:var(--tx);font:inherit;font-size:11.5px}
    #mba optgroup{font-style:normal;color:var(--mut)} #mba option{color:var(--tx);background:var(--bg2)}
    #mba .wn{color:var(--mut);font-weight:600} #mba .dann{margin:10px 0 0}
    #mba .btn.bad{color:var(--bad)}
    #mba .tpl{display:grid;grid-template-columns:1fr 1fr;gap:5px}
    #mba .tp{text-align:left;padding:8px 9px;border-radius:9px;background:var(--bg2);display:flex;flex-direction:column;gap:2px;transition:background .15s}
    #mba .tp:hover{background:var(--bg3)} #mba .tp b{font:600 13px/1.2 var(--disp)} #mba .tp span{color:var(--dim);font-size:11px;line-height:1.3}
    #mba .hint svg{width:11px;height:11px;vertical-align:-1px}
    #mba .diag{white-space:pre-wrap}`;
    document.head.appendChild(css);

    const I = {                                    // Linien-Icons (24er Raster, ein Strich)
        play: '<path d="M7 4.5v15l12-7.5z"/>',
        stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
        min: '<path d="M6 12h12"/>', max: '<path d="M6 12h12M12 6v12"/>',
        pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
        map: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>',
        rec: '<circle cx="12" cy="12" r="5.5"/>', chev: '<path d="m9 6 6 6-6 6"/>',
        up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
        edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
        trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
        x: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>'
    };
    const ico = n => `<svg viewBox="0 0 24 24">${I[n]}</svg>`;

    const box = document.createElement('div');
    box.id = 'mba';
    box.style.left = (cfg.x ?? 0) + 'px';
    box.style.top = (cfg.y ?? 80) + 'px';
    document.body.appendChild(box);
    box.addEventListener('mousedown', ev => ev.stopPropagation());   // Klicks im Panel nicht ans Spiel
    box.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Enter' && ev.target.dataset.a === 'dest') { const b = box.querySelector('[data-a=go]'); if (b) b.click(); }
        if (ev.key === 'Enter' && /^lvl(Min|Max)$/.test(ev.target.dataset.a || '')) ev.target.blur();
    });
    box.addEventListener('keyup', ev => ev.stopPropagation());
    box.addEventListener('wheel', ev => {
        const bar = ev.target.closest && ev.target.closest('.tabs');          // über der Tab-Leiste: seitlich
        if (bar) { bar.scrollLeft += ev.deltaY || ev.deltaX; ev.preventDefault(); ev.stopPropagation(); return; }
        // Das Spiel fängt das Mausrad ab (Zoom) – deshalb scrollt das Panel selbst
        const bd = box.querySelector('.bd');
        if (!bd) return;
        if (ev.target.tagName === 'SELECT' && ev.target.size > 1) return;
        bd.scrollTop += ev.deltaMode === 1 ? ev.deltaY * 32 : ev.deltaY;
        ev.preventDefault(); ev.stopPropagation();
    }, { passive: false });
    box.addEventListener('keypress', ev => ev.stopPropagation());

    /* Panel im sichtbaren Bereich halten: auf dem Handy ist der Bildschirm schmaler als 390 px,
       und beim Drehen ins Hoch-/Querformat würde eine gespeicherte Position sonst draußen liegen */
    const clampBox = (x, y) => [Math.min(innerWidth - Math.min(60, box.offsetWidth || 60), Math.max(0, x)), Math.min(innerHeight - 40, Math.max(0, y))];
    const placeBox = () => {
        const [x, y] = clampBox(box.offsetLeft, box.offsetTop);
        box.style.left = Math.min(x, Math.max(0, innerWidth - box.offsetWidth - 8)) + 'px'; box.style.top = y + 'px';
    };
    if (cfg.x == null) box.style.left = Math.max(8, innerWidth - box.offsetWidth - 30) + 'px';
    if (typeof addEventListener === 'function') {   // fehlt nur in den Node-Simulationen
        placeBox();
        addEventListener('resize', placeBox);
        addEventListener('orientationchange', () => setTimeout(placeBox, 300));
    }

    /* Verschieben über Pointer-Events: geht mit Maus und Finger gleich */
    let dragging = null;
    box.addEventListener('pointerdown', ev => {
        ev.stopPropagation();
        if (!ev.target.closest('.hd') || ev.target.closest('button')) return;
        dragging = [ev.clientX - box.offsetLeft, ev.clientY - box.offsetTop, ev.pointerId];
        try { box.setPointerCapture(ev.pointerId); } catch (e) { }
    });
    box.addEventListener('pointermove', ev => {
        if (!dragging || ev.pointerId !== dragging[2]) return;
        const [x, y] = clampBox(ev.clientX - dragging[0], ev.clientY - dragging[1]);
        box.style.left = x + 'px'; box.style.top = y + 'px';
        ev.preventDefault();
    });
    const dragEnd = () => {
        if (dragging) { cfg.x = box.offsetLeft; cfg.y = box.offsetTop; save(); }
        dragging = null;
    };
    box.addEventListener('pointerup', dragEnd);
    box.addEventListener('pointercancel', dragEnd);

    /* Wischen im Panel: das Spiel wertet Touch-Gesten selbst aus (Karte ziehen, Zoom) und verhindert
       dabei das normale Scrollen. Darum scrollt das Panel wie beim Mausrad selbst und gibt nichts ans Spiel weiter. */
    let touchY = null;
    box.addEventListener('touchstart', ev => {
        ev.stopPropagation();
        touchY = ev.touches.length === 1 ? ev.touches[0].clientY : null;
    }, { passive: true });
    box.addEventListener('touchmove', ev => {
        ev.stopPropagation();
        const bd = box.querySelector('.bd');
        if (touchY == null || !bd || !bd.contains(ev.target) || dragging) return;
        if (ev.target.tagName === 'SELECT' && ev.target.size > 1) return;
        if (ev.target.type === 'range') return;
        const y = ev.touches[0].clientY;
        bd.scrollTop += touchY - y; touchY = y;
        if (ev.cancelable) ev.preventDefault();
    }, { passive: false });
    box.addEventListener('touchend', ev => { ev.stopPropagation(); touchY = null; });

    /* Weltkarte direkt aus dem öffentlichen Repo: am Handy ist Herunterladen + Datei wählen umständlich.
       GM_xmlhttpRequest umgeht die Content-Security-Policy der Spielseite; fetch nur als Rückfall
       (raw.githubusercontent.com erlaubt CORS, die Seite könnte es aber sperren). */
    const WORLD_URL = 'https://raw.githubusercontent.com/arek09082001/margobot-userscript/main/margobot_world.json';
    let worldDl = false;
    const fetchText = url => new Promise((ok, fail) => {
        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({ method: 'GET', url, timeout: 60000,
                onload: r => r.status === 200 ? ok(r.responseText) : fail(new Error('HTTP ' + r.status)),
                onerror: () => fail(new Error('keine Verbindung')), ontimeout: () => fail(new Error('Zeitüberschreitung')) });
        } else fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))).then(ok, fail);
    });
    function useWorld(t) {
        const d = JSON.parse(t), n = Object.keys(d).length, any = d[Object.keys(d)[0]];
        if (!n || !Array.isArray(any) || !Array.isArray(any[3])) throw new Error('keine Weltkarte');
        world = d; GM_setValue('mbworld', d); cfg.blocked = []; save();
        log('Weltkarte geladen: ' + n + ' Karten');
        xpKey = ''; lastStatic = ''; render();
    }

    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fmt = n => Math.round(n).toLocaleString('de-DE');
    let lastStatic = '', xpSel = 0, xpKey = '';
    const sess = Object.assign({ t0: 0, xp: 0, lastExp: 0, kills: 0, end: 0 }, cfg.sess && 'xp' in cfg.sess ? cfg.sess : {});   // Sitzung: ab dem letzten Start
    function startSession() { Object.assign(sess, { t0: Date.now(), exp0: 0, xp: 0, lastExp: (E().hero.d || {}).exp || 0, kills: 0, end: 0 }); saveSess(); }
    function countXp() {
        /* XP der Sitzung = Summe der Zuwächse. Ein Zuwachs zählt nur, wenn er kleiner als ein ganzes Level ist –
           so landet nie der Gesamtstand (Seite lädt noch, anderer Charakter) in der Statistik. */
        const e = +(E().hero.d || {}).exp || 0;
        if (!e) return;
        if (!sess.lastExp) { sess.lastExp = e; return; }
        const d = e - sess.lastExp;
        if (d > 0 && d < lvlXp(Math.max(1, heroLvl())) && running() && !sess.end) sess.xp = (sess.xp || 0) + d;
        sess.lastExp = e;
    }
    function saveSess() { cfg.sess = Object.assign({}, sess); save(); }
    function sessTick() {
        /* Läuft der Bot ohne Sitzung (nach Neuladen, Start durch Ablauf …) → jetzt starten; gestoppt → Zeit anhalten. */
        const run = running();
        if (run && (!sess.t0 || sess.end)) {
            if (!sess.t0 || Date.now() - sess.end > 30 * 60000) startSession();   // lange Pause → neue Sitzung
            else { sess.t0 += Date.now() - sess.end; sess.end = 0; saveSess(); }  // kurze Pause → weiterzählen
        } else if (!run && sess.t0 && !sess.end) { sess.end = Date.now(); saveSess(); }
    }
    function worldHasPos() { for (const k in world) { if (world[k][4].length) return Array.isArray(world[k][4][0][3]); } return false; }
    function heroLvl() { return (ok() && E().hero.d.lvl) || 0; }
    function pkInfo() {                             // was der Bot gerade sieht – zum Prüfen im echten Spiel
        if (!ok()) return '';
        const pv = mapPvp(), now = performance.now();
        const ps = players().slice(0, 4).map(p => { const r = pkSeen[p.id];
            return `${esc(p.nick)} (${p.lvl})${follows(p) ? ' · folgt' : r ? ` · nah ${Math.round((now - r.since) / 1000)}s` : ''}`; });
        return `Diese Karte: ${pv == null ? 'PvP unbekannt' : pv === 2 ? 'rot (PvP)' : 'PvP-Stufe ' + pv}${pkEsc ? ` · Flucht vor ${esc(pkEsc.nick)} (zuletzt vor ${Math.round((now - pkEsc.lastSeen) / 1000)} s)` : ''}<br>` +
               (ps.length ? 'Spieler: ' + ps.join(', ') : 'Keine anderen Spieler in Sicht');
    }
    let sugList = null, sugKey = '';
    const suggestionRange = () => cfg.suggestAuto && heroLvl() ? [Math.max(1, heroLvl() - 5), heroLvl() + 3] : [cfg.lvlMin, cfg.lvlMax];
    function refreshSug() {                         // fertige Routen nur neu rechnen, wenn Bereich/Karte sich ändern
        const [lo, hi] = suggestionRange();
        const k = [lo, hi, mapId(), worldN(), heroLvl(), cfg.expoAll, JSON.stringify(cfg.blockedAt || {}), JSON.stringify(cfg.tele || {}), Math.floor(Date.now() / 60000)].join('|');
        if (k === sugKey) return;
        sugKey = k;
        const forum = world ? forumRoutes(lo, hi, !!cfg.expoAll) : [];
        sugList = !world ? null : forum.length ? (cfg.expoAll ? forum : forum.slice(0, 5)) : suggestRoutes(lo, hi, 5);
    }
    function refreshXp() {                          // XP-Orte nur neu rechnen, wenn Bereich/Karte/Weltkarte sich ändern
        const k = [cfg.lvlMin, cfg.lvlMax, mapId(), worldN(), heroLvl()].join('|');
        if (k === xpKey) return;
        xpKey = k; xpSel = 0;
        xpList = world ? xpMaps(cfg.lvlMin, cfg.lvlMax, 5) : null;
    }

    function state() {
        if (deadNow) return ['dead', 'Tot', 'Warte auf Wiederbelebung'];
        if (capt.state === 'open' && running()) return ['dead', 'Pause: Zagadka', cfg.autoCaptcha ? (capt.solving ? 'Klicke *…*-Antworten…' : (cfg.autoCaptchaConfirm ? 'Auto-Lösen aktiv' : 'Antworten gewählt – bitte Potwierdzam')) : 'Bitte das Rätsel selbst lösen – danach geht es weiter'];
        if (cfg.chain) {
            const r = ruleById(cfg.chain.rid), st = r && r.steps[cfg.chain.i];
            return ['trv', 'Ablauf', `Schritt ${cfg.chain.i + 1}/${r ? r.steps.length : '?'}: ${st ? stepText(st) : ''}`];
        }
        if (cfg.travel) return ['trv', 'Unterwegs', cfg.travel.label + (lastTravel ? ` · noch ${lastTravel.left} ${lastTravel.left === 1 ? 'Karte' : 'Karten'}` + (lastTravel.tele ? ` (${lastTravel.tele}× Teleport)` : '') : '')];
        if (cfg.e2.on) { const t = e2Cur(); return [e2rt && e2rt.alive ? 'run' : 'trv', 'E2' + (t ? ' · ' + t.nick : ''), e2Text()]; }
        if (!cfg.on && cfg.tab === 'e2') { const t = e2Cur(), w = e2Window(t), n = Date.now();
            return ['', 'Bereit', !t ? 'E2 unten suchen und antippen' : t.nick + ' · ' + (!w ? 'Respawn unbekannt' : n < w.start ? 'Respawn in ' + mmss(w.start - n) : n < w.end ? 'Respawn jederzeit' : 'Respawn überfällig')]; }
        if (!cfg.on) return ['', 'Bereit', botMode() === 'route' ? (cfg.route ? 'Route „' + cfg.route + '“ gewählt · ' + mapName() : 'Route wählen oder aufnehmen') : 'XP-Ort wählen · ' + mapName()];
        if (cfg.back) return ['trv', 'Rückweg', cfg.back.map];
        if (inBattle()) return ['run', 'Kampf', mapName()];
        const p = lastPlan;
        if (offRoute && cfg.routes[cfg.route]) return offRoute.way
            ? ['trv', 'Weg zur Route', (lastTravel ? `noch ${lastTravel.left} ${lastTravel.left === 1 ? 'Karte' : 'Karten'} · ` : '') + 'greift unterwegs nichts an']
            : ['dead', 'Kein Weg zur Route', mapName() + ' – bitte selbst zur Route laufen'];
        if (!p && fog.on && !fog.doneAt) return ['run', 'Erkundet', `Nebel auf ${mapName()} · ${fog.pct} % abgesucht`];
        if (!p && fog.on && fog.doneAt) return ['run', 'Patrouille', `${fog.spawns.size} Fundstellen auf ${mapName()}`];
        if (cfg.routes[cfg.route] && !p) { const rs = routeStep(); return ['run', 'Route', rs ? (rs.n === 1 ? 'Jagdort · ' + mapName() : `${mapName()} → ${rs.next}`) : 'unterwegs zur Route']; }
        return ['run', cfg.routes[cfg.route] ? 'Route · Jagt' : 'Jagt', p ? `${p.order[0].nick} (${p.order[0].lvl}) · ${p.order.length + (p.more || 0)} Ziele auf ${mapName()}`
                                 : `Keine Ziele auf ${mapName()}`];
    }
    function etaHtml(perMin) {
        /* Nächstes Level: Für Level L braucht man insgesamt (L−1)^4 + 10 XP (offizielle Doku); ab Level 300 andere Regeln. */
        const d = E().hero.d || {}, L = +d.lvl || 0, e = +d.exp || 0;
        if (!L || !e || L >= 300) return '';
        const need = Math.pow(L, 4) + 10, rest = Math.max(0, need - e), done = 1 - rest / (need - (Math.pow(L - 1, 4) + 10));
        const pct = Math.max(0, Math.min(100, done * 100));
        let when = 'XP/min wird noch gemessen';
        if (perMin > 0) {
            const m = rest / perMin;
            when = m < 1 ? 'in unter 1 min' : m < 90 ? `in ~${Math.round(m)} min` : m < 48 * 60 ? `in ~${(m / 60).toFixed(1).replace('.', ',')} h` : `in ~${Math.round(m / 1440)} Tagen`;
        }
        return `<div class="eta"><div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>` +
               `<span>Lvl ${L + 1} ${when}</span><span class="r">noch ${fmtXp(rest)} XP · ${pct.toFixed(1).replace('.', ',')} %</span></div>`;
    }
    function sessHtml() {
        if (!sess.t0) return '';
        const min = ((sess.end || Date.now()) - sess.t0) / 60000, xp = Math.max(0, sess.xp || 0);
        const perMin = min >= 0.5 ? xp / min : 0;
        return `<span><b>${sess.kills}</b>Kills</span><span><b>${fmtXp(xp)}</b>XP</span>` +
               `<span><b>${perMin ? fmtXp(perMin) : '–'}</b>XP/min</span><span><b>${fmt(min)}</b>min</span>` + etaHtml(perMin);
    }

    function botMode() { return cfg.route ? 'route' : cfg.mode === 'route' ? 'route' : 'xp'; }
    function selectRoute(name) {
        /* Route aktiv machen: ihre Mob-Auswahl und ihren Level-Bereich übernehmen. */
        cfg.route = name || ''; cfg.routePos = 0;
        const r = cfg.routes[cfg.route];
        if (r) {
            cfg.lastRoute = name; cfg.mode = 'route';
            cfg.picked = Object.assign({}, r.picked || {});
            cfg.lvlOn = !!r.lvlOn; cfg.lvlMin = r.lvlMin || cfg.lvlMin; cfg.lvlMax = r.lvlMax || cfg.lvlMax;
            log('Route: ' + r.maps.map(entryName).join(' → '));
        }
    }

    function takeSuggestion(o) {
        if (!o || !o.n || running() || !Number.isFinite(o.d)) return false;
        let name = o.name, k = 2;
        // Eigene Routen gleichen Namens erhalten, auch wenn ihre Kartenfolge identisch ist.
        while (cfg.routes[name] && !(cfg.routes[name].gen && JSON.stringify(cfg.routes[name].maps) === JSON.stringify(o.maps)))
            name = o.name + ' (' + k++ + ')';
        cfg.routes[name] = { maps: o.maps.slice(), mode: o.mode, picked: {}, lvlOn: true,
            lvlMin: o.lv[0], lvlMax: o.lv[1], gen: true, source: o.source, forumId: o.forumId };
        selectRoute(name);
        return true;
    }
    function suggestionsHtml() {
        refreshSug();
        const [lo, hi] = suggestionRange(), sg = sugList || [];
        return `<h4>${cfg.expoAll ? 'Alle Forum-XP-Routen' : 'XP-Routen für Level ' + lo + '–' + hi}</h4>
            <label class="chk"><input type="checkbox" data-a="suggestAuto" ${cfg.suggestAuto ? 'checked' : ''}>Automatisch passend zu meinem Level</label>
            <button class="sub" data-a="expoall">${cfg.expoAll ? 'Nur passende Vorschläge zeigen' : 'Alle ' + FORUM_EXPOWISKA.length + ' Forum-Gebiete anzeigen'}</button>` +
            (!world ? '<div class="hint">Erst die Weltkarte laden.</div>' : sg.length ?
            `<div class="spots">${sg.map((o, i) => `<button class="spot" data-a="sugtake" data-i="${i}" ${running() || !o.n || !Number.isFinite(o.d) ? 'disabled' : ''}>
                <span class="nm">${esc(o.name)}</span>
                <span class="ds">${!o.n ? 'Mob-Daten fehlen' : !Number.isFinite(o.d) ? 'Anreise nicht bekannt' : o.d < 1 ? 'hier' : Math.round(o.d) + ' Schritte'}</span>
                <span class="mt">${o.source === 'forum' ? (o.recommended ? 'Im Forum empfohlen · ' : 'Forum · ') : 'Berechnet · '}Mob-Level ${o.lv[0]}–${o.lv[1]} · ${o.cards} Karten · ${o.n} Mobs · ${o.maps.length > 1 ? o.maps.length : 0} Kartenwechsel pro Runde</span>
                ${o.totalCards > o.cards ? `<span class="mt">Teilroute: ${o.cards} von ${o.totalCards} Gebietskarten; weitere Teile separat.</span>` : ''}
                <span class="mt">Karten: ${esc([...new Set(o.maps)].map(wname).join(' · '))}</span>
                <span class="mt xpl">${xpLine(o.r)}</span></button>`).join('')}</div>
                <div class="hint">${sg.some(o => o.source === 'forum') ? 'Gebiete aus dem Forum (23.06.2026), Rundgänge anhand der Weltkarte berechnet. ~Level ist der Mob-Durchschnitt, keine Heldenempfehlung.' : 'Aus der Weltkarte berechnet.'} Antippen übernimmt den Rundgang und den Mob-Level-Bereich; gestartet wird erst mit „Route starten“. ${running() ? 'Zum Wechseln zuerst stoppen.' : ''}</div>` :
            '<div class="hint">Keine erreichbare Rundroute für diesen Bereich. Andere Level wählen oder einen einzelnen XP-Ort nutzen.</div>');
    }

    function xpTab() {
        refreshXp();
        const run = running(), here = mapId(), l = heroLvl(), mode = botMode();
        const ro = cfg.routes[cfg.route], names = Object.keys(cfg.routes);
        let body, cta;
        if (mode === 'xp') {
            const sel = xpList && xpList[xpSel];
            if (!world) body = `<div class="empty">Damit der Bot XP-Orte findet und selbst hinläuft, lade einmal die Weltkarte.
                                 Sie kommt direkt aus dem GitHub-Repo, alternativ als Datei <b>margobot_world.json</b>.</div>`;
            else if (!xpList.length) body = `<div class="empty">Kein XP-Ort für Level ${cfg.lvlMin}–${cfg.lvlMax} erreichbar. Bereich größer machen?</div>`;
            else body = `<div class="spots">${xpList.map((o, i) => `
                <button class="spot ${i === xpSel ? 'sel' : ''} ${o.id === here ? 'here' : ''}" data-a="xpsel" data-i="${i}">
                  <span class="nm">${esc(wname(o.id))}</span>
                  <span class="ds">${o.id === here ? 'hier' : Math.round(o.d) + ' Schritte'}</span>
                  <span class="mt">Lvl ${o.lv[0] === o.lv[1] ? o.lv[0] : o.lv[0] + '–' + o.lv[1]} · ${o.n} Mobs · ${esc(o.mobs.join(', '))}</span>
                  <span class="mt xpl">${xpLine(o.r)}</span>
                </button>`).join('')}</div>`;
            if (run) cta = `<button class="cta stop" data-a="stopall">${ico('stop')}Stopp</button>`;
            else if (!world) cta = `<button class="cta" data-a="loadworldgh">${ico('map')}${worldDl ? 'Lädt …' : 'Weltkarte von GitHub laden'}</button>
                                    <button class="sub" data-a="loadworld">oder Datei wählen</button>`;
            else if (sel && sel.id === here) cta = `<button class="cta" data-a="huntxp">${ico('play')}Hier jagen</button>`;
            else if (sel) cta = `<button class="cta" data-a="goxp">${ico('play')}Hinlaufen & jagen</button>
                                 <button class="sub" data-a="huntxp">oder gleich hier jagen</button>`;
            else cta = `<button class="cta" data-a="huntxp">${ico('play')}Hier jagen</button>`;
        } else {
            const rec = cfg.rec ? `<button class="btn rec" data-a="rec">${ico('stop')}Aufnahme beenden (${cfg.rec.length} Karten)</button>`
                                : `<button class="btn" data-a="rec">${ico('rec')}Neue Route aufnehmen</button>`;
            refreshSug();
            if (!names.length) body = `<div class="empty">Noch keine eigene Route. Starte die Aufnahme und lauf deine Strecke einmal selbst ab –
                    die Mobs, die du dabei angreifst, merkt sich der Bot.</div><div class="fld">${rec}</div>`;
            else {
                const m = ro ? ro.maps.map(entryName) : [], z = m[m.length - 1], y = m[m.length - 2];
                body = `<select data-a="route">${ro ? '' : '<option value="">Route wählen …</option>'}
                      ${names.map(n => `<option value="${esc(n)}" ${cfg.route === n ? 'selected' : ''}>${esc(n)} · ${new Set(cfg.routes[n].maps).size} Karten</option>`).join('')}</select>
                    ${ro ? `<div class="spot sel route">
                      <span class="nm">${esc(m[0])} → ${esc(z)}</span><span class="ds">${new Set(ro.maps).size} Karten</span>
                      ${world ? (() => { const ml = [...new Set(ro.maps.flatMap(e => entryIds(e).slice(0, 1)))].flatMap(id => world[id] ? world[id][4].filter(x => x[1] >= cfg.lvlMin && x[1] <= cfg.lvlMax) : []);
                          return ml.length ? `<span class="mt xpl">${xpLine(rateXp(ml, heroLvl()))}</span>` : ''; })() : ''}
                      <span class="mt rprog"></span></div>
                      ${m.length > 2 ? `<div class="hint" style="margin-top:8px">Am Ende der Route</div>
                        <select data-a="rmode"><option value="back" ${routeMode(ro) === 'back' ? 'selected' : ''}>zurück: ${esc(z)} → ${esc(y)} → …</option>
                        <option value="loop" ${routeMode(ro) === 'loop' ? 'selected' : ''}>im Kreis: ${esc(z)} → ${esc(m[0])}</option></select>` : ''}` : ''}
                    <div class="fld">${rec}${ro && !cfg.rec ? `<button class="btn" data-a="delroute">${ico('trash')}Löschen</button>` : ''}</div>`;
            }
            if (run) cta = `<button class="cta stop" data-a="stopall">${ico('stop')}Stopp</button>`;
            else if (ro) cta = `<button class="cta" data-a="runroute">${ico('play')}Route „${esc(cfg.route)}“ starten</button>`;
            else cta = '';
        }
        return `
            <div class="now"><div class="st"><span class="dot"></span><span class="stl"></span></div>
              <div class="dt"></div><div class="kp"></div></div>
            <div class="seg">
              <button class="${mode === 'xp' ? 'on' : ''}" data-a="mode" data-m="xp"><b>XP-Ort suchen</b><span>bester Ort für dein Level</span></button>
              <button class="${mode === 'route' ? 'on' : ''}" data-a="mode" data-m="route"><b>Route laufen</b><span>fertige oder eigene Strecke</span></button>
            </div>
            <h4>${mode === 'xp' ? 'Level-Bereich' : 'Mobs angreifen von Level'}</h4>
            <div class="rg">
              <div class="stp"><button data-a="lvl" data-k="lvlMin" data-d="-1">−</button><input class="nb" data-a="lvlMin" inputmode="numeric" value="${cfg.lvlMin}"><button data-a="lvl" data-k="lvlMin" data-d="1">+</button></div>
              <span class="to">bis</span>
              <div class="stp"><button data-a="lvl" data-k="lvlMax" data-d="-1">−</button><input class="nb" data-a="lvlMax" inputmode="numeric" value="${cfg.lvlMax}"><button data-a="lvl" data-k="lvlMax" data-d="1">+</button></div>
              ${l ? `<button class="chip" data-a="lvlme" title="Level ${Math.max(1, l - 5)}–${l + 3}">um Lvl ${l}</button>` : ''}
            </div>
            <h4>${mode === 'xp' ? 'XP-Ort' : 'Route'}</h4>
            ${body}
            ${cta}
            ${suggestionsHtml()}
            <details ${cfg.logOpen ? 'open' : ''}><summary>${ico('chev')}Verlauf</summary><div class="log"></div></details>`;
    }

    function setTab() {
        const here = {};
        for (const m of mobs()) {
            const h = here[m.key] || (here[m.key] = { nick: m.nick, n: 0, lmin: m.lvl, lmax: m.lvl });
            h.n++; h.lmin = Math.min(h.lmin, m.lvl); h.lmax = Math.max(h.lmax, m.lvl);
        }
        const gws = gateways(), mn = mapName();
        return `
            ${heroNick ? `<div class="hint" style="margin:0 0 6px">Einstellungen für <b>${esc(heroNick)}</b> – jeder Held hat eigene (Routen, Level, E2 …). Kartenwissen gilt für alle.</div>` : ''}
            <h4>Ziele</h4>
            <label class="chk"><input type="checkbox" data-a="lvlOn" ${cfg.lvlOn ? 'checked' : ''}>Alle Mobs im Level-Bereich ${cfg.lvlMin}–${cfg.lvlMax}</label>
            <div class="hint">Zusätzlich einzelne Mobs auf ${esc(mn)}:</div>
            ${Object.entries(here).sort((a, b) => a[1].lmin - b[1].lmin).map(([k, h]) =>
                `<label class="chk"><input type="checkbox" data-k="${esc(k)}" ${cfg.picked[k] ? 'checked' : ''}>${esc(h.nick)}
                 <span class="lv">${h.lmin === h.lmax ? h.lmin : h.lmin + '–' + h.lmax} · ${h.n}×</span></label>`).join('') || '<div class="hint">keine Mobs auf dieser Karte</div>'}

            ${cfg.route ? '' : `<h4>Wenn die Karte leer ist</h4>
              <select data-a="exit"><option value="">hier bleiben und warten</option>
              ${gws.map(g => `<option value="${g.id}" ${String(cfg.exits[mn]) === String(g.id) ? 'selected' : ''}>weiter nach ${esc(g.name)}</option>`).join('')}</select>
              <div class="hint">Gilt für ${esc(mn)}. Mit Route bestimmt die Route den Ausgang.</div>`}

            <h4>Teleporter</h4>
            ${Object.keys(cfg.tele || {}).length ? Object.entries(cfg.tele).map(([mid, npcs]) => Object.entries(npcs).map(([npc, t]) =>
                `<div class="hint"><b style="color:var(--tx)">${esc(wname(+mid))}</b> · ${esc(npc)} → ${Object.keys(t.to).map(id => esc(wname(+id))).join(', ')}</div>`).join('')).join('') +
                `<button class="btn" data-a="teleforget" style="margin-top:6px">${ico('trash')}Teleporter vergessen</button>`
              : '<div class="hint">Noch keiner bekannt. Sprich in einer Stadt mit dem Teleport-NPC und öffne seine Zielliste (einfach anschauen, nicht reisen) – der Bot merkt sich die Ziele und nutzt sie ab dann für kürzere Wege.</div>'}

            <h4>Zu einer Karte laufen</h4>
            ${world ? `<div class="fld"><input type="text" data-a="dest" placeholder="Name, z. B. Torneg" value="${esc(destText)}">
              <button class="btn pri" data-a="go">${ico('pin')}Hin</button></div>
              <div class="hint">Unbekannte englische Namen: polnischen Namen eingeben (z. B. Stare Ruiny).</div>`
              : '<div class="hint">Erst die Weltkarte laden.</div>'}

            <h4>Verhalten</h4>
            <div class="fld"><span>Reihenfolge</span></div>
            <select data-a="optimal"><option value="1" ${cfg.optimal ? 'selected' : ''}>kürzeste Route über alle Mobs</option>
              <option value="0" ${cfg.optimal ? '' : 'selected'}>immer den nächsten Mob</option></select>
            <div class="fld"><span>Pause (ms)</span><input class="num" data-a="pauseMin" value="${cfg.pauseMin}">–<input class="num" data-a="pauseMax" value="${cfg.pauseMax}"></div>
            <label class="chk"><input type="checkbox" data-a="closeBattle" ${cfg.closeBattle ? 'checked' : ''}>Kampffenster nach dem Kampf schließen</label>
            <label class="chk"><input type="checkbox" data-a="fogExplore" ${cfg.fogExplore !== false ? 'checked' : ''}>Nebel-Karten erkunden</label>
            <div class="fld"><span>Nebel: weiter nach</span><select data-a="fogPct" style="width:auto">${[100, 75, 50].map(v =>
                `<option value="${v}" ${(+cfg.fogPct || 100) === v ? 'selected' : ''}>${v} % der Mob-Plätze</option>`).join('')}</select></div>
            ${world && !worldHasPos() ? '<div class="hint">Deine Weltkarte kennt noch keine Mob-Plätze. Unten bei Weltkarte „Von GitHub“ tippen, dann sucht der Bot im Nebel gezielt.</div>' : ''}
            <label class="chk"><input type="checkbox" data-a="autoCaptcha" ${cfg.autoCaptcha ? 'checked' : ''}>Zagadka: Antworten mit * automatisch anklicken</label>
            <label class="chk"><input type="checkbox" data-a="autoCaptchaConfirm" ${cfg.autoCaptchaConfirm ? 'checked' : ''}>Zagadka: danach auch „Potwierdzam“ klicken</label>
            <label class="chk"><input type="checkbox" data-a="captchaWarn" ${cfg.captchaWarn !== false ? 'checked' : ''}>Bei Zagadka Ton und Benachrichtigung</label>
            <div class="hint">Vorwarnung (Zähler) → Bot jagt weiter. Sobald das Fenster da ist: Bot pausiert und klickt (wenn aktiv) alle *…*-Antworten. „Potwierdzam“ nur bei zweiter Option.</div>
            <div class="hint">Nebel gibt es nur auf roten Karten: Dort sieht der Bot nur Mobs in seiner Nähe. Er läuft die bekannten Mob-Plätze nacheinander ab und geht weiter, wenn genug davon abgesucht sind. Mobs, die hinter der Sichtgrenze verschwinden, merkt er sich.</div>

            <h4>Andere Spieler</h4>
            <select data-a="pkMode"><option value="off" ${cfg.pk.mode === 'off' ? 'selected' : ''}>nicht beachten</option>
              <option value="follow" ${cfg.pk.mode === 'follow' ? 'selected' : ''}>reagieren, wenn mir jemand folgt</option>
              <option value="any" ${cfg.pk.mode === 'any' ? 'selected' : ''}>reagieren auf jeden Spieler auf der Karte</option></select>
            ${cfg.pk.mode === 'off' ? '' : `
            ${cfg.pk.mode === 'follow' ? `<div class="fld"><span>Folgt, wenn</span><input class="num" data-a="pk" data-f="near" value="${cfg.pk.near}">Felder ·
              <input class="num" data-a="pk" data-f="sec" value="${cfg.pk.sec}">s</div>` : ''}
            <div class="fld"><span>Kämpfen bis</span><input class="num" data-a="pk" data-f="maxUp" value="${cfg.pk.maxUp}">Lvl über mir</div>
            <div class="fld"><span>Nie angreifen</span><input type="text" data-a="pkNever" value="${esc(cfg.pk.never || '')}" placeholder="Namen, mit Komma"></div>
            <div class="hint">Rote Karte und höchstens so viele Level über dir: der Bot kämpft (schnelle Walka). Gelbe Karte, Verfolger im Levelbereich und aktive Route: direkt zur nächsten Routenkarte, dort weiterjagen. Sonst flieht er: durch Türen weg vom Spieler, bevorzugt in Höhlen, bis er ihn 30 s nicht mehr sieht. Danach zurück zum Jagdort.</div>
            <div class="hint pkinfo">${pkInfo()}</div>`}

            <h4>Bei Tod</h4>
            <select data-a="onDeath"><option value="stop" ${cfg.onDeath === 'stop' ? 'selected' : ''}>Bot stoppen</option>
              <option value="back" ${cfg.onDeath === 'back' ? 'selected' : ''}>zurücklaufen und weitermachen</option></select>
            ${(cfg.deaths || []).length ? `<div class="deaths" style="margin-top:8px">${cfg.deaths.slice(0, 5).map(d =>
                `${esc(d.time)} · ${esc(d.map)}${d.target ? ' · ' + esc(d.target) : ''}`).join('<br>')}</div>
                <button class="btn" data-a="clearDeaths" style="margin-top:6px">Liste leeren</button>` : ''}

            <h4>Weltkarte</h4>
            <div class="fld"><span>${world ? worldN() + ' Karten geladen' : 'nicht geladen'}</span>
              <span style="display:flex;gap:6px"><button class="btn" data-a="loadworldgh">${ico('map')}${worldDl ? 'Lädt …' : 'Von GitHub'}</button>
              <button class="btn" data-a="loadworld">Datei</button></span></div>
            <div class="hint perf"></div>`;
    }

    // ── Tab „Abläufe“ ──
    let editId = null;
    const TEMPLATES = [
        { name: 'Level-Aufstieg', when: { t: 'lvl', n: 25 }, steps: [{ t: 'equip', name: '' }, { t: 'xp' }],
          tip: 'Bei Level 25 neue Ausrüstung anlegen und zum passenden XP-Ort' },
        { name: 'Tränke nachkaufen', when: { t: 'heal', n: 5 }, steps: [{ t: 'go', map: '' }, { t: 'npc', name: '', say: '' }, { t: 'sell', what: 'quick123' }, { t: 'buy', n: 30, name: '', closeAfter: true }, { t: 'back' }],
          tip: 'Zur Stadt, Beute verkaufen, Tränke kaufen, zurück zum Jagdort' },
        { name: 'Leben niedrig', when: { t: 'hp', n: 30 }, steps: [{ t: 'fill' }],
          tip: 'Mit Tränken heilen, dann weiterjagen' },
        { name: 'Nach dem Tod', when: { t: 'death' }, steps: [{ t: 'npc', name: '', say: '' }, { t: 'sell', what: 'quick123' }, { t: 'buy', n: 30, name: '', closeAfter: true }, { t: 'fill' }, { t: 'back' }],
          tip: 'Beute verkaufen, Tränke kaufen, heilen, zurück zum Jagdort' }
    ];
    const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    function ruleById(id) { return (cfg.rules || []).find(r => r.id === id); }

    const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
    const keep = (list, cur, label) => cur && !list.includes(cur) ? opt(cur, cur + ' ' + label, cur) : '';
    function itemOptions(s, which) {
        /* Ausrüsten: Taschen-Gegenstände (mit Level-Anforderung), angelegte als Info; Benutzen: Verbrauchsgüter zuerst. */
        const b = bag(), w = worn(), L = d => { const l = parseStat(d.stat).lvl; return l ? ' · ab Lvl ' + l : ''; };
        const uniq = list => Array.from(new Map(list.map(d => [d.name, d])).values());
        const cons = uniq(b.filter(d => isPotion(d) || parseStat(d.stat).amount));
        const rest = uniq(b.filter(d => !cons.includes(d)));
        let h = `<option value="" ${s.name ? '' : 'selected'} disabled>Gegenstand wählen …</option>`;
        if (which === 'use') {
            if (cons.length) h += `<optgroup label="Verbrauchsgüter">${cons.map(d => opt(d.name, d.name, s.name)).join('')}</optgroup>`;
            if (rest.length) h += `<optgroup label="Andere in der Tasche">${rest.map(d => opt(d.name, d.name, s.name)).join('')}</optgroup>`;
        } else {
            if (rest.length) h += `<optgroup label="In der Tasche">${rest.map(d => opt(d.name, d.name + L(d), s.name)).join('')}</optgroup>`;
            if (w.length) h += `<optgroup label="Schon angelegt">${uniq(w).map(d => opt(d.name, d.name, s.name)).join('')}</optgroup>`;
        }
        return h + keep(b.concat(w).map(d => d.name), s.name, '(nicht in der Tasche)');
    }
    function mapOptions(s, q) {
        /* Karten: aktuelle, Routen-Karten und besuchte (englische Namen); mit Suchtext alle Treffer der Weltkarte. */
        const cur = String(s.map || ''), seen = new Set();
        const o = (id, label) => { if (seen.has(String(id))) return ''; seen.add(String(id)); return opt(String(id), label, cur); };
        let h = `<option value="" ${cur ? '' : 'selected'} disabled>Karte wählen …</option>`;
        if (q) {
            const hits = findMaps(q).slice(0, 40);
            h += `<optgroup label="Treffer für „${esc(q)}“">${hits.map(id => o(id, wname(id))).join('') || '<option disabled>nichts gefunden</option>'}</optgroup>`;
        }
        if (/^\d+$/.test(cur)) h += o(cur, wname(+cur));
        h += `<optgroup label="Hier">${o(mapId(), wname(mapId()))}</optgroup>`;
        const rids = Array.from(new Set(Object.values(cfg.routes).flatMap(r => r.maps.flatMap(e => entryIds(e).slice(0, 1)))));
        if (rids.length) h += `<optgroup label="Aus deinen Routen">${rids.map(id => o(id, wname(id))).join('')}</optgroup>`;
        const known = Object.keys(cfg.names).sort((x, y) => wname(x).localeCompare(wname(y)));
        if (known.length) h += `<optgroup label="Bekannte Karten">${known.map(id => o(id, wname(id))).join('')}</optgroup>`;
        if (cur && !/^\d+$/.test(cur)) h += opt(cur, cur, cur);
        return h;
    }
    function npcOptions(s) {
        const cur = s.name || '';
        let h = `<option value="" ${cur ? '' : 'selected'} disabled>NPC wählen …</option>`;
        const here = npcList().map(d => d.nick);
        if (here.length) h += `<optgroup label="Hier auf ${esc(mapName())}">${Array.from(new Set(here)).map(n => opt(n, n, cur)).join('')}</optgroup>`;
        for (const [id, list] of Object.entries(cfg.npcs || {})) {
            if (+id === mapId() || !list.length) continue;
            h += `<optgroup label="${esc(wname(+id))}">${list.map(n => opt(n, n, cur)).join('')}</optgroup>`;
        }
        return h + keep(Object.values(cfg.npcs || {}).flat().concat(here), cur, '');
    }
    function answerOptions(s) {
        const list = (cfg.dlg || {})[s.name] || [], cur = s.say || '';
        return opt('', 'nur ansprechen', cur) +
            list.map(a => opt(a, a.length > 48 ? a.slice(0, 46) + '…' : a, cur)).join('') + keep(list, cur, '');
    }
    function buyOptions(s, r, i) {
        /* Ladenartikel: vom NPC aus dem Schritt davor zuerst, dann alle anderen bekannten Läden. */
        const prevNpc = (r.steps.slice(0, i).reverse().find(x => x.t === 'npc') || {}).name, cur = s.name || '';
        const shops = Object.entries(cfg.shops || {}).sort((a, b) => (b[0] === prevNpc) - (a[0] === prevNpc));
        let h = `<option value="" ${cur ? '' : 'selected'} disabled>Artikel wählen …</option>`;
        const open = Array.from(new Set(shopEntries().map(x => x.name)));
        if (open.length) h += `<optgroup label="Im offenen Laden">${open.map(n => opt(n, n, cur)).join('')}</optgroup>`;
        for (const [npc, list] of shops) { const rest = list.filter(n => !open.includes(n)); if (rest.length) h += `<optgroup label="${esc(npc)}">${rest.map(n => opt(n, n, cur)).join('')}</optgroup>`; }
        return h + keep(open.concat(shops.flatMap(x => x[1])), cur, '');
    }
    const stepper = (r, i, f, v, min, max) => `<div class="stp sm"><button data-a="snum" data-r="${r.id}" data-i="${i}" data-f="${f}" data-d="-1">−</button>` +
        `<input class="nb num" data-a="sf" data-r="${r.id}" data-i="${i}" data-f="${f}" inputmode="numeric" value="${esc(v)}" data-min="${min}" data-max="${max}">` +
        `<button data-a="snum" data-r="${r.id}" data-i="${i}" data-f="${f}" data-d="1">+</button></div>`;
    function stepFields(r, s, i) {
        const A = `data-r="${r.id}" data-i="${i}"`;
        const closeBox = `<label class="chk"><input type="checkbox" data-a="sfc" ${A} data-f="closeAfter" ${s.closeAfter ? 'checked' : ''}>Danach Laden schließen</label>`;
        if (s.t === 'sell' || s.t === 'buy') return stepFieldsInner(r, s, i, A) + closeBox;
        return stepFieldsInner(r, s, i, A);
    }
    function stepFieldsInner(r, s, i, A) {
        switch (s.t) {
            case 'equip': case 'use':
                return `<select data-a="sf" ${A} data-f="name">${itemOptions(s, s.t)}</select>` +
                    (bag().length ? '' : '<div class="hint">Keine Gegenstände gefunden – „Spieldaten prüfen“ unten.</div>');
            case 'go':
                return `<select data-a="sf" ${A} data-f="map">${mapOptions(s, mapQ[r.id + ':' + i])}</select>
                        <input type="text" class="q" data-a="mapq" ${A} placeholder="andere Karte suchen …" value="${esc(mapQ[r.id + ':' + i] || '')}">`;
            case 'npc':
                return `<select data-a="sf" ${A} data-f="name">${npcOptions(s)}</select>
                        <div class="fld"><span>Antwort</span><select data-a="sf" ${A} data-f="say">${answerOptions(s)}</select></div>
                        ${(cfg.dlg || {})[s.name] ? '' : '<div class="hint">Antworten lernt der Bot, sobald du einmal selbst mit dem NPC sprichst.</div>'}`;
            case 'buy':
                return `<div class="fld">${stepper(r, i, 'n', s.n || 1, 1, 999)}<select data-a="sf" ${A} data-f="name" style="flex:1">${buyOptions(s, r, i)}</select></div>
                        ${Object.keys(cfg.shops || {}).length || shopOpen() ? '' : '<div class="hint">Öffne einmal den Laden des Händlers – dann stehen seine Artikel hier zur Auswahl.</div>'}
                        <div class="hint">Jeder Klick im Laden kauft einen Stapel; die Anzahl wird auf ganze Stapel aufgerundet.</div>`;
            case 'xp': {
                const auto = !s.min;
                return `<select data-a="sxp" ${A}>${opt('auto', 'Level-Bereich: um mein Level (−5 bis +3)', auto ? 'auto' : '')}${opt('fix', 'Level-Bereich: fest', auto ? '' : 'fix')}</select>
                        ${auto ? '' : `<div class="fld">${stepper(r, i, 'min', s.min, 1, 300)}<span class="to">bis</span>${stepper(r, i, 'max', s.max || s.min, 1, 300)}</div>`}`;
            }
            case 'sell': {
                const n = sellList(s.what || 'gear');
                return `<select data-a="sf" ${A} data-f="what">${Object.entries(SELL).map(([k, v]) => opt(k, v.label, s.what || 'gear')).join('')}</select>
                        ${SELL[s.what] && SELL[s.what].bags
                            ? '<div class="hint">Nutzt die Schnellverkauf-Knöpfe des Ladens – verkauft wird, was das Spiel dabei auswählt. Davor muss ein Schritt „NPC ansprechen“ den Laden öffnen.</div>'
                            : `<div class="hint">Angelegtes, Tränke und Quest-Gegenstände bleiben immer. Jetzt wären es ${n.length} Gegenstände${n.length ? ': ' + esc(n.slice(0, 3).map(d => d.name).join(', ')) + (n.length > 3 ? ' …' : '') : ''}.</div>`}`;
            }
            case 'wait': return `<div class="fld">${stepper(r, i, 's', s.s || 2, 1, 600)}<span>Sekunden</span></div>`;
            default: return '';
        }
    }
    const mapQ = {};
    function stepEditor(r, s, i) {
        const f = stepFields(r, s, i);
        return `<li class="se">
            <div class="fld"><span class="no">${i + 1}</span>
              <select data-a="st" data-r="${r.id}" data-i="${i}">${Object.entries(STEP).map(([k, v]) =>
                  `<option value="${k}" ${k === s.t ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
              <button class="ib" data-a="smv" data-r="${r.id}" data-i="${i}" data-d="-1" title="nach oben" ${i ? '' : 'disabled'}>${ico('up')}</button>
              <button class="ib" data-a="sdel" data-r="${r.id}" data-i="${i}" title="Schritt löschen">${ico('x')}</button></div>
            ${f ? `<div class="sf">${f}</div>` : ''}</li>`;
    }
    function ruleView(r) {
        const c = COND[r.when.t] || {}, run = cfg.chain && cfg.chain.rid === r.id, done = c.once && r.done;
        if (editId === r.id) return `
            <div class="rule edit">
              <div class="fld"><span class="wn">Wenn</span>
                <select data-a="wt" data-r="${r.id}">${Object.entries(COND).map(([k, v]) =>
                    `<option value="${k}" ${k === r.when.t ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
                ${c.unit !== null ? `<div class="stp sm"><button data-a="wnum" data-r="${r.id}" data-d="-1">−</button><input class="nb" inputmode="numeric" data-a="wn" data-r="${r.id}" value="${r.when.n ?? ''}"><button data-a="wnum" data-r="${r.id}" data-d="1">+</button></div>${c.unit ? `<span class="to">${c.unit}</span>` : ''}` : ''}</div>
              <div class="wn dann">dann der Reihe nach</div>
              <ol class="steps ed">${r.steps.map((s, i) => stepEditor(r, s, i)).join('')}</ol>
              <div class="fld"><button class="btn" data-a="sadd" data-r="${r.id}">${ico('plus')}Schritt</button>
                <span></span><button class="btn bad" data-a="rdel" data-r="${r.id}">${ico('trash')}</button>
                <button class="btn pri" data-a="redit" data-r="">${ico('check')}Fertig</button></div>
            </div>`;
        return `
            <div class="rule ${r.on ? '' : 'off'} ${run ? 'run' : ''}">
              <div class="rh">
                <label class="sw" title="${r.on ? 'aktiv' : 'aus'}"><input type="checkbox" data-a="ron" data-r="${r.id}" ${r.on ? 'checked' : ''}><i></i></label>
                <div class="rt2"><b>${esc(whenText(r.when))}</b>${done ? '<span class="tag">erledigt</span>' : ''}</div>
                <button class="ib" data-a="rrun" data-r="${r.id}" title="Jetzt ausführen">${ico('play')}</button>
                <button class="ib" data-a="redit" data-r="${r.id}" title="Bearbeiten">${ico('edit')}</button>
              </div>
              <ol class="steps">${r.steps.map((s, i) =>
                  `<li class="${run && cfg.chain.i === i ? 'cur' : run && cfg.chain.i > i ? 'past' : ''}"><span class="no">${i + 1}</span>${esc(stepText(s))}</li>`).join('')
                  || '<li class="past"><span class="no">–</span>noch keine Schritte</li>'}</ol>
              ${done ? `<button class="sub" data-a="rreset" data-r="${r.id}">wieder scharf schalten</button>` : ''}
            </div>`;
    }
    function rulesTab() {
        const rules = cfg.rules || [];
        return `
            ${cfg.chain ? `<div class="now"><div class="st"><span class="dot trv"></span>Ablauf läuft</div><div class="dt cdt"></div>
                <button class="btn" data-a="cstop" style="margin-top:8px">${ico('stop')}Abbrechen</button></div>` : ''}
            ${rules.length ? `<h4>Deine Abläufe</h4>${rules.map(ruleView).join('')}` :
              `<div class="empty">Ein Ablauf startet von selbst, wenn seine Bedingung eintritt, und arbeitet dann seine Schritte der Reihe nach ab.
                 Danach jagt der Bot weiter. Starte mit einer Vorlage:</div>`}
            <h4>${rules.length ? 'Neu' : 'Vorlagen'}</h4>
            <div class="tpl">${TEMPLATES.map((t, i) => `<button class="tp" data-a="tpl" data-i="${i}"><b>${t.name}</b><span>${t.tip}</span></button>`).join('')}
              <button class="tp" data-a="radd"><b>Leerer Ablauf</b><span>Bedingung und Schritte selbst wählen</span></button></div>
            <div class="hint">Läuft nur, solange der Bot jagt. Mit ${ico('play')} startest du einen Ablauf sofort.</div>
            <details><summary>${ico('chev')}Spieldaten prüfen</summary><div class="log diag"></div></details>`;
    }
    function captchaDiag() {
        /* Was hängt am Antwort-Knopf? Zum Nachsehen bei offenem Rätsel (jQuery-Handler, Klassen, Engine-Teile). */
        const out = [];
        try { out.push('Engine-Teile mit „captcha“: ' + (Object.keys(E() || {}).filter(k => /captcha|zagad|riddle/i.test(k)).join(', ') || 'keine')); } catch (e) {}
        const c = captchaOpen(), b = c && c.querySelector('.button');
        if (!b) return out.join('\n');
        out.push('Knopf-Klassen: ' + b.className);
        const $ = W.jQuery || W.$;
        try {
            const evs = $ && $._data ? ($._data(b, 'events') || {}) : {}, evp = $ && $._data ? ($._data(c, 'events') || {}) : {};
            out.push('jQuery am Knopf: ' + (Object.keys(evs).join(', ') || '–') + ' · am Rahmen: ' + (Object.keys(evp).join(', ') || '–'));
        } catch (e) {}
        const on = ['onclick', 'onmousedown', 'ontouchstart', 'ontouchend', 'onpointerdown'].filter(k => b[k] || (b.querySelector('.label') || {})[k]);
        out.push('Inline-Handler: ' + (on.join(', ') || '–'));
        return out.join('\n');
    }
    function diagText() {
        const it = allItems();
        return [
            'Spielbefehl _g: ' + (typeof W._g === 'function' ? 'da' : 'FEHLT'),
            'Gegenstände gefunden: ' + it.length + ' (Tasche ' + bag().length + ', angelegt ' + worn().length + ')',
            'Heiltränke: ' + potionCount(),
            'Zagadka: ' + (captchaOpen() ? 'offen' : capt.state === 'soon' ? 'kommt bald' : 'keine') + ' · Gerät: ' + (touchDev() ? 'Handy/Touch' : 'PC') +
                ' · Klick-Art: ' + (cfg.captchaClick || 'noch keine') + ' · jQuery: ' + (typeof (W.jQuery || W.$) === 'function' ? 'da' : 'fehlt') + '\n' + captchaDiag() + '\n' +
                ' · Elemente „captcha“ im Spiel: ' + (document.querySelectorAll('[class*="captcha"]').length),
            'Verkaufbar (normale Ausrüstung): ' + sellList('gear').length,
            'Leben: ' + Math.round(hpPct()) + ' %',
            'NPCs hier: ' + npcList().slice(0, 6).map(d => d.nick).join(', '),
            'Dialog offen: ' + (dialogOpen() ? 'ja' : 'nein') + ' · Laden offen: ' + (shopOpen() ? 'ja' : 'nein'),
            ...(shopOpen() ? (() => { const sb = shopButtons(); return [
                'Taschen-Knöpfe: ' + (Object.keys(sb.bag).sort().join(', ') || 'keine'),
                'Ladenartikel lesbar: ' + shopEntries().length + (shopEntries().length ? ' (' + shopEntries().slice(0, 3).map(x => x.name + ' ×' + x.stack).join(', ') + ')' : '') + ' · Händler: ' + (nearNpcName() || '?'),
                'Im Verkaufskorb: ' + basketCount(),
                'Bestätigen-Knopf: ' + (sb.accept ? ((sb.accept.innerText || tipOf(sb.accept)).trim().slice(0, 25) || sb.accept.className) : 'nicht gefunden'),
                'Alle Knöpfe im Laden: ' + sb.all.slice(0, 14).map(el => ((tipOf(el) || el.innerText || '').trim().slice(0, 18) || String(el.className).split(' ')[0])).join(' | ')]; })() : [])
        ].join('\n');
    }
    function rulesClick(a, el) {
        const r = ruleById(el.dataset.r), i = +el.dataset.i;
        if (a === 'tpl') {
            const t = TEMPLATES[i];
            const nr = { id: newId(), on: true, when: Object.assign({}, t.when), steps: t.steps.map(s => Object.assign({}, s)) };
            cfg.rules = (cfg.rules || []).concat([nr]); editId = nr.id;
        } else if (a === 'radd') {
            const nr = { id: newId(), on: true, when: { t: 'lvl', n: heroLvl() + 1 || 2 }, steps: [] };
            cfg.rules = (cfg.rules || []).concat([nr]); editId = nr.id;
        } else if (a === 'redit') editId = el.dataset.r || null;
        else if (a === 'rrun' && r) startRule(r, 'von Hand');
        else if (a === 'rreset' && r) { r.done = false; delete lastCond[r.id]; }
        else if (a === 'rdel' && r) { if (W.confirm('Ablauf „' + whenText(r.when) + '“ löschen?')) { cfg.rules = cfg.rules.filter(x => x !== r); editId = null; } }
        else if (a === 'sadd' && r) r.steps.push({ t: 'equip' });
        else if (a === 'snum' && r) {
            const st = r.steps[i], f = el.dataset.f, inp = el.parentElement.querySelector('input');
            const lo = +(inp && inp.dataset.min) || 1, hi = +(inp && inp.dataset.max) || 999;
            st[f] = Math.min(hi, Math.max(lo, (+st[f] || (f === 'n' ? 1 : f === 's' ? 2 : heroLvl())) + +el.dataset.d));
            if (f === 'min' && +st.max < st.min) st.max = st.min;
            if (f === 'max' && +st.min > st.max) st.min = st.max;
        }
        else if (a === 'wnum' && r) {
            const step = r.when.t === 'gold' ? 1000 : r.when.t === 'hp' ? 5 : 1;
            r.when.n = Math.max(0, (+r.when.n || 0) + step * +el.dataset.d); r.done = false; delete lastCond[r.id];
        }
        else if (a === 'sdel' && r) r.steps.splice(i, 1);
        else if (a === 'smv' && r && i > 0) [r.steps[i - 1], r.steps[i]] = [r.steps[i], r.steps[i - 1]];
        else if (a === 'cstop') { if (cfg.chain) endChain('von Hand'); }
        else return false;
        return true;
    }
    function rulesChange(t) {
        const a = t.dataset.a, r = ruleById(t.dataset.r);
        if (!r) return false;
        const i = +t.dataset.i;
        if (a === 'ron') { r.on = t.checked; delete lastCond[r.id]; }
        else if (a === 'wt') { r.when = { t: t.value, n: COND[t.value].def }; r.done = false; delete lastCond[r.id]; }
        else if (a === 'wn') { r.when.n = parseInt(t.value, 10) || 0; r.done = false; delete lastCond[r.id]; }
        else if (a === 'st') r.steps[i] = t.value === 'buy' ? { t: 'buy', n: 30, closeAfter: true } : t.value === 'wait' ? { t: 'wait', s: 2 } : t.value === 'sell' ? { t: 'sell', what: 'quick123' } : { t: t.value };
        else if (a === 'sxp') { if (t.value === 'auto') { delete r.steps[i].min; delete r.steps[i].max; } else { r.steps[i].min = Math.max(1, heroLvl() - 2); r.steps[i].max = heroLvl() + 3; } }
        else if (a === 'sfc') r.steps[i][t.dataset.f] = t.checked;
        else if (a === 'sf') { const f = t.dataset.f; r.steps[i][f] = t.classList.contains('num') ? (parseInt(t.value, 10) || '') : t.value.trim(); }
        else return false;
        return true;
    }

    // ── Tab „E2“ ──
    let e2Q = '';
    function e2Hits(q) {
        /* Suche in den E2 der Weltkarte: Name oder Karte; ohne Suchtext die E2 um das eigene Level. */
        const all = e2World(), f = fold(q), l = heroLvl();
        const hit = f ? all.filter(o => fold(o.nick).includes(f) || fold(wname(o.map)).includes(f))
                      : all.filter(o => Math.abs(o.lvl - l) <= 25).sort((a, b) => Math.abs(a.lvl - l) - Math.abs(b.lvl - l));
        return hit.slice(0, 8);
    }
    function e2HitsHtml() {
        const h = e2Hits(e2Q);
        if (!world) return '<div class="hint">Erst die Weltkarte laden (Einstellungen → Weltkarte) – dann gibt es hier alle E2 mit Spawnpunkt.</div>';
        return h.length ? `<div class="spots">${h.map((o, i) => `
            <button class="spot ${cfg.e2.list[e2Key(o.nick, o.map)] ? 'sel' : ''}" data-a="e2add" data-n="${esc(o.nick)}" data-m="${o.map}">
              <span class="nm">${esc(o.nick)}</span><span class="ds">Lvl ${o.lvl}</span>
              <span class="mt">${esc(wname(o.map))}${o.x != null ? ' · ' + o.x + ',' + o.y : ''}</span></button>`).join('')}</div>`
            : `<div class="hint">Keine E2 zu „${esc(e2Q)}“ in der Weltkarte. Steht sie gerade vor dir, unten „Auf dieser Karte“ nutzen.</div>`;
    }
    function e2Tab() {
        const E2 = cfg.e2, t = e2Cur(), keys = Object.keys(E2.list), run = running();
        const stp = (f, v, lo, hi) => `<div class="stp sm"><button data-a="e2num" data-f="${f}" data-d="-1" data-lo="${lo}" data-hi="${hi}">−</button>` +
            `<input class="nb" data-a="e2set" data-f="${f}" inputmode="numeric" value="${v}"><button data-a="e2num" data-f="${f}" data-d="1" data-lo="${lo}" data-hi="${hi}">+</button></div>`;
        const w = t && e2Window(t);
        // Mobs auf dieser Karte (falls eine E2 fehlt oder kein e2/-Icon hat): einzelne Namen, höchstes Level zuerst
        const here = Array.from(new Map(mobs().sort((a, b) => b.lvl - a.lvl).map(m => [m.nick, m])).values()).slice(0, 6);
        return `
            <div class="now"><div class="st"><span class="dot"></span><span class="stl"></span></div><div class="dt"></div></div>
            <h4>Boss</h4>
            ${keys.length ? `<select data-a="e2sel">${keys.map(k => `<option value="${esc(k)}" ${k === E2.sel ? 'selected' : ''}>${esc(E2.list[k].nick)} (${E2.list[k].lvl || '?'}) · ${esc(wname(E2.list[k].map))}</option>`).join('')}</select>` :
              '<div class="empty">Noch keine E2 gewählt. Unten suchen und antippen.</div>'}
            ${t ? `
            <div class="spot sel route">
              <span class="nm">${esc(t.nick)}</span><span class="ds">${t.kills || 0} Kills</span>
              <span class="mt">${esc(wname(t.map))} · Spawn ${t.x != null ? t.x + ',' + t.y : 'unbekannt – wird gemerkt, sobald sie einmal da war'}</span>
              <span class="mt xpl">${t.lastKill ? `Zuletzt tot ${clock(t.lastKill)}${t.by === 'other' ? ' (anderer Spieler)' : ''} · Respawn ${clock(w.start)}–${clock(w.end)}` : 'Noch kein Tod gesehen – Timer startet beim ersten Kill'}</span>
              ${(t.meas || []).length ? `<span class="mt">Gemessen: ${t.meas.map(x => String(x).replace('.', ',')).join(' · ')} min</span>` : ''}
            </div>
            <div class="hint" style="margin-top:10px">Respawn nach (Minuten)</div>
            <div class="rg">${stp('respMin', t.respMin, 1, 600)}<span class="to">bis</span>${stp('respMax', t.respMax, 1, 600)}</div>
            <div class="hint">Richtwert für Lvl ${t.lvl || '?'}: ~${e2Resp(t.lvl).toFixed(1).replace('.', ',')} min${+E2.speed > 1 ? ' (Welt ×' + E2.speed + ')' : ''}
              ${t.respAuto ? '· eingestellt' : `· <button class="chip" data-a="e2auto" style="margin:0;padding:2px 6px">übernehmen</button>`}</div>
            ${mapId() === t.map ? `<div class="hint">Bot sieht hier: ${esc(e2Seen(t).join(' · ') || 'keine Mobs')}${t.gameNick ? ' · im Spiel: „' + esc(t.gameNick) + '“' : ''}</div>` : ''}
            <div class="fld"><button class="btn" data-a="e2kill">${ico('check')}Gerade getötet</button>
              ${mapId() === t.map ? `<button class="btn" data-a="e2here">${ico('pin')}Spawn = hier</button>` : ''}
              <span></span><button class="btn bad" data-a="e2del" title="E2 entfernen">${ico('trash')}</button></div>
            <div class="hint">„Gerade getötet“ startet den Timer von Hand, z. B. wenn du sie selbst erlegt hast.</div>` : ''}

            <div class="fld"><span>Respawn-Tempo der Welt</span><select data-a="e2speed" style="width:auto">${[1, 2, 3, 4, 5].map(v => `<option value="${v}" ${+E2.speed === v ? 'selected' : ''}>×${v}${v === 1 ? ' (normal)' : ''}</option>`).join('')}</select></div>
            <div class="hint" style="margin-top:10px">Reaktionszeit, wenn sie erscheint (Sekunden, zufällig dazwischen)</div>
            <div class="rg">${stp('reactMin', E2.reactMin, 0, 60)}<span class="to">bis</span>${stp('reactMax', E2.reactMax, 0, 60)}</div>
            <h4>Wartezeit</h4>
            <select data-a="e2away"><option value="stay" ${E2.away === 'stay' ? 'selected' : ''}>am Spawnpunkt online bleiben</option>
              <option value="leave" ${E2.away === 'leave' ? 'selected' : ''}>Spiel verlassen und vor dem Respawn erinnern</option></select>
            ${E2.away === 'leave' ? `
            <div class="fld"><span>Nur wenn länger als (min)</span>${stp('leaveMin', E2.leaveMin, 3, 600)}</div>
            <div class="hint" style="margin-top:8px">Erinnern vor dem Respawn (Minuten, zufällig dazwischen)</div>
            <div class="rg">${stp('remindMin', E2.remindMin, 0, 60)}<span class="to">bis</span>${stp('remindMax', E2.remindMax, 0, 60)}</div>
            <label class="chk"><input type="checkbox" data-a="e2back" ${E2.autoBack ? 'checked' : ''}>Dann selbst zurück auf die Spielseite</label>
            <div class="fld"><span>Seite zum Verlassen</span><input type="text" data-a="e2leaveUrl" value="${esc(E2.leaveUrl || '')}" placeholder="${esc(e2LeaveUrl())}"></div>
            ${Date.now() < (E2.noLeaveUntil || 0) ? `<div class="hint" style="color:var(--bad)">Verlassen hat nicht geklappt, die Spielseite kam gleich wieder – der Bot bleibt bis ${clock(E2.noLeaveUntil)} online.
              Seitenfolge: ${esc((E2.trace || []).join(' → ') || 'keine andere Seite geladen')}</div>` : ''}
            <div class="hint">Der Bot geht vom Spawnpunkt offline: von der Spielseite (z. B. classic.margonem.pl) auf www.margonem.pl.
              Dort zählt er herunter und öffnet zufällig im eingestellten Abstand vor dem Respawn wieder die Spielseite – mit deiner
              bestehenden Sitzung. Passwörter gibt er nie ein: Ist die Sitzung abgelaufen, meldet er sich (Benachrichtigung, Ton,
              Vibration) und du loggst dich selbst ein. Die Seite muss offen bleiben.</div>` : ''}

            ${t ? (run ? `<button class="cta stop" data-a="stopall">${ico('stop')}Stopp</button>`
                       : `<button class="cta" data-a="e2go">${ico('play')}${mapId() === t.map ? 'Hier auf ' : 'Hin & auf '}${esc(t.nick)} warten</button>`) : ''}

            <h4>E2 suchen</h4>
            <input type="text" data-a="e2q" placeholder="Name oder Karte, z. B. Mushita" value="${esc(e2Q)}" style="width:100%">
            <div class="e2hits" style="margin-top:6px">${e2HitsHtml()}</div>
            ${here.length ? `<h4>Auf dieser Karte</h4><div class="spots">${here.map(m => `
              <button class="spot" data-a="e2pick" data-id="${m.id}"><span class="nm">${esc(m.nick)}</span><span class="ds">Lvl ${m.lvl}</span>
              <span class="mt">${m.x},${m.y} · als E2 merken</span></button>`).join('')}</div>` : ''}
            <details ${cfg.logOpen ? 'open' : ''}><summary>${ico('chev')}Verlauf</summary><div class="log"></div></details>`;
    }
    function e2Click(a, el) {
        const E2 = cfg.e2, t = e2Cur();
        if (a === 'e2add') {
            const o = e2World().find(x => x.nick === el.dataset.n && x.map === +el.dataset.m);
            if (o) e2Add(o);
        } else if (a === 'e2pick') {
            const m = mobs().find(x => String(x.id) === el.dataset.id);
            if (m) e2Add({ nick: m.nick, lvl: m.lvl, map: mapId(), x: m.x, y: m.y });
        } else if (a === 'e2num' && t || a === 'e2num' && /^(leaveMin|remind|react)/.test(el.dataset.f)) {
            const f = el.dataset.f, obj = /^(leaveMin|remindMin|remindMax|reactMin|reactMax)$/.test(f) ? E2 : t;
            obj[f] = Math.max(+el.dataset.lo, Math.min(+el.dataset.hi, (+obj[f] || 0) + +el.dataset.d));
            if (/^resp/.test(f)) t.respAuto = false;     // von Hand eingestellt → Richtwert nicht mehr überschreiben
            if (f === 'respMin' && t.respMax < t.respMin) t.respMax = t.respMin;
            if (f === 'respMax' && t.respMin > t.respMax) t.respMin = t.respMax;
        } else if (a === 'e2auto' && t) { e2AutoResp(t); log(`E2: Respawn von ${t.nick} = Richtwert ${t.respMin}–${t.respMax} min`); }
        else if (a === 'e2kill' && t) { t.lastKill = Date.now(); t.by = 'hand'; log(`E2: ${t.nick} als getötet markiert – Respawn ${clock(e2Window(t).start)}–${clock(e2Window(t).end)}`); }
        else if (a === 'e2here' && t) { const [hx, hy] = heroXY(); t.x = hx; t.y = hy; log(`E2: Spawnpunkt von ${t.nick} = ${hx},${hy}`); }
        else if (a === 'e2del' && t) { if (W.confirm(`E2 „${t.nick}“ entfernen?`)) { delete E2.list[E2.sel]; E2.sel = Object.keys(E2.list)[0] || ''; if (E2.on) e2Stop(); } }
        else if (a === 'e2go' && t) {
            if (cfg.chain) endChain('E2-Jagd');
            cfg.on = false; cfg.travel = null; E2.on = true; E2.offline = false; E2.wakeAt = 0; e2rt = null; e2Leaving = false; goal = null;
            startSession(); log(`E2-Jagd: ${t.nick} auf ${wname(t.map)}`);
        } else if (a === 'e2stop') { e2Stop('von Hand'); box.dataset.away = ''; }
        else return false;
        return true;
    }

    // ── Tab „Handel“ ──
    const RCOL = { common: 'var(--mut)', unique: '#e9d66b', heroic: '#7fb3ef', upgraded: '#e8a93c', legendary: '#f08a4b', artefact: '#ec7a6a' };
    const KIND = { markt: ['Unter Marktpreis', 'var(--ok)'], npc: ['Unter NPC-Wert', 'var(--amb2)'], bald: ['Endet bald', 'var(--blue)'] };
    function fmtLeft(s) { return !s ? '' : s < 60 ? s + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1).replace('.', ',') + ' h'; }
    // ── Tab „Fähigkeiten“: nur anzeigen ──
    /* Anzeige und Vorschlag lesen nur (Engine.skills, angelegte Gegenstände, Fensterzahlen). Ans Spiel geht erst etwas
       nach Klick und Rückfrage auf „anwenden“ (skApply). Geprüft am Paladin, siehe docs/skills_api.md.
       Die Daten füllt das Spiel, sobald sein Fähigkeiten-Fenster einmal offen war. */
    const SK_ROW_PTS = [1, 10, 25, 55, 95, 145, 205];         // „Wymagania: … pkt“ aus dem Fenster, gesetzte Punkte
    const SK_ELEM = { fire: 'Feuer', frost: 'Frost', light: 'Blitz', poison: 'Gift', wound: 'Blutung' };
    const SK_REQW = { fire: 'Feuer', frost: 'Frost', light: 'Blitz', '1h': 'Einhand', sh: 'Schild', sw: 'Nahkampf?' };
    let skOpen = null;
    function skillGear() {
        let worn = [];
        try { worn = (E().items.fetchLocationItems('g') || []).map(x => x.d || x).filter(d => +d.st > 0); } catch (e) {}
        const w = worn.find(d => +d.st === 5), sh = worn.find(d => +d.st === 7);
        const st = w ? parseStat(w.stat) : {};
        return { w, sh, cl: w ? +w.cl : 0, elems: Object.keys(SK_ELEM).filter(k => k in st), hasShield: !!(sh && +sh.cl === 14) };
    }
    function skillData() {
        /* null = das Spiel hat die Fähigkeiten noch nicht geladen. Reihen: gleiche grp, aufsteigend (Paladin 9–15 → 1–7). */
        const S = E().skills;
        if (!S || typeof S.getSkills !== 'function') return null;
        let all, gr;
        try { all = S.getSkills(); gr = S.getGroupedSkills(); } catch (e) { return null; }
        const list = Object.values(all || {}).filter(x => x && +x.id > 0 && x.grp !== undefined && x.lvl !== undefined);
        if (!list.length) return null;
        const learntEl = document.querySelector && document.querySelector('.skills_learnt');   // die Zahl im Fenster ist die verlässlichste
        const hero = heroLvl(), used = (learntEl && parseInt(learntEl.textContent, 10)) || list.reduce((n, x) => n + (+x.cLvl || 0), 0);
        const gk =Object.keys(gr || {}).sort((a, b) => a - b);
        const rows = Array.from(new Set(list.map(x => +x.grp))).sort((a, b) => a - b).map((g, i) => {
            const skills = list.filter(x => +x.grp === g).sort((a, b) => (+a.xy || 0) - (+b.xy || 0) || a.id - b.id);
            const reqLvl = +(gr && gr[gk[i]] && gr[gk[i]].requiredLvl) || +parseStat(skills[0].regs).lvl || 0;
            const need = i ? SK_ROW_PTS[i] || 0 : 0;                  // Reihe 1: der erste Punkt geht in sie selbst
            return { n: i + 1, reqLvl, need, points: skills.reduce((t, x) => t + (+x.cLvl || 0), 0), skills,
                     open: hero >= reqLvl && used >= need };
        });
        const totEl = document.querySelector && document.querySelector('.skills_total');
        const shown = totEl ? parseInt(totEl.textContent, 10) : NaN;
        return { rows, used, total: shown || Math.max(0, hero - 24), estimated: !shown };
    }
    function skillFit(x, g) {
        /* '' passt oder ohne Vorgabe, 'no' passt sicher nicht, '?' unklar (Waffenarten sind erst teilweise geprüft). */
        const r = parseStat(x.regs).reqw;
        if (!r) return '';
        if (r in SK_ELEM) return g.elems.includes(r) ? '' : 'no';
        if (r === 'sh') return g.hasShield ? '' : 'no';
        if (r === '1h') return !g.w ? 'no' : g.cl === 1 ? '' : '?';
        return '?';
    }
    function skillSig() {
        const d = skillData(), g = skillGear();
        return [d && d.total, d && d.rows.map(r => [r.open, r.skills.map(x => x.cLvl)]), g.w && g.w.id, g.sh && g.sh.id, skOpen, cfg.skGoal, skWindowOpen(), skRun && skRun.i, heroLvl()];
    }
    /* Vorschlag: Die Doku empfiehlt keine Builds, sie liefert nur die Mechanik. Darum eine eigene, geschätzte Bewertung:
       Gewicht je Wert [XP, PvP] mal Wert auf Stufe 10. Begründung aus „Mechanika walk“: SA verkürzt die Zugzeit (at = 1/sa),
       Krit und Durchschlag erhöhen jeden Treffer, Schaden an bzw. von Spielern zählt nur im PvP, an bzw. von Monstern nur
       bei XP, Betäubung/Verlangsamung/Ausweichen-Senken wirken vor allem gegen Spieler. Nicht bewertete Werte zählen 0. */
    const SK_WEIGHT = {
        perdmg: [3, 3], dmg_to_npc_per: [3, 0], dmg_from_npc_per: [2, 0], dmg_from_player_per: [0, 3], sa_per: [3, 3], sa1: [3, 3], 'red-sa': [2, 2],
        crit: [3, 3], active_crit: [2, 2], critval: [1, 1], critmval_f: [1, 1], critmval_c: [1, 1], critmval_l: [1, 1], lastcrit: [0.3, 0.3], pierce: [2, 2],
        str1h: [15, 15], str2h: [15, 15], firebon: [8, 8], frostbon: [8, 8], lightbon: [8, 8], 'adddmg_physical-perw': [0.15, 0.15], 'adddmg_fire-perw': [0.15, 0.15],
        'dmg-target_fire-perw': [0.1, 0.1], 'aura-adddmg2_per-meele_physical': [1, 1], 'combo_dmg_hpp-target': [1, 1], rage_3turns: [0.2, 0.3],
        hpbon: [2, 2], hp: [0.0005, 0.0005], 'hp_per-allies': [2, 3], ac2_per: [1, 1.5], 'aura-ac_per': [1, 1.5], 'aura-resall': [1, 1.5], acshield_per: [0.1, 0.2], ac: [0.002, 0.002],
        acdmg: [0.002, 0.002], blok_per: [1, 2], parry: [1.5, 2], resdmg: [1, 2], resfire: [0.2, 1], resfrost: [0.2, 1], reslight: [0.2, 1], redacdmg_per: [0.5, 1.5], reddest_per: [0.2, 1],
        heal1_per: [1.5, 1.5], healall_per: [0.8, 0.8], combo_heal_per: [0.5, 0.5], healpower: [0.001, 0.001], manarestore_per: [0.3, 0.3], energyrestore_per: [0.3, 0.3],
        energygain: [1, 1], managain: [1, 1], energybon: [0.05, 0.05], manabon: [0.05, 0.05], manastr: [0.5, 0.5], 'en-regen': [0.5, 0.5],
        redstun: [0, 2], active_redstun: [0, 1.5], redslow: [0.5, 1.5], slow: [0.5, 1], slowfreeze_per: [0.05, 0.3], freeze: [0.2, 1], shout: [0, 0.5], decevade_per: [0.5, 1.5],
        active_decevade_per: [0.5, 1.5], active_decblock_per: [0.5, 1.5], lowdmg_enemy: [0.5, 2], disturb_crit: [0, 0.5], disturb_pierce: [0, 0.5], stealmana_per: [0, 0.5],
        woundred: [0, 0.5], critslow_per: [0.05, 0.2], critpoison_per: [0.05, 0.2], sunshield_per: [0.3, 0.5], lightshield_per: [0.3, 0.5], active_absorbdest_per: [0, 0.5]
    };
    const SK_SKIP = new Set(['cooldown', 'energy', 'mana', 'combo-max', 'combo-skill', 'combo-block', 'doublecastcost_per', 'lvl', 'reqp', 'reqw']);  // keine Stärke, sondern Kosten/Regeln
    const skNum = v => { const m = String(v ?? '').match(/-?\d+(\.\d+)?/); return m ? Math.abs(parseFloat(m[0])) : 0; };
    const skCost = () => Math.floor(Math.pow(heroLvl(), 1.9));   // Doku: gold_cost = floor(lvl^1.9); am echten Punkt bestätigt (Lvl 232: 31.219)
    function skillValue(x, goal, lv) {
        /* Geschätzter Wert auf Stufe lv. Aktive Fähigkeiten wirken nicht jede Runde: Abschlag, stärker bei Abklingzeit. */
        if (!lv) return { v: 0, unknown: [] };
        const st = parseStat((x.allStats || [])[lv - 1]), g = goal === 'pvp' ? 1 : 0;
        const act = x.type === 'active' ? 0.6 / (1 + skNum(st.cooldown) / 6) : 1;
        let v = 0;
        const unknown = [];
        for (const k of Object.keys(st)) {
            if (SK_SKIP.has(k)) continue;
            if (!SK_WEIGHT[k]) { unknown.push(k); continue; }
            v += SK_WEIGHT[k][g] * skNum(st[k]) * act;
        }
        return { v, unknown };
    }
    function skillPlan(goal) {
        /* Verteilt nur die freien Punkte (gesetzte bleiben), Punkt für Punkt: Immer die erlaubte Fähigkeit mit dem höchsten
           Wert pro noch fehlendem Punkt. Erlaubt = Reihe nach Level und gesetzten Punkten offen, Stufe < max, passt zur Waffe.
           Rückgabe: steps (Reihenfolge zum Setzen) und items (zusammengefasst fürs Anzeigen). */
        const d = skillData();
        if (!d) return null;
        const g = skillGear(), hero = heroLvl(), lvl = {};
        d.rows.forEach(r => r.skills.forEach(x => { lvl[x.id] = +x.cLvl || 0; }));
        const budget = Math.max(0, d.total - d.used), steps = [];
        let used = d.used;
        for (let n = 0; n < budget; n++) {
            let best = null, bs = 0;
            for (const r of d.rows) {
                if (hero < r.reqLvl || used < r.need) continue;
                for (const x of r.skills) {
                    const c = lvl[x.id], m = +x.mLvl || 10;
                    if (c >= m || skillFit(x, g) === 'no') continue;
                    const sc = (skillValue(x, goal, m).v - skillValue(x, goal, c).v) / (m - c);
                    if (sc > bs) { bs = sc; best = x; }
                }
            }
            if (!best) break;
            lvl[best.id]++; used++;
            steps.push({ id: +best.id, to: lvl[best.id], name: best.name });
        }
        const map = new Map();
        for (const st of steps) {
            const e = map.get(st.id) || { id: st.id, name: st.name, from: st.to - 1, to: st.to };
            e.to = st.to; map.set(st.id, e);
        }
        return { steps, items: Array.from(map.values()), free: budget };
    }
    // Anwenden: nur nach Klick und Rückfrage, ein Punkt nach dem anderen, jeder wird nachgelesen
    let skRun = null;
    const skWindowOpen = () => { const e = document.querySelector && document.querySelector('.skills_learnt'); return !!(e && e.offsetWidth); };
    const skGold = () => +(E().hero.d || {}).gold || 0;
    function skStart(steps) {
        const cost = skCost(), n = steps.length, tot = cost * n;
        if (!n) return;
        if (!skWindowOpen()) { log('Fähigkeiten: Erst das Fähigkeiten-Fenster im Spiel öffnen'); return; }
        if (skGold() < tot) { log(`Fähigkeiten: zu wenig Gold (${fmtXp(tot)} nötig, ${fmtXp(skGold())} da)`); return; }
        const span = new Map();
        for (const st of steps) { const e = span.get(st.id) || { name: st.name, from: st.to - 1 }; e.to = st.to; span.set(st.id, e); }
        const names = Array.from(span.values()).map(e => `${e.name}: ${e.from} → ${e.to}`).join('\n');
        if (!W.confirm(`${n} ${n === 1 ? 'Punkt' : 'Punkte'} setzen für ${fmtXp(tot)} Gold?\n\n${names}\n\nZurücksetzen kostet im Spiel extra.`)) return;
        skRun = { steps: steps.slice(), i: 0, wait: 0, sentAt: 0, next: 0 };
        log(`Fähigkeiten: setze ${n} ${n === 1 ? 'Punkt' : 'Punkte'}`);
        lastStatic = '';
    }
    function skStop(msg) { if (msg) log('Fähigkeiten: ' + msg); skRun = null; lastStatic = ''; }
    function skTick() {
        /* Ein Schritt je Punkt: prüfen → senden → warten, bis die neue Stufe im Spiel steht. Bei jeder Abweichung Schluss. */
        const r = skRun;
        if (!r || !ok()) return;
        const now = performance.now(), st = r.steps[r.i];
        if (!st) return skStop('fertig, alle Punkte gesetzt');
        const x = (E().skills.getSkills() || {})['skill_' + st.id];
        if (!x) return skStop('Fähigkeit ' + st.id + ' nicht mehr gefunden – angehalten');
        if (r.wait) {
            if (+x.cLvl === st.to) { log(`${st.name} → ${st.to}`); r.i++; r.wait = 0; r.next = now + 700 + Math.random() * 700; lastStatic = ''; return; }
            if (now - r.wait > 6000) return skStop(`${st.name} blieb auf Stufe ${x.cLvl} – angehalten (Gold, Reihe oder Kampf prüfen)`);
            return;
        }
        if (now < r.next || inBattle() || capt.state === 'open') return;       // im Kampf oder bei offener Zagadka warten
        if (!skWindowOpen()) return skStop('Fähigkeiten-Fenster wurde geschlossen – angehalten');
        if (+x.cLvl !== st.to - 1) return skStop(`${st.name} steht auf Stufe ${x.cLvl} statt ${st.to - 1} – angehalten`);
        if (skGold() < skCost()) return skStop('zu wenig Gold – angehalten');
        send('skills&learn=' + st.id + '&lvl=' + st.to);
        r.wait = now;
    }
    setInterval(() => { try { skTick(); } catch (e) { skStop('Fehler: ' + e.message); } }, 250);
    function skPlanHtml() {
        const goal = cfg.skGoal === 'pvp' ? 'pvp' : 'xp', plan = skillPlan(goal), open = skWindowOpen(), cost = skCost();
        const seg = `<div class="seg sks"><button class="${goal === 'xp' ? 'on' : ''}" data-a="skgoal" data-m="xp"><b>XP</b><span>Monster jagen</span></button>
            <button class="${goal === 'pvp' ? 'on' : ''}" data-a="skgoal" data-m="pvp"><b>PvP</b><span>gegen Spieler</span></button></div>`;
        if (!plan) return seg;
        const list = plan.items.map(e => `<div class="ski"><span>${esc(e.name)}</span><b>${e.from} → ${e.to}</b></div>`).join('');
        const n = plan.steps.length;
        let act;
        if (skRun) act = `<div class="hint">Setze Punkt ${Math.min(skRun.i + 1, skRun.steps.length)} von ${skRun.steps.length} …</div><button class="cta stop" data-a="skstop">${ico('stop')}Anhalten</button>`;
        else if (!plan.free) act = '<div class="empty">Keine freien Punkte. Gesetzte Punkte bleiben, der Bot setzt nichts zurück.</div>';
        else if (!n) act = '<div class="empty">Für die freien Punkte gibt es gerade keine erlaubte Fähigkeit.</div>';
        else if (!open) act = '<div class="empty">Zum Anwenden das <b>Fähigkeiten-Fenster im Spiel öffnen</b>, damit der Bot jeden Punkt nachprüfen kann.</div>';
        else act = `<button class="cta" data-a="skall">${ico('check')}${n === 1 ? '1 Punkt' : 'Alle ' + n + ' Punkte'} anwenden · ${fmtXp(cost * n)} Gold</button>
            ${n > 1 ? `<button class="sub" data-a="skone">nur den nächsten Punkt: ${esc(plan.steps[0].name)} → ${plan.steps[0].to} · ${fmtXp(cost)} Gold</button>` : ''}`;
        return `${seg}<h4>Vorschlag für ${plan.free} freie Punkte</h4>${list || ''}${act}
            <div class="hint">Vom Bot berechnet aus den Werten der Fähigkeiten. Die Margonem-Doku empfiehlt selbst keine Builds. Aktive Fähigkeiten wirken nur, wenn sie in deiner Mistrzostwo-walk-Kette stehen.</div>`;
    }
    function skillDetail(x) {
        const c = +x.cLvl || 0, as = x.allStats || [], cur = c ? parseStat(as[c - 1]) : {}, nxt = c < as.length ? parseStat(as[c]) : null;
        const keys = Array.from(new Set(Object.keys(cur).concat(Object.keys(nxt || {})))).filter(k => !nxt || cur[k] !== nxt[k]);
        const rows = keys.map(k => `<tr><td>${esc(k)}</td><td>${esc(cur[k] ?? '–')}</td><td>${nxt ? esc(nxt[k] ?? '–') : ''}</td></tr>`).join('');
        return `<div class="skd"><div class="sdsc">${esc(String(x.desc || '').replace(/<[^>]+>/g, ' ').trim())}</div>
            ${keys.length ? `<table><tr><th>Wert im Spiel</th><th>${c ? 'Stufe ' + c : 'jetzt'}</th><th>${nxt ? 'Stufe ' + (c + 1) : ''}</th></tr>${rows}</table>` : ''}</div>`;
    }
    function skillsTab() {
        const d = skillData(), g = skillGear();
        const weapon = g.w ? `${esc(g.w.name)} · ${g.cl === 1 ? 'Einhand' : 'Waffenklasse ' + g.cl}${g.elems.length ? ' · ' + g.elems.map(k => SK_ELEM[k]).join(', ') : ''}` : 'keine Waffe angelegt';
        const gear = `<div class="skg"><span>Waffe</span><b>${weapon}</b><span>Nebenhand</span><b>${g.sh ? esc(g.sh.name) + (g.hasShield ? ' · Schild' : '') : 'nichts'}</b></div>`;
        if (!d) return `<div class="empty">Öffne einmal im Spiel dein <b>Fähigkeiten-Fenster</b>. Erst dann liegen die Daten vor, und sie erscheinen hier von selbst.</div>${gear}`;
        const free = d.total - d.used;
        const rows = d.rows.map(r => `
            <div class="skr ${r.open ? '' : 'lock'}">
              <div class="skh"><b>Reihe ${r.n}</b><span>${r.open ? r.points + ' Punkte gesetzt' : 'gesperrt: Lvl ' + r.reqLvl + (r.need ? ', ' + r.need + ' gesetzte Punkte' : '')}</span></div>
              ${r.skills.map(x => {
                  const c = +x.cLvl || 0, m = +x.mLvl || 10, fit = skillFit(x, g), rw = parseStat(x.regs).reqw, op = skOpen === +x.id;
                  return `<button class="skl ${c >= m ? 'full' : c ? 'some' : ''}" data-a="skopen" data-i="${+x.id}" aria-expanded="${op}">
                      <span class="nm">${esc(x.name)}</span>
                      <span class="tg">${x.type === 'active' ? 'aktiv' : 'passiv'}${rw ? ' · ' + esc(SK_REQW[rw] || rw) : ''}${fit === 'no' ? ' · <i>passt nicht</i>' : ''}</span>
                      <span class="lv">${c}/${m}</span>
                      <span class="br"><u style="width:${Math.round(c / m * 100)}%"></u></span>
                    </button>${op ? skillDetail(x) : ''}`;
              }).join('')}
            </div>`).join('');
        return `
            <div class="skp"><b>${free > 0 ? free : 0}</b><div><strong>${free > 0 ? (free === 1 ? 'Punkt frei' : 'Punkte frei') : 'Keine Punkte frei'}</strong>
              <span>${d.used} von ${d.estimated ? '~' : ''}${d.total} gesetzt${d.estimated ? ' (geschätzt: Level − 24, genau bei offenem Fenster)' : ''}</span></div></div>
            ${gear}
            ${skPlanHtml()}
            <h4>Dein Baum</h4>
            ${rows}
            <div class="hint">„Passt nicht“ bezieht sich auf die angelegte Waffe.</div>`;
    }
    function tradeTab() {
        const tc = tradeCfg(), open = !!auctionOpen(), nItems = Object.keys(market.items).length;
        const ago = market.last ? Math.round((Date.now() - market.last) / 60000) : null;
        const stepper2 = (f, v, lo, hi, step) => `<div class="stp sm"><button data-a="tnum" data-f="${f}" data-d="${-step}" data-lo="${lo}" data-hi="${hi}">−</button>` +
            `<input class="nb" data-a="tset" data-f="${f}" inputmode="numeric" value="${v}"><button data-a="tnum" data-f="${f}" data-d="${step}" data-lo="${lo}" data-hi="${hi}">+</button></div>`;
        const deals = MK.deals.map((d, i) => `
            <div class="deal">
              <div class="dh"><b style="color:${RCOL[d.rarity] || 'var(--tx)'}">${esc(d.name)}</b><span class="g">+${fmtXp(d.gain)}</span></div>
              <div class="dm"><span class="kd" style="color:${KIND[d.kind][1]}">${KIND[d.kind][0]}</span> · ${d.kind === 'bald' ? 'Gebot' : 'Preis'} ${fmtXp(d.price)} →
                ${d.kind === 'npc' ? 'Händler ~' + fmtXp(d.worth) : 'Markt ~' + fmtXp(d.worth) + ' (' + d.n + '×)'} · Lvl ${d.lvl}${d.left ? ' · ' + fmtLeft(d.left) : ''}</div>
              <button class="btn" data-a="tshow" data-i="${i}">${ico('pin')}Im Auktionshaus zeigen</button>
            </div>`).join('');
        return `
            <div class="now"><div class="st"><span class="dot ${MK.scan ? 'run' : ''}"></span>${MK.scan ? 'Scanne Auktionen' : open ? 'Auktionshaus offen' : 'Auktionshaus zu'}</div>
              <div class="dt2 mkst">${MK.scan ? '' : open ? 'Bereit zum Scannen' : 'Beim Aukcjoner „Pokaż mi aukcje“ öffnen – dann hier scannen'}</div>
              <div class="kp" style="display:flex"><span><b>${fmt(nItems)}</b>Gegenstände</span><span><b>${market.scans}</b>Scans</span><span><b>${ago === null ? '–' : ago < 60 ? ago + ' min' : Math.round(ago / 60) + ' h'}</b>${ago === null ? '' : 'her'}</span></div></div>
            ${MK.scan ? `<button class="cta stop" data-a="tstop">${ico('stop')}Scan stoppen</button>`
                      : `<button class="cta" data-a="tscan" ${open ? '' : 'disabled style="opacity:.5"'}>${ico('play')}Auktionen scannen</button>`}
            <h4>Gelegenheiten${MK.deals.length ? ' · ' + MK.deals.length : ''}</h4>
            ${deals || `<div class="empty">${market.scans ? 'Nichts Auffälliges im letzten Scan. Je öfter du scannst, desto besser kennt der Bot die Marktpreise.' :
                'Noch kein Scan. Der Bot liest die Angebote, merkt sich die Preise jedes Gegenstands und zeigt dir Angebote, die deutlich darunter liegen.'}</div>`}
            <h4>Einstellungen</h4>
            <div class="fld"><span>Tempo</span><select data-a="ttempo" style="width:auto;flex:1.4">${Object.entries(TEMPO).map(([k, v]) => `<option value="${k}" ${tc.tempo === k ? 'selected' : ''}>${v[2]}</option>`).join('')}</select></div>
            <label class="chk"><input type="checkbox" data-a="tall" ${tc.allCats ? 'checked' : ''}>Alle Kategorien (sonst nur die offene)</label>
            <div class="fld"><span>Seiten je Kategorie (15 Angebote/Seite)</span>${stepper2('pages', tc.pages, 1, 300, 5)}</div>
            <div class="fld"><span>Mindestens günstiger als Markt (%)</span>${stepper2('minOff', tc.minOff, 5, 90, 5)}</div>
            <div class="fld"><span>Gebühr beim Weiterverkauf (%)</span>${stepper2('fee', tc.fee, 0, 50, 1)}</div>
            <div class="fld"><span>Händler zahlt vom NPC-Wert (%)</span>${stepper2('npcPct', tc.npcPct, 5, 100, 5)}</div>
            <div class="hint">„Markt“ = Median der Sofortkauf-Preise desselben Gegenstands (gleiche Seltenheit) der letzten 7 Tage, mind. ${tc.minN} Vergleiche.
              Der Bot kauft nichts – „Im Auktionshaus zeigen“ sucht das Angebot, kaufen tust du.</div>
            <button class="btn" data-a="treset" style="margin-top:8px">${ico('trash')}Marktdaten löschen</button>`;
    }
    function render() {
        if (!ok()) {
            if (cfg.e2.offline && cfg.e2.wakeAt && !W.Engine) { renderAway(); return; }
            // Altes Interface (Polen: „stary interfejs“) hat keine Engine → Bot kann dort nichts lesen
            if (!W.Engine && performance.now() > 15000 && !box.dataset.si && document.querySelector('#base, #panel, #centerbox')) {
                box.dataset.si = '1';
                box.innerHTML = `<div class="hd"><div class="brand"><span class="dot dead"></span>MargoBot</div></div>
                    <div class="bd"><div class="empty">Dieses Spielfenster nutzt das <b>alte Interface</b>. Der Bot braucht das
                    <b>neue Interface</b> – in den Spieleinstellungen umstellen (PL: „Nowy interfejs“) und die Seite neu laden.</div></div>`;
            }
            return;
        }
        bindHero();
        if (cfg.lvlMin === 1 && cfg.lvlMax === 300 && heroLvl()) {   // erster Start: Bereich um das eigene Level
            cfg.lvlMin = Math.max(1, heroLvl() - 5); cfg.lvlMax = heroLvl() + 3; save();
        }
        const mn = mapName(), tab = ['set', 'rules', 'trade', 'e2', 'skills'].includes(cfg.tab) ? cfg.tab : 'xp';
        const run = running();
        if (tab === 'xp') refreshXp();
        const rk = editId ? [editId, !!shopOpen(), (cfg.rules || []).map(r => [r.id, r.when.t, r.steps.map(x => x.t)])] : cfg.rules;
        if (tab === 'xp') refreshSug();
        if (botMode() === 'xp') refreshXp();
        const sKey = JSON.stringify([cfg.open, tab, run, mn, rk, cfg.chain, botMode(), capt.state,
                                     tab === 'skills' ? skillSig() : 0,
                                     tab === 'trade' ? [!!MK.scan, !!auctionOpen(), MK.deals.map(d => d.id + d.kind), cfg.trade, market.scans] : 0, sugList && sugList.map(o => o.maps.join()), cfg.route, cfg.rec && cfg.rec.length, Object.keys(cfg.routes),
                                     cfg.routes[cfg.route] && routeMode(cfg.routes[cfg.route]), worldN(), xpList && xpList.map(o => o.id), xpSel, cfg.lvlMin, cfg.lvlMax, heroLvl(),
            tab === 'e2' ? [JSON.stringify(cfg.e2), mapId(), mobs().map(m => m.id).sort().join()] : 0,
            tab === 'set' ? [JSON.stringify(cfg.tele || {}).length, cfg.routes[cfg.route] && routeMode(cfg.routes[cfg.route]), mobs().map(m => m.key).sort(), gateways().map(g => g.id), cfg.route, cfg.rec && cfg.rec.length, Object.keys(cfg.routes),
                             cfg.picked, cfg.lvlOn, (cfg.deaths || []).length, cfg.onDeath, cfg.optimal, cfg.pk.mode, cfg.fogPct] : 0]);
        if (sKey !== lastStatic) {
            lastStatic = sKey;
            box.innerHTML = `<div class="hd"><div class="brand"><span class="dot"></span>MargoBot</div>
                ${headButton(run)}
                <button class="ib" data-a="fold" title="${cfg.open ? 'Einklappen' : 'Ausklappen'}">${ico(cfg.open ? 'min' : 'max')}</button></div>` +
                (capt.state ? `<div class="capt ${capt.state}"><b>${capt.state === 'open' ? (cfg.autoCaptcha ? (capt.solving ? 'Zagadka – klicke *…*-Antworten…' : (cfg.autoCaptchaConfirm ? 'Zagadka – Auto-Lösen aktiv' : 'Zagadka – bitte Potwierdzam tippen')) : 'Zagadka – bitte selbst lösen') : 'Zagadka kommt bald'}</b><span class="ct"></span></div>` : '') +
                (cfg.open ? `<div class="tabs"><button class="tab ${tab === 'xp' ? 'on' : ''}" data-a="tab" data-t="xp">XP</button>
                    <button class="tab ${tab === 'rules' ? 'on' : ''}" data-a="tab" data-t="rules">Abläufe${(cfg.rules || []).length ? ' · ' + cfg.rules.filter(r => r.on).length : ''}</button>
                    <button class="tab ${tab === 'trade' ? 'on' : ''}" data-a="tab" data-t="trade">Handel</button>
                    <button class="tab ${tab === 'e2' ? 'on' : ''}" data-a="tab" data-t="e2">E2</button>
                    <button class="tab ${tab === 'skills' ? 'on' : ''}" data-a="tab" data-t="skills">Fähigkeiten</button>
                    <button class="tab ${tab === 'set' ? 'on' : ''}" data-a="tab" data-t="set">Einstellungen</button></div>
                    <div class="bd">${tab === 'xp' ? xpTab() : tab === 'rules' ? rulesTab() : tab === 'trade' ? tradeTab() : tab === 'e2' ? e2Tab() : tab === 'skills' ? skillsTab() : setTab()}</div>` : '');
        }
        // aktiven Tab sichtbar halten (die Leiste scrollt seitlich)
        const onTab = box.querySelector('.tab.on'), tabBar = box.querySelector('.tabs');
        if (onTab && tabBar && tabBar.scrollWidth > tabBar.clientWidth && (onTab.offsetLeft < tabBar.scrollLeft || onTab.offsetLeft + onTab.offsetWidth > tabBar.scrollLeft + tabBar.clientWidth))
            tabBar.scrollLeft = onTab.offsetLeft - 10;
        // Live-Werte
        sessTick(); countXp();
        const [cls, title, detail] = state();
        box.querySelectorAll('.dot').forEach(d => { d.className = 'dot ' + cls; });
        const q = s => box.querySelector(s);
        if (q('.capt .ct')) q('.capt .ct').textContent = capt.state === 'open' ? 'Der Bot wartet und jagt danach weiter.' : (capt.text || '');
        if (q('.stl')) q('.stl').textContent = title;
        if (q('.now .dt')) q('.now .dt').textContent = detail;
        if (q('.now .kp')) { const h = sessHtml(); q('.now .kp').innerHTML = h; q('.now .kp').style.display = h ? '' : 'none'; }
        if (q('.log')) q('.log').textContent = logLines.join('\n') || 'noch nichts';
        if (q('.cdt') && cfg.chain) {
            const r = ruleById(cfg.chain.rid);
            q('.cdt').textContent = r ? `${whenText(r.when)} · Schritt ${cfg.chain.i + 1}/${r.steps.length}: ${r.steps[cfg.chain.i] ? stepText(r.steps[cfg.chain.i]) : ''}` : '';
        }
        if (q('.diag') && q('.diag').closest('details').open) q('.diag').textContent = diagText();
        if (q('.mkst')) q('.mkst').textContent = MK.scan ? (MK.stat || 'starte …') : auctionOpen() ? 'Bereit zum Scannen' : 'Beim Aukcjoner „Pokaż mi aukcje“ öffnen – dann hier scannen';
        if (q('.perf')) q('.perf').textContent = 'Rechenzeit: ' + tickMs.toFixed(1) + ' ms pro Takt';
        if (q('.pkinfo')) { const h = pkInfo(); if (q('.pkinfo').innerHTML !== h) q('.pkinfo').innerHTML = h; }
        const rp = q('.rprog');
        if (rp) {
            const rs = routeStep();
            rp.textContent = rs && rs.n === 1 ? 'Jagdort · auf dieser Karte bleiben' : rs ? `${rs.back ? 'Rückweg' : 'Hinweg'} · Karte ${rs.pos + 1}/${rs.n} · weiter nach ${rs.next}` + (currentExit() ? '' : ' – Tür fehlt hier!')
                : mn + ' gehört nicht zur Route' + (world ? ' – beim Start läuft der Bot hin' : '');
        }
        const rt = q('.rt');
        if (rt) {
            const r = cfg.routes[cfg.route], rs = r ? routeStep() : null;
            rt.textContent = !r ? 'Einmal selbst ablaufen und aufnehmen; die Mobs, die du dabei angreifst, werden angehakt.' :
                rs && rs.n === 1 ? 'Jagdort · auf dieser Karte bleiben' : rs ? `${rs.back ? 'Rückweg' : 'Hinweg'} · Karte ${rs.pos + 1}/${rs.n}: ${mn} → weiter nach ${rs.next}` + (currentExit() ? '' : ' (Tür fehlt auf dieser Karte)') :
                `${mn} gehört nicht zur Route` + (world ? ' – der Bot läuft beim Start selbst hin.' : ' – erst hinlaufen.');
        }
    }

    function headButton(running) {
        /* Gleiche Aktion wie der große Knopf unten: Route starten, zum XP-Ort, oder hier jagen. */
        if (running) return `<button class="mini stop" data-a="stopall">${ico('stop')}Stopp</button>`;
        if (botMode() === 'route') return cfg.routes[cfg.route] ? `<button class="mini" data-a="runroute" title="Route „${esc(cfg.route)}“ starten">${ico('play')}Route starten</button>` : '';
        const sel = xpList && xpList[xpSel];
        if (sel && sel.id !== mapId()) return `<button class="mini" data-a="goxp" title="Zu ${esc(wname(sel.id))} laufen und jagen">${ico('play')}Hin & jagen</button>`;
        return `<button class="mini" data-a="huntxp">${ico('play')}Hier jagen</button>`;
    }
    function huntHere() {
        cfg.e2.on = false;
        cfg.lvlOn = true; cfg.route = ''; cfg.mode = 'xp'; cfg.travel = null; cfg.on = true; goal = null;
        startSession(); log('Jage Level ' + cfg.lvlMin + '–' + cfg.lvlMax + ' auf ' + mapName());
    }
    box.addEventListener('click', ev => {
        const el = ev.target.closest('[data-a]');
        if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'LABEL') return;
        const a = el.dataset.a;
        if (rulesClick(a, el) || e2Click(a, el)) { save(); lastStatic = ''; render(); return; }
        if (a === 'tscan') { startScan(); render(); return; }
        if (a === 'tstop') { stopScan('Scan gestoppt'); render(); return; }
        if (a === 'tshow') { const d = MK.deals[+el.dataset.i]; if (d) showOffer(d); return; }
        if (a === 'treset') { if (W.confirm('Alle gemerkten Marktpreise löschen?')) { market = { items: {}, scans: 0, last: 0 }; saveMarket(); MK.deals = []; } lastStatic = ''; render(); return; }
        if (a === 'tnum') {
            const tc = tradeCfg(), f = el.dataset.f;
            tc[f] = Math.max(+el.dataset.lo, Math.min(+el.dataset.hi, (+tc[f] || 0) + +el.dataset.d));
            cfg.trade = tc; save(); if (MK.deals.length) MK.deals = findDeals(dealPool()); lastStatic = ''; render(); return;
        }
        if (a === 'skopen') { const i = +el.dataset.i; skOpen = skOpen === i ? null : i; lastStatic = ''; render(); return; }
        if (a === 'skgoal') { cfg.skGoal = el.dataset.m; save(); lastStatic = ''; render(); return; }
        if (a === 'skall' || a === 'skone') {
            const pl = skillPlan(cfg.skGoal === 'pvp' ? 'pvp' : 'xp');
            if (pl) skStart(a === 'skone' ? pl.steps.slice(0, 1) : pl.steps);
            render(); return;
        }
        if (a === 'skstop') { skStop('angehalten'); render(); return; }
        if (a === 'tab') cfg.tab = el.dataset.t;
        else if (a === 'fold') cfg.open = !cfg.open;
        else if (a === 'stopall') { pkRouteSkip = null; if (sess.t0 && !sess.end) { sess.end = Date.now(); saveSess(); } if (cfg.chain) endChain('von Hand'); if (cfg.e2.on) e2Stop(); cfg.on = false; cfg.travel = null; lastTravel = null; goal = null; log('Gestoppt'); }
        else if (a === 'quick') { cfg.on = true; goal = null; startSession(); log('Gestartet'); }
        else if (a === 'huntxp') huntHere();
        else if (a === 'expoall') cfg.expoAll = !cfg.expoAll;
        else if (a === 'sugtake') { if (!takeSuggestion(sugList && sugList[+el.dataset.i])) return; }
        else if (a === 'runroute') { cfg.e2.on = false; cfg.travel = null; cfg.on = true; goal = null; startSession(); log('Route „' + cfg.route + '“ gestartet'); }
        else if (a === 'mode') {
            if (el.dataset.m === 'xp') { if (cfg.route) cfg.lastRoute = cfg.route; cfg.route = ''; cfg.mode = 'xp'; xpKey = ''; }
            else { cfg.mode = 'route'; if (!cfg.route && cfg.routes[cfg.lastRoute]) selectRoute(cfg.lastRoute); else if (!cfg.route && Object.keys(cfg.routes).length === 1) selectRoute(Object.keys(cfg.routes)[0]); }
        }
        else if (a === 'goxp') {
            const o = xpList && xpList[xpSel];
            if (!o) return;
            cfg.lvlOn = true; cfg.route = ''; cfg.mode = 'xp'; cfg.on = false;
            startSession(); startTravel([o.id], wname(o.id), 'hunt');
        }
        else if (a === 'xpsel') xpSel = +el.dataset.i;
        else if (a === 'lvl') { cfg[el.dataset.k] = Math.max(1, cfg[el.dataset.k] + +el.dataset.d); fixRange(el.dataset.k); }
        else if (a === 'lvlme') { const l = heroLvl(); cfg.lvlMin = Math.max(1, l - 5); cfg.lvlMax = l + 3; }
        if ((a === 'lvl' || a === 'lvlme') && cfg.routes[cfg.route]) Object.assign(cfg.routes[cfg.route], { lvlMin: cfg.lvlMin, lvlMax: cfg.lvlMax });
        else if (a === 'rec') {
            if (!cfg.rec) {
                cfg.rec = [mapName()];
                if (cfg.on) { cfg.on = false; log('Bot gestoppt – während der Aufnahme spielst du selbst'); }
                log('Aufnahme läuft – lauf die Route ab, greif die gewünschten Mobs an');
            } else {
                let maps = cleanMaps(cfg.rec), mode = 'back';
                if (maps.length > 2 && maps.every((x, i) => nameEq(x, maps[maps.length - 1 - i]))) {
                    maps = maps.slice(0, Math.ceil(maps.length / 2));          // hin und zurück gelaufen
                } else if (maps.length > 1 && nameEq(maps[0], maps[maps.length - 1])) {
                    maps.pop(); mode = 'loop';                                  // Runde geschlossen
                }
                cfg.rec = null;
                if (maps.length < 2) log('Route braucht mindestens 2 Karten');
                else {
                    const name = W.prompt('Name der Route (z. B. Astra 15–20):', maps[0]);
                    if (name) {
                        cfg.routes[name] = { maps, mode, picked: Object.assign({}, cfg.picked), lvlOn: cfg.lvlOn, lvlMin: cfg.lvlMin, lvlMax: cfg.lvlMax };
                        selectRoute(name);
                        log('Route gespeichert: ' + maps.join(' → ') + (mode === 'back' ? ' und zurück' : ' → ' + maps[0]));
                    }
                }
            }
        }
        else if (a === 'delroute') { if (W.confirm('Route „' + cfg.route + '“ löschen?')) { delete cfg.routes[cfg.route]; cfg.route = ''; cfg.mode = 'route'; } }
        else if (a === 'teleforget') { if (W.confirm('Alle gelernten Teleporter vergessen?')) { cfg.tele = {}; travelCache = null; } }
        else if (a === 'clearDeaths') cfg.deaths = [];
        else if (a === 'loadworldgh') {
            if (worldDl) return;
            worldDl = true; lastStatic = ''; render();
            log('Weltkarte wird von GitHub geladen …');
            fetchText(WORLD_URL)
                .then(useWorld)
                .catch(er => log('Weltkarte von GitHub fehlgeschlagen: ' + er.message + '. Alternativ „Datei“ wählen.'))
                .finally(() => { worldDl = false; lastStatic = ''; render(); });
            return;
        }
        else if (a === 'loadworld') {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = '.json';
            inp.onchange = () => {
                const f = inp.files[0];
                if (!f) return;
                f.text().then(useWorld).catch(er => log('Weltkarte nicht lesbar: ' + er.message));
            };
            inp.click();
            return;
        }
        else if (a === 'go') {
            const inp = box.querySelector('[data-a=dest]');
            destText = inp ? inp.value : destText;
            const ids = findMaps(destText);
            if (!ids.length) { log('Keine Karte „' + destText + '“ gefunden'); return; }
            if (ids.length > 1) log('Gemeint: ' + wname(ids[0]) + ' (auch: ' + ids.slice(1, 4).map(wname).join(', ') + ')');
            startTravel([ids[0]], wname(ids[0]), 'stop');
        }
        else return;
        save(); lastStatic = ''; render();
    });
    function fixRange(k) {
        cfg.lvlMin = Math.max(1, cfg.lvlMin | 0); cfg.lvlMax = Math.max(1, cfg.lvlMax | 0);
        if (cfg.lvlMin > cfg.lvlMax) { if (k === 'lvlMin') cfg.lvlMax = cfg.lvlMin; else cfg.lvlMin = cfg.lvlMax; }
    }
    box.addEventListener('input', ev => {
        const t = ev.target;
        if (t.dataset.a === 'e2q') { e2Q = t.value.trim(); const h = box.querySelector('.e2hits'); if (h) h.innerHTML = e2HitsHtml(); return; }
        if (t.dataset.a !== 'mapq') return;
        const r = ruleById(t.dataset.r), i = +t.dataset.i;
        if (!r) return;
        mapQ[r.id + ':' + i] = t.value.trim();
        const sel = t.parentElement.querySelector('select[data-f=map]');
        if (sel) { sel.innerHTML = mapOptions(r.steps[i], mapQ[r.id + ':' + i]); if (t.value.trim()) sel.size = 1; }
    });
    box.addEventListener('toggle', ev => { if (ev.target.tagName === 'DETAILS') { cfg.logOpen = ev.target.open; save(); } }, true);
    box.addEventListener('change', ev => {
        const t = ev.target, a = t.dataset.a;
        if (a === 'tall' || a === 'tset' || a === 'ttempo') {
            const tc = tradeCfg();
            if (a === 'tall') tc.allCats = t.checked; else if (a === 'ttempo') tc.tempo = t.value; else tc[t.dataset.f] = Math.max(0, parseInt(t.value, 10) || 0);
            cfg.trade = tc; save(); lastStatic = ''; render(); return;
        }
        if (a === 'e2sel') { cfg.e2.sel = t.value; if (cfg.e2.on) { e2rt = null; goal = null; } save(); lastStatic = ''; render(); return; }
        if (a === 'e2away') { cfg.e2.away = t.value; save(); lastStatic = ''; render(); return; }
        if (a === 'e2speed') {                     // Tempo geändert → alle Richtwert-Fenster neu rechnen
            cfg.e2.speed = +t.value || 1;
            for (const k in cfg.e2.list) if (cfg.e2.list[k].respAuto) e2AutoResp(cfg.e2.list[k]);
            save(); lastStatic = ''; render(); return;
        }
        if (a === 'e2back') { cfg.e2.autoBack = t.checked; save(); lastStatic = ''; render(); return; }
        if (a === 'e2leaveUrl') { cfg.e2.leaveUrl = t.value.trim(); cfg.e2.noLeaveUntil = 0; save(); lastStatic = ''; render(); return; }
        if (a === 'e2set') {
            const f = t.dataset.f, obj = /^(leaveMin|remindMin|remindMax|reactMin|reactMax)$/.test(f) ? cfg.e2 : e2Cur();
            if (obj) { obj[f] = Math.max(0, parseInt(t.value, 10) || 0); const c = e2Cur(); if (c && /^resp/.test(f)) c.respAuto = false; if (c && c.respMax < c.respMin) c.respMax = c.respMin; }
            save(); lastStatic = ''; render(); return;
        }
        if (rulesChange(t)) { save(); if ((a !== 'sf' || t.tagName === 'SELECT') && a !== 'wn') { lastStatic = ''; render(); } return; }
        if (t.dataset.k && t.type === 'checkbox') cfg.picked[t.dataset.k] = t.checked;
        else if (a === 'suggestAuto' || a === 'lvlOn' || a === 'closeBattle' || a === 'autoCaptcha' || a === 'autoCaptchaConfirm' || a === 'captchaWarn') cfg[a] = t.checked;
        else if (a === 'fogExplore') { cfg.fogExplore = t.checked; if (!t.checked) fog.on = false; }
        else if (a === 'fogPct') cfg.fogPct = +t.value || 100;
        else if (a === 'exit') cfg.exits[mapName()] = t.value || undefined;
        else if (a === 'onDeath') cfg.onDeath = t.value;
        else if (a === 'pkMode') { cfg.pk.mode = t.value; pkEsc = null; }
        else if (a === 'pk') cfg.pk[t.dataset.f] = Math.max(0, parseInt(t.value, 10) || 0);
        else if (a === 'pkNever') cfg.pk.never = t.value;
        else if (a === 'rmode' && cfg.routes[cfg.route]) { cfg.routes[cfg.route].mode = t.value; cfg.routePos = 0; }
        else if (a === 'dest') { destText = t.value; return; }
        else if (a === 'optimal') cfg.optimal = t.value === '1';
        else if (a === 'route') selectRoute(t.value);
        else if (a === 'lvlMin' || a === 'lvlMax') { cfg[a] = parseInt(t.value, 10) || 1; fixRange(a); }
        else if (a === 'pauseMin' || a === 'pauseMax') cfg[a] = Math.max(0, parseInt(t.value, 10) || 0);
        else return;
        if (cfg.pauseMax < cfg.pauseMin) cfg.pauseMax = cfg.pauseMin;
        const r = cfg.routes[cfg.route];
        if (r && (t.dataset.k || /^lvl/.test(a || ''))) {
            Object.assign(r, { picked: Object.assign({}, cfg.picked), lvlOn: cfg.lvlOn, lvlMin: cfg.lvlMin, lvlMax: cfg.lvlMax });
        }
        save(); lastStatic = ''; render();
    });
    setInterval(render, 1000);
    /* Am Handy fragt das Spiel nach dem Betreten, ob es in den Vollbildmodus soll. Das Fenster blockiert das Spiel
       (auch die Rückkehr der E2-Jagd) – darum „Nein“ drücken. Nur in einem Fenster, das nach Vollbild fragt. */
    const FS_Q = /pełn\w* ekran|pełnoekran|full ?screen|vollbild/i, FS_NO = /^\s*(nie|no|nein|anuluj|cancel|abbrechen)\s*[.!]?\s*$/i;
    try {                                          // falls das Spiel dafür confirm() nutzt: gleich „Nein“
        const oc = W.confirm;
        if (typeof oc === 'function') W.confirm = function (m) { if (FS_Q.test(String(m || ''))) { log('Vollbild-Frage: Nein'); return false; } return oc.apply(this, arguments); };
    } catch (e) { }
    function fullscreenNo() {
        /* Im Spiel: Meldungsfenster mit „…recommended to use Full Screen mode.“ und den Knöpfen
           .alert-accept-hotkey (OK) / .alert-cancel-hotkey (No). Erst den Spiel-Knopf direkt suchen. */
        if (!document.querySelectorAll) return;
        const near = el => { for (let w = el.parentElement, i = 0; w && w !== document.body && i < 8; w = w.parentElement, i++) {
            const t = w.innerText || ''; if (t.length > 600) return false; if (FS_Q.test(t)) return true; } return false; };
        for (const b of document.querySelectorAll('.alert-cancel-hotkey')) {
            if (b.closest('#mba') || !b.offsetWidth || !near(b)) continue;
            fsPress(b, (b.innerText || 'No').trim());
            return;
        }
        // Sonst allgemein: Textknoten mit Vollbild-Frage (auch wenn der Text durch <br> geteilt ist), Nein-Knopf daneben
        if (!document.evaluate) return;
        const r = document.evaluate("//text()[contains(.,'ekran') or contains(.,'creen') or contains(.,'ollbild')]",
            document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let k = 0; k < r.snapshotLength; k++) {
            const q = r.snapshotItem(k).parentElement;
            if (!q || q.closest('#mba') || q.closest('script,style') || !q.offsetWidth) continue;
            for (let w = q, i = 0; w && w !== document.body && i < 8; w = w.parentElement, i++) {
                const t = w.innerText || '';
                if (t.length > 600) break;
                if (!FS_Q.test(t)) continue;
                const b = [...w.querySelectorAll('button, .button, [role=button], a, div, span')]
                    .find(x => x.offsetWidth && x.children.length <= 2 && FS_NO.test(x.innerText || ''));
                if (!b) continue;
                fsPress(b.closest('button, .button, [role=button], a') || b, (b.innerText || '').trim());
                return;
            }
        }
    }
    /* Am Handy reagieren Spiel-Knöpfe oft nicht auf einen Maus-Klick (im Spiel blieb das Fenster offen). Darum:
       Ist das Fenster eine Sekunde später noch da, die nächste Klick-Art – am Handy zuerst Touch. */
    let fsTry = 0;
    function fsPress(btn, label) {
        const kinds = clickOrder(), k = kinds[fsTry % kinds.length];
        fsTry++;
        try { CLICKS[k](btn); } catch (e) { }
        if (fsTry <= kinds.length) log(`Vollbild-Frage: „${label}“ gedrückt (${k})`);
        else if (fsTry === kinds.length + 1) log('Vollbild-Frage: Fenster geht nicht zu – bitte selbst „No“ tippen');
    }
    setInterval(() => { try { fullscreenNo(); } catch (e) { } }, 1000);
    render();
})();
