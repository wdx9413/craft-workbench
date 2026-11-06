import assert from 'node:assert/strict';
import test from 'node:test';
import { mountEvaluationPanel } from '../workbench/evaluation-panel.js';

class Element {
  value = ''; textContent = ''; innerHTML = ''; disabled = false; hidden = false; focused = false; checked = false;
  children: Element[] = []; onclick: (() => Promise<void> | void) | undefined;
  onchange: (() => void) | undefined;
  oninput: (() => void) | undefined;
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  focus() { this.focused = true; }
}

test('evaluation panel validates, submits once, follows progress and renders the final report', async () => {
  const saved = globalThis.document;
  const nodes = new Map<string, Element>();
  const node = (key: string) => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key)!; };
  const root = { innerHTML: '', querySelector: (selector: string) => node(selector) };
  globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const q = (key: string) => node(`[data-eval="${key}"]`);
  const stored = new Map<string, string>();
  const tasks: Array<() => void> = [];
  const storage = { setItem: (key: string, value: string) => stored.set(key, value), getItem: (key: string) => stored.get(key), removeItem: (key: string) => stored.delete(key) };
  let phase = 'running', posts = 0, reportFails = false, evaluatorVersion: unknown = '0.1.5';
  const api = async (path: string, options?: { method: string; body: unknown }) => {
    if (options?.method === 'POST') { posts++; return {}; }
    if (path.endsWith('/events')) return { evaluation: { state: phase, evaluator_version: evaluatorVersion }, events: [{ case_id: 'one', verdict: 'passed' }] };
    if (reportFails) throw new Error('report integrity failed');
    return { report: { passed: 1, failed: 0, inconclusive: 0, missing: 0, invalid: 0, results: [{ case_id: '<unsafe>', verdict: 'passed', checks: [] }] } };
  };
  const clock = { setTimeout: (callback: () => void) => { tasks.push(callback); return 1; } };
  try {
    const panel = mountEvaluationPanel(root, { api, clock, storage });
    assert.equal(node('[data-pick="workspace"]').disabled, false);
    await q('start').onclick!(); assert.equal(posts, 0); assert.equal(q('workspace').focused, true);
    for (const field of ['workspace', 'suite', 'subject', 'runtime']) q(field).value = '/tmp/' + field;
    await q('start').onclick!(); await q('start').onclick!();
    assert.equal(posts, 1); assert.equal(q('status').textContent, '评测中'); assert.equal(q('start').disabled, true);
    for (const key of ['workspace', 'suite', 'subject', 'runtime']) assert.equal(node(`[data-pick="${key}"]`).disabled, true);
    await node('[data-pick="workspace"]').onclick!();
    assert.equal(stored.size, 1); assert.equal(tasks.length, 1);
    phase = 'completed'; await panel.refresh();
    assert.match(q('report').children[0].textContent, /通过 1/);
    assert.equal(q('report').children[1].children[0].textContent, '<unsafe> · passed');
    // The conclusion is attributed to the run and the evaluator that produced it.
    assert.match(q('provenance').textContent, /^运行 [a-f0-9]{10} · 评测器 0\.1\.5$/u);
    evaluatorVersion = ''; await panel.refresh();
    assert.match(q('provenance').textContent, /评测器 未记录/u);
    reportFails = true; await panel.refresh();
    assert.match(q('status').textContent, /报告读取未确认/);
    assert.equal(q('new').disabled, false); q('new').onclick!(); assert.equal(stored.size, 1);
    assert.equal(node('[data-pick="workspace"]').disabled, false);
    assert.equal(q('start').disabled, false); panel.destroy(); await panel.refresh();
  } finally { globalThis.document = saved; }
});

