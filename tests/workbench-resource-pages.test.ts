import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Browser JavaScript is exercised without generated declarations.
import { createResourcePages } from '../workbench/resource-pages.js';

type Button = { onclick?: () => void; getAttribute: (name: string) => string };
const button = (id: string): Button => ({ getAttribute: () => id });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('Memory and Workflow pages render persisted rows and wire governed edit/retire actions', async () => {
  let data: Record<string, unknown> = {};
  const calls: unknown[] = [], edits: unknown[] = [], refreshes: string[] = [], notifications: string[] = [], errors: string[] = [];
  let retireFails = false;
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const pages = createResourcePages({
    api: async (path: string, init?: unknown) => {
      calls.push([path, init]);
      if (path.endsWith('/retire') && retireFails) throw new Error('retire denied');
      return data;
    },
    presentation: {
      icon: (name: string) => `<svg>${name}</svg>`, esc,
      head: (title: string, _sub: string, right: string) => `<h2>${title}</h2>${right}`,
      emptyState: (title: string) => `<p>${title}</p>`, asideBlock: (_title: string, _right: string, body: string) => body,
      catalogRows: (items: Record<string, unknown>[], _icon: string, title: (item: unknown) => string, sub: (item: unknown) => string) => items.map((item) => title(item) + sub(item)).join(''),
      countChip: (count: number) => String(count), label: (_labels: unknown, _status: unknown, fallback: unknown) => fallback,
      STATUS_LABELS: {}, shortTime: (value: unknown) => value || '', pill: (text: string) => `<span>${text}</span>`
    },
    editors: { memory: (item?: unknown) => { edits.push(['memory', item]); }, workflow: (item?: unknown) => { edits.push(['workflow', item]); } },
    refresh: (page: string) => { refreshes.push(page); }, notify: (message: string) => { notifications.push(message); }, fail: (error: Error) => { errors.push(error.message); }
  });
  const emptyMemory = await pages.memory();
  assert.ok(emptyMemory.html.includes('还没有可展示的记忆'));
  const emptyWorkflow = await pages.workflows();
  assert.ok(emptyWorkflow.html.includes('还没有经验运行记录'));
  const missingRoot = { querySelector: () => null, querySelectorAll: () => [] };
  emptyMemory.mounts[0](missingRoot); emptyWorkflow.mounts[0](missingRoot);

  const memory = { id: 'memory/1', content: '<unsafe>', kind: 'fact', scope: 'user', source: 'human' };
  data = { items: [memory, { id: 'fallback' }] };
  const memoryView = await pages.memory();
  assert.ok(memoryView.html.includes('&lt;unsafe&gt;'));
  assert.ok(memoryView.html.includes('fallback'));
  const add = button(''), edit = button('memory/1'), missing = button('absent'), retire = button('memory/1');
  memoryView.mounts[0]({ querySelector: () => add, querySelectorAll: (selector: string) =>
    selector === '[data-memory-retire]' ? [retire] : selector === '[data-memory-edit]' ? [missing, edit] : [] });
  add.onclick!(); missing.onclick!(); edit.onclick!(); retire.onclick!(); await flush();
  assert.deepEqual(edits, [['memory', undefined], ['memory', memory]]);
  assert.deepEqual(calls.at(-1), ['/api/workbench/memory/memory%2F1/retire', { method: 'POST', body: {} }]);
  assert.deepEqual(refreshes, ['memory']); assert.deepEqual(notifications, ['记忆已停用']);
  retireFails = true; retire.onclick!(); await flush(); assert.deepEqual(errors, ['retire denied']);

  // A long memory must not stretch the row; the full text stays in the title.
  data = { items: [{ id: 'long', content: 'x'.repeat(500), kind: 'fact', scope: 'user', source: 'human' }] };
  const longView = await pages.memory();
  assert.ok(longView.html.includes(`${'x'.repeat(179)}…`));
  assert.ok(longView.html.includes(`title="${'x'.repeat(500)}"`));
  // The full text is reachable in place, not only through a hover tooltip.
  assert.ok(longView.html.includes(`<p class="row-full">${'x'.repeat(500)}</p>`));
  const summary = /<summary class="row-title"[^>]*>([^<]*)<\/summary>/u.exec(longView.html)?.[1] ?? '';
  assert.equal(summary, `${'x'.repeat(179)}…`, 'the summary stays clipped');

  const workflow = { id: 'w', name: 'Workflow', description: 'summary' };
  data = { workflows: [workflow, { id: 'fallback' }], runs: [{ workflow_id: 'w', status: 'passed', updated_at: 'now' }, { id: 'r' }] };
  const workflowView = await pages.workflows();
  assert.ok(workflowView.html.includes('Workflow')); assert.ok(workflowView.html.includes('没有说明')); assert.ok(workflowView.html.includes('passed · now'));
  const workflowAdd = button(''), workflowEdit = button('w');
  workflowView.mounts[0]({ querySelector: (selector: string) => selector === '#workflow-add' ? workflowAdd : null,
    querySelectorAll: (selector: string) => selector === '[data-workflow-edit]' ? [missing, workflowEdit] : [] });
  workflowAdd.onclick!(); missing.onclick!(); workflowEdit.onclick!();
  assert.deepEqual(edits.slice(-2), [['workflow', undefined], ['workflow', workflow]]);
  data = { items: [], workflows: [], runs: [] };
  assert.ok((await pages.memory()).html.includes('还没有可展示的记忆'));
  assert.ok((await pages.workflows()).html.includes('还没有经验运行记录'));
});

