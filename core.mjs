export function stepMove(position,x,y,dt,speed,canWalk) {
  const vector=normalizeMove(x,y), distance=Math.min(Math.max(dt,0),0.05)*speed;
  const count=Math.max(1,Math.ceil(distance));
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

export function normalizeMove(x,y) {
  const length=Math.hypot(x,y);
  return length ? {x:x/length,y:y/length} : {x:0,y:0};
}
