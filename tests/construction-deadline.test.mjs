import test from 'node:test';
import assert from 'node:assert/strict';
import {createRace} from '../race.mjs';

// Completion at deadline is excluded. The existing 1ns duration tolerance
// also defines numerical equality with the deadline, not a frame-sized grace.
const away={x:-999,y:0}, source={x:260,y:0};
const frames=[.03,.1,.016,.25,Infinity];
const cases=[
 {name:'1us before',offset:-1e-6,counts:true},
 {name:'2ns before',offset:-2e-9,counts:true},
 {name:'within 1ns equality band',offset:-.5e-9,counts:false},
 {name:'exact deadline',offset:0,counts:false},
 {name:'1us after',offset:1e-6,counts:false},
];
function run(actor,offset,step){
 let now=0;
 const start=174+offset,player=actor==='npc'?away:source;
 const race=createRace({sites:[{n:'演練火場',addr:'虛構',x:0,y:0}],
  water:[{n:'演練栓',k:'hydrant_above',...source}],
  stations:actor==='player'?[]:[source],roads:[{p:[0,0,600,0],w:10}],
  clock:()=>now,config:{npcCount:actor==='player'?0:1,npcDelaySeconds:start}});
 race.start();now=start*1000;
 let s=race.tick(0,player),time=start,firstClaimTime=null;
 const work=actor==='npc'?s.npcs[0].construction:s.construction;
 assert.equal(work.duration,6,'fixture must exercise six-second cap');
 assert.equal(work.hoses,13);
 const advance=t=>{const dt=t-time;time=t;now=t*1000;s=race.tick(dt,player);if(s.water[0].owner!==null&&firstClaimTime===null)firstClaimTime=time;};
 if(Number.isFinite(step))while(time+step<180)advance(time+step);
 advance(185); // Include a stalled frame crossing the deadline.
 return {race,s,firstClaimTime};
}
for(const actor of ['player','npc','tie'])for(const c of cases)for(const step of frames){
 test(`${actor}: ${c.name}, frame=${step}`,()=>{
  const {race,s,firstClaimTime}=run(actor,c.offset,step);
  const owner=c.counts?(actor==='npc'?'npc1':'player'):null;
  const detail=JSON.stringify({actor,offset:c.offset,step:String(step),firstClaimTime,actual:s.water[0].owner,expected:owner});
  assert.equal(s.water[0].owner,owner,detail);
  assert.equal(s.captured,owner==='player'?1:0,detail);
  assert.equal(s.totalHoses,owner==='player'?13:0,detail);
  assert.equal(s.status,'finished');
  assert.equal(s.construction,null);
  assert.ok(s.npcs.every(n=>n.construction===null));
  const events=race.drainEvents();
  assert.equal(events.filter(e=>e.type==='capture').length,owner==='player'?1:0,detail);
  assert.equal(events.filter(e=>e.type==='stolen').length,owner==='npc1'?1:0,detail);
  assert.equal(events.filter(e=>e.type==='finish').length,1);
 });
}
