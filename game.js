import {atlasFrame,pointInPoly,stepMove,nearestRoad} from './core.mjs?v=2';
import {TRACKS,createMusicPlayer} from './music.mjs?v=2';
const $=id=>document.getElementById(id), canvas=$('game'), ctx=canvas.getContext('2d'), mini=$('minimap').getContext('2d');
const keys=new Set(), pointers=new Map(), cache=new Map(), pending=new Map(), failed=new Set(), images={};
let base, available=new Set(), ready=false, x=0,y=0,direction='down',moving=false,character='rhino',station='',zoom=3.2, width=640,height=360, previous=0, walkingTime=0, arrival=0, nearbyKey='', messageTimer;
// Intentionally game-sized for legibility, not a real human-height claim.
const walkSpeed=2.2,runSpeed=4,spriteWorldHeight=4.5;
const music=createMusicPlayer();
let musicError=false;
function updateMusicUI(){
  const s=music.getState();
  $('music-toggle').textContent=musicError||!s.playing?'音樂重試':s.muted?'開啟音樂':'靜音';
  $('music-toggle').setAttribute('aria-pressed',String(s.muted));
  $('music-status').textContent=musicError?'音樂尚未開啟，點音樂重試':s.muted?'音樂已靜音':s.playing?'音樂播放中':'音樂尚未開啟';
}
function playMusic(){
  musicError=false;
  try{Promise.resolve(music.play($('music-track').value||'street')).then(updateMusicUI).catch(()=>{musicError=true;updateMusicUI();});}
  catch(e){musicError=true;updateMusicUI();}
}
for(const track of TRACKS){const option=document.createElement('option');option.value=track.id;option.textContent=track.name;$('music-track').append(option);}
$('music-track').value='street';
$('music-track').addEventListener('change',()=>{playMusic();if(ready)canvas.focus({preventScroll:true});});
$('music-toggle').addEventListener('click',()=>{const s=music.getState();if(!s.playing||musicError){music.setMuted(false);playMusic();}else music.setMuted(!s.muted);updateMusicUI();if(ready)canvas.focus({preventScroll:true});});
let phase='select',bootstrapped=false;
const cellKey=(px,py)=>`${Math.floor(px/base.cs)}_${Math.floor(py/base.cs)}`;
function message(text,timeout=0){clearTimeout(messageTimer);$('message').textContent=text;if(timeout)messageTimer=setTimeout(()=>$('message').textContent='',timeout);}
async function loadCell(key){
  if(cache.has(key)){const data=cache.get(key);cache.delete(key);cache.set(key,data);return data;}
  if(!available.has(key)||failed.has(key))return null;
  if(pending.has(key))return pending.get(key);
  const promise=fetch(`./data/c/${key}.json`).then(r=>{if(!r.ok)throw Error('街區讀取失敗');return r.json();}).then(data=>{
    data.builds=(data.builds||[]).map(b=>({...b,bounds:bounds(b.p)}));cache.set(key,data);
    while(cache.size>25)cache.delete(cache.keys().next().value);
    return data;
  }).catch(error=>{console.warn(key,error);failed.add(key);message('這一段街區暫時無法讀取，請稍後重新整理。',5000);return null;}).finally(()=>pending.delete(key));
  pending.set(key,promise);return promise;
}
function bounds(p){let l=Infinity,r=-Infinity,b=Infinity,t=-Infinity;for(let i=0;i<p.length;i+=2){l=Math.min(l,p[i]);r=Math.max(r,p[i]);b=Math.min(b,p[i+1]);t=Math.max(t,p[i+1]);}return [l,b,r,t];}
function neighbors(px,py){const a=Math.floor(px/base.cs),b=Math.floor(py/base.cs),out=[];for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const k=`${a+i}_${b+j}`;if(available.has(k))out.push(k);}return out;}
async function loadNearby(px,py){return Promise.all(neighbors(px,py).map(loadCell));}
function clearInput(){keys.clear();pointers.clear();moving=false;document.querySelectorAll('.pressed').forEach(b=>b.classList.remove('pressed'));}
async function goStation(name){
  const target=base.stations.find(s=>s.name===name);if(!target)return;
  const token=++arrival;ready=false;phase='loading';clearInput();station=name;message('沿著街角，準備出發…');
  await loadNearby(target.x,target.y);if(token!==arrival)return;
  if(!cache.has(cellKey(target.x,target.y))){phase='select';$('start-status').textContent='出發點讀取失敗，請重新整理再試。';return;}
  x=target.x;y=target.y;direction='down';nearbyKey=cellKey(x,y);phase='playing';ready=true;clearInput();$('start-screen').close();updateLocation();message('出發！跟著自己的步調逛逛街區。',2600);canvas.focus({preventScroll:true});
}
function walkable(px,py){
  const key=cellKey(px,py);
  if(!cache.has(key)){if(available.has(key)&&!failed.has(key))loadCell(key);return false;}
  // Neighbor cells carry crossing footprints; use all nearby loaded footprints.
  for(const k of neighbors(px,py))for(const b of cache.get(k)?.builds||[]){const [l,s,r,n]=b.bounds;if(px>=l-0.8&&px<=r+0.8&&py>=s-0.8&&py<=n+0.8){if(pointInPoly(px,py,b.p)||pointInPoly(px-.65,py,b.p)||pointInPoly(px+.65,py,b.p)||pointInPoly(px,py-.65,b.p)||pointInPoly(px,py+.65,b.p))return false;}}
  return true;
}
function resize(){const rect=canvas.getBoundingClientRect();width=Math.max(1,Math.round(rect.width/2));height=Math.max(1,Math.round(rect.height/2));canvas.width=width;canvas.height=height;ctx.imageSmoothingEnabled=false;}
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
      c.save();c.font='3.8px sans-serif';c.textAlign='center';c.textBaseline='middle';for(const lb of d.lb||[]){if(lb[0]<view[0]||lb[0]>view[2]||lb[1]<view[1]||lb[1]>view[3])continue;c.save();c.translate(lb[0],-lb[1]);c.rotate(-(lb[2]||0));c.strokeStyle='#e4dcc1';c.lineWidth=1.4;c.strokeText(lb[3],0,0);c.fillStyle='#62675d';c.fillText(lb[3],0,0);c.restore();}c.restore();
    }c.restore();
  }
  if(!isMini){for(const s of base.stations){if(Math.abs(s.bx-x)>w/scale||Math.abs(s.by-y)>h/scale)continue;c.save();c.translate(s.bx,-s.by);c.fillStyle='#f2e4c3';c.fillRect(-12,-8,24,6);c.strokeStyle='#85614b';c.lineWidth=.5;c.strokeRect(-12,-8,24,6);c.fillStyle='#8b4438';c.font='3.3px sans-serif';c.textAlign='center';c.fillText(s.name,0,-3.5);c.restore();}}
  c.restore();
}
let overviewPromise, overviewData, roadName='巷弄／未命名道路';
function updateLocation(){
  roadName=nearestRoad(x,y,[...cache.values()].flatMap(d=>d.roads||[])).name;
  $('road').textContent=roadName;
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
  drawWorld(ctx,zoom,width,height);
  if(ready){ctx.fillStyle='#34483865';ctx.beginPath();ctx.ellipse(width/2,height/2+zoom*.15,zoom*1.2,zoom*.35,0,0,Math.PI*2);ctx.fill();const img=images[character];if(img){const f=atlasFrame(direction,moving,walkingTime);const size=spriteWorldHeight*zoom/80;ctx.drawImage(img,f.sx,f.sy,f.sw,f.sh,Math.round(width/2-32*size),Math.round(height/2-f.footY*size),64*size,80*size);}}
  drawWorld(mini,.16,128,100,true);playerArrow(mini,64,50);
  if(ready)updateLocation();
  updateMusicUI();
}
function update(dt){
  if(!ready||$('overview-dialog').open){moving=false;return;}
  const pressed=k=>keys.has(k)||[...pointers.values()].includes(k);
  const dx=Number(pressed('ArrowRight')||pressed('d'))-Number(pressed('ArrowLeft')||pressed('a'));
  const dy=Number(pressed('ArrowUp')||pressed('w'))-Number(pressed('ArrowDown')||pressed('s'));
  if(dx||dy){direction=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'up':'down');const next=stepMove({x,y},dx,dy,dt,pressed('Shift')||pressed(' ')?runSpeed:walkSpeed,walkable);const distance=Math.hypot(next.x-x,next.y-y);moving=distance>0;x=next.x;y=next.y;if(moving)walkingTime+=distance*.16/.55;const k=cellKey(x,y);if(k!==nearbyKey){nearbyKey=k;loadNearby(x,y);}}else moving=false;
}
function loop(now){const dt=previous?(now-previous)/1000:0;previous=now;update(dt);renderScene();requestAnimationFrame(loop);}
const movementKeys=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','Shift',' ']);
window.addEventListener('keydown',e=>{if(!ready||$('overview-dialog').open||e.target.closest('select,input,summary,button'))return;const key=e.key.length===1?e.key.toLowerCase():e.key;if(movementKeys.has(key)){e.preventDefault();keys.add(key);}});
window.addEventListener('keyup',e=>keys.delete(e.key.length===1?e.key.toLowerCase():e.key));
window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{clearInput();previous=0;});
for(const b of document.querySelectorAll('[data-key],#run')){
  b.addEventListener('pointerdown',e=>{if(!ready||$('overview-dialog').open)return;e.preventDefault();b.setPointerCapture(e.pointerId);pointers.set(e.pointerId,b.dataset.key||'Shift');b.classList.add('pressed');});
  const end=e=>{pointers.delete(e.pointerId);b.classList.remove('pressed');};b.addEventListener('pointerup',end);b.addEventListener('pointercancel',end);b.addEventListener('lostpointercapture',end);b.addEventListener('contextmenu',e=>e.preventDefault());
}
$('home').addEventListener('click',()=>{if(ready)goStation(station);});
$('zoom-in').addEventListener('click',()=>{zoom=Math.min(4,zoom+.2);canvas.focus({preventScroll:true});});$('zoom-out').addEventListener('click',()=>{zoom=Math.max(1.6,zoom-.2);canvas.focus({preventScroll:true});});
for(const b of document.querySelectorAll('[data-start-character]'))b.addEventListener('click',()=>{character=b.dataset.startCharacter;document.querySelectorAll('[data-start-character]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));});
$('settings').addEventListener('click',()=>{++arrival;ready=false;phase='select';clearInput();$('start-game').disabled=!bootstrapped;$('start-screen').showModal();$('start-game').focus();});
$('start-screen').addEventListener('cancel',e=>e.preventDefault());
$('start-game').addEventListener('click',async()=>{if(!bootstrapped||phase!=='select')return;playMusic();$('start-game').disabled=true;await goStation($('start-station').value);$('start-game').disabled=false;});
Object.defineProperty(window,'__game',{value:Object.freeze({getState:()=>({ready,phase,spawnName:station,nearestRoad:roadName,walkSpeed,runSpeed,spriteWorldHeight,music:music.getState(),x,y,direction,moving,character,station,loadedCells:[...cache.keys()],pendingCells:pending.size,zoom}),renderScene})});
async function boot(){
  try{
    const response=await fetch('./data/base.json');if(!response.ok)throw Error('地圖尚未準備完成');base=await response.json();available=new Set(base.cells);
    for(const s of base.stations){const option=document.createElement('option');option.value=s.name;option.textContent=s.name;$('start-station').append(option);}
    await Promise.all(['male','female','rhino'].map(name=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{images[name]=image;const c=document.querySelector(`[data-character="${name}"] canvas`),p=c.getContext('2d');p.imageSmoothingEnabled=false;const f=atlasFrame('down',false,0);p.drawImage(image,f.sx,f.sy,64,80,0,0,64,80);resolve();};image.onerror=()=>reject(Error('角色圖像尚未準備完成'));image.src=`./assets/${name}.png`;})));
    $('start-station').value=base.stations.find(s=>s.name.includes('莊敬'))?.name||base.stations[0].name;
    bootstrapped=true;$('start-game').disabled=false;$('start-status').textContent='方向鍵／WASD走動，Shift奔跑；手機用右下方向鍵。';
  }catch(e){console.error(e);$('start-status').textContent=`${e.message}。請稍後重新整理。`;}
}
resize();$('start-screen').showModal();requestAnimationFrame(loop);boot();
