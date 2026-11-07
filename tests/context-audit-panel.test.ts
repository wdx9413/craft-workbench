import assert from 'node:assert/strict';
import test from 'node:test';
import { mountContextAuditPanel } from '../workbench/context-audit-panel.js';

class Element {
  value = ''; textContent = ''; innerHTML = ''; disabled = false; hidden = false;
  children: Element[] = []; onclick: (() => Promise<void> | void) | undefined;
  oninput: (() => void) | undefined;
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
}

function fixture({ noPickers = false, storage = new Map<string, string>(), api = async () => ({}) as unknown, invoke, crypto, beforeMount }: {
  noPickers?: boolean; storage?: Map<string, string> | { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }; api?: (path: string, options?: unknown) => Promise<unknown>; invoke?: (command: string) => Promise<unknown>; crypto?: Crypto; beforeMount?: (node: (selector: string) => Element | null) => void;
} = {}) {
  const original = globalThis.document;
  globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const nodes = new Map<string, Element>();
  const node = (selector: string) => {
    if (noPickers && selector.startsWith('[data-pick-context=')) return null;
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector)!;
  };
  const local = storage instanceof Map ? { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } : storage;
  const root = { querySelector: node };
  beforeMount?.(node);
  const panel = mountContextAuditPanel(root, { api, invoke, storage: local, crypto });
  return { node, panel, storage, restore() { panel.destroy(); globalThis.document = original; } };
}

const report = (status = 'passed', checks: unknown = []) => ({ audit: { id: 'a'.repeat(64), status, input_digest: 'input', report_digest: 'report', evaluator_version: '0.5.0' }, report: { status, case_id: 'case-1', metrics: {}, checks, partial: false }, integrity: 'verified_against_saved_report' });

test('context audit validates, persists an idempotent operation and renders only report evidence', async () => {
  const calls: Array<{ path: string; options?: unknown }> = [];
  let failPost = true, postResult: unknown = report('inconclusive', [{ id: 'one', status: 'passed', observed: 1, expected: 1 }]);
  const f = fixture({ api: async (path, options) => { calls.push({ path, options }); if (failPost) throw new Error('connection lost'); return postResult; }, invoke: async command => { assert.equal(command, 'choose_reference_files'); return ['/tmp/pack.json']; } });
  try {
    const pack = f.node('[data-eval="context-pack"]'), expectations = f.node('[data-eval="context-expectations"]');
    const start = f.node('[data-eval="context-audit-start"]'), picker = f.node('[data-pick-context="pack"]');
    assert.equal(start.disabled, true); await start.onclick!(); assert.equal(calls.length, 0);
    pack.value = '/tmp/pack.json'; pack.oninput!(); expectations.value = '/tmp/manifest.json'; expectations.oninput!();
    await picker.onclick!(); assert.equal(pack.value, '/tmp/pack.json');
    await start.onclick!(); assert.match(f.node('[data-eval="context-audit-status"]').textContent, /安全重试/u);
    const body = calls[0]!.options as { body: { operation_id: string } };
    assert.match(body.body.operation_id, /^[0-9a-f-]{36}$/u);
    failPost = false; await start.onclick!();
    assert.equal((calls[1]!.options as { body: { operation_id: string } }).body.operation_id, body.body.operation_id);
    assert.match(f.node('[data-eval="context-audit-status"]').textContent, /证据不足/u);
    assert.match(f.node('[data-eval="context-audit-report"]').children[0]!.textContent, /未记录/u);
    f.node('[data-eval="context-audit-new"]').onclick!();
    assert.equal(f.storage.has('craft-context-audit-operation'), false);
    assert.equal(f.storage.has('craft-context-audit-id'), false);
  } finally { f.restore(); }
});

test('context audit reads saved reports, limits check rows and reports read errors', async () => {
  const id = 'b'.repeat(64), storage = new Map([['craft-context-audit-id', id], ['craft-context-audit-operation', 'restored']]);
  const checks = Array.from({ length: 101 }, (_, index) => ({ id: `check-${index}`, status: ['passed', 'failed', 'other'][index % 3], observed: index % 2 ? null : index, expected: index === 0 ? null : index }));
  let fail = false;
  const f = fixture({ storage, api: async () => { if (fail) throw new Error('report missing'); return report('failed', checks); } });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.match(f.node('[data-eval="context-audit-status"]').textContent, /未通过/u);
    assert.equal(f.node('[data-eval="context-audit-report"]').children.length, 103);
    fail = true; await f.node('[data-eval="context-audit-check"]').onclick!();
    assert.match(f.node('[data-eval="context-audit-status"]').textContent, /读取未确认：report missing/u);
    f.node('[data-eval="context-audit-new"]').onclick!();
    await f.node('[data-eval="context-audit-check"]').onclick!();
  } finally { f.restore(); }
});