test('evaluation comparison selects distinct completed runs, prevents duplicate requests and safely shows evidence', async () => {
  const saved = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const nodes = new Map<string, Element & { onchange?: () => void }>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  const q = (key: string) => node(`[data-eval="${key}"]`);
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  let posts = 0, failure = '', inconclusive = false, release: (() => void) | undefined;
  const storage = { getItem: (key: string) => key === 'craft-evaluation-completed' ? JSON.stringify([{ id: a, title: '<baseline>' }, { id: b, title: 'candidate' }, { id: 'invalid', title: 'drop' }]) : null };
  const api = async (path: string, options: { body: unknown }) => {
    assert.equal(path, '/api/workbench/evaluations/compare');
    assert.deepEqual(options.body, { baseline_id: a, candidate_id: b }); posts++;
    await new Promise<void>(resolve => { release = resolve; });
    if (failure) throw new Error(failure);
    return { comparison: { metrics: { status: inconclusive ? 'inconclusive' : 'comparable', measured_pairs: 2, expected_pairs: 2, candidate_wins: 1, baseline_wins: 0, ties: 1, details: '<unsafe>' } } };
  };
  try {
    const panel = mountEvaluationPanel({ innerHTML: '', querySelector: node }, { api, storage });
    assert.equal(q('baseline').children.length, 3); assert.equal(q('baseline').children[1].textContent, '<baseline>');
    await q('compare').onclick!(); assert.equal(posts, 0);
    q('baseline').value = a; q('candidate').value = a; q('candidate').onchange!(); assert.equal(q('compare').disabled, true);
    q('candidate').value = b; q('candidate').onchange!(); assert.equal(q('compare').disabled, false);
    const first = q('compare').onclick!(); await q('compare').onclick!(); assert.equal(posts, 1); assert.equal(q('baseline').disabled, true);
    release!(); await first;
    assert.match(q('comparison-status').textContent, /候选胜 1/); assert.equal(q('baseline').disabled, false);
    assert.match(q('comparison-report').children[0].children[1].textContent, /<unsafe>/);
    q('candidate').onchange!(); assert.equal(q('comparison-report').children.length, 0); assert.equal(q('comparison-status').textContent, '');
    failure = 'environment mismatch'; const failed = q('compare').onclick!(); release!(); await failed;
    assert.match(q('comparison-status').textContent, /无法比较：environment mismatch/); assert.equal(q('compare').disabled, false);
    failure = 'actual execution controls are missing, invalid or different'; const controls = q('compare').onclick!(); release!(); await controls;
    assert.match(q('comparison-status').textContent, /实际执行预算.*旧报告仍可查看/);
    for (const message of ['runs are not comparable', 'observed evaluator environments are not comparable', 'Failed to fetch', 'Load failed', '__proto__']) {
      failure = message; const request = q('compare').onclick!(); release!(); await request;
      assert.match(q('comparison-status').textContent, message === '__proto__' ? /无法比较：__proto__/ : message.includes('comparable') ? /无法比较：两次运行.*请/ : /无法比较：连接中断.*重试/);
      assert.equal(q('baseline').value, a); assert.equal(q('candidate').value, b);
      assert.equal(q('compare').disabled, false); assert.equal(q('comparison-report').children.length, 0);
    }
    failure = ''; inconclusive = true; const uncertain = q('compare').onclick!(); release!(); await uncertain;
    assert.match(q('comparison-status').textContent, /证据不足/);
    const late = q('compare').onclick!(); panel.destroy(); const before = q('comparison-status').textContent;
    release!(); await late; assert.equal(q('comparison-status').textContent, before);
  } finally { globalThis.document = saved; }
});

