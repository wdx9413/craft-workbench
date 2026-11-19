import assert from 'node:assert/strict';
import test from 'node:test';
import { esc, icon, label, fromLabel, statusPill, effectPill, settled, head, emptyState, countChip, asideBlock, asideRows, failureText, STATUS_LABELS, changeSetStatusLabel, $, val, checked, lines, shortTime, pill, receiptName, statTile, lead } from '../web/ui.js';

test('failure text translates known kernel sentences and keeps unknown ones verbatim', () => {
  assert.match(failureText('task has no workspace; choose a project before dispatch'), /工作目录/u);
  assert.match(failureText('Model openai has no credential'), /密钥/u);
  assert.match(failureText('fetch failed'), /模型服务/u);
  // An untranslated reason must still reach the user; hiding it would hide the
  // reason the task failed.
  assert.equal(failureText('some brand new failure'), 'some brand new failure');
  assert.equal(failureText(''), '');
  assert.equal(failureText(null), '');
});

test('change set statuses have Chinese labels and unknown fallback', () => {
  assert.equal(changeSetStatusLabel('draft'), '待接受');
  assert.equal(changeSetStatusLabel('applied'), '已接受');
  assert.equal(changeSetStatusLabel('rejected'), '已拒绝');
  assert.equal(changeSetStatusLabel('future'), '未知状态');
});

test('esc escapes html and renders nullish as empty', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('icon falls back to a dot for unknown names', () => {
  assert.match(icon('spark'), /class="ic"/u);
  assert.match(icon('does-not-exist'), /class="ic"/u);
  assert.match(icon('spark', 'big'), /class="ic big"/u);
});

test('label/fromLabel translate enums both ways and fall back', () => {
  assert.equal(label(STATUS_LABELS, 'completed', '?'), '已完成');
  assert.equal(label(STATUS_LABELS, 'weird', '?'), 'weird');
  assert.equal(label(STATUS_LABELS, '', '—'), '—');
  assert.equal(fromLabel(STATUS_LABELS, '已完成', 'raw'), 'completed');
  assert.equal(fromLabel(STATUS_LABELS, 'completed', 'raw'), 'completed');
  assert.equal(fromLabel(STATUS_LABELS, '已完成 ', 'raw'), 'completed');
  assert.equal(fromLabel(STATUS_LABELS, 'not-a-status', 'raw'), 'raw');
  assert.equal(fromLabel(STATUS_LABELS, '', 'raw'), 'raw');
});

test('status and effect pills use semantic tones', () => {
  assert.match(statusPill('completed'), /已完成/u);
  assert.match(statusPill('completed'), /ok/u);
  assert.match(statusPill('failed'), /danger/u);
  assert.match(effectPill('destructive'), /danger/u);
  assert.match(effectPill('read_only'), /ok/u);
  assert.match(effectPill('local_write'), /warn/u);
});

test('settled resolves failures to the fallback without throwing', async () => {
  assert.deepEqual(await settled(Promise.resolve({ ok: 1 }), { ok: 0 }), { ok: 1 });
  assert.deepEqual(await settled(Promise.reject(new Error('no')), { ok: 0 }), { ok: 0 });
});

test('card helpers produce stable markup', () => {
  assert.match(head('标题', '说明', '<b>1</b>'), /<h2>标题<\/h2>/u);
  assert.match(head('标题', '', ''), /标题/u);
  assert.match(emptyState('空的', '去新建', 'plus'), /空的/u);
  assert.equal(countChip(3), '<span class="count-chip">3</span>');
  assert.match(asideBlock('状态', '2', '<p>x</p>'), /<span>状态<\/span>/u);
  assert.match(asideRows([['键', '值']]), /<span class="v">值<\/span>/u);
});

test('shortTime formats parseable timestamps and keeps unparseable ones verbatim', () => {
  assert.equal(shortTime(''), '');
  assert.equal(shortTime(null), '');
  assert.equal(shortTime('not-a-date'), 'not-a-date');
  assert.match(shortTime('2026-03-04T05:06:07Z'), /^\d{2}\/\d{2} \d{2}:\d{2}$/u);
});

test('pill and statTile add tones only when supplied and render an em dash for empties', () => {
  assert.equal(pill('完成'), '<span class="pill">完成</span>');
  assert.equal(pill('完成', 'ok'), '<span class="pill ok">完成</span>');
  assert.match(statTile('累计', 0, 'db'), /<b>0<\/b>/u);
  assert.match(statTile('累计', '', 'db'), /<b>—<\/b>/u);
  assert.match(statTile('累计', null, 'db', 'warn'), /stat-ic warn/u);
  assert.match(lead('db'), /<span class="row-lead">/u);
  assert.match(lead('db', 'danger'), /<span class="row-lead danger">/u);
});

test('receipt names split stage and action, collapsing a repeated word', () => {
  assert.equal(receiptName('review:git_diff'), '复查 · 代码差异');
  assert.equal(receiptName('review:review'), '复查');
  assert.equal(receiptName('plain'), 'plain');
  assert.equal(receiptName(''), '—');
});

test('form readers return trimmed values, checked flags and non-empty lines', () => {
  const nodes: Record<string, Record<string, unknown>> = {
    name: { value: '  alice  ' },
    blank: { value: '' },
    unset: {},
    agree: { checked: true },
    list: { value: ' a \r\n\r\n b \n ' },
    off: { checked: false },
  };
  (globalThis as any).document = { getElementById: (id: string) => nodes[id] ?? null };
  try {
    assert.equal($('name'), nodes.name);
    assert.equal(val('name'), 'alice');
    assert.equal(val('blank'), '');
    assert.equal(val('unset'), '');
    assert.equal(val('missing'), '');
    assert.equal(checked('agree'), true);
    assert.equal(checked('off'), false);
    assert.equal(checked('missing'), false);
    assert.deepEqual(lines('list'), ['a', 'b']);
    assert.deepEqual(lines('blank'), []);
    assert.deepEqual(lines('unset'), []);
    assert.deepEqual(lines('missing'), []);
  } finally {
    delete (globalThis as any).document;
  }
});

test('unknown and empty enum values fall back without inventing a tone', () => {
  assert.equal(label(STATUS_LABELS, ''), '—');
  assert.equal(fromLabel(STATUS_LABELS, undefined, 'raw'), 'raw');
  assert.equal(fromLabel(STATUS_LABELS, null, 'raw'), 'raw');
  assert.match(statusPill(''), /<span class="pill">—<\/span>/u);
  assert.match(statusPill('weird'), /<span class="pill">weird<\/span>/u);
  assert.match(effectPill(''), /未声明/u);
  assert.match(effectPill('unknown-effect'), /unknown-effect/u);
});

test('empty states and aside blocks omit optional parts', () => {
  assert.match(emptyState('空'), /<b>空<\/b><\/div>/u);
  assert.match(emptyState('空', ''), /class="ic empty-ic"/u);
  assert.match(asideBlock('标题', '', '<p>x</p>'), /<\/div><p>x<\/p>/u);
});
