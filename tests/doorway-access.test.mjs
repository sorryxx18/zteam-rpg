import test from 'node:test';
import assert from 'node:assert/strict';
import * as missions from '../missions.mjs';
import {circleIntersectsPoly} from '../core.mjs';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const legal=(point,buildings,radius=.32)=>buildings.every(b=>!circleIntersectsPoly(point.x,point.y,radius,b.p));
const rect=(x,y,w,h)=>({p:[x,y,x+w,y,x+w,y+h,x,y+h]});
const resolve=(...args)=>{
  assert.equal(typeof missions.resolveDoorwayAccess,'function','doorway helper must be exported');
  return missions.resolveDoorwayAccess(...args);
};

test('standable doorway retains original sensing position without mutating input',()=>{
  const source=Object.freeze({x:10,y:11,k:'hydrant'});
  const buildings=Object.freeze([Object.freeze({p:Object.freeze([0,0,5,0,5,5,0,5])})]);
  assert.deepEqual(resolve(source,buildings),{x:10,y:11,adjusted:false});
});

test('blocked rectangular doorway derives nearest sampled boundary access with safety margin',()=>{
  const source={x:5,y:5,k:'tank'}, buildings=[rect(0,0,10,10)];
  const before=JSON.stringify({source,buildings});
  const access=resolve(source,buildings);
  assert.equal(access.adjusted,true);
  assert.ok(legal(access,buildings,.37-1e-8));
  assert.ok(Math.abs(Math.hypot(access.x-5,access.y-5)-5.37)<1e-8);
  assert.equal(JSON.stringify({source,buildings}),before);
  assert.deepEqual(resolve(source,buildings),access);
});

test('boundary and blocked center with a legal point within 3m retain sensing coordinates, not standability',()=>{
  const buildings=[rect(0,0,10,10)];
  for(const source of [{x:0,y:5},{x:2,y:5},{x:2.679,y:5}]){
    assert.equal(legal(source,buildings),false);
    assert.deepEqual(resolve(source,buildings),{...source,adjusted:false});
    assert.equal(legal({x:-.32000001,y:5},buildings),true);
  }
});

test('concave and adjacent buildings validate access against every polygon in either winding',()=>{
  const concave={p:[0,0,20,0,20,20,12,20,12,8,8,8,8,20,0,20]};
  for(const buildings of [[concave],[rect(0,0,10,10),rect(-3,-3,3,16),rect(10,-3,3,16)]]){
    const source={x:5,y:5};
    const access=resolve(source,buildings);
    assert.equal(access.adjusted,true);
    assert.ok(legal(access,buildings,.37-1e-8));
    const reversed=buildings.map(b=>({p:Array.from({length:b.p.length/2},(_,i)=>b.p.slice(i*2,i*2+2)).reverse().flat()}));
    assert.ok(legal(resolve(source,reversed),reversed,.37-1e-8));
  }
});

test('custom collision radius and invalid geometry fail safely without discarding source',()=>{
  const buildings=[rect(0,0,10,10)];
  assert.ok(legal(resolve({x:5,y:5},buildings,{radius:1}),buildings,1.05-1e-8));
  for(const [source,b,radius] of [[{x:NaN,y:0},[],.32],[{x:0,y:0},buildings,-1],[{x:0,y:0},[{p:[0,0,1]}],.32]]){
    assert.equal(resolve(source,b,{radius}),null);
  }
});

