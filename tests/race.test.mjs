import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
test('legacy synthetic fixtures remain strict, road-centred, outside buildings, reachable and locally plentiful',()=>{
 const read=p=>JSON.parse(readFileSync(new URL(p,root)));const ss=read('tests/fixtures/v1-sites.json'),ww=read('tests/fixtures/v1-water.json'),base=read('data/base.json');
 assert.ok(ss.length>=3&&ss.length<=9);const cells=base.cells.map(k=>read(`data/c/${k}.json`));const roads=cells.flatMap(c=>c.roads),graph=buildRoadGraph(roads);const vertices=new Set(roads.flatMap(r=>r.p.reduce((a,v,i)=>i%2?a:[...a,`${v},${r.p[i+1]}`],[])));
 const inside=(w,p)=>{let yes=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)if((p[i+1]>w.y)!==(p[j+1]>w.y)&&w.x<(p[j]-p[i])*(w.y-p[i+1])/(p[j+1]-p[i+1])+p[i])yes=!yes;return yes;};
 for(const s of ss){assert.deepEqual(Object.keys(s).sort(),['addr','n','x','y']);assert.match(s.n,/演練|虛構/);assert.match(s.addr,/演練|虛構/);const local=ww.filter(w=>Math.hypot(w.x-s.x,w.y-s.y)<=500);assert.ok(local.length>=12&&local.length<=18,`${s.n}: ${local.length}`);assert.equal(new Set(local.map(w=>w.k)).size,2);const station=[...base.stations].sort((a,b)=>Math.hypot(a.x-s.x,a.y-s.y)-Math.hypot(b.x-s.x,b.y-s.y))[0];for(const w of local)assert.ok(shortestRoute(graph,station,w));}
 for(const w of ww){assert.deepEqual(Object.keys(w).sort(),['k','n','x','y']);assert.ok(vertices.has(`${w.x},${w.y}`));assert.ok(!cells.some(c=>c.builds.some(b=>inside(w,b.p))));assert.ok(ss.some(s=>Math.hypot(w.x-s.x,w.y-s.y)<=500));}
});
test('local converter requires explicit output, matches source projection, rejects unknown types and NaN',()=>{
 const temp=mkdtempSync(join(tmpdir(),'race-convert-'));try{const input=join(temp,'in.json'),output=join(temp,'out.json');const run=(args)=>spawnSync('python3',[new URL('tools/convert_game_data.py',root).pathname,...args],{encoding:'utf8'});writeFileSync(input,JSON.stringify([{n:'虛構',addr:'演練',lon:121.563,lat:25.0355}]));let r=run(['--input',input,'--kind','sites','--output',output]);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(readFileSync(output)),[{n:'虛構',addr:'演練',x:0,y:0}]);assert.notEqual(run(['--input',input,'--kind','sites']).status,0);for(const row of [{k:'bad',n:'虛構',x:1,y:1},{k:'hydrant_under',n:'虛構',x:null,y:1}]){writeFileSync(input,JSON.stringify([row]));assert.notEqual(run(['--input',input,'--kind','water','--output',output]).status,0);}}finally{rmSync(temp,{recursive:true,force:true});}
});
import {buildRoadGraph, shortestRoute, createRace, RULES} from '../race.mjs';
import {circleIntersectsPoly,pointInPoly} from '../core.mjs';
// Match game.js pinRect and the two nearest-station corridors; no DOM or browser.
function loadedGeometry(site,base){
 const keys=new Set();
 const pinRect=(l,b,r,t)=>{for(const key of base.cells){const [a,c]=key.split('_').map(Number);if((a+1)*base.cs>=l&&a*base.cs<=r&&(c+1)*base.cs>=b&&c*base.cs<=t)keys.add(key);}};
 pinRect(site.x-500,site.y-500,site.x+500,site.y+500);
 const nearest=[...base.stations].sort((a,b)=>Math.hypot(a.x-site.x,a.y-site.y)-Math.hypot(b.x-site.x,b.y-site.y)).slice(0,2);
 for(const s of nearest){const d=Math.hypot(s.x-site.x,s.y-site.y),steps=Math.max(1,Math.ceil(d/(base.cs/2)));for(let i=0;i<=steps;i++){const px=site.x+(s.x-site.x)*i/steps,py=site.y+(s.y-site.y)*i/steps;pinRect(px-base.cs,py-base.cs,px+base.cs,py+base.cs);}}
 const cells=[...keys].map(k=>JSON.parse(readFileSync(new URL(`data/c/${k}.json`,root))));
 return {roads:cells.flatMap(c=>c.roads||[]),buildings:cells.flatMap(c=>c.builds||[])};
}
test('three legacy fixture sites on real geometry: fast-forward 180 model seconds, collision-free NPCs still steal',t=>{
 const read=p=>JSON.parse(readFileSync(new URL(p,root))),sites=read('tests/fixtures/v1-sites.json'),water=read('tests/fixtures/v1-water.json'),base=read('data/base.json');
 for(let index=0;index<sites.length;index++){
  const geometry=loadedGeometry(sites[index],base);
  const obstacles=geometry.buildings.map(b=>({...b,l:Math.min(...b.p.filter((_,i)=>i%2===0)),r:Math.max(...b.p.filter((_,i)=>i%2===0)),s:Math.min(...b.p.filter((_,i)=>i%2)),n:Math.max(...b.p.filter((_,i)=>i%2))}));
  let now=0;const race=createRace({sites,water,stations:base.stations,...geometry,clock:()=>now});
  const check=(state,time)=>{for(const npc of state.npcs)for(const b of obstacles){if(npc.x<b.l-.32||npc.x>b.r+.32||npc.y<b.s-.32||npc.y>b.n+.32)continue;assert.ok(!pointInPoly(npc.x,npc.y,b.p),`site ${index}, ${time}s ${npc.id} inside building (${npc.x},${npc.y})`);assert.ok(!circleIntersectsPoly(npc.x,npc.y,.32,b.p),`site ${index}, ${time}s ${npc.id} touches building`);}};
  check(race.start(index),0);let state;
  // 50ms samples plus exact segment checks in the graph; not real five-minute play.
  for(let step=1;step<=3600;step++){now=step*50;state=race.tick(.05,{x:1e6,y:1e6});check(state,step*.05);}
  assert.equal(state.status,'finished');assert.equal(state.remaining,0);
  assert.ok(state.water.some(w=>w.owner!==null),`site ${index}: vehicles must actually steal`);
  const stolen=race.drainEvents().filter(e=>e.type==='stolen').length;
  t.diagnostic(`site ${index}: ${stolen} stolen; 180 model seconds, 3600 steps, ${geometry.roads.length} roads / ${obstacles.length} buildings`);
 }
});
const road = (...p) => ({p});
test('real Xinyi Lane 228 edge through building 106 is excluded without editing road geometry',()=>{
 const cell=JSON.parse(readFileSync(new URL('data/c/-7_-1.json',root)));
 const building=cell.builds[106],blocked=road(-3156.1,-324.4,-3160.8,-344.9);
 const original=structuredClone(blocked);
 const graph=buildRoadGraph([blocked],{buildings:[building]});
 assert.equal(graph.edges.length,0,'the recorded 230.3s indoor segment must not be traversable');
 assert.deepEqual(blocked,original);
});
test('swept radius rejects thin walls, tangency and near misses without rejecting clear edges',()=>{
 const box=(l,b,r,t)=>({p:[l,b,r,b,r,t,l,t],bbox:['ignored caller metadata']});
 const cases=[
  {building:box(50.001,-1,50.002,1),edges:0}, // narrower than any movement sample
  {building:box(40,.31,60,1),edges:0}, // centreline clear, vehicle clips
  {building:box(40,.32,60,1),edges:0}, // tangency
  {building:box(40,.321,60,1),edges:1},
  {building:box(-1,-1,1,1),edges:0}, // endpoint inside
 ];
 for(const {building,edges} of cases)assert.equal(buildRoadGraph([road(0,0,100,0)],{buildings:[building]}).edges.length,edges);
 assert.equal(buildRoadGraph([road(0,0,100,0)],{buildings:[box(40,.31,60,1)],radius:.3}).edges.length,1);
 // A corner approaches the middle of a diagonal edge; bbox alone is not decisive.
 assert.equal(buildRoadGraph([road(0,0,100,100)],{buildings:[box(50,49.7,51,49.8)]}).edges.length,0);
 assert.equal(buildRoadGraph([road(0,0,100,100)],{buildings:[box(50,45,51,46)]}).edges.length,1);
});
test('blocked shortcut reroutes over unchanged real edges; disconnected water stays unclaimed',()=>{
 const buildings=[{p:[40,-1,60,-1,60,1,40,1]}];
 const roads=[road(0,0,100,0),road(0,0,0,20,100,20,100,0)];
 const before=structuredClone({roads,buildings});
 const route=shortestRoute(buildRoadGraph(roads,{buildings}),{x:0,y:0},{x:100,y:0});
 assert.equal(route.distance,140);
 assert.deepEqual(route.points,[{x:0,y:0},{x:0,y:20},{x:100,y:20},{x:100,y:0}]);
 assert.deepEqual({roads,buildings},before);
 const blocked=setup({roads:[road(-10,0,0,0),road(0,0,100,0),road(100,0,110,0)],buildings,stations:[{x:0,y:0}],water:[water[0]]});
 blocked.race.start();blocked.setTime(299900);const state=blocked.race.tick(299.9,{x:-999,y:0});
 assert.ok(state.npcs.every(n=>n.target===null&&n.x===0&&n.y===0));
 assert.equal(state.water[0].owner,null);
 assert.ok(!blocked.race.drainEvents().some(e=>e.type==='stolen'));
});
const sites=[{n:'演練甲',addr:'虛構地址',x:0,y:0}];
const water=[{k:'hydrant_above',n:'演練栓',x:100,y:0},{k:'hydrant_under',n:'演練池',x:200,y:0},{k:'hydrant_under',n:'演練河',x:600,y:0}];
const setup=(extra={})=>{let now=0;const race=createRace({sites,water,stations:[{x:0,y:0},{x:300,y:0}],roads:[road(0,0,600,0)],clock:()=>now,random:()=>0,...extra,config:{npcCount:2,...extra.config}});return {race,setTime:n=>now=n};};
test('default rules, random address, standable 30m spawn, 500m targets and frozen snapshots',()=>{
 assert.equal(RULES.roundSeconds,180);const {race}=setup({canStand:(x,y)=>y>20});
 assert.equal(race.getState().status,'idle');const s=race.start();assert.equal(s.total,2);assert.ok(Math.abs(Math.hypot(s.spawn.x,s.spawn.y)-30)<1e-8);assert.ok(s.spawn.y>20);assert.ok(Object.isFrozen(s.water[0]));assert.equal(race.drainEvents().length,0);
 const other=setup({sites:[...sites,{n:'演練乙',addr:'虛構',x:100,y:0}],random:()=>.99});assert.equal(other.race.start().site.n,'演練乙');
});
test('player capture radius is inclusive, unique, events drain, original water ids retained',()=>{
 const {race,setTime}=setup({water:[water[2],...water.slice(0,2)]});race.start();assert.equal(race.tick(0,{x:96.99,y:0}).captured,0);let s=race.tick(0,{x:97,y:0});assert.equal(s.captured,0);assert.equal(s.construction.waterId,1);setTime(2500);s=race.tick(2.5,{x:97,y:0});assert.equal(s.captured,1);assert.equal(s.water[0].id,1);assert.equal(race.drainEvents()[0].type,'capture');race.tick(0,{x:100,y:0});assert.deepEqual(race.drainEvents(),[]);
});
test('clock milliseconds, not dt, controls deadline and finished state never changes',()=>{
 const {race,setTime}=setup();race.start();setTime(179999);assert.ok(race.tick(0,{x:-999,y:0}).remaining>0);setTime(180000);const s=race.tick(999,{x:100,y:0});assert.equal(s.status,'finished');assert.equal(s.captured,0);assert.equal(s.remaining,0);assert.equal(race.drainEvents().filter(e=>e.type==='finish').length,1);setTime(1);assert.deepEqual(race.tick(2,{x:200,y:0}),s);assert.deepEqual(race.drainEvents(),[]);
 const fresh=setup();fresh.race.start();assert.equal(fresh.race.tick(999,{x:-999,y:0}).remaining,180);
});
test('station spawn, delay boundaries, 10m/s and two distinct targets',()=>{
 const {race,setTime}=setup({config:{spawnMode:'nearest-station'}});assert.deepEqual(race.start().spawn,{x:0,y:0});setTime(9000);assert.ok(race.tick(9,{x:-999,y:0}).npcs.every(n=>!n.active));setTime(10000);let s=race.tick(1,{x:-999,y:0});assert.ok(s.npcs.every(n=>n.active));assert.equal(new Set(s.npcs.map(n=>n.target)).size,2);assert.equal(s.npcs[0].x,0);setTime(11000);s=race.tick(1,{x:-999,y:0});assert.ok(Math.abs(s.npcs[0].x-10*RULES.npcSpeedRatio)<1e-8);assert.ok(Math.abs(s.npcs[1].x-(300-10*RULES.npcSpeedRatio))<1e-8);
});
test('single station second vehicle leaves at 15s, stolen event and cooldown',()=>{
 const {race,setTime}=setup({stations:[{x:0,y:0}]});race.start();race.tick(0,{x:100,y:0});setTime(2500);assert.equal(race.tick(2.5,{x:100,y:0}).captured,1);setTime(10000);let s=race.tick(17.5,{x:-999,y:0});assert.equal(s.npcs[0].target,1);assert.equal(s.npcs[1].active,false);setTime(15000);s=race.tick(5,{x:-999,y:0});assert.equal(s.npcs[1].active,true);setTime((10+197/(10*RULES.npcSpeedRatio)+5)*1000);s=race.tick(25,{x:-999,y:0});assert.equal(s.water[1].owner,'npc1');assert.equal(s.npcs[0].target,null);assert.ok(s.npcs[0].cooldownRemaining>0);assert.ok(race.drainEvents().some(e=>e.type==='stolen'&&e.npcId==='npc1'));assert.equal(s.captured,1);
});
test('horn is within 50m and has an eight second per-vehicle cooldown',()=>{
 const {race,setTime}=setup();race.start();setTime(10000);race.tick(20,{x:0,y:0});assert.equal(race.drainEvents().filter(e=>e.type==='horn').length,1);setTime(11000);race.tick(0,{x:0,y:0});assert.equal(race.drainEvents().filter(e=>e.type==='horn').length,0);setTime(18000);race.tick(0,{x:0,y:0});assert.equal(race.drainEvents().filter(e=>e.type==='horn').length,1);
});
test('unreachable NPC cannot fly, invalid data refuses explicitly',()=>{
 const {race,setTime}=setup({roads:[road(0,0,10,0),road(100,0,200,0)]});race.start();setTime(30000);assert.equal(race.tick(30,{x:-999,y:0}).npcs[0].target,null);
 for(const extra of [{sites:[]},{water:[{...water[0],k:'bad'}]},{sites:[{...sites[0],x:NaN}]},{water:[]}])assert.throws(()=>{const {race}=setup(extra);race.start();},/場所|水源|座標|類型/);
 assert.throws(()=>setup({canStand:()=>false}).race.start(),/站立/);
});
test('horn detects passing within 50m during a stalled frame',()=>{
 const {race,setTime}=setup({stations:[{x:0,y:0}],water:[{k:'hydrant_under',n:'遠處',x:400,y:0}]});race.start();setTime(50000);race.tick(50,{x:100,y:10});assert.ok(race.drainEvents().some(e=>e.type==='horn'));
});
test('500m boundary is inclusive and route cost beats Euclidean target distance',()=>{
 const {race,setTime}=setup({stations:[{x:0,y:0}],water:[{k:'hydrant_under',n:'近但繞遠',x:10,y:0},{k:'hydrant_under',n:'道路較近',x:0,y:50},{k:'hydrant_above',n:'邊界',x:500,y:0},{k:'hydrant_under',n:'外界',x:500.01,y:0}],roads:[road(0,0,0,100,10,100,10,0),road(0,0,500,0)]});
 // The direct bottom road would make the first target genuinely close: omit it from NPC graph.
 const alt=setup({stations:[{x:0,y:0}],water:[{k:'hydrant_under',n:'近但繞遠',x:10,y:0},{k:'hydrant_under',n:'道路較近',x:0,y:50}],roads:[road(0,0,0,100,10,100,10,0)]});
 assert.equal(race.start().total,3);alt.race.start();alt.setTime(10000);assert.equal(alt.race.tick(10,{x:-999,y:0}).npcs[0].target,1);
});
test('road movement follows bends, offroad targets cannot cause a final straight-line jump',()=>{
 const {race,setTime}=setup({stations:[{x:0,y:0}],water:[{k:'hydrant_under',n:'終點',x:100,y:100},{k:'hydrant_under',n:'建物假點',x:50,y:50}],roads:[road(0,0,0,100,100,100)]});race.start();setTime(20000);let s=race.tick(10,{x:-999,y:0});assert.equal(s.npcs[0].x,0);assert.ok(Math.abs(s.npcs[0].y-100)<1e-7);assert.equal(s.npcs[0].target,0);setTime(40000);s=race.tick(20,{x:-999,y:0});assert.equal(s.water[0].owner,'npc1');assert.equal(s.water[1].owner,null);assert.ok(s.npcs.every(n=>n.target===null));
});
test('road routing uses all vertices, weighted detour, deduplication and projections', () => {
 const g=buildRoadGraph([road(0,0,0,100,100,100,100,0),road(100,0,100,100,0,100,0,0)]);
 const r=shortestRoute(g,{x:0,y:10},{x:100,y:10});
 assert.equal(r.distance,280); assert.deepEqual(r.points,[{x:0,y:10},{x:0,y:100},{x:100,y:100},{x:100,y:10}]);
 assert.equal(g.edges.length,3);
});
test('unreachable routes never invent straight connections; quantized endpoints connect',()=>{
 assert.equal(shortestRoute(buildRoadGraph([road(0,0,10,0),road(100,0,110,0)]),{x:0,y:0},{x:100,y:0}),null);
 assert.ok(shortestRoute(buildRoadGraph([road(0,0,10,0),road(10.1,0,20,0)]),{x:0,y:0},{x:20,y:0}));
 assert.equal(shortestRoute(buildRoadGraph([]),{x:0,y:0},{x:1,y:0}),null);
});