test('evaluation recovery preserves uncertainty, restores paths and releases only a confirmed missing run', async () => {
  const saved = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const nodes = new Map<string, Element>();
  const node = (key: string) => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key)!; };
  const q = (key: string) => node(`[data-eval="${key}"]`);
  let state = 'unknown', failure = 0, cancelFail = false, report = { passed: 0, results: undefined as unknown };
  const timers: Array<() => void> = [];
  const api = async (path: string) => {
    if (path.endsWith('/cancel')) { if (cancelFail) throw new Error('cancel disconnected'); state = 'cancelled'; return {}; }
    if (path.endsWith('/report')) return { report };
    if (failure) throw Object.assign(new Error('read disconnected'), { status: failure });
    return { evaluation: { state, error: state === 'unknown' ? 'lost worker' : '', workspace: '/restored', input_paths: ['/suite', null, '/runtime'], run_directory: state === 'cancelled' ? '/report' : undefined } };
  };
  try {
    const panel = mountEvaluationPanel({ innerHTML: '', querySelector: node }, { api, storage: { getItem: (key: string) => key === 'craft-evaluation-id' ? 'a'.repeat(64) : '[]', setItem() {}, removeItem() {} }, clock: { setTimeout: (callback: () => void) => { timers.push(callback); } } });
    await panel.refresh(); assert.equal(q('workspace').value, '/restored'); assert.equal(q('suite').value, '/suite'); assert.equal(q('subject').value, '');
    assert.match(q('provenance').textContent, /评测器 未记录/u);
    assert.equal(q('cancel').disabled, true); await q('cancel').onclick!(); q('new').onclick!(); assert.equal(q('start').disabled, true);
    failure = 500; await panel.refresh(); assert.match(q('status').textContent, /读取未确认/); assert.equal(q('start').disabled, true);
    failure = 0; state = 'unrecognized'; await panel.refresh(); assert.match(q('status').textContent, /未知状态/);
    state = 'running'; await panel.refresh(); timers.pop()!(); await Promise.resolve();
    cancelFail = true; await q('cancel').onclick!(); assert.match(q('status').textContent, /取消未确认/);
    cancelFail = false; await q('cancel').onclick!(); assert.equal(q('new').disabled, false);
    assert.equal(q('report').children.length, 1); // Missing result arrays are a valid empty report view.
    report = { passed: 101, results: Array.from({ length: 101 }, (_, index) => ({ case_id: String(index), verdict: 'passed' })) };
    await panel.refresh(); assert.equal(q('report').children.length, 102); assert.match(q('report').children.at(-1)!.textContent, /前 100/);
    failure = 404; await panel.refresh(); assert.equal(q('start').disabled, false); assert.match(q('status').textContent, /未找到/);
    q('refresh').onclick!(); panel.destroy();
  } finally { globalThis.document = saved; }
});

test('evaluation path picking and storage failures do not duplicate submissions', async () => {
  const saved = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const nodes = new Map<string, Element>();
  const node = (key: string) => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key)!; };
  const q = (key: string) => node(`[data-eval="${key}"]`), pick = (key: string) => node(`[data-pick="${key}"]`);
  let selected: unknown = '/workspace', pickerFails = false, postsFail = true;
  const calls: string[] = [];
  const api = async (path: string, options?: unknown) => {
    if (options) { if (postsFail) throw new Error('connection lost after submit'); return {}; }
    return path.endsWith('/events') ? { evaluation: { state: 'completed' } } : { report: {} };
  };
  const storage = { getItem() { throw new Error('storage blocked'); }, setItem() { throw new Error('storage blocked'); }, removeItem() { throw new Error('storage blocked'); } };
  try {
    const panel = mountEvaluationPanel({ innerHTML: '', querySelector: node }, { api, storage, invoke: async (command: string) => { calls.push(command); if (pickerFails) throw new Error('picker failed'); return selected; } });
    await pick('workspace').onclick!(); assert.equal(q('workspace').value, '/workspace');
    selected = ['/suite']; await pick('suite').onclick!(); assert.equal(q('suite').value, '/suite');
    selected = []; await pick('suite').onclick!(); assert.equal(q('suite').value, '/suite');
    selected = null; await pick('suite').onclick!(); assert.equal(q('suite').value, '/suite');
    pickerFails = true; await pick('runtime').onclick!(); assert.match(q('status').textContent, /无法选择/);
    assert.ok(calls.includes('choose_project_folder') && calls.includes('choose_reference_files'));
    q('subject').value = '/subject'; q('runtime').value = '/runtime';
    await q('start').onclick!(); assert.match(q('status').textContent, /提交未确认/); assert.equal(q('start').disabled, true);
    await pick('workspace').onclick!(); assert.equal(q('workspace').value, '/workspace');
    postsFail = false; await panel.refresh(); assert.equal(q('new').disabled, false);
    q('baseline').value = q('baseline').children[1].value;
    const baseline = q('baseline').value;
    await panel.refresh(); // Re-reading a completed run updates its existing cache entry.
    assert.equal(q('baseline').value, baseline);
    q('new').onclick!(); assert.equal(q('start').disabled, false);
    panel.destroy(); await pick('workspace').onclick!();
  } finally { globalThis.document = saved; }
});

