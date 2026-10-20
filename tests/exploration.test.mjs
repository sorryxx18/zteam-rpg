import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.mjs';
const root=new URL('../',import.meta.url);
async function harness({rejectMusic=false,wall=false}={}){
  const html=await readFile(new URL('index.html',root),'utf8');
  const source=await readFile(new URL('game.js',root),'utf8');
  const elements=new Map(), calls=[],events={}, frames=[],drawCalls=[];
  const context2d=new Proxy({}, {get:(o,k)=>o[k]??((...args)=>{drawCalls.push([k,...args]);}),set:(o,k,v)=>(drawCalls.push(['set',k,v]),o[k]=v,true)});
  function element(id=''){return {id,value:'',textContent:'',disabled:false,hidden:false,open:false,dataset:{},listeners:{},classList:{add(){},remove(){}},getContext:()=>context2d,getBoundingClientRect:()=>({width:780,height:1000}),append(o){this.options??=[];this.options.push(o);},setAttribute(k,v){this[k]=v;},focus(){document.activeElement=this;},closest:()=>null,setPointerCapture(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(k,fn){this.listeners[k]=fn;}};}
  for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements.set(id,element(id));
  const characters=['male','female','rhino'].map(name=>({...element(),dataset:{character:name,startCharacter:name},querySelector:()=>element()}));
  const document={activeElement:null,getElementById:id=>elements.get(id),createElement:()=>element(),addEventListener:(k,f)=>events[k]=f,querySelectorAll:s=>s.includes('character')?characters:[],querySelector:s=>element()};
  const base=JSON.parse(await readFile(new URL('data/base.json',root),'utf8'));
  const window={addEventListener:(k,f)=>events[k]=f};
  const box={...core,window,document,console,setTimeout:()=>1,clearTimeout(){},ResizeObserver:class{observe(){}},Image:class{set src(v){queueMicrotask(()=>this.onload());}},requestAnimationFrame:f=>frames.push(f),fetch:async url=>{calls.push(url);if(url.endsWith('base.json'))return {ok:true,json:async()=>base};if(url.endsWith('overview.json'))return {ok:true,json:async()=>({roads:[{p:[-5000,0,11000,0],w:8,n:'概覽路'}],stations:base.stations})};return {ok:true,json:async()=>({builds:wall?[{p:(()=>{const s=base.stations.find(s=>s.name.includes('莊敬'));return [s.x+.5,s.y-5,s.x+.51,s.y-5,s.x+.51,s.y+5,s.x+.5,s.y+5];})()}]:[],roads:[{p:[-5000,-677,11000,-677],w:8,n:'測試路'}]})};}};
  box.TRACKS=[{id:'street',name:'街角'},{id:'march',name:'行進'},{id:'night',name:'夜晚'}];
  box.createMusicPlayer=()=>{let muted=false,playing=false;return {play:id=>{calls.push('play:'+id);playing=!rejectMusic;return rejectMusic?Promise.reject(Error('gesture denied')):Promise.resolve();},pause(){playing=false;},setMuted(v){muted=v;},getState:()=>({muted,playing,track:'street'})};};
  vm.runInNewContext(source.replace(/^import .*?;\n/gm,''),box);
  const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};await settle();
  const click=async id=>{elements.get(id).listeners.click?.({target:elements.get(id)});await settle();};
  return {elements,calls,events,window,frames,click,settle,html,source,box,drawCalls};
}
test('開場與地圖dialog限制視窗高度且可捲動，手機橫式不強迫500px',async()=>{
  const css=await readFile(new URL('style.css',root),'utf8');
  assert.match(css,/dialog\s*\{[^}]*max-height:[^;]*dvh/);assert.match(css,/dialog\s*\{[^}]*overflow-y:auto/);
  assert.match(css,/@media\s*\(max-height:450px\)/);assert.match(css,/#app\{min-height:0/);
});
test('開始按鈕同步啟動音樂先於地格載入，曲目和靜音工具不吞遊戲焦點',async()=>{
  const h=await harness();assert.ok(h.elements.has('music-track'));assert.ok(h.elements.has('music-toggle'));
  h.elements.get('music-track').value='march';
  const promise=h.click('start-game');assert.ok(h.calls.includes('play:march'));await promise;
  assert.ok(h.calls.indexOf('play:march')<h.calls.findIndex(s=>s.includes('/c/')));
  assert.ok(h.window.__game.getState().music);
  await h.click('music-toggle');assert.equal(h.elements.get('game'),h.box.document.activeElement);assert.equal(h.window.__game.getState().music.muted,true);
  await h.click('music-toggle');assert.equal(h.window.__game.getState().music.muted,false);
});
test('音樂拒絕不阻擋開始，顯示可重試降級訊息',async()=>{
  const h=await harness({rejectMusic:true});await h.click('start-game');assert.equal(h.window.__game.getState().ready,true);assert.equal(h.elements.get('music-status').textContent,'音樂尚未開啟，點音樂重試');
});
test('產品尺度1m/unit，1.8m圖集高，走1.4跑3m/s及zoom4~10',async()=>{
  const h=await harness();await h.click('start-game');const get=()=>h.window.__game.getState();
  assert.equal(get().walkSpeed,1.4);assert.equal(get().runSpeed,3);assert.equal(get().spriteWorldHeight,1.8);
  assert.equal(get().zoom,8);
  assert.equal(get().metersPerUnit,1);assert.equal(get().collisionRadius,.32);
  const start=get().x;h.frames.shift()(1000);
  h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});
  h.frames.shift()(1050);assert.ok(Math.abs(get().x-start-.07)<1e-8);
  h.events.keydown({target:{closest:()=>null},key:'Shift',preventDefault(){}});
  h.frames.shift()(1100);assert.ok(Math.abs(get().x-start-.22)<1e-8);
  h.events.keyup({key:'d'});h.frames.shift()(1150);assert.equal(get().moving,false);
  assert.match(h.source,/spriteWorldHeight\*zoom\/80/);assert.match(h.source,/walkingTime\+=distance/);
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
  h.frames.shift()(1100);assert.ok(Math.abs(get().x-start-.07)<1e-8);
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
    h.frames.shift()(1200);assert.ok(Math.abs(get().x-start-(runFirst?.3:.6))<1e-8);assert.ok(Math.abs(get().movementSpeed-3)<1e-8);
    send('run','pointerup',99);assert.equal(get().runHeld,true);
    send('run','pointerup',2);h.frames.shift()(1300);assert.ok(Math.abs(get().movementSpeed-1.4)<1e-8);assert.equal(get().runHeld,false);
    send('run','pointerdown',3);send('joystick','pointerup',1);h.frames.shift()(1400);assert.equal(get().moving,false);assert.equal(get().movementSpeed,0);
    send('run','pointerup',3);h.frames.shift()(1500);assert.equal(get().runHeld,false);
  }
});

