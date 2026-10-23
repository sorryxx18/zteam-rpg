import {atlasFrame,circleIntersectsPoly,stepMove,nearestRoad,COLLISION_RADIUS,nearestStandableRoad} from './core.mjs?v=6v32e';
import {createMusicPlayer} from './music.mjs?v=6v32e';
import {RULES,NPC_COUNTS,createRace,findPlayerSpawn,roundStars,rememberHighScore,competition,rememberRecord} from './race.mjs?v=6v32e';
import {ART,createIncident,crowdCount,crowdSpeedFactor,crowdSpriteHeight,vehicleDisplayDimensions} from './incident.mjs?v=6v32e';
import {localTestRate} from './qa-clock.mjs?v=6v32e';
import {missionCandidates,resolveFireSite,waterCellKeys,decodeWaterCells,selectObjectives,waterLabel,reachableWater,currentHydrant,hydrantAddress} from './missions.mjs?v=6v32e';
import {layoutResultMarkers,createNoticeQueue,layoutVehicleSprites,selectHydrantLabels} from './ui.mjs?v=6v32e';
const notices=createNoticeQueue();
const testRate=localTestRate(window.location);
import {createCommanderDialogue,commanderBubbleLines} from './commander.mjs?v=6v32e';
const $=id=>document.getElementById(id), canvas=$('game'), ctx=canvas.getContext('2d'), mini=$('minimap').getContext('2d');
const keys=new Set(), cache=new Map(), pending=new Map(), failed=new Set(), images={};
const joystick={x:0,y:0,active:false};
let stickPointer=null,runPointer=null,runHeld=false,movementSpeed=0,spriteCssHeight=64,stuckAnchor=null;
let base, available=new Set(), ready=false, x=0,y=0,direction='down',moving=false,character='rhino',station='',viewWidthMeters=175,zoomTouched=false,zoom=1, width=640,height=360, previous=0, walkingTime=0, arrival=0, nearbyKey='', messageTimer;
// World distances and collision stay in metres; sprite display size stays in CSS pixels.
const walkSpeed=3,runSpeed=6,metersPerUnit=1,collisionRadius=COLLISION_RADIUS;
const music=createMusicPlayer();
let musicError=false;
let eligibleMissions=new Set(),captureEffects=[],interceptTimer;
let hydrantLabels=[];
let commanderDialogue=null,commanderRender={visible:false,bubble:'',lines:[]};
let incident=null,borrowAt=-Infinity,crowdFactor=1,renderedSprites=0;
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
const tutorialText=['走路：左搖桿或方向鍵／WASD移動，按住跑鍵奔跑。','佈線佔消防栓：靠近目標消防栓3m內會佈線，完成才佔領；三分半鐘盡量多佔。','小心消防車：5秒後出動，會搶走尚未佔領的消防栓。'];
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
  stuckAnchor=null;
  const left=stickPointer,right=runPointer;stickPointer=runPointer=null;
  keys.clear();joystick.x=joystick.y=0;joystick.active=false;runHeld=false;moving=false;running=false;motionX=motionY=0;movementSpeed=0;
  showStick();$('run').classList.remove('pressed');
  releaseCapture($('joystick'),left);releaseCapture($('run'),right);
}
function inputModalOpen(){return ['start-screen','overview-dialog','result-dialog','music-settings-dialog'].some(id=>$(id).open);}
function inputBlocked(){return !ready||phase!=='playing'||inputModalOpen();}
$('music-settings').addEventListener('click',()=>{if(inputModalOpen())return;clearInput();updateMusicUI();$('music-settings-dialog').showModal();$('music-toggle').focus();});
$('music-settings-close').addEventListener('click',()=>{clearInput();$('music-settings-dialog').close();if(ready&&!inputModalOpen())canvas.focus({preventScroll:true});});
$('music-settings-dialog').addEventListener('close',()=>{clearInput();if(ready&&!inputModalOpen())canvas.focus({preventScroll:true});});
async function goStation(name,fallbackIndex=null,tried=0){
  if(!sites.length)return;
  const token=++arrival;ready=false;phase='loading';notices.clear();camera.x=camera.y=0;dust=[];commanderDialogue=null;clearInput();station=name;message('沿著街角，準備出發…');
  try{
  failed.clear();
  const candidates=missionCandidates(sites,base.stations.find(s=>s.name===name),eligibleMissions);
  if(!candidates.length)throw Error('所選分隊沒有可用場所，請換分隊或重試');
  let next=fallbackIndex??Math.floor(Math.random()*candidates.length);if(fallbackIndex===null&&candidates[next]===sites[siteIndex]&&candidates.length>1)next=(next+1)%candidates.length;introSite=candidates[next];siteIndex=sites.indexOf(introSite);tense=false;race=null;
  // Previous round corridors may exceed the LRU budget. Release them BEFORE
  // loading the new fire cells, otherwise every new cell evicts itself.
  pinnedCells.clear();
  await loadNearby(introSite.x,introSite.y);if(token!==arrival)return;
  introSite=resolveFireSite(introSite,cachedGeometry().builds);
  // Pin the resolved fire surroundings and road corridors; retain the real geometry for NPC routing.
  const pinRect=(l,b,r,t)=>{for(const key of available){const [a,c]=key.split('_').map(Number);if((a+1)*base.cs>=l&&a*base.cs<=r&&(c+1)*base.cs>=b&&c*base.cs<=t)pinnedCells.add(key);}};
  pinRect(introSite.x-500,introSite.y-500,introSite.x+500,introSite.y+500);
  const nearest=[...base.stations].sort((a,b)=>Math.hypot(a.x-introSite.x,a.y-introSite.y)-Math.hypot(b.x-introSite.x,b.y-introSite.y)).slice(0,NPC_COUNTS[difficulty]);
  for(const s of nearest){const d=Math.hypot(s.x-introSite.x,s.y-introSite.y),steps=Math.max(1,Math.ceil(d/(base.cs/2)));for(let i=0;i<=steps;i++){const px=introSite.x+(s.x-introSite.x)*i/steps,py=introSite.y+(s.y-introSite.y)*i/steps;pinRect(px-base.cs,py-base.cs,px+base.cs,py+base.cs);}}
  await Promise.all([...pinnedCells].map(loadCell));if(token!==arrival)return;
  if(!cache.has(cellKey(introSite.x,introSite.y))||[...pinnedCells].some(k=>!cache.has(k)))throw Error('本局道路讀取失敗');
  await loadNearby(introSite.x,introSite.y);if(token!==arrival)return;
  // Include the 3x3 neighbourhood of every possible spawn and its 30m road fallback.
  for(const dx of [-90,0,90])for(const dy of [-90,0,90])for(const key of neighbors(introSite.x+dx,introSite.y+dy))pinnedCells.add(key);
  await Promise.all([...pinnedCells].map(loadCell));if(token!==arrival)return;
  if([...pinnedCells].some(k=>!cache.has(k)))throw Error('出生點周邊建物讀取失敗');
  if(!findPlayerSpawn(introSite,walkable,30,loadedRoads())){if(tried+1<candidates.length)return goStation(name,(next+1)%candidates.length,tried+1);throw Error('本分隊暫無可用任務，請選其他分隊');}
  const cells=await Promise.all(waterCellKeys(introSite,waterKeys,base.cs,500).map(async key=>{const r=await fetch(`./data/w/${key}.json`,{cache:'no-cache'});if(!r.ok)throw Error('消防栓格讀取失敗');return {key,rows:await r.json()};}));if(token!==arrival)return;
  const geometry=cachedGeometry();water=reachableWater(decodeWaterCells(cells,geometry.roads),walkable,RULES.captureRadius);const objectives=selectObjectives(water,introSite,300,10);
  if(!objectives.length)throw Error('火場300m內沒有可用消防栓，請重試其他題目');
  incident=createIncident({site:introSite,roads:geometry.roads,water,canStand:walkable});commanderDialogue=createCommanderDialogue(introSite.n);borrowAt=-Infinity;
  race=createRace({sites:[introSite],water:selectObjectives(water,introSite,500,water.length).map(w=>({...w,sourceId:w.id})),stations:base.stations,roads:geometry.roads,buildings:geometry.builds,clock:()=>performance.now()*testRate,random:Math.random,canStand:walkable,config:{targetRadius:500,waves:true,difficulty,npcSpawnMode:'perimeter'}});
  $('mission-rules').textContent=`任務3分30秒，靠近消防栓3m內佈線，完成才佔領；施工時不能移動，可取消。NPC消防車${NPC_COUNTS[difficulty]}台，5秒後出動。`;
  $('mission-support').hidden=!['復興分隊','永吉分隊'].includes(station);$('mission-support').textContent='周邊支援';
  x=introSite.x;y=introSite.y;direction='down';nearbyKey=cellKey(x,y);phase='mission';missionAt=performance.now();clearInput();$('start-screen').close();$('result-dialog').close();$('intro-address').textContent=`${introSite.n}｜${introSite.addr}`;$('intro').hidden=true;$('mission-detail').textContent=`${introSite.n}｜${introSite.addr}｜${introSite.use||introSite.u||'用途未提供'}`;$('mission-card').hidden=false;message('火警出題！記住地址，搶下周邊消防栓。',2000);canvas.focus({preventScroll:true});
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
const paceEffects={animation:true,dust:true,camera:true},camera={x:0,y:0};
let running=false,motionX=0,motionY=0,dustClock=0,dust=[];
function sceneCenter(isMini=false){return {x:x+(!isMini&&phase==='playing'?camera.x:0),y:y+(!isMini&&phase==='playing'?camera.y:0)};}
function updatePace(dt){
 if(!(dt>0&&dt<=.25))return;
 dust=dust.map(p=>({...p,age:p.age+dt})).filter(p=>p.age<.4);
 const active=phase==='playing'&&running,n=Math.hypot(motionX,motionY),limit=viewWidthMeters*.15,k=1-Math.exp(-dt*10);
 const tx=active&&paceEffects.camera&&n?limit*motionX/n:0,ty=active&&paceEffects.camera&&n?limit*motionY/n:0;
 camera.x+=(tx-camera.x)*k;camera.y+=(ty-camera.y)*k;
 const distance=Math.hypot(camera.x,camera.y);if(distance>limit){camera.x*=limit/distance;camera.y*=limit/distance;}
 const rect=canvas.getBoundingClientRect(),ratio=canvas.width/rect.width,scale=canvas.width/viewWidthMeters,pad=4*ratio,hx=Math.max(0,(canvas.width/2-spriteCssHeight*.4*ratio-pad)/scale),up=Math.max(0,(canvas.height/2-spriteCssHeight*ratio-pad)/scale),down=Math.max(0,(canvas.height/2-pad)/scale);
 camera.x=Math.max(-hx,Math.min(hx,camera.x));camera.y=Math.max(-up,Math.min(down,camera.y));
 if(!paceEffects.camera)camera.x=camera.y=0;
 if(active&&paceEffects.dust){dustClock+=dt;while(dustClock>=.15){dustClock-=.15;dust.push({x,y,age:0});}}else dustClock=0;
}
function drawDust(c,scale,w,h){
 const centre=sceneCenter(),ratio=w/canvas.getBoundingClientRect().width;c.save();c.fillStyle='#b5b5aa';
 for(const p of dust){c.globalAlpha=.35*(1-p.age/.4);for(let i=0;i<3;i++){c.beginPath();c.arc(w/2+(p.x-centre.x)*scale+(i-1)*3*ratio,h/2-(p.y-centre.y)*scale+(2+i%2)*ratio,(1.2+i*.3)*ratio,0,Math.PI*2);c.fill();}}c.restore();
}
for(const [key,label]of Object.entries({animation:'跑步快動畫',dust:'腳下揚塵',camera:'鏡頭前帶'}))$('pace-'+key).addEventListener('click',()=>{paceEffects[key]=!paceEffects[key];$('pace-'+key).setAttribute('aria-pressed',String(paceEffects[key]));$('pace-'+key).textContent=label+'：'+(paceEffects[key]?'開':'關');if(key==='dust'&&!paceEffects[key])dust=[];if(key==='camera'&&!paceEffects[key])camera.x=camera.y=0;});
function resize(){clearInput();const mobile=window.matchMedia('(pointer:coarse),(max-width:900px),(max-height:450px)').matches;if(!zoomTouched)viewWidthMeters=mobile?80:175;const rect=canvas.getBoundingClientRect();width=Math.max(1,Math.round(rect.width/2));height=Math.max(1,Math.round(rect.height/2));canvas.width=width;canvas.height=height;zoom=width/viewWidthMeters;spriteCssHeight=window.matchMedia('(pointer:coarse),(max-width:900px),(max-height:450px)').matches?56:64;ctx.imageSmoothingEnabled=false;}
new ResizeObserver(resize).observe(canvas);
function path(c,p,close=true){c.beginPath();for(let i=0;i<p.length;i+=2)i?c.lineTo(p[i],-p[i+1]):c.moveTo(p[i],-p[i+1]);if(close)c.closePath();}
function polygon(c,p,color){path(c,p);c.fillStyle=color;c.fill();}
function tree(c,tx,ty,size){c.fillStyle='#243d3040';c.fillRect(tx-1,-ty+1,size+2,size/2);c.fillStyle='#745b39';c.fillRect(tx-.6,-ty-1,1.2,3);c.fillStyle='#3e6443';c.fillRect(tx-size/2,-ty-size,size,size*.8);c.fillStyle='#608557';c.fillRect(tx-size/2+1,-ty-size-1,size-1,size*.65);c.fillStyle='#89a261';c.fillRect(tx-size/2+1,-ty-size-1,size*.4,1.5);}
function drawWorld(c,scale,w,h,isMini=false){
  const {x,y}=sceneCenter(isMini);
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
  const {x,y}=sceneCenter();
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
  $('road').textContent=roadName;$('road').title=`目前所在：${roadName}`;
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
function distanceScale(sceneZoom,cssWidth,backingWidth){
  const ppm=sceneZoom*cssWidth/backingWidth,target=70/ppm;
  const power=10**Math.floor(Math.log10(target));
  // 1/2/5 has a 2.5x gap: nearest-to-70 yields ~40–100 CSS px.
  const candidates=[1,2,5,10].map(n=>n*power);
  const metres=candidates.reduce((a,b)=>Math.abs(a-target)<=Math.abs(b-target)?a:b);
  return {metres,pixels:metres*ppm};
}
function renderScene(){
 $('commander-bubble').hidden=true;
  updateConstructionUI();
  if(!base){ctx.fillStyle='#9ca77b';ctx.fillRect(0,0,width,height);return;}
  const sceneZoom=phase==='intro'?zoom*(.2+.8*Math.min(1,(performance.now()-introAt)/2000)):zoom;
  drawWorld(ctx,sceneZoom,width,height);
  drawRoadSigns(ctx,sceneZoom,width,height);drawRace(ctx,sceneZoom,width,height);
  const centre=sceneCenter(),playerX=width/2+(x-centre.x)*sceneZoom,playerY=height/2-(y-centre.y)*sceneZoom;drawDust(ctx,sceneZoom,width,height);
  if(ready){ctx.fillStyle='#34483865';ctx.beginPath();ctx.ellipse(playerX,playerY,zoom*.32,zoom*.32/2,0,0,Math.PI*2);ctx.fill();const img=images[character];if(img){const f=atlasFrame(direction,moving,walkingTime);const size=spriteCssHeight*width/canvas.getBoundingClientRect().width/80;ctx.drawImage(img,f.sx,f.sy,f.sw,f.sh,Math.round(playerX-32*size),Math.round(playerY-f.footY*size),64*size,80*size);}}
  if(ready&&performance.now()-borrowAt<1200){ctx.save();ctx.font=`bold ${16*width/canvas.getBoundingClientRect().width}px sans-serif`;ctx.textAlign='center';ctx.strokeStyle='#263e39';ctx.lineWidth=3;ctx.fillStyle='#ffe64d';const py=playerY-(spriteCssHeight+12)*width/canvas.getBoundingClientRect().width;ctx.strokeText('借過借過',playerX,py);ctx.fillText('借過借過',playerX,py);ctx.restore();}
  drawHydrantNames(ctx,sceneZoom,width,height);
  drawWorld(mini,.16,128,100,true);drawRace(mini,.16,128,100,true);playerArrow(mini,64,50);
  if(ready)updateLocation();
  const ruler=distanceScale(sceneZoom,canvas.getBoundingClientRect().width,width);
  $('scale-line').setAttribute('style',`width:${ruler.pixels}px`);
  $('scale-label').textContent=`${Number(ruler.metres.toPrecision(10))} m`;
  updateMusicUI();
  if(phase==='result')drawResultMap();
}
function recoverPlayer(){
  const point=nearestStandableRoad(x,y,loadedRoads(),walkable);
  if(!point)return false;
  x=point.x;y=point.y;nearbyKey=cellKey(x,y);loadNearby(x,y);clearInput();camera.x=camera.y=0;dust=[];
  notices.push('🚒 已拉回路上',1500);return true;
}
function update(dt){
  movementSpeed=0;crowdFactor=1;running=false;motionX=motionY=0;
  // Check the model BEFORE world movement; ticking and drawing keep running.
  if(race?.getState().construction){clearInput();return;}
  if(inputBlocked()){clearInput();return;}
  if(!walkable(x,y)){recoverPlayer();return;}
  const before={x,y},now=performance.now();
  const pressed=k=>keys.has(k);
  const dx=joystick.active?joystick.x:Number(pressed('ArrowRight')||pressed('d'))-Number(pressed('ArrowLeft')||pressed('a'));
  const dy=joystick.active?joystick.y:Number(pressed('ArrowUp')||pressed('w'))-Number(pressed('ArrowDown')||pressed('s'));
  if(dx||dy){crowdFactor=crowdSpeedFactor(incident,RULES.roundSeconds-(race?.getState().remaining??RULES.roundSeconds),{x,y});if(crowdFactor<1&&performance.now()-borrowAt>=5000)borrowAt=performance.now();const wantsRun=joystick.active?runHeld:pressed('Shift')||pressed(' ');direction=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'up':'down');const next=stepMove({x,y},dx,dy,dt,(wantsRun?runSpeed:walkSpeed)*testRate*crowdFactor,walkable);const distance=Math.hypot(next.x-x,next.y-y);moving=distance>0;running=moving&&wantsRun;motionX=next.x-x;motionY=next.y-y;movementSpeed=dt>0?distance/dt:0;x=next.x;y=next.y;if(moving)walkingTime+=distance*.16/.55*(running&&paceEffects.animation?1.5:1);const k=cellKey(x,y);if(k!==nearbyKey){nearbyKey=k;loadNearby(x,y);}}else moving=false;
  if(!(dx||dy)||!(dt>0&&dt<=.25)){stuckAnchor=null;return;}
  stuckAnchor??={...before,at:now-dt*1000};
  if(Math.hypot(x-stuckAnchor.x,y-stuckAnchor.y)>=.1)stuckAnchor={x,y,at:now};
  else if(now-stuckAnchor.at>=1500)recoverPlayer();
}
function sprite(c,name,row,col,px,py,height,grey=false){
 const image=images[name];if(!image)return false;const [sw,sh]=ART[name],width=height*sw/sh;c.save();if(grey)c.filter='grayscale(1)';c.drawImage(image,col*sw,row*sh,sw,sh,px-width/2,py-height,width,height);c.restore();return true;
}
const truckRow=v=>Math.abs(v.dx)>=Math.abs(v.dy)?(v.dx<0?1:2):(v.dy>0?3:0);
function waterMark(c,source,px,py,size=1,result=false,index=null,target=true,near=true){
  c.save();c.translate(px,py);c.scale(size,size);c.textAlign='center';
  const owner=source.owner,isPlayer=owner==='player';
  const effect=!result&&isPlayer?captureEffects.find(e=>e.waterId===source.id):null;if(effect){const age=performance.now()-effect.at;c.translate(0,-8*Math.sin(Math.PI*Math.min(1,age/550)));}
  c.globalAlpha=target?1:.25;if(!result&&source.openedAt>0&&RULES.roundSeconds-(race?.getState().remaining??RULES.roundSeconds)-source.openedAt<3&&Math.floor(performance.now()/150)%2===0)c.globalAlpha=.2;
  if(target&&near&&!result){c.shadowColor='#ffe64d';c.shadowBlur=12;}
  c.fillStyle=owner?(isPlayer?'#238a50':'#69727a'):target?(Math.floor(performance.now()/500)%2?'#ffe64d':'#fff4a3'):'#d3ddda';
  c.strokeStyle='#263e39';c.lineWidth=1;c.beginPath();if(source.k==='hydrant_under')c.rect(-12,-12,24,24);else c.arc(0,0,14,0,Math.PI*2);c.fill();c.stroke();c.shadowBlur=0;
  if(owner)sprite(c,'rhino_flag',0,Math.floor(performance.now()/400)%2,0,10,36,!isPlayer);else sprite(c,'water_icons',0,source.k==='hydrant_above'?0:1,0,12,34);
  c.restore();
}
function drawHydrantNames(c,scale,w,h){
 hydrantLabels=[];const snapshot=race?.getState(),site=snapshot?.site||introSite;if(!site)return;
 const sources=snapshot?.status==='idle'?selectObjectives(water,introSite,300,10):snapshot?.water||[],ratio=w/canvas.getBoundingClientRect().width,candidates=[];
 c.save();c.textAlign='center';c.font=`${11*ratio}px sans-serif`;c.fillStyle='#fff8e0';c.strokeStyle='#263e39';c.lineWidth=3*ratio;
 for(const source of sources){const centre=sceneCenter(),a=w/2+(source.x-centre.x)*scale,b=h/2-(source.y-centre.y)*scale,distance=Math.hypot(source.x-x,source.y-y);if(distance>30||a<-30||a>w+30||b<-30||b>h+30)continue;candidates.push({name:source.n,distance,x:a,y:b+20*ratio,textY:b+24*ratio,width:c.measureText(source.n).width+6*ratio,height:16*ratio});}
 hydrantLabels=selectHydrantLabels(candidates);for(const q of hydrantLabels){c.strokeText(q.name,q.x,q.textY);c.fillText(q.name,q.x,q.textY);}c.restore();
}
function drawCommander(c,scale,w,h,bubbleOnly=false){
 const {x,y}=sceneCenter();
 const bubbleElement=$('commander-bubble');bubbleElement.hidden=true;
 commanderRender={visible:false,bubble:'',lines:[]};const q=incident?.commander,image=images.commander_hd;if(!q||!image)return false;
 const a=w/2+(q.x-x)*scale,b=h/2-(q.y-y)*scale,ratio=w/canvas.getBoundingClientRect().width,height=spriteCssHeight*1.5*ratio,sw=height*94/200;
 if(a<0||a>w||b<0||b>h)return false;
 c.save();const smoothing=c.imageSmoothingEnabled;if(!bubbleOnly){c.imageSmoothingEnabled=true;c.drawImage(image,a-sw/2,b-height,sw,height);c.imageSmoothingEnabled=smoothing;}
 const bubble=phase==='playing'?commanderDialogue?.text(RULES.roundSeconds-(race?.getState().remaining??RULES.roundSeconds))||'':'',lines=commanderBubbleLines(bubble);
 if(bubbleOnly&&lines.length){
  c.font=`600 ${16*ratio}px "PingFang TC","Microsoft JhengHei",sans-serif`;
  const bw=Math.min(w-8*ratio,Math.max(...lines.map(line=>c.measureText(line).width))+20*ratio),bh=(lines.length*22+16)*ratio,bx=Math.max(4*ratio,Math.min(w-bw-4*ratio,a-bw/2)),by=Math.max(4*ratio,b-height-bh-12*ratio);
  bubbleElement.textContent=lines.join('\n');bubbleElement.style.left=`${bx/ratio}px`;bubbleElement.style.top=`${by/ratio}px`;bubbleElement.style.width=`${bw/ratio}px`;bubbleElement.hidden=false;
 }
 c.restore();commanderRender={visible:true,heightCss:spriteCssHeight*1.5,screenX:a,screenY:b,bubble,lines,fontCss:16};return true;
}
function drawFire(c,fx,fy,ratio,isMini,frame){
  c.save();c.translate(fx,fy);c.scale(isMini?1:ratio,isMini?1:ratio);
  if(!isMini){c.fillStyle='#252525cc';for(let i=0;i<4;i++){const rise=(frame*4+i*15)%60;c.fillRect(-20+i*9+(frame%3)*2,-44-rise,18+i*3,16+i*3);}}
  c.fillStyle=isMini&&frame%2?'#ffe64d':'#ff6b21';
  for(let i=0;i<3;i++){const tall=(isMini?5:36)+(frame+i)%3*(isMini?1:6);c.fillRect((i-1)*(isMini?2:12)-(isMini?2:8),-tall,isMini?3:16,tall);}
  c.fillStyle='#ffe64d';c.fillRect(isMini?-2:-6,isMini?-3:-22,isMini?2:12,isMini?3:22);c.restore();
}
function drawRace(c,scale,w,h,isMini=false){
  const snapshot=race?.getState(),site=snapshot?.site||introSite;if(!site)return;
  const centre=sceneCenter(isMini),px=v=>w/2+(v-centre.x)*scale,py=v=>h/2-(v-centre.y)*scale,ratio=isMini?1:w/canvas.getBoundingClientRect().width;
  c.save();
  const fx=px(site.x),fy=py(site.y),frame=Math.floor(performance.now()/250),light=Math.floor(performance.now()/400)%2;
  if(!isMini&&introSite?.building){
    const p=introSite.building.p;c.beginPath();
    for(let i=0;i<p.length;i+=2)i?c.lineTo(px(p[i]),py(p[i+1])):c.moveTo(px(p[i]),py(p[i+1]));
    c.closePath();c.fillStyle='#ed443580';c.fill();c.strokeStyle='#ed4435';c.lineWidth=2*ratio;c.stroke();
  }
  // Only screen-space art. Geometry, objectives and NPC routes remain unchanged.
  const activeWater=snapshot?.status==='idle'?selectObjectives(water,introSite,300,10):snapshot?.water||[],visibleWater=activeWater.filter(v=>px(v.x)>=-30&&px(v.x)<=w+30&&py(v.y)>=-30&&py(v.y)<=h+30),activeNPC=(snapshot?.npcs||[]).filter(n=>n.active);
  const screenVehicle=(kind,row,col,v)=>({kind,row,col,x:px(v.x),y:py(v.y),...vehicleDisplayDimensions(kind,row,spriteCssHeight*ratio)});
  const parked=isMini?[]:visibleWater.filter(v=>v.owner&&v.owner!=='player').map(v=>{const q=screenVehicle('fire_engine',2,light,v);return {...q,x:q.x+q.width/2+18*ratio+ratio};});
  const sceneVehicles=isMini?[]:(incident?.vehicles||[]).map(v=>screenVehicle(v.kind,v.row,v.kind==='ladder_truck'?0:light,v));
  const obstacles=isMini?[]:[{x:fx,y:fy,width:20*ratio,height:24*ratio,length:0},...visibleWater.map(v=>({x:px(v.x),y:py(v.y)+6*ratio,width:34*ratio,height:52*ratio,length:0})),...activeNPC.map(n=>screenVehicle('fire_engine',truckRow({dx:n.direction.x,dy:n.direction.y}),0,n))];
  if(!isMini&&incident?.commander){const q=incident.commander,sh=spriteCssHeight*1.5*ratio;obstacles.push({x:px(q.x),y:py(q.y)-sh/2,width:sh*94/200,height:sh,length:0});}
  const placed=isMini?[]:layoutVehicleSprites([...sceneVehicles,...parked],obstacles);
  let sprites=0,spriteLimit=Math.max(0,59-visibleWater.length-parked.length-activeNPC.length-(incident?.commander?1:0));const paint=(name,row,col,a,b,height)=>{const sw=height*ART[name][0]/ART[name][1];if(sprites>=spriteLimit||a+sw/2<0||a-sw/2>w||b<0||b-height>h)return;if(sprite(c,name,row,col,a,b,height))sprites++;};
  const vehicle=v=>paint(v.kind,v.row,v.col,v.x,v.y+v.height/2,v.height);
  const elapsed=snapshot?RULES.roundSeconds-snapshot.remaining:0;
  if(isMini)drawFire(c,fx,fy,ratio,true,frame);
  else if(incident){
    for(const v of placed.slice(0,sceneVehicles.length))vehicle(v);
    if(incident.cordon){const {a,b}=incident.cordon,dx=px(b.x)-px(a.x),dy=py(b.y)-py(a.y),n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/(8*ratio)));c.lineWidth=5*ratio;for(let i=0;i<n;i++){c.strokeStyle=i%2?'#263e39':'#ffe64d';c.beginPath();c.moveTo(px(a.x)+dx*i/n,py(a.y)+dy*i/n);c.lineTo(px(a.x)+dx*(i+1)/n,py(a.y)+dy*(i+1)/n);c.stroke();}}
    for(const person of incident.people.slice(0,crowdCount(elapsed)).sort((a,b)=>b.y-a.y))paint('bystanders',person.variant,Math.floor(performance.now()/1000*person.speed+person.offset)%3,px(person.x),py(person.y),crowdSpriteHeight(scale,ratio));
    paint('fire_big',0,frame%4,px(incident.centre.x),py(incident.centre.y),130*ratio);
    for(const fire of incident.fires)paint('fire_small',0,frame%4,px(fire.x),py(fire.y),45*ratio);
  }
  if(!isMini&&drawCommander(c,scale,w,h))sprites++;
  if(!isMini){
    c.font=`bold ${14*ratio}px sans-serif`;c.textAlign='center';c.fillStyle='#c52e24';
    if(fx<0||fx>w||fy<0||fy>h){
      const dx=fx-w/2,dy=fy-h/2,margin=24*ratio,t=Math.min((w/2-margin)/Math.abs(dx||1e-9),(h/2-margin)/Math.abs(dy||1e-9));
      const ax=w/2+dx*t,ay=h/2+dy*t;c.save();c.translate(ax,ay);c.rotate(Math.atan2(dy,dx));c.scale(ratio,ratio);
      c.beginPath();c.moveTo(12,0);c.lineTo(-8,-7);c.lineTo(-4,0);c.lineTo(-8,7);c.closePath();c.fill();c.restore();
      c.fillText(`火場 ${Math.round(Math.hypot(site.x-x,site.y-y))} m`,Math.max(48*ratio,Math.min(w-48*ratio,ax)),Math.max(14*ratio,Math.min(h-8*ratio,ay-15*ratio)));
    }else c.fillText('火警',fx,fy-116*ratio);
  }
  // Decode ids are cell-row keys; race ids are numeric and must never be used
  // to match ambient points (names and coordinates can legitimately repeat).
  const targets=new Map((snapshot?.water||[]).map(s=>[s.sourceId,s]));
  const npcTargets=new Set((snapshot?.npcs||[]).filter(n=>n.active&&n.target!==null&&!(n.cooldownRemaining>0)).map(n=>n.target));
  const objectiveIds=new Set(activeWater.map(s=>s.sourceId??s.id));
  const sources=water.filter(s=>objectiveIds.has(s.id)).map(s=>({source:targets.get(s.id)||s,target:true}));
  if(!isMini){spriteLimit=59-visibleWater.length-activeNPC.length;for(const v of placed.slice(sceneVehicles.length))vehicle(v);}
  // Ambient sources first, so a dim colocated point cannot cover a target flag.
  sources.sort((a,b)=>Number(a.target)-Number(b.target));
  let ambientAllowance=Math.max(0,59-sprites-(snapshot?.npcs.filter(n=>n.active).length||0)-(snapshot?.water.filter(s=>s.owner!==null&&s.owner!=='player').length||0)-sources.filter(s=>s.target).length);
  for(const {source,target}of sources){
    const a=px(source.x),b=py(source.y);if(a<-30||a>w+30||b<-30||b>h+30)continue;
    if(isMini){c.save();c.globalAlpha=target?1:.25;c.fillStyle=source.owner==='player'?'#238a50':source.owner?'#69727a':target?(Math.floor(performance.now()/500)%2?'#ffe64d':'#fff4a3'):'#d3ddda';c.fillRect(a-1,b-1,3,3);c.restore();}
    else {if(!target&&ambientAllowance--<=0)continue;waterMark(c,source,a,b,ratio,false,null,target,Math.hypot(source.x-x,source.y-y)<=30);sprites++;}
    if(target&&!source.owner&&npcTargets.has(source.id)&&Math.floor(performance.now()/500)%2===0){
      const radius=isMini?4:16*ratio;c.save();c.strokeStyle='#e13232';c.lineWidth=isMini?1:2*ratio;c.strokeRect(a-radius,b-radius,radius*2,radius*2);c.restore();
    }
  }
  if(!isMini){const now=performance.now();captureEffects=captureEffects.filter(e=>now-e.at<1200);
    for(const effect of captureEffects){const source=snapshot?.water.find(a=>a.id===effect.waterId);if(!source)continue;const age=now-effect.at,labels=['+1',...(effect.comboBonus?[`連擊×${effect.combo} +1`]:[]),...(effect.interceptBonus?['截胡！ +1']:[])];
      c.save();c.globalAlpha=Math.max(0,1-age/1200);c.textAlign='center';c.font=`bold ${16*ratio}px sans-serif`;c.lineWidth=3*ratio;c.strokeStyle='#263e39';c.fillStyle='#ffe64d';labels.forEach((text,i)=>{const a=px(source.x),b=py(source.y)-(34+age/35+i*20)*ratio;c.strokeText(text,a,b);c.fillText(text,a,b);});c.restore();
    }
  }
  spriteLimit=59;for(const npc of snapshot?.npcs||[]){if(!npc.active)continue;const a=px(npc.x),b=py(npc.y);if(isMini){c.fillStyle='#e13232';c.beginPath();c.arc(a,b,3,0,Math.PI*2);c.fill();continue;}c.save();c.translate(a,b);c.rotate(Math.atan2(-npc.direction.y,npc.direction.x));c.scale(ratio,ratio);
    c.restore();vehicle(screenVehicle('fire_engine',truckRow({dx:npc.direction.x,dy:npc.direction.y}),light,npc));
  }if(!isMini){drawCommander(c,scale,w,h,true);renderedSprites=sprites;}c.restore();
}
function drawResultMap(){
  const s=race?.getState();if(!s)return;const map=$('result-map'),w=Math.max(280,Math.round(map.getBoundingClientRect().width)),h=Math.max(140,Math.round(map.getBoundingClientRect().height));
  if(map.width!==w)map.width=w;if(map.height!==h)map.height=h;const c=map.getContext('2d');
  const points=[s.site.x,s.site.y,...s.water.flatMap(a=>[a.x,a.y])], [l,b,r,t]=bounds(points),scale=Math.min((w-50)/Math.max(60,r-l),(h-50)/Math.max(60,t-b));
  const px=v=>w/2+(v-(l+r)/2)*scale,py=v=>h/2-(v-(b+t)/2)*scale;
  c.fillStyle='#e6dfc5';c.fillRect(0,0,w,h);c.strokeStyle='#a7ad9c';c.lineWidth=2;
  for(const road of loadedRoads()){c.beginPath();for(let i=0;i<road.p.length;i+=2)i?c.lineTo(px(road.p[i]),py(road.p[i+1])):c.moveTo(px(road.p[i]),py(road.p[i+1]));c.stroke();}
  c.fillStyle='#e34232';c.beginPath();c.arc(px(s.site.x),py(s.site.y),6,0,Math.PI*2);c.fill();const anchors=s.water.map(a=>({x:px(a.x),y:py(a.y)})),marks=layoutResultMarkers(anchors,w,h);s.water.forEach((a,i)=>{const q=marks[i],p=anchors[i];c.strokeStyle='#68736c';c.lineWidth=.7;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(q.x,q.y);c.stroke();waterMark(c,a,q.x,q.y,.5,true,i);});c.textAlign='center';c.font='bold 11px sans-serif';c.lineWidth=3;c.strokeStyle='#fff8e0';c.fillStyle='#263e39';marks.forEach((q,i)=>{c.strokeText(String(i+1),q.x,q.y+16);c.fillText(String(i+1),q.x,q.y+16);});
}
function finishRound(){
  if(phase==='result')return;
  phase='result';ready=false;clearInput();$('overview-dialog').close();$('music-settings-dialog').close();$('intro').hidden=true;musicAction('setState','result');const s=race.getState();
  const stars=roundStars(s.captured,s.total);let storage;try{storage=localStorage;}catch{}
  const best=rememberHighScore(storage,s.difficulty,s.score),versus=competition(s.water),record=rememberRecord(storage,s.difficulty,versus.outcome);
  $('result-title').textContent=versus.label;$('result-versus').textContent=`你 ${versus.player} 顆 vs 消防車 ${versus.npc} 顆（還有 ${versus.unclaimed} 顆沒人拿）`;
  $('result-record').textContent=`${{easy:'簡單',normal:'普通',hard:'困難'}[s.difficulty]}難度戰績：勝 ${record.win} 敗 ${record.loss} 平 ${record.draw}`;
  $('result-score').textContent=`${s.score} 分`;$('result-stars').textContent='★'.repeat(stars)+'☆'.repeat(3-stars);$('result-stars').setAttribute('aria-label',`${stars}星`);
  $('result-captured').textContent=`已佔 ${s.captured} / ${s.total}・連擊 +${s.comboBonus}・截胡 +${s.interceptBonus}`;
  $('result-best').textContent=`${{easy:'簡單',normal:'普通',hard:'困難'}[s.difficulty]}最高分 ${best} 分`;
  $('result-address').textContent=`${s.site.n}｜${s.site.addr}`;
  const nearest=[...s.water].sort((a,b)=>Math.hypot(a.x-s.site.x,a.y-s.site.y)-Math.hypot(b.x-s.site.x,b.y-s.site.y))[0];
  $('result-nearest').textContent=nearest?`離火場最近的消防栓：${nearest.n}，${Math.round(Math.hypot(nearest.x-s.site.x,nearest.y-s.site.y))} 公尺`:'';
  $('result-hoses').textContent=`本局共佈了 ${s.totalHoses} 條水帶`;$('result-details').open=false;
  $('result-list').textContent=s.water.map((a,i)=>`${i+1}. ${a.n}（${{hydrant_above:'地上消防栓',hydrant_under:'地下消防栓'}[a.k]||a.k}）— ${a.owner==='player'?'犀牛綠旗・已佔領':a.owner?'灰旗・消防車已搶走':'閃黃・未找到'}`).join('\n');
  updateConstructionUI();$('result-dialog').showModal();$('result-title').focus({preventScroll:true});$('result-dialog').scrollTop=0;drawResultMap();
}
function updateConstructionUI(){
  const s=race?.getState(),c=phase==='playing'&&s?.status==='playing'?s.construction:null;
  const panel=$('construction-panel'),progress=$('construction-progress');
  const target=phase==='playing'&&s?.status==='playing'?currentHydrant(s.water,{x,y},c,RULES.captureRadius):null;
  panel.hidden=!target;panel.dataset.sourceId=String(target?.sourceId??target?.id??'');
  $('construction-kind').textContent=target?({hydrant_above:'地上消防栓',hydrant_under:'地下消防栓'}[target.k]||'消防栓'):'';
  $('construction-address').textContent=target?hydrantAddress(target):'';
  progress.hidden=!c;$('construction-cancel').hidden=!c;$('construction-detail').hidden=!c;
  progress.max=c?.duration||1;progress.value=c?.elapsed||0;
  if(phase==='playing'&&s.remaining>0&&s.remaining<=30)$('world').classList.add('urgent');else $('world').classList.remove('urgent');
  $('round-score').textContent=`${s?.score||0} 分`;if(phase!=='playing'){captureEffects=[];$('intercept-feedback').hidden=true;$('stolen-feedback').hidden=true;notices.clear();}
  $('construction-detail').textContent=c?`水帶 ${c.hoses}條 · ${c.elapsed.toFixed(1)} / ${c.duration.toFixed(1)}秒`:'';
  $('construction-status').textContent=c?(c.contested?'搶線中！':'佈線中・暫時不能移動'):target?(target.owner==='player'?'已佔領':target.owner?'消防車已佔領':'目前消防栓'):'';
  $('total-hoses').textContent=`水帶 ${s?.totalHoses||0}條`;
  if(c)clearInput();
}
$('construction-cancel').addEventListener('click',()=>{
  clearInput();if(phase==='playing'&&race?.getState().construction){commanderDialogue?.enqueue('cancel',RULES.roundSeconds-race.getState().remaining);race.cancelConstruction();}
  updateConstructionUI();if(ready&&!inputModalOpen())canvas.focus({preventScroll:true});
});
function tickRace(dt){
  if(phase==='mission'&&performance.now()-missionAt>=3000)finishMission();
  if(phase==='intro'&&performance.now()-introAt>=2000){
    try{race.start(0);const s=race.getState();x=s.spawn.x;y=s.spawn.y;nearbyKey=cellKey(x,y);phase='playing';ready=true;$('intro').hidden=true;message('出發！靠近消防栓 3m 內佈線，完成才佔領。',2600);}
    catch(error){phase='select';ready=false;race=null;introSite=null;clearInput();$('intro').hidden=true;$('mission-card').hidden=true;$('tutorial-card').hidden=true;$('start-status').textContent=`出生失敗：${error.message}。請按開始重試。`;$('start-game').disabled=false;$('start-screen').showModal();message('本題暫時無法出勤，請重試。');return;}
  }
  if(phase!=='playing'||!race)return;
  race.tick(dt*testRate,{x,y});const s=race.getState();const seconds=Math.max(0,Math.ceil(s.remaining));$('countdown').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;const versus=competition(s.water);$('captured').textContent=`你 ${versus.player} ： 消防車 ${versus.npc}`;
  if(s.remaining<=30&&!tense){tense=true;musicAction('setState','tense');}
  const events=race.drainEvents();for(const e of events){if(e.type==='capture'){musicAction('cue','capture');captureEffects.push({...e,at:performance.now()});if(e.interceptBonus){clearTimeout(interceptTimer);$('intercept-feedback').textContent='截胡！ +1';$('intercept-feedback').hidden=false;interceptTimer=setTimeout(()=>{$('intercept-feedback').hidden=true;},1200);}message(`犀牛插旗！${e.waterName} +1${e.comboBonus?`・連擊×${e.combo} +1`:''}${e.interceptBonus?'・截胡 +1':''}`,2200);}if(e.type==='stolen'){musicAction('cue','lost');notices.push(`${e.waterName}被搶走了`,2600);}if(e.type==='wave')notices.push(`📢 增援範圍擴大！新增 ${e.count} 個消防栓`,2000);if(e.type==='horn')musicAction('cue','horn');}
  commanderDialogue?.update({seconds:RULES.roundSeconds-s.remaining,player:{x,y},water:s.water,construction:s.construction,npcActive:s.npcs.some(n=>n.active),events});
  const notice=notices.at(performance.now());$('stolen-feedback').textContent=notice;$('stolen-feedback').hidden=!notice;
  if(s.status==='finished')finishRound();
}
function loop(now){const dt=previous?(now-previous)/1000:0;previous=now;update(dt);updatePace(dt);tickRace(dt);renderScene();requestAnimationFrame(loop);}
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

