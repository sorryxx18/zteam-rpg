import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.mjs';
import {createMusicPlayer} from '../music.mjs';
import {createRace as createRaceForKinds} from '../race.mjs';
import {localTestRate} from '../qa-clock.mjs';
const root=new URL('../',import.meta.url);
async function harness({location=new URL('https://public.example/'),musicPlayer=null,rejectMusic=false,musicStateError=false,wall=false,viewport=[780,1000],autoIntro=true,shortRoads=false,widePreload=false,realData=false,initialSite=0,bootFailure=null,movementOnly=false}={}){
  const html=await readFile(new URL('index.html',root),'utf8');
  const source=await readFile(new URL('game.js',root),'utf8');
  const storage=new Map();
  const elements=new Map(), calls=[],events={}, frames=[],drawCalls=[],raceInputs=[],timers=[];
  const context2d=new Proxy({}, {get:(o,k)=>o[k]??((...args)=>{drawCalls.push([k,...args]);}),set:(o,k,v)=>(drawCalls.push(['set',k,v]),o[k]=v,true)});
  function element(id=''){return {id,value:'',textContent:'',disabled:false,hidden:false,open:false,dataset:{},listeners:{},classList:{add(){},remove(){}},getContext:()=>context2d,getBoundingClientRect:()=>({width:780,height:1000}),append(o){this.options??=[];this.options.push(o);},setAttribute(k,v){this[k]=v;},focus(){document.activeElement=this;},closest:()=>null,setPointerCapture(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(k,fn){this.listeners[k]=fn;}};}
  for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements.set(id,element(id));
  for(const [,id,text] of html.matchAll(/id="([^"]+)"[^>]*>([^<]*)</g))if(elements.has(id))elements.get(id).textContent=text;
  const characters=['male','female','rhino'].map(name=>({...element(),dataset:{character:name,startCharacter:name},querySelector:()=>element()}));
  const document={activeElement:null,getElementById:id=>elements.get(id),createElement:()=>element(),addEventListener:(k,f)=>events[k]=f,querySelectorAll:s=>s.includes('character')?characters:[],querySelector:s=>element()};
  const base=JSON.parse(await readFile(new URL('data/base.json',root),'utf8'));
  elements.get('game').getBoundingClientRect=()=>({width:viewport[0],height:viewport[1]});
  const window={location,addEventListener:(k,f)=>events[k]=f,matchMedia:()=>({matches:viewport[0]<=900||viewport[1]<=450})};
  const box={...core,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},localTestRate,URLSearchParams,window,document,console,setTimeout:()=>1,clearTimeout(){},ResizeObserver:class{observe(){}},Image:class{set src(v){queueMicrotask(()=>this.onload());}},requestAnimationFrame:f=>frames.push(f),fetch:async url=>{calls.push(url);if(url.endsWith('base.json'))return {ok:true,json:async()=>base};if(url.endsWith('overview.json'))return {ok:true,json:async()=>({roads:[{p:[-5000,0,11000,0],w:8,n:'概覽路'}],stations:base.stations})};return {ok:true,json:async()=>({builds:wall?[{p:(()=>{const s=base.stations.find(s=>s.name.includes('莊敬'));return [s.x+.5,s.y-5,s.x+.51,s.y-5,s.x+.51,s.y+5,s.x+.5,s.y+5];})()}]:[],roads:[{p:[-5000,-677,11000,-677],w:8,n:'測試路'}]})};}};
  let now=0,offset=0;
  box.setTimeout=fn=>timers.push(fn);
  box.requestAnimationFrame=f=>frames.push(t=>{now=t+offset;f(now);});
  box.performance={now:()=>now};
  Object.assign(box,await import('../race.mjs'),await import('../missions.mjs'));
  // One-line synthetic road fixtures exercise legacy mechanics, not perimeter geography.
  // Real-data integration below uses the app's unmodified perimeter configuration.
  const realCreateRace=box.createRace;box.createRace=options=>{raceInputs.push(options);return realCreateRace(realData?options:{...options,config:{...options.config,npcSpawnMode:'nearest-station'}});};
  const rawFetch=box.fetch;
  const home=base.stations.find(s=>s.name.includes('莊敬'));
  const fixtureSite={n:'測試場所',addr:'測試路1號',use:'測試用途',st:home.name,x:home.x-30,y:home.y};
  if(widePreload)base.stations=base.stations.map((s,i)=>({...s,x:4400+i*10,y:2000}));
  if(shortRoads)box.fetch=async url=>{const response=await rawFetch(url);if(url.includes('/c/'))return {ok:true,json:async()=>({builds:[],roads:[{p:[home.x-25,home.y,home.x+25,home.y],w:12,n:'主要路'},{p:[home.x,home.y-25,home.x,home.y+25],w:6,n:'教育街'}]})};return response;};
  const mapFetch=box.fetch;
  // Keep a containing fire building at the fixture site so v2's real fire-site
  // resolution does not mistake the spawn collision wall 30m away for the fire.
  if(wall)box.fetch=async url=>{const response=await mapFetch(url);if(!url.includes('/c/'))return response;const data=await response.json();data.builds.push({p:[home.x-31,home.y-1,home.x-29,home.y-1,home.x-29,home.y+1,home.x-31,home.y+1]});return {ok:true,json:async()=>data};};
  const fixtureFetch=box.fetch;
  // Movement-only cases must not accidentally enter the new construction lock.
  const waterFixture=[{k:'hydrant_above',n:'近處消防栓',x:home.x+1,y:home.y+(movementOnly?20:0)},{k:'hydrant_under',n:'遠處水池',x:home.x+250,y:home.y},{k:'hydrant_under',n:'河川取水點',x:home.x+150,y:home.y+150}];
  const waterKey=`${Math.floor(home.x/500)}_${Math.floor(home.y/500)}`;
  box.fetch=async url=>{if(url.endsWith('mission-pool.json')){calls.push(url);return {ok:true,json:async()=>({eligible:[0,1]})};}if(url.endsWith('sites.json')){calls.push(url);return {ok:true,json:async()=>[fixtureSite,{...fixtureSite,n:'第二場所',x:home.x+10}]};}if(url.endsWith('/w/index.json')){calls.push(url);return {ok:true,json:async()=>[waterKey]};}if(url.includes('/w/')){calls.push(url);return {ok:true,json:async()=>waterFixture.map(w=>[w.x,w.y,w.k])};}if(url.endsWith('water.json')){calls.push(url);return {ok:true,json:async()=>waterFixture};}return fixtureFetch(url);};
  box.Math=Object.create(Math);box.Math.random=()=>initialSite/3;
  if(realData){const waterKeys=JSON.parse(await readFile(new URL('data/w/index.json',root),'utf8'));const paths=['base','sites','mission-pool','w/index',...waterKeys.map(k=>'w/'+k),...base.cells.map(k=>'c/'+k)];const files=new Map(await Promise.all(paths.map(async p=>[`./data/${p}.json`,JSON.parse(await readFile(new URL(`data/${p}.json`,root),'utf8'))])));box.fetch=async url=>{calls.push(url);return {ok:files.has(url),json:async()=>structuredClone(files.get(url))};};}
  const advance=ms=>{now=ms;frames.shift()(ms);};
  box.createMusicPlayer=()=>{let muted=false,playing=false;return {play:id=>{calls.push('play:'+id);playing=!rejectMusic;return rejectMusic?Promise.reject(Error('gesture denied')):Promise.resolve();},setState:id=>calls.push('state:'+id),cue:id=>calls.push('cue:'+id),pause(){playing=false;},setMuted(v){muted=v;},getState:()=>({muted,playing,track:'explore',error:musicStateError?'resume denied':null})};};
  if(musicPlayer)box.createMusicPlayer=()=>musicPlayer;
  if(bootFailure){const fetch=box.fetch;let once=true;box.fetch=async url=>{if(once&&url.endsWith(bootFailure)){once=false;throw Error('測試boot讀取失敗');}return fetch(url);};}
  vm.runInNewContext(source.replace(/^import .*?;\n/gm,'')+'\nthis.testPinnedCells=()=>[...pinnedCells];',box);
  const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};await settle();
  const skipPrelude=async()=>{if(window.__game.getState().phase==='mission')await click('mission-skip');for(let i=0;i<3&&window.__game.getState().phase==='tutorial';i++)await click('tutorial-next');};
  const click=async id=>{await elements.get(id)?.listeners.click?.({target:elements.get(id)});await settle();if(id==='start-game'&&autoIntro){await skipPrelude();if(window.__game.getState().phase==='intro'){advance(now-offset+2000);offset=now;}}};
  return {elements,calls,events,window,frames,click,settle,html,source,box,drawCalls,advance,raceInputs,timers,skipPrelude,storage};
}
test('v3 末30秒紅框與音樂加速，加分事件顯示連擊及截胡',async()=>{
 const h=await harness();const create=h.box.createRace;let events=[];h.box.createRace=options=>{const m=create(options);return {...m,getState:()=>({...m.getState(),remaining:30}),tick(){},drainEvents:()=>events.splice(0)};};await h.click('start-game');events.push({type:'capture',waterId:0,waterName:'測試消防栓',combo:2,comboBonus:1,interceptBonus:1});h.advance(100);assert.ok(h.calls.includes('state:tense'));assert.match(h.elements.get('intercept-feedback').textContent,/截胡/);assert.equal(h.elements.get('intercept-feedback').hidden,false);assert.ok(h.drawCalls.some(c=>c[0]==='fillText'&&String(c[1]).includes('連擊×2')));assert.match(h.source,/classList\.add\('urgent'\)/);
});
test('v3 右上只留單排工具，縮放收進設定，兩種消防栓放大且圖形不同',async()=>{
 const h=await harness();const tools=h.html.match(/class="tools">([^]*?)<\/div>/)[1];assert.doesNotMatch(tools,/id="zoom-/);assert.match(h.html,/id="music-settings-dialog"[^]*?id="zoom-in"/);await h.click('start-game');h.advance(180000);assert.ok(h.drawCalls.some(c=>c[0]==='rect'&&c[1]===-12&&c[2]===-12&&c[3]===24));
});
test('v3 結算地圖依本題實際範圍放大，不用固定大範圍把目標擠成一團',async()=>{
 const h=await harness();await h.click('start-game');h.advance(180000);const at=h.drawCalls.findLastIndex(c=>c[0]==='arc'&&c[3]===6),centres=h.drawCalls.slice(at+1).filter(c=>c[0]==='translate');assert.ok(centres.length>=3);const xs=centres.map(c=>c[1]);assert.ok(Math.max(...xs)-Math.min(...xs)>600,'780px測試畫布應充分展開本題249m寬的消防栓，而非固定640m留白');
});
test('v3 結算以含加分總分為主、星等只算佔領率，清單每局收合且從頂部顯示',async()=>{
 const h=await harness();let finished=false;const create=h.box.createRace;
 h.box.createRace=options=>{const m=create(options);return {...m,getState:()=>({...m.getState(),score:17,captured:6,total:15,totalHoses:31,comboBonus:5,interceptBonus:6,status:finished?'finished':'playing'}),tick(){},drainEvents:()=>[]};};
 await h.click('start-game');finished=true;h.advance(100);
 assert.equal(h.window.__game.getState().phase,'result');assert.equal(h.elements.get('result-score').textContent,'17 分');assert.equal(h.elements.get('result-stars').textContent,'★★☆');assert.match(h.elements.get('result-captured').textContent,/6.*15/);assert.match(h.elements.get('result-hoses').textContent,/31/);assert.match(h.elements.get('result-nearest').textContent,/最近.*消防栓.*公尺/);assert.match(h.elements.get('result-best').textContent,/普通.*17/);assert.equal(h.elements.get('result-details').open,false);assert.equal(h.elements.get('result-dialog').scrollTop,0);assert.equal(h.box.document.activeElement.id,'result-score');assert.equal(h.storage.get('zteam-rpg-highscore-normal'),'17');
});
test('B2 施工先於移動鎖定並清雙指，計時持續；原生取消清進度不殘留輸入',async()=>{
 const h=await harness();let construction={waterId:0,hoses:7,duration:3.5,elapsed:.5,contested:true},ticks=0,cancelled=0;
 const create=h.box.createRace;h.box.createRace=options=>{const model=create(options);return {...model,getState:()=>({...model.getState(),construction,totalHoses:4}),tick:(...args)=>{ticks++;return model.tick(...args);},cancelConstruction:()=>{cancelled++;construction=null;}};};
 await h.click('start-game');const get=()=>h.window.__game.getState(),start=get().x;
 const stick=h.elements.get('joystick');stick.getBoundingClientRect=()=>({left:40,top:200,width:128,height:128});
 stick.listeners.pointerdown({pointerId:1,clientX:148,clientY:264,preventDefault(){}});h.elements.get('run').listeners.pointerdown({pointerId:2,preventDefault(){}});
 h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});const before=ticks;h.advance(100);assert.equal(get().x,start,'施工查詢必須先於stepMove');assert.ok(ticks>before);assert.equal(get().runHeld,false);assert.equal(get().joystick.active,false);
 const panel=h.elements.get('construction-panel'),progress=h.elements.get('construction-progress');assert.ok(panel);assert.equal(panel.hidden,false);assert.equal(progress.max,3.5);assert.equal(progress.value,.5);assert.match(h.elements.get('construction-detail').textContent,/7.*0\.5.*3\.5/);assert.match(h.elements.get('construction-status').textContent,/搶線中/);assert.match(h.elements.get('total-hoses').textContent,/4/);
 await h.click('construction-cancel');assert.equal(cancelled,1);assert.equal(panel.hidden,true);assert.equal(progress.value,0);assert.equal(h.elements.get('construction-detail').textContent,'');h.advance(200);assert.equal(get().x,start);
 h.events.keydown({target:{closest:()=>null},key:'a',preventDefault(){}});h.advance(300);assert.ok(get().x<start,'取消後可新輸入離開水源');
 construction={waterId:0,hoses:2,duration:1,elapsed:.25,contested:false};h.advance(400);assert.equal(panel.hidden,false);construction=null;h.advance(500);assert.equal(panel.hidden,true);assert.equal(progress.value,0,'被搶或完工不保留進度');
 construction={waterId:0,hoses:2,duration:1,elapsed:.25,contested:false};h.advance(600);await h.click('settings');assert.equal(panel.hidden,true,'重選即清');
});
test('B2 真模型施工首幀鎖住、取消原地不重啟，離開3m再回來才重建並累計成功水帶',async()=>{
 const h=await harness();await h.click('start-game');const get=()=>h.window.__game.getState(),start=get().x;let time=0;
 assert.ok(get().race.construction);assert.equal(get().race.captured,0);assert.equal(h.elements.get('construction-panel').hidden,false);
 h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});h.advance(time+=100);assert.equal(get().x,start);assert.equal(get().moving,false);
 await h.click('construction-cancel');h.advance(time+=100);h.advance(time+=100);assert.equal(get().race.construction,null);assert.equal(get().race.totalHoses,0);
 h.events.keydown({target:{closest:()=>null},key:'a',preventDefault(){}});for(let i=0;i<9;i++)h.advance(time+=100);h.events.keyup({key:'a'});assert.ok(start-get().x>3);
 h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});for(let i=0;i<9&&!get().race.construction;i++)h.advance(time+=100);
 assert.ok(get().race.construction);const hoses=get().race.construction.hoses;for(let i=0;i<65&&get().race.construction;i++)h.advance(time+=100);
 assert.equal(get().race.captured,1);assert.equal(get().race.totalHoses,hoses);assert.equal(h.elements.get('construction-panel').hidden,true);assert.equal(h.elements.get('construction-progress').value,0);assert.equal(get().moving,false);
 h.advance(180000);assert.equal(get().phase,'result');assert.equal(h.elements.get('construction-panel').hidden,true);
});
test('B2 三難度真正傳模型並對齊台數與非瞬插文案',async()=>{
 for(const [difficulty,count] of [['easy',2],['normal',3],['hard',4]]){const h=await harness({autoIntro:false});h.elements.get('start-difficulty').value=difficulty;await h.click('start-game');assert.equal(h.raceInputs[0].config.difficulty,difficulty);assert.match(h.elements.get('mission-rules').textContent,new RegExp(`${count}台`));assert.match(h.html,new RegExp(`value="${difficulty}"[^>]*>[^<]*${count}台`));assert.doesNotMatch(h.html,/3m 內自動插旗/);await h.skipPrelude();h.advance(2000);const s=h.window.__game.getState().race;assert.equal(s.difficulty,difficulty);assert.equal(s.npcs.length,count);}
});
test('v3 真地格按難度保留原走廊與pin，所有車改在250～300m真道路進場',async()=>{
 const h=await harness({realData:true,autoIntro:false});
 const base=JSON.parse(await readFile(new URL('data/base.json',root),'utf8'));
 const {buildRoadGraph,shortestRoute}=await import('../race.mjs');
 for(const [difficulty,name,count] of [['hard','復興分隊',4],['normal','復興分隊',3],['easy','舊莊分隊',2],['hard','舊莊分隊',4]]){
  if(h.raceInputs.length)await h.click('settings');
  h.elements.get('start-difficulty').value=difficulty;h.elements.get('start-station').value=name;await h.click('start-game');
  const s=h.window.__game.getState(),input=h.raceInputs.at(-1);assert.equal(s.phase,'mission',`${difficulty} ${name}`);
  const site=input.sites[0],nearest=[...base.stations].sort((a,b)=>Math.hypot(a.x-site.x,a.y-site.y)-Math.hypot(b.x-site.x,b.y-site.y)).slice(0,count);
  const required=new Set(),include=(x,y,radius)=>{
   for(const key of base.cells){const [a,b]=key.split('_').map(Number);if((a+1)*base.cs>=x-radius&&a*base.cs<=x+radius&&(b+1)*base.cs>=y-radius&&b*base.cs<=y+radius)required.add(key);}
  };
  include(site.x,site.y,500);
  for(const station of nearest){const steps=Math.max(1,Math.ceil(Math.hypot(station.x-site.x,station.y-site.y)/(base.cs/2)));for(let i=0;i<=steps;i++)include(site.x+(station.x-site.x)*i/steps,site.y+(station.y-site.y)*i/steps,base.cs);}
  const missing=[...required].filter(k=>!s.loadedCells.includes(k)),unpinned=[...required].filter(k=>!h.box.testPinnedCells().includes(k));
  assert.deepEqual(missing,[],`${difficulty} ${name}: required original corridor cells missing`);
  assert.deepEqual(unpinned,[],`${difficulty} ${name}: corridors must survive LRU`);
  // Use every loaded original cell for the graph oracle: extra easy/normal
  // preload buildings can legitimately block an edge from the minimum corridor.
  const cells=await Promise.all(Array.from(s.loadedCells,async k=>JSON.parse(await readFile(new URL(`data/c/${k}.json`,root),'utf8'))));
  const graph=buildRoadGraph(cells.flatMap(c=>c.roads||[]),{buildings:cells.flatMap(c=>c.builds||[])});
  const loadedGraph=buildRoadGraph(input.roads,{buildings:input.buildings});
  const edgeKey=e=>[e.a.id,e.b.id].sort().join('|'),loadedEdges=new Set(loadedGraph.edges.map(edgeKey));
  assert.ok(graph.edges.length>0);for(const edge of graph.edges)assert.ok(loadedEdges.has(edgeKey(edge)),`original corridor edge ${edgeKey(edge)}`);
  assert.equal(s.race.status,'idle');assert.equal(s.race.remaining,180,'loading must not start round clock');
  await h.skipPrelude();h.advance(h.box.performance.now()+2000);
  const playing=h.window.__game.getState();assert.equal(playing.phase,'playing');assert.equal(playing.race.remaining,180);assert.equal(playing.race.npcs.length,count);
  for(let i=0;i<count;i++){const npc=playing.race.npcs[i],projected=shortestRoute(graph,npc,npc),d=Math.hypot(npc.x-site.x,npc.y-site.y);assert.ok(projected);assert.ok(Math.hypot(npc.x-projected.points[0].x,npc.y-projected.points[0].y)<1e-7,'on unchanged original road');assert.ok(d>=250-1e-7&&d<=300+1e-7);assert.ok(input.canStand(npc.x,npc.y));assert.equal(npc.active,false);for(const other of playing.race.npcs.slice(0,i))assert.ok(Math.hypot(npc.x-other.x,npc.y-other.y)>1); }
 }
});
test('B2 NPC目標閃紅框只標未佔目標且mini同提示',async()=>{
 const h=await harness(),create=h.box.createRace;let active=true,owner=null;
 h.box.createRace=options=>{const model=create(options);return {...model,getState:()=>{const s=model.getState();return {...s,water:s.water.map((w,i)=>({...w,owner:i===0?owner:w.owner})),npcs:[{id:'npc1',active,target:0,x:s.spawn?.x||0,y:s.spawn?.y||0,direction:{x:1,y:0}}]};}};};
 await h.click('start-game');const draw=mini=>{h.drawCalls.length=0;h.box.drawRace(h.elements.get('game').getContext('2d'),1,390,422,mini);return h.drawCalls.filter(c=>c[0]==='strokeRect');};
 assert.ok(draw(false).length>0);assert.ok(draw(true).length>0);h.box.performance.now=()=>600;assert.equal(draw(false).length,0,'紅框閃爍');h.box.performance.now=()=>0;active=false;assert.equal(draw(false).length,0);active=true;owner='player';assert.equal(draw(false).length,0);
});
test('v2 任務與教學隱藏舊intro，只有鏡頭前奏顯示且教學不承諾瞬插',async()=>{
 const h=await harness({autoIntro:false});await h.click('start-game');
 assert.equal(h.elements.get('intro').hidden,true,'任務卡不能被舊intro蓋住');
 await h.click('mission-skip');assert.equal(h.elements.get('intro').hidden,true);
 await h.click('tutorial-next');assert.match(h.elements.get('tutorial-text').textContent,/3m.*佈線.*完成.*佔領/);assert.doesNotMatch(h.elements.get('tutorial-text').textContent,/自動插旗/);
 await h.skipPrelude();assert.equal(h.elements.get('intro').hidden,false);
 h.advance(2000);assert.equal(h.elements.get('intro').hidden,true);
 assert.doesNotMatch(h.elements.get('message').textContent,/自動插旗/);
});
test('v2 復興永吉顯示周邊支援，其餘分隊隱藏支援註記',async()=>{
 for(const name of ['復興分隊','永吉分隊','莊敬分隊']){
  const h=await harness({realData:true,autoIntro:false});h.elements.get('start-station').value=name;await h.click('start-game');
  assert.equal(h.window.__game.getState().phase,'mission',name);
  const support=h.elements.get('mission-support');assert.ok(support);
  assert.equal(support.hidden,name==='莊敬分隊',name);if(!support.hidden)assert.match(support.textContent,/周邊支援/);
 }
});
test('v2 boot fetch失敗顯示可點重試入口，重試成功不重複分隊且能出勤',async()=>{
 for(const bootFailure of ['base.json','sites.json','/w/index.json']){
  const h=await harness({autoIntro:false,bootFailure}),button=h.elements.get('start-game');
  assert.equal(h.elements.get('start-screen').open,true);assert.equal(button.disabled,false);assert.match(button.textContent,/重試/);
  await h.click('start-game');assert.equal(h.elements.get('start-station').options.length,9);assert.equal(button.disabled,false);
  await h.click('start-game');assert.equal(h.window.__game.getState().phase,'mission');
 }
});
test('v2 頂端模組統一6b2快取版本',async()=>{
 const source=await readFile(new URL('game.js',root),'utf8');const imports=[...source.matchAll(/^import .*?from '([^']+)';/gm)].map(m=>m[1]);assert.equal(imports.length,5);
 assert.ok(imports.every(path=>path.endsWith('?v=6v3c')),imports.join(', '));
});
test('v2 出生失敗不拋出RAF，清前奏並提供真正可用重試',async()=>{
 const h=await harness({autoIntro:false}),create=h.box.createRace;let fail=true;
 h.box.createRace=options=>{const race=create(options);return fail?{...race,start:()=>{throw Error('沒有安全出生點');}}:race;};
 await h.click('start-game');await h.skipPrelude();assert.doesNotThrow(()=>h.advance(2000));
 assert.equal(h.window.__game.getState().phase,'select');assert.equal(h.window.__game.getState().ready,false);
 assert.equal(h.elements.get('intro').hidden,true);assert.equal(h.elements.get('start-screen').open,true);
 assert.equal(h.elements.get('start-game').disabled,false);assert.match(h.elements.get('start-status').textContent,/出生.*重試/);assert.equal(h.frames.length,1);
 fail=false;await h.click('start-game');await h.skipPrelude();h.advance(4000);assert.equal(h.window.__game.getState().phase,'playing');
});
test('v2 無候選不抽假題，水源fetch失敗可原地重試而不留下卡死loading',async()=>{
 const empty=await harness({autoIntro:false});empty.elements.get('start-station').value='信義分隊';await empty.click('start-game');
 assert.equal(empty.window.__game.getState().phase,'select');assert.match(empty.elements.get('start-status').textContent,/沒有.*場所/);assert.equal(empty.raceInputs.length,0);
 const h=await harness({autoIntro:false}),fetch=h.box.fetch;h.box.fetch=async url=>url.includes('/w/')?{ok:false}:fetch(url);
 await h.click('start-game');assert.equal(h.window.__game.getState().phase,'select');assert.match(h.elements.get('start-status').textContent,/消防栓.*重試/);assert.equal(h.elements.get('start-game').disabled,false);
 h.box.fetch=fetch;await h.click('start-game');assert.equal(h.window.__game.getState().phase,'mission');
});
test('v2 每題限定所屬分隊，以建物火場中心載入附近水格並只交付最近300m15目標',async()=>{
 const h=await harness({realData:true,autoIntro:false});await h.click('start-game');const s=h.window.__game.getState(),input=h.raceInputs[0];
 assert.equal(input.sites.length,1);assert.equal(input.sites[0].st,s.station);assert.equal(input.config.targetRadius,300);
 const mission=await import('../missions.mjs');const wanted=mission.waterCellKeys(input.sites[0],JSON.parse(await readFile(new URL('data/w/index.json',root))),500,300);
 assert.deepEqual(h.calls.filter(c=>c.includes('/w/')&&!c.endsWith('index.json')).sort(),wanted.map(k=>`./data/w/${k}.json`).sort());
 const raw=JSON.parse(await readFile(new URL('data/sites.json',root))).find(a=>a.n===input.sites[0].n&&a.addr===input.sites[0].addr);
 const resolved=mission.resolveFireSite(raw,input.buildings);assert.equal(input.sites[0].x,resolved.x);assert.equal(input.sites[0].y,resolved.y);
 const rows=await Promise.all(wanted.map(async key=>({key,rows:JSON.parse(await readFile(new URL(`data/w/${key}.json`,root)))})));
 const expected=mission.selectObjectives(mission.decodeWaterCells(rows,input.roads),resolved,300,15);
 assert.deepEqual(Array.from(input.water,w=>[w.x,w.y,w.k,w.n]),expected.map(w=>[w.x,w.y,w.k,w.n]));assert.ok(input.water.length>0&&input.water.length<=15);
 assert.ok(input.water.every(w=>Math.hypot(w.x-resolved.x,w.y-resolved.y)<=300));
 await h.skipPrelude();h.advance(2000);assert.equal(h.window.__game.getState().race.site.x,resolved.x);
});
test('v2 遠分隊重選先釋放舊pins，復興兩題再舊莊仍以新建物解析火場',async()=>{
 const h=await harness({realData:true,autoIntro:false}),{resolveFireSite}=await import('../missions.mjs');
 for(const name of ['復興分隊','復興分隊','舊莊分隊']){
  if(h.raceInputs.length)await h.click('settings');h.elements.get('start-station').value=name;await h.click('start-game');
  assert.equal(h.window.__game.getState().phase,'mission',name);
  const input=h.raceInputs.at(-1),raw=JSON.parse(await readFile(new URL('data/sites.json',root))).find(s=>s.n===input.sites[0].n&&s.addr===input.sites[0].addr);
  const expected=resolveFireSite(raw,input.buildings);assert.equal(input.sites[0].x,expected.x,name+' center x');assert.equal(input.sites[0].y,expected.y,name+' center y');
 }
});
test('v2 火場整棟polygon泛紅且像素焰黑煙隨時間動畫，mini閃火',async()=>{
 const h=await harness({wall:true});await h.click('start-game');
 const c=h.elements.get('game').getContext('2d'),draw=mini=>{h.drawCalls.length=0;h.box.drawRace(c,1,390,422,mini);return structuredClone(h.drawCalls);};
 const a=draw(false),p=h.raceInputs[0].sites[0].building.p,s=h.window.__game.getState();
 assert.ok(a.some(v=>v[0]==='moveTo'&&v[1]===195+p[0]-s.x&&v[2]===211-p[1]+s.y),'entire resolved footprint');
 for(const color of ['#ed443580','#ff6b21','#252525cc'])assert.ok(a.some(v=>v[0]==='set'&&v[1]==='fillStyle'&&v[2]===color),color);
 h.box.performance.now=()=>2350;const b=draw(false);assert.notDeepEqual(a.filter(v=>v[0]==='fillRect'),b.filter(v=>v[0]==='fillRect'));
 const m=draw(true);h.box.performance.now=()=>2700;assert.notDeepEqual(m,draw(true),'mini fire flashes');
});
test('v2 無建物仍有像素火場，畫外箭頭留在螢幕內且距離用火場中心',async()=>{
 const h=await harness();await h.click('start-game');const c=h.elements.get('game').getContext('2d');
 assert.equal(h.raceInputs[0].sites[0].building,null);h.drawCalls.length=0;h.box.drawRace(c,10,390,422);
 assert.ok(h.drawCalls.some(v=>v[0]==='fillText'&&v[1]==='火場 30 m'));
 const arrow=h.drawCalls.find(v=>v[0]==='rotate');assert.ok(arrow,'offscreen bearing arrow');
 const at=h.drawCalls.slice(0,h.drawCalls.indexOf(arrow)).findLast(v=>v[0]==='translate');assert.ok(at[1]>=12&&at[1]<=378&&at[2]>=12&&at[2]<=410);
 h.drawCalls.length=0;h.box.drawRace(c,1,390,422);assert.ok(h.drawCalls.some(v=>v[0]==='set'&&v[2]==='#ff6b21'));
});
test('v2 消防栓兩類圖示、目標閃黃旗幟、近處發光及遠處隱藏文字',async()=>{
 const h=await harness(),c=h.elements.get('game').getContext('2d');
 for(const [k,icon]of [['hydrant_above','栓'],['hydrant_under','▣']]){
  h.drawCalls.length=0;h.box.waterMark(c,{k,n:'同名水源',owner:null},0,0);
  assert.ok(h.drawCalls.some(v=>v[0]==='fillText'&&v[1]===icon),k);
  assert.ok(h.drawCalls.some(v=>v[0]==='set'&&v[1]==='shadowBlur'&&v[2]>0));
 }
 const draw=(owner,target=true,near=true)=>{h.drawCalls.length=0;h.box.waterMark(c,{k:'hydrant_under',n:'同名水源',owner},0,0,1,false,null,target,near);return structuredClone(h.drawCalls);};
 const a=draw(null);h.box.performance.now=()=>600;const b=draw(null);assert.notDeepEqual(a,b,'unowned target flashes yellow');
 for(const [owner,flag]of [['player','犀'],['npc1','車']])assert.ok(draw(owner).some(v=>v[0]==='fillText'&&v[1]===flag));
 assert.ok(draw(null,false).some(v=>v[0]==='set'&&v[1]==='globalAlpha'&&v[2]===.25));
 assert.ok(!draw(null,true,false).some(v=>v[0]==='fillText'&&v[1]==='同名水源'));
});
test('v2 非目標淡畫以穩定cell-row sourceId對照，重名重座標也不捕獲或入分母',async()=>{
 const h=await harness(),fetch=h.box.fetch,home=JSON.parse(await readFile(new URL('data/base.json',root))).stations.find(s=>s.name==='莊敬分隊');
 h.box.fetch=async url=>url.includes('/w/')&&!url.endsWith('index.json')?{ok:true,json:async()=>[...Array.from({length:21},()=>[home.x,home.y,'hydrant_above']),[home.x+400,home.y,'hydrant_under']]}:fetch(url);
 await h.click('start-game');const s=h.window.__game.getState(),input=h.raceInputs[0];
 assert.equal(s.race.total,15);assert.equal(s.race.captured,0,'進3m開始施工，不再瞬間佔20點');assert.ok(s.race.construction);assert.equal(s.race.water.length,15);
 assert.ok(input.water.every(w=>w.sourceId===w.id&&typeof w.id==='string'),'preserve cell-row identity before numeric race id overwrite');
 assert.equal(new Set(s.race.water.map(w=>w.sourceId)).size,15);assert.ok(s.race.water.every(w=>typeof w.id==='number'));
 const marks=[],mark=h.box.waterMark;h.box.waterMark=(...args)=>{marks.push(args);return mark(...args);};h.window.__game.renderScene();
 const non=marks.filter(a=>a[7]===false);assert.equal(non.length,6,'rows 16 through 21 stay non-target; out-of-view point is culled');assert.ok(non[0][1].id.endsWith(':15'));
 assert.equal(non[0][1].owner,undefined);
});
test('v2 boot只載base sites與水源索引，不載全域水源',async()=>{
 const h=await harness();assert.deepEqual(h.calls.filter(c=>c.startsWith('./data/')).sort(),['./data/base.json','./data/mission-pool.json','./data/sites.json','./data/w/index.json']);
});
test('v3 模型只接受地上與地下消防栓',()=>{
 for(const k of ['hydrant_above','hydrant_under','hydrant_under','hydrant_under','hydrant_under','hydrant_under','hydrant_under']){
  const r=createRaceForKinds({sites:[{n:'場所',addr:'地址',x:0,y:0}],water:[{n:'水源',x:1,y:0,k}]});assert.equal(r.start(0).water[0].k,k);
 }
});
test('v2 重選中止前奏並清除卡片，再次出勤記住教學，storage拒絕仍可玩',async()=>{
 const h=await harness({autoIntro:false});await h.click('start-game');await h.click('settings');
 assert.equal(h.elements.get('mission-card').hidden,true);assert.equal(h.elements.get('tutorial-card').hidden,true);
 await h.click('start-game');await h.skipPrelude();h.advance(2000);await h.click('settings');await h.click('start-game');await h.click('mission-skip');
 assert.equal(h.window.__game.getState().phase,'intro');
 const denied=await harness({autoIntro:false});denied.box.localStorage.getItem=()=>{throw Error('denied');};denied.box.localStorage.setItem=()=>{throw Error('denied');};
 await denied.click('start-game');await denied.skipPrelude();denied.advance(2000);assert.equal(denied.window.__game.getState().phase,'playing');
});
test('v2 出勤卡三秒與首次三步教學結束之前不啟動計時且鎖輸入',async()=>{
 const h=await harness({autoIntro:false}),get=()=>h.window.__game.getState();await h.click('start-game');
 assert.equal(get().phase,'mission');assert.match(h.elements.get('mission-detail').textContent,/測試場所.*測試路1號/);
 assert.match(h.elements.get('mission-rules').textContent,/3分鐘.*10秒/);
 h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});const x=get().x;
 h.advance(2999);assert.equal(get().phase,'mission');assert.equal(get().x,x);assert.equal(get().race.status,'idle');
 h.advance(3000);assert.equal(get().phase,'tutorial');
 for(let i=0;i<3;i++){assert.equal(get().tutorialStep,i);await h.click('tutorial-next');}
 assert.equal(h.storage.get('rhino-tutorial-v2'),'done');assert.equal(get().phase,'intro');
 h.advance(4999);assert.equal(get().phase,'intro');assert.equal(get().race.status,'idle');
 h.advance(5000);assert.equal(get().phase,'playing');assert.equal(get().race.remaining,180);assert.ok(get().race.npcs.every(n=>!n.active));
});
test('v2 難度預設普通且保存選角分隊選擇',async()=>{
  const h=await harness();assert.equal(h.window.__game.getState().difficulty,'normal');
  h.elements.get('start-difficulty').value='hard';await h.click('start-game');
  assert.equal(h.window.__game.getState().difficulty,'hard');
});
test('本機五倍速流程仍有真兩秒intro，30秒轉緊張、36秒結算；公開query維持180秒',async()=>{
  for(const [url,rate] of [['http://localhost:8000/?test=1',5],['https://preview.example/?test=1',1],['http://localhost:8000/',1]]){
    const h=await harness({location:new URL(url),autoIntro:false}),get=()=>h.window.__game.getState();
    const nativeNow=h.box.performance.now;
    await h.click('start-game');assert.equal(get().testRate,rate);await h.skipPrelude();
    h.advance(1999);assert.equal(get().phase,'intro');
    h.advance(2000);assert.equal(get().phase,'playing');assert.equal(get().race.remaining,180);
    h.advance(2000+149000/rate);assert.equal(get().race.remaining,31);assert.ok(!h.calls.includes('state:tense'));
    h.advance(2000+150000/rate);assert.equal(get().race.remaining,30);assert.ok(h.calls.includes('state:tense'));
    h.advance(2000+179000/rate);assert.equal(get().phase,'playing');
    h.advance(2000+180000/rate);assert.equal(get().phase,'result');assert.equal(get().race.remaining,0);
    assert.equal(h.box.performance.now,nativeNow,'不覆寫全域時鐘');
    assert.equal(h.box.performance.now(),2000+180000/rate,'牆鐘始終保持原始毫秒');
    assert.deepEqual(Object.keys(h.window.__game).sort(),['getState','renderScene']);
  }
});
test('本機快轉NPC沿真實幾何與正常模型逐階一致，10秒出動、搶水源直到結果（桌機手機）',async()=>{
  for(const viewport of [[1280,800],[390,844]]){
    const normal=await harness({realData:true,viewport,autoIntro:false});
    const fast=await harness({realData:true,viewport,autoIntro:false,location:new URL('http://127.0.0.1/?test=1')});
    for(const h of [normal,fast]){await h.click('start-game');await h.skipPrelude();h.advance(2000);}
    for(const seconds of [9,10,11,40,80,120,160,179,180]){
      normal.advance(2000+seconds*1000);fast.advance(2000+seconds*1000/5);
      const a=normal.window.__game.getState(),b=fast.window.__game.getState();
      assert.deepEqual(b.race,a.race,`${viewport}: ${seconds} model seconds`);
      assert.equal(b.phase,a.phase);
      if(seconds===9)assert.ok(b.race.npcs.every(n=>!n.active));
      if(seconds===10)assert.ok(b.race.npcs.every(n=>n.active));
      if(seconds===179)assert.ok(b.race.water.some(w=>w.owner?.startsWith('npc')),'真模型NPC確實佔領');
      normal.drawCalls.length=fast.drawCalls.length=0;
    }
    assert.deepEqual(fast.calls.filter(c=>/^(state|cue|play):/.test(c)),normal.calls.filter(c=>/^(state|cue|play):/.test(c)),'音樂僅依相同模型狀態切換，不額外改速');
  }
});
test('本機快轉只乘玩家speed，保留原始dt、250ms卡頓丟棄與15cm碰撞細步',async()=>{
  for(const wall of [false,true]){
    const h=await harness({wall,autoIntro:false,location:new URL('http://[::1]:8000/?test=1')}),get=()=>h.window.__game.getState();
    const moves=[];h.box.stepMove=(position,dx,dy,dt,speed,canWalk)=>{
      moves.push({dt,speed});let last=position;
      return core.stepMove(position,dx,dy,dt,speed,(x,y)=>{
        assert.ok(Math.hypot(x-last.x,y-last.y)<=.15+1e-9,'碰撞採樣不得超過15cm');
        const allowed=canWalk(x,y);if(allowed)last={x,y};return allowed;
      });
    };
    await h.click('start-game');await h.skipPrelude();h.advance(2000);h.advance(3000);const start=get().x;
    h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});
    h.advance(3100);assert.deepEqual(moves.at(-1),{dt:.1,speed:25});
    if(wall)assert.ok(get().x>start&&get().x<=start+.18,'圓形占地停在細牆前');
    else assert.ok(Math.abs(get().x-start-2.5)<1e-8,'10FPS原始dt不因快轉超過卡頓門檻');
    h.events.keydown({target:{closest:()=>null},key:'Shift',preventDefault(){}});
    h.advance(3200);assert.deepEqual(moves.at(-1),{dt:.1,speed:50});
    if(wall)assert.ok(get().x<=start+.18);else assert.ok(Math.abs(get().x-start-7.5)<1e-8);
    const x=get().x;h.advance(4000);assert.equal(get().x,x,'原始800ms卡頓不得追趕');assert.equal(get().race.remaining,170);
    assert.equal(get().walkSpeed,5);assert.equal(get().runSpeed,10);assert.equal(get().collisionRadius,.32);
  }
});
test('只有本機啟用時持續明示本機測試×5，提示逾時仍保留，公開與footer不受污染',async()=>{
  for(const [url,enabled] of [['http://localhost/?test=1',true],['https://public.example/?test=1',false],['http://localhost/',false]]){
    const h=await harness({autoIntro:false,location:new URL(url)}),text=()=>h.elements.get('message').textContent;
    assert.equal(text().includes('本機測試 ×5'),enabled);
    await h.click('start-game');assert.equal(text().includes('本機測試 ×5'),enabled);await h.skipPrelude();
    h.advance(2000);assert.equal(text().includes('本機測試 ×5'),enabled);
    h.timers.at(-1)();assert.equal(text(),enabled?'本機測試 ×5':'');
    h.advance(enabled?38000:182000);assert.equal(text().includes('本機測試 ×5'),enabled);
    assert.equal(h.html.match(/<footer>(.*?)<\/footer>/s)[1].replace(/<[^>]+>/g,''),'僅供遊戲，非搶救圖資・© OpenStreetMap© 2026 Leif Huang. All rights reserved.');
  }
});
test('出勤卡與教學後顯示兩秒地址鏡頭，之後才開始完整三分鐘真時間',async()=>{
  const h=await harness({autoIntro:false});await h.click('start-game');const get=()=>h.window.__game.getState();
  await h.skipPrelude();
  assert.equal(get().phase,'intro');assert.match(h.elements.get('intro-address').textContent,/測試路1號/);
  h.advance(1999);assert.equal(get().phase,'intro');
  h.advance(2000);assert.equal(get().phase,'playing');assert.equal(get().race.remaining,180);
  await h.click('overview-open');h.advance(122000);assert.equal(Math.ceil(get().race.remaining),60);
  h.advance(182000);assert.equal(get().phase,'result');assert.equal(h.elements.get('result-dialog').open,true);
  assert.equal(get().moving,false);assert.ok(h.elements.get('result-list').textContent.includes('測試路口地上消防栓'));
});

