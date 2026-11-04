// ==UserScript==
// @name         MargoBot Auto
// @description  Jagt Mobs direkt im Spiel (ohne Maus): Route über alle Mobs bis zum Ausgang, Panel im Spielfenster
// @version      6.4
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
                  routes: {}, route: '', routePos: 0, rec: null,
                  onDeath: 'stop', deaths: [], graph: {}, back: null, optimal: true,
                  names: {}, travel: null, blocked: [], tab: 'xp', logOpen: false, tele: {},
                  rules: [], chain: null, autoCaptcha: false, autoCaptchaConfirm: false, captchaWarn: true,
                  pk: { mode: 'off', maxUp: 5, near: 6, sec: 5, never: '' } };
    const cfg = Object.assign({}, DEF, GM_getValue('mbauto', {}));
    cfg.pk = Object.assign({}, DEF.pk, cfg.pk || {});
    // Routen bereinigen: leere Einträge (Kartenwechsel beim Aufnehmen) raus, doppelte direkt hintereinander zusammenfassen
    const cleanMaps = m => (m || []).filter(x => x && x !== 'null' && x !== 'undefined')
        .filter((x, i, a) => !i || String(x).trim().toLowerCase() !== String(a[i - 1]).trim().toLowerCase());
    for (const k in cfg.routes || {}) cfg.routes[k].maps = cleanMaps(cfg.routes[k].maps);
    const save = () => GM_setValue('mbauto', cfg);
    const rnd = (a, b) => a + Math.random() * Math.max(0, b - a);
    const pause = () => rnd(cfg.pauseMin, cfg.pauseMax);

    // ── Spieldaten ──────────────────────────────────────────────
    const E = () => W.Engine;
    function ok() { const e = E(); return e && e.hero && e.hero.d && e.map && e.map.d && e.map.size && e.npcs; }
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
    function suggestRoutes(lo, hi, top) {
        /* Fertige XP-Routen: Karten mit ≥4 Mobs im Level-Bereich, die über Türen direkt zusammenhängen.
           Pro zusammenhängender Gruppe die Strecke (max. 10 Karten, Tiefensuche mit Budget) mit den meisten
           passenden Mobs; gelaufen wird hin und zurück. Begonnen wird am Ende, das näher am Helden liegt. */
        if (!world) return [];
        const cnt = {};
        for (const id in world) {
            const n = world[id][4].reduce((t, x) => t + (x[1] >= lo && x[1] <= hi ? x[2] : 0), 0);
            if (n >= 4) cnt[id] = n;
        }
        const adj = {};
        for (const id in cnt) adj[id] = Array.from(new Set(world[id][3].map(g => String(g[0])).filter(t => cnt[t] && t !== id)));
        const seen = new Set(), comps = [];
        for (const id in cnt) {
            if (seen.has(id)) continue;
            const c = [], q = [id]; seen.add(id);
            while (q.length) { const x = q.pop(); c.push(x); for (const y of adj[x]) if (!seen.has(y)) { seen.add(y); q.push(y); } }
            if (c.length >= 2) comps.push(c);
        }
        const dist = worldSearch(mapId(), heroXY(), null).best, out = [];
        for (const c of comps) {
            if (!c.some(x => dist[x] !== undefined)) continue;
            let best = null, bestN = -1, budget = 40000;
            const dfs = (path, set, n) => {
                if (--budget < 0) return;
                if (n > bestN || (n === bestN && path.length < best.length)) { bestN = n; best = path.slice(); }
                if (path.length >= 10) return;
                for (const y of adj[path[path.length - 1]]) if (!set.has(y)) {
                    set.add(y); path.push(y); dfs(path, set, n + cnt[y]); path.pop(); set.delete(y);
                }
            };
            for (const st of c.slice().sort((a, b) => cnt[b] - cnt[a])) dfs([st], new Set([st]), cnt[st]);
            if (!best || best.length < 2) continue;
            const da = dist[best[0]], db = dist[best[best.length - 1]];
            if ((db ?? 1e9) < (da ?? 1e9)) best.reverse();
            const mobsIn = best.flatMap(id => world[id][4].filter(x => x[1] >= lo && x[1] <= hi));
            const byName = {};
            for (const x of mobsIn) byName[x[0]] = (byName[x[0]] || 0) + x[2];
            const main = Object.entries(byName).sort((a, b) => b[1] - a[1]).map(e => e[0]);
            const lv = [Math.min(...mobsIn.map(x => x[1])), Math.max(...mobsIn.map(x => x[1]))];
            const d = Math.min(da ?? 1e9, db ?? 1e9), r = rateXp(mobsIn, heroLvl());
            out.push({ maps: best.map(Number), n: bestN, lv, d, r, mobs: main.slice(0, 3),
                       name: main[0] + ' ' + (lv[0] === lv[1] ? lv[0] : lv[0] + '–' + lv[1]), score: r.xp / (1 + d / 600) });
        }
        return out.sort((a, b) => b.score - a.score).slice(0, top || 5);
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
                                                     goal: null, doneAt: 0, pct: 0, known: new Set(), spawns: new Map(), mem: new Map() });
        const visL = E().npcs.getDrawableList().filter(n => n.d && (n.d.type === 2 || n.d.type === 3)).map(n => n.d);
        fog.maxVis = Math.max(fog.maxVis, visL.length);
        // typisch für Nebel: alles Sichtbare steht nah am Helden. Ein einziger weit entfernter Mob = kein Nebel.
        for (const d of visL) fog.far = Math.max(fog.far || 0, Math.max(Math.abs(d.x - hx), Math.abs(d.y - hy)));
        const wm = world && world[mapId()], total = wm ? wm[4].reduce((n, x) => n + x[2], 0) : 0;
        const big = MW * MH >= 40 * 40;
        if (!fog.on && cfg.fogExplore !== false && big && now - fog.t0 > 2500 && now - fog.t0 < 4000 && total >= 8
            && fog.maxVis < total * 0.3 && (fog.far || 0) <= 12) {
            fog.on = true; fog.sight = Math.max(5, Math.min(12, fog.far || 8));
            log('Nebel auf ' + mapName() + ': sehe ' + fog.maxVis + ' von ~' + total + ' Mobs – erkunde die Karte');
        }
        for (const d of visL) if (wanted(d) || cfg.picked[mobKey(d.icon)]) {   // von Anfang an merken, auch vor der Nebel-Erkennung
            fog.mem.set(d.id, { x: d.x, y: d.y, at: now });
            if (d.id === committed) fog.chase = d.id;
        }
        if (!fog.on) return;
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
            if (now - m.at > 120000 || (Math.abs(m.x - hx) <= 1 && Math.abs(m.y - hy) <= 1 && !alive.has(id))) fog.mem.delete(id);
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
    let committed = null, planAt = 0, renderAt = 0, offRoute = null, offRouteLog = null, atkTries = {}, skipUntil = {};                          // Ziel, zu dem der Held gerade läuft
    let busyUntil = 0, goal = null, goalSince = 0, lastHero = '', heroStill = 0, lastPlan = null, battleSeen = false;
    /* Andere Spieler beobachten: wer seit sec Sekunden höchstens near Felder entfernt ist und dabei selbst
       mindestens 3 Felder gelaufen ist, folgt uns (ein Spieler, der nur nebenan steht und jagt, zählt nicht). */
    const pkSeen = {};                              // id → { since, x0, y0, last, moved }
    let pkFlee = null, pkTries = {}, pkLog = '';
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
        if (pkFlee !== mapAt) {
            const t = pkThreat();
            if (!t) return false;
            const up = Math.max(0, +cfg.pk.maxUp || 0), tries = pkTries[t.id] || { n: 0, at: 0 };
            const fight = isRed() && t.lvl <= heroLvl() + up && tries.n < 3;
            if (fight) {
                const adj = Math.abs(t.x - hx) <= 1 && Math.abs(t.y - hy) <= 1;
                if (!adj) { committed = null; lastPlan = null; walkTo(t.x, t.y, 'Spieler ' + t.nick); return true; }
                if (now - tries.at < 2500) return true;                // letzter Versuch läuft noch
                tries.n++; tries.at = now; pkTries[t.id] = tries;
                // Spieler-Angriff (noch nicht im Spiel geprüft): wie im Spiel-Menü „Atakuj“, Spieler-ID positiv
                act(() => send('fight&a=attack&id=' + t.id), 'Angriff auf Spieler');
                log(`Kämpfe gegen ${t.nick} (${t.lvl})` + (cfg.pk.mode === 'follow' ? ' – folgt mir' : '') + (tries.n > 1 ? ` – Versuch ${tries.n}` : ''));
                goal = null;
                return true;
            }
            const why = !isRed() ? 'keine rote Karte' : tries.n >= 3 ? 'Angriff klappt nicht' : `Lvl ${t.lvl} ist mehr als +${up} über mir`;
            pkFlee = mapAt;
            log(`${t.nick} (${t.lvl})${cfg.pk.mode === 'follow' ? ' folgt mir' : ' ist hier'} – ${why} → nächste Karte, keine Mobs mehr hier`);
        }
        // Karte verlassen: Ausgang der Route, sonst die nächste Tür
        committed = null; lastPlan = null;
        let door = exit;
        if (!door) door = gateways().sort((a, b) => Math.max(Math.abs(a.x - hx), Math.abs(a.y - hy)) - Math.max(Math.abs(b.x - hx), Math.abs(b.y - hy)))[0];
        if (door) useDoor(door.x, door.y, 'weg von hier → ' + door.name);
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

    function tick() {
        if (ok()) { trackMaps(); recordFights(); learnGraph(); learnNames(); learnWorldBits(); }
        if (!ok() || checkDeath()) return;
        watchBattle();
        watchPlayers();
        if (watchCaptcha()) return;                                // Rätsel offen → nichts tun, bis es gelöst ist
        if (!(cfg.on || cfg.travel || cfg.chain) || performance.now() < busyUntil) return;
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
        const adjT = targets.find(m => Math.abs(m.x - hx) <= 1 && Math.abs(m.y - hy) <= 1);
        if (adjT && (!keepT || adjT.id !== keepT.id)) p = { order: [adjT], total: 0, more: targets.length - 1 };
        else if (keepT && still < 6000) { p = p && p.order ? p : { order: [keepT], total: 0, more: targets.length - 1 }; p.order[0] = keepT; }
        else { p = plan(targets, exit); planAt = tNow; if (keepT && still >= 6000) { committed = null; goal = null; } }
        lastPlan = p;
        if (tNow - renderAt > 500) { renderAt = tNow; render(); }
        if (!p) {                                                      // kein Ziel erreichbar → Wände neu lesen
            if (performance.now() - colAt > 3000) loadCols(true);
            return;
        }
        const t = p.order[0];
        const adj = Math.abs(t.x - hx) <= 1 && Math.abs(t.y - hy) <= 1;
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
            goal = null; committed = t.id;
        } else {
            committed = t.id;
            walkTo(t.x, t.y, t.nick);
            if (goal && still > 2500) { goal = null; }               // hängt fest → neu anstoßen
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
    function pressFull(el) {
        /* Klick wie ein Mensch – am PC mit Maus, am Handy mit dem Finger. Ziel ist das innere .label (dort landet
           ein echter Klick). Handy: erst touchstart/touchend; verhindert das Spiel bei touchend den Standard
           (preventDefault), schickt auch der echte Browser keine Maus-Ereignisse und keinen click hinterher –
           sonst würde die Antwort doppelt umgeschaltet. Pointer-Ereignisse kommen auf beiden Geräten. */
        const tgt = el.querySelector('.label') || el, r = tgt.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2, touch = touchDev();
        const o = { bubbles: true, cancelable: true, view: W, clientX: x, clientY: y, button: 0, buttons: 1 };
        const P = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        const po = Object.assign({ pointerId: 1, isPrimary: true, pointerType: touch ? 'touch' : 'mouse' }, o);
        tgt.dispatchEvent(new P('pointerover', po)); tgt.dispatchEvent(new P('pointerdown', po));
        let mouse = true;
        if (touch && typeof TouchEvent === 'function') {
            try {
                const t = new Touch({ identifier: Date.now(), target: tgt, clientX: x, clientY: y, pageX: x + scrollX, pageY: y + scrollY });
                tgt.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
                mouse = tgt.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
            } catch (e) { mouse = true; }                  // Touch-Konstruktor fehlt (ältere Browser) → wie am PC
        }
        tgt.dispatchEvent(new P('pointerup', Object.assign({}, po, { buttons: 0 })));
        if (!mouse) return;
        for (const t of ['mouseover', 'mousedown']) tgt.dispatchEvent(new MouseEvent(t, o));
        tgt.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, o, { buttons: 0 })));
        tgt.dispatchEvent(new MouseEvent('click', Object.assign({}, o, { buttons: 0 })));
    }
    const capLabel = b => { const l = b.querySelector('.label') || b; return (l.innerText || l.textContent || '').trim(); };
    const isStar = l => /^\*[^*]+\*$/.test(l);
    function solveCaptchaIfPossible() {
        /* Klickt alle Knöpfe, deren Label mit * beginnt und endet (*e*, *f* …).
           „Potwierdzam“ nur, wenn autoCaptchaConfirm an ist. Höchstens 3 Versuche pro Rätsel: ein erneuter
           Klick auf eine schon gewählte Antwort könnte sie wieder abwählen. */
        if (!cfg.autoCaptcha || capt.solving) return false;
        const box = captchaOpen();
        if (!box) return false;
        const labels = [...box.querySelectorAll('.button')].map(capLabel), star = labels.filter(isStar);
        if (!star.length) {
            log('Zagadka: keine *…* in [' + labels.join(', ') + '] – bitte selbst lösen');
            capt.solvedAt = performance.now(); capt.tries = 99;
            return false;
        }
        if ((capt.tries = (capt.tries || 0) + 1) > 3) {
            if (capt.tries === 4) log('Zagadka: 3 Versuche ohne Erfolg – bitte selbst lösen');
            return false;
        }
        capt.solving = true;
        log('Zagadka: ' + star.join(', ') + ' gefunden – klicke' + (touchDev() ? ' (Touch)' : '') + (capt.tries > 1 ? ' · Versuch ' + capt.tries : ''));
        let delay = 150 + Math.random() * 200;
        for (const lab of star) {
            setTimeout(() => {
                // Knopf erst jetzt suchen: Baut das Spiel das Rätsel nach einem Klick neu auf, hängt ein vorher
                // gemerktes Element nicht mehr im Dokument und der Klick verpufft.
                const cur = captchaOpen();
                const b = cur && [...cur.querySelectorAll('.button')].find(x => capLabel(x) === lab);
                if (!b) { log('Zagadka: Knopf ' + lab + ' nicht mehr da'); return; }
                try { pressFull(b); log('Zagadka: ' + lab + ' gewählt'); } catch (e) { log('Zagadka: Klick auf ' + lab + ' fehlgeschlagen: ' + e.message); }
            }, delay);
            delay += 250 + Math.random() * 300;
        }
        setTimeout(() => {
            if (cfg.autoCaptchaConfirm) {
                const confirm = document.querySelector('.captcha__confirm .button');
                if (confirm && reallyVisible(confirm)) {
                    try { pressFull(confirm); log('Zagadka: Potwierdzam geklickt'); } catch (e) {}
                } else log('Zagadka: Potwierdzam-Knopf nicht gefunden');
            } else log('Zagadka: Antworten gewählt – bitte selbst Potwierdzam');
            capt.solving = false;
            capt.solvedAt = performance.now();
        }, delay + 300 + Math.random() * 200);
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
        } else if (st === 'open' && cfg.autoCaptcha && !capt.solving && now - capt.solvedAt > 2500 && (capt.tries || 0) < 3) {
            // Fenster hängt noch (Klick kam nicht an) oder Einstellung erst später eingeschaltet → nochmal
            solveCaptchaIfPossible();
        }
        capt.text = txt;
        return st === 'open';
    }
    function alarm(msg, loud) {
        if (cfg.captchaWarn === false || !(cfg.on || cfg.travel || cfg.chain)) return;
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
    #mba .tabs{display:flex;gap:2px;padding:0 10px;background:var(--bg2);border-bottom:1px solid var(--line)}
    #mba .tab{font:600 13px/1 var(--disp);letter-spacing:.02em;color:var(--dim);padding:8px 10px 9px;border-bottom:2px solid transparent;margin-bottom:-1px}
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
        if (d > 0 && d < lvlXp(Math.max(1, heroLvl())) && (cfg.on || cfg.travel || cfg.chain) && !sess.end) sess.xp = (sess.xp || 0) + d;
        sess.lastExp = e;
    }
    function saveSess() { cfg.sess = Object.assign({}, sess); save(); }
    function sessTick() {
        /* Läuft der Bot ohne Sitzung (nach Neuladen, Start durch Ablauf …) → jetzt starten; gestoppt → Zeit anhalten. */
        const running = cfg.on || cfg.travel || cfg.chain;
        if (running && (!sess.t0 || sess.end)) {
            if (!sess.t0 || Date.now() - sess.end > 30 * 60000) startSession();   // lange Pause → neue Sitzung
            else { sess.t0 += Date.now() - sess.end; sess.end = 0; saveSess(); }  // kurze Pause → weiterzählen
        } else if (!running && sess.t0 && !sess.end) { sess.end = Date.now(); saveSess(); }
    }
    function heroLvl() { return (ok() && E().hero.d.lvl) || 0; }
    function pkInfo() {                             // was der Bot gerade sieht – zum Prüfen im echten Spiel
        if (!ok()) return '';
        const pv = mapPvp(), now = performance.now();
        const ps = players().slice(0, 4).map(p => { const r = pkSeen[p.id];
            return `${esc(p.nick)} (${p.lvl})${follows(p) ? ' · folgt' : r ? ` · nah ${Math.round((now - r.since) / 1000)}s` : ''}`; });
        return `Diese Karte: ${pv == null ? 'PvP unbekannt' : pv === 2 ? 'rot (PvP)' : 'PvP-Stufe ' + pv}${pkFlee === mapAt ? ' · verlasse sie' : ''}<br>` +
               (ps.length ? 'Spieler: ' + ps.join(', ') : 'Keine anderen Spieler in Sicht');
    }
    let sugList = null, sugKey = '';
    function refreshSug() {                         // fertige Routen nur neu rechnen, wenn Bereich/Karte sich ändern
        const k = [cfg.lvlMin, cfg.lvlMax, mapId(), worldN(), heroLvl()].join('|');
        if (k === sugKey) return;
        sugKey = k; sugList = world ? suggestRoutes(cfg.lvlMin, cfg.lvlMax, 5) : null;
    }
    function refreshXp() {                          // XP-Orte nur neu rechnen, wenn Bereich/Karte/Weltkarte sich ändern
        const k = [cfg.lvlMin, cfg.lvlMax, mapId(), worldN(), heroLvl()].join('|');
        if (k === xpKey) return;
        xpKey = k; xpSel = 0;
        xpList = world ? xpMaps(cfg.lvlMin, cfg.lvlMax, 5) : null;
    }

    function state() {
        if (deadNow) return ['dead', 'Tot', 'Warte auf Wiederbelebung'];
        if (capt.state === 'open' && (cfg.on || cfg.travel || cfg.chain)) return ['dead', 'Pause: Zagadka', cfg.autoCaptcha ? (capt.solving ? 'Klicke *…*-Antworten…' : (cfg.autoCaptchaConfirm ? 'Auto-Lösen aktiv' : 'Antworten gewählt – bitte Potwierdzam')) : 'Bitte das Rätsel selbst lösen – danach geht es weiter'];
        if (cfg.chain) {
            const r = ruleById(cfg.chain.rid), st = r && r.steps[cfg.chain.i];
            return ['trv', 'Ablauf', `Schritt ${cfg.chain.i + 1}/${r ? r.steps.length : '?'}: ${st ? stepText(st) : ''}`];
        }
        if (cfg.travel) return ['trv', 'Unterwegs', cfg.travel.label + (lastTravel ? ` · noch ${lastTravel.left} ${lastTravel.left === 1 ? 'Karte' : 'Karten'}` + (lastTravel.tele ? ` (${lastTravel.tele}× Teleport)` : '') : '')];
        if (!cfg.on) return ['', 'Bereit', botMode() === 'route' ? (cfg.route ? 'Route „' + cfg.route + '“ gewählt · ' + mapName() : 'Route wählen oder aufnehmen') : 'XP-Ort wählen · ' + mapName()];
        if (cfg.back) return ['trv', 'Rückweg', cfg.back.map];
        if (inBattle()) return ['run', 'Kampf', mapName()];
        const p = lastPlan;
        if (offRoute && cfg.routes[cfg.route]) return offRoute.way
            ? ['trv', 'Weg zur Route', (lastTravel ? `noch ${lastTravel.left} ${lastTravel.left === 1 ? 'Karte' : 'Karten'} · ` : '') + 'greift unterwegs nichts an']
            : ['dead', 'Kein Weg zur Route', mapName() + ' – bitte selbst zur Route laufen'];
        if (!p && fog.on && !fog.doneAt) return ['run', 'Erkundet', `Nebel auf ${mapName()} · ${fog.pct} % abgesucht`];
        if (!p && fog.on && fog.doneAt) return ['run', 'Patrouille', `${fog.spawns.size} Fundstellen auf ${mapName()}`];
        if (cfg.routes[cfg.route] && !p) { const rs = routeStep(); return ['run', 'Route', rs ? `${mapName()} → ${rs.next}` : 'unterwegs zur Route']; }
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

    function xpTab() {
        refreshXp();
        const running = cfg.on || cfg.travel || cfg.chain, here = mapId(), l = heroLvl(), mode = botMode();
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
            if (running) cta = `<button class="cta stop" data-a="stopall">${ico('stop')}Stopp</button>`;
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
                      ${names.map(n => `<option value="${esc(n)}" ${cfg.route === n ? 'selected' : ''}>${esc(n)} · ${cfg.routes[n].maps.length} Karten</option>`).join('')}</select>
                    ${ro ? `<div class="spot sel route">
                      <span class="nm">${esc(m[0])} → ${esc(z)}</span><span class="ds">${m.length} Karten</span>
                      ${world ? (() => { const ml = ro.maps.flatMap(e => entryIds(e).slice(0, 1)).flatMap(id => world[id] ? world[id][4].filter(x => x[1] >= cfg.lvlMin && x[1] <= cfg.lvlMax) : []);
                          return ml.length ? `<span class="mt xpl">${xpLine(rateXp(ml, heroLvl()))}</span>` : ''; })() : ''}
                      <span class="mt rprog"></span></div>
                      ${m.length > 2 ? `<div class="hint" style="margin-top:8px">Am Ende der Route</div>
                        <select data-a="rmode"><option value="back" ${routeMode(ro) === 'back' ? 'selected' : ''}>zurück: ${esc(z)} → ${esc(y)} → …</option>
                        <option value="loop" ${routeMode(ro) === 'loop' ? 'selected' : ''}>im Kreis: ${esc(z)} → ${esc(m[0])}</option></select>` : ''}` : ''}
                    <div class="fld">${rec}${ro && !cfg.rec ? `<button class="btn" data-a="delroute">${ico('trash')}Löschen</button>` : ''}</div>`;
            }
            const sg = sugList || [];
            body += `<h4>Fertige Routen für Level ${cfg.lvlMin}–${cfg.lvlMax}</h4>` + (!world ? '<div class="hint">Erst die Weltkarte laden.</div>' :
                sg.length ? `<div class="spots">${sg.map((o, i) => `
                  <button class="spot" data-a="sugtake" data-i="${i}">
                    <span class="nm">${esc(o.name)}</span>
                    <span class="ds">${o.d < 1 ? 'hier' : Math.round(o.d) + ' Schritte'}</span>
                    <span class="mt">${o.maps.length} Karten · ${o.n} Mobs · ${esc(wname(o.maps[0]))} → ${esc(wname(o.maps[o.maps.length - 1]))}</span>
                    <span class="mt xpl">${xpLine(o.r)}</span>
                  </button>`).join('')}</div><div class="hint">Antippen übernimmt die Route. Gelaufen wird hin und zurück.</div>`
                : '<div class="hint">Keine zusammenhängenden Karten für diesen Bereich – Level-Bereich größer machen oder XP-Ort nutzen.</div>');
            if (running) cta = `<button class="cta stop" data-a="stopall">${ico('stop')}Stopp</button>`;
            else if (ro) cta = `<button class="cta" data-a="runroute">${ico('play')}Route „${esc(cfg.route)}“ starten</button>`;
            else cta = '';
        }
        return `
            <div class="now"><div class="st"><span class="dot"></span><span class="stl"></span></div>
              <div class="dt"></div><div class="kp"></div></div>
            <div class="seg">
              <button class="${mode === 'xp' ? 'on' : ''}" data-a="mode" data-m="xp"><b>XP-Ort suchen</b><span>bester Ort für dein Level</span></button>
              <button class="${mode === 'route' ? 'on' : ''}" data-a="mode" data-m="route"><b>Route laufen</b><span>deine aufgenommene Strecke</span></button>
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
            <label class="chk"><input type="checkbox" data-a="autoCaptcha" ${cfg.autoCaptcha ? 'checked' : ''}>Zagadka: Antworten mit * automatisch anklicken</label>
            <label class="chk"><input type="checkbox" data-a="autoCaptchaConfirm" ${cfg.autoCaptchaConfirm ? 'checked' : ''}>Zagadka: danach auch „Potwierdzam“ klicken</label>
            <label class="chk"><input type="checkbox" data-a="captchaWarn" ${cfg.captchaWarn !== false ? 'checked' : ''}>Bei Zagadka Ton und Benachrichtigung</label>
            <div class="hint">Vorwarnung (Zähler) → Bot jagt weiter. Sobald das Fenster da ist: Bot pausiert und klickt (wenn aktiv) alle *…*-Antworten. „Potwierdzam“ nur bei zweiter Option.</div>
            <div class="hint">Auf Karten mit Nebel sieht der Bot nur Mobs in seiner Nähe und läuft die Karte ab, um weitere zu finden.</div>

            <h4>Andere Spieler</h4>
            <select data-a="pkMode"><option value="off" ${cfg.pk.mode === 'off' ? 'selected' : ''}>nicht beachten</option>
              <option value="follow" ${cfg.pk.mode === 'follow' ? 'selected' : ''}>reagieren, wenn mir jemand folgt</option>
              <option value="any" ${cfg.pk.mode === 'any' ? 'selected' : ''}>reagieren auf jeden Spieler auf der Karte</option></select>
            ${cfg.pk.mode === 'off' ? '' : `
            ${cfg.pk.mode === 'follow' ? `<div class="fld"><span>Folgt, wenn</span><input class="num" data-a="pk" data-f="near" value="${cfg.pk.near}">Felder ·
              <input class="num" data-a="pk" data-f="sec" value="${cfg.pk.sec}">s</div>` : ''}
            <div class="fld"><span>Kämpfen bis</span><input class="num" data-a="pk" data-f="maxUp" value="${cfg.pk.maxUp}">Lvl über mir</div>
            <div class="fld"><span>Nie angreifen</span><input type="text" data-a="pkNever" value="${esc(cfg.pk.never || '')}" placeholder="Namen, mit Komma"></div>
            <div class="hint">Rote Karte und höchstens so viele Level über dir: der Bot kämpft. Sonst läuft er sofort zur nächsten Karte und greift hier keine Mobs mehr an.</div>
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
    function diagText() {
        const it = allItems();
        return [
            'Spielbefehl _g: ' + (typeof W._g === 'function' ? 'da' : 'FEHLT'),
            'Gegenstände gefunden: ' + it.length + ' (Tasche ' + bag().length + ', angelegt ' + worn().length + ')',
            'Heiltränke: ' + potionCount(),
            'Zagadka: ' + (captchaOpen() ? 'offen' : capt.state === 'soon' ? 'kommt bald' : 'keine') +
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

    // ── Tab „Handel“ ──
    const RCOL = { common: 'var(--mut)', unique: '#e9d66b', heroic: '#7fb3ef', upgraded: '#e8a93c', legendary: '#f08a4b', artefact: '#ec7a6a' };
    const KIND = { markt: ['Unter Marktpreis', 'var(--ok)'], npc: ['Unter NPC-Wert', 'var(--amb2)'], bald: ['Endet bald', 'var(--blue)'] };
    function fmtLeft(s) { return !s ? '' : s < 60 ? s + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1).replace('.', ',') + ' h'; }
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
            // Altes Interface (Polen: „stary interfejs“) hat keine Engine → Bot kann dort nichts lesen
            if (!W.Engine && performance.now() > 15000 && !box.dataset.si && document.querySelector('#base, #panel, #centerbox')) {
                box.dataset.si = '1';
                box.innerHTML = `<div class="hd"><div class="brand"><span class="dot dead"></span>MargoBot</div></div>
                    <div class="bd"><div class="empty">Dieses Spielfenster nutzt das <b>alte Interface</b>. Der Bot braucht das
                    <b>neue Interface</b> – in den Spieleinstellungen umstellen (PL: „Nowy interfejs“) und die Seite neu laden.</div></div>`;
            }
            return;
        }
        if (cfg.lvlMin === 1 && cfg.lvlMax === 300 && heroLvl()) {   // erster Start: Bereich um das eigene Level
            cfg.lvlMin = Math.max(1, heroLvl() - 5); cfg.lvlMax = heroLvl() + 3; save();
        }
        const mn = mapName(), tab = ['set', 'rules', 'trade'].includes(cfg.tab) ? cfg.tab : 'xp';
        const running = !!(cfg.on || cfg.travel || cfg.chain);
        if (tab === 'xp') refreshXp();
        const rk = editId ? [editId, !!shopOpen(), (cfg.rules || []).map(r => [r.id, r.when.t, r.steps.map(x => x.t)])] : cfg.rules;
        if (tab === 'xp' && botMode() === 'route') refreshSug();
        if (botMode() === 'xp') refreshXp();
        const sKey = JSON.stringify([cfg.open, tab, running, mn, rk, cfg.chain, botMode(), capt.state,
                                     tab === 'trade' ? [!!MK.scan, !!auctionOpen(), MK.deals.map(d => d.id + d.kind), cfg.trade, market.scans] : 0, sugList && sugList.map(o => o.maps.join()), cfg.route, cfg.rec && cfg.rec.length, Object.keys(cfg.routes),
                                     cfg.routes[cfg.route] && routeMode(cfg.routes[cfg.route]), worldN(), xpList && xpList.map(o => o.id), xpSel, cfg.lvlMin, cfg.lvlMax, heroLvl(),
            tab === 'set' ? [JSON.stringify(cfg.tele || {}).length, cfg.routes[cfg.route] && routeMode(cfg.routes[cfg.route]), mobs().map(m => m.key).sort(), gateways().map(g => g.id), cfg.route, cfg.rec && cfg.rec.length, Object.keys(cfg.routes),
                             cfg.picked, cfg.lvlOn, (cfg.deaths || []).length, cfg.onDeath, cfg.optimal, cfg.pk.mode] : 0]);
        if (sKey !== lastStatic) {
            lastStatic = sKey;
            box.innerHTML = `<div class="hd"><div class="brand"><span class="dot"></span>MargoBot</div>
                ${headButton(running)}
                <button class="ib" data-a="fold" title="${cfg.open ? 'Einklappen' : 'Ausklappen'}">${ico(cfg.open ? 'min' : 'max')}</button></div>` +
                (capt.state ? `<div class="capt ${capt.state}"><b>${capt.state === 'open' ? (cfg.autoCaptcha ? (capt.solving ? 'Zagadka – klicke *…*-Antworten…' : (cfg.autoCaptchaConfirm ? 'Zagadka – Auto-Lösen aktiv' : 'Zagadka – bitte Potwierdzam tippen')) : 'Zagadka – bitte selbst lösen') : 'Zagadka kommt bald'}</b><span class="ct"></span></div>` : '') +
                (cfg.open ? `<div class="tabs"><button class="tab ${tab === 'xp' ? 'on' : ''}" data-a="tab" data-t="xp">XP</button>
                    <button class="tab ${tab === 'rules' ? 'on' : ''}" data-a="tab" data-t="rules">Abläufe${(cfg.rules || []).length ? ' · ' + cfg.rules.filter(r => r.on).length : ''}</button>
                    <button class="tab ${tab === 'trade' ? 'on' : ''}" data-a="tab" data-t="trade">Handel</button>
                    <button class="tab ${tab === 'set' ? 'on' : ''}" data-a="tab" data-t="set">Einstellungen</button></div>
                    <div class="bd">${tab === 'xp' ? xpTab() : tab === 'rules' ? rulesTab() : tab === 'trade' ? tradeTab() : setTab()}</div>` : '');
        }
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
            rp.textContent = rs ? `${rs.back ? 'Rückweg' : 'Hinweg'} · Karte ${rs.pos + 1}/${rs.n} · weiter nach ${rs.next}` + (currentExit() ? '' : ' – Tür fehlt hier!')
                : mn + ' gehört nicht zur Route' + (world ? ' – beim Start läuft der Bot hin' : '');
        }
        const rt = q('.rt');
        if (rt) {
            const r = cfg.routes[cfg.route], rs = r ? routeStep() : null;
            rt.textContent = !r ? 'Einmal selbst ablaufen und aufnehmen; die Mobs, die du dabei angreifst, werden angehakt.' :
                rs ? `${rs.back ? 'Rückweg' : 'Hinweg'} · Karte ${rs.pos + 1}/${rs.n}: ${mn} → weiter nach ${rs.next}` + (currentExit() ? '' : ' (Tür fehlt auf dieser Karte)') :
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
        cfg.lvlOn = true; cfg.route = ''; cfg.mode = 'xp'; cfg.travel = null; cfg.on = true; goal = null;
        startSession(); log('Jage Level ' + cfg.lvlMin + '–' + cfg.lvlMax + ' auf ' + mapName());
    }
    box.addEventListener('click', ev => {
        const el = ev.target.closest('[data-a]');
        if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'LABEL') return;
        const a = el.dataset.a;
        if (rulesClick(a, el)) { save(); lastStatic = ''; render(); return; }
        if (a === 'tscan') { startScan(); render(); return; }
        if (a === 'tstop') { stopScan('Scan gestoppt'); render(); return; }
        if (a === 'tshow') { const d = MK.deals[+el.dataset.i]; if (d) showOffer(d); return; }
        if (a === 'treset') { if (W.confirm('Alle gemerkten Marktpreise löschen?')) { market = { items: {}, scans: 0, last: 0 }; saveMarket(); MK.deals = []; } lastStatic = ''; render(); return; }
        if (a === 'tnum') {
            const tc = tradeCfg(), f = el.dataset.f;
            tc[f] = Math.max(+el.dataset.lo, Math.min(+el.dataset.hi, (+tc[f] || 0) + +el.dataset.d));
            cfg.trade = tc; save(); if (MK.deals.length) MK.deals = findDeals(dealPool()); lastStatic = ''; render(); return;
        }
        if (a === 'tab') cfg.tab = el.dataset.t;
        else if (a === 'fold') cfg.open = !cfg.open;
        else if (a === 'stopall') { if (sess.t0 && !sess.end) { sess.end = Date.now(); saveSess(); } if (cfg.chain) endChain('von Hand'); cfg.on = false; cfg.travel = null; lastTravel = null; goal = null; log('Gestoppt'); }
        else if (a === 'quick') { cfg.on = true; goal = null; startSession(); log('Gestartet'); }
        else if (a === 'huntxp') huntHere();
        else if (a === 'sugtake') {
            const o = sugList && sugList[+el.dataset.i];
            if (!o) return;
            let name = o.name, k = 2;
            while (cfg.routes[name] && JSON.stringify(cfg.routes[name].maps) !== JSON.stringify(o.maps)) name = o.name + ' (' + k++ + ')';
            cfg.routes[name] = { maps: o.maps, mode: 'back', picked: {}, lvlOn: true, lvlMin: cfg.lvlMin, lvlMax: cfg.lvlMax, gen: true };
            selectRoute(name);
        }
        else if (a === 'runroute') { cfg.travel = null; cfg.on = true; goal = null; startSession(); log('Route „' + cfg.route + '“ gestartet'); }
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
        if (rulesChange(t)) { save(); if ((a !== 'sf' || t.tagName === 'SELECT') && a !== 'wn') { lastStatic = ''; render(); } return; }
        if (t.dataset.k && t.type === 'checkbox') cfg.picked[t.dataset.k] = t.checked;
        else if (a === 'lvlOn' || a === 'closeBattle' || a === 'autoCaptcha' || a === 'autoCaptchaConfirm' || a === 'captchaWarn') cfg[a] = t.checked;
        else if (a === 'fogExplore') { cfg.fogExplore = t.checked; if (!t.checked) fog.on = false; }
        else if (a === 'exit') cfg.exits[mapName()] = t.value || undefined;
        else if (a === 'onDeath') cfg.onDeath = t.value;
        else if (a === 'pkMode') { cfg.pk.mode = t.value; pkFlee = null; }
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
    render();
})();
