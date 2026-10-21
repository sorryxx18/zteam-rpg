import {circleIntersectsPoly} from './core.mjs';
// Pure, metre-based undirected road model. No DOM, network, or global state.
export const RULES=Object.freeze({roundSeconds:300,npcDelaySeconds:20,npcStaggerSeconds:5,spawnMode:'near-site',spawnDistance:30,targetRadius:500,captureRadius:3,npcCount:2,runSpeed:10,npcSpeedRatio:.8});
const freeze = value => {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function createRace({sites,water,stations=[],roads=[],buildings=[],clock=()=>performance.now(),random=Math.random,canStand=()=>true,config={}}){
 const rules={...RULES,...config};
 if(!Array.isArray(sites)||!sites.length)throw new Error('場所不可空白');
 for(const s of sites)if(!pointOK(s)||!s.n||!s.addr)throw new Error('場所名稱、地址或座標無效');
 if(!Array.isArray(water))throw new Error('水源格式無效');
 for(const w of water)if(!pointOK(w)||!w.n||!['hydrant','tank','pool','natural','other','pond','river'].includes(w.k))throw new Error('水源名稱、座標或類型無效');
 for(const s of stations)if(!pointOK(s))throw new Error('分隊座標無效');
 for(const key of ['roundSeconds','npcDelaySeconds','npcStaggerSeconds','spawnDistance','targetRadius','captureRadius','runSpeed','npcSpeedRatio'])if(!Number.isFinite(rules[key])||rules[key]<0)throw new Error('規則數值無效');
 if(!['near-site','nearest-station'].includes(rules.spawnMode)||!Number.isInteger(rules.npcCount)||rules.npcCount<0||rules.npcCount>2)throw new Error('規則模式無效');
 const graph=buildRoadGraph(roads,{buildings});let state={status:'idle',site:null,spawn:null,remaining:rules.roundSeconds,captured:0,total:0,water:[],npcs:[]},events=[],started=0,elapsed=0,meta=[];
 const snapshot=()=>freeze(structuredClone(state));
 const event=(type,w=null,n=null)=>events.push({type,waterId:w?.id??null,waterName:w?.n??null,npcId:n?.id??null});
 const horn=(n,time)=>{const m=meta[state.npcs.indexOf(n)];if(time-m.horn>=8){m.horn=time;event('horn',null,n);}};
 const claim=(w,owner,n=null,time=elapsed)=>{if(w.owner!==null)return;w.owner=owner;if(owner==='player'){state.captured++;event('capture',w);}else{event('stolen',w,n);horn(n,time);}for(const car of state.npcs)if(car.target===w.id){car.target=null;car.route=[];}};
 const plan=n=>{if(n.target!==null&&state.water.find(w=>w.id===n.target)?.owner===null)return;
  n.target=null;n.route=[];let best=Infinity;
  const reserved=new Set(state.npcs.filter(o=>o!==n).map(o=>o.target));
  for(const w of state.water){if(w.owner!==null||reserved.has(w.id))continue;const route=shortestRoute(graph,n,w);if(!route||distance(route.points.at(-1),w)>rules.captureRadius||route.distance>=best)continue;best=route.distance;n.target=w.id;n.route=route.points.map(p=>({...p}));}
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
  started=clock();elapsed=0;events=[];meta=[];
  state={status:'playing',site:{n:site.n,addr:site.addr,x:site.x,y:site.y},spawn,remaining:rules.roundSeconds,captured:0,total:targets.length,water:targets,npcs:[]};
  for(let i=0;i<rules.npcCount&&near.length;i++){const s=near[i]??near[0],p=project(graph,s)?.q??s;state.npcs.push({id:`npc${i+1}`,x:p.x,y:p.y,direction:{x:0,y:0},active:false,target:null,route:[]});meta.push({delay:rules.npcDelaySeconds+(i>=near.length?rules.npcStaggerSeconds:0),horn:-Infinity});}
  return snapshot();
 }
 function tick(dt,player){
  if(state.status!=='playing')return snapshot();
  const now=Math.max(elapsed,(clock()-started)/1000);if(!Number.isFinite(now))throw new Error('時鐘無效');
  if(now>=rules.roundSeconds){state.remaining=0;state.status='finished';event('finish');return snapshot();}
  if(!Number.isFinite(dt)||dt<0)throw new Error('dt 秒數無效');
  if(pointOK(player))for(const w of state.water)if(distance(player,w)<=rules.captureRadius)claim(w,'player');
  const begin=Math.max(elapsed,now-dt);
  // Small chronological steps prevent one car consuming the whole stalled-frame budget first.
  for(let time=begin;time<now-1e-9;){const end=Math.min(now,time+.1);
   for(let i=0;i<state.npcs.length;i++){const n=state.npcs[i],m=meta[i];if(end<m.delay)continue;n.active=true;plan(n);let budget=Math.max(0,end-Math.max(time,m.delay))*rules.runSpeed*rules.npcSpeedRatio;
    while(n.route.length){const p=n.route[0],d=distance(n,p);if(d>1e-8)n.direction={x:(p.x-n.x)/d,y:(p.y-n.y)/d};if(d>budget+1e-8){n.x+=n.direction.x*budget;n.y+=n.direction.y*budget;break;}n.x=p.x;n.y=p.y;budget=Math.max(0,budget-d);n.route.shift();}
    if(pointOK(player)&&distance(n,player)<=50)horn(n,end);
    const w=state.water.find(w=>w.id===n.target);if(w&&distance(n,w)<=rules.captureRadius){claim(w,n.id,n,end);plan(n);}
   }time=end;
  }
  elapsed=now;state.remaining=rules.roundSeconds-now;
  for(let i=0;i<state.npcs.length;i++){const n=state.npcs[i];n.active=now>=meta[i].delay;if(n.active){plan(n);if(pointOK(player)&&distance(n,player)<=50)horn(n,now);}}
  return snapshot();
 }
 return Object.freeze({start,tick,getState:snapshot,drainEvents(){const out=events;events=[];return out;}});
}
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const pointOK = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
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
  const length=distance(a,b);edges.push({a,b,length});a.links.push({node:b,length});b.links.push({node:a,length});
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