test('開場與地圖dialog限制視窗高度且可捲動，手機橫式不強迫500px',async()=>{
  const css=await readFile(new URL('style.css',root),'utf8');
  assert.match(css,/dialog\s*\{[^}]*max-height:[^;]*dvh/);assert.match(css,/dialog\s*\{[^}]*overflow-y:auto/);
  assert.match(css,/@media\s*\(max-height:450px\)/);assert.match(css,/#app\{min-height:0/);
});
test('開始按鈕同步啟動探索音樂先於地格載入，只留靜音工具不吞焦點',async()=>{
  const h=await harness();assert.ok(!h.elements.has('music-track'));assert.ok(h.elements.has('music-toggle'));
  const promise=h.click('start-game');assert.ok(h.calls.includes('play:explore'));await promise;
  assert.ok(h.calls.indexOf('play:explore')<h.calls.findIndex(s=>s.includes('/c/')));
  assert.ok(h.window.__game.getState().music);
  await h.click('music-settings');await h.click('music-toggle');assert.equal(h.elements.get('music-toggle'),h.box.document.activeElement);assert.equal(h.window.__game.getState().music.muted,true);
  await h.click('music-toggle');assert.equal(h.window.__game.getState().music.muted,false);
  await h.click('music-settings-close');assert.equal(h.elements.get('game'),h.box.document.activeElement);
});
test('音樂拒絕不阻擋開始，顯示可重試降級訊息',async()=>{
  const h=await harness({rejectMusic:true});await h.click('start-game');assert.equal(h.window.__game.getState().ready,true);assert.equal(h.elements.get('music-status').textContent,'音樂尚未開啟，點音樂重試');
});
test('背景恢復錯誤由音樂唯讀狀態回報時同樣顯示重試',async()=>{
  const h=await harness({musicStateError:true});await h.click('start-game');h.window.__game.renderScene();
  assert.equal(h.elements.get('music-toggle').textContent,'音樂重試');assert.match(h.elements.get('music-status').textContent,/重試/);
});
test('真音樂模型結算自然結束或尚未播放時只切靜音，不誤標重試或重播',async()=>{
  const sources=[],param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},cancelScheduledValues(){}}),node=()=>({connect(){},disconnect(){}});
  // Only the unavailable Web Audio device is substituted; use the real music state machine and WAV bytes.
  const ctx={currentTime:0,state:'running',destination:{},resume:async()=>{},
    createGain:()=>({...node(),gain:param()}),createAnalyser:()=>({...node(),getFloatTimeDomainData:a=>a.fill(0)}),
    decodeAudioData:async bytes=>{assert.equal(new DataView(bytes).getUint32(0),0x52494646);return {duration:16};},
    createBufferSource:()=>{const s={...node(),playbackRate:param(),start(){},stop(){}};sources.push(s);return s;},
    createOscillator:()=>({...node(),frequency:param(),start(){},stop(){}})};
  const wavs=new Map(await Promise.all(['explore','result'].map(async name=>{const url=new URL(`assets/music/${name}.wav`,root);return [String(url),await readFile(url)];})));
  const player=createMusicPlayer({audioContextFactory:()=>ctx,document:new EventTarget(),storage:{getItem:()=>null,setItem(){}},fetch:async url=>({ok:true,arrayBuffer:async()=>{const bytes=wavs.get(String(url));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}})});
  const h=await harness({musicPlayer:player});h.window.__game.renderScene();
  assert.equal(h.elements.get('music-toggle').textContent,'靜音');
  await h.click('start-game');h.advance(182000);await h.settle();
  assert.equal(player.getState().state,'result');assert.equal(sources.at(-1).loop,false);
  sources.at(-1).onended();h.window.__game.renderScene();
  assert.equal(player.getState().playing,false);assert.equal(player.getState().error,null);
  assert.equal(h.elements.get('music-toggle').textContent,'靜音');
  const count=sources.length;await h.click('music-toggle');assert.equal(player.getState().muted,true);assert.equal(sources.length,count);
  await h.click('music-toggle');assert.equal(player.getState().muted,false);assert.equal(sources.length,count);
});
test('真實1m/unit與.32m碰撞不變，走5跑10且實際位移正確',async()=>{
  const h=await harness();await h.click('start-game');const get=()=>h.window.__game.getState();
  assert.equal(get().walkSpeed,5);assert.equal(get().runSpeed,10);
  assert.equal(get().viewWidthMeters,175);
  assert.equal(get().metersPerUnit,1);assert.equal(get().collisionRadius,.32);
  const start=get().x;h.frames.shift()(1000);
  h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});
  h.frames.shift()(1050);assert.ok(Math.abs(get().x-start-.25)<1e-8);
  h.events.keydown({target:{closest:()=>null},key:'Shift',preventDefault(){}});
  h.frames.shift()(1100);assert.ok(Math.abs(get().x-start-.75)<1e-8);
  h.events.keyup({key:'d'});h.frames.shift()(1150);assert.equal(get().moving,false);
  assert.match(h.source,/walkingTime\+=distance/);
});
test('遊戲迴圈十秒走50m跑100m，60/20/10FPS與半推均一致',async()=>{
  for(const fps of [60,20,10])for(const running of [false,true])for(const half of [false,true]){
    const h=await harness({movementOnly:true});await h.click('start-game');const get=()=>h.window.__game.getState();
    const stick=h.elements.get('joystick');stick.getBoundingClientRect=()=>({left:40,top:200,width:128,height:128});
    stick.listeners.pointerdown({pointerId:1,clientX:half?126:148,clientY:264,preventDefault(){}});
    if(running)h.elements.get('run').listeners.pointerdown({pointerId:2,preventDefault(){}});
    const start=get().x;h.frames.shift()(1000);
    for(let i=1;i<=fps*10;i++)h.frames.shift()(1000+i*1000/fps);
    assert.ok(Math.abs(get().x-start-(running?100:50)*(half?.5:1))<1e-8,`${fps} FPS running=${running} half=${half}`);
  }
});

