import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommanderDialogue,commanderBubbleLines} from '../commander.mjs';
import {createIncident} from '../incident.mjs';
test('指揮官站真道路、距建物10～15m、在封鎖線內側且不壓消防栓',()=>{
 const site={x:0,y:0,building:{p:[-10,-10,10,-10,10,10,-10,10]}},water=[{x:-80,y:-22}],roads=[{p:[-100,-22,100,-22],w:8}],scene=createIncident({site,roads,water,canStand:()=>true}),q=scene.commander;
 assert.ok(q);assert.ok(Math.abs(q.y+22)<1e-8);const gap=Math.max(Math.abs(q.x)-10,Math.abs(q.y)-10);assert.ok(gap>=10&&gap<=15);assert.ok(water.every(w=>Math.hypot(w.x-q.x,w.y-q.y)>=5));const mid={x:(scene.cordon.a.x+scene.cordon.b.x)/2,y:(scene.cordon.a.y+scene.cordon.b.y)/2};assert.ok(Math.hypot(q.x,q.y)<Math.hypot(mid.x,mid.y));
});
const frame=(seconds,extra={})=>({seconds,player:{x:seconds,y:0},water:[],construction:null,npcActive:false,events:[],...extra});
test('每句4秒、空1秒，事件排在一般輪播前；不動輸入資料',()=>{
 const d=createCommanderDialogue('測試場所');const s=frame(0),before=structuredClone(s);assert.match(d.update(s),/各車注意/);assert.deepEqual(s,before);assert.equal(d.text(3.999).length>0,true);assert.equal(d.text(4),'');assert.equal(d.text(4.999),'');assert.match(d.update(frame(5,{npcActive:true})),/友隊到場/);assert.equal(d.text(9),'');assert.match(d.update(frame(10)),/水源就是生命線/);
});
test('事件涵蓋佔領、連擊、截胡、被搶、新波及最後30秒',()=>{
 for(const [event,pattern] of [[{type:'capture',waterName:'和平東路口地上消防栓'},/和平東路那支拿下/],[{type:'capture',combo:3},/連續佈線 3 支/],[{type:'capture',interceptBonus:1},/截胡成功/],[{type:'stolen',waterName:'富陽街旁地下消防栓'},/富陽街那支被搶/],[{type:'wave'},/增援範圍擴大/]]){const d=createCommanderDialogue('場所');d.update(frame(0));assert.match(d.update(frame(5,{events:[event]})),pattern);}
 const d=createCommanderDialogue('場所');d.update(frame(0));assert.match(d.update(frame(150)),/剩 30 秒/);
});
test('8秒閒置只在沒佈線時碎念，同句30秒與碎念10秒冷卻',()=>{
 const d=createCommanderDialogue('場所');d.update(frame(0,{player:{x:0,y:0}}));d.update(frame(8,{player:{x:0,y:0}}));assert.match(d.text(8),/看風景/);d.enqueue('cancel',9);assert.equal(d.text(12),'');const t=d.update(frame(13,{player:{x:0,y:0}}));assert.doesNotMatch(t,/拉一半/);d.enqueue('cancel',19);assert.match(d.update(frame(19)),/拉一半/);d.enqueue('cancel',30);assert.doesNotMatch(d.update(frame(30)),/拉一半/);
 const c=createCommanderDialogue('場所');c.update(frame(0));assert.doesNotMatch(c.update(frame(8,{player:{x:0,y:0},construction:{waterId:1}})),/看風景/);
});
test('一般每三句插碎念，連兩支被搶及走過5m沒停也會提醒',()=>{
 const d=createCommanderDialogue('場所');for(const t of [0,5,10,15])d.update(frame(t));assert.match(d.update(frame(20)),/動作快/);
 const c=createCommanderDialogue('場所');c.update(frame(0));c.update(frame(5,{events:[{type:'stolen',waterName:'甲'},{type:'stolen',waterName:'乙'}]}));assert.match(c.text(5),/又被搶|幹嘛/);
 const p=createCommanderDialogue('場所');p.update(frame(0));p.update(frame(1,{water:[{id:1,x:3,y:0,owner:null}]}));assert.match(p.update(frame(6,{player:{x:10,y:0},water:[{id:1,x:3,y:0,owner:null}]})),/就在你腳邊/);
});
test('手機氣泡每行最多14字，最多兩行，長場所不溢出',()=>{
 const lines=commanderBubbleLines('各車注意！火警地點 超級長場所名稱'.repeat(5));assert.equal(lines.length,2);assert.ok(lines.every(s=>[...s].length<=14));assert.ok(lines[1].endsWith('…'));
});