test('a retired row keeps its status, drops the retire action and names an unusable mirror', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const storage = { status: [{ kind: 'memory', mode: 'mirror', path: '/vault', ok: true }, { kind: 'experience', mode: 'mirror', ok: false }] };
  let data: Record<string, unknown> = { items: [{ id: 'revoked', content: 'older fact', status: 'revoked', valid_until: '2026-01-01' }, { status: 'active' }], workflows: [], runs: [] };
  let storageFails = false;
  const pages = createResourcePages({
    api: async (path: string) => {
      if (path !== '/api/workbench/context-storage') return data;
      if (storageFails) throw new Error('offline');
      return storage;
    },
    presentation: {
      icon: (name: string) => `<svg>${name}</svg>`, esc,
      head: (title: string, _sub: string, right: string) => `<h2>${title}</h2>${right}`,
      emptyState: (title: string) => `<p>${title}</p>`, asideBlock: (_t: string, _r: string, body: string) => body,
      catalogRows: () => '', countChip: () => '', label: (_l: unknown, status: unknown, fallback: unknown) => fallback,
      STATUS_LABELS: {}, shortTime: (value: unknown) => value || '', pill: (text: string) => `<span>${text}</span>`
    },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {}
  });
  const view = await pages.memory();
  assert.ok(view.html.includes('有效至 2026-01-01'));
  assert.ok(view.html.includes('<span>revoked</span>'), 'a non-active status keeps its own pill');
  assert.ok(!view.html.includes('data-memory-retire="revoked"'), 'a retired row is not offered for retirement');
  assert.ok(view.html.includes('data-memory-retire=""'), 'only the active row keeps the action');
  assert.equal((view.html.match(/data-memory-edit/gu) ?? []).length, 2);
  assert.ok(view.html.includes('镜像到 /vault'), 'a usable mirror is named without a warning');
  data = { items: [], workflows: [], runs: [] };
  const workflows = await pages.workflows();
  assert.ok(workflows.html.includes('镜像到 未设置目录（不可写：未知原因）'));
  assert.ok(workflows.html.includes('还没有经验运行记录'));
  // A mirror status that cannot be read falls back to the local-only sentence.
  storageFails = true;
  assert.ok((await pages.memory()).html.includes('本地保存；可在设置里镜像到 Obsidian vault 或任意目录。'));
  assert.ok((await pages.workflows()).html.includes('本地保存；可在设置里镜像到 Obsidian vault 或任意目录。'));
});

test('the scoped experience page shows drafts, observations, patterns and assets and posts a capture', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: Array<{ path: string; body?: unknown }> = [];
  let captured = false;
  const pages = createResourcePages({
    api: async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: init && init.body });
      if (path.startsWith('/api/workbench/experience/overview')) return {
        scope: 'task:t1',
        drafts: [{ design: { id: 'd1', name: '产品设计' }, status: 'ready_for_review' }],
        observations: [{ id: 'o1', kind: 'success', scenario_key: 's', evidence_ids: ['e1'] }],
        patterns: [{ id: 'p1', pattern_kind: 'success', status: 'diagnostic_only' }],
        procedures: [{ id: 'proc1', procedure_kind: 'workflow', lifecycle: 'verified', routeable: true }],
      };
      if (path === '/api/workbench/workflow-designs/capture' && init && init.method === 'POST') { captured = true; return { observation: { id: 'obs' }, design: { design: { id: 'd2' } } }; }
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => 'task:t1',
  });
  const view = await pages.workflows();
  assert.ok(view.html.includes('观察 · success'));
  assert.ok(view.html.includes('模式 · success'));
  assert.ok(view.html.includes('资产 · workflow'));
  assert.ok(view.html.includes('沉淀这次成果'));
  // The capture form must be always-visible: it renders inside .field/.grid-3
  // (opacity 1), never the hover-only .row-actions that would hide the inputs.
  assert.ok(view.html.includes('id="capture-task"'), 'capture form renders the task input');
  assert.ok(!/class="row-actions"><input id="capture-task"/u.test(view.html), 'capture form must not rely on hover-revealed .row-actions');
  const taskField = { value: 't1' }, nameField = { value: '复用' }, scenarioField = { value: 'product_design' }, status = { textContent: '' };
  const captureButton: { onclick?: () => void; disabled?: boolean } = {};
  view.mounts[0]({
    querySelector: (selector: string) => selector === '#capture-task' ? taskField : selector === '#capture-name' ? nameField
      : selector === '#capture-scenario' ? scenarioField : selector === '#capture-status' ? status : selector === '#experience-capture' ? captureButton : null,
    querySelectorAll: () => [],
  });
  captureButton.onclick!();
  await flush();
  assert.equal(captured, true);
  const post = calls.find((call) => call.path === '/api/workbench/workflow-designs/capture');
  assert.deepEqual(post && post.body, { task_id: 't1', name: '复用', scenario_key: 'product_design', scope: 'task:t1' });
  assert.match(status.textContent, /已沉淀/);
});

