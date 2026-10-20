import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../data/',import.meta.url);
test('轄區概覽沿用真實道路與九分隊，無新增虛構位置',()=>{
 const overview=JSON.parse(fs.readFileSync(new URL('overview.json',root),'utf8'));
 const base=JSON.parse(fs.readFileSync(new URL('base.json',root),'utf8'));
 assert.deepEqual(overview.stations,base.stations);
 assert.ok(overview.roads.length>100);
 const signatures=new Set();
 for(const key of base.cells)for(const r of JSON.parse(fs.readFileSync(new URL(`c/${key}.json`,root),'utf8')).roads||[])signatures.add(JSON.stringify([r.p,r.w,r.n||'']));
 for(const r of overview.roads)assert.ok(signatures.has(JSON.stringify([r.p,r.w,r.n||''])),'each overview road must match original geometry');
 assert.ok(fs.statSync(new URL('overview.json',root)).size<2500000,'overview stays light enough for mobile');
});
