import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../core.mjs';

test('步進限制dt並逐小步阻擋穿牆，未知地格不通行',()=>{
  assert.equal(typeof core.stepMove,'function');
  let v=core.stepMove({x:0,y:0},1,0,10,100,(x)=>x<3);
  assert.ok(v.x<3);
  assert.ok(v.x>0);
  assert.deepEqual(core.stepMove({x:0,y:0},1,0,1,100,()=>false),{x:0,y:0});
  assert.equal(core.stepMove({x:0,y:0},1,0,10,100,()=>true).x,5);
});

test('移動向量正規化，斜走不加速且零輸入不移動', () => {
  assert.equal(typeof core.normalizeMove, 'function');
  assert.deepEqual(core.normalizeMove(0, 0), {x:0,y:0});
  const v = core.normalizeMove(1, 1);
  assert.ok(Math.abs(Math.hypot(v.x,v.y)-1)<1e-10);
  assert.deepEqual(core.normalizeMove(-1,0),{x:-1,y:0});
});

test('建物輪廓內與邊界都不可走，屋外可走', () => {
  assert.equal(typeof core.pointInPoly, 'function');
  const polygon=[0,0,10,0,10,10,0,10];
  assert.equal(core.pointInPoly(5,5,polygon),true);
  assert.equal(core.pointInPoly(0,5,polygon),true);
  assert.equal(core.pointInPoly(11,5,polygon),false);
  assert.equal(core.pointInPoly(5,5,[]),false);
});

test('atlas 以64×80取格，方向下左右上且站立為中格',()=>{
  assert.equal(typeof core.atlasFrame,'function');
  assert.deepEqual(core.atlasFrame('down',false,0),{sx:64,sy:0,sw:64,sh:80,footY:76});
  assert.equal(core.atlasFrame('left',true,0).sy,80);
  assert.equal(core.atlasFrame('right',true,0.16).sx,64);
  assert.equal(core.atlasFrame('up',true,0.32).sy,240);
});