test('手機左搖桿保留半推走速、deadzone、圓形clamp且放開即停',async()=>{
  const h=await harness();await h.click('start-game');
  assert.ok(h.elements.has('joystick'));assert.ok(h.elements.has('stick-knob'));
  const stick=h.elements.get('joystick'),get=()=>h.window.__game.getState();
  stick.getBoundingClientRect=()=>({left:40,top:200,width:128,height:128});
  const send=(type,id,x,y)=>stick.listeners[type]?.({pointerId:id,clientX:x,clientY:y,preventDefault(){}});
  h.frames.shift()(1000);const start=get().x;
  send('pointerdown',7,126,264); // 22 / 44 = .5
  assert.equal(get().joystick.active,true);assert.equal(get().joystick.x,.5);
  h.frames.shift()(1100);assert.ok(Math.abs(get().x-start-.25)<1e-8);
  send('pointermove',8,60,264);assert.equal(get().joystick.x,.5); // foreign pointer
  send('pointermove',7,106,264);h.frames.shift()(1200);assert.equal(get().moving,false);
  send('pointermove',7,200,160);assert.ok(Math.abs(Math.hypot(get().joystick.x,get().joystick.y)-1)<1e-9);
  assert.equal(get().runHeld,false);
  send('pointerup',7,200,160);h.frames.shift()(1300);assert.equal(get().moving,false);
  assert.equal(get().joystick.active,false);
  const snapshot=get();snapshot.joystick.x=99;assert.equal(get().joystick.x,0);
});