test('unmounting while preparing submission prevents a real dispatch', async () => {
  const saved = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const nodes = new Map<string, Element>();
  const node = (key: string) => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key)!; };
  let posts = 0;
  try {
    const panel = mountEvaluationPanel({ innerHTML: '', querySelector: node }, { api: async () => { posts++; }, storage: { getItem: () => 'invalid' } });
    for (const key of ['workspace', 'suite', 'subject', 'runtime']) node(`[data-eval="${key}"]`).value = '/tmp/' + key;
    const starting = node('[data-eval="start"]').onclick!(); panel.destroy(); await starting;
    assert.equal(posts, 0);
  } finally { globalThis.document = saved; }
});

test('Context receipt audit uses local files, retries idempotently and renders only bounded audit evidence', async () => {
  const saved = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const nodes = new Map<string, Element>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  const q = (key: string) => node(`[data-eval="${key}"]`);
  const stored = new Map<string, string>();
  const storage = { getItem: (key: string) => stored.get(key) || null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) };
  const calls: Array<{ path: string; options?: { method: string; body: Record<string, string> } }> = [];
  let fail = true;
  const api = async (path: string, options?: { method: string; body: Record<string, string> }) => {
    calls.push({ path, options });
    if (fail) throw new Error('connection lost');
    const report = { status: 'inconclusive', case_id: 'receipt-case', metrics: { selected_ref_count: 2, selected_item_count: 1, selected_chars: 21, estimated_tokens: 8, host_measured_tokens: null }, checks: [{ id: 'required_ref_recall', status: 'passed', observed: 1, expected: 1 }], partial: false, limitations: ['body omitted: RAW_SECRET_CONTENT'] };
    return options ? { audit: { id: 'c'.repeat(64), status: 'inconclusive', input_digest: 'digest', report_digest: 'report-hash', evaluator_version: '0.3.0' }, report, integrity: 'verified_against_saved_report' } : { audit: { status: 'inconclusive', input_digest: 'digest', report_digest: 'report-hash', evaluator_version: '0.3.0' }, report, integrity: 'verified_against_saved_report' };
  };
  try {
    const selected: string[] = ['/tmp/pack.json', '/tmp/expectations.json'];
    let index = 0;
    const panel = mountEvaluationPanel({ innerHTML: '', querySelector: node }, { api, storage, invoke: async () => selected[index++] });
    assert.equal(q('context-audit-start').disabled, true);
    const picks: Record<string, () => Promise<void> | void> = {};
    picks.pack = node('[data-pick-context="pack"]').onclick!;
    await picks.pack(); picks.expectations = node('[data-pick-context="expectations"]').onclick!; await picks.expectations();
    assert.equal(q('context-audit-start').disabled, false);
    await q('context-audit-start').onclick!();
    assert.match(q('context-audit-status').textContent, /安全重试/u);
    const firstOperation = calls.at(-1)!.options!.body.operation_id;
    assert.equal(calls.at(-1)!.path, '/api/workbench/evaluations/context-audit');
    assert.equal(calls.at(-1)!.options!.body.pack_path, '/tmp/pack.json');
    fail = false; await q('context-audit-start').onclick!();
    assert.equal(calls.at(-1)!.options!.body.operation_id, firstOperation);
    assert.match(q('context-audit-status').textContent, /证据不足.*完整性已校验/u);
    assert.match(q('context-audit-identity').textContent, /^审计 c{12} · 评测器 0\.3\.0/u);
    assert.match(q('context-audit-report').children[0].textContent, /引用 2.*Host Token 未记录/u);
    assert.doesNotMatch(JSON.stringify(q('context-audit-report').children), /RAW_SECRET_CONTENT/u);
    assert.equal(q('context-audit-check').disabled, false);
    q('context-pack').value = '/tmp/new-pack.json'; q('context-pack').oninput!();
    assert.equal(q('context-audit-report').children.length, 0);
    assert.equal(stored.has('craft-context-audit-operation'), false);
    panel.destroy();
  } finally { globalThis.document = saved; }
});

