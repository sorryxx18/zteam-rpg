import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRace,NPC_COUNTS} from '../race.mjs';
import {resolveFireSite} from '../missions.mjs';
import * as balance from '../tools/balance-v2.mjs';
const root=new URL('../',import.meta.url);
test('fixed sample 1 completes without illegal swept movement',()=>{
 const input=balance.loadInputs(),sample=input.samples.samples[0];
 const row=balance.simulateSample(balance.prepareSample(input,sample),sample);
 assert.equal(row.status,'completed');assert.equal(row.collisionViolations,0);
});
test('sample 1 tick 1652 validates all real axis legs, not counterfactual frame L',()=>{
 const input=balance.loadInputs(),nav=balance.createNavigator(balance.prepareSample(input,input.samples.samples[0]));
 const before={x:-2115.4945107369017,y:-37.44360921822131},target={x:-2088.0798989873224,y:-45.37989898732233},audit={};
 const next=balance.walkToward(before,target,.05,nav.canStand,10,nav.clear,audit);
 assert.equal(nav.clear(before,{x:next.x,y:before.y}),false);
 assert.equal(nav.canStand(next.x,next.y),true);assert.ok(Math.hypot(next.x-before.x,next.y-before.y)<=.5+1e-7);
 assert.equal(audit.acceptedMatchesNext,true);assert.ok(audit.legs.every(l=>l.accepted&&l.sweptClear));
});
test('axis-leg audit distinguishes valid staircase from fictitious full-frame L collision',()=>{
 const nav=balance.createNavigator({buildings:[{p:[.44,-.16,.46,-.16,.46,-.14,.44,-.14]}]});
 const before={x:0,y:0},audit={};
 const next=balance.walkToward(before,{x:1,y:1},.05,nav.canStand,10,nav.clear,audit);
 assert.ok(nav.canStand(next.x,next.y));assert.ok(Math.hypot(next.x,next.y)<=.5+1e-7);
 assert.equal(nav.clear(before,{x:next.x,y:before.y}),false,'legacy full-frame L rejects a path that was never walked');
 assert.equal(audit.acceptedMatchesNext,true);
 assert.equal(audit.legs.length,8);
 assert.ok(audit.legs.every(l=>l.accepted&&l.standable&&l.sweptClear));
 assert.deepEqual(audit.accepted,next);
});
test('synthetic geometry: road detour is walked, never through thin walls or beyond 3m helper',()=>{
 const buildings=[{p:[4,-2,6,-2,6,2,4,2]}],roads=[{p:[0,0,0,5,10,5,10,0]}];
 const nav=balance.createNavigator({buildings,roads});const from={x:0,y:0},target={x:10,y:0};
 assert.equal(nav.clear(from,target),false);
 const plan=nav.route(from,target);assert.ok(plan);assert.ok(plan.distance>10);
 let p=from;for(const q of plan.points){let guard=0;while(Math.hypot(q.x-p.x,q.y-p.y)>1e-7){const before=p;p=balance.walkToward(p,q,.05,nav.canStand);assert.ok(nav.clear(before,p));assert.ok(Math.hypot(p.x-before.x,p.y-before.y)<=.5+1e-8);assert.ok(++guard<1000);}}
 assert.ok(Math.hypot(p.x-target.x,p.y-target.y)<=3);
 const tiny=balance.createNavigator({buildings:[{p:[.05,-1,.06,-1,.06,1,.05,1]}]});
 const stopped=balance.walkToward({x:-.28,y:0},{x:1,y:0},.05,tiny.canStand,10,tiny.clear);
 assert.ok(stopped.x<-.27,'each actual core substep must validate its swept segment');
 const sealed=balance.createNavigator({roads:[],buildings:[{p:[-10,-10,10,-10,10,10,-10,10]}]});
 assert.equal(sealed.route({x:14,y:0},{x:0,y:0}),null);
});
test('blocked nearest road projection admits a real local corner detour, walked with swept axis guards',()=>{
 const nav=balance.createNavigator({buildings:[{p:[4,-2,6,-2,6,2,4,2]}],roads:[{p:[10,-10,10,10]}]});
 const from={x:0,y:0},target={x:10,y:0};
 assert.equal(nav.clear(from,target),false);
 const plan=nav.route(from,target);assert.ok(plan,'nearest projection blocked does not prove no walkable route');
 let p=from;for(const q of plan.points){assert.ok(nav.clear(p,q));let guard=0;while(Math.hypot(q.x-p.x,q.y-p.y)>1e-7){const audit={},before=p;p=balance.walkToward(p,q,.05,nav.canStand,10,nav.clear,audit);assert.ok(audit.acceptedMatchesNext);assert.ok(audit.legs.every(l=>!l.accepted||l.sweptClear));assert.ok(Math.hypot(p.x-before.x,p.y-before.y)<=.5+1e-8);assert.ok(++guard<1000);}}
 assert.ok(Math.hypot(p.x-target.x,p.y-target.y)<=3);
});
test('local corner search also tries visible alternate road segments, not a disconnected nearest decoy',()=>{
 const nav=balance.createNavigator({buildings:[{p:[4,-5,6,-5,6,5,4,5]}],roads:[{p:[3,-1,3,1]},{p:[10,-10,10,10]}]});
 const from={x:0,y:0},target={x:10,y:0},plan=nav.route(from,target);
 assert.ok(plan,'a nearer disconnected road must not hide a visible reachable segment');
 let p=from;for(const q of plan.points){assert.ok(nav.clear(p,q));let guard=0;while(Math.hypot(q.x-p.x,q.y-p.y)>1e-7){const audit={},before=p;p=balance.walkToward(p,q,.05,nav.canStand,10,nav.clear,audit);assert.ok(audit.acceptedMatchesNext);assert.ok(Math.hypot(p.x-before.x,p.y-before.y)<=.5+1e-8);assert.ok(++guard<1000);}}
 assert.ok(Math.hypot(p.x-target.x,p.y-target.y)<=3);
});
test('synthetic report statistics use captures only, conserve sparse actual denominators',()=>{
 const rows=[{captured:2,npc:3,unclaimed:13,total:18},{captured:8,npc:10,unclaimed:2,total:20}];
 assert.deepEqual(balance.summarize(rows),{games:2,mean:5,min:2,max:8,captured:10,npc:13,unclaimed:15,total:38});
 assert.throws(()=>balance.summarize([{captured:3,npc:0,unclaimed:0,total:18}]),/conservation/);
});
test('model readiness behavioral probe refuses incomplete construction and checks real model',()=>{
 const broken=()=>({start:()=>({npcs:[]}),tick:()=>({}),getState:()=>({})});
 assert.equal(balance.checkModelReady(broken).ready,false);
 const result=balance.checkModelReady();assert.equal(typeof result.ready,'boolean');assert.ok(Array.isArray(result.errors));
});