test('context audit handles unavailable pickers, invalid selections and storage failures', async () => {
  const storage = new Map<string, string>();
  const f = fixture({ noPickers: true, storage });
  try {
    const pack = f.node('[data-eval="context-pack"]'); pack.value = '/tmp/p'; pack.oninput!();
    f.node('[data-eval="context-expectations"]').value = '/tmp/e'; f.node('[data-eval="context-expectations"]').oninput!();
    f.node('[data-eval="context-audit-start"]').disabled = false;
    const noStorage = { getItem: (_key: string) => null, setItem: (_key: string, _value: string) => { throw new Error('storage denied'); }, removeItem: (_key: string) => { throw new Error('storage denied'); } };
    f.panel.destroy();
    const original = globalThis.document;
    globalThis.document = { createElement: () => new Element() } as unknown as Document;
    const root = { querySelector: (selector: string) => f.node(selector) };
    const panel = mountContextAuditPanel(root, { storage: noStorage, api: async () => report('odd') });
    try {
      const q = (key: string) => f.node(`[data-eval="${key}"]`);
      q('context-pack').value = '/tmp/p'; q('context-pack').oninput!(); q('context-expectations').value = '/tmp/e'; q('context-expectations').oninput!();
      await q('context-audit-start').onclick!();
      assert.match(q('context-audit-status').textContent, /审计状态：未知/u);
      q('context-pack').value = '/tmp/p2'; q('context-pack').oninput!();
      panel.destroy(); q('context-pack').oninput!();
    } finally { globalThis.document = original; }
  } finally { f.restore(); }
});

test('context audit suppresses late picker and network responses after unmount', async () => {
  const id = 'c'.repeat(64), storage = new Map([['craft-context-audit-id', id]]);
  let release!: () => void;
  const f = fixture({ storage, api: async () => new Promise((_, reject) => { release = () => reject(new Error('late')); }) });
  try {
    const initial = f.node('[data-eval="context-audit-status"]').textContent;
    f.panel.destroy(); release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.node('[data-eval="context-audit-status"]').textContent, initial);
    await f.node('[data-pick-context="pack"]').onclick!();
  } finally { f.restore(); }
});

test('context audit reuses a saved operation and handles unknown report shapes', async () => {
  const calls: unknown[] = [], storage = new Map([['craft-context-audit-operation', 'saved-operation']]);
  const f = fixture({ storage, beforeMount: node => { node('[data-eval="context-pack"]')!.value = '/tmp/p'; node('[data-eval="context-expectations"]')!.value = '/tmp/e'; }, api: async (_path, options) => { calls.push(options); return { audit: {}, report: { status: 'other', checks: 'invalid', metrics: {} } }; } });
  try {
    const q = (key: string) => f.node(`[data-eval="${key}"]`);
    await q('context-audit-start').onclick!();
    assert.equal((calls[0] as { body: { operation_id: string } }).body.operation_id, 'saved-operation');
    assert.match(q('context-audit-status').textContent, /审计状态：未知/u);
    assert.equal(q('context-audit-report').children.length, 2);
  } finally { f.restore(); }
});

test('context audit picker accepts strings, ignores empty choices and reports picker errors', async () => {
  let selected: unknown = '/tmp/selected', fail = false;
  const f = fixture({ invoke: async () => { if (fail) throw new Error('picker failed'); return selected; } });
  try {
    const pack = f.node('[data-eval="context-pack"]'), picker = f.node('[data-pick-context="pack"]');
    await picker.onclick!(); assert.equal(pack.value, '/tmp/selected');
    selected = null; await picker.onclick!(); assert.equal(pack.value, '/tmp/selected');
    fail = true; await picker.onclick!(); assert.match(f.node('[data-eval="context-audit-status"]').textContent, /无法选择文件：picker failed/u);
    const deferred = new Promise(resolve => { selected = resolve; });
    const latePicker = picker.onclick!(); f.panel.destroy();
    (selected as (value: unknown) => void)('/tmp/late'); await latePicker; await deferred;
  } finally { f.restore(); }
});

