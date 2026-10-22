import {pointInPoly, nearestRoad, circleIntersectsPoly} from './core.mjs';

// Shoelace area centroid, translated to the first vertex for numerical stability.
// Degenerate polygons fall back to the arithmetic mean of their vertices.
function polygonCenter(p) {
  const ox=p[0], oy=p[1];
  let area2=0, sx=0, sy=0;
  for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){
    const ax=p[j]-ox, ay=p[j+1]-oy, bx=p[i]-ox, by=p[i+1]-oy;
    const cross=ax*by-bx*ay;
    area2+=cross; sx+=(ax+bx)*cross; sy+=(ay+by)*cross;
  }
  if(area2!==0)return {x:ox+sx/(3*area2),y:oy+sy/(3*area2)};
  let x=0,y=0;
  for(let i=0;i<p.length;i+=2){x+=p[i];y+=p[i+1];}
  return {x:x/(p.length/2),y:y/(p.length/2)};
}

export function resolveFireSite(site, buildings) {
  let building=null, best=Infinity;
  for(const candidate of buildings){
    const p=candidate.p;
    if(!Array.isArray(p)||p.length<6)continue;
    let distance=pointInPoly(site.x,site.y,p)?0:Infinity;
    for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){
      const dx=p[i]-p[j],dy=p[i+1]-p[j+1];
      const t=Math.max(0,Math.min(1,((site.x-p[j])*dx+(site.y-p[j+1])*dy)/(dx*dx+dy*dy||1)));
      distance=Math.min(distance,Math.hypot(site.x-p[j]-t*dx,site.y-p[j+1]-t*dy));
    }
    if(distance<=40 && distance<best){best=distance;building=candidate;}
  }
  return building ? {...site,...polygonCenter(building.p),building} : {...site, building:null};
}

// Conservative radius bounding-box cells; objectives apply the exact circular cutoff.
export function waterCellKeys(site, availableKeys, cellSize=500, radius=300) {
  const minX=Math.floor((site.x-radius)/cellSize),maxX=Math.floor((site.x+radius)/cellSize);
  const minY=Math.floor((site.y-radius)/cellSize),maxY=Math.floor((site.y+radius)/cellSize);
  return availableKeys.filter(key=>{
    const [x,y]=key.split('_').map(Number);
    return x>=minX && x<=maxX && y>=minY && y<=maxY;
  });
}

