import {atlasFrame,circleIntersectsPoly,stepMove,nearestRoad} from './core.mjs?v=6b1';
import {createMusicPlayer} from './music.mjs?v=6b1';
import {RULES,createRace} from './race.mjs?v=6b1';
import {localTestRate} from './qa-clock.mjs?v=6b1';
import {missionCandidates,resolveFireSite,waterCellKeys,decodeWaterCells,selectObjectives,waterLabel} from './missions.mjs?v=6b1';
const testRate=localTestRate(window.location);
const $=id=>document.getElementById(id), canvas=$('game'), ctx=canvas.getContext('2d'), mini=$('minimap').getContext('2d');
const keys=new Set(), cache=new Map(), pending=new Map(), failed=new Set(), images={};
const joystick={x:0,y:0,active:false};
let stickPointer=null,runPointer=null,runHeld=false,movementSpeed=0,spriteCssHeight=64;
let base, available=new Set(), ready=false, x=0,y=0,direction='down',moving=false,character='rhino',station='',viewWidthMeters=175,zoom=1, width=640,height=360, previous=0, walkingTime=0, arrival=0, nearbyKey='', messageTimer;
// World distances and collision stay in metres; sprite display size stays in CSS pixels.
const walkSpeed=5,runSpeed=10,metersPerUnit=1,collisionRadius=.32;
const music=createMusicPlayer();
let musicError=false;
let sites=[],water=[],waterKeys=[],race=null,siteIndex=-1,introAt=0,introSite=null,tense=false;
const pinnedCells=new Set();
let roadsVersion=0,roadsAt=-1,roadCache=[];
function updateMusicUI(){
  const s=music.getState(),hasError=musicError||Boolean(s.error);
  $('music-toggle').textContent=hasError?'音樂重試':s.muted?'開啟音樂':'靜音';
  $('music-toggle').setAttribute('aria-pressed',String(s.muted));
  $('music-status').textContent=hasError?'音樂尚未開啟，點音樂重試':s.muted?'音樂已靜音':s.playing?'音樂播放中':'音樂尚未開啟';
}
function playMusic(){
  musicError=false;
  try{Promise.resolve(music.play(phase==='result'?'result':tense?'tense':'explore')).then(updateMusicUI).catch(()=>{musicError=true;updateMusicUI();});}
  catch(e){musicError=true;updateMusicUI();}
}
$('music-toggle').addEventListener('click',()=>{clearInput();const s=music.getState();if(musicError||s.error){music.setMuted(false);playMusic();}else music.setMuted(!s.muted);updateMusicUI();if(ready&&!inputModalOpen())canvas.focus({preventScroll:true});});
function musicAction(action,arg){try{Promise.resolve(music[action](arg)).catch(()=>{musicError=true;updateMusicUI();});}catch(e){musicError=true;updateMusicUI();}}
let phase='select',bootstrapped=false,difficulty='normal';
let missionAt=0,tutorialStep=0;
const tutorialText=['走路：左搖桿或方向鍵／WASD移動，按住跑鍵奔跑。','佈線佔水源：靠近目標水源3m內會佈線，完成才佔領；五分鐘盡量多佔。','小心消防車：20秒後出動，會搶走尚未佔領的水源。'];
function beginIntro(){phase='intro';introAt=performance.now();$('intro').hidden=false;$('tutorial-card').hidden=true;$('mission-card').hidden=true;clearInput();}
function finishMission(){
 if(phase!=='mission')return;$('mission-card').hidden=true;
 let taught=false;try{taught=localStorage.getItem('rhino-tutorial-v2')==='done';}catch{}
 if(taught){beginIntro();return;}phase='tutorial';tutorialStep=0;$('tutorial-card').hidden=false;$('tutorial-text').textContent=tutorialText[0];
}
$('mission-skip').addEventListener('click',finishMission);
$('tutorial-next').addEventListener('click',()=>{if(phase!=='tutorial')return;if(++tutorialStep<3){$('tutorial-text').textContent=tutorialText[tutorialStep];return;}try{localStorage.setItem('rhino-tutorial-v2','done');}catch{}beginIntro();});
const cellKey=(px,py)=>`${Math.floor(px/base.cs)}_${Math.floor(py/base.cs)}`;
function message(text,timeout=0){clearTimeout(messageTimer);$('message').textContent=(testRate===5?'本機測試 ×5'+(text?'｜':''):'')+text;if(timeout)messageTimer=setTimeout(()=>message(''),timeout);}
if(testRate===5)message('');
async function loadCell(key){
  if(cache.has(key)){const data=cache.get(key);cache.delete(key);cache.set(key,data);return data;}
  if(!available.has(key)||failed.has(key))return null;
  if(pending.has(key))return pending.get(key);
  const promise=fetch(`./data/c/${key}.json`).then(r=>{if(!r.ok)throw Error('街區讀取失敗');return r.json();}).then(data=>{
    data.builds=(data.builds||[]).map(b=>({...b,bounds:bounds(b.p)}));cache.set(key,data);roadsVersion++;
    while(cache.size>25){const victim=[...cache.keys()].find(k=>!pinnedCells.has(k));if(!victim)break;cache.delete(victim);}
    return data;
  }).catch(error=>{console.warn(key,error);failed.add(key);message('這一段街區暫時無法讀取，請稍後重新整理。',5000);return null;}).finally(()=>pending.delete(key));
  pending.set(key,promise);return promise;
}
function bounds(p){let l=Infinity,r=-Infinity,b=Infinity,t=-Infinity;for(let i=0;i<p.length;i+=2){l=Math.min(l,p[i]);r=Math.max(r,p[i]);b=Math.min(b,p[i+1]);t=Math.max(t,p[i+1]);}return [l,b,r,t];}
function neighbors(px,py){const a=Math.floor(px/base.cs),b=Math.floor(py/base.cs),out=[];for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const k=`${a+i}_${b+j}`;if(available.has(k))out.push(k);}return out;}
async function loadNearby(px,py){return Promise.all(neighbors(px,py).map(loadCell));}
function releaseCapture(element,id){if(id!==null&&element.hasPointerCapture?.(id))element.releasePointerCapture(id);}
function clearInput(){
  const left=stickPointer,right=runPointer;stickPointer=runPointer=null;
  keys.clear();joystick.x=joystick.y=0;joystick.active=false;runHeld=false;moving=false;movementSpeed=0;
  showStick();$('run').classList.remove('pressed');
  releaseCapture($('joystick'),left);releaseCapture($('run'),right);
}
function inputModalOpen(){return ['start-screen','overview-dialog','result-dialog','music-settings-dialog'].some(id=>$(id).open);}
function inputBlocked(){return !ready||phase!=='playing'||inputModalOpen();}
$('music-settings').addEventListener('click',()=>{if(inputModalOpen())return;clearInput();updateMusicUI();$('music-settings-dialog').showModal();$('music-toggle').focus();});
$('music-settings-close').addEventListener('click',()=>{clearInput();$('music-settings-dialog').close();if(ready&&!inputModalOpen())canvas.focus({preventScroll:true});});
$('music-settings-dialog').addEventListener('close',()=>{clearInput();if(ready&&!inputModalOpen())canvas.focus({preventScroll:true});});
async function goStation(name){
  if(!sites.length)return;
  const token=++arrival;ready=false;phase='loading';clearInput();station=name;message('沿著街角，準備出發…');
  try{
  failed.clear();
  const candidates=missionCandidates(sites,base.stations.find(s=>s.name===name));
  if(!candidates.length)throw Error('所選分隊沒有可用場所，請換分隊或重試');
  let next=Math.floor(Math.random()*candidates.length);if(candidates[next]===sites[siteIndex]&&candidates.length>1)next=(next+1)%candidates.length;introSite=candidates[next];siteIndex=sites.indexOf(introSite);tense=false;race=null;
  // Previous round corridors may exceed the LRU budget. Release them BEFORE
  // loading the new fire cells, otherwise every new cell evicts itself.
  pinnedCells.clear();
  await loadNearby(introSite.x,introSite.y);if(token!==arrival)return;
  introSite=resolveFireSite(introSite,cachedGeometry().builds);
  // Pin the resolved fire surroundings and road corridors; retain the real geometry for NPC routing.
  const pinRect=(l,b,r,t)=>{for(const key of available){const [a,c]=key.split('_').map(Number);if((a+1)*base.cs>=l&&a*base.cs<=r&&(c+1)*base.cs>=b&&c*base.cs<=t)pinnedCells.add(key);}};
  pinRect(introSite.x-500,introSite.y-500,introSite.x+500,introSite.y+500);
  const nearest=[...base.stations].sort((a,b)=>Math.hypot(a.x-introSite.x,a.y-introSite.y)-Math.hypot(b.x-introSite.x,b.y-introSite.y)).slice(0,2);
  for(const s of nearest){const d=Math.hypot(s.x-introSite.x,s.y-introSite.y),steps=Math.max(1,Math.ceil(d/(base.cs/2)));for(let i=0;i<=steps;i++){const px=introSite.x+(s.x-introSite.x)*i/steps,py=introSite.y+(s.y-introSite.y)*i/steps;pinRect(px-base.cs,py-base.cs,px+base.cs,py+base.cs);}}
  await Promise.all([...pinnedCells].map(loadCell));if(token!==arrival)return;
  if(!cache.has(cellKey(introSite.x,introSite.y))||[...pinnedCells].some(k=>!cache.has(k)))throw Error('本局道路讀取失敗');
  await loadNearby(introSite.x,introSite.y);if(token!==arrival)return;
  const cells=await Promise.all(waterCellKeys(introSite,waterKeys,base.cs,300).map(async key=>{const r=await fetch(`./data/w/${key}.json`);if(!r.ok)throw Error('水源格讀取失敗');return {key,rows:await r.json()};}));if(token!==arrival)return;
  const geometry=cachedGeometry();water=decodeWaterCells(cells,geometry.roads);const objectives=selectObjectives(water,introSite,300,20);
  if(!objectives.length)throw Error('火場300m內沒有可用水源，請重試其他題目');
  race=createRace({sites:[introSite],water:objectives.map(w=>({...w,sourceId:w.id})),stations:base.stations,roads:geometry.roads,buildings:geometry.builds,clock:()=>performance.now()*testRate,random:Math.random,canStand:walkable,config:{targetRadius:300}});
  $('mission-support').hidden=!['復興分隊','永吉分隊'].includes(station);$('mission-support').textContent='周邊支援';
  x=introSite.x;y=introSite.y;direction='down';nearbyKey=cellKey(x,y);phase='mission';missionAt=performance.now();clearInput();$('start-screen').close();$('result-dialog').close();$('intro-address').textContent=`${introSite.n}｜${introSite.addr}`;$('intro').hidden=true;$('mission-detail').textContent=`${introSite.n}｜${introSite.addr}｜${introSite.use||introSite.u||'用途未提供'}`;$('mission-card').hidden=false;message('火警出題！記住地址，搶下周邊水源。',2000);canvas.focus({preventScroll:true});
  }catch(error){if(token!==arrival)return;phase='select';ready=false;race=null;introSite=null;clearInput();$('result-dialog').close();$('mission-card').hidden=true;$('tutorial-card').hidden=true;$('intro').hidden=true;$('start-status').textContent=`${error.message}。請按開始重試。`;$('start-screen').showModal();message('本題暫時無法出勤，請重試。');}
}
function cachedGeometry(){const cells=[...cache.values()];return {roads:cells.flatMap(d=>d.roads||[]),builds:cells.flatMap(d=>d.builds||[])};}
function walkable(px,py){
  const key=cellKey(px,py);
  if(!cache.has(key)){if(available.has(key)&&!failed.has(key))loadCell(key);return false;}
  // Neighbor cells carry crossing footprints; use all nearby loaded footprints.
  for(const k of neighbors(px,py))for(const b of cache.get(k)?.builds||[]){const [l,s,r,n]=b.bounds;if(px>=l-collisionRadius&&px<=r+collisionRadius&&py>=s-collisionRadius&&py<=n+collisionRadius&&circleIntersectsPoly(px,py,collisionRadius,b.p))return false;}
  return true;
}
function resize(){clearInput();const rect=canvas.getBoundingClientRect();width=Math.max(1,Math.round(rect.width/2));height=Math.max(1,Math.round(rect.height/2));canvas.width=width;canvas.height=height;zoom=width/viewWidthMeters;spriteCssHeight=window.matchMedia('(pointer:coarse),(max-width:900px),(max-height:450px)').matches?56:64;ctx.imageSmoothingEnabled=false;}
new ResizeObserver(resize).observe(canvas);
function path(c,p,close=true){c.beginPath();for(let i=0;i<p.length;i+=2)i?c.lineTo(p[i],-p[i+1]):c.moveTo(p[i],-p[i+1]);if(close)c.closePath();}
function polygon(c,p,color){path(c,p);c.fillStyle=color;c.fill();}
function tree(c,tx,ty,size){c.fillStyle='#243d3040';c.fillRect(tx-1,-ty+1,size+2,size/2);c.fillStyle='#745b39';c.fillRect(tx-.6,-ty-1,1.2,3);c.fillStyle='#3e6443';c.fillRect(tx-size/2,-ty-size,size,size*.8);c.fillStyle='#608557';c.fillRect(tx-size/2+1,-ty-size-1,size-1,size*.65);c.fillStyle='#89a261';c.fillRect(tx-size/2+1,-ty-size-1,size*.4,1.5);}
function drawWorld(c,scale,w,h,isMini=false){
  c.fillStyle=isMini?'#94a07b':'#98a67e';c.fillRect(0,0,w,h);c.save();c.translate(w/2,h/2);c.scale(scale,scale);c.translate(-x,y);
  const view=[x-w/2/scale,y-h/2/scale,x+w/2/scale,y+h/2/scale];
  const tiles=[];for(const [key,data] of cache){const [a,b]=key.split('_').map(Number),left=a*base.cs,bottom=b*base.cs;if(left>view[2]||left+base.cs<view[0]||bottom>view[3]||bottom+base.cs<view[1])continue;tiles.push([left,bottom,data]);}
  // All decoration is anchored to source geometry. No generated roads or structures.
  for(const [left,bottom,d]of tiles){c.save();c.beginPath();c.rect(left,-bottom-base.cs,base.cs,base.cs);c.clip();c.fillStyle=isMini?'#c1bd99':'#c9c3a1';c.fillRect(left,-bottom-base.cs,base.cs,base.cs);
    if(!isMini){c.fillStyle='#bdb996';for(let a=Math.ceil(left/16)*16;a<left+base.cs;a+=16)for(let b=Math.ceil(bottom/16)*16;b<bottom+base.cs;b+=16)c.fillRect(a,-b,1,1);}
    for(const p of d.parks||[])polygon(c,p,isMini?'#748b63':'#8fa96c');
    for(const road of d.roads||[]){path(c,road.p,false);c.lineCap='round';c.lineJoin='round';c.strokeStyle='#a29a7c';c.lineWidth=road.w+4;c.stroke();c.strokeStyle='#e1d7b6';c.lineWidth=road.w+2.5;c.stroke();c.strokeStyle=isMini?'#ded9ba':'#92968b';c.lineWidth=road.w;c.stroke();if(!isMini&&road.w>=10){c.save();c.setLineDash([3,5]);c.lineWidth=.5;c.strokeStyle='#ded9b8';c.stroke();c.restore();}}
    if(!isMini){for(const b of d.builds){const p=b.p;if(b.bounds[2]<view[0]||b.bounds[0]>view[2]||b.bounds[3]<view[1]||b.bounds[1]>view[3])continue;c.save();c.translate(2,2);polygon(c,p,'#4a55444f');c.restore();const index=Math.abs(Math.floor(b.bounds[0]/13+b.bounds[1]/17))%5;const palette=['#b66d50','#c28c62','#79958a','#c7b479','#9f6656'];polygon(c,p,b.k==='fs'?'#b65944':palette[index]);path(c,p);c.lineWidth=.8;c.strokeStyle='#665e48';c.stroke();c.save();c.clip();const mid=(b.bounds[1]+b.bounds[3])/2;c.strokeStyle='#f0d3a34a';c.lineWidth=1.1;c.beginPath();c.moveTo(b.bounds[0],-mid);c.lineTo(b.bounds[2],-mid);c.stroke();c.fillStyle='#fff0bd40';c.fillRect(b.bounds[0]+1,-b.bounds[3]+1,Math.max(0,b.bounds[2]-b.bounds[0]-2),1.2);c.strokeStyle='#563e3225';c.lineWidth=.45;for(let tile=-b.bounds[3]+4;tile<-b.bounds[1];tile+=4){c.beginPath();c.moveTo(b.bounds[0],tile);c.lineTo(b.bounds[2],tile);c.stroke();}c.fillStyle='#49625a';if(b.bounds[2]-b.bounds[0]>10&&b.bounds[3]-b.bounds[1]>10){const rx=(b.bounds[0]+b.bounds[2])/2,ry=-mid;c.fillRect(rx-2.5,ry-2,5,3);c.fillStyle='#d7e2c5';c.fillRect(rx-2,ry-2,4,1);c.fillStyle='#4e6559';for(let wx=b.bounds[0]+3;wx<b.bounds[2]-2;wx+=5)c.fillRect(wx,-b.bounds[1]-3,2,1.5);}c.restore();}
      for(const list of [d.pt||[],d.st||[]])for(let i=0;i<list.length;i+=3){if(list[i]<view[0]||list[i]>view[2]||list[i+1]<view[1]||list[i+1]>view[3])continue;tree(c,list[i],list[i+1],4*(list[i+2]||1));}

    }c.restore();
  }
  if(!isMini){for(const s of base.stations){if(Math.abs(s.bx-x)>w/scale||Math.abs(s.by-y)>h/scale)continue;c.save();c.translate(s.bx,-s.by);c.scale(1/scale,1/scale);c.fillStyle='#f2e4c3';c.fillRect(-30,-18,60,12);c.strokeStyle='#85614b';c.lineWidth=.75;c.strokeRect(-30,-18,60,12);c.fillStyle='#8b4438';c.font='7px sans-serif';c.textAlign='center';c.fillText(s.name,0,-9.5);c.restore();}}
  c.restore();
}
let overviewPromise, overviewData, roadName='巷弄／未命名道路',intersectionKey='',intersectionUntil=0;
function loadedRoads(){if(roadsAt===roadsVersion)return roadCache;const seen=new Set();roadCache=[...cache.values()].flatMap(d=>d.roads||[]).filter(r=>{const key=r.n+'|'+r.p.join(',');if(seen.has(key))return false;seen.add(key);return true;}).map(r=>({...r,labelBounds:bounds(r.p)}));roadsAt=roadsVersion;return roadCache;}
function drawRoadSigns(c,scale,w,h){
  const ratio=w/canvas.getBoundingClientRect().width,boxes=[],placed=new Map();
  c.save();c.textAlign='center';c.textBaseline='middle';
  for(const road of loadedRoads()){
    if(!road.n)continue;const [l,b,r,t]=road.labelBounds;if(l>x+w/2/scale||r<x-w/2/scale||b>y+h/2/scale||t<y-h/2/scale)continue;
    let length=0;for(let i=2;i<road.p.length;i+=2)length+=Math.hypot(road.p[i]-road.p[i-2],road.p[i+1]-road.p[i-1]);
    let along=0,next=Math.min(60,length/2);
    for(let i=2;i<road.p.length;i+=2){const ax=road.p[i-2],ay=road.p[i-1],dx=road.p[i]-ax,dy=road.p[i+1]-ay,len=Math.hypot(dx,dy);
      while(next<=along+len){const f=(next-along)/len,px=w/2+(ax+dx*f-x)*scale,py=h/2-(ay+dy*f-y)*scale;next+=120;
        const size=(road.w>=10?26:18)*ratio;c.font=`bold ${size}px sans-serif`;
        const tw=[...road.n].length*size,box=[px-tw/2-6*ratio,py-size/2-4*ratio,tw+12*ratio,size+8*ratio];
        if(box[0]<0||box[1]<0||box[0]+box[2]>w||box[1]+box[3]>h)continue;
        if((placed.get(road.n)||[]).some(p=>Math.hypot(px-p[0],py-p[1])<120*scale))continue;
        if(boxes.some(b=>box[0]<b[0]+b[2]+8*ratio&&box[0]+box[2]+8*ratio>b[0]&&box[1]<b[1]+b[3]+8*ratio&&box[1]+box[3]+8*ratio>b[1]))continue;
        boxes.push(box);placed.set(road.n,[...(placed.get(road.n)||[]),[px,py]]);
        c.fillStyle=road.w>=10?'#24644b':'#fff8e8';c.beginPath();c.roundRect(...box,5*ratio);c.fill();c.fillStyle=road.w>=10?'#fff':'#263e39';c.fillText(road.n,px,py);
      }along+=len;
    }
  }c.restore();
}
function checkIntersection(roads){
  const segments=[];for(const r of roads){if(!r.n)continue;for(let i=2;i<r.p.length;i+=2){const a={x:r.p[i-2],y:r.p[i-1]},b={x:r.p[i],y:r.p[i+1]};if(x<Math.min(a.x,b.x)-20||x>Math.max(a.x,b.x)+20||y<Math.min(a.y,b.y)-20||y>Math.max(a.y,b.y)+20)continue;segments.push({a,b,n:r.n});}}
  let near=null;
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){const a=segments[i],b=segments[j];if(a.n===b.n)continue;const ux=a.b.x-a.a.x,uy=a.b.y-a.a.y,vx=b.b.x-b.a.x,vy=b.b.y-b.a.y,den=ux*vy-uy*vx;if(Math.abs(den)<1e-8)continue;const dx=b.a.x-a.a.x,dy=b.a.y-a.a.y,t=(dx*vy-dy*vx)/den,u=(dx*uy-dy*ux)/den;if(t<0||t>1||u<0||u>1)continue;const px=a.a.x+t*ux,py=a.a.y+t*uy;if(Math.hypot(px-x,py-y)>20)continue;near={key:`${Math.round(px)}:${Math.round(py)}`,name:(a.n===roadName?b.n:a.n)+'口'};break;}
  const now=performance.now();
  if(near&&near.key!==intersectionKey){intersectionKey=near.key;intersectionUntil=now+1500;$('intersection').textContent=near.name;}
  if(!near)intersectionKey='';$('intersection').hidden=!near||now>=intersectionUntil;
}
function updateLocation(){
  const roads=loadedRoads();roadName=nearestRoad(x,y,roads).name;
  $('road').textContent=roadName;
  checkIntersection(roads);
  const s=base.stations.find(s=>s.name===station);if(!s)return;
  const dx=x-s.x,dy=y-s.y,d=Math.hypot(dx,dy);
  const bearing=d<1?'出發點':(['北','東北','東','東南','南','西南','西','西北'][Math.round(Math.atan2(dx,dy)/(Math.PI/4)+8)%8]+'側');
  $('location').textContent=`${station} · ${Math.round(d)} m · ${bearing}`;
}
function playerArrow(c,px,py,label=true){
  c.save();c.translate(px,py);c.strokeStyle='#263e39';c.lineWidth=3;c.fillStyle='#ffe28a';
  c.beginPath();c.moveTo(0,-8);c.lineTo(6,7);c.lineTo(0,4);c.lineTo(-6,7);c.closePath();c.stroke();c.fill();
  if(label){c.font='bold 10px sans-serif';c.textAlign='center';c.lineWidth=3;c.strokeText('你在這裡',0,20);c.fillText('你在這裡',0,20);}c.restore();
}
function drawOverview(){
  if(!overviewData)return;
  const map=$('overview-map'),w=Math.max(280,Math.round(map.getBoundingClientRect().width)),h=w<600?360:460;
  map.width=w;map.height=h;
  const c=map.getContext('2d');
  const roads=overviewData.roads||[],stations=overviewData.stations||base.stations;
  const points=roads.flatMap(r=>r.p).concat(stations.flatMap(s=>[s.x,s.y]),[x,y]);
  const [l,b,r,t]=bounds(points),scale=Math.min((w-100)/(r-l||1),(h-70)/(t-b||1));
  const px=v=>50+(v-l)*scale,py=v=>h-35-(v-b)*scale;
  c.fillStyle='#c9c3a1';c.fillRect(0,0,w,h);c.strokeStyle='#7d8878';c.lineWidth=1;
  for(const road of roads){c.beginPath();for(let i=0;i<road.p.length;i+=2)i?c.lineTo(px(road.p[i]),py(road.p[i+1])):c.moveTo(px(road.p[i]),py(road.p[i+1]));c.stroke();}
  c.font='12px sans-serif';c.textAlign='center';
  for(const s of stations){const a=px(s.x),b=py(s.y);c.fillStyle='#a44e38';c.fillRect(a-3,b-3,6,6);c.fillStyle='#263e39';c.fillText(s.name,a,b-8);}
  playerArrow(c,px(x),py(y));
}
$('overview-open').addEventListener('click',async()=>{
  clearInput();$('overview-dialog').showModal();
  try{overviewPromise??=fetch('./data/overview.json').then(r=>{if(!r.ok)throw Error('概覽讀取失敗');return r.json();});overviewData=await overviewPromise;$('overview-status').textContent='全轄區真實道路 · 紅點為9個出發分隊 · 北 ↑';drawOverview();}
  catch(e){$('overview-status').textContent='轄區地圖暫時無法讀取，關閉後可重試。';overviewPromise=null;}
});
$('overview-close').addEventListener('click',()=>$('overview-dialog').close());
$('overview-dialog').addEventListener('close',()=>{clearInput();canvas.focus({preventScroll:true});});
function renderScene(){
  if(!base){ctx.fillStyle='#9ca77b';ctx.fillRect(0,0,width,height);return;}
  const sceneZoom=phase==='intro'?zoom*(.2+.8*Math.min(1,(performance.now()-introAt)/2000)):zoom;
  drawWorld(ctx,sceneZoom,width,height);
  drawRoadSigns(ctx,sceneZoom,width,height);drawRace(ctx,sceneZoom,width,height);
  if(ready){ctx.fillStyle='#34483865';ctx.beginPath();ctx.ellipse(width/2,height/2,zoom*collisionRadius,zoom*collisionRadius/2,0,0,Math.PI*2);ctx.fill();const img=images[character];if(img){const f=atlasFrame(direction,moving,walkingTime);const size=spriteCssHeight*width/canvas.getBoundingClientRect().width/80;ctx.drawImage(img,f.sx,f.sy,f.sw,f.sh,Math.round(width/2-32*size),Math.round(height/2-f.footY*size),64*size,80*size);}}
  drawWorld(mini,.16,128,100,true);drawRace(mini,.16,128,100,true);playerArrow(mini,64,50);
  if(ready){updateLocation();$('scale-line').setAttribute('style',`width:${5*zoom*canvas.getBoundingClientRect().width/width}px`);}
  updateMusicUI();
  if(phase==='result')drawResultMap();
}
function update(dt){
  movementSpeed=0;
  if(inputBlocked()){clearInput();return;}
  const pressed=k=>keys.has(k);
  const dx=joystick.active?joystick.x:Number(pressed('ArrowRight')||pressed('d'))-Number(pressed('ArrowLeft')||pressed('a'));
  const dy=joystick.active?joystick.y:Number(pressed('ArrowUp')||pressed('w'))-Number(pressed('ArrowDown')||pressed('s'));
  if(dx||dy){direction=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'up':'down');const next=stepMove({x,y},dx,dy,dt,((joystick.active?runHeld:pressed('Shift')||pressed(' '))?runSpeed:walkSpeed)*testRate,walkable);const distance=Math.hypot(next.x-x,next.y-y);moving=distance>0;movementSpeed=dt>0?distance/dt:0;x=next.x;y=next.y;if(moving)walkingTime+=distance*.16/.55;const k=cellKey(x,y);if(k!==nearbyKey){nearbyKey=k;loadNearby(x,y);}}else moving=false;
}
function waterMark(c,source,px,py,size=1,result=false,index=null,target=true,near=true){
  c.save();c.translate(px,py);c.scale(size,size);c.textAlign='center';
  const owner=source.owner,isPlayer=owner==='player';
  c.globalAlpha=target?1:.25;
  if(target&&near&&!result){c.shadowColor='#ffe64d';c.shadowBlur=12;}
  c.fillStyle=owner?(isPlayer?'#238a50':'#69727a'):target?(Math.floor(performance.now()/500)%2?'#ffe64d':'#fff4a3'):'#d3ddda';
  c.strokeStyle='#263e39';c.lineWidth=1;c.beginPath();c.arc(0,0,10,0,Math.PI*2);c.fill();c.stroke();c.shadowBlur=0;
  c.fillStyle=owner?'#fff':'#176986';c.font='bold 12px sans-serif';c.fillText(({hydrant:'H',tank:'▤',pool:'≋',natural:'≈',other:'◆',pond:'≋',river:'≈'})[source.k]||'◆',0,4);
  if(owner){c.strokeStyle=isPlayer?'#20734b':'#5a6169';c.beginPath();c.moveTo(7,5);c.lineTo(7,-15);c.stroke();c.fillStyle=isPlayer?'#238a50':'#69727a';c.fillRect(7,-15,16,11);c.fillStyle='#fff';c.font='8px sans-serif';c.fillText(isPlayer?'犀':'車',15,-7);}
  if(result||near){c.font='11px sans-serif';c.fillStyle='#fff8e0';c.strokeStyle='#263e39';c.lineWidth=3;const label=result?String(index+1):source.n;c.strokeText(label,0,24);c.fillText(label,0,24);}c.restore();
}
function drawRace(c,scale,w,h,isMini=false){
  const snapshot=race?.getState(),site=snapshot?.site||introSite;if(!site)return;
  const px=v=>w/2+(v-x)*scale,py=v=>h/2-(v-y)*scale,ratio=isMini?1:w/canvas.getBoundingClientRect().width;
  c.save();
  const fx=px(site.x),fy=py(site.y),frame=Math.floor(performance.now()/250),unit=isMini?1:ratio;
  if(!isMini&&introSite?.building){
    const p=introSite.building.p;c.beginPath();
    for(let i=0;i<p.length;i+=2)i?c.lineTo(px(p[i]),py(p[i+1])):c.moveTo(px(p[i]),py(p[i+1]));
    c.closePath();c.fillStyle='#ed443580';c.fill();c.strokeStyle='#ed4435';c.lineWidth=2*ratio;c.stroke();
  }
  // Pixel flames remain visible even when no footprint was within 40m.
  c.save();c.translate(fx,fy);c.scale(unit,unit);
  if(!isMini){c.fillStyle='#252525cc';for(let i=0;i<4;i++){const rise=(frame*3+i*9)%34;c.fillRect(-10+i*5+(frame%3)-1,-18-rise,10+i*2,9+i*2);}}
  c.fillStyle=isMini&&frame%2?'#ffe64d':'#ff6b21';
  for(let i=0;i<3;i++){const tall=(isMini?5:14)+(frame+i)%3*(isMini?1:3);c.fillRect((i-1)*(isMini?2:5)-2,-tall,isMini?3:6,tall);}
  c.fillStyle='#ffe64d';c.fillRect(-2,isMini?-3:-8,isMini?2:4,isMini?3:8);c.restore();
  if(!isMini){
    c.font=`bold ${14*ratio}px sans-serif`;c.textAlign='center';c.fillStyle='#c52e24';
    if(fx<0||fx>w||fy<0||fy>h){
      const dx=fx-w/2,dy=fy-h/2,margin=24*ratio,t=Math.min((w/2-margin)/Math.abs(dx||1e-9),(h/2-margin)/Math.abs(dy||1e-9));
      const ax=w/2+dx*t,ay=h/2+dy*t;c.save();c.translate(ax,ay);c.rotate(Math.atan2(dy,dx));c.scale(ratio,ratio);
      c.beginPath();c.moveTo(12,0);c.lineTo(-8,-7);c.lineTo(-4,0);c.lineTo(-8,7);c.closePath();c.fill();c.restore();
      c.fillText(`火場 ${Math.round(Math.hypot(site.x-x,site.y-y))} m`,Math.max(48*ratio,Math.min(w-48*ratio,ax)),Math.max(14*ratio,Math.min(h-8*ratio,ay-15*ratio)));
    }else c.fillText('火警',fx,fy-24*ratio);
  }
  // Decode ids are cell-row keys; race ids are numeric and must never be used
  // to match ambient points (names and coordinates can legitimately repeat).
  const targets=new Map((snapshot?.water||[]).map(s=>[s.sourceId,s]));
  const objectiveIds=new Set(selectObjectives(water,introSite,300,20).map(s=>s.id));
  const sources=water.map(s=>({source:targets.get(s.id)||s,target:objectiveIds.has(s.id)}));
  // Ambient sources first, so a dim colocated point cannot cover a target flag.
  sources.sort((a,b)=>Number(a.target)-Number(b.target));
  for(const {source,target}of sources){
    const a=px(source.x),b=py(source.y);if(a<-30||a>w+30||b<-30||b>h+30)continue;
    if(isMini){c.save();c.globalAlpha=target?1:.25;c.fillStyle=source.owner==='player'?'#238a50':source.owner?'#69727a':target?(Math.floor(performance.now()/500)%2?'#ffe64d':'#fff4a3'):'#d3ddda';c.fillRect(a-1,b-1,3,3);c.restore();}
    else waterMark(c,source,a,b,ratio,false,null,target,Math.hypot(source.x-x,source.y-y)<=30);
  }
  for(const npc of snapshot?.npcs||[]){if(!npc.active)continue;const a=px(npc.x),b=py(npc.y);if(isMini){c.fillStyle='#e13232';c.beginPath();c.arc(a,b,3,0,Math.PI*2);c.fill();continue;}c.save();c.translate(a,b);c.rotate(Math.atan2(-npc.direction.y,npc.direction.x));c.scale(ratio,ratio);
    // Original pixel truck: cab faces local +x; roof ladder and two blue lights.
    c.fillStyle='#26363a';c.fillRect(-15,-9,7,4);c.fillRect(8,-9,6,4);c.fillRect(-15,5,7,4);c.fillRect(8,5,6,4);c.fillStyle='#c93d32';c.fillRect(-18,-6,34,12);c.fillStyle='#f3e6c0';c.fillRect(-16,-4,19,2);c.fillRect(-16,2,19,2);c.fillRect(-15,-4,2,8);c.fillRect(-8,-4,2,8);c.fillStyle='#91c9d3';c.fillRect(8,-5,6,10);c.fillStyle='#4e92f0';c.fillRect(5,-6,3,3);c.fillRect(5,3,3,3);c.fillStyle='#ffe398';c.fillRect(15,-5,2,3);c.fillRect(15,2,2,3);c.restore();
  }c.restore();
}
function drawResultMap(){
  const s=race?.getState();if(!s)return;const map=$('result-map'),w=Math.max(280,Math.round(map.getBoundingClientRect().width)),h=360;
  if(map.width!==w)map.width=w;if(map.height!==h)map.height=h;const c=map.getContext('2d');
  const points=[s.site.x-520,s.site.y-520,s.site.x+520,s.site.y+520,...s.water.flatMap(a=>[a.x,a.y])], [l,b,r,t]=bounds(points),scale=Math.min((w-50)/(r-l),(h-50)/(t-b));
  const px=v=>w/2+(v-(l+r)/2)*scale,py=v=>h/2-(v-(b+t)/2)*scale;
  c.fillStyle='#e6dfc5';c.fillRect(0,0,w,h);c.strokeStyle='#a7ad9c';c.lineWidth=2;
  for(const road of loadedRoads()){c.beginPath();for(let i=0;i<road.p.length;i+=2)i?c.lineTo(px(road.p[i]),py(road.p[i+1])):c.moveTo(px(road.p[i]),py(road.p[i+1]));c.stroke();}
  c.fillStyle='#e34232';c.beginPath();c.arc(px(s.site.x),py(s.site.y),6,0,Math.PI*2);c.fill();s.water.forEach((a,i)=>waterMark(c,a,px(a.x),py(a.y),1,true,i));
}
function finishRound(){
  phase='result';ready=false;clearInput();$('overview-dialog').close();$('music-settings-dialog').close();$('intro').hidden=true;musicAction('setState','result');const s=race.getState();
  $('result-score').textContent=`${s.captured} / ${s.total}`;$('result-address').textContent=`${s.site.n}｜${s.site.addr}`;
  $('result-list').textContent=s.water.map((a,i)=>`${i+1}. ${a.n}（${{hydrant:'消防栓',pond:'水池',river:'河川取水點'}[a.k]||a.k}）— ${a.owner==='player'?'犀牛綠旗・已佔領':a.owner?'灰旗・消防車已搶走':'閃黃・未找到'}`).join('\n');
  $('result-dialog').showModal();drawResultMap();
}
function tickRace(dt){
  if(phase==='mission'&&performance.now()-missionAt>=3000)finishMission();
  if(phase==='intro'&&performance.now()-introAt>=2000){
    try{race.start(0);const s=race.getState();x=s.spawn.x;y=s.spawn.y;nearbyKey=cellKey(x,y);phase='playing';ready=true;$('intro').hidden=true;message('出發！靠近水源 3m 內佈線，完成才佔領。',2600);}
    catch(error){phase='select';ready=false;race=null;introSite=null;clearInput();$('intro').hidden=true;$('mission-card').hidden=true;$('tutorial-card').hidden=true;$('start-status').textContent=`出生失敗：${error.message}。請按開始重試。`;$('start-game').disabled=false;$('start-screen').showModal();message('本題暫時無法出勤，請重試。');return;}
  }
  if(phase!=='playing'||!race)return;
  race.tick(dt*testRate,{x,y});const s=race.getState();const seconds=Math.max(0,Math.ceil(s.remaining));$('countdown').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;$('captured').textContent=`已佔 ${s.captured}/${s.total}`;
  if(s.remaining<=60&&!tense){tense=true;musicAction('setState','tense');}
  for(const e of race.drainEvents()){if(e.type==='capture'){musicAction('cue','capture');message(`犀牛插旗！${e.waterName} +1`,2200);}if(e.type==='stolen'){musicAction('cue','lost');message(`${e.waterName}被搶走了`,2600);}if(e.type==='horn')musicAction('cue','horn');}
  if(s.status==='finished')finishRound();
}
function loop(now){const dt=previous?(now-previous)/1000:0;previous=now;update(dt);tickRace(dt);renderScene();requestAnimationFrame(loop);}
const movementKeys=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','Shift',' ']);
window.addEventListener('keydown',e=>{if(inputBlocked()||e.target.closest('select,input,summary,button'))return;const key=e.key.length===1?e.key.toLowerCase():e.key;if(movementKeys.has(key)){e.preventDefault();keys.add(key);}});
window.addEventListener('keyup',e=>keys.delete(e.key.length===1?e.key.toLowerCase():e.key));
window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{clearInput();previous=0;});
window.addEventListener('resize',resize);
const stick=$('joystick');
function showStick(){ $('stick-knob').setAttribute('style',`transform:translate(${joystick.x*44}px,${-joystick.y*44}px)`); }
function moveStick(e){
  if(e.pointerId!==stickPointer)return;
  e.preventDefault();const r=stick.getBoundingClientRect();
  const dx=(e.clientX-r.left-r.width/2)/44,dy=-(e.clientY-r.top-r.height/2)/44;
  const length=Math.hypot(dx,dy),divisor=Math.max(1,length);
  joystick.x=length<.12?0:dx/divisor;joystick.y=length<.12?0:dy/divisor;showStick();
}
stick.addEventListener('pointerdown',e=>{
  if(inputBlocked()||stickPointer!==null)return;
  stickPointer=e.pointerId;joystick.active=true;stick.setPointerCapture(e.pointerId);moveStick(e);
});
stick.addEventListener('pointermove',moveStick);
function endStick(e){if(e.pointerId!==stickPointer)return;const id=stickPointer;stickPointer=null;joystick.x=joystick.y=0;joystick.active=false;moving=false;movementSpeed=0;showStick();releaseCapture(stick,id);}
stick.addEventListener('pointerup',endStick);
for(const type of ['pointercancel','lostpointercapture'])stick.addEventListener(type,e=>{if(e.pointerId===stickPointer)clearInput();});
stick.addEventListener('contextmenu',e=>e.preventDefault());
const run=$('run');
run.addEventListener('pointerdown',e=>{if(inputBlocked()||runPointer!==null)return;e.preventDefault();runPointer=e.pointerId;runHeld=true;run.setPointerCapture(e.pointerId);run.classList.add('pressed');});
function endRun(e){if(e.pointerId!==runPointer)return;const id=runPointer;runPointer=null;runHeld=false;run.classList.remove('pressed');releaseCapture(run,id);}
run.addEventListener('pointerup',endRun);
for(const type of ['pointercancel','lostpointercapture'])run.addEventListener(type,e=>{if(e.pointerId===runPointer)clearInput();});
run.addEventListener('contextmenu',e=>e.preventDefault());

