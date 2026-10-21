import test from 'node:test';
import assert from 'node:assert/strict';
import {createRace} from '../race.mjs';
for(const gap of [6.5,6.6,6.68])test(`NPC uses the actual inclusive 3m entry at gap ${gap}, without demanding extra curb depth`,()=>{
 let now=0;const r=createRace({sites:[{n:'演練',addr:'測試',x:0,y:0}],water:[{n:'水源',k:'hydrant',x:40,y:gap}],stations:[{x:0,y:0}],roads:[{w:8,p:[0,0,100,0]}],clock:()=>now,config:{npcCount:1,npcDelaySeconds:0}});
 r.start();let s=r.tick(0,{x:-999,y:0});assert.equal(s.npcs[0].target,0);
 const end=s.npcs[0].route.at(-1);assert.ok(Math.hypot(end.x-40,end.y-gap)<=3+1e-10);assert.ok(end.y+.32<=4+1e-10);
 now=4990;s=r.tick(4.99,{x:-999,y:0});assert.equal(s.npcs[0].construction,null);assert.equal(s.water[0].owner,null);
 now=20000;s=r.tick(15.01,{x:-999,y:0});assert.equal(s.water[0].owner,'npc1');assert.ok(s.npcs[0].y+.32<=4+1e-10);assert.ok(Math.hypot(s.npcs[0].x-40,s.npcs[0].y-gap)<=3+1e-8);
});
