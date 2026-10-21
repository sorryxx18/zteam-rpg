import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
function latest(selector,property){let value;for(const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){if(match[1].trim()!==selector)continue;for(const declaration of match[2].split(';')){const [key,...rest]=declaration.split(':');if(key.trim()===property)value=rest.join(':').trim();}}return value;}
test('目前所在HUD不能繼承舊圓點的10px第一欄，路名與分隊必須各占完整單欄',()=>{
 assert.match(latest('.location','grid-template-columns'),/^(?:minmax\(0,\s*1fr\)|1fr)$/);
 assert.equal(latest('.location small','grid-column'),'1');
});
