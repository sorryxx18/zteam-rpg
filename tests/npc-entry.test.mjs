import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRace,buildRoadGraph,shortestRoute} from '../race.mjs';
const site={n:'演練火場',addr:'虛構地址',x:0,y:0};
const angles=[Math.PI/2,Math.PI/2+2*Math.PI/3,Math.PI/2+4*Math.PI/3];
const roads=angles.map(a=>({w:8,p:[0,0,400*Math.cos(a),400*Math.sin(a)]}));
const water=angles.map((a,i)=>({n:`演練栓${i}`,k:'hydrant_above',x:150*Math.cos(a),y:150*Math.sin(a)}));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
test('perimeter dispatch uses evenly distributed real roads at 250–300m, not stations, and appears at 5 seconds',()=>{
 let now=0;const race=createRace({sites:[site],water,roads,stations:[{x:1500,y:0}],clock:()=>now,config:{npcSpawnMode:'perimeter'}}),s=race.start(0),graph=buildRoadGraph(roads);
 assert.equal(s.npcs.length,3);assert.equal(s.npcs.every(n=>!n.active),true);
 for(let i=0;i<3;i++){const n=s.npcs[i];assert.ok(distance(n,site)>=250-1e-7&&distance(n,site)<=300+1e-7);assert.ok(shortestRoute(graph,n,water[i]));const angle=Math.atan2(n.y,n.x);assert.ok(Math.abs(Math.atan2(Math.sin(angle-angles[i]),Math.cos(angle-angles[i])))<1e-7);}
 now=4999;assert.ok(race.tick(4.999,{x:1e6,y:1e6}).npcs.every(n=>!n.active));
 now=5000;assert.ok(race.tick(.001,{x:1e6,y:1e6}).npcs.every(n=>n.active));
 now=5025;const moved=race.tick(.025,{x:1e6,y:1e6});for(let i=0;i<3;i++)assert.ok(distance(moved.npcs[i],s.npcs[i])<=.250001,'no teleport after appearance');
});
test('perimeter mode never falls back to a station when no legal entry road exists',()=>{
 const race=createRace({sites:[site],water,roads:[],stations:[{x:1500,y:0}],config:{npcSpawnMode:'perimeter'}});assert.throws(()=>race.start(0),/進場道路/);
});
test('game and fixed 20-game runner explicitly use perimeter dispatch',()=>{
 for(const file of ['game.js','tools/balance-v2.mjs'])assert.match(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/npcSpawnMode:'perimeter'/);
});
