import test from 'node:test';
import assert from 'node:assert/strict';
import * as incident from '../incident.mjs';
import {readFile} from 'node:fs/promises';

test('人群保留15人，斜路及朝向道路的徑向位置都不讓上半身疊在一起',()=>{
 for(const [dx,dy] of [[1,0],[0,1],[Math.SQRT1_2,Math.SQRT1_2]]){
  const scene=incident.createIncident({site:{x:0,y:0},roads:[{p:[-100*dx+22*dy,-100*dy-22*dx,100*dx+22*dy,100*dy-22*dx]}]});
  assert.equal(scene.people.length,15);
  for(let i=0;i<scene.people.length;i++)for(let j=0;j<i;j++){
   const a=scene.people[i],b=scene.people[j];
   assert.ok(Math.abs(a.x-b.x)>=8-1e-8||Math.abs(a.y-b.y)>=8-1e-8,`上半身重疊: ${JSON.stringify([a,b])}`);
  }
 }
});

test('人群畫面高度隨地圖縮放且不放大超過48px',()=>{
 assert.equal(typeof incident.crowdSpriteHeight,'function');
 for(const ratio of [.5,1,2])for(const scale of [1,2,5,10]){
  const h=incident.crowdSpriteHeight(scale,ratio);
  assert.ok(h<=48*ratio);assert.ok(h/scale<=10);
 }
});

test('人群依前後站位繪製，保留原本速度與人數成長規則',async()=>{
 const game=await readFile(new URL('../game.js',import.meta.url),'utf8');
 assert.match(game,/\.sort\(\(a,b\)=>b\.y-a\.y\)/);
 assert.match(game,/crowdSpriteHeight\(scale,ratio\)/);
 assert.deepEqual([0,45,90,135,210].map(incident.crowdCount),[6,9,12,15,15]);
 assert.equal(incident.crowdSpeedFactor({people:[{x:0,y:0}]},0,{x:0,y:0}),.6);
});
