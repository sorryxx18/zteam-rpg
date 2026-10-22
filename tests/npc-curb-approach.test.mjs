import test from 'node:test';
import assert from 'node:assert/strict';
import {RULES,createRace,buildRoadGraph} from '../race.mjs';
const speed=RULES.runSpeed*RULES.npcSpeedRatio;
const away={x:-999,y:-999};
function setup({source={x:40,y:6},roads=[{p:[0,0,80,0],w:8}],buildings=[],canStand=()=>true,water}={}){
 let now=0;const race=createRace({sites:[{n:'演練',addr:'測試',x:0,y:0}],water:water??[{n:'水源',k:'hydrant_above',...source}],stations:[{x:0,y:0}],roads,buildings,canStand,clock:()=>now,config:{npcCount:1,npcDelaySeconds:0}});
 race.start();return {race,at(time){const dt=time-now/1000;now=time*1000;return race.tick(dt,away);}};
}
test('8m road permits swept-radius-safe curb approach to source 6m from centre, with real travel and inclusive 3m arrival',()=>{
 const {race,at}=setup();let s=at(0);assert.equal(s.npcs[0].target,0);assert.equal(s.npcs[0].x,0);assert.equal(s.npcs[0].y,0);
 assert.equal(s.npcs[0].route.at(-1).x,40);assert.ok(Math.abs(s.npcs[0].route.at(-1).y-3)<1e-10);
 s=at(40/speed);assert.ok(Math.abs(s.npcs[0].x-40)<1e-8);assert.ok(Math.abs(s.npcs[0].y)<1e-8);assert.equal(s.npcs[0].construction,null);
 s=at(42/speed);assert.ok(Math.abs(s.npcs[0].y-2)<1e-8);assert.equal(s.npcs[0].construction,null);
 s=at(43/speed);assert.ok(Math.abs(s.npcs[0].y-3)<1e-8);assert.equal(s.npcs[0].construction.elapsed,0);assert.equal(s.water[0].owner,null);
 s=at(43/speed+1.5);assert.equal(s.water[0].owner,'npc1');assert.ok(s.npcs[0].y+.32<=4);assert.equal(race.drainEvents().filter(e=>e.type==='stolen').length,1);
});
for(const y of [10,6.7])test(`8m road rejects source at ${y}m: entire .32m radius must remain within road`,()=>{
 const {at}=setup({source:{x:40,y}});const s=at(100);assert.equal(s.water[0].owner,null);assert.equal(s.npcs[0].target,null);assert.equal(s.npcs[0].x,0);assert.equal(s.npcs[0].y,0);
});
for(const w of [undefined,0,-8,NaN,Infinity])test(`absent or invalid road width ${w} never creates an offroad connector`,()=>{
 const {at}=setup({roads:[{p:[0,0,80,0],w}]});assert.equal(at(100).water[0].owner,null);
});
const box=(l,b,r,t)=>({p:[l,b,r,b,r,t,l,t]});
for(const [name,building] of [['thin wall',box(39,1.001,41,1.002)],['radius tangency',box(40.32,1,41,2)],['endpoint building',box(39,3.1,41,3.3)]])test(`curb approach rejects ${name} although centreline stays clear`,()=>{
 const buildings=[building];assert.equal(buildRoadGraph([{p:[0,0,80,0],w:8}],{buildings}).edges.length,1);
 const {at}=setup({buildings});const s=at(100);assert.equal(s.npcs[0].target,null);assert.equal(s.water[0].owner,null);assert.equal(s.npcs[0].x,0);
});
test('curb endpoint must satisfy canStand',()=>{
 const {at}=setup({canStand:(x,y)=>y<2.9});assert.equal(at(100).water[0].owner,null);
});
test('polyline end uses bounded original road capsule, not an unlimited centreline extension',()=>{
 const legal=setup({source:{x:86,y:0}});let s=legal.at(83/speed);assert.ok(Math.abs(s.npcs[0].x-83)<1e-8);assert.equal(s.npcs[0].construction.elapsed,0);assert.ok(s.npcs[0].x-80+.32<=4);assert.equal(legal.at(83/speed+2.5).water[0].owner,'npc1');
 const illegal=setup({source:{x:90,y:0}});s=illegal.at(100);assert.equal(s.water[0].owner,null);assert.equal(s.npcs[0].target,null);
});
test('quantized graph vertices cannot expand the original road capsule',()=>{
 const roads=[{p:[-10,.2,0,.2]},{p:[0,0,80,0],w:8}],before=structuredClone(roads);
 const graph=buildRoadGraph(roads);assert.equal(graph.edges[1].a.y,.2);assert.equal(graph.edges[1].roadA.y,0);assert.equal(graph.edges[1].w,8);
 const {at}=setup({roads,source:{x:40,y:6.75}});assert.equal(at(100).water[0].owner,null);assert.deepEqual(roads,before);
});
test('centreline targets already within 3m retain their original route',()=>{
 const {at}=setup({source:{x:40,y:2.5}});assert.deepEqual(at(0).npcs[0].route,[{x:0,y:0},{x:40,y:0}]);
});
test('after curb construction and cooldown the next route integrates its return to centreline',()=>{
 const {at}=setup({water:[{n:'靠邊',k:'hydrant_above',x:40,y:6},{n:'下一點',k:'hydrant_above',x:70,y:0}]});
 let s=at(43/speed+4.5);assert.equal(s.water[0].owner,'npc1');assert.equal(s.npcs[0].y,3);assert.ok(Math.abs(s.npcs[0].x-40)<1e-8);
 s=at(44/speed+4.5);assert.ok(Math.abs(s.npcs[0].y-2)<1e-8);assert.ok(Math.abs(s.npcs[0].x-40)<1e-8);assert.equal(s.npcs[0].construction,null);
 s=at(46/speed+4.5);assert.ok(Math.abs(s.npcs[0].y)<1e-8);assert.ok(Math.abs(s.npcs[0].x-40)<1e-8);assert.equal(s.water[1].owner,null);
 assert.equal(at(73/speed+6.5).water[1].owner,'npc1');
});
