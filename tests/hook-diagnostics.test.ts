import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHookDiagnosticsPanel, renderHookDiagnostics } from '../workbench/hook-diagnostics.js';

class Element {
  textContent = '';
  innerHTML = '';
  disabled = false;
  onclick: (() => Promise<void>) | null = null;
}

function fixture(api: (path: string) => Promise<Record<string, unknown>> = async () => ({ items: [], partial: false })) {
  const button = new Element(), status = new Element(), list = new Element();
  const nodes: Record<string, Element> = {
    '[data-hook-diagnostics-refresh]': button,
    '[data-hook-diagnostics-status]': status,
    '[data-hook-diagnostics-list]': list,
  };
  const root = { querySelector: (selector: string) => nodes[selector] ?? null };
  return { button, status, list, root, panel: mountHookDiagnosticsPanel(root, { api }) };
}

const item = (values: Record<string, unknown> = {}) => ({ request_id: 'req-1', member: 'context', event: 'UserPromptSubmit',
  host: 'codex', status: 'completed', started_at: '2026-11-07T10:01:00.000Z', duration_ms: 20, handler_ms: 8, store_open_ms: 3, runtime_import_ms: 4,
  outcome: 'failed', error_code: 'STORAGE_BUSY', error_type: 'Error', database_role: 'primary', database_phase: 'transaction_begin', waited_ms: 20,
  ...values });

test('Hook diagnostics show an honest empty state and escape every recorded label', () => {
  assert.match(renderHookDiagnostics(null), /还没有 Hook 运行记录/u);
  const html = renderHookDiagnostics({ items: [item({ member: '<img>', event: '<script>', request_id: '<svg>' })] });
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /&lt;svg&gt;/u);
  assert.match(html, /未知能力/u);
  assert.match(html, /Codex/u);
  assert.match(html, /失败/u);
  assert.match(html, /总耗时 20 ms · 处理 8 ms · 存储打开 3 ms · 运行时加载 4 ms/u);
  assert.match(html, /STORAGE_BUSY/u);
  assert.match(html, /primary · transaction_begin/u);
});

test('Hook diagnostics distinguish unmatched starts, skipped work and records without timing', () => {
  const html = renderHookDiagnostics({ items: [
    item({ status: 'unmatched_start', outcome: undefined, handler_ms: undefined, duration_ms: undefined, store_open_ms: undefined, runtime_import_ms: undefined }),
    item({ request_id: 'req-2', status: 'completed', outcome: 'skipped', duration_ms: undefined, handler_ms: undefined, store_open_ms: undefined, runtime_import_ms: undefined,
      error_code: undefined, error_type: undefined, database_role: undefined, database_phase: undefined, waited_ms: undefined }),
    item({ request_id: 'req-3', status: 'other', outcome: 'unknown', duration_ms: undefined, handler_ms: undefined, store_open_ms: undefined, runtime_import_ms: undefined,
      error_code: undefined, error_type: undefined, database_role: undefined, database_phase: undefined, waited_ms: undefined }),
    item({ request_id: 'req-4', member: 'toString', host: 'unknown', event: '', duration_ms: -1, handler_ms: Number.NaN, store_open_ms: undefined, runtime_import_ms: undefined,
      error_code: '', error_type: '', database_role: undefined, database_phase: undefined, waited_ms: undefined }),
  ] });
  assert.match(html, /结束记录缺失/u);
  assert.match(html, /仅凭此记录不能判断具体原因/u);
  assert.match(html, /已跳过/u);
  assert.match(html, /已结束/u);
  assert.match(html, /未知能力/u);
  assert.match(html, /Host 未记录/u);
  assert.equal((html.match(/class="form-block"/gu) || []).length, 4);
});

test('Hook diagnostics refresh on demand, disable duplicate reads and explain partial or failed reads', async () => {
  let release!: (value: Record<string, unknown>) => void;
  let calls = 0;
  const f = fixture(path => {
    assert.equal(path, '/api/workbench/hook-diagnostics?limit=30');
    calls += 1;
    return new Promise(resolve => { release = resolve; });
  });
  const pending = f.button.onclick!();
  assert.equal(f.button.disabled, true);
  assert.match(f.status.textContent, /正在读取/u);
  await f.button.onclick!();
  assert.equal(calls, 1);
  release({ items: [item()], partial: true });
  await pending;
  assert.equal(f.button.disabled, false);
  assert.match(f.status.textContent, /部分日志未能完整读取/u);
  assert.match(f.list.innerHTML, /req-1/u);
  f.panel.destroy();
  assert.equal(f.button.onclick, null);
});

test('Hook diagnostics report read errors, tolerate unknown payload shapes and suppress late results', async () => {
  const failed = fixture(async () => { throw new Error('offline'); });
  await failed.button.onclick!();
  assert.match(failed.status.textContent, /读取失败：offline/u);
  assert.equal(failed.list.innerHTML, '');
  failed.panel.destroy();
  const nonError = fixture(async () => Promise.reject('offline string'));
  await nonError.button.onclick!();
  assert.match(nonError.status.textContent, /读取失败：offline string/u);
  nonError.panel.destroy();

  const unknown = fixture(async () => ({}));
  await unknown.button.onclick!();
  assert.match(unknown.status.textContent, /0 条记录/u);
  assert.match(unknown.list.innerHTML, /还没有 Hook 运行记录/u);
  unknown.panel.destroy();

  let release!: (value: Record<string, unknown>) => void;
  const late = fixture(() => new Promise(resolve => { release = resolve; }));
  const action = late.button.onclick!;
  const start = action();
  const pending = late.button.onclick!();
  late.panel.destroy();
  await action();
  release({ items: [item()], partial: false });
  await pending;
  await start;
  assert.equal(late.list.innerHTML, '');
  assert.equal(late.status.textContent, '正在读取最近的本机记录…');

  let reject!: (error: Error) => void;
  const failedLate = fixture(() => new Promise((_, onReject) => { reject = onReject; }));
  const failedAction = failedLate.button.onclick!;
  const failedPending = failedAction();
  failedLate.panel.destroy();
  reject(new Error('late failure'));
  await failedPending;
  assert.equal(failedLate.status.textContent, '正在读取最近的本机记录…');
});

test('Hook diagnostics safely no-op when the settings card is absent', () => {
  const panel = mountHookDiagnosticsPanel({ querySelector: () => null }, { api: async () => ({}) });
  assert.doesNotThrow(() => panel.destroy());
});
