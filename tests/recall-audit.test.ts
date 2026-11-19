import assert from 'node:assert/strict';
import test from 'node:test';
import { bindRecallAudit } from '../web/recall-audit.js';

function flush() { return new Promise<void>((resolve) => setTimeout(resolve, 0)); }

test('recall audit binds once, toggles without refetching, and passes member plus asset id', async () => {
  const calls: string[] = [];
  const api = async (path: string) => { calls.push(path); return { receipts: [
    { id: 'r1', feedback: [{ outcome: 'helpful' }] },
    { id: 'r2', feedback: [] },
  ] }; };
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: (name: string) => name === 'data-audit' ? 'claim-1' : '',
    parentElement: { querySelector: (selector: string) => selector === '[data-recall-audit-list]' ? list : null },
  };
  const root = { querySelectorAll: (selector: string) => selector === '[data-audit]' ? [button] : [] };
  bindRecallAudit(root, { api, attribute: 'data-audit', member: 'knowledge' });
  button.onclick!();
  await flush();
  assert.ok(calls[0]?.includes('member=knowledge') && calls[0]?.includes('asset_id=claim-1'));
  assert.match(list.textContent, /回执 r1 · helpful/u);
  assert.match(list.textContent, /回执 r2 · 未标注/u);
  // Toggling collapses without a second request; rebinding is a no-op.
  calls.length = 0;
  bindRecallAudit(root, { api, attribute: 'data-audit', member: 'knowledge' });
  button.onclick!();
  assert.equal(list.hidden, true);
  assert.equal(calls.length, 0);
  // Reopening fetches again.
  button.onclick!();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(list.hidden, false);
});
test('weight trend binds once and renders the running weight with counted flags', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const calls: string[] = [];
  const api = async (path: string) => { calls.push(path); return {
    member: 'knowledge', asset_id: 'claim-1', current_weight: 1,
    counts: { positive: 1, negative: 1, dismissed: 0, events: 2 },
    points: [{ at: 't1', weight: 1.2 }, { at: 't2', weight: 1 }],
    timeline: [
      { at: 't1', kind: 'helpful', source: 'feedback', counted: true, weight_after: 1.2 },
      { at: 't2', kind: 'incorrect', source: 'correction', counted: true, weight_after: 1 },
    ],
  }; };
  const list = { hidden: true, textContent: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: (name: string) => name === 'data-trend' ? 'claim-1' : '',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
  };
  const root = { querySelectorAll: (selector: string) => selector === '[data-trend]' ? [button] : [] };
  bindWeightTrend(root, { api, attribute: 'data-trend', member: 'knowledge' });
  button.onclick!();
  await flush(); await flush();
  assert.ok(calls[0]?.includes('feedback-history'));
  assert.ok(calls[0]?.includes('member=knowledge'));
  assert.ok(calls[0]?.includes('asset_id=claim-1'));
  assert.match(list.innerHTML, /当前权重 1\.00/u);
  assert.match(list.innerHTML, /1\.20 → 1\.00/u);
  assert.match(list.innerHTML, /t1 · helpful · 计入 · 权重 1\.20/u);
  assert.match(list.innerHTML, /t2 · incorrect · 计入 · 权重 1\.00/u);
  // The sparkline is additive and keeps the text summary as the fallback.
  assert.match(list.innerHTML, /<svg[^>]*aria-label="权重趋势"/u);
  assert.match(list.innerHTML, /<polyline[^>]*points="4\.0,4\.0 236\.0,44\.0"/u);
  assert.match(list.innerHTML, /<pre class="weight-summary">/u);
  calls.length = 0;
  button.onclick!();
  assert.equal(list.hidden, true);
  assert.equal(calls.length, 0);
});
test('weight trend with no counted event explains how the first one is produced', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const api = async () => ({ member: 'memory', asset_id: 'm1', current_weight: 1,
    counts: { positive: 0, negative: 0, dismissed: 0, events: 0 }, points: [], timeline: [] });
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: (name: string) => name === 'data-empty-trend' ? 'm1' : '',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
  };
  bindWeightTrend({ querySelectorAll: (selector: string) => selector === '[data-empty-trend]' ? [button] : [] },
    { api, attribute: 'data-empty-trend', member: 'memory' });
  button.onclick!();
  await flush(); await flush();
  assert.match(list.innerHTML, /当前权重 1\.00/u);
  assert.match(list.innerHTML, /还没有计入权重的事件/u);
  assert.match(list.innerHTML, /怎么产生第一条/u);
  assert.match(list.innerHTML, /计入：有用 0 条 · 纠错 0 条 · 已驳回纠错 0 条/u);
  assert.doesNotMatch(list.innerHTML, /<svg/u);
});
test('a long flat weight curve collapses to its step points instead of a dense polyline', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const points = [];
  for (let i = 0; i < 100; i += 1) points.push({ at: 't' + i, weight: 1 });
  for (let i = 0; i < 100; i += 1) points.push({ at: 'u' + i, weight: 1.2 });
  const api = async () => ({ member: 'knowledge', asset_id: 'k1', current_weight: 1.2,
    counts: { positive: 100, negative: 0, dismissed: 0, events: 200 }, points, timeline: [] });
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: (name: string) => name === 'data-long-trend' ? 'k1' : '',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
  };
  bindWeightTrend({ querySelectorAll: (selector: string) => selector === '[data-long-trend]' ? [button] : [] },
    { api, attribute: 'data-long-trend', member: 'knowledge' });
  button.onclick!();
  await flush(); await flush();
  const match = list.innerHTML.match(/<polyline[^>]*points="([^"]+)"/u);
  assert.ok(match, 'a polyline is present');
  const coordinates = match![1]!.split(' ');
  assert.equal(coordinates.length, 2, 'two step points, not two hundred');
  assert.match(coordinates[0]!, /^4\.0,/u);
  assert.match(coordinates[1]!, /^236\.0,/u);
});
test('weight trend adds per-day rollup only when the history spans more than one day', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const render = async (daily: unknown[], points: unknown[]) => {
    const api = async () => ({ member: 'experience', asset_id: 'p1', current_weight: 1,
      counts: { positive: 1, negative: 1, dismissed: 0, events: 2 }, points, daily, timeline: [] });
    const list = { hidden: true, textContent: '', innerHTML: '' };
    const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
      dataset: {}, getAttribute: (name: string) => name === 'data-day-trend' ? 'p1' : '',
      parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
    };
    bindWeightTrend({ querySelectorAll: (selector: string) => selector === '[data-day-trend]' ? [button] : [] },
      { api, attribute: 'data-day-trend', member: 'experience' });
    button.onclick!();
    await flush(); await flush();
    return list.innerHTML;
  };
  const multiline = await render([
    { day: '2026-11-05', positive: 1, negative: 0, events: 1, end_weight: 1.2 },
    { day: '2026-11-06', positive: 0, negative: 1, events: 1, end_weight: 1 },
  ], [{ at: 'a', weight: 1.2 }, { at: 'b', weight: 1 }]);
  assert.match(multiline, /按天 2026-11-05 · 有用 1 \/ 纠错 0 → 1\.20/u);
  assert.match(multiline, /按天 2026-11-06 · 有用 0 \/ 纠错 1 → 1\.00/u);
  const singleDay = await render([{ day: '2026-11-05', positive: 1, negative: 0, events: 1, end_weight: 1.2 }],
    [{ at: 'a', weight: 1.2 }, { at: 'b', weight: 1.2 }]);
  assert.doesNotMatch(singleDay, /按天/u);
});
test('a correction line names who settled it and why once it is adjudicated', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const api = async () => ({ member: 'experience', asset_id: 'p1', current_weight: 1,
    counts: { positive: 0, negative: 1, dismissed: 0, events: 2 },
    points: [{ at: 't1', weight: 1 }, { at: 't2', weight: 1 }],
    timeline: [
      { at: 't1', kind: 'incorrect', source: 'correction', counted: true, weight_after: 1, status: 'pending_review' },
      { at: 't2', kind: 'incorrect', source: 'correction', counted: true, weight_after: 1, status: 'confirmed',
        decided_by: 'user:alex', resolution_reason: '回执指向已删除的实现' },
    ] });
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'p1',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
  };
  bindWeightTrend({ querySelectorAll: (selector: string) => selector === '[data-traced-trend]' ? [button] : [] },
    { api, attribute: 'data-traced-trend', member: 'experience' });
  button.onclick!();
  await flush(); await flush();
  assert.match(list.innerHTML, /t1 · incorrect · 计入 · 权重 1\.00 · 待复核/u);
  assert.match(list.innerHTML, /t2 · incorrect · 计入 · 权重 1\.00 · 由 user:alex 确认：回执指向已删除的实现/u);
});