$('zoom-in').addEventListener('click',()=>{viewWidthMeters=Math.max(100,viewWidthMeters-25);zoom=width/viewWidthMeters;canvas.focus({preventScroll:true});});$('zoom-out').addEventListener('click',()=>{viewWidthMeters=Math.min(250,viewWidthMeters+25);zoom=width/viewWidthMeters;canvas.focus({preventScroll:true});});
for(const b of document.querySelectorAll('[data-start-character]'))b.addEventListener('click',()=>{character=b.dataset.startCharacter;document.querySelectorAll('[data-start-character]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));});
$('settings').addEventListener('click',()=>{++arrival;ready=false;phase='select';race=null;introSite=null;$('mission-card').hidden=true;$('tutorial-card').hidden=true;$('intro').hidden=true;clearInput();$('start-game').disabled=!bootstrapped;$('start-screen').showModal();$('start-game').focus();});
$('start-screen').addEventListener('cancel',e=>e.preventDefault());
$('start-game').addEventListener('click',async()=>{if(phase!=='select')return;if(!bootstrapped){await boot();return;}difficulty=['easy','normal','hard'].includes($('start-difficulty').value)?$('start-difficulty').value:'normal';tense=false;playMusic();$('start-game').disabled=true;await goStation($('start-station').value);$('start-game').disabled=false;});
$('next-round').addEventListener('click',async()=>{if(phase!=='result')return;tense=false;phase='loading';playMusic();$('next-round').disabled=true;await goStation(station);$('next-round').disabled=false;});
$('result-dialog').addEventListener('cancel',e=>e.preventDefault());
Object.defineProperty(window,'__game',{value:Object.freeze({getState:()=>({ready,phase,difficulty,tutorialStep,testRate,spawnName:station,nearestRoad:roadName,walkSpeed,runSpeed,spriteCssHeight,metersPerUnit,collisionRadius,joystick:{...joystick},runHeld,movementSpeed,music:music.getState(),race:race?.getState()||null,x,y,direction,moving,character,station,loadedCells:[...cache.keys()],pendingCells:pending.size,zoom,viewWidthMeters}),renderScene})});
async function boot(){
  $('start-game').disabled=true;
  try{
    const response=await fetch('./data/base.json');if(!response.ok)throw Error('地圖尚未準備完成');base=await response.json();available=new Set(base.cells);
    [sites,waterKeys]=await Promise.all(['sites','w/index'].map(async name=>{const r=await fetch(`./data/${name}.json`);if(!r.ok)throw Error('題目與水源尚未準備完成');return r.json();}));

    await Promise.all(['male','female','rhino'].map(name=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{images[name]=image;const c=document.querySelector(`[data-character="${name}"] canvas`),p=c.getContext('2d');p.imageSmoothingEnabled=false;const f=atlasFrame('down',false,0);p.drawImage(image,f.sx,f.sy,64,80,0,0,64,80);resolve();};image.onerror=()=>reject(Error('角色圖像尚未準備完成'));image.src=`./assets/${name}.png`;})));
    for(const s of base.stations){const option=document.createElement('option');option.value=s.name;option.textContent=s.name;$('start-station').append(option);}
    $('start-station').value=base.stations.find(s=>s.name.includes('莊敬'))?.name||base.stations[0].name;
    bootstrapped=true;$('start-game').disabled=false;$('start-game').textContent='開始搶水源';$('start-status').textContent='手機左搖桿走路，同時按住右側「跑」奔跑；電腦方向鍵／WASD走動，Shift奔跑。';
  }catch(e){console.error(e);$('start-status').textContent=`${e.message}。請按重試載入。`;$('start-game').textContent='重試載入';$('start-game').disabled=false;}
}
resize();$('start-screen').showModal();requestAnimationFrame(loop);boot();