test('context audit suppresses stale digest and successful report completions', async () => {
  let releaseDigest!: (value: ArrayBuffer) => void, releaseReport!: (value: unknown) => void, posts = 0;
  const crypto = { randomUUID: () => 'stable-operation', subtle: { digest: () => new Promise<ArrayBuffer>(resolve => { releaseDigest = resolve; }) } } as unknown as Crypto;
  const storage = new Map([['craft-context-audit-id', 'f'.repeat(64)]]);
  const f = fixture({ storage, crypto, api: async () => new Promise(resolve => { releaseReport = resolve; }) });
  try {
    const q = (key: string) => f.node(`[data-eval="${key}"]`);
    const status = q('context-audit-status').textContent; f.panel.destroy();
    releaseReport(report('passed')); await new Promise(resolve => setImmediate(resolve));
    assert.equal(q('context-audit-status').textContent, status);
  } finally { f.restore(); }

  const g = fixture({ storage: new Map() , crypto, api: async () => { posts++; return report('passed'); } });
  try {
    const q = (key: string) => g.node(`[data-eval="${key}"]`);
    q('context-pack').value = '/tmp/p'; q('context-pack').oninput!(); q('context-expectations').value = '/tmp/e'; q('context-expectations').oninput!();
    assert.equal(q('context-audit-start').disabled, false);
    const pending = q('context-audit-start').onclick!(); g.panel.destroy();
    releaseDigest(new Uint8Array(32).buffer); await pending;
    assert.equal(posts, 0);
  } finally { g.restore(); }
});

test('context audit ignores a stale successful POST response after unmount', async () => {
  let release!: (value: unknown) => void;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const f = fixture({ storage: new Map(), api: async () => new Promise(resolve => { release = resolve; markStarted(); }) });
  try {
    const q = (key: string) => f.node(`[data-eval="${key}"]`);
    q('context-pack').value = '/tmp/p'; q('context-pack').oninput!(); q('context-expectations').value = '/tmp/e'; q('context-expectations').oninput!();
    const request = q('context-audit-start').onclick!();
    await started;
    const status = q('context-audit-status').textContent;
    f.panel.destroy(); release(report('passed')); await request;
    assert.equal(q('context-audit-status').textContent, status);
  } finally { f.restore(); }
});

test('context audit rejects malformed reports and ignores invalid stored identities', async () => {
  const storage = { getItem: (_key: string) => { throw new Error('storage unavailable'); }, setItem() {}, removeItem() {} };
  const f = fixture({ storage, api: async () => ({ audit: { status: 'passed' }, report: null }) });
  try {
    const q = (key: string) => f.node(`[data-eval="${key}"]`);
    q('context-pack').value = '/tmp/p'; q('context-pack').oninput!(); q('context-expectations').value = '/tmp/e'; q('context-expectations').oninput!();
    await q('context-audit-start').onclick!();
    assert.match(q('context-audit-status').textContent, /审计未确认.*服务未返回有效审计报告/u);
  } finally { f.restore(); }

  const id = '0'.repeat(64), nodes = new Map<string, Element>();
  const original = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  try {
    const calls: string[] = [];
    const panel = mountContextAuditPanel({ querySelector: node }, { storage: { getItem: key => key === 'craft-context-audit-id' ? 'bad-id' : null }, api: async path => { calls.push(path); return report('odd'); } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, []);
    panel.destroy();
  } finally { globalThis.document = original; }
});

test('context audit maps unknown status when restoring a saved report', async () => {
  const original = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const nodes = new Map<string, Element>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  try {
    const id = '1'.repeat(64);
    const panel = mountContextAuditPanel({ querySelector: node }, { storage: { getItem: key => key === 'craft-context-audit-id' ? id : null }, api: async () => ({ report: { status: 'odd', case_id: 'case', checks: [], metrics: {} }, integrity: 'verified' }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(node('[data-eval="context-audit-status"]').textContent, /审计状态：未知/u);
    panel.destroy();
  } finally { globalThis.document = original; }
});