test('a dismissed correction and an uncounted event still name their outcome', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const api = async () => ({ member: 'experience', asset_id: 'p1', current_weight: 1,
    counts: { positive: 0, negative: 0, dismissed: 1, events: 1 },
    points: [{ at: 't1', weight: 1 }],
    timeline: [
      { at: 't1', kind: 'incorrect', source: 'correction', counted: false, weight_after: 1, status: 'dismissed' },
      { at: 't2', kind: 'unknown', source: 'feedback', counted: false, weight_after: 1 },
    ] });
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'p1',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
  };
  bindWeightTrend({ querySelectorAll: (selector: string) => selector === '[data-dismissed-trend]' ? [button] : [] },
    { api, attribute: 'data-dismissed-trend', member: 'experience' });
  button.onclick!();
  await flush(); await flush();
  assert.match(list.innerHTML, /t1 · incorrect · 未计入 · 权重 1\.00 · 驳回/u);
  assert.match(list.innerHTML, /t2 · unknown · 未计入 · 权重 1\.00/u);
  assert.match(list.innerHTML, /已驳回纠错 1 条/u);
});

test('a long curve that never changes is sampled evenly and the summary escapes markup', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const points = [];
  for (let index = 0; index < 120; index += 1) points.push({ at: 't' + index, weight: 1 + index * 0.01 });
  const api = async () => ({ member: 'experience', asset_id: 'p1', current_weight: 1,
    counts: { positive: 0, negative: 0, dismissed: 0, events: 120 }, points,
    timeline: [{ at: 't1', kind: 'x<&">', source: 'feedback', counted: true, weight_after: 1 }] });
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'p1',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
  };
  bindWeightTrend({ querySelectorAll: (selector: string) => selector === '[data-sampled-trend]' ? [button] : [] },
    { api, attribute: 'data-sampled-trend', member: 'experience' });
  button.onclick!();
  await flush(); await flush();
  const match = list.innerHTML.match(/<polyline[^>]*points="([^"]+)"/u);
  assert.ok(match);
  assert.equal(match![1]!.split(' ').length, 48, 'the curve is sampled to the cap');
  // The summary is escaped, so a hostile kind name cannot inject markup.
  assert.match(list.innerHTML, /x&lt;&amp;&quot;&gt;/u);
  assert.doesNotMatch(list.innerHTML, /x<&"/u);
});