test('a routeable asset can report a recall, and a cancelled prompt sends nothing', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: Array<{ path: string; body?: unknown }> = [];
  let prompt = 'receipt-1';
  let feedbackFails = false;
  const pages = createResourcePages({
    api: async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: init && init.body });
      if (path === '/api/workbench/experience/feedback' && feedbackFails) throw new Error('feedback rejected');
      if (path.startsWith('/api/workbench/experience/overview')) return {
        scope: 'task:t1', drafts: [], observations: [], patterns: [],
        procedures: [{ id: 'proc-1', procedure_kind: 'workflow', lifecycle: 'verified', routeable: true }],
      };
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => 'task:t1',
    ask: () => prompt,
  });
  const view = await pages.workflows();
  const buttons: Array<{ onclick?: () => void; disabled?: boolean; getAttribute: (n: string) => string }> = [
    { getAttribute: (n: string) => n === 'data-exp-feedback' ? 'experience' : n === 'data-exp-id' ? 'proc-1' : 'helpful' },
  ];
  view.mounts[0]({
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === '[data-exp-feedback]' ? buttons : [],
  });
  buttons[0].onclick!();
  await flush();
  const posted = calls.find((call) => call.path === '/api/workbench/experience/feedback');
  assert.deepEqual(posted && posted.body, { receipt_id: 'receipt-1', outcome: 'helpful', members: ['experience'],
    asset_refs: [{ member: 'experience', id: 'proc-1' }] });
  // A cancelled prompt sends nothing.
  prompt = '';
  calls.length = 0;
  buttons[0].onclick!();
  await flush();
  assert.equal(calls.filter((call) => call.path === '/api/workbench/experience/feedback').length, 0);
  // A rejected feedback re-enables the button instead of leaving it stuck.
  prompt = 'receipt-2';
  feedbackFails = true;
  buttons[0].onclick!();
  await flush();
  assert.equal(calls.filter((call) => call.path === '/api/workbench/experience/feedback').length, 1);
});

test('the experience page survives empty and missing projections', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  let overview: unknown = {};
  let overviewFails = false;
  const pages = createResourcePages({
    api: async (path: string) => {
      if (path.startsWith('/api/workbench/experience/overview')) {
        if (overviewFails) throw new Error('overview unavailable');
        return overview;
      }
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => 'task:t1',
  });
  // An overview without any tier arrays still renders the tier cards.
  const empty = await pages.workflows();
  assert.ok(empty.html.includes('沉淀这次成果'));
  assert.ok(empty.html.includes('暂无'));
  // An overview that fails to load must not break the page.
  overviewFails = true;
  const failed = await pages.workflows();
  assert.ok(failed.html.includes('沉淀这次成果'));
  // A scope that is present but has tiers with missing arrays stays renderable.
  overviewFails = false;
  overview = { scope: 'task:t1', drafts: [{ design: {}, status: 'needs_input' }] };
  const partial = await pages.workflows();
  assert.ok(partial.html.includes('经验 · 草稿'));
});

test('without a scope the page asks for one and the capture form validates its input', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: Array<{ path: string; body?: unknown }> = [];
  const notices: string[] = [];
  const pages = createResourcePages({
    api: async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: init && init.body });
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: (m: string) => { notices.push(m); },
    fail: () => {}, scope: () => '',
  });
  const view = await pages.workflows();
  assert.ok(view.html.includes('先选择一个任务或工作区'));
  const scopeField = { value: '' };
  const scopeButton: { onclick?: () => void } = {};
  const captureButton: { onclick?: () => void; disabled?: boolean } = {};
  const taskField = { value: '' }, nameField = { value: '' }, scenarioField = { value: '' };
  view.mounts[0]({
    querySelector: (selector: string) => selector === '#experience-scope' ? scopeField : selector === '#experience-scope-open' ? scopeButton
      : selector === '#experience-capture' ? captureButton : selector === '#capture-task' ? taskField
        : selector === '#capture-name' ? nameField : selector === '#capture-scenario' ? scenarioField : null,
    querySelectorAll: () => [],
  });
  // Opening a scope needs a value.
  scopeButton.onclick!();
  assert.deepEqual(notices, []);
  scopeField.value = 'task:t9';
  scopeButton.onclick!();
  assert.deepEqual(notices, ['已打开范围 task:t9']);
  // Capture without a task id is refused before any request.
  captureButton.onclick!();
  assert.equal(notices.at(-1), '请填写已完成任务 id');
  assert.equal(calls.filter((call) => call.path === '/api/workbench/workflow-designs/capture').length, 0);
});

