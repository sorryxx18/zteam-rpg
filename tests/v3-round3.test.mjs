import test from 'node:test';
import assert from 'node:assert/strict';
import * as race from '../race.mjs';
import * as ui from '../ui.mjs';
test('消防栓名稱僅30m內最近兩個，框重疊只保留較近的',()=>{
 assert.equal(typeof ui.selectHydrantLabels,'function');
 const near={name:'近',distance:5,x:100,y:100,width:100,height:16},overlap={...near,name:'疊',distance:6,x:110},other={...near,name:'第三',distance:7,x:300},far={...near,name:'遠',distance:31,x:500};
 assert.deepEqual(ui.selectHydrantLabels([far,other,overlap,near]).map(q=>q.name),['近']);
 assert.deepEqual(ui.selectHydrantLabels([far,other,near]).map(q=>q.name),['近','第三']);
 assert.equal(ui.selectHydrantLabels([{...far,distance:30}]).length,1);assert.equal(ui.selectHydrantLabels([far]).length,0);
});
test('出生依30、45、60m順序換角度，保持原碰撞規則',()=>{
 assert.equal(typeof race.findPlayerSpawn,'function');
 for(const radius of [30,45,60]){const p=race.findPlayerSpawn({x:0,y:0},(x,y)=>Math.abs(Math.hypot(x,y)-radius)<1e-8&&x<0);assert.ok(p);assert.ok(p.x<0);assert.ok(Math.abs(Math.hypot(p.x,p.y)-radius)<1e-8);}
 assert.equal(race.findPlayerSpawn({x:0,y:0},()=>false),null);
});
