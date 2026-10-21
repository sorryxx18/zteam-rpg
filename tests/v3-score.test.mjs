import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../race.mjs';
function fixture(config={},stationX=30){
 let now=0;const race=model.createRace({sites:[{n:'測試場所',addr:'測試路',x:0,y:0}],water:[0,5,10,15].map(x=>({n:'測試消防栓'+x,k:'hydrant_above',x,y:0})),stations:[{x:stationX,y:0}],roads:[{p:[-100,0,100,0],w:8}],clock:()=>now*1000,config:{npcCount:0,...config}});race.start(0);
 return {race,setTime:t=>now=t,claim(index,time){const w=race.getState().water[index];now=time-.5;race.tick(0,w);now=time;race.tick(.5,w);return race.drainEvents().find(e=>e.type==='capture');}};
}
test('v3 星等只看實際佔領比例，最高總分依難度保存且儲存失敗不擋結算',()=>{
 assert.equal(typeof model.roundStars,'function');assert.deepEqual([model.roundStars(0,10),model.roundStars(2,10),model.roundStars(3,10),model.roundStars(5,10),model.roundStars(6,10),model.roundStars(9,15),model.roundStars(0,0)],[1,1,2,2,3,3,1]);const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};assert.equal(model.rememberHighScore(storage,'normal',8),8);assert.equal(model.rememberHighScore(storage,'normal',3),8);assert.equal(model.rememberHighScore(storage,'easy',4),4);assert.equal(model.rememberHighScore(storage,'hard',2),2);assert.equal(data.size,3);assert.equal(model.rememberHighScore({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},'normal',7),7);
});
test('v3 取消及重複觀測不加分，30m外車輛不算截胡',()=>{
 const h=fixture();const w=h.race.getState().water[0];h.race.tick(0,w);h.race.cancelConstruction();h.setTime(5);h.race.tick(5,w);assert.equal(h.race.getState().score,0);assert.equal(h.race.getState().totalHoses,0);const once=fixture();once.claim(0,.5);once.setTime(1.5);once.race.tick(1,once.race.getState().water[0]);assert.equal(once.race.getState().score,1);const far=fixture({npcCount:1,npcDelaySeconds:0,npcSpeedRatio:0},30.001);assert.equal(far.claim(0,.5).interceptBonus,0);
});
test('v3 成功佔領才加基本分，事件保留真正完工秒數',()=>{
 const h=fixture();const e=h.claim(0,.5),s=h.race.getState();assert.equal(s.score,1);assert.equal(s.combo,1);assert.equal(e.timeSeconds,.5);assert.equal(e.comboBonus,0);assert.equal(e.interceptBonus,0);assert.equal(s.score,s.captured);
});
test('v3 截胡以已出動消防車30m為界，可與連擊同次疊加',()=>{
 const h=fixture({npcCount:1,npcDelaySeconds:0,npcSpeedRatio:0});const first=h.claim(0,.5),second=h.claim(1,1.5);assert.equal(first.interceptBonus,1);assert.equal(second.interceptBonus,1);assert.equal(second.comboBonus,1);assert.equal(h.race.getState().score,5);assert.equal(h.race.getState().interceptBonus,2);const inactive=fixture({npcCount:1,npcDelaySeconds:10,npcSpeedRatio:0});assert.equal(inactive.claim(0,.5).interceptBonus,0);
});
test('v3 連擊以完工時間刷新15秒，第二次起額外1分，逾期重置',()=>{
 const h=fixture();const events=[h.claim(0,.5),h.claim(1,15.5),h.claim(2,30.6),h.claim(3,45.6)];assert.deepEqual(events.map(e=>e.combo),[1,2,1,2]);assert.deepEqual(events.map(e=>e.comboBonus),[0,1,0,1]);const s=h.race.getState();assert.equal(s.captured,4);assert.equal(s.score,6);assert.equal(s.comboBonus,2);h.setTime(61);h.race.tick(0,null);assert.equal(h.race.getState().combo,0);
});
