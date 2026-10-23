import test from 'node:test';
import assert from 'node:assert/strict';
import * as missions from '../missions.mjs';
import {createRace} from '../race.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('消防栓的完整來源地址隨原生ID進入真實競速與施工，不取附近道路冒充',()=>{
 const address='臺北市信義區信義路五段150巷471弄26-2號';
 const water=missions.decodeWaterCells([{key:'0_0',rows:[[0,0,'hydrant_under',address]]}],[]);
 assert.equal(water[0].address,address);
 assert.equal(water[0].id,'0_0:0');
 assert.ok(!water[0].n.includes('471弄'),'地圖維持短標籤，不鋪地址牆');
 const race=createRace({sites:[{x:0,y:0,n:'測試火場',addr:'測試'}],water:water.map(w=>({...w,sourceId:w.id})),stations:[],roads:[],canStand:()=>true,clock:()=>0,config:{npcCount:0,spawnDistance:0}});
 race.start(0);race.tick(.1,{x:0,y:0});const s=race.getState();
 assert.ok(s.construction);
 const actual=s.water.find(w=>w.id===s.construction.waterId);
 assert.equal(actual.address,address);assert.equal(actual.sourceId,'0_0:0');
});

test('只選身邊3公尺內一顆，施工優先綁定該栓；離開不留下舊地址',()=>{
 assert.equal(typeof missions.currentHydrant,'function');
 const water=[{id:0,x:0,y:0,address:'臺北市信義區松勤街9號'},{id:1,x:2,y:0,address:'臺北市信義區信義路五段150巷471弄26-2號'}];
 assert.equal(missions.currentHydrant(water,{x:0,y:0},null,3),water[0]);
 assert.equal(missions.currentHydrant(water,{x:0,y:0},{waterId:1},3),water[1]);
 assert.equal(missions.currentHydrant(water,{x:20,y:20},null,3),null);
 assert.equal(missions.hydrantAddress(water[1]),'信義路五段150巷471弄26-2號');
 assert.equal(missions.hydrantAddress({address:'台北市信義區松勤街9號'}),'松勤街9號');
 assert.equal(missions.hydrantAddress({address:'臺北市大安區和平東路三段1號'}),'臺北市大安區和平東路三段1號');
 assert.equal(missions.hydrantAddress({n:'附近道路不是地址'}),'地址尚未取得');
});

test('實際遊戲HUD施工時顯示該栓完整地址，離開或回選單清空，不把資料對上當成畫面完成',()=>{
 const code=readFileSync(new URL('../game.js',import.meta.url),'utf8');
 const start=code.indexOf('function updateConstructionUI(){'),end=code.indexOf("\n$('construction-cancel').addEventListener",start);
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,dataset:{},classList:{add(){},remove(){}}});return nodes.get(id);};
 const source={id:0,sourceId:'0_0:0',x:0,y:0,k:'hydrant_under',address:'臺北市信義區信義路五段150巷471弄26-2號',owner:null};
 const state={status:'playing',water:[source],remaining:100,score:0,totalHoses:0,construction:{waterId:0,duration:6,elapsed:1,hoses:2,contested:false}};
 const context=vm.createContext({$,phase:'playing',race:{getState:()=>state},x:0,y:0,RULES:{captureRadius:3},currentHydrant:missions.currentHydrant,hydrantAddress:missions.hydrantAddress,clearInput(){},notices:{clear(){}},captureEffects:[]});
 vm.runInContext(code.slice(start,end),context);vm.runInContext('updateConstructionUI()',context);
 assert.equal($('construction-address').textContent,'信義路五段150巷471弄26-2號');
 assert.equal($('construction-kind').textContent,'地下消防栓');assert.equal($('construction-panel').hidden,false);
 assert.equal($('construction-panel').dataset.sourceId,'0_0:0');
 assert.equal($('construction-cancel').hidden,false);
 state.construction=null;context.x=20;context.y=20;vm.runInContext('updateConstructionUI()',context);
 assert.equal($('construction-panel').hidden,true);assert.equal($('construction-address').textContent,'');
 context.x=0;context.y=0;vm.runInContext('updateConstructionUI()',context);
 assert.equal($('construction-panel').hidden,false);assert.equal($('construction-cancel').hidden,true);
 context.phase='select';vm.runInContext('updateConstructionUI()',context);
 assert.equal($('construction-panel').hidden,true);assert.equal($('construction-address').textContent,'');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/id="construction-address"/);assert.match(html,/id="construction-kind"/);
});

test('遊戲實際載入的每一格消防栓都有完整地址，不另載清冊或管理者資料',()=>{
 const root=new URL('../data/w/',import.meta.url),keys=JSON.parse(readFileSync(new URL('index.json',root),'utf8'));
 const cells=keys.map(key=>({key,rows:JSON.parse(readFileSync(new URL(key+'.json',root),'utf8'))}));
 for(const c of cells)for(const row of c.rows){assert.equal(row.length,4);assert.ok(typeof row[3]==='string'&&row[3].trim());}
 const actual=missions.decodeWaterCells(cells);assert.equal(actual.length,4644);assert.equal(new Set(actual.map(w=>w.id)).size,4644);
 assert.ok(actual.every(w=>w.address&&missions.hydrantAddress(w)!=='地址尚未取得'));
});

test('遊戲顯示把重複括號整理成一組全形括號，來源字串保持原樣',()=>{
 const source={address:'臺北市信義區忠孝東路五段1號((7-11前))'};
 assert.equal(missions.hydrantAddress(source),'忠孝東路五段1號（7-11前）');
 assert.equal(source.address,'臺北市信義區忠孝東路五段1號((7-11前))');
 assert.equal(missions.hydrantAddress({address:'臺北市信義區基隆路一段(交松隆路口東北側(行人穿越道上))'}),'基隆路一段（交松隆路口東北側（行人穿越道上））');
 assert.equal(missions.hydrantAddress({address:'臺北市信義區信義路六段76巷2弄27號（（北側））'}),'信義路六段76巷2弄27號（北側）');
});
