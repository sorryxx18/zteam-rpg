import {atlasFrame,pointInPoly,stepMove} from './core.mjs';
const $=id=>document.getElementById(id), canvas=$('game'), ctx=canvas.getContext('2d'), mini=$('minimap').getContext('2d');
const keys=new Set(), pointers=new Map(), cache=new Map(), pending=new Map(), failed=new Set(), images={};
let base, available=new Set(), ready=false, x=0,y=0,direction='down',moving=false,character='rhino',station='',zoom=1.5, width=640,height=360, previous=0, walkingTime=0, arrival=0, nearbyKey='', messageTimer;
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
  const token=++arrival;ready=false;clearInput();station=name;$('station').value=name;$('location').textContent=name;$('road').textContent=target.road||target.sq;message('沿著街角，準備出發…');
  await loadNearby(target.x,target.y);if(token!==arrival)return;
  if(!cache.has(cellKey(target.x,target.y))){message('出發點讀取失敗，請重新整理再試。');return;}
  x=target.x;y=target.y;direction='down';nearbyKey=cellKey(x,y);ready=true;message('出發！跟著自己的步調逛逛街區。',2600);canvas.focus({preventScroll:true});
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
function renderScene(){
  if(!base){ctx.fillStyle='#9ca77b';ctx.fillRect(0,0,width,height);return;}
  drawWorld(ctx,zoom,width,height);
  if(ready){ctx.fillStyle='#34483865';ctx.beginPath();ctx.ellipse(width/2,height/2+1,7,2,0,0,Math.PI*2);ctx.fill();const img=images[character];if(img){const f=atlasFrame(direction,moving,walkingTime);const size=0.48;ctx.drawImage(img,f.sx,f.sy,f.sw,f.sh,Math.round(width/2-32*size),Math.round(height/2-f.footY*size),64*size,80*size);}}
  drawWorld(mini,.16,128,100,true);mini.fillStyle='#334d40';mini.fillRect(60,46,9,9);mini.fillStyle='#ffe4a0';mini.fillRect(62,48,5,5);
}
function update(dt){
  if(!ready){moving=false;return;}
  const pressed=k=>keys.has(k)||[...pointers.values()].includes(k);
  const dx=Number(pressed('ArrowRight')||pressed('d'))-Number(pressed('ArrowLeft')||pressed('a'));
  const dy=Number(pressed('ArrowUp')||pressed('w'))-Number(pressed('ArrowDown')||pressed('s'));
  if(dx||dy){direction=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'up':'down');const next=stepMove({x,y},dx,dy,dt,pressed('Shift')||pressed(' ')?30:18,walkable);moving=next.x!==x||next.y!==y;x=next.x;y=next.y;if(moving)walkingTime+=Math.min(dt,.05);const k=cellKey(x,y);if(k!==nearbyKey){nearbyKey=k;loadNearby(x,y);}}else moving=false;
}
function loop(now){const dt=previous?(now-previous)/1000:0;previous=now;update(dt);renderScene();requestAnimationFrame(loop);}
const movementKeys=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','Shift',' ']);
window.addEventListener('keydown',e=>{if(e.target.closest('select,input,summary,button'))return;const key=e.key.length===1?e.key.toLowerCase():e.key;if(movementKeys.has(key)){e.preventDefault();keys.add(key);}});
window.addEventListener('keyup',e=>keys.delete(e.key.length===1?e.key.toLowerCase():e.key));
window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{clearInput();previous=0;});
for(const b of document.querySelectorAll('[data-key],#run')){
  b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);pointers.set(e.pointerId,b.dataset.key||'Shift');b.classList.add('pressed');});
  const end=e=>{pointers.delete(e.pointerId);b.classList.remove('pressed');};b.addEventListener('pointerup',end);b.addEventListener('pointercancel',end);b.addEventListener('lostpointercapture',end);b.addEventListener('contextmenu',e=>e.preventDefault());
}
$('station').addEventListener('change',e=>goStation(e.target.value));$('home').addEventListener('click',()=>goStation(station));
$('zoom-in').addEventListener('click',()=>{zoom=Math.min(2.3,zoom+.2);canvas.focus({preventScroll:true});});$('zoom-out').addEventListener('click',()=>{zoom=Math.max(1,zoom-.2);canvas.focus({preventScroll:true});});
for(const b of document.querySelectorAll('[data-character]'))b.addEventListener('click',()=>{character=b.dataset.character;document.querySelectorAll('[data-character]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));canvas.focus({preventScroll:true});});
$('settings').addEventListener('toggle',clearInput);
Object.defineProperty(window,'__game',{value:Object.freeze({getState:()=>({ready,x,y,direction,moving,character,station,loadedCells:[...cache.keys()],pendingCells:pending.size,zoom}),renderScene})});
async function boot(){
  try{
    const response=await fetch('./data/base.json');if(!response.ok)throw Error('地圖尚未準備完成');base=await response.json();available=new Set(base.cells);
    for(const s of base.stations){const option=document.createElement('option');option.value=s.name;option.textContent=s.name;$('station').append(option);}
    await Promise.all(['male','female','rhino'].map(name=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{images[name]=image;const c=document.querySelector(`[data-character="${name}"] canvas`),p=c.getContext('2d');p.imageSmoothingEnabled=false;const f=atlasFrame('down',false,0);p.drawImage(image,f.sx,f.sy,64,80,0,0,64,80);resolve();};image.onerror=()=>reject(Error('角色圖像尚未準備完成'));image.src=`./assets/${name}.png`;})));
    await goStation(base.stations.find(s=>s.name.includes('莊敬'))?.name||base.stations[0].name);
  }catch(e){console.error(e);message(`${e.message}。請稍後重新整理。`);}
}
resize();requestAnimationFrame(loop);boot();