test('Context audit restores its last report, bounds check details and invalidates stale results', async () => {
  const saved = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const nodes = new Map<string, Element>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  const q = (key: string) => node(`[data-eval="${key}"]`);
  const auditId = 'd'.repeat(64), values = new Map([['craft-context-audit-operation', 'persisted-operation'], ['craft-context-audit-id', auditId]]);
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const checks = Array.from({ length: 101 }, (_, index) => ({ id: `check-${index}`, status: index % 3 === 0 ? 'failed' : index % 3 === 1 ? 'inconclusive' : 'passed', observed: null, expected: index }));
  let report: unknown = { status: 'failed', case_id: 'restored', metrics: {}, checks, partial: true }, auditStatus = 'failed', readFails = false;
  const paths: string[] = [];
  const api = async (path: string) => { paths.push(path); if (readFails) throw new Error('report unavailable'); return { audit: { status: auditStatus, input_digest: 'digest', report_digest: 'hash' }, report, integrity: 'verified_against_saved_report' }; };
  try {
    const panel = mountEvaluationPanel({ innerHTML: '', querySelector: node }, { api, storage });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(paths[0], `/api/workbench/evaluations/context-audit/${auditId}/report`);
    assert.match(q('context-audit-status').textContent, /未通过.*完整性已校验/u);
    assert.equal(q('context-audit-report').children.length, 103);
    readFails = true; await q('context-audit-check').onclick!();
    assert.match(q('context-audit-status').textContent, /读取未确认：report unavailable/u); readFails = false;
    assert.equal(paths.length, 2);
    q('context-audit-new').onclick!();
    assert.equal(values.has('craft-context-audit-id'), false);
    assert.equal(values.has('craft-context-audit-operation'), false);
    await q('context-audit-check').onclick!(); // Empty identity is a no-op.
    assert.equal(paths.length, 2);
    report = { status: 'passed', case_id: 'new', metrics: {}, checks: [], partial: false }; auditStatus = 'passed';
    q('context-pack').value = '/tmp/pack'; q('context-pack').oninput!(); q('context-expectations').value = '/tmp/manifest'; q('context-expectations').oninput!();
    const start = q('context-audit-start').onclick!(); await start;
    assert.match(q('context-audit-status').textContent, /通过.*完整性已校验/u);
    report = null;
    q('context-audit-new').onclick!();
    q('context-pack').value = '/tmp/pack'; q('context-pack').oninput!(); q('context-expectations').value = '/tmp/manifest'; q('context-expectations').oninput!();
    await q('context-audit-start').onclick!();
    assert.match(q('context-audit-status').textContent, /审计未确认/u);
    panel.destroy();
  } finally { globalThis.document = saved; }
});

test('Context audit ignores late asynchronous responses after unmount', async () => {
  const saved = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const nodes = new Map<string, Element>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector)!; };
  const q = (key: string) => node(`[data-eval="${key}"]`);
  let release!: (value: unknown) => void;
  const storage = { getItem: (key: string) => key === 'craft-context-audit-id' ? 'e'.repeat(64) : null };
  try {
    const panel = mountEvaluationPanel({ innerHTML: '', querySelector: node }, { storage, api: async () => new Promise((resolve, reject) => { release = () => reject(new Error('late failure')); }) });
    const initialStatus = q('context-audit-status').textContent;
    panel.destroy();
    release({ audit: { status: 'passed' }, report: { status: 'passed', metrics: {}, checks: [] }, integrity: 'verified_against_saved_report' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(q('context-audit-status').textContent, initialStatus);
  } finally { globalThis.document = saved; }
});