test('兩指任意順序按住跑，跑單按不動、放跑恢復走、放左即停',async()=>{
  for(const runFirst of [true,false]){
    const h=await harness();await h.click('start-game');const get=()=>h.window.__game.getState();
    const stick=h.elements.get('joystick');stick.getBoundingClientRect=()=>({left:40,top:200,width:128,height:128});
    const send=(id,type,pointerId,clientX=148,clientY=264)=>h.elements.get(id).listeners[type]?.({pointerId,clientX,clientY,preventDefault(){}});
    h.frames.shift()(1000);const start=get().x;
    if(runFirst){send('run','pointerdown',2);h.frames.shift()(1100);assert.equal(get().x,start);assert.equal(get().movementSpeed,0);}
    send('joystick','pointerdown',1);
    if(!runFirst)send('run','pointerdown',2);
    assert.equal(get().runHeld,true);
    h.frames.shift()(1200);assert.ok(Math.abs(get().x-start-(runFirst?1:2))<1e-8);assert.ok(Math.abs(get().movementSpeed-10)<1e-8);
    send('run','pointerup',99);assert.equal(get().runHeld,true);
    send('run','pointerup',2);h.frames.shift()(1300);assert.ok(Math.abs(get().movementSpeed-5)<1e-8);assert.equal(get().runHeld,false);
    send('run','pointerdown',3);send('joystick','pointerup',1);h.frames.shift()(1400);assert.equal(get().moving,false);assert.equal(get().movementSpeed,0);
    send('run','pointerup',3);h.frames.shift()(1500);assert.equal(get().runHeld,false);
  }
});

