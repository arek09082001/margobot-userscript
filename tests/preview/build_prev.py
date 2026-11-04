from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
S = str(HERE) + '/'
src = open(ROOT / 'margobot_auto.user.js', encoding='utf-8').read()
world = open(ROOT / 'margobot_world.json', encoding='utf-8').read()
html = '''<!doctype html><html><head><meta charset="utf-8"><title>prev</title>
<style>html,body{margin:0;height:100%;background:#0b0b0b url(https://micc.garmory-cdn.cloud/obrazki/miasta/torneg.9.png) -900px -1300px;}</style></head><body>
<script>
const WORLD = __WORLD__;
const g = WORLD['2'][3];
const params = new URLSearchParams(location.search);
const npcs = [['Szary wilk',15,'zwi/wilk_szary1.gif',40,55,2],['Szary wilk',15,'zwi/wilk_szary1.gif',44,58,2],['Zjawa',16,'pot/bestia26.gif',50,50,2],
  ['Uzdrowicielka Elena',0,'kob/x.gif',48,58,0]].map((n,i)=>({d:{id:i+1,nick:n[0],lvl:n[1],icon:n[2],x:n[3],y:n[4],type:n[5]}}));
const items = [{id:601,name:'Rusty Ghoul Blade',loc:'g',st:0,cl:1,stat:'lvl=40'},{id:501,name:'Mała mikstura',loc:'g',st:0,stat:'leczy=150;amount=3'},{id:502,name:'Stalowy miecz',loc:'g',st:0,stat:'lvl=25'},
  {id:503,name:'Drewniana tarcza',loc:'g',st:4,stat:''}];
window.sent = [];
window._g = c => { sent.push(c); console.log('_g', c); const m = c.match(/moveitem&st=1&id=(\\d+)/); if (m) { const it = items.find(i=>i.id==m[1]); if (it && /lvl/.test(it.stat)) it.st = 1; } };
window.Engine = { hero:{ d:{x:47,y:60,lvl:+(params.get('lvl')||18),exp:184000,gold:5400,nick:'Test',warrior_stats:{hp:620,maxhp:900}}, autoGoTo(p){ Engine.hero.d.x=p.x; Engine.hero.d.y=p.y; }, heroAtackRequest(){} }, battle:{show:false},
  npcs:{getDrawableList:()=>npcs}, deadController:{}, items:{ fetchLocationItems:l => l==='g' ? items.map(d=>({d})) : [] },
  map:{ d:{id:2,name:'Torneg'}, size:{x:96,y:64}, col:{check:()=>0},
    getGateways:()=>({ townnames:{12:'Old Ruins',2029:'Grain Fields',66:"Mir's House"}, getList:()=>g.map(x=>({d:{id:x[0],x:x[1],y:x[2]}})) }) } };
const RULES = [
  {id:'a', on:true, when:{t:'lvl', n:25}, steps:[{t:'equip', name:'Stalowy miecz'},{t:'xp'}]},
  {id:'b', on:true, when:{t:'heal', n:5}, steps:[{t:'go', map:'2'},{t:'npc', name:'Uzdrowicielka Elena', say:'Chcę coś kupić'},{t:'buy', n:30, name:'Mała mikstura'},{t:'back'},{t:'xp', min:16, max:20}]},
  {id:'c', on:false, when:{t:'hp', n:30}, steps:[{t:'fill'}]}, {id:'q', on:true, when:{t:'hand'}, steps:[{t:'sell', what: params.get('what') || 'quick123', closeAfter: true}]}];
// MARKETDEMO
const MKT = { items: {}, scans: 2, last: Date.now() - 12 * 60000 };
for (let k = 0; k < 120; k++) MKT.items['Item ' + k + '|unique'] = { n: 'Item ' + k, r: 'unique', l: 100, npc: 1000, p: [[500000, Date.now(), 'x' + k]] };
const store = { mbmarket: params.has('mkt') ? MKT : null, mbworld: WORLD, mbauto: { x: 40, y: 20, tab: params.get('tab') || 'xp', logOpen: params.has('log'),
  rules: params.has('norules') ? [] : RULES, routes: {Ghule: {maps:['Defiled Tomb - 1st Level',null,'Defiled Tomb - 2nd Level','Defiled Tomb - 3rd Level','Defiled Tomb - 4th Level','Defiled Tomb - 5th Level'], lvlOn:true, lvlMin:40, lvlMax:42}}, route: params.has('route') ? 'Ghule' : '', names: {2:'Torneg',12:'Old Ruins',2029:'Grain Fields'}, npcs: {2:['Lidia','Den','Uzdrowicielka Elena']}, dlg: {'Uzdrowicielka Elena':['Chcę coś kupić','Opowiedz mi o okolicy','Do widzenia']}, shops: {'Uzdrowicielka Elena':['Mała mikstura','Średnia mikstura','Antidotum']} } };
// ?e2: eine E2 gewählt, vor 6 min getötet · ?away: Startseite nach „Spiel verlassen“ (ohne Engine)
if (params.has('e2') || params.has('away')) store.mbauto.e2 = { on: params.has('away') || params.has('e2on'), sel: 'Mushita|580', away: params.has('away') || params.has('leave') ? 'leave' : 'stay',
  leaveMin: 10, remindMin: 2, remindMax: 4, offline: params.has('away'), wakeAt: Date.now() + 7 * 60000,
  list: { 'Mushita|580': { nick: 'Mushita', lvl: 23, map: 580, x: 23, y: 11, respMin: 15, respMax: 30, lastKill: Date.now() - 6 * 60000, by: 'bot', kills: 3, meas: [17.4, 21.2] } } };
if (params.has('away')) delete window.Engine;
let lastSkillsReady = 0;
// SKILLSDEMO: Fähigkeiten wie beim Paladin (gekürzt), ?noskills = Daten noch nicht geladen
if (params.has('skills')) {
  const mk = (id, name, grp, xy, c, type, reqw, lvl) => ({ id, name, grp, xy, cLvl: c, mLvl: 10, lvl: c + '/10', type, kind: 'x', desc: 'Beschreibung von ' + name + ' aus dem Spiel.',
    regs: 'reqp=p;' + (reqw ? 'reqw=' + reqw + ';' : '') + 'lvl=' + lvl, allStats: Array.from({ length: 10 }, (_, k) => 'sa_per=' + (2 * (k + 1)) + ';energy=' + (18 + k) + ';cooldown=2') });
  const list = [mk(99, 'Gorące uderzenie', 9, 1, 0, 'active', 'fire', 25), mk(112, 'Porażający cios', 9, 3, 10, 'active', 'light', 25), mk(38, 'Szybki atak', 9, 4, 10, 'active', 'sw', 25),
    mk(185, 'Moc sprawiedliwych', 9, 5, 10, 'passive', '', 25), mk(186, 'Skupienie na celu', 10, 1, 2, 'passive', '1h', 35), mk(25, 'Prowokujący okrzyk', 10, 5, 0, 'active', 'sh', 35),
    mk(201, 'Niebiańska ochrona', 14, 2, 4, 'passive', '', 170), mk(301, 'Napięcie bojowe', 15, 3, 0, 'passive', 'light', 230)];
  const all = Object.fromEntries(list.map(x => ['skill_' + x.id, x])); all['skill_-1'] = { id: -1, name: 'Zwykły atak', lvl: '1/1' };
  Engine.skills = { getSkills: () => all, getGroupedSkills: () => ({ 1: { requiredLvl: '25' }, 2: { requiredLvl: '35' }, 3: { requiredLvl: '170' }, 4: { requiredLvl: '230' } }) };
  Engine.hero.d.lvl = +(params.get('lvl') || 232); Engine.hero.d.gold = 52000000; items.push({ id: 900, name: 'Zainfekowana kość anuraka', loc: 'g', st: 5, cl: 1, stat: 'dmg=3427,4188;light=1692,2538;lvl=226' }, { id: 901, name: 'Płyta ośmiu odnóży', loc: 'g', st: 7, cl: 14, stat: 'ac=1132' });
  store.mbauto.tab = 'skills'; lastSkillsReady = 1;
}
window.GM_getValue = (k,d) => store[k] ?? d; window.GM_setValue = (k,v) => { store[k] = v; };
window.unsafeWindow = window;
</script>
<script>
__SRC__
</script>
<script>
const clk = s => { const e = document.querySelector(s); if (e) e.click(); else console.error('fehlt', s); };
// QSHOP: nachgebauter Laden mit Schnellverkauf
if (params.has('shop')) {
  window.clicks = [];
  const w = document.createElement('div'); w.className = 'c-window border-window shop-wnd';
  w.style.cssText = 'position:fixed;left:470px;top:60px;width:260px;height:260px;background:#2b2418;color:#eee;padding:10px;font:12px sans-serif';
  w.innerHTML = '<div class="shop-items" style="width:200px;height:90px;background:#3a3020"><div class="item shop-item item-id-9">x</div></div>' +
    '<div class="sell-area">Sell <span class="basket"></span> ' + [1,2,3].map(n => '<div class="greenbtn" style="display:inline-block;margin:4px;padding:4px 7px;background:#2a6"><span>' + n + '</span></div>').join('') + '</div>' +
    '<div class="button green" style="margin-top:10px;padding:6px;background:#585"><div class="label">Accept</div></div><div class="close-button" style="position:absolute;right:4px;top:4px;width:16px;height:16px;background:#a33"></div>';
  setTimeout(() => w.querySelector('.close-button').addEventListener('click', () => { clicks.push('X'); w.style.display = 'none'; }), 0);
  const inv = document.createElement('div'); inv.innerHTML = '<span style="position:fixed;left:740px;top:10px">1</span><span style="position:fixed;left:760px;top:10px">14</span>' +
    '<div class="item item-id-601" style="position:fixed;left:740px;top:40px;width:30px;height:30px;background:#777">S</div>';
  document.body.appendChild(inv);
  inv.querySelector('.item-id-601').addEventListener('click', () => { clicks.push('item601'); const b = w.querySelector('.basket'); const it = document.createElement('div'); it.className = 'item'; it.style.cssText='display:inline-block;width:10px;height:10px;background:#aaa'; b.appendChild(it); });
  // MULTI: Taschen voller Beute, je Druck max. 10 in den Korb, Accept verkauft den Korb
  for (let k = 0; k < 25; k++) items.push({ id: 700 + k, name: 'Beute A' + k, loc: 'g', st: 0, cl: 1, stat: '', bagNo: 1 });
  for (let k = 0; k < 8; k++) items.push({ id: 800 + k, name: 'Beute B' + k, loc: 'g', st: 0, cl: 8, stat: '', bagNo: 2 });
  let basket = [];
  window.sold = 0;
  document.body.appendChild(w);
  w.addEventListener('click', e => { const g = e.target.closest('.greenbtn'); if (g) { const n = +g.textContent.trim();
      basket = items.filter(i => i.bagNo === n).slice(0, 10); } const a = e.target.closest('.button'); if (a && a.textContent.trim() === 'Accept') {
      for (const it of basket) items.splice(items.indexOf(it), 1); sold += basket.length; basket = []; } }, true);
  w.addEventListener('click', e => { const t = e.target.closest('.greenbtn, .button'); if (t) { clicks.push(t.textContent.trim()); console.log('Klick', t.textContent);
     if (t.textContent.trim() === 'Accept') { const a = document.createElement('div'); a.className = 'alert-window'; a.innerHTML = '<button>Tak</button>'; a.style.cssText='position:fixed;left:500px;top:340px'; a.querySelector('button').onclick = () => { clicks.push('Tak'); a.remove(); }; document.body.appendChild(a); } } });
  setTimeout(() => document.querySelector('[data-a=rrun][data-r=q]').click(), 400);
}
// FAKEHIDDEN: Spiel hat captcha-Elemente auch ohne Rätsel
{ const h = document.createElement('div'); h.className = 'captcha-wnd captcha'; h.style.cssText = 'position:fixed;left:600px;top:200px;width:200px;height:50px;visibility:hidden'; h.innerHTML = '<div class="captcha__buttons"><div class="button">x</div></div>'; document.body.appendChild(h);
  const h2 = document.createElement('div'); h2.className = 'captcha-info-icon'; h2.style.cssText = 'position:fixed;left:10px;bottom:10px;width:20px;height:20px;background:#333'; document.body.appendChild(h2); }
// CAPTTEST: Zagadka-Hinweis, dann Rätsel, dann gelöst
if (params.has('capt')) {
  window.moves = []; const orig = Engine.hero.autoGoTo; Engine.hero.autoGoTo = p => { moves.push(Math.round(performance.now() / 1000)); orig(p); };
  setTimeout(() => document.querySelector('[data-a=huntxp]').click(), 300);
  const n = document.createElement('div'); n.style.cssText = 'position:fixed;left:520px;top:6px;background:#222;color:#fff;padding:6px';
  setTimeout(() => { n.innerHTML = '<div class="riddle-info">Zagadka pojawi się za: 148s</div><div class="button">Rozwiąż teraz</div>'; document.body.appendChild(n); }, 1500);
  setTimeout(() => { n.innerHTML = '<div class="captcha"><div class="captcha__buttons"><div class="button small green"><div class="label">*a*</div></div></div></div>'; window.openAt = Math.round(performance.now() / 1000); }, 4500);
  setTimeout(() => { n.remove(); window.closeAt = Math.round(performance.now() / 1000); }, 10500);
}
// AHDEMO: nachgebautes Auktionshaus (3 Seiten à 5)
if (params.has('ah')) {
  const all = []; let id = 9000;
  const mk = (name, rar, lvl, npc, buy, bid, tm) => all.push({ d: { id: ++id, name, loc: 'a', pr: npc, stat: 'rarity=' + rar + ';lvl=' + lvl }, buy, bid, tm });
  for (let k = 0; k < 6; k++) mk('Skalne skrzydło nomada', 'unique', 280, 538804, 1200000, 0, '21m 4s');
  mk('Skalne skrzydło nomada', 'unique', 280, 538804, 450000, 0, '3h 2m');      // deutlich unter Markt
  for (let k = 0; k < 4; k++) mk('Posępny kordelas zakapiora', 'unique', 100, 90101, 500000, 0, '6m 13s');
  mk('Stary miecz', 'common', 20, 40000, 12000, 0, '1h');                       // unter NPC-Wert
  mk('Drażnienie smoka', 'heroic', 270, 900000, 55000000, 0, '30m'); mk('Drażnienie smoka', 'heroic', 270, 900000, 55000000, 0, '31m'); mk('Drażnienie smoka', 'heroic', 270, 900000, 54000000, 0, '33m');
  let page = 1; const per = 5, loaded = () => all.slice(0, page * per);
  const w = document.createElement('div'); w.className = 'c-window'; w.style.cssText = 'position:fixed;left:430px;top:60px;width:420px;background:#2b2418;color:#eee;font:12px sans-serif;padding:8px';
  w.innerHTML = '<div class="one-category-auction" style="display:inline-block;padding:4px;background:#554">Broń</div><input placeholder="Nazwa przedmiotu"> <div class="button" style="display:inline-block;padding:3px;background:#585">Odśwież</div><div class="all-auction-section" style="max-height:300px;overflow:auto"></div>';
  document.body.appendChild(w);
  const draw = () => { w.querySelector('.all-auction-section').innerHTML = loaded().map(x => '<div class="row"><div class="auction-td item-slot-td"><div class="item item-id-' + x.d.id + '" style="width:20px;height:20px;background:#777;display:inline-block"></div></div><div class="item-name-td">' + x.d.name + '</div><div class="item-time-td">' + x.tm + '</div><div class="item-bid-td">' + (x.bid || '') + '</div><div class="item-buy-now-td">' + (x.buy >= 1e6 ? (x.buy / 1e6) + 'm' : Math.round(x.buy / 1e3) + 'k') + ' Kup teraz</div></div>').join(''); };
  draw();
  Engine.items.fetchLocationItems = l => l === 'a' ? loaded().map(x => ({ d: x.d })) : l === 'g' ? items.map(d => ({ d })) : [];
  Engine.auctions = { getAuctionPages: () => ({ getCurrentPage: () => page, getMaxPage: () => Math.ceil(all.length / per), getNextPageAction: () => { setTimeout(() => { page++; draw(); }, 250); } }) };
  w.querySelector('.one-category-auction').onclick = () => { setTimeout(() => { page = 1; draw(); }, 250); };
  for (let k = 0; k < 30; k++) mk('Füller ' + k, 'common', 50, 1000, 90000, 0, '2h');
}
// FAKEWND: Punktezahlen wie im offenen Fähigkeiten-Fenster
if (params.has('skills')) { const f = document.createElement('div'); f.style.cssText = 'position:fixed;right:8px;bottom:8px;background:#222;color:#fff;padding:6px'; f.innerHTML = 'Punkte: <span class="skills_learnt">49</span>/<span class="skills_total">52</span>'; document.body.appendChild(f); }
if (params.has('edit')) setTimeout(()=>clk('[data-a=redit][data-r=b]'), 200);
if (params.has('runb')) setTimeout(()=>clk('[data-a=rrun][data-r=c]'), 200);
</script></body></html>'''
open(S + 'index.html', 'w', encoding='utf-8').write(html.replace('__WORLD__', world).replace('__SRC__', src))
print('ok')
