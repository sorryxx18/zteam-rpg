import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const game=fs.readFileSync(new URL('../game.js',import.meta.url),'utf8');
function load(name){const start=game.indexOf(`function ${name}(`);assert.ok(start>=0,`${name} must exist`);let depth=0,end=game.indexOf('{',start);const body=end;do{if(game[end]==='{')depth++;if(game[end]==='}')depth--;end++;}while(depth&&end<game.length);return vm.runInNewContext(`(${game.slice(start,end)})`);}
test('scale chooses real 1/2/5 metres using scene zoom and CSS/backing conversion',()=>{
 const choose=load('distanceScale');
 for(const cssWidth of [320,390,844,1440])for(const backingWidth of [cssWidth,cssWidth*2,1600])for(const zoom of [.4,1,2,4,8,12,18]){
  const ppm=zoom*cssWidth/backingWidth,s=choose(zoom,cssWidth,backingWidth);
  assert.ok(Math.abs(s.pixels-s.metres*ppm)<1e-8);
  const mantissa=s.metres/10**Math.floor(Math.log10(s.metres));
  assert.ok([1,2,5].some(n=>Math.abs(n-mantissa)<1e-8));
  assert.ok(s.pixels>=40-1e-8&&s.pixels<=100+1e-8,`${s.pixels} CSS px`);
 }
 assert.notEqual(choose(2,390,780).metres,choose(12,390,780).metres);
 assert.match(game,/distanceScale\(sceneZoom,canvas\.getBoundingClientRect\(\)\.width,width\)/);
 assert.match(game,/\$\('scale-label'\)\.textContent/);
});
test('fire is a CSS-pixel sprite on mobile/desktop and keeps the original anchor',()=>{
 const draw=load('drawFire');
 for(const ratio of [1,2,3,1.25])for(const frame of [0,1,2,17]){
  const rectangles=[],translates=[],scales=[];let color='';
  const c={save(){},restore(){},translate(...v){translates.push(v);},scale(...v){scales.push(v);},set fillStyle(v){color=v;},fillRect(...r){rectangles.push({color,r});}};
  draw(c,123,456,ratio,false,frame);
  assert.deepEqual(translates,[[123,456]]);assert.deepEqual(scales,[[ratio,ratio]]);
  const flames=rectangles.filter(v=>v.color==='#ff6b21');
  assert.equal(flames.length,3);
  const left=Math.min(...flames.map(v=>v.r[0])),right=Math.max(...flames.map(v=>v.r[0]+v.r[2]));
  assert.equal(right-left,40);assert.ok(flames.every(v=>v.r[1]+v.r[3]===0));
  assert.ok(Math.max(...flames.map(v=>v.r[3]))>=48);
  assert.equal(rectangles.filter(v=>v.color==='#252525cc').length,4);
 }
 const calls=[];const c={save(){},restore(){},translate(){},scale(...v){calls.push(v);},fillRect(){}};
 draw(c,0,0,3,true,0);assert.deepEqual(calls,[[1,1]],'minimap remains tiny');
 assert.match(game,/drawFire\(c,fx,fy,ratio,isMini,frame\)/);
});