test('cancel/lostcapture/blur/visibility/resize/modal 清除兩指且選單內不能偷跑',async()=>{
  for(const trigger of ['pointercancel','lostpointercapture','blur','visibilitychange','resize','overview-open','settings','music-settings','music-toggle']){
    const h=await harness({movementOnly:true});await h.click('start-game');const get=()=>h.window.__game.getState();
    const stick=h.elements.get('joystick');stick.getBoundingClientRect=()=>({left:40,top:200,width:128,height:128});
    const send=(id,type,pointerId)=>h.elements.get(id).listeners[type]?.({pointerId,clientX:148,clientY:264,preventDefault(){}});
    send('joystick','pointerdown',1);send('run','pointerdown',2);
    h.frames.shift()(1000);h.frames.shift()(1100);assert.equal(get().moving,true);
    if(trigger==='pointercancel'||trigger==='lostpointercapture')send('joystick',trigger,1);
    else if(['overview-open','settings','music-settings'].includes(trigger))await h.click(trigger);
    else if(trigger==='music-toggle')await h.click('music-toggle');
    else h.events[trigger]?.();
    assert.equal(get().runHeld,false,trigger);assert.equal(get().joystick.active,false,trigger);assert.equal(get().movementSpeed,0,trigger);
    const x=get().x;h.frames.shift()(1200);assert.equal(get().x,x,trigger);
    if(['overview-open','settings','music-settings'].includes(trigger)){
      send('joystick','pointerdown',3);send('run','pointerdown',4);
      assert.equal(get().runHeld,false);assert.equal(get().joystick.active,false);
      if(trigger==='overview-open'){await h.click('overview-close');h.frames.shift()(1300);assert.equal(get().x,x);}
    }
  }
});

