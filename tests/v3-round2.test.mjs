import test from 'node:test';
import assert from 'node:assert/strict';
import {RULES,createRace} from '../race.mjs';
import * as incident from '../incident.mjs';
import * as ui from '../ui.mjs';
test('第二輪車身有效長度依人物高度，不隨世界縮放；停車與五車都用相同比例且錯開',()=>{
 assert.equal(typeof incident.vehicleDisplayDimensions,'function');assert.equal(typeof ui.layoutVehicleSprites,'function');
 for(const height of [48,64,96])for(const [kind,ratio]of Object.entries({fire_engine:1.3,ladder_truck:1.6,ambulance:1.1,police_car:1}))for(let row=0;row<incident.ART[kind][3];row++)assert.ok(Math.abs(incident.vehicleDisplayDimensions(kind,row,height).length-height*ratio)<1e-9);
 const vehicles=['fire_engine','fire_engine','ladder_truck','ambulance','police_car','fire_engine'].map(kind=>({kind,x:100,y:100,...incident.vehicleDisplayDimensions(kind,0,64)})),obstacles=[{x:100,y:100,width:34,height:52,length:0}];
 const placed=ui.layoutVehicleSprites(vehicles,obstacles);assert.equal(placed.length,6);assert.deepEqual(vehicles.map(v=>[v.x,v.y]),Array(6).fill([100,100]));
 for(let i=0;i<placed.length;i++)for(const b of [...placed.slice(i+1),...obstacles]){const a=placed[i],gap=Math.max(a.length,b.length)/2;assert.ok(Math.abs(a.x-b.x)>=(a.width+b.width)/2+gap-1e-7||Math.abs(a.y-b.y)>=(a.height+b.height)/2+gap-1e-7);}
 const shifted=ui.layoutVehicleSprites(vehicles.map(v=>({...v,x:v.x+17,y:v.y-33})),obstacles.map(v=>({...v,x:v.x+17,y:v.y-33})));placed.forEach((v,i)=>{assert.ok(Math.abs(shifted[i].x-v.x-17)<1e-7);assert.ok(Math.abs(shifted[i].y-v.y+33)<1e-7);});
});
test('第二輪只降低NPC速度至玩家跑速0.9倍，5秒出動與其他規則不變',()=>{
 assert.deepEqual(RULES,{roundSeconds:210,npcDelaySeconds:5,npcStaggerSeconds:5,spawnMode:'near-site',npcSpawnMode:'nearest-station',spawnDistance:30,targetRadius:500,captureRadius:3,difficulty:'normal',npcCount:3,runSpeed:6,npcSpeedRatio:.9});
 let now=0;const race=createRace({sites:[{x:0,y:0,n:'火場',addr:'測試地址'}],roads:[{p:[-50,0,500,0],w:8}],water:[{x:200,y:0,k:'hydrant_above',n:'測試栓'}],stations:[{x:0,y:0}],clock:()=>now,config:{npcCount:1}});race.start(0);now=5000;race.tick(5,{x:-40,y:0});const a=race.getState().npcs[0];assert.equal(a.active,true);now=6000;race.tick(1,{x:-40,y:0});const b=race.getState().npcs[0];assert.ok(Math.abs(Math.hypot(b.x-a.x,b.y-a.y)-RULES.runSpeed*RULES.npcSpeedRatio)<1e-7);
});