test('capture defaults its name and scenario, reports a missing observation and survives a failure', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: Array<{ path: string; body?: unknown }> = [];
  let captureResult: unknown = { observation: { id: 'o' } };
  let captureFails = false;
  const pages = createResourcePages({
    api: async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: init && init.body });
      if (path === '/api/workbench/workflow-designs/capture') {
        if (captureFails) throw new Error('capture rejected');
        return captureResult;
      }
      if (path.startsWith('/api/workbench/experience/overview')) return {
        scope: 'task:t1',
        drafts: [{ status: 'needs_input' }, {}],
        observations: [{}],
        patterns: [{}],
        procedures: [{ id: 'p1' }],
      };
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => 'task:t1',
  });
  const view = await pages.workflows();
  const status = { textContent: '' };
  const taskField = { value: 't1' };
  const captureButton: { onclick?: () => void; disabled?: boolean } = {};
  view.mounts[0]({
    querySelector: (selector: string) => selector === '#capture-task' ? taskField : selector === '#capture-status' ? status
      : selector === '#experience-capture' ? captureButton : null,
    querySelectorAll: () => [],
  });
  captureButton.onclick!();
  await flush();
  const posted = calls.find((call) => call.path === '/api/workbench/workflow-designs/capture');
  assert.deepEqual(posted && posted.body, { task_id: 't1', name: '经验草稿', scenario_key: 'general', scope: 'task:t1' });
  assert.match(status.textContent, /已沉淀/);
  status.textContent = '';
  captureResult = { observation: null, observation_error: 'ledger offline' };
  captureButton.onclick!();
  await flush();
  assert.match(status.textContent, /观察未写入：ledger offline/);
  status.textContent = '';
  captureResult = { observation: null, observation_error: '' };
  captureButton.onclick!();
  await flush();
  assert.match(status.textContent, /观察未写入：未知/);
  captureFails = true;
  captureButton.onclick!();
  await flush();
  assert.equal(calls.filter((call) => call.path === '/api/workbench/workflow-designs/capture').length, 4);
});

test('the page asks through the host when no prompt helper is injected', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: string[] = [];
  const pages = createResourcePages({
    api: async (path: string) => { calls.push(path); return { workflows: [], runs: [], status: [] }; },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => 'task:t1',
  });
  const view = await pages.workflows();
  const buttons: Array<{ onclick?: () => void; getAttribute: (n: string) => string }> = [
    { getAttribute: (n: string) => n === 'data-exp-feedback' ? 'experience' : n === 'data-exp-id' ? 'p1' : 'helpful' },
  ];
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (s: string) => s === '[data-exp-feedback]' ? buttons : [] });
  buttons[0].onclick!();
  await flush();
  assert.equal(calls.filter((path) => path === '/api/workbench/experience/feedback').length, 0);
});