test('遊戲使用共享.32m圓形碰撞占地及同尺度陰影，細牆前可走但不穿過',async()=>{
  const h=await harness({wall:true});await h.click('start-game');const get=()=>h.window.__game.getState();
  h.frames.shift()(1000);const start=get().x;
  h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});
  h.frames.shift()(1100);assert.ok(get().x>start,'.14m safe step is allowed');
  for(let i=2;i<=20;i++)h.frames.shift()(1000+100*i);
  assert.ok(get().x<=start+.18,'disk stops before thin wall');
  assert.ok(h.drawCalls.some(c=>c[0]==='ellipse'&&Math.abs(c[3]-get().zoom*.32)<1e-10&&Math.abs(c[4]-get().zoom*.32/2)<1e-10));
});

test('五手機尺寸與電腦保持175m橫寬，縮放限制100~250m，resize保留視寬且比例尺正確',async()=>{
  for(const viewport of [[320,568],[375,667],[390,844],[844,390],[667,375],[1280,800]]){
    const h=await harness({viewport});await h.click('start-game');const get=()=>h.window.__game.getState();
    const width=h.elements.get('game').width;
    assert.equal(get().viewWidthMeters,175);assert.ok(Math.abs(width/get().zoom-175)<1e-9);
    h.frames.shift()(1000);
    const rulerMetres=parseFloat(h.elements.get('scale-label').textContent),rulerPixels=parseFloat(h.elements.get('scale-line').style.slice(6));
    assert.ok(Math.abs(rulerPixels-rulerMetres*viewport[0]/175)<1e-9);
    assert.ok(rulerPixels>=40&&rulerPixels<=100);
    await h.click('zoom-in');assert.equal(get().viewWidthMeters,150);
    for(let i=0;i<20;i++)await h.click('zoom-in');assert.equal(get().viewWidthMeters,100);
    await h.click('zoom-out');assert.equal(get().viewWidthMeters,125);
    for(let i=0;i<20;i++)await h.click('zoom-out');assert.equal(get().viewWidthMeters,250);
    h.elements.get('game').getBoundingClientRect=()=>({width:1001,height:500});h.events.resize();
    assert.equal(get().viewWidthMeters,250);assert.equal(get().zoom,h.elements.get('game').width/250);
  }
});

