import {circleIntersectsPoly} from './core.mjs';
// Pure, metre-based undirected road model. No DOM, network, or global state.
export const NPC_COUNTS=Object.freeze({easy:2,normal:3,hard:4});
export const RULES=Object.freeze({roundSeconds:180,npcDelaySeconds:10,npcStaggerSeconds:5,spawnMode:'near-site',npcSpawnMode:'nearest-station',spawnDistance:30,targetRadius:500,captureRadius:3,difficulty:'normal',npcCount:3,runSpeed:10,npcSpeedRatio:1});
const freeze = value => {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function roundStars(captured,total){const ratio=total>0?captured/total:0;return ratio<.3?1:ratio<.6?2:3;}
export function rememberHighScore(storage,difficulty,score){
 const key=`zteam-rpg-highscore-${difficulty}`;let previous=0;
 try{const stored=Number(storage?.getItem(key));if(Number.isFinite(stored)&&stored>=0)previous=stored;}catch{}
 const best=Math.max(previous,score);try{storage?.setItem(key,String(best));}catch{}return best;
}
export function createRace({sites,water,stations=[],roads=[],buildings=[],clock=()=>performance.now(),random=Math.random,canStand=()=>true,config={}}){
 const rules={...RULES,...config};
 const counts=NPC_COUNTS;
 if(!Object.hasOwn(counts,rules.difficulty))throw new Error('難度無效');
 rules.npcCount=config.npcCount===undefined?counts[rules.difficulty]:config.npcCount;
 if(!Array.isArray(sites)||!sites.length)throw new Error('場所不可空白');
 for(const s of sites)if(!pointOK(s)||!s.n||!s.addr)throw new Error('場所名稱、地址或座標無效');
 if(!Array.isArray(water))throw new Error('水源格式無效');
 for(const w of water)if(!pointOK(w)||!w.n||!['hydrant_above','hydrant_under'].includes(w.k))throw new Error('水源名稱、座標或類型無效');
 for(const s of stations)if(!pointOK(s))throw new Error('分隊座標無效');
 for(const key of ['roundSeconds','npcDelaySeconds','npcStaggerSeconds','spawnDistance','targetRadius','captureRadius','runSpeed','npcSpeedRatio'])if(!Number.isFinite(rules[key])||rules[key]<0)throw new Error('規則數值無效');
 if(!['nearest-station','perimeter'].includes(rules.npcSpawnMode))throw new Error('消防車出生模式無效');
 if(!['near-site','nearest-station'].includes(rules.spawnMode)||!Number.isInteger(rules.npcCount)||rules.npcCount<0||rules.npcCount>4)throw new Error('規則模式無效');
 const graph=buildRoadGraph(roads,{buildings});let state={status:'idle',difficulty:rules.difficulty,site:null,spawn:null,remaining:rules.roundSeconds,captured:0,score:0,combo:0,comboBonus:0,interceptBonus:0,comboExpiresAt:0,totalHoses:0,construction:null,total:0,water:[],npcs:[]},events=[],started=0,elapsed=0,meta=[];
 let cancelled=new Set(),geometryCache=new WeakMap(),lastPlayer=null;
 // Private graph geometry only: never cache ownership, reservations or canStand.
 // Each NPC retains at most 20 queries for its exact current position.
 const geometry=(n,w)=>{
  let cache=geometryCache.get(n);
  if(!cache||cache.x!==n.x||cache.y!==n.y){cache={x:n.x,y:n.y,queries:new Map()};geometryCache.set(n,cache);}
  let cached=cache.queries.get(w.id);
  if(!cached){const route=shortestRoute(graph,n,w);cached={route,start:route?project(graph,n):null,end:route?project(graph,w):null};
   if(cache.queries.size>=20)cache.queries.delete(cache.queries.keys().next().value);
   cache.queries.set(w.id,cached);
  }
  // Candidate curb connectors and distance increments must not mutate the cache.
  return {...cached,route:cached.route?{distance:cached.route.distance,points:cached.route.points.map(p=>({...p}))}:null};
 };
 const snapshot=()=>freeze(structuredClone(state));
 const event=(type,w=null,n=null,details={})=>events.push({type,waterId:w?.id??null,waterName:w?.n??null,npcId:n?.id??null,...details});
 const horn=(n,time)=>{const m=meta[state.npcs.indexOf(n)];if(time-m.horn>=8){m.horn=time;event('horn',null,n);}};
 const construction=w=>{const hoses=Math.max(1,Math.ceil(distance(w,state.site)/20));return {waterId:w.id,hoses,duration:Math.min(6,hoses*.5),elapsed:0,contested:false};};
 const claim=(w,owner,n=null,time=elapsed)=>{if(w.owner!==null)return;w.owner=owner;if(owner==='player'){state.combo=state.combo&&time<=state.comboExpiresAt+1e-9?state.combo+1:1;state.comboExpiresAt=time+15;const comboBonus=state.combo>=2?1:0,interceptBonus=state.npcs.some((car,i)=>time>=meta[i].delay-1e-9&&distance(car,w)<=30+1e-9)?1:0;state.captured++;state.comboBonus+=comboBonus;state.interceptBonus+=interceptBonus;state.score+=1+comboBonus+interceptBonus;state.totalHoses+=state.construction.hoses;event('capture',w,null,{timeSeconds:time,combo:state.combo,comboBonus,interceptBonus});}else{n.cooldownRemaining=3;event('stolen',w,n);horn(n,time);}if(state.construction?.waterId===w.id)state.construction=null;for(const car of state.npcs)if(car.target===w.id){car.target=null;car.route=[];car.construction=null;}};
 const legalCurbSegment=(a,b,edge)=>{
  const clearance=edge.w/2-.32;
  if(clearance<0||distance(a,b)>clearance||!canStand(a.x,a.y)||!canStand(b.x,b.y))return false;
  // The eroded ORIGINAL road capsule is convex. Both endpoints inside it
  // prove the entire swept .32m vehicle stays on that same road, even at ends
  // and when graph-node quantization chose another road's nearby vertex.
  const {roadA:u,roadB:v}=edge,dx=v.x-u.x,dy=v.y-u.y;
  for(const p of [a,b]){const t=Math.max(0,Math.min(1,((p.x-u.x)*dx+(p.y-u.y)*dy)/(dx*dx+dy*dy)));if(distance(p,{x:u.x+t*dx,y:u.y+t*dy})>clearance)return false;}
  return !buildings.some(o=>blockedSegment(a,b,o,.32));
 };
 const plan=n=>{if(n.target!==null&&state.water.find(w=>w.id===n.target)?.owner===null)return;
  n.target=null;n.route=[];let best=Infinity,bestPriority=Infinity;
  const reserved=new Set(state.npcs.filter(o=>o!==n).map(o=>o.target));
  for(const w of state.water){if(w.owner!==null||reserved.has(w.id))continue;const {route,start,end:projection}=geometry(n,w);if(!route)continue;
   // A car returning from the curb must physically retrace a safe road-width
   // connector too; shortestRoute itself intentionally remains centreline-only.
   const startGap=distance(n,route.points[0]);
   if(startGap>1e-8){if(!legalCurbSegment(n,start.q,start.edge))continue;route.distance+=startGap;}
   const q=route.points.at(-1),gap=distance(q,w);
   if(gap>rules.captureRadius){const end={x:q.x+(w.x-q.x)*(gap-rules.captureRadius)/gap,y:q.y+(w.y-q.y)*(gap-rules.captureRadius)/gap};
    if(!legalCurbSegment(q,end,projection.edge))continue;
    route.points.push(end);route.distance+=distance(q,end);
   }
   const priority=pointOK(lastPlayer)&&distance(lastPlayer,w)<=60&&distance(n,w)<distance(lastPlayer,w)?0:1;
   if(priority>bestPriority||priority===bestPriority&&route.distance>=best)continue;bestPriority=priority;best=route.distance;n.target=w.id;n.route=route.points.map(p=>({...p}));}
 };
 function start(index){
  if(index===undefined)index=Math.min(sites.length-1,Math.max(0,Math.floor(random()*sites.length)));
  if(!Number.isInteger(index)||!sites[index])throw new Error('場所索引無效');
  const site=sites[index],near=stations.map((s,i)=>({...s,_index:i})).sort((a,b)=>distance(a,site)-distance(b,site));
  const targets=water.map((w,id)=>({...w,id,owner:null})).filter(w=>distance(w,site)<=rules.targetRadius);if(!targets.length)throw new Error('場所附近沒有水源');
  let spawn=null;
  if(rules.spawnMode==='nearest-station'){if(!near.length)throw new Error('沒有可用分隊');const s=near[0];if(canStand(s.x,s.y))spawn={x:s.x,y:s.y};}
  else {for(let i=0;i<72;i++){const angle=i*Math.PI/36,p={x:site.x+Math.cos(angle)*rules.spawnDistance,y:site.y+Math.sin(angle)*rules.spawnDistance};if(canStand(p.x,p.y)){spawn=p;break;}}}
  if(!spawn)throw new Error('找不到可站立的出生位置');
  started=clock();elapsed=0;events=[];meta=[];cancelled=new Set();geometryCache=new WeakMap();lastPlayer=null;
  state={status:'playing',difficulty:rules.difficulty,site:{n:site.n,addr:site.addr,x:site.x,y:site.y},spawn,remaining:rules.roundSeconds,captured:0,score:0,combo:0,comboBonus:0,interceptBonus:0,comboExpiresAt:0,totalHoses:0,construction:null,total:targets.length,water:targets,npcs:[]};
  const entries=rules.npcSpawnMode==='perimeter'?perimeterEntries(graph,site,rules.npcCount,canStand):null;
  for(let i=0;i<rules.npcCount&&(entries||near.length);i++){const s=near[i]??near[0],p=entries?entries[i]:project(graph,s)?.q??s;state.npcs.push({id:`npc${i+1}`,x:p.x,y:p.y,direction:{x:0,y:0},active:false,target:null,route:[],construction:null,cooldownRemaining:0});meta.push({delay:rules.npcDelaySeconds+(!entries&&i>=near.length?rules.npcStaggerSeconds:0),horn:-Infinity});}
  return snapshot();
 }
 // Distance along the actual road route to first entry into the capture circle.
 function arrivalDistance(n,w){
  if(distance(n,w)<=rules.captureRadius+1e-8)return 0;
  let a=n,total=0;
  for(const b of n.route){const d=distance(a,b);if(d<1e-10){a=b;continue;}const ux=(b.x-a.x)/d,uy=(b.y-a.y)/d,px=a.x-w.x,py=a.y-w.y,along=px*ux+py*uy,disc=along*along-(px*px+py*py-rules.captureRadius**2);
   if(disc>=-1e-8){const entry=-along-Math.sqrt(Math.max(0,disc));if(entry>=-1e-8&&entry<=d+1e-8)return total+Math.max(0,entry);}total+=d;a=b;
  }return Infinity;
 }
 function move(n,budget){
  while(n.route.length){const p=n.route[0],d=distance(n,p);if(d>1e-8)n.direction={x:(p.x-n.x)/d,y:(p.y-n.y)/d};if(d>budget+1e-8){n.x+=n.direction.x*budget;n.y+=n.direction.y*budget;break;}n.x=p.x;n.y=p.y;budget=Math.max(0,budget-d);n.route.shift();}
 }
 function tick(dt,player){
  if(state.status!=='playing')return snapshot();
  lastPlayer=pointOK(player)?{x:player.x,y:player.y}:null;
  const now=Math.max(elapsed,(clock()-started)/1000);if(!Number.isFinite(now))throw new Error('時鐘無效');
  if(!Number.isFinite(dt)||dt<0)throw new Error('dt 秒數無效');
  const end=Math.min(now,rules.roundSeconds),begin=Math.min(end,Math.max(elapsed,now-dt));
  if(state.construction){const w=state.water.find(w=>w.id===state.construction.waterId);if(!pointOK(player)||!w||w.owner!==null||distance(player,w)>rules.captureRadius)state.construction=null;}
  // Every actor shares event boundaries: arrival, completion, dispatch and cooldown.
  // The .1s ceiling samples passing horns only; it never rounds construction times.
  let time=begin;
  for(;;){
   if(time>=rules.roundSeconds-1e-9)break;
   if(state.construction&&state.construction.duration-state.construction.elapsed<=1e-9)claim(state.water.find(w=>w.id===state.construction.waterId),'player',null,time);
   for(const n of state.npcs)if(n.construction&&n.construction.duration-n.construction.elapsed<=1e-9)claim(state.water.find(w=>w.id===n.construction.waterId),n.id,n,time);
   for(let i=0;i<state.npcs.length;i++){const n=state.npcs[i];n.active=time>=meta[i].delay-1e-9;if(!n.active)continue;
    if(n.cooldownRemaining<=1e-9){n.cooldownRemaining=0;plan(n);const w=state.water.find(w=>w.id===n.target);if(w&&!n.construction&&arrivalDistance(n,w)<=1e-8)n.construction=construction(w);}
    if(pointOK(player)&&distance(n,player)<=50)horn(n,time);
   }
   if(time>=end-1e-10)break;
   let span=Math.min(.1,end-time);
   if(state.construction)span=Math.min(span,state.construction.duration-state.construction.elapsed);
   for(let i=0;i<state.npcs.length;i++){const n=state.npcs[i];if(!n.active){span=Math.min(span,meta[i].delay-time);continue;}if(n.cooldownRemaining>0)span=Math.min(span,n.cooldownRemaining);else if(n.construction)span=Math.min(span,n.construction.duration-n.construction.elapsed);else {const w=state.water.find(w=>w.id===n.target),speed=rules.runSpeed*rules.npcSpeedRatio;if(w&&speed>0)span=Math.min(span,arrivalDistance(n,w)/speed);}}
   if(state.construction)state.construction.elapsed+=span;
   for(const n of state.npcs){if(!n.active)continue;if(n.cooldownRemaining>0)n.cooldownRemaining=Math.max(0,n.cooldownRemaining-span);else if(n.construction)n.construction.elapsed+=span;else move(n,span*rules.runSpeed*rules.npcSpeedRatio);}
   time+=span;
  }
  elapsed=now;state.remaining=Math.max(0,rules.roundSeconds-now);if(now>state.comboExpiresAt+1e-9)state.combo=0;
  if(now>=rules.roundSeconds){state.status='finished';state.construction=null;for(const n of state.npcs)n.construction=null;event('finish');return snapshot();}
  for(const id of cancelled){const w=state.water.find(w=>w.id===id);if(pointOK(player)&&distance(player,w)>rules.captureRadius)cancelled.delete(id);}
  // Player coordinates are an observation at NOW, not a path through the past dt.
  if(!state.construction&&pointOK(player)){const w=state.water.find(w=>w.owner===null&&!cancelled.has(w.id)&&distance(player,w)<=rules.captureRadius);if(w)state.construction=construction(w);}
  const work=[state.construction,...state.npcs.map(n=>n.construction)].filter(Boolean);
  for(const c of work)c.contested=work.some(other=>other!==c&&other.waterId===c.waterId);
  return snapshot();
 }
 return Object.freeze({start,tick,getState:snapshot,cancelConstruction(){if(state.status==='playing'&&state.construction){cancelled.add(state.construction.waterId);state.construction=null;for(const n of state.npcs)if(n.construction)n.construction.contested=state.npcs.some(o=>o!==n&&o.construction?.waterId===n.construction.waterId);}return snapshot();},drainEvents(){const out=events;events=[];return out;}});
}
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const pointOK = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
// Spawn on existing safe road centrelines in the authorised annulus. No snaps,
// invented edges, station fallback, speed changes or target-dependent placement.
function perimeterEntries(graph,site,count,canStand){
 const candidates=[],seen=new Set();
 for(const e of graph.edges){
  if(e.w<.64)continue;
  const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,a=dx*dx+dy*dy,px=e.a.x-site.x,py=e.a.y-site.y,b=2*(px*dx+py*dy),samples=[0,1];
  for(const radius of [250,275,300]){const c=px*px+py*py-radius*radius,d=b*b-4*a*c;if(d>=-1e-8){const root=Math.sqrt(Math.max(0,d));samples.push((-b-root)/(2*a),(-b+root)/(2*a));}}
  for(const t of samples){
   if(t<0||t>1)continue;const p={x:e.a.x+t*dx,y:e.a.y+t*dy},d=distance(p,site);
   if(d<250-1e-7||d>300+1e-7||!canStand(p.x,p.y))continue;
   const u=e.roadA,v=e.roadB,vx=v.x-u.x,vy=v.y-u.y,f=Math.max(0,Math.min(1,((p.x-u.x)*vx+(p.y-u.y)*vy)/(vx*vx+vy*vy)));
   if(distance(p,{x:u.x+f*vx,y:u.y+f*vy})>e.w/2-.32+1e-8)continue;
   const key=`${p.x.toFixed(6)},${p.y.toFixed(6)}`;if(seen.has(key))continue;seen.add(key);candidates.push({...p,d,angle:Math.atan2(p.y-site.y,p.x-site.x)});
  }
 }
 const entries=[],angleGap=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
 for(let i=0;i<count;i++){
  const angle=Math.PI/2+i*2*Math.PI/count,available=candidates.filter(p=>entries.every(q=>distance(p,q)>1&&angleGap(p.angle,q.angle)>.01));
  available.sort((a,b)=>angleGap(a.angle,angle)-angleGap(b.angle,angle)||Math.abs(a.d-275)-Math.abs(b.d-275)||a.x-b.x||a.y-b.y);
  if(!available.length)throw new Error('找不到分散且可通行的消防車進場道路');entries.push(available[0]);
 }
 return entries;
}
// Test the entire swept circle, not spaced samples that could skip narrow walls.
function blockedSegment(a,b,{p},radius){
 if(circleIntersectsPoly(a.x,a.y,radius,p)||circleIntersectsPoly(b.x,b.y,radius,p))return true;
 const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
 const side=(x,y)=>dx*(y-a.y)-dy*(x-a.x);
 for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){
  const cx=p[j],cy=p[j+1],ex=p[i],ey=p[i+1];
  const t=Math.max(0,Math.min(1,((cx-a.x)*dx+(cy-a.y)*dy)/length2));
  if(Math.hypot(cx-a.x-t*dx,cy-a.y-t*dy)<=radius+1e-10)return true;
  // Closed segment intersection, including tangency and collinear overlap.
  const sa=side(cx,cy),sb=side(ex,ey);
  const sc=(ex-cx)*(a.y-cy)-(ey-cy)*(a.x-cx),sd=(ex-cx)*(b.y-cy)-(ey-cy)*(b.x-cx);
  if(sa*sb<=0&&sc*sd<=0&&Math.max(a.x,b.x)>=Math.min(cx,ex)&&Math.min(a.x,b.x)<=Math.max(cx,ex)&&Math.max(a.y,b.y)>=Math.min(cy,ey)&&Math.min(a.y,b.y)<=Math.max(cy,ey))return true;
 }
 return false;
}
export function buildRoadGraph(roads=[],{buildings=[],radius=.32}={}) {
 const nodes=new Map(), edges=[], seen=new Set();
 // Bounds are derived once; caller geometry and optional metadata remain untouched.
 const obstacles=buildings.map(({p})=>{let l=Infinity,r=-Infinity,s=Infinity,n=-Infinity;for(let i=0;i<p.length;i+=2){l=Math.min(l,p[i]);r=Math.max(r,p[i]);s=Math.min(s,p[i+1]);n=Math.max(n,p[i+1]);}return {p,l,r,s,n};});
 const node=(x,y)=>{const id=`${Math.round(x*2)},${Math.round(y*2)}`; if(!nodes.has(id))nodes.set(id,{id,x,y,links:[]});return nodes.get(id);};
 for(const road of roads){const p=road.p??[];for(let i=2;i<p.length;i+=2){
  if(![p[i-2],p[i-1],p[i],p[i+1]].every(Number.isFinite)) throw new Error('道路座標無效');
  const a=node(p[i-2],p[i-1]),b=node(p[i],p[i+1]);const key=[a.id,b.id].sort().join('|');
  if(a===b||seen.has(key))continue;seen.add(key);
  const l=Math.min(a.x,b.x)-radius,r=Math.max(a.x,b.x)+radius,s=Math.min(a.y,b.y)-radius,n=Math.max(a.y,b.y)+radius;
  if(obstacles.some(o=>o.r>=l&&o.l<=r&&o.n>=s&&o.s<=n&&blockedSegment(a,b,o,radius)))continue;
  const length=distance(a,b);edges.push({a,b,length,w:Number.isFinite(road.w)&&road.w>0?road.w:0,roadA:{x:p[i-2],y:p[i-1]},roadB:{x:p[i],y:p[i+1]}});a.links.push({node:b,length});b.links.push({node:a,length});
 }}return {nodes,edges};
}
function project(graph,p){
 let best=null;for(const edge of graph.edges){const {a,b}=edge,dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy))),q={x:a.x+t*dx,y:a.y+t*dy};const gap=distance(p,q);if(!best||gap<best.gap)best={edge,q,gap};}return best;
}
// Returns road-only projected points and distance, or null for disconnected roads.
export function shortestRoute(graph,from,to){
 const s=project(graph,from),t=project(graph,to);if(!s||!t)return null;
 const dist=new Map(),prev=new Map(),heap=[];
 const push=(id,d)=>{heap.push([id,d]);let i=heap.length-1;while(i){let j=(i-1)>>1;if(heap[j][1]<=d)break;[heap[i],heap[j]]=[heap[j],heap[i]];i=j;}};
 const pop=()=>{const out=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;for(;;){let l=i*2+1,r=l+1,j=i;if(l<heap.length&&heap[l][1]<heap[j][1])j=l;if(r<heap.length&&heap[r][1]<heap[j][1])j=r;if(j===i)break;[heap[j],heap[i]]=[heap[i],heap[j]];i=j;}}return out;};
 for(const n of [s.edge.a,s.edge.b]){const d=distance(s.q,n);dist.set(n.id,d);prev.set(n.id,null);push(n.id,d);}
 while(heap.length){const [id,d]=pop();if(d!==dist.get(id))continue;for(const link of graph.nodes.get(id).links){const nd=d+link.length;if(nd<(dist.get(link.node.id)??Infinity)){dist.set(link.node.id,nd);prev.set(link.node.id,id);push(link.node.id,nd);}}}
 let end=null,best=Infinity;for(const n of [t.edge.a,t.edge.b]){const d=(dist.get(n.id)??Infinity)+distance(n,t.q);if(d<best){best=d;end=n.id;}}
 let points=[];if(s.edge===t.edge&&distance(s.q,t.q)<=best){best=distance(s.q,t.q);points=[s.q,t.q];}else{if(!end)return null;for(let id=end;id!==null;id=prev.get(id)){const n=graph.nodes.get(id);points.unshift({x:n.x,y:n.y});}points.unshift(s.q);points.push(t.q);}
 points=points.filter((p,i)=>!i||distance(p,points[i-1])>1e-8);return {distance:best,points};
}