// 依賴本機 .qa 稽核檔（不進版控）；CI 或乾淨副本沒有就略過
const hasQa=fs.existsSync(new URL('../.qa/v2-geometry-audit.json',import.meta.url))&&fs.existsSync(new URL('../.qa/v2-balance-samples.json',import.meta.url));
test('unchanged fixed 20 missions preserve all targets; original 12 warnings obtain safe standpoints',{skip:!hasQa&&'需要本機 .qa 稽核檔'},()=>{
  const root=new URL('../',import.meta.url);
  const hashes={};
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const read=path=>{
    const bytes=fs.readFileSync(new URL(path,root));hashes[path]=sha(bytes);
    return JSON.parse(bytes);
  };
  const audit=read('.qa/v2-geometry-audit.json');
  const fixed=read('.qa/v2-balance-samples.json');
  const buildings=[],seen=new Set();
  for(const file of fs.readdirSync(new URL('data/c/',root)).filter(f=>f.endsWith('.json')).sort()){
    for(const building of read('data/c/'+file).builds){
      const key=JSON.stringify(building.p);
      if(!seen.has(key)){seen.add(key);buildings.push(building);}
    }
  }
  assert.equal(buildings.length,27464);
  const water=read('data/w/index.json').slice().sort().flatMap(key=>
    read('data/w/'+key+'.json').map(([x,y,k],index)=>({x,y,k,id:`${key}:${index}`})));
  const before=sha(JSON.stringify({water,buildings}));
  const boxes=buildings.map(b=>({b,minX:Math.min(...b.p.filter((_,i)=>i%2===0)),
    maxX:Math.max(...b.p.filter((_,i)=>i%2===0)),minY:Math.min(...b.p.filter((_,i)=>i%2)),maxY:Math.max(...b.p.filter((_,i)=>i%2))}));
  const canStand=(point)=>!boxes.some(({b,minX,minY,maxX,maxY})=>point.x+.32>=minX&&point.x-.32<=maxX&&point.y+.32>=minY&&point.y-.32<=maxY&&circleIntersectsPoly(point.x,point.y,.32,b.p));
  const results=[],warnings=[];
  for(const sample of audit.results){
    assert.equal(fixed.samples.find(s=>s.sample===sample.sample).siteIndex,sample.siteIndex);
    const selected=missions.selectObjectives(water,sample.fire);
    assert.deepEqual(selected.map(s=>s.id),sample.targets.map(t=>`${t.ref.cell}:${t.ref.index}`));
    const targets=[];
    for(const [i,source] of selected.entries()){
      const access=resolve(source,buildings);
      assert.ok(access,`sample ${sample.sample} ${source.id}: null is an unresolved QA result, never delete source`);
      let standpoint=canStand(access)?{x:access.x,y:access.y}:null;
      if(!standpoint&&!access.adjusted){
        for(let k=0;k<72;k++){
          const a=k*Math.PI/36,point={x:source.x+3*Math.cos(a),y:source.y+3*Math.sin(a)};
          if(canStand(point)){standpoint=point;break;}
        }
      }
      assert.ok(standpoint,`sample ${sample.sample} ${source.id} must have a real collision-free witness`);
      assert.ok(legal(standpoint,buildings));
      if(!access.adjusted)assert.ok(Math.hypot(standpoint.x-source.x,standpoint.y-source.y)<=3+1e-9);
      const record={id:source.id,source:{x:source.x,y:source.y},access,
        distance:Math.hypot(access.x-source.x,access.y-source.y),standpoint,
        standpointDistance:Math.hypot(standpoint.x-source.x,standpoint.y-source.y),collisionFree:true};
      targets.push(record);
      if(!sample.targets[i].within3mSampleStandable){
        assert.equal(access.adjusted,true);
        warnings.push({sample:sample.sample,...record});
      }
    }
    results.push({sample:sample.sample,siteIndex:sample.siteIndex,targetCount:targets.length,targets});
  }
  assert.equal(warnings.length,12);
  assert.equal(results.length,20);
  assert.equal(sha(JSON.stringify({water,buildings})),before,'inputs must remain unchanged');
  for(const path of ['missions.mjs','core.mjs','tests/doorway-access.test.mjs']){
    hashes[path]=sha(fs.readFileSync(new URL(path,root)));
  }
  const report={verdict:'PASS_PURE_HELPER_FIXED_SAMPLE_ONLY',
    semantics:'授權定位點是門口；底圖重疊不是室內水源證據。source 是計距 SOT，access 只供未來玩家/NPC共同互動，尚未接線。',
    method:{radius:.32,safetyMargin:.05,interactionRadius:3,
      candidates:'每邊投影雙法線、頂點72方向；外偏 radius+1e-7 及 (radius+.05)*[1,2,4,8]；只選通過全部建物碰撞檢查者，無大半徑格網。',
      unchanged:'adjusted:false 可表示原點不可站，但3m內有合法感應站位；不宣稱原點可站。',
      nullFallback:'保留原 source 與題目，標記未解決並阻擋整合/交由QA；不得刪水源、穿屋或拿 access 算水帶。'},
    limitations:['有限候選近似，不證明連續空間全域最近或3m內絕無其他合法點；可能對未採樣窄縫過度調整。',
      '只驗證局部合法站位，不證明從出生點的道路/路徑連通性；未接 game/race，非完整遊玩 PASS。',
      '需提供完整相關碰撞建物；不合法輸入或有限候選無解回傳 null。'],
    summary:{fixedSamples:20,targetCount:results.reduce((n,r)=>n+r.targetCount,0),
      originalWarnings:12,warningAdjustedWithLegalStandpoint:warnings.length,
      adjusted:results.flatMap(r=>r.targets).filter(t=>t.access.adjusted).length,nullCount:0,
      inputUnchanged:true,sourceSelectionUnchanged:true,gameRaceWired:false},
    inputSha256:hashes,originalWarningCases:warnings,results};
  if(process.env.WRITE_DOORWAY_VERDICT==='1')fs.writeFileSync(new URL('.qa/v2-doorway-verdict.json',root),JSON.stringify(report,null,2)+'\n');
});
