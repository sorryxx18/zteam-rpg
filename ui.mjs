// Screen-space helpers only; never change source coordinates or the game clock.
export function layoutResultMarkers(points,width,height){
 const clamp=(v,l,h)=>Math.max(l,Math.min(h,v));
 if(points.length===1)return [{x:clamp(points[0].x,12,width-12),y:clamp(points[0].y,20,height-20)}];
 const slots=[];for(let y=20;y<=height-20;y+=34)for(let x=12;x<=width-12;x+=24)slots.push({x,y});
 return points.map(p=>{let best=0;for(let i=1;i<slots.length;i++)if(Math.hypot(slots[i].x-p.x,slots[i].y-p.y)<Math.hypot(slots[best].x-p.x,slots[best].y-p.y))best=i;return slots.splice(best,1)[0];});
}
export function layoutVehicleSprites(items,obstacles=[]){
 const placed=[],directions=Array.from({length:8},(_,i)=>({x:Math.cos(i*Math.PI/4),y:Math.sin(i*Math.PI/4)}));
 for(const item of items){
  const occupied=[...obstacles,...placed],free=q=>occupied.every(b=>{const gap=Math.max(q.length||0,b.length||0)/2;return Math.abs(q.x-b.x)>=(q.width+b.width)/2+gap||Math.abs(q.y-b.y)>=(q.height+b.height)/2+gap;});
  let q={...item};
  if(!free(q)){
   const step=Math.max(item.width,item.height)/4;let found=false;
   for(let ring=1;ring<=32&&!found;ring++)for(const d of directions){q={...item,x:item.x+d.x*ring*step,y:item.y+d.y*ring*step};if(free(q)){found=true;break;}}
   if(!found)q={...item,x:Math.max(...occupied.map(b=>b.x+b.width/2+Math.max(item.length||0,b.length||0)/2))+item.width/2+1};
  }
  placed.push(q);
 }
 return placed;
}
export function createNoticeQueue(){
 let pending=[],active=null,until=0;
 return {push(text,duration){pending.push({text,duration});},at(now){if(active&&now>=until)active=null;if(!active&&pending.length){active=pending.shift();until=now+active.duration;}return active?.text||'';},clear(){pending=[];active=null;until=0;}};
}
