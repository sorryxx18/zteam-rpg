import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(new URL('../'+p, import.meta.url)));
const authorized=JSON.parse(fs.readFileSync(new URL('./fixtures/v3-authorized-sha256.json',import.meta.url)));
const assertAuthorized = path => {
 assert.match(authorized[path] ?? '',/^[a-f0-9]{64}$/);
 const bytes=fs.readFileSync(new URL('../data/'+path,import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),authorized[path],path);
};
test('authorized SHA fixture covers exactly all 179 authorized data files',()=>{
 const keys=read('data/w/index.json');
 const paths=['sites.json','w/index.json',...keys.map(key=>'w/'+key+'.json')];
 assert.equal(Object.keys(authorized).length,179);
 assert.deepEqual(Object.keys(authorized).sort(),paths.sort());
});
test('authorized water cells preserve bytes, whitelist and totals',()=>{
 const keys=read('data/w/index.json'); assert.equal(keys.length,177);
 assertAuthorized('w/index.json');
 let count=0; const kinds=new Set();
 for(const key of keys){assert.match(key,/^-?\d+_-?\d+$/); const rows=read('data/w/'+key+'.json');
 assertAuthorized('w/'+key+'.json');
 for(const row of rows){assert.equal(row.length,3);assert.ok(Number.isFinite(row[0])&&Number.isFinite(row[1])); kinds.add(row[2]);count++;}}
 assert.equal(count,4649);assert.deepEqual([...kinds].sort(),['hydrant_above','hydrant_under'].sort());
});
const m = await import('../missions.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('mission candidates use exact station name and retain site identity',()=>{
 const a={st:'信義分隊',x:9999,y:0}, b={st:'信義',x:0,y:0};
 assert.deepEqual(m.missionCandidates?.([a,b],{name:'信義分隊',x:0,y:0}),[a]);
 assert.equal(m.missionCandidates([a,b],{name:'信義分隊',x:0,y:0})[0],a);
});
test('support stations exclude own jurisdiction and include exact 2500m boundary',()=>{
 for(const name of ['復興分隊','永吉分隊']){
 const sites=[{st:name,x:0,y:0},{st:'其他分隊',x:2500,y:0},{st:'其他分隊',x:0,y:-2500},{st:'其他分隊',x:2500.001,y:0}];
 assert.deepEqual(m.missionCandidates(sites,{name,x:0,y:0}),sites.slice(1,3));
 }
});
test('real authorized sites give 830 Fuxing and 733 Yongji support candidates',()=>{
 const sites=read('data/sites.json'),{stations}=read('data/base.json');
 for(const [name,count] of [['復興分隊',830],['永吉分隊',733]]){
  const station=stations.find(s=>s.name===name);assert.ok(station);
  const expected=sites.filter(s=>s.st!==name&&Math.hypot(s.x-station.x,s.y-station.y)<=2500);
  assert.equal(expected.length,count);
  const actual=m.missionCandidates(sites,station);
  assert.equal(actual.length,count);assert.deepEqual(actual,expected);
  actual.forEach((site,index)=>assert.equal(site,expected[index]));
 }
});
test('fire without nearby building retains coordinates without mutating input',()=>{
 const site=Object.freeze({n:'場所',x:1,y:2});
 const fire=m.resolveFireSite?.(site,[]);
 assert.deepEqual(fire,{...site,building:null}); assert.notEqual(fire,site);
});
test('fire snaps inside polygon to area centroid rather than vertex average or bounds',()=>{
 const building=Object.freeze({p:Object.freeze([0,0,60,0,60,20,20,20,20,60,0,60]),bounds:[0,0,60,60]});
 const site=Object.freeze({x:5,y:5,n:'場所'});
 const fire=m.resolveFireSite(site,[building]);
 assert.equal(fire.building,building);assert.equal(fire.x,22);assert.equal(fire.y,22);assert.equal(site.x,5);
});
test('fire chooses nearest polygon edge within inclusive 40m, not nearest center',()=>{
 const near={p:[0,0,1000,0,1000,20,0,20]}, far={p:[-10,60,10,60,10,80,-10,80]};
 const fire=m.resolveFireSite({x:0,y:25},[far,near]);assert.equal(fire.building,near);assert.equal(fire.x,500);
 assert.equal(m.resolveFireSite({x:-40,y:10},[near]).building,near);
 assert.equal(m.resolveFireSite({x:-40.001,y:10},[near]).building,null);
 assert.equal(m.resolveFireSite({x:0,y:10},[near]).building,near);
});
test('water cell lookup covers radius across negative boundaries using existing keys only',()=>{
 const keys=Object.freeze(['-1_-1','-1_0','0_-1','0_0','1_0','9_9']);
 assert.deepEqual(m.waterCellKeys?.({x:0,y:0},keys),keys.slice(0,4));
 assert.deepEqual(m.waterCellKeys({x:100,y:100},['0_0','1_0','2_0'],100,100),['0_0','1_0','2_0']);
});
test('water label maps two kinds to game road name with neutral unnamed fallback',()=>{
 const roads=[{n:'遊戲路',p:[-10,0,10,0]}];
 for(const [k,label] of Object.entries({hydrant_above:'地上消防栓',hydrant_under:'地下消防栓'})){
 assert.equal(m.waterLabel?.({x:0,y:1,k},roads),'遊戲路'+(k==='hydrant_above'?'口':'旁')+label);
 assert.equal(m.waterLabel({x:0,y:1,k}), '巷弄／未命名道路'+(k==='hydrant_above'?'口':'旁')+label);
 assert.equal(m.waterLabel({x:0,y:1000,k},roads), '巷弄／未命名道路'+(k==='hydrant_above'?'口':'旁')+label);
 }
});
test('decoded cells use stable cell-row ids and road-kind labels without source identifiers',()=>{
 const kinds=['hydrant_above','hydrant_under'];
 const cells=Object.freeze([{key:'-1_0',rows:Object.freeze(kinds.map(k=>Object.freeze([1,2,k])))},{key:'0_0',rows:[[1,2,'hydrant_above']]}]);
 const roads=[{n:'遊戲路',p:[0,0,10,0]}];
 const water=m.decodeWaterCells?.(cells,roads);assert.equal(water?.length,3);
 assert.deepEqual(water.map(w=>w.k),[...kinds,'hydrant_above']);assert.equal(new Set(water.map(w=>w.id)).size,3);
 for(const [i,w] of water.entries()){
 assert.deepEqual(Object.keys(w).sort(),['id','x','y','k','n'].sort());assert.equal(w.x,1);assert.equal(w.y,2);
 assert.equal(w.n,m.waterLabel(w,roads));assert.ok(!w.n.includes(w.id));
 assert.ok(w.id.includes(i===2?'0_0':'-1_0'));
 }
 assert.deepEqual(m.decodeWaterCells([cells[1],cells[0]],roads).map(w=>w.id),[water[2].id,...water.slice(0,2).map(w=>w.id)]);
 assert.equal(m.decodeWaterCells([cells[0]])[0].n,'巷弄／未命名道路口地上消防栓');
});
test('objectives select nearest 15 stably without mutating input',()=>{
 const water=Object.freeze(Array.from({length:25},(_,i)=>Object.freeze({id:String(i),x:25-i,y:0})));
 const result=m.selectObjectives?.(water,{x:0,y:0});
 assert.deepEqual(result,water.slice(10).toReversed());assert.equal(water[0].id,'0');
 const ties=Object.freeze([{id:'z',x:3,y:4},{id:'a',x:-3,y:-4}]);
 assert.deepEqual(m.selectObjectives(ties,{x:0,y:0}),ties);
});
test('objectives include exact 300m boundary and exclude 300.001m',()=>{
 const edge=Object.freeze({id:'edge',x:180,y:240});
 const beyond=Object.freeze({id:'beyond',x:300.001,y:0});
 assert.deepEqual(m.selectObjectives(Object.freeze([beyond,edge]),{x:0,y:0}),[edge]);
});
test('objectives never pad fewer than 15 eligible sources from outside radius',()=>{
 const water=Object.freeze(Array.from({length:25},(_,i)=>Object.freeze({id:String(i),x:298+i,y:0})));
 assert.deepEqual(m.selectObjectives(water,{x:0,y:0}),water.slice(0,3));
});
test('objectives return zero when no source is within radius',()=>{
 assert.deepEqual(m.selectObjectives([{x:300.001,y:0}],{x:0,y:0}),[]);
 assert.deepEqual(m.selectObjectives([],{x:0,y:0}),[]);
});
test('objective distances use resolved building center rather than original site',()=>{
 const site=Object.freeze({x:0,y:10});
 const building={p:[0,0,1000,0,1000,20,0,20]};
 const fire=m.resolveFireSite(site,[building]);
 assert.deepEqual({x:fire.x,y:fire.y},{x:500,y:10});
 const originOnly={id:'origin',x:-1,y:10},centerEdge={id:'center-edge',x:800,y:10},beyond={id:'beyond',x:800.001,y:10};
 const water=Object.freeze([originOnly,beyond,centerEdge]);
 assert.deepEqual(m.selectObjectives(water,site),[originOnly]);
 assert.deepEqual(m.selectObjectives(water,fire),[centerEdge]);
 assert.deepEqual(site,{x:0,y:10});
});
test('authorized sites preserve exact bytes, count and field whitelist',()=>{
 const sites=read('data/sites.json');
 assert.equal(sites.length,1217);
 for(const s of sites){assert.deepEqual(Object.keys(s).sort(),['n','addr','use','st','x','y','q'].sort());assert.ok(Number.isFinite(s.x)&&Number.isFinite(s.y));}
 assertAuthorized('sites.json');
});
