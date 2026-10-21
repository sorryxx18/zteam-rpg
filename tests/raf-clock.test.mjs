import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createNoticeQueue} from '../ui.mjs';
import {createRace,competition} from '../race.mjs';

test('開局期間performance比RAF時間戳稍晚，下一幀仍不可產生負dt並中斷動畫',async()=>{
 const source=await fs.readFile(new URL('../game.js',import.meta.url),'utf8');
 const start=source.indexOf('function tickRace(dt){'),end=source.indexOf('const movementKeys=',start);
 assert.ok(start>=0&&end>start);
 let wall=2050;const deltas=[],frames=[];
 const element={hidden:false,textContent:''},performance={now:()=>wall};
 const race=createRace({sites:[{n:'測試場所',addr:'測試地址',x:0,y:0}],water:[{k:'hydrant_above',n:'測試水源',x:100,y:0}],roads:[{p:[0,0,100,0]}],clock:performance.now});
 const context=vm.createContext({commanderDialogue:null,phase:'intro',introAt:0,previous:1990,race,siteIndex:0,performance,testRate:1,competition,notices:createNoticeQueue(),x:0,y:0,ready:false,nearbyKey:'',tense:false,$:()=>element,cellKey:()=>'',clearInput(){},message(){},musicAction(){},finishRound(){},update:dt=>deltas.push(dt),renderScene(){},requestAnimationFrame:fn=>frames.push(fn)});
 vm.runInContext(source.slice(start,end),context);
 vm.runInContext('loop(2000)',context);
 wall=2066;
 assert.doesNotThrow(()=>vm.runInContext('loop(2016)',context));
 assert.ok(deltas.every(dt=>dt>=0),'只用連續RAF時間戳計算dt');
 assert.equal(frames.length,2,'每一幀均繼續排程');
 assert.equal(race.getState().status,'playing');
});
