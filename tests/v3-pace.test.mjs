import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RULES} from '../race.mjs';
import {walkToward,checkModelReady} from '../tools/balance-v2.mjs';
test('v3.2 固定20局工具以實際跑速與回合長度計算，目標8至11',()=>{
 assert.equal(RULES.roundSeconds,210);const next=walkToward({x:0,y:0},{x:100,y:0},.2,()=>true);assert.ok(Math.abs(next.x-RULES.runSpeed*.2)<1e-8);
 const source=fs.readFileSync(new URL('../tools/balance-v2.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/maxSpeed=10|tick<=3600|clockSeconds:180|walkSpeed:5,runSpeed:10/);assert.match(source,/low:8,high:11/);assert.equal(checkModelReady().ready,true);
});
test('v3.1 公開消防栓資料4644支，地上536地下4108',()=>{
 const root=new URL('../data/w/',import.meta.url),keys=JSON.parse(fs.readFileSync(new URL('index.json',root)));assert.equal(keys.length,177);const rows=keys.flatMap(k=>JSON.parse(fs.readFileSync(new URL(k+'.json',root))));assert.equal(rows.length,4644);assert.equal(rows.filter(r=>r[2]==='hydrant_above').length,536);assert.equal(rows.filter(r=>r[2]==='hydrant_under').length,4108);
});
