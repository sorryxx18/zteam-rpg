import test from 'node:test';
import assert from 'node:assert/strict';
import {RULES,createRace} from '../race.mjs';
import {selectObjectives,waterLabel,missionCandidates} from '../missions.mjs';
test('v3 round lasts 180 seconds and other engines dispatch after 5 seconds',()=>{
 assert.equal(RULES.roundSeconds,180);assert.equal(RULES.npcDelaySeconds,5);assert.equal(RULES.npcSpeedRatio,1);
});
test('v3 chooses only the nearest 15 without changing the 300m boundary',()=>{
 const sources=Array.from({length:22},(_,i)=>({x:i,y:0}));assert.deepEqual(selectObjectives(sources,{x:0,y:0}),sources.slice(0,15));
});
test('v3 accepts only above and underground hydrants with distinct road labels',()=>{
 const site={n:'演練',addr:'虛構',x:0,y:0};
 for(const [k,label] of [['hydrant_above','地上消防栓'],['hydrant_under','地下消防栓']]){
  assert.match(waterLabel({x:0,y:0,k}),new RegExp(label+'$'));
  assert.doesNotThrow(()=>createRace({sites:[site],water:[{n:'演練',x:0,y:0,k}]}));
 }
 for(const k of ['hydrant','tank','pool','natural','other'])assert.throws(()=>createRace({sites:[site],water:[{n:'演練',x:0,y:0,k}]}));
});

test('ineligible missions are excluded before random selection within the same team',()=>{
 const sites=[{st:'金華分隊',x:0,y:0},{st:'金華分隊',x:1,y:0},{st:'信義分隊',x:0,y:0}];
 assert.deepEqual(missionCandidates(sites,{name:'金華分隊'},new Set([1,2])),[sites[1]]);
});

test('balance step B supplies two, three and four engines by difficulty',()=>{
 for(const [difficulty,count] of [['easy',2],['normal',3],['hard',4]]){
  const r=createRace({sites:[{n:'演練',addr:'虛構',x:0,y:0}],water:[{n:'演練栓',x:10,y:0,k:'hydrant_above'}],stations:[{x:0,y:0}],config:{difficulty}});assert.equal(r.start(0).npcs.length,count);
 }
});

test('balance C prioritizes a player-nearby hydrant only when the engine is closer',()=>{
 for(const [x,target] of [[120,1],[105,0]]){
  const r=createRace({sites:[{n:'演練',addr:'虛構',x:0,y:0}],water:[{n:'近車',x:100,y:0,k:'hydrant_above'},{n:'近人',x:140,y:0,k:'hydrant_under'}],stations:[{x,y:0}],roads:[{w:8,p:[80,0,200,0]}],clock:()=>0,config:{npcCount:1,npcDelaySeconds:0}});r.start(0);assert.equal(r.tick(0,{x:170,y:0}).npcs[0].target,target);
 }
});

test('balance D holds the engine for exactly three seconds after claiming',()=>{
 let now=0;const r=createRace({sites:[{n:'演練',addr:'虛構',x:0,y:0}],water:[{n:'演練栓',x:0,y:0,k:'hydrant_above'}],stations:[{x:0,y:0}],roads:[{p:[-20,0,20,0],w:8}],clock:()=>now,config:{npcCount:1,npcDelaySeconds:0}});r.start();r.tick(0,{x:100,y:100});now=500;const s=r.tick(.5,{x:100,y:100});assert.equal(s.water[0].owner,'npc1');assert.equal(s.npcs[0].cooldownRemaining,3);
});

test('hydrant labels distinguish road junction above and roadside underground',()=>{
 const roads=[{n:'演練路',p:[-1,0,1,0]}];assert.equal(waterLabel({x:0,y:0,k:'hydrant_above'},roads),'演練路口地上消防栓');assert.equal(waterLabel({x:0,y:0,k:'hydrant_under'},roads),'演練路旁地下消防栓');
});