test('a control without a dataset and without an existing handler is bound anyway', async () => {
  const api = async () => ({ receipts: [] });
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset?: unknown; getAttribute: (n: string) => string; parentElement: unknown } = {
    getAttribute: () => 'a1',
    parentElement: { querySelector: (selector: string) => selector === '[data-recall-audit-list]' ? list : null },
  };
  bindRecallAudit({ querySelectorAll: () => [button] }, { api, attribute: 'data-audit', member: 'memory' });
  button.onclick!();
  await flush();
  assert.equal(list.textContent, '这条资产还没有召回记录。');
});

test('a recall or trend control without its list box does nothing', async () => {
  const api = async () => { throw new Error('must not be called'); };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'a1', parentElement: null,
  };
  bindRecallAudit({ querySelectorAll: () => [button] }, { api, attribute: 'data-audit', member: 'memory' });
  button.onclick!();
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const trend: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'a1', parentElement: null,
  };
  bindWeightTrend({ querySelectorAll: () => [trend] }, { api, attribute: 'data-trend', member: 'memory' });
  trend.onclick!();
});

test('a failing recall or trend read names the failure instead of staying blank', async () => {
  const api = async () => { throw new Error('boom'); };
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'a1',
    parentElement: { querySelector: (selector: string) => selector === '[data-recall-audit-list]' ? list : null },
  };
  bindRecallAudit({ querySelectorAll: () => [button] }, { api, attribute: 'data-audit', member: 'memory' });
  button.onclick!();
  await flush();
  assert.equal(list.textContent, '读取失败：boom');
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const trendList = { hidden: true, textContent: '', innerHTML: '' };
  const trend: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'a1',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? trendList : null },
  };
  bindWeightTrend({ querySelectorAll: () => [trend] }, { api, attribute: 'data-trend', member: 'memory' });
  trend.onclick!();
  await flush();
  assert.equal(trendList.textContent, '读取失败：boom');
});