test('cancel/lostcapture/blur/visibility/resize/modal 清除兩指且選單內不能偷跑',async()=>{
  for(const trigger of ['pointercancel','lostpointercapture','blur','visibilitychange','resize','overview-open','settings','music-menu']){
    const h=await harness();await h.click('start-game');const get=()=>h.window.__game.getState();
    const stick=h.elements.get('joystick');stick.getBoundingClientRect=()=>({left:40,top:200,width:128,height:128});
    const send=(id,type,pointerId)=>h.elements.get(id).listeners[type]?.({pointerId,clientX:148,clientY:264,preventDefault(){}});
    send('joystick','pointerdown',1);send('run','pointerdown',2);
    h.frames.shift()(1000);h.frames.shift()(1100);assert.equal(get().moving,true);
    if(trigger==='pointercancel'||trigger==='lostpointercapture')send('joystick',trigger,1);
    else if(['overview-open','settings'].includes(trigger))await h.click(trigger);
    else if(trigger==='music-menu')h.elements.get('music-track').listeners.pointerdown?.({});
    else h.events[trigger]?.();
    assert.equal(get().runHeld,false,trigger);assert.equal(get().joystick.active,false,trigger);assert.equal(get().movementSpeed,0,trigger);
    const x=get().x;h.frames.shift()(1200);assert.equal(get().x,x,trigger);
    if(['overview-open','settings'].includes(trigger)){
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
  assert.ok(h.drawCalls.some(c=>c[0]==='ellipse'&&Math.abs(c[3]-8*.32)<1e-10&&Math.abs(c[4]-8*.32/2)<1e-10));
});

test('zoom按鈕以.5調整且限制4~10',async()=>{
  const h=await harness();const get=()=>h.window.__game.getState();
  await h.click('zoom-in');assert.equal(get().zoom,8.5);
  for(let i=0;i<20;i++)await h.click('zoom-in');assert.equal(get().zoom,10);
  await h.click('zoom-out');assert.equal(get().zoom,9.5);
  for(let i=0;i<20;i++)await h.click('zoom-out');assert.equal(get().zoom,4);
});

test('頁面與開場統一犀牛搶水源且是自由探索試玩',async()=>{
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
  assert.ok(h.calls.filter(s=>s.includes('/c/')).length<=9);
});
