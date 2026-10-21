import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const scene=await import('../incident.mjs').catch(()=>null);
test('群眾每45秒加3人、最多15人，1.5m內推擠只影響玩家速度',()=>{
 assert.equal(typeof scene.crowdCount,'function');assert.equal(typeof scene.crowdSpeedFactor,'function');
 for(const [t,n] of [[0,6],[44.99,6],[45,9],[90,12],[135,15],[180,15]])assert.equal(scene.crowdCount(t),n);
 const s={people:Array.from({length:15},(_,i)=>({x:i*10,y:0}))};assert.equal(scene.crowdSpeedFactor(s,0,{x:1.5,y:0}),.6);assert.equal(scene.crowdSpeedFactor(s,0,{x:1.51,y:0}),1);assert.equal(scene.crowdSpeedFactor(s,0,{x:60,y:0}),1);assert.equal(scene.crowdSpeedFactor(s,45,{x:60,y:0}),.6);
});
test('指定圖集PNG尺寸與切格一致，僅載入原素材',()=>{assert.ok(scene);for(const [name,[w,h,rows,cols]] of Object.entries(scene.ART)){const png=readFileSync(new URL(`../art/${name}.png`,import.meta.url));assert.equal(png.readUInt32BE(16),w*cols,name+' width');assert.equal(png.readUInt32BE(20),h*rows,name+' height');}});
const site={x:0,y:0,building:{p:[-20,-15,20,-15,20,15,-20,15]}};
const roads=[{p:[-70,-32,70,-32],w:10},{p:[-36,-70,-36,70],w:8},{p:[36,-70,36,70],w:8},{p:[-70,32,70,32],w:10}];
test('火場佈置五台指定車輛在建物外8～25m，優先真道路且不改原幾何',()=>{
 assert.ok(scene,'缺少火場場景模型');const before=JSON.stringify({site,roads}),s=scene.createIncident({site,roads,canStand:(x,y)=>Math.abs(x)>20||Math.abs(y)>15});
 assert.deepEqual(s.vehicles.map(v=>v.kind).sort(),['ambulance','fire_engine','fire_engine','ladder_truck','police_car']);
 for(const v of s.vehicles){const d=Math.hypot(Math.max(0,Math.abs(v.x)-20),Math.max(0,Math.abs(v.y)-15));assert.ok(d>=8-1e-8&&d<=25+1e-8);assert.equal(v.onRoad,true);}
 assert.equal(s.people.length,15);assert.equal(s.fires.length,4);assert.equal(JSON.stringify({site,roads}),before);
});