test('an already-bound control is not rebound twice', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: { trendBound: '1' }, getAttribute: () => 'a1',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
  };
  bindWeightTrend({ querySelectorAll: () => [button] }, { api: async () => ({}), attribute: 'data-trend', member: 'memory' });
  assert.equal(button.onclick, undefined);
});

test('defaults fill in every missing field of an empty payload', async () => {
  const api = async () => ({});
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'a1',
    parentElement: { querySelector: (selector: string) => selector === '[data-recall-audit-list]' ? list : null },
  };
  bindRecallAudit({ querySelectorAll: () => [button] }, { api, attribute: 'data-audit', member: 'memory' });
  button.onclick!();
  await flush();
  assert.equal(list.textContent, '这条资产还没有召回记录。');
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const trendList = { hidden: true, textContent: '', innerHTML: '' };
  const trend: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'a1',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? trendList : null },
  };
  bindWeightTrend({ querySelectorAll: () => [trend] }, { api, attribute: 'data-trend', member: 'memory' });
  trend.onclick!();
  await flush(); await flush();
  assert.match(trendList.innerHTML, /当前权重 1\.00/u);
  assert.match(trendList.innerHTML, /还没有计入权重的事件/u);
  assert.match(trendList.innerHTML, /计入：有用 0 条 · 纠错 0 条 · 已驳回纠错 0 条/u);
});

test('a receipt without feedback and a failure without a message are still readable', async () => {
  const api = async () => ({ receipts: [{ id: 'r1' }] });
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'a1',
    parentElement: { querySelector: (selector: string) => selector === '[data-recall-audit-list]' ? list : null },
  };
  bindRecallAudit({ querySelectorAll: () => [button] }, { api, attribute: 'data-audit', member: 'memory' });
  button.onclick!();
  await flush();
  assert.match(list.textContent, /回执 r1 · 未标注/u);
  const failing = async () => { throw new Error('plain string failure'); };
  const trendList = { hidden: true, textContent: '', innerHTML: '' };
  const trend: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'a1',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? trendList : null },
  };
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  bindWeightTrend({ querySelectorAll: () => [trend] }, { api: failing, attribute: 'data-trend', member: 'memory' });
  trend.onclick!();
  await flush();
  assert.equal(trendList.textContent, '读取失败：plain string failure');
});

