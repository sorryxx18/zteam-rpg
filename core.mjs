export const COLLISION_RADIUS=.6;

export function nearestRoad(x,y,roads) {
  let best=null,distance=Infinity;
  for(const road of roads) {
    const p=road.p||[];
    for(let i=2;i<p.length;i+=2) {
      const ax=p[i-2],ay=p[i-1],dx=p[i]-ax,dy=p[i+1]-ay;
      const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
      const d=Math.hypot(x-ax-t*dx,y-ay-t*dy);
      if(d<distance){distance=d;best=road;}
    }
  }
  return {name:best&&distance<=Math.max(15,(best.w||0)/2+8)&&best.n?best.n:'巷弄／未命名道路',distance};
}

export function nearestStandableRoad(x,y,roads,canStand,maxDistance=Infinity) {
  const segments=[];
  for(const road of roads)for(let i=2;i<road.p.length;i+=2){
    const ax=road.p[i-2],ay=road.p[i-1],dx=road.p[i]-ax,dy=road.p[i+1]-ay,len=Math.hypot(dx,dy);
    if(!len)continue;
    const along=Math.max(0,Math.min(len,((x-ax)*dx+(y-ay)*dy)/len));
    segments.push({ax,ay,dx:dx/len,dy:dy/len,len,along,distance:Math.hypot(ax+dx/len*along-x,ay+dy/len*along-y)});
  }
  segments.sort((a,b)=>a.distance-b.distance);let best=null,bestDistance=maxDistance;
  for(const s of segments){
    if(s.distance>bestDistance)break;
    for(let offset=0;offset<=Math.ceil(s.len);offset++){
      if(Math.hypot(s.distance,offset)>bestDistance+1)break;
      for(const along of offset?[s.along-offset,s.along+offset]:[s.along]){
        if(along<0||along>s.len)continue;
        const p={x:s.ax+s.dx*along,y:s.ay+s.dy*along},distance=Math.hypot(p.x-x,p.y-y);
        if(distance<=bestDistance&&canStand(p.x,p.y)){best=p;bestDistance=distance;}
      }
    }
  }
  return best;
}

export function stepMove(position,x,y,dt,speed,canWalk) {
  // Normal frames integrate completely. Stalls/background gaps >250ms are discarded,
  // never caught up; each collision sample advances at most 15cm.
  if(!Number.isFinite(dt)||dt<0||dt>0.25)return {...position};
  const vector=normalizeMove(x,y), distance=dt*speed;
  const count=Math.max(1,Math.ceil(distance/0.15));
  let p={...position};
  for(let i=0;i<count;i++) {
    const dx=vector.x*distance/count,dy=vector.y*distance/count;
    if(canWalk(p.x+dx,p.y)) p.x+=dx;
    if(canWalk(p.x,p.y+dy)) p.y+=dy;
  }
  return p;
}

export function atlasFrame(direction,moving,time) {
  const row={down:0,left:1,right:2,up:3}[direction] ?? 0;
  return {sx:(moving?Math.floor(time/0.16)%3:1)*64,sy:row*80,sw:64,sh:80,footY:76};
}

export function pointInPoly(x,y,p) {
  let inside=false;
  for(let i=0,j=p.length-2;i<p.length;j=i,i+=2) {
    const ax=p[j], ay=p[j+1], bx=p[i], by=p[i+1];
    const cross=(x-ax)*(by-ay)-(y-ay)*(bx-ax);
    if(Math.abs(cross)<1e-7 && x>=Math.min(ax,bx) && x<=Math.max(ax,bx) && y>=Math.min(ay,by) && y<=Math.max(ay,by)) return true;
    if((ay>y)!==(by>y) && x<(bx-ax)*(y-ay)/(by-ay)+ax) inside=!inside;
  }
  return inside;
}

export function circleIntersectsPoly(x,y,radius,p) {
  if(pointInPoly(x,y,p))return true;
  for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){
    const dx=p[i]-p[j],dy=p[i+1]-p[j+1];
    const t=Math.max(0,Math.min(1,((x-p[j])*dx+(y-p[j+1])*dy)/(dx*dx+dy*dy||1)));
    if(Math.hypot(x-p[j]-t*dx,y-p[j+1]-t*dy)<=radius+1e-10)return true;
  }
  return false;
}

export function normalizeMove(x,y) {
  const length=Math.max(1,Math.hypot(x,y));
  return {x:x/length,y:y/length};
}
