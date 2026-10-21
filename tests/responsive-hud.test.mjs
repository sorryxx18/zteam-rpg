import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
function latest(selector,property){let value;for(const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){if(match[1].trim()!==selector)continue;for(const declaration of match[2].split(';')){const [key,...rest]=declaration.split(':');if(key.trim()===property)value=rest.join(':').trim();}}return value;}
test('目前所在 is a single upper-right row, with ellipsis and separate countdown/tools lanes',()=>{
 assert.equal(latest('.location','display'),'flex');
 assert.equal(latest('.location','left'),'auto');
 assert.equal(latest('.location','right'),'12px');
 assert.equal(latest('.location','height'),'32px');
 assert.equal(latest('.location','white-space'),'nowrap');
 assert.equal(latest('.location strong','text-overflow'),'ellipsis');
 assert.equal(latest('.location strong','overflow'),'hidden');
 assert.equal(latest('.location strong','min-width'),'0');
 assert.equal(latest('.race-hud','left'),'12px');
 assert.equal(latest('.race-hud','right'),'auto');
 assert.equal(latest('.race-hud','width'),'76px');
 assert.equal(latest('.tools','top'),'48px');
 assert.equal(latest('.location','width'),'calc(100% - 112px)');
 assert.equal(latest('.location small','text-overflow'),'ellipsis');
});
test('cache entrypoints consistently invalidate 6b1',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const game=readFileSync(new URL('../game.js',import.meta.url),'utf8');
 const versions=[...`${html}\n${game}`.matchAll(/\?v=([^'";\s]+)/g)].map(m=>m[1]);
 assert.ok(versions.length>=7);assert.deepEqual([...new Set(versions)],['6b1p1']);
});