test('角色固定CSS高度且腳底世界定位，不受縮放影響',async()=>{
  for(const viewport of [[320,568],[375,667],[390,844],[844,390],[667,375],[1280,800]]){
    const h=await harness({viewport});await h.click('start-game');const expected=viewport[0]===1280?64:56;
    for(const button of [null,'zoom-in','zoom-out']){
      if(button)await h.click(button);h.drawCalls.length=0;h.window.__game.renderScene();
      const draw=h.drawCalls.find(c=>c[0]==='drawImage');assert.ok(draw);
      const cssPerPixel=viewport[0]/h.elements.get('game').width;
      assert.equal(h.window.__game.getState().spriteCssHeight,expected);
      assert.ok(Math.abs(draw[9]*cssPerPixel-expected)<1e-9);
      assert.ok(Math.abs(draw[7]+76*draw[9]/80-h.elements.get('game').height/2)<=.5);
    }
  }
});

test('轄區地圖清除兩指與鍵盤，地圖期間禁止移動但倒數持續，關閉可重新操作',async()=>{
  const h=await harness();await h.click('start-game');const get=()=>h.window.__game.getState();
  h.frames.shift()(1000);h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});h.frames.shift()(1100);
  await h.click('overview-open');assert.equal(h.elements.get('overview-dialog')?.open,true);const remaining=get().race.remaining;
  const x=get().x;const stick=h.elements.get('joystick');stick.getBoundingClientRect=()=>({left:40,top:200,width:128,height:128});
  stick.listeners.pointerdown({pointerId:1,clientX:148,clientY:264,preventDefault(){}});
  h.elements.get('run').listeners.pointerdown({pointerId:2,preventDefault(){}});
  h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});h.frames.shift()(1200);
  assert.equal(get().x,x);assert.equal(get().runHeld,false);assert.equal(get().joystick.active,false);
  assert.ok(get().race.remaining<remaining);
  await h.click('overview-close');assert.equal(h.elements.get('overview-dialog').open,false);
  h.frames.shift()(1300);assert.equal(get().x,x);
  h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});h.frames.shift()(1400);assert.ok(get().x>x);
});

test('音樂設定清除雙指與鍵盤、阻擋移動但倒數及NPC持續，關閉不殘留',async()=>{
  for(const closeBy of ['button','escape']){
    const h=await harness();await h.click('start-game');const get=()=>h.window.__game.getState();
    const stick=h.elements.get('joystick');stick.getBoundingClientRect=()=>({left:40,top:200,width:128,height:128});
    const send=(id,pointerId)=>h.elements.get(id).listeners.pointerdown({pointerId,clientX:148,clientY:264,preventDefault(){}});
    h.advance(3000);h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});send('joystick',1);send('run',2);h.advance(3100);
    assert.equal(get().moving,true);await h.click('music-settings');assert.equal(h.elements.get('music-settings-dialog').open,true);
    assert.equal(get().runHeld,false);assert.equal(get().joystick.active,false);assert.equal(get().movementSpeed,0);
    const x=get().x,remaining=get().race.remaining;
    send('joystick',3);send('run',4);h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});
    h.advance(25000);assert.equal(get().x,x);assert.ok(get().race.remaining<remaining);assert.ok(get().race.npcs.some(n=>n.active));
    await h.click('music-toggle');assert.equal(h.elements.get('music-settings-dialog').open,true);assert.notEqual(h.box.document.activeElement,h.elements.get('game'));
    if(closeBy==='button')await h.click('music-settings-close');
    else {h.elements.get('music-settings-dialog').close();h.elements.get('music-settings-dialog').listeners.close?.();}
    assert.equal(h.elements.get('music-settings-dialog').open,false);h.advance(25100);assert.equal(get().x,x);
    assert.equal(get().runHeld,false);assert.equal(get().joystick.active,false);
    h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});h.advance(25200);assert.ok(get().x>x);
  }
});
test('設定不疊其他modal，到期先關設定再結算且再一題可繼續',async()=>{
  const h=await harness({realData:true});await h.click('music-settings');assert.equal(h.elements.get('music-settings-dialog').open,false);
  await h.click('start-game');await h.click('overview-open');await h.click('music-settings');assert.equal(h.elements.get('music-settings-dialog').open,false);
  await h.click('overview-close');await h.click('music-settings');assert.equal(h.elements.get('music-settings-dialog').open,true);
  const result=h.elements.get('result-dialog'),show=result.showModal;result.showModal=function(){assert.equal(h.elements.get('music-settings-dialog').open,false,'先關設定');show.call(this);};
  h.advance(182000);assert.equal(h.window.__game.getState().phase,'result');assert.equal(result.open,true);
  await h.click('music-settings');assert.equal(h.elements.get('music-settings-dialog').open,false);
  await h.click('next-round');assert.equal(h.window.__game.getState().phase,'mission');await h.skipPrelude();h.advance(304000);assert.equal(h.window.__game.getState().phase,'playing');
});