test('unknown recovery retains the original record and requires review before a separate submission', async () => {
  const saved = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const nodes = new Map<string, Element>();
  const node = (key: string) => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key)!; };
  const q = (key: string) => node(`[data-eval="${key}"]`);
  const unknownId = 'b'.repeat(64), stored = new Map([['craft-evaluation-id', unknownId]]);
  const original = { state: 'unknown', report_root: '<untrusted output>', workspace: '/project', input_paths: ['/suite', '/subject', '/runtime'] };
  let observed = { ...original }, failure = false, posts = 0;
  const api = async (_path: string, options?: { method: string; body: { operation_id: string } }) => {
    if (failure) throw new Error('disconnected');
    if (options?.method === 'POST') { posts++; assert.notEqual(options.body.operation_id, unknownId); observed = { ...original, state: 'completed' }; return {}; }
    if (_path.endsWith('/report')) return { report: { passed: 1, results: [] } };
    return { evaluation: observed };
  };
  try {
    const panel = mountEvaluationPanel({ innerHTML: '', querySelector: node }, { api, storage: { getItem: (key: string) => stored.get(key) || null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) } });
    await panel.refresh();
    assert.equal(q('recovery').hidden, false); assert.equal(q('prepare').disabled, true);
    assert.match(q('identity').textContent, /<untrusted output>/); assert.equal(q('identity').innerHTML, '');
    assert.deepEqual(JSON.parse(stored.get('craft-evaluation-unresolved')!), [unknownId]);
    await q('prepare').onclick!(); await q('open-unknown').onclick!(); assert.equal(posts, 0);
    q('confirmed').checked = true; q('confirmed').onchange!();
    assert.equal(q('prepare').disabled, false); assert.equal(q('cancel').disabled, true); assert.equal(q('new').disabled, true);
    await q('prepare').onclick!();
    assert.deepEqual(observed, original); assert.equal(posts, 0); assert.equal(stored.has('craft-evaluation-id'), false);
    assert.equal(q('start').disabled, false); assert.equal(q('workspace').focused, true); assert.match(q('status').textContent, /原运行结果保持未知/);
    q('unknown-run').value = unknownId; q('unknown-run').onchange!(); assert.equal(q('open-unknown').disabled, false);
    await q('open-unknown').onclick!(); assert.equal(stored.get('craft-evaluation-id'), unknownId); assert.equal(q('recovery').hidden, false);
    // A failed re-read revokes the previous manual confirmation.
    q('confirmed').checked = true; q('confirmed').onchange!(); failure = true; await panel.refresh();
    assert.equal(q('confirmed').checked, false); assert.equal(q('prepare').disabled, true); assert.equal(q('recovery').hidden, true); assert.equal(q('start').disabled, true);
    failure = false; observed.state = 'running'; await panel.refresh(); assert.equal(q('recovery').hidden, true); assert.equal(q('start').disabled, true);
    observed.state = 'unknown'; await panel.refresh(); q('confirmed').checked = true; q('confirmed').onchange!(); await q('prepare').onclick!();
    await q('start').onclick!(); assert.equal(posts, 1); assert.notEqual(stored.get('craft-evaluation-id'), unknownId);
    assert.equal(original.state, 'unknown'); assert.deepEqual(JSON.parse(stored.get('craft-evaluation-unresolved')!), [unknownId]);
    q('unknown-run').value = unknownId; q('unknown-run').onchange!();
    panel.destroy(); await q('open-unknown').onclick!(); q('confirmed').onchange!(); q('unknown-run').onchange!(); q('new').onclick!();
    assert.equal(posts, 1);
  } finally { globalThis.document = saved; }
});

test('unknown history validates and bounds optional local storage without changing server records', async () => {
  const saved = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  try {
    const ids = Array.from({ length: 25 }, (_, index) => index.toString(16).padStart(64, '0'));
    for (const history of [JSON.stringify([...ids, ids[0], null, {}, '__proto__']), '{', '{}', 'throw']) {
      const nodes = new Map<string, Element>(); const node = (key: string) => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key)!; };
      const q = (key: string) => node(`[data-eval="${key}"]`);
      const panel = mountEvaluationPanel({ innerHTML: '', querySelector: node }, { api: async () => ({ evaluation: { state: 'unknown' } }), storage: {
        getItem(key: string) { if (key === 'craft-evaluation-unresolved') { if (history === 'throw') throw new Error('storage disabled'); return history; } return null; },
        setItem() { throw new Error('storage full'); },
      } });
      assert.equal(q('unknown-run').children.length, history.startsWith('[') ? 21 : 1);
      if (history.startsWith('[')) {
        assert.equal(q('unknown-run').children[1].value, ids[5]);
        q('unknown-run').value = ids[24]; q('unknown-run').onchange!(); await q('open-unknown').onclick!();
        assert.equal(q('unknown-run').value, ids[24]); assert.match(q('identity').textContent, /服务未提供/);
        q('confirmed').checked = true; q('confirmed').onchange!(); panel.destroy(); await q('prepare').onclick!(); assert.equal(q('start').disabled, true);
      } else panel.destroy();
    }
  } finally { globalThis.document = saved; }
});