$('zoom-in').addEventListener('click',()=>{zoomTouched=true;viewWidthMeters=Math.max(50,viewWidthMeters-25);zoom=width/viewWidthMeters;canvas.focus({preventScroll:true});});$('zoom-out').addEventListener('click',()=>{zoomTouched=true;viewWidthMeters=Math.min(250,viewWidthMeters+25);zoom=width/viewWidthMeters;canvas.focus({preventScroll:true});});
for(const b of document.querySelectorAll('[data-start-character]'))b.addEventListener('click',()=>{character=b.dataset.startCharacter;document.querySelectorAll('[data-start-character]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));});
$('settings').addEventListener('click',()=>{++arrival;ready=false;phase='select';race=null;introSite=null;$('mission-card').hidden=true;$('tutorial-card').hidden=true;$('intro').hidden=true;clearInput();updateConstructionUI();$('start-game').disabled=!bootstrapped;$('start-screen').showModal();$('start-game').focus();});
$('start-screen').addEventListener('cancel',e=>e.preventDefault());
$('start-game').addEventListener('click',async()=>{if(phase!=='select')return;if(!bootstrapped){await boot();return;}difficulty=['easy','normal','hard'].includes($('start-difficulty').value)?$('start-difficulty').value:'normal';tense=false;playMusic();$('start-game').disabled=true;await goStation($('start-station').value);$('start-game').disabled=false;});
$('next-round').addEventListener('click',async()=>{if(phase!=='result')return;tense=false;phase='loading';playMusic();$('next-round').disabled=true;await goStation(station);$('next-round').disabled=false;});
$('result-dialog').addEventListener('cancel',e=>e.preventDefault());
Object.defineProperty(window,'__game',{value:Object.freeze({getState:()=>({ready,phase,difficulty,tutorialStep,testRate,spawnName:station,nearestRoad:roadName,walkSpeed,runSpeed,spriteCssHeight,metersPerUnit,collisionRadius,pace:{running,walkingTime,effects:{...paceEffects},camera:{...camera},dust:dust.map(p=>({...p}))},commander:phase==='playing'&&incident?.commander?{...incident.commander,...commanderRender,lines:[...commanderRender.lines]}:null,hydrantLabels:hydrantLabels.map(q=>({...q})),joystick:{...joystick},runHeld,movementSpeed,music:music.getState(),race:race?.getState()||null,incident:incident?{crowdCount:Math.min(incident.people.length,crowdCount(RULES.roundSeconds-(race?.getState().remaining??RULES.roundSeconds))),vehicles:incident.vehicles.map(v=>({...v})),people:incident.people.map(p=>({...p})),renderedSprites,crowdFactor}:null,x,y,direction,moving,character,station,loadedCells:[...cache.keys()],pendingCells:pending.size,zoom,viewWidthMeters}),renderScene})});
async function boot(){
  $('start-game').disabled=true;
  try{
    const response=await fetch('./data/base.json');if(!response.ok)throw Error('地圖尚未準備完成');base=await response.json();available=new Set(base.cells);
    [sites,waterKeys]=await Promise.all(['sites','w/index'].map(async name=>{const r=await fetch(`./data/${name}.json`,{cache:'no-cache'});if(!r.ok)throw Error('題目與消防栓尚未準備完成');return r.json();}));

    const poolResponse=await fetch('./data/mission-pool.json',{cache:'no-cache'});if(!poolResponse.ok)throw Error('題庫尚未準備完成');eligibleMissions=new Set((await poolResponse.json()).eligible);
    await Promise.all(['male','female','rhino'].map(name=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{images[name]=image;const c=document.querySelector(`[data-character="${name}"] canvas`),p=c.getContext('2d');p.imageSmoothingEnabled=false;const f=atlasFrame('down',false,0);p.drawImage(image,f.sx,f.sy,64,80,0,0,64,80);resolve();};image.onerror=()=>reject(Error('角色圖像尚未準備完成'));image.src=`./assets/${name}.png`;})));
    const stationButtons=[];for(const s of base.stations){const option=document.createElement('option');option.value=s.name;option.textContent=s.name;$('start-station').append(option);const b=document.createElement('button');b.type='button';b.textContent=s.name;b.dataset.startStation=s.name;b.addEventListener('click',()=>{$('start-station').value=s.name;for(const el of stationButtons)el.setAttribute('aria-pressed',String(el===b));});stationButtons.push(b);$('station-choices').append(b);}
    $('start-station').value=base.stations.find(s=>s.name.includes('莊敬'))?.name||base.stations[0].name;
    for(const b of stationButtons)b.setAttribute('aria-pressed',String(b.dataset.startStation===$('start-station').value));
    await Promise.all([...Object.keys(ART),'commander_hd'].map(name=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{images[name]=image;resolve();};image.onerror=()=>reject(Error('現場圖像尚未準備完成'));image.src=`./art/${name}.png`;})));
    bootstrapped=true;$('start-game').disabled=false;$('start-game').textContent='開始搶水源';$('start-status').textContent='手機左搖桿走路，同時按住右側「跑」奔跑；電腦方向鍵／WASD走動，Shift奔跑。';
  }catch(e){console.error(e);$('start-status').textContent=`${e.message}。請按重試載入。`;$('start-game').textContent='重試載入';$('start-game').disabled=false;}
}
resize();$('start-screen').showModal();requestAnimationFrame(loop);boot();
