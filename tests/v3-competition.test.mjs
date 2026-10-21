import test from 'node:test';
import assert from 'node:assert/strict';
import * as race from '../race.mjs';
for(const [owners,outcome,label] of [[['player','npc1','npc2',null],'loss','被搶光了…'],[['player','npc1',null],'draw','平手'],[[null,null],'draw','平手']])test(`對戰${outcome}：${owners.join('/')}`,()=>{const r=race.competition(owners.map(owner=>({owner})));assert.equal(r.outcome,outcome);assert.equal(r.label,label);assert.equal(r.player+r.npc+r.unclaimed,owners.length);});
test('分難度戰績累加與重新讀取；壞資料或儲存失敗不擋遊戲',()=>{
 assert.equal(typeof race.rememberRecord,'function');const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 assert.deepEqual(race.rememberRecord(storage,'normal','win'),{win:1,loss:0,draw:0});assert.deepEqual(race.rememberRecord(storage,'normal','loss'),{win:1,loss:1,draw:0});assert.deepEqual(race.rememberRecord(storage,'normal','draw'),{win:1,loss:1,draw:1});assert.deepEqual(race.rememberRecord(storage,'easy','draw'),{win:0,loss:0,draw:1});assert.deepEqual(race.rememberRecord(storage,'hard','loss'),{win:0,loss:1,draw:0});
 data.set('zteam-rpg-record-normal','broken');assert.deepEqual(race.rememberRecord(storage,'normal','win'),{win:1,loss:0,draw:0});data.set('zteam-rpg-record-normal',JSON.stringify({win:-1,loss:'4',draw:3}));assert.deepEqual(race.rememberRecord(storage,'normal','win'),{win:1,loss:0,draw:3});
 assert.deepEqual(race.rememberRecord({getItem(){throw Error('denied');},setItem(){throw Error('quota');}},'normal','win'),{win:1,loss:0,draw:0});assert.deepEqual(race.rememberRecord(undefined,'normal','loss'),{win:0,loss:1,draw:0});
});
test('對戰合計所有消防車的佔領顆數，不把加分當顆數',()=>{
 assert.equal(typeof race.competition,'function');
 const r=race.competition([{owner:'player'},{owner:'player'},{owner:'npc1'},{owner:null}]);
 assert.deepEqual(r,{player:2,npc:1,unclaimed:1,outcome:'win',label:'勝利！'});
});
