import assert from 'node:assert/strict';
import test from 'node:test';
import { advancedRailOpen, railNavHtml, splitRail } from '../workbench/rail-nav.js';

const items = [
  { key: 'overview', group: '工作', label: '概要', icon: 'inbox' },
  { key: 'memory', group: '上下文', label: '记忆', icon: 'db' },
  { key: 'asset-revisions', group: '高级', label: '版本与依据', icon: 'layers' }
];

const esc = (value: any) => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[ch]);
const icon = (name: string) => '<svg data-icon="' + name + '"></svg>';
const render = (overrides: Record<string, unknown> = {}) => railNavHtml({
  ...splitRail(items as any, '高级'), current: 'overview', showAdvanced: false,
  counts: {}, countKeys: {}, esc, icon, ...overrides
} as any);

test('splitRail keeps only the advanced group behind the disclosure', () => {
  assert.deepEqual(splitRail(items as any, '高级').everyday.map(item => item.key), ['overview', 'memory']);
  assert.deepEqual(splitRail(items as any, '高级').advanced.map(item => item.key), ['asset-revisions']);
  assert.deepEqual(splitRail([] as any, '高级'), { everyday: [], advanced: [] });
});

test('the disclosure opens on request or when the current page lives inside it', () => {
  const advanced = splitRail(items as any, '高级').advanced;
  assert.equal(advancedRailOpen(advanced, 'memory', false), false);
  assert.equal(advancedRailOpen(advanced, 'memory', true), true);
  assert.equal(advancedRailOpen(advanced, 'asset-revisions', false), true);
});

test('the rail renders group headers, count badges and one disclosure', () => {
  const html = render();
  assert.match(html, /<div class="nav-group">工作<\/div>/);
  assert.match(html, /<div class="nav-group">上下文<\/div>/);
  assert.match(html, /data-page="overview"[^>]*aria-current="true"/);
  assert.match(html, /aria-label="概要"/);
  assert.match(html, /title="概要"/);
  assert.match(html, /data-page="memory"/);
  assert.match(html, /data-nav-more aria-expanded="false"/);
  assert.doesNotMatch(html, /data-page="asset-revisions"/);
  assert.match(render({ counts: { knowledge_claim: 7 }, countKeys: { overview: 'knowledge_claim' } }), /<span class="nav-count">7<\/span>/);
});

test('an open disclosure lists its pages and escapes labels', () => {
  const html = render({ showAdvanced: true });
  assert.match(html, /data-nav-more aria-expanded="true"/);
  assert.match(html, /data-page="asset-revisions"/);
  assert.match(render({ everyday: [{ key: 'x', label: '<b>', icon: 'dot' }] }), /&lt;b&gt;/);
  assert.doesNotMatch(render({ everyday: [], advanced: [] }), /data-nav-more/);
});
