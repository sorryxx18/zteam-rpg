#!/usr/bin/env node
// Fixed public indices only. Never reads CSV, handoff directories or .qa inputs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {RULES,NPC_COUNTS,createRace,buildRoadGraph,shortestRoute} from '../race.mjs';
import {circleIntersectsPoly,stepMove} from '../core.mjs';
import {resolveFireSite,waterCellKeys,decodeWaterCells,selectObjectives,missionCandidates} from '../missions.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function loadInputs(){
 const hashes=[];const read=p=>{const b=fs.readFileSync(path.join(ROOT,p));hashes.push({path:p,sha256:sha(b)});return JSON.parse(b);};
 const samples=read('tests/fixtures/v3-balance-samples.json'),sites=read('data/sites.json'),base=read('data/base.json'),keys=read('data/w/index.json');
 if(hashes.find(h=>h.path==='data/sites.json').sha256!==samples.sourceSitesSha256)throw Error('Fixed sample source SHA mismatch');
 if(samples.samples.length!==20||new Set(samples.samples.map(s=>s.siteIndex)).size!==20||new Set(samples.samples.map(s=>s.station)).size!==9)throw Error('Invalid fixed sample coverage');
 const cells=new Map(base.cells.map(k=>[k,read(`data/c/${k}.json`)]));
 const waters=new Map(keys.map(k=>[k,read(`data/w/${k}.json`)]));
 const pool=read('data/mission-pool.json');return {samples,sites,base,keys,cells,waters,hashes,pool};
}
export function prepareSample(input,sample){
 const {base,cells,sites,keys,waters}=input,site=sites[sample.siteIndex],station=base.stations.find(s=>s.name===sample.station);
 if(!site||!station||!missionCandidates(sites,station,new Set(input.pool.eligible)).includes(site))throw Error('Fixed site outside station mission policy');
 if(sample.support!==['復興分隊','永吉分隊'].includes(sample.station))throw Error('Support flag mismatch');
 const selected=new Set();
 const neighbors=(x,y)=>{for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const k=`${Math.floor(x/base.cs)+i}_${Math.floor(y/base.cs)+j}`;if(cells.has(k))selected.add(k);}};
 neighbors(site.x,site.y);
 const fire=resolveFireSite(site,[...selected].flatMap(k=>cells.get(k).builds||[]));
 const rect=(l,b,r,t)=>{for(const k of base.cells){const [x,y]=k.split('_').map(Number);if((x+1)*base.cs>=l&&x*base.cs<=r&&(y+1)*base.cs>=b&&y*base.cs<=t)selected.add(k);}};
 rect(fire.x-500,fire.y-500,fire.x+500,fire.y+500);
 const nearest=[...base.stations].sort((a,b)=>dist(a,fire)-dist(b,fire)).slice(0,NPC_COUNTS.normal);
 for(const s of nearest){const steps=Math.max(1,Math.ceil(dist(s,fire)/(base.cs/2)));for(let i=0;i<=steps;i++){const x=fire.x+(s.x-fire.x)*i/steps,y=fire.y+(s.y-fire.y)*i/steps;rect(x-base.cs,y-base.cs,x+base.cs,y+base.cs);}}
 neighbors(fire.x,fire.y);
 const geometry={roads:[...selected].flatMap(k=>cells.get(k).roads||[]),buildings:[...selected].flatMap(k=>cells.get(k).builds||[])};
 const water=selectObjectives(decodeWaterCells(waterCellKeys(fire,keys,base.cs,300).map(key=>({key,rows:waters.get(key)})),geometry.roads),fire,300,15).map(w=>({...w,sourceId:w.id}));
 return {fire,water,stations:base.stations,...geometry,cellKeys:[...selected]};
}
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

