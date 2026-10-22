import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../race.mjs',import.meta.url),'utf8');
async function instrument(text=source){
 text=text.replace(/'\.\/core\.mjs(?:\?[^']*)?'/,JSON.stringify(new URL('../core.mjs',import.meta.url).href))
  .replace('export function shortestRoute(graph,from,to){','export let routeQueries=0; export function shortestRoute(graph,from,to){routeQueries++;')
  .replace('function project(graph,p){','export let projections=0; function project(graph,p){projections++;');
 return import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}#${Math.random()}`);
}
function setup(mod,{water=[{n:'a',k:'hydrant_above',x:20,y:100},{n:'b',k:'hydrant_above',x:60,y:100}],roads=[{w:8,p:[0,0,100,0]},{w:8,p:[0,100,100,100]}],canStand=()=>true}={}){
 let now=0;const race=mod.createRace({sites:[{n:'場',addr:'址',x:0,y:0}],water,roads,stations:[{x:0,y:0}],canStand,clock:()=>now,config:{npcCount:1,npcDelaySeconds:0}});
 return {race,at(t){const dt=t-now/1000;now=t*1000;return race.tick(dt,{x:-999,y:-999});}};
}
test('same NPC position caches two disconnected geometry queries across 100 frames, restart clears them',async()=>{
 const m=await instrument(),{race,at}=setup(m);race.start(0);at(0);assert.equal(m.routeQueries,2);const projects=m.projections;
 for(let i=1;i<=100;i++)at(i/10);
 assert.equal(m.routeQueries,2);assert.equal(m.projections,projects);
 race.start(0);at(10);assert.equal(m.routeQueries,4);
});
test('dynamic canStand is rechecked; moving NPC replans and cached candidates match uncached snapshots/events',async()=>{
 const cached=await instrument(),uncached=await instrument(source.replace('cache.queries.set(w.id,cached);','/* reference: do not retain queries */'));
 let open=false;
 const opts={water:[{n:'a',k:'hydrant_above',x:20,y:6.3},{n:'b',k:'hydrant_above',x:60,y:6.3}],roads:[{w:8,p:[0,0,100,0]}],canStand:(x,y)=>y===0||open};
 const a=setup(cached,opts),b=setup(uncached,opts);assert.deepEqual(a.race.start(0),b.race.start(0));
 const check=t=>{const s=a.at(t);assert.deepEqual(s,b.at(t));assert.deepEqual(a.race.drainEvents(),b.race.drainEvents());return s;};
 check(0);assert.equal(cached.routeQueries,2);const projects=cached.projections;
 for(let i=1;i<=10;i++)assert.equal(check(i/10).npcs[0].target,null);
 assert.equal(cached.routeQueries,2);assert.equal(cached.projections,projects);
 open=true;assert.equal(check(1.1).npcs[0].target,0);
 assert.ok(check(2).npcs[0].x>0);
 check(20);assert.ok(cached.routeQueries>2,'new position must query again');
 for(let i=21;i<=40;i++)check(i);
 assert.equal(a.race.getState().water.filter(w=>w.owner==='npc1').length,2);
});
test('cache is limited to 20 water queries even when createRace receives more objectives',async()=>{
 const m=await instrument(source.replace('cache.queries.set(w.id,cached);','cache.queries.set(w.id,cached); if(cache.queries.size>20)throw Error("unbounded cache");'));
 const water=Array.from({length:21},(_,i)=>({n:`w${i}`,k:'hydrant_above',x:i,y:100}));
 const {race,at}=setup(m,{water});race.start(0);at(0);assert.equal(m.routeQueries,21);at(.1);assert.ok(m.routeQueries>21,'old queries must be evicted rather than retaining all objectives');
});