test('knowledge-effect gate needs one run plus two distinct completed runs and reports its conclusion', async () => {
  const saved = globalThis.document; globalThis.document = { createElement: () => new Element() } as unknown as Document;
  const nodes = new Map<string, Element>();
  const node = (key: string) => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key)!; };
  const q = (key: string) => node(`[data-eval="${key}"]`);
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  const posts: Array<{ path: string; body: unknown }> = [];
  let release: (() => void) | undefined, failure = '', payload: Record<string, unknown> = { assessment: { status: 'eligible', reasons: [] } };
  const storage = { getItem: (key: string) => key === 'craft-evaluation-completed' ? JSON.stringify([{ id: a, title: 'baseline' }, { id: b, title: 'candidate' }]) : null };
  const api = async (path: string, options: { method: string; body: unknown }) => {
    posts.push({ path, body: options.body });
    await new Promise<void>(resolve => { release = resolve; });
    if (failure) throw new Error(failure);
    return payload;
  };
  try {
    const panel = mountEvaluationPanel({ innerHTML: '', querySelector: node }, { api, storage });
    assert.equal(q('gate-assess').disabled, true);
    await q('gate-assess').onclick!(); assert.equal(posts.length, 0);
    q('gate-run').value = '   '; q('gate-run').onchange!(); assert.equal(q('gate-assess').disabled, true);
    q('gate-run').value = 'run-1'; q('gate-run').onchange!();
    assert.equal(q('gate-assess').disabled, true);
    q('baseline').value = a; q('candidate').value = a; q('candidate').onchange!();
    assert.equal(q('gate-assess').disabled, true);
    q('candidate').value = b; q('candidate').onchange!();
    assert.equal(q('gate-assess').disabled, false);
    const first = q('gate-assess').onclick!(); await q('gate-assess').onclick!();
    assert.equal(posts.length, 1); assert.equal(q('gate-assess').disabled, true);
    assert.deepEqual(posts[0], { path: '/api/workbench/evaluations/knowledge-assess', body: { retrieval_run_id: 'run-1', baseline_id: a, candidate_id: b } });
    release!(); await first;
    assert.match(q('gate-status').textContent, /门槛通过/); assert.equal(q('gate-assess').disabled, false);
    assert.match(q('gate-report').children[0].children[1].textContent, /eligible/);
    payload = { assessment: { status: 'insufficient', reasons: ['task_gain_not_supported', 'negative_task_regression'] } };
    const rejected = q('gate-assess').onclick!(); release!(); await rejected;
    assert.match(q('gate-status').textContent, /门槛未通过：task_gain_not_supported、negative_task_regression/);
    payload = {};
    const bare = q('gate-assess').onclick!(); release!(); await bare;
    assert.match(q('gate-status').textContent, /缺少可判定的证据/);
    failure = 'Failed to fetch'; const mapped = q('gate-assess').onclick!(); release!(); await mapped;
    assert.match(q('gate-status').textContent, /无法评估：连接中断/);
    failure = 'boom'; const raw = q('gate-assess').onclick!(); release!(); await raw;
    assert.match(q('gate-status').textContent, /无法评估：boom/);
    failure = '';
    q('gate-run').value = 'run-2'; q('gate-run').onchange!();
    assert.equal(q('gate-status').textContent, ''); assert.equal(q('gate-report').children.length, 0);
    const late = q('gate-assess').onclick!(); panel.destroy(); const before = q('gate-status').textContent;
    release!(); await late; assert.equal(q('gate-status').textContent, before);
    q('gate-report').append(new Element());
    q('gate-run').onchange!();
    assert.equal(q('gate-report').children.length, 1, 'an unmounted panel ignores later input');
  } finally { globalThis.document = saved; }
});