test('the fallback prompt uses the global prompt when the host injected none', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: string[] = [];
  const priorPrompt = (globalThis as any).prompt;
  (globalThis as any).prompt = () => 'receipt-global';
  try {
    const pages = createResourcePages({
      api: async (path: string) => { calls.push(path); return { workflows: [], runs: [], status: [] }; },
      presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
        emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
        label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
      editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
      scope: () => 'task:t1',
    });
    const view = await pages.workflows();
    const buttons: Array<{ onclick?: () => void; getAttribute: (n: string) => string }> = [
      { getAttribute: (n: string) => n === 'data-exp-feedback' ? 'experience' : n === 'data-exp-id' ? 'p1' : 'helpful' },
    ];
    view.mounts[0]({ querySelector: () => null, querySelectorAll: (s: string) => s === '[data-exp-feedback]' ? buttons : [] });
    buttons[0].onclick!();
    await flush();
    assert.equal(calls.filter((path) => path === '/api/workbench/experience/feedback').length, 1);
  } finally {
    if (priorPrompt === undefined) delete (globalThis as any).prompt; else (globalThis as any).prompt = priorPrompt;
  }
});
test('the experience page shows the recall-feedback weight that drives ranking', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const pages = createResourcePages({
    api: async (path: string) => {
      if (path.startsWith('/api/workbench/experience/overview')) return {
        scope: 'task:t1',
        drafts: [], observations: [], patterns: [],
        procedures: [{ id: 'proc1', procedure_kind: 'workflow', lifecycle: 'verified', routeable: true,
          recall_weight: 1.2, recall_penalty: 1, helpful_signals: 2, pending_corrections: 0 }],
      };
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => 'task:t1',
  });
  const view = await pages.workflows();
  assert.ok(view.html.includes('权重 1.20'));
  assert.ok(view.html.includes('有用 2 / 待复核 0'));
});
test('recall feedback prefills the latest receipt that pulled the procedure, without a prompt', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: Array<{ path: string; body?: unknown }> = [];
  let prompted = 0;
  const pages = createResourcePages({
    api: async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: init && init.body });
      if (path.indexOf('/api/workbench/experience/recall-receipts') === 0) {
        return { procedure_id: 'proc-1', receipts: [{ id: 'receipt-latest', created_at: 'now', scope: null }] };
      }
      if (path.startsWith('/api/workbench/experience/overview')) return {
        scope: 'task:t1', drafts: [], observations: [], patterns: [],
        procedures: [{ id: 'proc-1', procedure_kind: 'workflow', lifecycle: 'verified', routeable: true }],
      };
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => 'task:t1',
    ask: () => { prompted += 1; return 'should-not-be-used'; },
  });
  const view = await pages.workflows();
  const buttons: Array<{ onclick?: () => void; disabled?: boolean; getAttribute: (n: string) => string }> = [
    { getAttribute: (n: string) => n === 'data-exp-feedback' ? 'experience' : n === 'data-exp-id' ? 'proc-1' : 'helpful' },
  ];
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (selector: string) => selector === '[data-exp-feedback]' ? buttons : [] });
  buttons[0].onclick!();
  await flush();
  assert.equal(prompted, 0);
  const posted = calls.find((call) => call.path === '/api/workbench/experience/feedback');
  assert.equal(posted && (posted.body as { receipt_id?: string }).receipt_id, 'receipt-latest');
});
test('the experience asset recall audit expands into receipts with their feedback verdicts', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: string[] = [];
  const pages = createResourcePages({
    api: async (path: string) => {
      calls.push(path);
      if (path.indexOf('/api/workbench/experience/recall-receipts') === 0) {
        return { procedure_id: 'proc-1', receipts: [
          { id: 'receipt-a', created_at: 't1', scope: null, feedback: [{ id: 'f1', outcome: 'helpful', usage_stage: 'used', turn_outcome: null, evidence_verified: true, created_at: 't1' }] },
          { id: 'receipt-b', created_at: 't2', scope: null, feedback: [] },
        ] };
      }
      if (path.startsWith('/api/workbench/experience/overview')) return {
        scope: 'task:t1', drafts: [], observations: [], patterns: [],
        procedures: [{ id: 'proc-1', procedure_kind: 'workflow', lifecycle: 'verified', routeable: true }],
      };
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => 'task:t1',
  });
  const view = await pages.workflows();
  assert.ok(view.html.includes('召回记录'));
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string } = {
    dataset: {}, getAttribute: (n: string) => n === 'data-exp-audit' ? 'proc-1' : '',
  };
  const list = { hidden: true, textContent: '' };
  const parent = { querySelector: (selector: string) => selector === '[data-recall-audit-list]' ? list : null };
  const rows: Array<{ onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: typeof parent }> = [
    { dataset: {}, getAttribute: (n: string) => n === 'data-exp-audit' ? 'proc-1' : '', parentElement: parent },
  ];
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (selector: string) => selector === '[data-exp-audit]' ? rows : [] });
  rows[0].onclick!();
  await flush();
  assert.ok(calls.some((path) => path.indexOf('/api/workbench/experience/recall-receipts') === 0));
  assert.match(list.textContent, /回执 receipt-a · helpful/u);
  assert.match(list.textContent, /回执 receipt-b · 未标注/u);
  // Toggling again collapses without a second fetch.
  calls.length = 0;
  rows[0].onclick!();
  assert.equal(list.hidden, true);
  assert.equal(calls.filter((path) => path.indexOf('/api/workbench/experience/recall-receipts') === 0).length, 0);
});
test('memory rows expose the same recall audit with the memory member', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: string[] = [];
  const pages = createResourcePages({
    api: async (path: string) => {
      calls.push(path);
      if (path.indexOf('/api/workbench/experience/recall-receipts') === 0) {
        return { member: 'memory', asset_id: 'memory-1', receipts: [
          { id: 'mem-receipt', created_at: 't', scope: null, feedback: [{ id: 'f', outcome: 'helpful', usage_stage: 'shown', turn_outcome: null, evidence_verified: false, created_at: 't' }] }] };
      }
      if (path.indexOf('/api/workbench/resources?kind=memory') === 0) {
        return { items: [{ id: 'memory-1', content: '使用 Node.js', status: 'active', kind: 'fact', scope: 'project:demo', source: 'user' }], runs: [], status: [] };
      }
      return { items: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => 'project:demo',
  });
  const view = await pages.memory();
  assert.ok(view.html.includes('召回记录'));
  const rows: Array<{ onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown }> = [
    { dataset: {}, getAttribute: (n: string) => n === 'data-memory-audit' ? 'memory-1' : '', parentElement: { querySelector: (sel: string) => sel === '[data-recall-audit-list]' ? { hidden: true, textContent: '' } : null } },
  ];
  const list = { hidden: true, textContent: '' };
  rows[0].parentElement = { querySelector: (sel: string) => sel === '[data-recall-audit-list]' ? list : null };
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (selector: string) => selector === '[data-memory-audit]' ? rows : [] });
  rows[0].onclick!();
  await flush();
  assert.ok(calls.some((path) => path.indexOf('member=memory') >= 0 && path.indexOf('asset_id=memory-1') >= 0));
  assert.match(list.textContent, /回执 mem-receipt · helpful/u);
});
test('the experience page lists pending corrections and lets a person confirm or dismiss one', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: Array<{ path: string; body?: unknown }> = [];
  const notices: string[] = [];
  const pages = createResourcePages({
    api: async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: init && init.body });
      if (path.indexOf('/api/workbench/context-corrections/decide') === 0) return { correction: { id: 'corr-1', status: 'confirmed' } };
      if (path.indexOf('/api/workbench/context-corrections') === 0) {
        return { corrections: [{ id: 'corr-1', outcome: 'incorrect', asset_ref: { member: 'experience', id: 'proc-1' } }], count: 1 };
      }
      if (path.startsWith('/api/workbench/experience/overview')) {
        return { scope: 'task:t1', drafts: [], observations: [], patterns: [], procedures: [] };
      }
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: (m: string) => { notices.push(m); }, fail: () => {},
    scope: () => 'task:t1', ask: () => '证据显示该资产已过期', operator: () => 'user:alex',
  });
  const view = await pages.workflows();
  assert.ok(view.html.includes('待复核纠错'));
  assert.ok(view.html.includes('经验 proc-1'));
  assert.ok(view.html.includes('确认有误'));
  assert.ok(view.html.includes('驳回'));
  const buttons: Array<{ onclick?: () => void; disabled?: boolean; getAttribute: (n: string) => string }> = [
    { getAttribute: (n: string) => n === 'data-correction-decide' ? 'confirmed' : 'corr-1' },
    { getAttribute: (n: string) => n === 'data-correction-decide' ? 'dismissed' : 'corr-1' },
  ];
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (selector: string) => selector === '[data-correction-decide]' ? buttons : [] });
  buttons[0].onclick!();
  await flush();
  const posted = calls.find((call) => call.path.indexOf('/api/workbench/context-corrections/decide') === 0);
  assert.equal(posted && (posted.body as { task_id?: string }).task_id, 'corr-1');
  assert.equal(posted && (posted.body as { decision?: string }).decision, 'confirmed');
  assert.equal(posted && (posted.body as { decided_by?: string }).decided_by, 'user:alex', 'the decision is signed by the configured operator');
  assert.ok(notices.some((note) => note.includes('继续降权')));
  assert.equal(posted && (posted.body as { reason?: string }).reason, '证据显示该资产已过期');
});
test('the pending-correction queue stays visible before any scope is chosen', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const pages = createResourcePages({
    api: async (path: string) => {
      if (path.indexOf('/api/workbench/context-corrections') === 0) {
        return { corrections: [{ id: 'c1', outcome: 'stale', asset_ref: { member: 'memory', id: 'mem-9' } }], count: 1 };
      }
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => '',
  });
  const view = await pages.workflows();
  assert.ok(view.html.includes('先选择一个任务或工作区'), 'the scoped hint is still there');
  assert.ok(view.html.includes('待复核纠错'));
  assert.ok(view.html.includes('记忆 mem-9'), 'the queue names the affected member asset');
});
test('without a configured operator the decision is signed as unattributed, not as a fake person', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: Array<{ path: string; body?: unknown }> = [];
  const pages = createResourcePages({
    api: async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: init && init.body });
      if (path.indexOf('/api/workbench/context-corrections') === 0) {
        return { corrections: [{ id: 'c1', outcome: 'incorrect', asset_ref: { member: 'memory', id: 'm1' } }] };
      }
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => '', ask: () => '',
  });
  const view = await pages.workflows();
  const buttons: Array<{ onclick?: () => void; disabled?: boolean; getAttribute: (n: string) => string }> = [
    { getAttribute: (n: string) => n === 'data-correction-decide' ? 'dismissed' : 'c1' },
  ];
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (selector: string) => selector === '[data-correction-decide]' ? buttons : [] });
  buttons[0].onclick!();
  await flush();
  const posted = calls.find((call) => call.path.indexOf('/api/workbench/context-corrections/decide') === 0);
  assert.equal(posted && (posted.body as { decided_by?: string }).decided_by, 'unattributed');
  assert.equal(posted && (posted.body as { reason?: string }).reason, undefined, 'an empty prompt must not add a reason');
});
test('the resolved-correction audit card names the outcome, who settled it and why', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const pages = createResourcePages({
    api: async (path: string) => {
      if (path.indexOf('status=pending_review') >= 0) return { corrections: [] };
      if (path.indexOf('status=decided') >= 0) {
        return { corrections: [
          { id: 'c1', status: 'confirmed', outcome: 'incorrect', asset_ref: { member: 'experience', id: 'proc-1' },
            decided_by: 'user:alex', resolution_reason: '回执指向已删除的实现', resolved_at: '2026-11-06T08:00:00Z' },
          { id: 'c2', status: 'dismissed', outcome: 'stale', asset_ref: { member: 'memory', id: 'mem-1' },
            resolved_at: '2026-11-05T08:00:00Z' },
        ], count: 2 };
      }
      return { workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => '',
  });
  const view = await pages.workflows();
  assert.ok(view.html.includes('最近裁决'));
  assert.ok(view.html.includes('confirmed · 由 user:alex · 回执指向已删除的实现'));
  // An unnamed decision is labelled honestly instead of left blank.
  assert.ok(view.html.includes('dismissed · 由 未署名'));
});
test('a truncated resolved-correction list tells the reader how many more exist', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const pages = createResourcePages({
    api: async (path: string) => {
      if (path.indexOf('status=decided') >= 0) {
        return { corrections: [
          { id: 'c1', status: 'confirmed', outcome: 'incorrect', asset_ref: { member: 'experience', id: 'p1' }, decided_by: 'user:alex' },
        ], count: 1, total: 42 };
      }
      return { corrections: [], workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: unknown) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {},
    scope: () => '',
  });
  const view = await pages.workflows();
  assert.ok(view.html.includes('显示 1 / 共 42'), 'a cut list must not look complete');
});
test('memory rows show who proposed them and the editor signs new ones', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: Array<{ path: string; body?: unknown }> = [];
  const pages = createResourcePages({
    api: async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: init && init.body });
      if (path.indexOf('/api/workbench/resources?kind=memory') === 0) {
        return { items: [
          { id: 'm1', content: '用 pnpm', kind: 'preference', scope: 'project:demo', source: 'human', status: 'reviewed', proposed_by: 'user:alex', review: { reviewer: 'user:bian', reviewed_at: '2026-11-06T08:00:00Z' } },
          { id: 'm2', content: '先跑测试', kind: 'rule', scope: 'project:demo', source: 'agent', status: 'active' },
        ] };
      }
      return { items: [], workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {}, scope: () => '',
  });
  const view = await pages.memory();
  assert.ok(view.html.includes('提出 user:alex'));
  // The projection keeps the review record, so the page can name the reviewer.
  assert.ok(view.html.includes('审核 user:bian'));
  assert.ok(view.html.includes('提出 未署名'), 'an unattributed memory says so instead of going blank');
});
test('a memory candidate is reviewed with a reason and the operator signature', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: Array<{ path: string; body?: unknown }> = [];
  const refreshes: string[] = [];
  const notices: string[] = [];
  const pages = createResourcePages({
    api: async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: init && init.body });
      if (path.indexOf('/api/workbench/resources?kind=memory') === 0) {
        return { items: [
          { id: 'cand-1', content: 'prefer pnpm', kind: 'preference', scope: 'project:demo', source: 'agent', status: 'candidate', proposed_by: 'agent' },
          { id: 'cand-2', content: 'conflicting habit', kind: 'preference', scope: 'project:demo', source: 'agent', status: 'conflict_pending' },
        ] };
      }
      return { items: [], workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: (page: string) => { refreshes.push(page); }, notify: (m: string) => { notices.push(m); }, fail: () => {},
    scope: () => '', ask: () => '证据充分', operator: () => 'user:alex',
  });
  const view = await pages.memory();
  // Candidates expose review actions instead of the edit/retire of live records.
  assert.ok(view.html.includes('data-memory-review="approve"'));
  assert.ok(view.html.includes('data-memory-review="reject"'));
  assert.ok(!view.html.includes('data-memory-edit="cand-1"'), 'a candidate is not edited in place');
  // A conflicting candidate cannot be approved, but it can now be settled here.
  assert.ok(view.html.includes('与同主题的其他记忆冲突，需人工裁决'));
  assert.ok(view.html.includes('data-memory-conflict="keep"'));
  assert.ok(view.html.includes('data-memory-conflict="supersede"'));
  assert.ok(view.html.includes('data-memory-conflict="dismiss"'));
  assert.equal((view.html.match(/data-memory-review="approve"/g) || []).length, 1);
  const buttons: Array<{ onclick?: () => void; disabled?: boolean; getAttribute: (n: string) => string }> = [
    { getAttribute: (n: string) => n === 'data-memory-review' ? 'approve' : 'cand-1' },
  ];
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (selector: string) => selector === '[data-memory-review]' ? buttons : [] });
  buttons[0].onclick!();
  await flush();
  const posted = calls.find((call) => call.path === '/api/workbench/memory/review');
  assert.deepEqual(posted && posted.body, { candidate_id: 'cand-1', decision: 'approve', reviewer: 'user:alex', reason: '证据充分' });
  assert.deepEqual(refreshes, ['memory']);
  assert.ok(notices.some((note) => note.includes('已通过')));
});
test('a capped resolved-correction list offers to load the rest and then does', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: string[] = [];
  const pages = createResourcePages({
    api: async (path: string) => {
      calls.push(path);
      if (path.indexOf('status=decided&limit=10') >= 0) {
        return { corrections: [{ id: 'a', status: 'confirmed', outcome: 'incorrect', asset_ref: { member: 'experience', id: 'p1' } }], count: 1, total: 42 };
      }
      if (path.indexOf('status=decided&limit=50') >= 0) {
        return { corrections: [
          { id: 'a', status: 'confirmed', outcome: 'incorrect', asset_ref: { member: 'experience', id: 'p1' } },
          { id: 'b', status: 'dismissed', outcome: 'stale', asset_ref: { member: 'knowledge', id: 'k1' } },
        ], count: 2, total: 42 };
      }
      return { corrections: [], workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: unknown) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {}, scope: () => '',
  });
  const view = await pages.workflows();
  assert.ok(view.html.includes('查看更多（共 42 条）'));
  const rows = { innerHTML: '' };
  const more: { onclick?: () => void; disabled?: boolean; hidden?: boolean } = {};
  view.mounts[0]({ querySelector: (selector: string) => selector === '[data-decided-more]' ? more : selector === '[data-decided-rows]' ? rows : null,
    querySelectorAll: () => [] });
  more.onclick!();
  await flush();
  assert.ok(calls.some((path) => path.indexOf('status=decided&limit=50') >= 0));
  assert.match(rows.innerHTML, /经验 p1/u);
  assert.match(rows.innerHTML, /知识 k1/u);
  assert.equal(more.hidden, true, 'the offer disappears once the full list is shown');
});
test('a memory conflict is settled with a mandatory reason and the operator as actor', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const calls: Array<{ path: string; body?: unknown }> = [];
  const notices: string[] = [];
  let prompt = '这一条更新，保留它';
  const pages = createResourcePages({
    api: async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: init && init.body });
      if (path.indexOf('/api/workbench/resources?kind=memory') === 0) {
        return { items: [{ id: 'cand-9', content: 'use pnpm', kind: 'preference', scope: 'project:demo', source: 'agent', status: 'conflict_pending' }] };
      }
      return { items: [], workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: (m: string) => { notices.push(m); }, fail: () => {},
    scope: () => '', ask: () => prompt, operator: () => 'user:alex',
  });
  const view = await pages.memory();
  const buttons: Array<{ onclick?: () => void; disabled?: boolean; getAttribute: (n: string) => string }> = [
    { getAttribute: (n: string) => n === 'data-memory-conflict' ? 'supersede' : 'cand-9' },
  ];
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (selector: string) => selector === '[data-memory-conflict]' ? buttons : [] });
  buttons[0].onclick!();
  await flush();
  const posted = calls.find((call) => call.path === '/api/workbench/memory/conflicts/resolve');
  assert.deepEqual(posted && posted.body, { candidate_id: 'cand-9', resolution: 'supersede', actor: 'user:alex', reason: '这一条更新，保留它' });
  assert.ok(notices.some((note) => note.includes('已取代旧记忆')));
  // A blank reason is not a decision: nothing is written.
  calls.length = 0; prompt = '  ';
  buttons[0].disabled = false;
  buttons[0].onclick!();
  await flush();
  assert.equal(calls.filter((call) => call.path === '/api/workbench/memory/conflicts/resolve').length, 0);
  // Cancelling the prompt leaves the conflict untouched.
  prompt = null as unknown as string;
  buttons[0].onclick!();
  await flush();
  assert.equal(calls.filter((call) => call.path === '/api/workbench/memory/conflicts/resolve').length, 0);
});
test('a conflict names the records it overrides before asking for a decision', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const pages = createResourcePages({
    api: async (path: string) => {
      if (path.indexOf('/api/workbench/resources?kind=memory') === 0) {
        return { items: [
          { id: 'cand-x', content: 'use tabs', kind: 'preference', scope: 'project:demo', source: 'agent', status: 'conflict_pending',
            conflict_peers: [{ id: 'cand-y', kind: 'candidate', content: 'use spaces', committed: true, status: 'active' }, { id: 'mem-7', kind: 'memory', content: 'tabs were banned', status: 'active' }] },
          { id: 'cand-z', content: 'no rivals', kind: 'preference', scope: 'project:demo', source: 'agent', status: 'conflict_pending', conflict_peers: [] },
        ] };
      }
      return { items: [], workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: {}, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {}, scope: () => '',
  });
  const view = await pages.memory();
  assert.ok(view.html.includes('候选（已生效） use spaces（正在生效）'), 'a committed rival is labelled as live');
  assert.ok(view.html.includes('已有记忆 tabs were banned（正在生效）'), 'a live memory is named and marked live');
  // A conflict without resolvable peers still asks, but does not invent a list.
  assert.ok(view.html.includes('需人工裁决</div>'));
});
test('a governed ledger memory is shown read-only instead of with buttons that cannot work', async () => {
  const esc = (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const pages = createResourcePages({
    api: async (path: string) => {
      if (path.indexOf('/api/workbench/resources?kind=memory') === 0) {
        return { items: [
          { id: 'live-1', content: 'the repo uses pnpm', kind: 'preference', scope: 'project:demo', source: 'src-1', status: 'active', governed: true, proposed_by: 'user:alex' },
          { id: 'studio-1', content: 'a studio note', kind: 'working', scope: 'project:demo', source: 'studio', status: 'active' },
        ] };
      }
      return { items: [], workflows: [], runs: [], status: [] };
    },
    presentation: { icon: (n: string) => `<svg>${n}</svg>`, esc, head: (t: string, _s: string, r: string) => `<h2>${t}</h2>${r}`,
      emptyState: (t: string) => `<p>${t}</p>`, asideBlock: () => '', catalogRows: () => '', countChip: (n: number) => String(n),
      label: (_l: unknown, _s: unknown, f: unknown) => f, STATUS_LABELS: { active: '生效中' }, shortTime: () => '', pill: (t: string) => `<span>${t}</span>` },
    editors: { memory: () => {}, workflow: () => {} }, refresh: () => {}, notify: () => {}, fail: () => {}, scope: () => '',
  });
  const view = await pages.memory();
  assert.ok(view.html.includes('the repo uses pnpm'), 'live memories are visible at all');
  assert.ok(view.html.includes('受治理的记忆'));
  assert.ok(!view.html.includes('data-memory-edit="live-1"'), 'no dead edit action on a governed row');
  assert.ok(!view.html.includes('data-memory-retire="live-1"'), 'no dead retire action on a governed row');
  // Studio rows keep the actions that do work for them.
  assert.ok(view.html.includes('data-memory-edit="studio-1"'));
  assert.ok(view.html.includes('data-memory-retire="studio-1"'));
});