// Doorway alignment is derived game state only; source coordinates remain the distance SOT.
// adjusted:false can mean the SOURCE is blocked but a legal sensing position exists <=3m.
// This finite boundary-candidate approximation is NOT a global nearest-point/path proof.
// null means invalid geometry or no safe candidate found: retain the source, flag for QA;
// callers must not delete objectives, relax collision, or use access for hose distances.
export function resolveDoorwayAccess(source, buildings, {radius=.32}={}) {
  if(!source || !Number.isFinite(source.x) || !Number.isFinite(source.y) ||
    !Number.isFinite(radius) || radius<0 || !Array.isArray(buildings))return null;
  const geometry=[];
  for(const b of buildings){
    const p=b?.p;
    if(!Array.isArray(p)||p.length<6||p.length%2||!p.every(Number.isFinite))return null;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(let i=0;i<p.length;i+=2){
      minX=Math.min(minX,p[i]);maxX=Math.max(maxX,p[i]);
      minY=Math.min(minY,p[i+1]);maxY=Math.max(maxY,p[i+1]);
    }
    geometry.push({p,minX,minY,maxX,maxY});
  }
  const legal=(x,y,r=radius)=>Number.isFinite(x)&&Number.isFinite(y)&&!geometry.some(b=>
    x+r>=b.minX&&x-r<=b.maxX&&y+r>=b.minY&&y-r<=b.maxY&&circleIntersectsPoly(x,y,r,b.p));
  const original=()=>({x:source.x,y:source.y,adjusted:false});
  if(legal(source.x,source.y))return original();
  // An actual witness, never an inference that the source itself is standable.
  for(let k=0;k<72;k++){
    const angle=k*Math.PI/36;
    if(legal(source.x+3*Math.cos(angle),source.y+3*Math.sin(angle)))return original();
  }
  const clearance=radius+.05;
  let reach=3+2*clearance;
  for(const b of geometry){
    if(!circleIntersectsPoly(source.x,source.y,radius,b.p))continue;
    for(let i=0;i<b.p.length;i+=2)
      reach=Math.max(reach,Math.hypot(b.p[i]-source.x,b.p[i+1]-source.y)+2*clearance+3);
  }
  const nearby=geometry.filter(b=>Math.hypot(Math.max(b.minX-source.x,0,source.x-b.maxX),
    Math.max(b.minY-source.y,0,source.y-b.maxY))<=reach);
  let best=null,bestDistance=Infinity, sensed=false;
  const consider=(x,y)=>{
    const distance=Math.hypot(x-source.x,y-source.y);
    if(distance<=3 && legal(x,y))sensed=true;
    if(distance<bestDistance && legal(x,y,clearance-1e-8)){
      best={x,y,adjusted:true};bestDistance=distance;
    }
  };
  for(const {p} of nearby){
    for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){
      const ax=p[j],ay=p[j+1],dx=p[i]-ax,dy=p[i+1]-ay,len=Math.hypot(dx,dy);
      if(!len)continue;
      const t=Math.max(0,Math.min(1,((source.x-ax)*dx+(source.y-ay)*dy)/(len*len)));
      const qx=ax+t*dx,qy=ay+t*dy;
      // Both normals avoid winding/concavity assumptions; every candidate checks ALL buildings.
      for(const margin of [radius+1e-7,clearance,clearance*2,clearance*4,clearance*8]){
        for(const sign of [-1,1])consider(qx+sign*dy/len*margin,qy-sign*dx/len*margin);
        for(let k=0;k<72;k++){
          const angle=k*Math.PI/36;
          consider(ax+Math.cos(angle)*margin,ay+Math.sin(angle)*margin);
        }
      }
    }
  }
  return sensed?original():best;
}

const waterKinds={hydrant_above:'地上消防栓',hydrant_under:'地下消防栓'};
export function waterLabel(source, roads=[]) {
  return nearestRoad(source.x,source.y,roads).name+(source.k==='hydrant_above'?'口':'旁')+(waterKinds[source.k]||'消防栓');
}

export function decodeWaterCells(cells, roads=[]) {
  return cells.flatMap(({key,rows})=>rows.map(([x,y,k],index)=>{
    const source={id:`${key}:${index}`,x,y,k};
    return {...source,n:waterLabel(source,roads)};
  }));
}

// A hydrant only counts when someone can stand within the hose radius of it (some list coordinates sit inside building outlines).
export function reachableWater(water, canStand, radius=3) {
  const offsets=[[0,0]];
  for(const r of [0.5,1,1.5,2,2.5,radius-0.1])for(let k=0;k<24;k++)offsets.push([r*Math.cos(k*Math.PI/12),r*Math.sin(k*Math.PI/12)]);
  return water.filter(w=>offsets.some(([dx,dy])=>canStand(w.x+dx,w.y+dy)));
}

export function selectObjectives(water, site, radius=300, limit=15) {
  return water.map((source,index)=>({source,index,distance:Math.hypot(source.x-site.x,source.y-site.y)}))
    .filter(item=>item.distance<=radius)
    .sort((a,b)=>a.distance-b.distance || a.index-b.index)
    .slice(0,limit).map(item=>item.source);
}

export function missionCandidates(sites, station, eligible=null) {
  const support = station.name === '復興分隊' || station.name === '永吉分隊';
  return sites.filter((site,index) => (!eligible || eligible.has(index)) && (support
    ? site.st !== station.name && Math.hypot(site.x-station.x, site.y-station.y) <= 2500
    : site.st === station.name));
}
