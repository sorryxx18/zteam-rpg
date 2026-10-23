import {circleIntersectsPoly} from './core.mjs';
export const ART=Object.freeze({fire_engine:[75,64,4,2],ladder_truck:[112,64,1,2],ambulance:[63,56,2,2],police_car:[63,48,2,2],bystanders:[52,70,4,3],fire_big:[68,96,1,4],fire_small:[23,32,1,4],water_icons:[41,40,1,5],rhino_flag:[41,40,1,2]});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function vehicleDimensions(kind,row=0){
 const length={fire_engine:9,ladder_truck:12,ambulance:6,police_car:5}[kind],pixels=kind==='fire_engine'?([62,72,72,60][row]):kind==='ladder_truck'?108:kind==='ambulance'?(row?54:61):(row?47:61),[w,h]=ART[kind];return {length,width:w*length/pixels,height:h*length/pixels};
}
// World dimensions above are scenery anchors only. Display size follows the character.
export function vehicleDisplayDimensions(kind,row=0,playerHeight=64){
 const anchor=vehicleDimensions(kind,row),length=playerHeight*{fire_engine:1.3,ladder_truck:1.6,ambulance:1.1,police_car:1}[kind],factor=length/anchor.length;
 return {length,width:anchor.width*factor,height:anchor.height*factor};
}
const vehicleRow=q=>Math.abs(q.dx)>=Math.abs(q.dy)?(q.dx<0?1:2):(q.dy>0?3:0);
export const crowdSpriteHeight=(scale,ratio)=>Math.min(48*ratio,10*scale);
export const crowdCount=seconds=>Math.min(15,6+Math.floor(Math.max(0,seconds)/45)*3);
export const crowdSpeedFactor=(scene,seconds,player)=>scene?.people.slice(0,crowdCount(seconds)).some(p=>dist(p,player)<=1.5)?.6:1;
function projection(q,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/(dx*dx+dy*dy||1)));return {x:a.x+dx*t,y:a.y+dy*t,t};}
export function createIncident({site,roads=[],water=[],canStand=()=>true}){
 const p=site.building?.p,centre=p?{x:p.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/(p.length/2),y:p.filter((_,i)=>i%2===1).reduce((a,b)=>a+b,0)/(p.length/2)}:{x:site.x,y:site.y};
 const boundaryDistance=q=>{if(!p)return dist(q,centre);if(circleIntersectsPoly(q.x,q.y,0,p))return 0;let d=Infinity;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)d=Math.min(d,dist(q,projection(q,{x:p[j],y:p[j+1]},{x:p[i],y:p[i+1]})));return d;};
 const candidates=[],add=q=>{const d=boundaryDistance(q);if(d>=8-1e-8&&d<=25+1e-8&&canStand(q.x,q.y))candidates.push(q);};
 const span=p?Math.max(...p.map((v,i)=>Math.abs(v-(i%2?centre.y:centre.x))))+40:65;
 for(const road of roads)for(let i=2;i<road.p.length;i+=2){const a={x:road.p[i-2],y:road.p[i-1]},b={x:road.p[i],y:road.p[i+1]},len=dist(a,b);if(!len||dist(centre,projection(centre,a,b))>span)continue;const t=projection(centre,a,b).t,l=Math.max(0,t-span/len),r=Math.min(1,t+span/len),steps=Math.max(1,Math.ceil((r-l)*len/4));for(let j=0;j<=steps;j++){const f=l+(r-l)*j/steps;add({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,dx:(b.x-a.x)/len,dy:(b.y-a.y)/len,onRoad:true});}}
 if(p){for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const a={x:p[j],y:p[j+1]},b={x:p[i],y:p[i+1]},len=dist(a,b);if(!len)continue;for(let k=0;k<=Math.ceil(len/8);k++){const f=k/Math.ceil(len/8),x=a.x+(b.x-a.x)*f,y=a.y+(b.y-a.y)*f;for(const side of [-1,1])for(const gap of [12,20])add({x:x+(b.y-a.y)/len*gap*side,y:y-(b.x-a.x)/len*gap*side,dx:(b.x-a.x)/len,dy:(b.y-a.y)/len,onRoad:false});}}}
 else for(let i=0;i<24;i++)add({x:centre.x+20*Math.cos(i*Math.PI/12),y:centre.y+20*Math.sin(i*Math.PI/12),dx:1,dy:0,onRoad:false});
 const vehicles=[];
 for(const kind of ['fire_engine','fire_engine','ladder_truck','ambulance','police_car']){const row=q=>kind==='fire_engine'?vehicleRow(q):kind==='ladder_truck'?0:Number(Math.abs(q.dy)>Math.abs(q.dx)),size=q=>vehicleDimensions(kind,row(q)),angle=vehicles.length*2*Math.PI/5,angleGap=q=>Math.abs(Math.atan2(Math.sin(Math.atan2(q.y-centre.y,q.x-centre.x)-angle),Math.cos(Math.atan2(q.y-centre.y,q.x-centre.x)-angle)));const available=candidates.filter(q=>vehicles.every(v=>{const a=size(q),b=vehicleDimensions(v.kind,v.row);return dist(q,v)>=Math.hypot(a.width,a.height)/2+Math.hypot(b.width,b.height)/2+Math.max(a.length,b.length)/2;}));available.sort((a,b)=>Number(b.onRoad)-Number(a.onRoad)||angleGap(a)-angleGap(b)||dist(a,centre)-dist(b,centre));if(available[0])vehicles.push({...available[0],kind,row:row(available[0])});}
 const front=[...candidates].sort((a,b)=>Number(b.onRoad)-Number(a.onRoad)||dist(a,centre)-dist(b,centre))[0];
 const commander=candidates.filter(q=>q.onRoad&&boundaryDistance(q)>=10&&boundaryDistance(q)<=15&&water.every(w=>dist(q,w)>=5)).sort((a,b)=>dist(a,front||centre)-dist(b,front||centre))[0]??null;
 const commanderDistance=commander?dist(commander,centre):1,cordonFront=commander?{...commander,x:commander.x+2*(commander.x-centre.x)/commanderDistance,y:commander.y+2*(commander.y-centre.y)/commanderDistance}:front;
 const cordon=cordonFront?{a:{x:cordonFront.x-cordonFront.dx*12,y:cordonFront.y-cordonFront.dy*12},b:{x:cordonFront.x+cordonFront.dx*12,y:cordonFront.y+cordonFront.dy*12}}:null,people=[];
 if(front){const outward=(-front.dy*(front.x-centre.x)+front.dx*(front.y-centre.y))>=0?1:-1,nx=-front.dy*outward,ny=front.dx*outward;for(let i=0;i<80&&people.length<15;i++){const row=Math.floor(i/5),along=(i%5-2)*10+(row%2?5:0),gap=6+row*10,q={x:front.x+front.dx*along+nx*gap,y:front.y+front.dy*along+ny*gap};if(canStand(q.x,q.y)&&!people.some(v=>Math.abs(q.x-v.x)<8&&Math.abs(q.y-v.y)<8))people.push({...q,variant:people.length%4,offset:(people.length*1.73)%3,speed:2.6+(people.length%4)*.17});}}
 const fires=p?Array.from({length:4},(_,i)=>{const a=Math.floor(i*(p.length/2)/4)*2,b=(a+2)%p.length;return {x:(p[a]+p[b])/2,y:(p[a+1]+p[b+1])/2};}):[];
 return {centre,vehicles,cordon,people,fires,commander};
}
