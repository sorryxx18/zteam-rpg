import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
function latest(selector,property){let value;for(const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){if(match[1].trim()!==selector)continue;for(const declaration of match[2].split(';')){const [key,...rest]=declaration.split(':');if(key.trim()===property)value=rest.join(':').trim();}}return value;}
test('手機完整路名與分隊方位分行，保留左側倒數及右側工具',()=>{
 assert.equal(latest('.location','display'),'grid');
 assert.equal(latest('.location','left'),'auto');
 assert.equal(latest('.location','right'),'12px');
 assert.equal(latest('.location','height'),'auto');
 assert.equal(latest('.location','white-space'),'normal');
 assert.equal(latest('.location strong','text-overflow'),'clip');
 assert.equal(latest('.location strong','overflow'),'visible');
 assert.equal(latest('.location strong','white-space'),'normal');
 assert.equal(latest('.location strong','min-width'),'0');
 assert.equal(latest('.race-hud','left'),'12px');
 assert.equal(latest('.race-hud','right'),'auto');
 assert.equal(latest('.race-hud','width'),'140px');
 assert.equal(latest('.tools','top'),'102px');
 assert.equal(latest('.location','width'),'calc(100% - 174px)');
 assert.equal(latest('.location small','white-space'),'normal');
});
test('頁尾可換行，不用隱藏水平溢出來裁掉版權文字',()=>{
 assert.equal(latest('footer','white-space'),'normal');
 assert.equal(latest('footer small','min-width'),'0');
 assert.equal(latest('footer small','overflow-wrap'),'anywhere');
});
test('施工取消是高於雙指層的原生48px按鈕，HUD四行不溢出',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/<button id="construction-cancel" type="button">取消佈線<\/button>/);
 assert.equal(latest('#construction-panel','pointer-events'),'auto');assert.ok(Number(latest('#construction-panel','z-index'))>4);
 assert.ok(parseFloat(latest('#construction-cancel','min-height'))>=48);assert.equal(latest('#construction-cancel','touch-action'),'manipulation');
 assert.match(html,/id="round-score"/);assert.ok(parseFloat(latest('.race-hud','height'))>=80,'倒數、佔領、水帶與分數四行需要80px以上');
});
test('cache entrypoints consistently invalidate 6v32e',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const game=readFileSync(new URL('../game.js',import.meta.url),'utf8');
 const versions=[...`${html}\n${game}`.matchAll(/\?v=([^'";\s]+)/g)].map(m=>m[1]);
 assert.ok(versions.length>=7);assert.deepEqual([...new Set(versions)],['6v32e']);
});
