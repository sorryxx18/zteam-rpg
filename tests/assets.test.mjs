import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
for (const role of ['male','female','rhino']) {
  test(`${role} has a consistent transparent 3 by 4 atlas`, () => {
    const f = new URL(`../assets/${role}.png`, import.meta.url);
    assert.ok(fs.existsSync(f), `${role} atlas must exist`);
    const b = fs.readFileSync(f);
    assert.equal(b.subarray(1,4).toString(), 'PNG');
    assert.equal(b.readUInt32BE(16), 192);
    assert.equal(b.readUInt32BE(20), 320);
    assert.equal(b[25], 6, 'RGBA pixels required');
  });
}
