import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');
const game=fs.readFileSync(new URL('../game.js',import.meta.url),'utf8');
test('指揮官文字使用獨立DOM，不繼承低解析度像素Canvas',()=>{
 assert.match(html,/id="commander-bubble"/);
 assert.match(game,/bubbleElement\.textContent=lines\.join/);
 const draw=game.slice(game.indexOf('function drawCommander('),game.indexOf('function drawFire('));
 assert.doesNotMatch(draw,/c\.fillText/);
 assert.match(css,/#commander-bubble\{[^}]*font:600 16px\/22px/);
 assert.match(css,/#commander-bubble\{[^}]*pointer-events:none/);
 assert.match(css,/#commander-bubble\{[^}]*z-index:11/,'氣泡不被小地圖和路名遮住');
});
test('網頁及頁首只用遊戲名稱，不再附帶像素街區',()=>{
 assert.match(html,/<title>犀牛搶水源<\/title>/);
 assert.match(html,/<h1>犀牛搶水源<\/h1>/);
 assert.doesNotMatch(html,/像素街區|像素地圖/);
});
