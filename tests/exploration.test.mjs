import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.mjs';
const root=new URL('../',import.meta.url);
async function harness({rejectMusic=false}={}){
  const html=await readFile(new URL('index.html',root),'utf8');
  const source=await readFile(new URL('game.js',root),'utf8');
  const elements=new Map(), calls=[],events={}, frames=[];
  const context2d=new Proxy({}, {get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
  function element(id=''){return {id,value:'',textContent:'',disabled:false,hidden:false,open:false,dataset:{},listeners:{},classList:{add(){},remove(){}},getContext:()=>context2d,getBoundingClientRect:()=>({width:780,height:1000}),append(o){this.options??=[];this.options.push(o);},setAttribute(k,v){this[k]=v;},focus(){document.activeElement=this;},closest:()=>null,setPointerCapture(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(k,fn){this.listeners[k]=fn;}};}
  for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements.set(id,element(id));
  const characters=['male','female','rhino'].map(name=>({...element(),dataset:{character:name,startCharacter:name},querySelector:()=>element()}));
  const document={activeElement:null,getElementById:id=>elements.get(id),createElement:()=>element(),addEventListener:(k,f)=>events[k]=f,querySelectorAll:s=>s.includes('character')?characters:[],querySelector:s=>element()};
  const base=JSON.parse(await readFile(new URL('data/base.json',root),'utf8'));
  const window={addEventListener:(k,f)=>events[k]=f};
  const box={...core,window,document,console,setTimeout:()=>1,clearTimeout(){},ResizeObserver:class{observe(){}},Image:class{set src(v){queueMicrotask(()=>this.onload());}},requestAnimationFrame:f=>frames.push(f),fetch:async url=>{calls.push(url);if(url.endsWith('base.json'))return {ok:true,json:async()=>base};if(url.endsWith('overview.json'))return {ok:true,json:async()=>({roads:[{p:[-5000,0,11000,0],w:8,n:'概覽路'}],stations:base.stations})};return {ok:true,json:async()=>({builds:[],roads:[{p:[-5000,-677,11000,-677],w:8,n:'測試路'}]})};}};
  box.TRACKS=[{id:'street',name:'街角'},{id:'march',name:'行進'},{id:'night',name:'夜晚'}];
  box.createMusicPlayer=()=>{let muted=false,playing=false;return {play:id=>{calls.push('play:'+id);playing=!rejectMusic;return rejectMusic?Promise.reject(Error('gesture denied')):Promise.resolve();},pause(){playing=false;},setMuted(v){muted=v;},getState:()=>({muted,playing,track:'street'})};};
  vm.runInNewContext(source.replace(/^import .*?;\n/gm,''),box);
  const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};await settle();
  const click=async id=>{elements.get(id).listeners.click?.({target:elements.get(id)});await settle();};
  return {elements,calls,events,window,frames,click,settle,html,source,box};
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
test('遊戲化身高隨zoom同比例，步行2.2跑步4m/s且按實際距離播步伐',async()=>{
  const h=await harness();await h.click('start-game');const get=()=>h.window.__game.getState();
  assert.equal(get().walkSpeed,2.2);assert.equal(get().runSpeed,4);assert.equal(get().spriteWorldHeight,4.5);
  assert.equal(get().zoom,3.2);
  const start=get().x;h.frames.shift()(1000);
  h.events.keydown({target:{closest:()=>null},key:'d',preventDefault(){}});
  h.frames.shift()(1050);assert.ok(Math.abs(get().x-start-.11)<1e-8);
  h.events.keydown({target:{closest:()=>null},key:'Shift',preventDefault(){}});
  h.frames.shift()(1100);assert.ok(Math.abs(get().x-start-.31)<1e-8);
  h.events.keyup({key:'d'});h.frames.shift()(1150);assert.equal(get().moving,false);
  assert.match(h.source,/spriteWorldHeight\*zoom\/80/);assert.match(h.source,/walkingTime\+=distance/);
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
