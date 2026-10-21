import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// Source-level guardrails only: no computed layout or browser hit-testing.
function rule(selector) {
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  return blocks.filter(([, selectors]) => selectors.trim() === selector)
    .map(([, , body]) => body).join(';');
}
function property(body, name) {
  const values = [...body.matchAll(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'g'))];
  return values.at(-1)?.[1].trim();
}

test('任務與教學卡具有高於 intro 的置中、可捲動安全容器，hidden 不受 display 覆蓋', () => {
  for (const id of ['mission-card', 'tutorial-card']) {
    assert.match(html, new RegExp(`<section[^>]*id="${id}"[^>]*class="prelude-card"[^>]*hidden`));
  }
  const card = rule('.prelude-card');
  assert.equal(property(card, 'position'), 'absolute', '卡片必須脫離文件流');
  assert.ok(Number(property(card, 'z-index')) > Number(property(rule('#intro'), 'z-index')), '卡片應高於 intro');
  assert.equal(property(card, 'margin'), 'auto');
  assert.match(property(card, 'inset') ?? '', /16px/);
  assert.match(property(card, 'inset') ?? '', /safe-area-inset/);
  assert.match(property(card, 'width') ?? '', /min\(560px,\s*calc\(100% - 32px/);
  assert.equal(property(card, 'height'), 'fit-content');
  assert.match(property(card, 'max-height') ?? '', /calc\(100% - 32px/);
  assert.equal(property(card, 'overflow-y'), 'auto');
  assert.equal(property(card, 'overflow-wrap'), 'anywhere');
  assert.equal(property(rule('[hidden]'), 'display'), 'none!important');
  assert.equal(property(rule('.prelude-card[hidden]'), 'display'), 'none!important');
  const button = rule('.prelude-card button');
  assert.equal(property(button, 'width'), '100%');
  assert.equal(property(button, 'min-height'), '48px');
  assert.equal(property(button, 'white-space'), 'normal');
  assert.equal(property(button, 'flex-shrink'), '0');
});

test('CSS 與遊戲入口使用同一個 v2 第二批快取版號', () => {
  assert.match(html, /href="\.\/style\.css\?v=6v3e"/);
  assert.match(html, /src="\.\/game\.js\?v=6v3e"/);
});
