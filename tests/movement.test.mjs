import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.mjs';

test('ten seconds uses full normal dt at 60/20/10 FPS, analog and diagonal distances',()=>{
  for(const fps of [60,20,10])for(const speed of [1.4,3])for(const [x,y,magnitude] of [[1,0,1],[1,1,1],[.5,0,.5],[0,0,0]]){
    let p={x:0,y:0};
    for(let i=0;i<fps*10;i++)p=core.stepMove(p,x,y,1/fps,speed,()=>true);
    assert.ok(Math.abs(Math.hypot(p.x,p.y)-10*speed*magnitude)<1e-9,`${fps} FPS ${speed} ${x},${y}`);
  }
  assert.equal(core.stepMove({x:0,y:0},1,0,.25,3,()=>true).x,.75);
});

test('substeps <= .15m stop thin walls and unknown cells; >.25s stalls are discarded',()=>{
  let largest=0,last=0;
  const p=core.stepMove({x:0,y:0},1,0,.25,3,x=>{largest=Math.max(largest,Math.abs(x-last));last=x;return !(x>=.3&&x<=.5);});
  assert.ok(p.x<.3);assert.ok(largest<=.150000001);
  for(const dt of [.250001,1,10,-1,NaN,Infinity])assert.deepEqual(core.stepMove({x:2,y:3},1,0,dt,3,()=>true),{x:2,y:3});
  assert.deepEqual(core.stepMove({x:0,y:0},1,0,.1,3,()=>false),{x:0,y:0});
});

test('shared .32m disk footprint catches corners and very thin polygons',()=>{
  assert.equal(typeof core.circleIntersectsPoly,'function');
  const wall=[1,-2,1.01,-2,1.01,2,1,2];
  assert.equal(core.circleIntersectsPoly(.68,0,.32,wall),true);
  assert.equal(core.circleIntersectsPoly(.67,0,.32,wall),false);
  const square=[0,0,2,0,2,2,0,2];
  assert.equal(core.circleIntersectsPoly(-.22,-.22,.32,square),true);
  assert.equal(core.circleIntersectsPoly(-.24,-.24,.32,square),false);
  assert.equal(core.circleIntersectsPoly(1,1,.32,square),true);
});

test('analog magnitude is retained within unit circle; diagonal is clamped',()=>{
  assert.deepEqual(core.normalizeMove(.5,0),{x:.5,y:0});
  assert.deepEqual(core.normalizeMove(0,0),{x:0,y:0});
  assert.ok(Math.abs(Math.hypot(...Object.values(core.normalizeMove(1,1)))-1)<1e-12);
});
