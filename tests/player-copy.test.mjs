import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {RULES} from '../race.mjs';
const game=readFileSync(new URL('../game.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('首次教學與開場均說明三分半鐘，不留下三分鐘舊規則',()=>{
 assert.equal(RULES.roundSeconds,210);
 const match=game.match(/const tutorialText=(\[[^;]+\]);/);
 assert.ok(match,'讀取遊戲實際使用的教學內容');
 const steps=vm.runInNewContext(match[1]);
 assert.ok(steps.some(text=>/三分半鐘|3分30秒/.test(text)));
 assert.ok(steps.every(text=>!text.includes('三分鐘')));
 assert.match(html,/三分半鐘/);
 assert.match(html,/任務3分30秒/);
});