test('synthetic simulation spends the entire 180s, walks at most 10m/s and constructs while locked',()=>{
 const geometry={fire:{n:'synthetic',addr:'synthetic',x:0,y:0},water:[{n:'synthetic a',k:'hydrant_above',x:60,y:0},{n:'synthetic b',k:'hydrant_under',x:100,y:0}],stations:[{x:10000,y:0},{x:10000,y:0}],roads:[{p:[0,0,10000,0],w:8},{p:[0,0,0,400],w:8},{p:[0,0,-400,0],w:8}],buildings:[]};
 const nav=balance.createNavigator(geometry);assert.equal(nav.clear({x:0,y:0},{x:.01,y:0}),true);
 const row=balance.simulateSample(geometry,{sample:1,station:'synthetic',support:false,siteIndex:0});
 assert.equal(row.simulatedSeconds,180);assert.equal(row.captured,2);assert.equal(row.totalHoses,8);
 assert.ok(row.movementSeconds>=6);assert.ok(row.constructionSeconds>=4);assert.equal(row.collisionViolations,0);
 assert.ok(Math.abs(row.movementSeconds+row.constructionSeconds+row.idleSeconds-180)<1e-6);
});
test('fixed public sample preserves 20 distinct sites, nine teams and support; authorized source hash',()=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('tests/fixtures/v3-balance-samples.json',root)));
 assert.equal(fixture.samples.length,20);assert.equal(new Set(fixture.samples.map(s=>s.siteIndex)).size,20);
 assert.equal(new Set(fixture.samples.map(s=>s.station)).size,9);
 assert.ok(fixture.samples.some(s=>s.support));assert.ok(fixture.samples.every(s=>s.difficulty==='normal'));
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('data/sites.json',root))).digest('hex'),fixture.sourceSitesSha256);
 const inputs=balance.loadInputs();const rows=fixture.samples.map(s=>({...s,total:balance.prepareSample(inputs,s).water.length}));
 assert.equal(rows[10].total,14);assert.ok(rows.every(s=>s.total>=10&&s.total<=15));
});
test('fresh-round loaded geometry matches actual game loadNearby, pinned corridors and LRU',async()=>{
 const input=balance.loadInputs(),source=fs.readFileSync(new URL('game.js',root),'utf8');
 const loaders=source.slice(source.indexOf('async function loadCell('),source.indexOf('function releaseCapture('));
 const corridor=source.slice(source.indexOf('  await loadNearby(introSite.x,introSite.y);'),source.indexOf('  const cells=await Promise.all(waterCellKeys'));
 for(const sample of input.samples.samples){
  const context={base:input.base,available:new Set(input.base.cells),cache:new Map(),pending:new Map(),failed:new Set(),pinnedCells:new Set(),roadsVersion:0,console,message:()=>{},token:1,arrival:1,difficulty:'normal',NPC_COUNTS,cellKey:(x,y)=>`${Math.floor(x/input.base.cs)}_${Math.floor(y/input.base.cs)}`,introSite:input.sites[sample.siteIndex],resolveFireSite,
   fetch:async url=>({ok:true,json:async()=>structuredClone(input.cells.get(url.replace('./data/c/','').replace('.json','')))}),
   cachedGeometry:()=>({builds:[...context.cache.values()].flatMap(c=>c.builds||[])})};
  await vm.runInNewContext(`${loaders}\n(async()=>{${corridor}})()`,context);
  const prepared=balance.prepareSample(input,sample);
  assert.deepEqual([...context.cache.keys()].sort(),[...prepared.cellKeys].sort(),`sample ${sample.sample} initial loaded cells`);
  assert.equal(context.introSite.x,prepared.fire.x);assert.equal(context.introSite.y,prepared.fire.y);
 }
});

test('fixed sample 10 can leave spawn using swept-safe corner detour, not idle forever',()=>{
 const input=balance.loadInputs(),sample=input.samples.samples[9],geometry=balance.prepareSample(input,sample);
 const nav=balance.createNavigator(geometry);
 const race=createRace({sites:[geometry.fire],water:geometry.water,stations:geometry.stations,roads:geometry.roads,buildings:geometry.buildings,canStand:nav.canStand,clock:()=>0,config:{targetRadius:300}});
 const spawn=race.start(0).spawn;
 const plans=geometry.water.map(w=>nav.route(spawn,w)).filter(Boolean);assert.ok(plans.length>0);
 const q=plans[0].points.find(p=>Math.hypot(p.x-spawn.x,p.y-spawn.y)>1e-7);assert.ok(q);
 const audit={},next=balance.walkToward(spawn,q,.05,nav.canStand,10,nav.clear,audit);
 assert.ok(Math.hypot(next.x-spawn.x,next.y-spawn.y)>0);assert.ok(audit.acceptedMatchesNext);assert.ok(audit.legs.every(l=>!l.accepted||l.sweptClear));
});
