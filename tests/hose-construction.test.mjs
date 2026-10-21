import test from 'node:test';
import assert from 'node:assert/strict';
import {createRace,RULES} from '../race.mjs';
const away={x:-999,y:0};
function setup({x=100,config={},stations=[],water,roads}={}){
 let now=0;const race=createRace({sites:[{n:'火場',addr:'測試',x:0,y:0}],water:water??[{n:'水源',k:'hydrant_above',x,y:0}],stations,roads:roads??[{p:[0,0,600,0]}],clock:()=>now,config:{npcCount:0,...config}});
 race.start();return {race,at:(time,player=away,dt)=>{const delta=time-now/1000;now=time*1000;return race.tick(dt??delta,player);}};
}
test('cancel discards progress and blocks same source until leaving 3m; duration alone caps at six',()=>{
 const {race,at}=setup({x:260});let s=at(0,{x:260,y:0});assert.equal(s.construction.hoses,13);assert.equal(s.construction.duration,6);assert.ok(Object.isFrozen(s.construction));
 at(2,{x:260,y:0});s=race.cancelConstruction();assert.equal(s.construction,null);assert.equal(s.totalHoses,0);assert.equal(at(3,{x:260,y:0}).construction,null);
 at(4,{x:263.01,y:0});assert.equal(at(5,{x:260,y:0}).construction.elapsed,0);s=at(11,{x:260,y:0});assert.equal(s.captured,1);assert.equal(s.totalHoses,13);
 race.start();assert.equal(race.getState().totalHoses,0);assert.equal(race.getState().construction,null);
 const zero=setup({x:0});assert.equal(zero.at(0,{x:0,y:0}).construction.hoses,1);
});
for(const step of [.1,.25,50])test(`NPC arrival consumes travel before construction, three second cooldown; dt=${step}`,()=>{
 const {at}=setup({x:100,stations:[{x:0,y:0}],config:{npcCount:1},water:[{n:'甲',k:'hydrant_above',x:100,y:0},{n:'乙',k:'hydrant_under',x:200,y:0}]});
 const speed=10*RULES.npcSpeedRatio,arrival=10+97/speed;
 let t=0;while(t+step<arrival-.125){t+=step;at(t);}let s=at(arrival-.125);assert.ok(Math.abs(s.npcs[0].x-(97-.125*speed))<1e-8);assert.equal(s.npcs[0].construction,null);
 s=at(arrival+.125);assert.equal(s.water[0].owner,null);assert.ok(Math.abs(s.npcs[0].construction.elapsed-.125)<1e-8);
 s=at(arrival+2.5);assert.equal(s.water[0].owner,'npc1');assert.ok(Math.abs(s.npcs[0].cooldownRemaining-3)<1e-8);const x=s.npcs[0].x;
 s=at(arrival+5.499);assert.equal(s.npcs[0].x,x);assert.ok(s.npcs[0].cooldownRemaining>0);s=at(arrival+5.75);assert.ok(Math.abs(s.npcs[0].x-x-.25*speed)<1e-8);
});
test('earlier NPC completion wins even when player is processed in the same long frame; contested and loser clear',()=>{
 const {race,at}=setup({x:100,stations:[{x:100,y:0}],config:{npcCount:1,npcDelaySeconds:0}});
 at(0);let s=at(.25,{x:100,y:0});assert.equal(s.construction.contested,true);assert.equal(s.npcs[0].construction.contested,true);
 s=at(3,{x:100,y:0});assert.equal(s.water[0].owner,'npc1');assert.equal(s.captured,0);assert.equal(s.totalHoses,0);assert.equal(s.construction,null);assert.equal(s.npcs[0].construction,null);assert.equal(race.cancelConstruction().totalHoses,0);
});
test('difficulty maps easy/normal/hard to 2/3/4 NPCs, explicit count overrides, all dispatch no earlier than 10s',()=>{
 for(const [difficulty,count] of [['easy',2],['normal',3],['hard',4]]){
  const {race,at}=setup({stations:[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}],config:{difficulty,npcCount:undefined}});let s=race.getState();assert.equal(s.difficulty,difficulty);assert.equal(s.npcs.length,count);
  assert.ok(at(9.9).npcs.every(n=>!n.active&&n.x===0));assert.ok(at(10).npcs.every(n=>n.active&&n.x===0));assert.ok(Math.abs(at(11).npcs[0].x-10*RULES.npcSpeedRatio)<1e-8);
 }
 const override=setup({stations:[{x:0,y:0}],config:{difficulty:'hard',npcCount:1}});assert.equal(override.race.getState().npcs.length,1);
 assert.throws(()=>setup({config:{difficulty:'bogus'}}),/難度|規則/);
});
test('deadline counts only completions strictly before round end, including long frame crossing deadline',()=>{
 for(const start of [177.49,177.5,179]){const {race,at}=setup();at(start,{x:100,y:0});const s=at(185,{x:100,y:0});assert.equal(s.captured,start===177.49?1:0);assert.equal(s.totalHoses,start===177.49?5:0);assert.equal(s.status,'finished');assert.equal(s.construction,null);assert.deepEqual(at(186,{x:100,y:0}),s);assert.equal(race.drainEvents().filter(e=>e.type==='finish').length,1);}
});
test('cancel immediately removes contested from opponent, and invalid position discards progress',()=>{
 const {race,at}=setup({stations:[{x:100,y:0}],config:{npcCount:1,npcDelaySeconds:0}});at(0,{x:100,y:0});assert.equal(race.getState().construction.contested,true);const s=race.cancelConstruction();assert.equal(s.npcs[0].construction.contested,false);
 const other=setup();other.at(0,{x:100,y:0});assert.equal(other.at(1,away).construction,null);assert.equal(other.at(2,{x:100,y:0}).construction.elapsed,0);
});
test('player starts at inclusive 3m, never credits time before arrival, then finishes five hoses in 2.5 seconds',()=>{
 const {race,at}=setup();assert.equal(at(10,{x:96.99,y:0}).construction,null);
 let s=at(20,{x:97,y:0});assert.deepEqual(s.construction,{waterId:0,hoses:5,duration:2.5,elapsed:0,contested:false});assert.equal(s.captured,0);
 s=at(22.25,{x:97,y:0});assert.ok(Math.abs(s.construction.elapsed-2.25)<1e-8);assert.equal(s.totalHoses,0);
 s=at(22.5,{x:97,y:0});assert.equal(s.captured,1);assert.equal(s.totalHoses,5);assert.equal(s.construction,null);assert.ok(Object.isFrozen(s.water[0]));
 assert.equal(race.drainEvents().filter(e=>e.type==='capture').length,1);
});
