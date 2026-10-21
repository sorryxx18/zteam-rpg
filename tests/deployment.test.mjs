import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Pages公開目錄包含玩法模型與既有靜態資料，不遺漏新模組',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
  assert.match(workflow,/cp [^\n]*\brace\.mjs\b[^\n]*_site\//);
  assert.match(workflow,/cp [^\n]*\bqa-clock\.mjs\b[^\n]*_site\//);
  assert.match(workflow,/cp [^\n]*\bmissions\.mjs\b[^\n]*_site\//,'v2任務模組必須隨靜態資產交付');
  assert.match(workflow,/cp -R assets data _site\//);
  assert.match(workflow,/node --test tests\/\*\.test\.mjs/);
});
