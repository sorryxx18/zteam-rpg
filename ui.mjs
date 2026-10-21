// Screen-space helpers only; never change source coordinates or the game clock.
export function layoutResultMarkers(points,width,height){
 const clamp=(v,l,h)=>Math.max(l,Math.min(h,v));
 if(points.length===1)return [{x:clamp(points[0].x,12,width-12),y:clamp(points[0].y,20,height-20)}];
 const slots=[];for(let y=20;y<=height-20;y+=34)for(let x=12;x<=width-12;x+=24)slots.push({x,y});
 return points.map(p=>{let best=0;for(let i=1;i<slots.length;i++)if(Math.hypot(slots[i].x-p.x,slots[i].y-p.y)<Math.hypot(slots[best].x-p.x,slots[best].y-p.y))best=i;return slots.splice(best,1)[0];});
}
export function createNoticeQueue(){
 let pending=[],active=null,until=0;
 return {push(text,duration){pending.push({text,duration});},at(now){if(active&&now>=until)active=null;if(!active&&pending.length){active=pending.shift();until=now+active.duration;}return active?.text||'';},clear(){pending=[];active=null;until=0;}};
}
