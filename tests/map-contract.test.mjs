import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
test('published map is real station geometry without dispatch/address records', () => {
  const file = new URL('data/base.json', root);
  assert.ok(fs.existsSync(file), 'game map must exist');
  const d = JSON.parse(fs.readFileSync(file));
  assert.equal(d.stations.length, 9);
  assert.ok(d.cells.length > 0);
  assert.equal(d.cs, 500);
  assert.equal(d.calls, undefined);
  assert.equal(d.g, undefined);
  for (const s of d.stations) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
    const cx = Math.floor(s.x/d.cs), cy = Math.floor(s.y/d.cs);
    assert.ok(d.cells.includes(`${cx}_${cy}`), `${s.name} needs a playable cell`);
  }
  for (const key of d.cells) {
    assert.match(key, /^-?\d+_-?\d+$/);
    const cell = JSON.parse(fs.readFileSync(new URL(`data/c/${key}.json`, root)));
    assert.ok(Array.isArray(cell.roads) && Array.isArray(cell.builds));
    for (const r of cell.roads) assert.ok(r.p.length >= 4 && r.p.every(Number.isFinite));
  }
});