test('a trend event without any timestamp, kind or weight still renders', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const api = async () => ({ member: 'experience', asset_id: 'p1',
    points: [{ at: 't1', weight: 1 }],
    timeline: [{ counted: true }] });
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'p1',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
  };
  bindWeightTrend({ querySelectorAll: () => [button] }, { api, attribute: 'data-trend', member: 'experience' });
  button.onclick!();
  await flush(); await flush();
  assert.match(list.innerHTML, /时间未知 · unknown · 计入 · 权重 1\.00/u);
});

test('a curve with a single distinct value renders no sparkline at all', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const api = async () => ({ member: 'experience', asset_id: 'p1',
    points: [{ at: 'a', weight: 1 }, { at: 'b', weight: 1 }], timeline: [] });
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'p1',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
  };
  bindWeightTrend({ querySelectorAll: () => [button] }, { api, attribute: 'data-trend', member: 'experience' });
  button.onclick!();
  await flush(); await flush();
  assert.doesNotMatch(list.innerHTML, /<svg/u);
});

test('a control with no dataset but an existing handler is left alone', async () => {
  const existing = () => {};
  const button: { onclick?: () => void; dataset?: unknown; getAttribute: (n: string) => string; parentElement: unknown } = {
    onclick: existing, getAttribute: () => 'a1', parentElement: null,
  };
  bindRecallAudit({ querySelectorAll: () => [button] }, { api: async () => ({}), attribute: 'data-audit', member: 'memory' });
  assert.equal(button.onclick, existing);
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const trend: { onclick?: () => void; dataset?: unknown; getAttribute: (n: string) => string; parentElement: unknown } = {
    onclick: existing, getAttribute: () => 'a1', parentElement: null,
  };
  bindWeightTrend({ querySelectorAll: () => [trend] }, { api: async () => ({}), attribute: 'data-trend', member: 'memory' });
  assert.equal(trend.onclick, existing);
});

test('a receipt whose feedback entry has no outcome is labelled as unlabelled', async () => {
  const api = async () => ({ receipts: [{ id: 'r1', feedback: [{}] }] });
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'a1',
    parentElement: { querySelector: (selector: string) => selector === '[data-recall-audit-list]' ? list : null },
  };
  bindRecallAudit({ querySelectorAll: () => [button] }, { api, attribute: 'data-audit', member: 'memory' });
  button.onclick!();
  await flush();
  assert.match(list.textContent, /回执 r1 · 未标注/u);
});

test('a failure without a message is still reported', async () => {
  const api = async () => { throw 'plain'; };
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'a1',
    parentElement: { querySelector: (selector: string) => selector === '[data-recall-audit-list]' ? list : null },
  };
  bindRecallAudit({ querySelectorAll: () => [button] }, { api, attribute: 'data-audit', member: 'memory' });
  button.onclick!();
  await flush();
  assert.equal(list.textContent, '读取失败：plain');
});

test('a daily rollup row without counters falls back to zero', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const api = async () => ({ member: 'experience', asset_id: 'p1',
    points: [{ at: 'a', weight: 1 }, { at: 'b', weight: 2 }],
    daily: [{ day: '2026-11-05' }, { day: '2026-11-06' }], timeline: [] });
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'p1',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
  };
  bindWeightTrend({ querySelectorAll: () => [button] }, { api, attribute: 'data-trend', member: 'experience' });
  button.onclick!();
  await flush(); await flush();
  assert.match(list.innerHTML, /按天 2026-11-05 · 有用 0 \/ 纠错 0 → 1\.00/u);
});

test('a trend failure that is not an Error still names the failure', async () => {
  const { bindWeightTrend } = await import('../web/recall-audit.js');
  const api = async () => { throw 'plain trend failure'; };
  const list = { hidden: true, textContent: '', innerHTML: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: () => 'p1',
    parentElement: { querySelector: (selector: string) => selector === '[data-weight-trend-list]' ? list : null },
  };
  bindWeightTrend({ querySelectorAll: () => [button] }, { api, attribute: 'data-trend', member: 'experience' });
  button.onclick!();
  await flush();
  assert.equal(list.textContent, '读取失败：plain trend failure');
});