test('頂部只有設定入口，音樂靜音收進設定且無曲目選單或回家瞬移，footer與README精簡',async()=>{
  const h=await harness(),header=h.html.match(/<header[^>]*>(.*?)<\/header>/s)[1];
  assert.equal((header.match(/<button/g)||[]).length,1);assert.match(header,/id="music-settings"[^>]*>設定<\/button>/);assert.doesNotMatch(header,/music-toggle|music-track/);
  const settings=h.html.match(/<dialog id="music-settings-dialog"[^>]*>(.*?)<\/dialog>/s)?.[1];
  assert.ok(settings,'音樂與縮放在獨立設定內');assert.equal((settings.match(/<button/g)||[]).length,4);assert.match(settings,/id="zoom-in"/);assert.match(settings,/id="zoom-out"/);
  assert.match(settings,/id="music-toggle"/);assert.match(settings,/id="music-settings-close"/);
  assert.doesNotMatch(h.html,/id="(?:music-track|home)"/);
  const footer=h.html.match(/<footer>(.*?)<\/footer>/s)[1].replace(/<[^>]+>/g,'');
  assert.equal(footer,'僅供遊戲，非搶救圖資・© OpenStreetMap© 2026 Leif Huang. All rights reserved.');
  const readme=await readFile(new URL('README.md',root),'utf8');assert.doesNotMatch(readme,/m\/s|1\.8|身高|非實測|實地測量|部署/);
  const css=await readFile(new URL('style.css',root),'utf8');assert.match(css,/\.topbar\{[^}]*height:52px/);assert.match(css,/h1\{[^}]*white-space:nowrap/);
});

test('頁面與開場統一犀牛搶水源',async()=>{
  const h=await harness();assert.match(h.html,/<title>犀牛搶水源/);assert.match(h.html,/<h1>犀牛搶水源/);assert.match(h.html,/id="start-title">犀牛搶水源/);assert.doesNotMatch(h.html,/犀牛出任務/);
});
test('首次僅選角，素材完成不自動出生，開始後才可玩並能重新選擇',async()=>{
  const h=await harness(),get=()=>h.window.__game.getState();
  assert.equal(get().phase,'select');assert.equal(get().ready,false);
  assert.equal(h.calls.filter(s=>s.includes('/c/')).length,0);
  assert.equal(h.elements.get('start-station').options.length,9);
  assert.equal(h.elements.get('start-game').disabled,false);
  h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});
  await h.click('start-game');
  assert.equal(get().phase,'playing');assert.equal(get().ready,true);assert.equal(get().spawnName,'莊敬分隊');
  await h.click('settings');assert.equal(get().phase,'select');assert.equal(get().ready,false);
});
test('定位HUD使用真道路折線，概覽獨立快取且只載一次',async()=>{
  const h=await harness();
  if(h.elements.has('start-game'))await h.click('start-game');
  h.frames.shift()(1000);
  assert.equal(h.elements.get('road').textContent,'測試路');
  assert.match(h.elements.get('location').textContent,/莊敬.*0.*m/);
  assert.ok(h.elements.has('overview-open'));
  await h.click('overview-open');await h.click('overview-open');
  assert.equal(h.calls.filter(s=>s.endsWith('overview.json')).length,1);
  assert.equal(h.elements.get('overview-map').width,780);
  assert.ok(h.calls.filter(s=>s.includes('/c/')).length>9);
});
test('短路段亦有固定26px主路牌，真折線路口只提示1.5秒不刷屏',async()=>{
  const h=await harness({shortRoads:true});await h.click('start-game');h.drawCalls.length=0;h.window.__game.renderScene();
  assert.ok(h.drawCalls.some(a=>a[0]==='fillText'&&a[1]==='主要路'));
  assert.ok(h.drawCalls.some(a=>a[0]==='set'&&a[1]==='font'&&a[2]==='bold 13px sans-serif'));
  assert.equal(h.elements.get('intersection').textContent,'教育街口');assert.equal(h.elements.get('intersection').hidden,false);
  h.advance(1600);assert.equal(h.elements.get('intersection').hidden,true);h.advance(1700);assert.equal(h.elements.get('intersection').hidden,true);
  await h.click('zoom-out');h.drawCalls.length=0;h.window.__game.renderScene();assert.ok(h.drawCalls.some(a=>a[0]==='set'&&a[1]==='font'&&a[2]==='bold 13px sans-serif'));
});
test('整局道路走廊超過25格仍完整保留預載範圍',async()=>{
  const h=await harness({widePreload:true});await h.click('start-game');const s=h.window.__game.getState();
  const requested=h.calls.filter(a=>a.includes('/c/')).map(a=>a.match(/\/([^/]+)\.json$/)[1]);assert.ok(requested.length>25);
  for(const key of requested)assert.ok(s.loadedCells.includes(key),key);
});
test('佔領提示音、緊張與結果音樂、完整地圖對照與新場所再一題',async()=>{
  const h=await harness({autoIntro:false});await h.click('start-game');await h.skipPrelude();h.advance(2000);assert.ok(!h.calls.includes('cue:capture'));h.advance(3000);assert.ok(h.calls.includes('cue:capture'));
  h.advance(152000);assert.ok(h.calls.includes('state:tense'));
  assert.ok(h.calls.includes('cue:lost'));assert.ok(h.calls.includes('cue:horn'));
  h.advance(182000);assert.ok(h.calls.includes('state:result'));const old=h.window.__game.getState().race.site;
  assert.match(h.elements.get('result-list').textContent,/犀牛綠旗/);assert.match(h.elements.get('result-list').textContent,/未找到/);
  assert.ok(h.drawCalls.some(a=>a[0]==='fillText'&&a[1]==='2'));
  await h.click('next-round');assert.equal(h.window.__game.getState().phase,'mission');await h.skipPrelude();h.advance(304000);
  assert.notEqual(h.window.__game.getState().race.site.n,old.n);assert.equal(h.window.__game.getState().race.remaining,180);
});
test('建立真競賽模型時傳入所有已載入地格的道路與建物幾何',async()=>{
  const h=await harness({realData:true});await h.click('start-game');
  const geometry=h.raceInputs[0],cells=await Promise.all(h.window.__game.getState().loadedCells.map(k=>readFile(new URL(`data/c/${k}.json`,root),'utf8').then(JSON.parse)));
  const polygons=list=>list.map(a=>a.p.join(',')).sort();
  assert.ok(Array.isArray(geometry.buildings),'createRace receives buildings');assert.ok(geometry.buildings.length>0);
  assert.deepEqual(polygons(Array.from(geometry.buildings)),polygons(cells.flatMap(c=>c.builds||[])));
  assert.deepEqual(polygons(Array.from(geometry.roads)),polygons(cells.flatMap(c=>c.roads||[])));
  assert.equal(h.window.__game.getState().phase,'playing');
});
test('真實三題資料與道路、建物碰撞完整整合至三分鐘結果（桌機及手機）',async()=>{
  for(const viewport of [[1280,800],[390,844]])for(let initialSite=0;initialSite<3;initialSite++){
    const h=await harness({realData:true,initialSite,viewport});await h.click('start-game');const get=()=>h.window.__game.getState();
    assert.equal(get().phase,'playing');assert.ok(get().race.total>=3);assert.ok(Math.abs(Math.hypot(get().x-get().race.site.x,get().y-get().race.site.y)-30)<1e-8);
    for(let seconds=20;seconds<180;seconds+=20){h.drawCalls.length=0;h.advance(seconds*1000);assert.equal(get().phase,'playing');assert.ok(get().race.npcs.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));}
    h.advance(180000);assert.equal(get().phase,'result');assert.equal(get().race.remaining,0);
    assert.equal(h.elements.get('result-list').textContent.split('\n').length,get().race.total);
    assert.ok(get().race.water.some(a=>a.owner?.startsWith('npc')),'實際道路可到水源，不是空轉消防車');
  }
});

test('v3 NPC destination frame flashes and excludes owned, inactive and cooling targets',async()=>{
 const h=await harness();let active=true,cooldown=0,owned=false,time=0;const create=h.box.createRace;
 h.box.createRace=options=>{const model=create(options),snapshot=s=>({...s,water:s.water.map((w,i)=>i===0?{...w,owner:owned?'player':null}:w),npcs:[{active,target:0,cooldownRemaining:cooldown,x:options.sites[0].x,y:options.sites[0].y,direction:{x:1,y:0}}]});return {...model,getState:()=>snapshot(model.getState()),tick:(...args)=>snapshot(model.tick(...args))};};
 await h.click('start-game');const c=h.elements.get('game').getContext('2d');
 const draw=()=>{h.advance(time+=10);h.drawCalls.length=0;h.box.drawRace(c,1,780,1000);return h.drawCalls.some(v=>v[0]==='set'&&v[1]==='strokeStyle'&&v[2]==='#e13232');};
 const now=h.box.performance.now;h.box.performance.now=()=>0;assert.equal(draw(),true);h.box.performance.now=()=>600;assert.equal(draw(),false);
 h.box.performance.now=()=>0;active=false;assert.equal(draw(),false);active=true;cooldown=3;assert.equal(draw(),false);cooldown=0;owned=true;assert.equal(draw(),false);h.box.performance.now=now;
});