// Broad phase buckets keep exact swept-circle tests affordable. No point snapping.
export function createNavigator({roads=[],buildings=[],cellKeys=null,cellSize=500}){
 const grid=new Map();
 const box=p=>{let l=Infinity,b=Infinity,r=-Infinity,t=-Infinity;for(let i=0;i<p.length;i+=2){l=Math.min(l,p[i]);b=Math.min(b,p[i+1]);r=Math.max(r,p[i]);t=Math.max(t,p[i+1]);}return [l,b,r,t];};
 const insert=(building)=>{const [l,b,r,t]=box(building.p);for(let x=Math.floor(l/25);x<=Math.floor(r/25);x++)for(let y=Math.floor(b/25);y<=Math.floor(t/25);y++){const k=`${x}_${y}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(building);}};
 const seen=new Set();for(const b of buildings){const k=JSON.stringify(b.p);if(!seen.has(k)){seen.add(k);insert(b);}}
 const nearby=(l,b,r,t)=>{const out=new Set();for(let x=Math.floor(l/25);x<=Math.floor(r/25);x++)for(let y=Math.floor(b/25);y<=Math.floor(t/25);y++)for(const item of grid.get(`${x}_${y}`)||[])out.add(item);return [...out];};
 const loaded=cellKeys?new Set(cellKeys):null;
 const canStand=(x,y)=> (!loaded||loaded.has(`${Math.floor(x/cellSize)}_${Math.floor(y/cellSize)}`))&&!nearby(x-.32,y-.32,x+.32,y+.32).some(b=>circleIntersectsPoly(x,y,.32,b.p));
 const clear=(a,b)=>{
  if(!canStand(a.x,a.y)||!canStand(b.x,b.y))return false;
  if(dist(a,b)<1e-9)return true;
  const obstacles=nearby(Math.min(a.x,b.x)-.32,Math.min(a.y,b.y)-.32,Math.max(a.x,b.x)+.32,Math.max(a.y,b.y)+.32);
  // Exact segment/segment minimum distance, including thin-wall crossings. Unlike
  // graph node rounding this also works for final movement steps below 25cm.
  const pointSegment=(p,u,v)=>{const dx=v.x-u.x,dy=v.y-u.y,t=Math.max(0,Math.min(1,((p.x-u.x)*dx+(p.y-u.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-u.x-t*dx,p.y-u.y-t*dy);};
  const cross=(u,v,p)=>(v.x-u.x)*(p.y-u.y)-(v.y-u.y)*(p.x-u.x);
  for(const {p} of obstacles)for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){
   const c={x:p[j],y:p[j+1]},d={x:p[i],y:p[i+1]};
   const crosses=cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&Math.max(a.x,b.x)>=Math.min(c.x,d.x)&&Math.min(a.x,b.x)<=Math.max(c.x,d.x)&&Math.max(a.y,b.y)>=Math.min(c.y,d.y)&&Math.min(a.y,b.y)<=Math.max(c.y,d.y);
   if(crosses||Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b))<=.32+1e-10)return false;
  }
  // A route must stay in loaded geometry, including along long connectors.
  for(let d=0,n=Math.ceil(dist(a,b));d<=n;d++){const f=n?d/n:0;if(!canStand(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f))return false;}
  return true;
 };
 const graph=buildRoadGraph(roads,{buildings});
 const route=(from,target)=>{
  const candidates=[{x:target.x,y:target.y},...Array.from({length:24},(_,k)=>({x:target.x+2.8*Math.cos(k*Math.PI/12),y:target.y+2.8*Math.sin(k*Math.PI/12)}))].filter(p=>canStand(p.x,p.y));
  let best=null;
  const consider=points=>{if(dist(points.at(-1),target)>3)return;let length=0,prev=from;for(const q of points){if(!clear(prev,q))return;length+=dist(prev,q);prev=q;}if(!best||length<best.distance)best={distance:length,points:points.filter((p,i)=>dist(p,i?points[i-1]:from)>1e-8)};};
  for(const p of candidates)consider([p]);
  const road=shortestRoute(graph,from,target);
  if(road)for(const p of candidates)consider([...road.points,p]);
  // Only if the original conservative search fails, try nearby real polygon
  // corners. These are candidate waypoints, never snaps: every connector is
  // checked by the same loaded-cell and .32m swept-circle predicate.
  if(!best){
   const corners=[];
   for(const {p} of nearby(from.x-60,from.y-60,from.x+60,from.y+60))for(let i=0;i<p.length;i+=2)for(const dx of [-.5,.5])for(const dy of [-.5,.5]){
    const q={x:p[i]+dx,y:p[i+1]+dy};if(dist(from,q)<=60&&clear(from,q))corners.push(q);
   }
   corners.sort((a,b)=>dist(from,a)-dist(from,b));
   for(const q of corners){
    for(const p of candidates)consider([q,p]);
    const detour=shortestRoute(graph,q,target);
    if(detour)for(const p of candidates)consider([q,...detour.points,p]);
    if(!best){
     const projections=graph.edges.map(({a,b})=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/(dx*dx+dy*dy)));return {x:a.x+t*dx,y:a.y+t*dy};}).filter(p=>dist(q,p)<=100&&clear(q,p)).sort((a,b)=>dist(q,a)-dist(q,b)).slice(0,8);
     for(const start of projections){const alternate=shortestRoute(graph,start,target);if(alternate)for(const p of candidates)consider([q,start,...alternate.points,p]);}
    }
   }
  }
  return best;
 };
 return {canStand,clear,route};
}
export function walkToward(position,target,dt,canStand,speed=10,clear=()=>true,audit=null){
 const d=dist(position,target);let accepted={...position};
 if(audit){audit.player={...position};audit.target={...target};audit.legs=[];}
 const sweptStand=(x,y)=>{
  const q={x,y},standable=canStand(x,y),sweptClear=standable&&clear(accepted,q),allowed=standable&&sweptClear;
  if(audit)audit.legs.push({from:{...accepted},next:q,standable,sweptClear,accepted:allowed});
  if(allowed)accepted=q;return allowed;
 };
 const next=d<1e-9?{...position}:stepMove(position,(target.x-position.x)/d,(target.y-position.y)/d,Math.min(dt,d/speed),speed,sweptStand);
 if(audit){audit.accepted={...accepted};audit.next={...next};audit.acceptedMatchesNext=accepted.x===next.x&&accepted.y===next.y;}
 return next;
}
export function summarize(rows){
 if(!rows.length)throw Error('No completed games');
 for(const r of rows)if(r.captured+r.npc+r.unclaimed!==r.total)throw Error('Capture conservation failed');
 const captured=rows.reduce((n,r)=>n+r.captured,0);
 return {games:rows.length,mean:captured/rows.length,min:Math.min(...rows.map(r=>r.captured)),max:Math.max(...rows.map(r=>r.captured)),captured,npc:rows.reduce((n,r)=>n+r.npc,0),unclaimed:rows.reduce((n,r)=>n+r.unclaimed,0),total:rows.reduce((n,r)=>n+r.total,0)};
}
// Synthetic contract probes are explicitly NOT fixed-20 balance outcomes.
export function checkModelReady(factory=createRace){
 const errors=[],require=(ok,msg)=>{if(!ok)throw Error(msg);};
 const make=(config={})=>{let now=0;const race=factory({sites:[{n:'synthetic fire',addr:'synthetic only',x:0,y:0}],water:[{n:'a',k:'hydrant_above',x:100,y:0},{n:'b',k:'hydrant_under',x:200,y:0}],stations:[{x:0,y:0},{x:0,y:0}],roads:[{p:[0,0,600,0]}],clock:()=>now,config:{difficulty:'normal',...config}});return {race,at:(seconds,p={x:-100,y:-100})=>{const dt=seconds-now/1000;now=seconds*1000;return race.tick(dt,p);}};};
 try{
  const {race,at}=make();let s=race.start(0);require(s.npcs.length===NPC_COUNTS.normal,'normal NPC count mismatch');require(s.construction===null&&s.totalHoses===0&&typeof race.cancelConstruction==='function','construction API absent');
  require(at(0,{x:96.99,y:0}).construction===null,'capture outside 3m');
  s=at(.05,{x:97,y:0});require(s.construction?.hoses===5&&s.construction?.duration===2.5&&s.construction?.elapsed===0&&typeof s.construction?.contested==='boolean','construction shape/timing incorrect');
  require(at(2.5,{x:97,y:0}).captured===0,'premature player capture');s=at(2.55,{x:97,y:0});require(s.captured===1&&s.totalHoses===5,'successful hoses must count once');
  s=at(3,{x:197,y:0});require(s.construction?.hoses===10,'second construction missing');race.cancelConstruction();require(race.getState().construction===null,'cancel not clearing construction');
 }catch(e){errors.push('player: '+e.message);}
 try{
  const {race,at}=make();race.start(0);let s=at(9.9);require(s.npcs.every(n=>!n.active),'NPC before 10 seconds');
  let first=null,before=null;for(let i=200;i<900;i++){s=at(i*.05);const w=s.water.find(w=>w.owner!==null);if(w){first={time:i*.05,id:w.owner};before=s.npcs.find(n=>n.id===w.owner);break;}}
  require(first&&first.time>=10+97/(10*RULES.npcSpeedRatio)+2.5-1e-8,'NPC must consume real travel and construction before capture');require(before.cooldownRemaining>=2.9,'NPC three-second cooldown missing');
  s=at(first.time+2.8);const after=s.npcs.find(n=>n.id===first.id);require(dist(before,after)<1e-7&&after.cooldownRemaining>0,'NPC moves during cooldown');
 }catch(e){errors.push('npc: '+e.message);}
 return {ready:errors.length===0,errors,kind:'synthetic contract probes; not balance data'};
}
export function simulateSample(geometry,sample){
 const nav=createNavigator(geometry);let now=0;
 const race=createRace({sites:[geometry.fire],water:geometry.water,stations:geometry.stations,roads:geometry.roads,buildings:geometry.buildings,canStand:nav.canStand,clock:()=>now,random:()=>{throw Error('Random sampling prohibited');},config:{difficulty:'normal',targetRadius:300}});
 let state=race.start(0),player={...state.spawn},plan=null,targetId=null;
 if(state.npcs.length!==NPC_COUNTS.normal)throw Error('Normal model NPC count mismatch');
 let movementSeconds=0,constructionSeconds=0,idleSeconds=0,movementMeters=0,collisionViolations=0,lastDecision=null;
 const failures=new Map(),trace=crypto.createHash('sha256'),captures=[];
 const movementAudit={validatedFrames:0,actualAxisLegs:0,acceptedStateMismatches:0,counterfactualFullFrameLRejections:0,firstCounterfactualRejection:null};
 // Decision changes only at arrival/claim/lost target, not by looking into future NPC state.
 for(let tick=1;tick<=3600;tick++){
  const dt=.05;let category='idle';
  if(state.construction){category='construction';plan=null;targetId=null;}
  else{
   const target=state.water.find(w=>w.id===targetId);
   if(!target||target.owner!==null){plan=null;targetId=null;}
   const decision=JSON.stringify([player.x,player.y,state.water.map(w=>w.owner)]);
   if(!plan&&decision!==lastDecision){
    lastDecision=decision;
    let best=null;for(const w of state.water){if(w.owner!==null)continue;const route=nav.route(player,w);if(!route){failures.set(w.sourceId??w.id,'No route found by direct/nearest-road, finite local corner/visible projection fallback and 2.8m approach candidates (not proof of global inaccessibility)');continue;}if(!best||route.distance<best.distance)best={...route,id:w.id};}
    if(best){plan=best.points.map(p=>({...p}));targetId=best.id;}
   }
   while(plan?.length&&dist(player,plan[0])<1e-7)plan.shift();
   if(plan?.length){
    const before=player,q=plan[0],audit={},next=walkToward(player,q,dt,nav.canStand,10,nav.clear,audit);
    // The callback validates EVERY actual <=15cm axis leg, not a fictitious
    // full-frame L shape (which can cross a wall even when the real path does not).
    const nextStandable=nav.canStand(next.x,next.y),movedMeters=dist(before,next),overSpeed=movedMeters>10*dt+1e-7;
    movementAudit.validatedFrames++;movementAudit.actualAxisLegs+=audit.legs.length;
    if(!audit.acceptedMatchesNext)movementAudit.acceptedStateMismatches++;
    if(!nextStandable||overSpeed||!audit.acceptedMatchesNext){
     collisionViolations++;
     const diagnostic={sample:sample.sample,tick,player:before,next,target:q,nextStandable,movedMeters,maxMeters:10*dt,overSpeed,acceptedStateMismatch:!audit.acceptedMatchesNext,audit};
     throw Error('Illegal swept movement; refusing report: '+JSON.stringify(diagnostic));
    }
    // Counterfactual diagnostic only; never reject actual axis legs for an
    // imaginary full-frame L. Keep one exact witness instead of every audit.
    const corner={x:next.x,y:before.y};
    if(!nav.clear(before,corner)||!nav.clear(corner,next)){
     movementAudit.counterfactualFullFrameLRejections++;
     movementAudit.firstCounterfactualRejection??={tick,player:{...before},next:{...next},target:{...q},nextStandable,movedMeters,overSpeed,audit};
    }
    player=next;const moved=dist(before,player);movementMeters+=moved;category='movement';
    if(moved<1e-8){failures.set(targetId,'core.stepMove blocked planned route');plan=null;targetId=null;}
   }
  }
  if(category==='movement')movementSeconds+=dt;else if(category==='construction')constructionSeconds+=dt;else idleSeconds+=dt;
  now=tick*50;state=race.tick(dt,player);
  trace.update(`${tick}:${player.x.toFixed(8)},${player.y.toFixed(8)}:${state.construction?.waterId??'-'}:${state.captured}\n`);
  for(const event of race.drainEvents())if(event.type==='capture'){const w=state.water.find(w=>w.id===event.waterId);if(!w||dist(player,w)>3+1e-8)throw Error('Capture outside source 3m');captures.push({timeSeconds:tick*.05,waterId:w.sourceId??w.id,distanceToSource:dist(player,w),hoses:Math.max(1,Math.ceil(dist(w,geometry.fire)/20))});}
 }
 if(state.status!=='finished'||state.remaining!==0)throw Error('180 second finish missing');
 const expectedHoses=captures.reduce((n,c)=>n+c.hoses,0);if(state.totalHoses!==expectedHoses||captures.length!==state.captured)throw Error('Capture/hose accounting mismatch');
 const npc=state.water.filter(w=>w.owner!==null&&w.owner!=='player').length,unclaimed=state.water.filter(w=>w.owner===null).length;
 const row={...sample,status:'completed',total:state.total,captured:state.captured,npc,unclaimed,totalHoses:state.totalHoses,simulatedSeconds:180,movementSeconds:+movementSeconds.toFixed(9),constructionSeconds:+constructionSeconds.toFixed(9),idleSeconds:+idleSeconds.toFixed(9),movementMeters,collisionViolations,traceSha256:trace.digest('hex'),captures,unclaimedReasons:state.water.filter(w=>w.owner===null).map(w=>({waterId:w.sourceId??w.id,reason:failures.get(w.sourceId??w.id)||'180 second clock exhausted before capture'}))};
 row.movementAudit=movementAudit;summarize([row]);return row;
}
export function runBalance(){
 const input=loadInputs();const sources=['race.mjs','core.mjs','missions.mjs','game.js','tools/balance-v2.mjs'].map(p=>({path:p,sha256:sha(fs.readFileSync(path.join(ROOT,p)))}));
 const readiness=checkModelReady();
 const report={schema:'balance-v3-real-geometry-1',status:readiness.ready?'running':'blocked-model-not-ready',difficulty:'normal',seed:input.samples.seed,readiness,modelBuild:sources,inputSha256:sha(JSON.stringify(input.hashes)),sourceSha256:input.hashes,strategy:{clockSeconds:180,stepSeconds:.05,walkSpeed:5,runSpeed:10,selectedSpeed:10,collisionRadius:.32,npcSource:'base.stations; normal nearest corridors as game; createRace normal defaults unchanged',navigation:'nearest feasible full route among unclaimed sources; direct or shortestRoute nearest-road projection; source center plus 24 points at 2.8m; every connector swept-circle checked; actual movement core.stepMove; locked during model construction; no reaction delay tuning',limitations:['Finite conservative search, not a global reachability proof: when direct/nearest-road fails, try visible building-vertex offsets (+/-0.5m axes) within 60m and up to eight nearest visible road projections within 100m per corner; all legs still swept-checked. No multi-corner search.','Fresh-round geometry mirrors game initial neighbors and pinned fire/normal-nearest-station corridor policy; excludes unrelated previous-round cache remnants.','Always-run greedy player is a fixed policy, not an average human. No combo score. No NPC parameter overrides.','Unstartable rounds remain explicit failures; no replacement samples and no partial mean.']},rows:[],summary:null};
 if(readiness.ready){for(const sample of input.samples.samples){try{report.rows.push(simulateSample(prepareSample(input,sample),sample));}catch(e){report.rows.push({...sample,status:'blocked',error:e.message,captured:null,npc:null,unclaimed:null,totalHoses:null});}}report.status=report.rows.every(r=>r.status==='completed')?'completed':'incomplete';if(report.status==='completed')report.summary=summarize(report.rows);}
 for(const s of sources)if(sha(fs.readFileSync(path.join(ROOT,s.path)))!==s.sha256){report.status='invalid-model-changed-during-run';report.summary=null;}
 return report;
}
function main(){
 const args=process.argv.slice(2);if(args.some((a,i)=>a!=='--output'&&args[i-1]!=='--output')||args.filter(a=>a==='--output').length>1||args.at(-1)==='--output')throw Error('Usage: node tools/balance-v2.mjs [--output report.json]');
 const report=runBalance(),output=args.includes('--output')?args[args.indexOf('--output')+1]:null;
 if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({status:report.status,summary:report.summary,readiness:report.readiness,rows:report.rows.map(({sample,total,captured,npc,unclaimed,status,error})=>({sample,total,captured,npc,unclaimed,status,error})),output},null,2));
 if(report.status!=='completed')process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
