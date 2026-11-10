import assert from 'node:assert/strict';
import test from 'node:test';
import { createModePages } from '../workbench/mode-pages.js';

// A narrow context is enough to exercise the three-mode pages in Node: the
// module must not reach into the app shell for anything else.
function context(overrides = {}) {
  const calls = [];
  const base = {
    state: { page: 'home', settings: null, composer: { folder: '' }, execution: {}, folderGroups: [] },
    api: (path) => { calls.push(path); return Promise.resolve({ order: [], labels: {}, buckets: {}, tasks: [] }); },
    toast: () => {}, fail: () => {}, go: () => {}, openTask: () => {},
    importNativeSession: () => Promise.resolve({}), mountAgentWorkspace: () => {},
    workspacePathOf: () => '/ws', folderNameOf: () => 'ws', renderFolderTree: () => {},
    asideBlock: (title) => '<aside>' + title + '</aside>', openInlineOn: () => {}, dismissInline: () => {},
    settled: (p, fallback) => Promise.resolve(p).catch(() => fallback),
    icon: () => '<i></i>', esc: (v) => String(v ?? ''), label: (_m, v) => String(v ?? ''),
    pill: (v) => v, head: (t) => t, emptyState: (t) => t,
    countChip: (v) => String(v), host: { setTimeout: () => 0, clearTimeout: () => {} }, doc: null,
    writePilotSession: () => {}
  };
  return { ...base, ...overrides, calls };
}

test('createModePages exposes exactly the four mode views', () => {
  const pages = createModePages(context());
  assert.deepEqual(Object.keys(pages).sort(), ['newSessionDrawer', 'viewHome', 'viewMyTasks', 'viewPilot']);
});

test('the new-session form lazily loads configured Craft models', async () => {
  const added: Array<{ text: string; value: string }> = [];
  const provider = { value: 'craft', onchange: null as null | (() => void) };
  const model = { value: '', options: [{ value: '' }], add: (option: { text: string; value: string }) => { added.push(option); model.options.push(option as never); } };
  const card = { querySelector: (selector: string) => selector === '[data-field="provider"]' ? provider : selector === '[data-field="model"]' ? model : null };
  const calls: string[] = [];
  const pages = createModePages(context({
    api: (path: string) => { calls.push(path); return Promise.resolve({ models: [{ id: 'm1', name: 'Model One', configured: true }, { id: 'm2', name: 'Unconfigured', configured: false }] }); },
  }));
  const previousOption = globalThis.Option;
  (globalThis as any).Option = class { text: string; value: string; constructor(text: string, value: string) { this.text = text; this.value = value; } };
  try {
    pages.newSessionDrawer('').mount(card as never);
    await new Promise(setImmediate);
    assert.deepEqual(calls, ['/api/config/models']);
    assert.deepEqual(added.map(item => item.value), ['m1']);
    assert.equal(model.value, 'm1');
  } finally {
    (globalThis as any).Option = previousOption;
  }
});

test('viewHome mounts the agent workspace inside the shell', async () => {
  let mounted = 0;
  const pages = createModePages(context({ mountAgentWorkspace: () => { mounted += 1; } }));
  const view = await pages.viewHome();
  assert.match(view.html, /home-agent/u);
  assert.match(view.aside, /工作会话/u);
  assert.equal(view.mounts.length, 1);
  const root = { querySelector: (sel) => sel === '#agent-workspace' ? { isConnected: true } : null };
  view.mounts[0](root);
  assert.equal(mounted, 1);
});

test('viewHome shows a hot-plug Mod/Plugin toolbar and a collapsible raw terminal', async () => {
  const unmountPlugin = { getAttribute: () => 'p1', onclick: null as null | (() => void) };
  const toolbar = { innerHTML: '', querySelectorAll: (s: string) => (s === '[data-unmount-plugin]' ? [unmountPlugin] : []) };
  const terminal = { textContent: '加载中…' };
  const agentRoot = { isConnected: true };
  const root = { querySelector: (s: string) => s === '#agent-workspace' ? agentRoot : s === '#session-toolbar' ? toolbar : s === '#terminal-out' ? terminal : null };
  const calls: string[] = [];
  let mounted = 0;
  const pages = createModePages(context({
    state: { page: 'home', settings: null, composer: { folder: 'ws-1', models: [] }, execution: {}, folderGroups: [] },
    mountAgentWorkspace: () => { mounted += 1; },
    api: (path: string) => {
      calls.push(path);
      if (path.includes('/mods/list')) return Promise.resolve({ items: [{ id: 'm1', name: 'no-hardcode', status: 'active', enabled: true, version: 2 }, { id: 'm2', name: 'disabled-mod', status: 'active', enabled: false, version: 1 }, { id: 'm3', name: 'legacy-mod', status: 'active', enabled: true }] });
      if (path.includes('/workspaces/ws-1/plugins')) return Promise.resolve({ bindings: [{ plugin_id: 'p1', status: 'enabled' }, { plugin_id: 'p3', status: 'enabled' }, { plugin_id: 'p4', status: 'enabled' }] });
      if (path.includes('/plugins')) return Promise.resolve({ items: [{ id: 'p1', name: 'codex-plugin', package_version: '1.2.3' }, { id: 'p2', name: 'idle-plugin' }, { id: 'p3', name: 'guarded-plugin', runtime_status: 'unsupported', unsupported_reason: 'Hook 未接入' }, { id: 'p4', name: 'unavailable-plugin', runtime_status: 'unsupported' }] });
      if (path.includes('/host-runs')) return Promise.resolve({ runs: [] });
      return Promise.resolve({});
    },
  }));
  const view = await pages.viewHome();
  assert.match(view.html, /id="session-toolbar"/u);
  assert.match(view.html, /id="dual-terminal"/u);
  view.mounts[0](root as never);
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(mounted, 1);
  assert.match(toolbar.innerHTML, /Mod: no-hardcode/u);
  assert.match(toolbar.innerHTML, /v2/u);
  assert.match(toolbar.innerHTML, /Mod: legacy-mod/u);
  assert.doesNotMatch(toolbar.innerHTML, /disabled-mod/u);
  // Only a plugin enabled for this workspace counts as mounted.
  assert.match(toolbar.innerHTML, /Plugin: codex-plugin/u);
  assert.match(toolbar.innerHTML, /codex-plugin · v1\.2\.3/u);
  assert.match(toolbar.innerHTML, /guarded-plugin · 不可用：Hook 未接入/u);
  assert.match(toolbar.innerHTML, /unavailable-plugin · 不可用：请查看插件详情/u);
  assert.match(toolbar.innerHTML, /不代表本会话已生效/u);
  assert.match(toolbar.innerHTML, /配置工作区：ws-1/u);
  assert.match(toolbar.innerHTML, /可能与当前会话的目录不同/u);
  assert.match(toolbar.innerHTML, /在配置工作区 ws-1 停用/u);
  assert.doesNotMatch(toolbar.innerHTML, /idle-plugin/u);
  unmountPlugin.onclick!();
  await new Promise<void>((r) => setImmediate(r));
  assert.ok(calls.some((c) => c === '/api/workspaces/ws-1/plugins/p1/disable'));
  assert.equal(terminal.textContent, '暂无命令执行事件');
});

test('plugin advanced tools call through the plugin-bound workspace route', async () => {
  const requestButton = { getAttribute: () => '0', disabled: false, onclick: null as null | (() => void) };
  const resultSlot = { innerHTML: '', textContent: '' };
  const advancedHost = { hidden: true, innerHTML: '', querySelectorAll: (selector: string) => selector === '[data-plugin-tool]' ? [requestButton] : [],
    querySelector: (selector: string) => selector === '.plugin-tool-result' ? resultSlot : null };
  const toolbar = { innerHTML: '', querySelectorAll: () => [] };
  const calls: Array<{ path: string; options?: Record<string, unknown> }> = [];
  const pages = createModePages(context({
    state: { page: 'home', settings: null, composer: { folder: 'ws-1' }, execution: {}, folderGroups: [] },
    host: { prompt: () => 'release checklist', setTimeout: () => 0, clearTimeout: () => {} },
    api: (path: string, options?: Record<string, unknown>) => {
      calls.push({ path, options });
      if (path.includes('/contributions')) return Promise.resolve({ contributions: [{ plugin_id: 'plugin-1', source: 'Memory helper', advanced_tools: [{ id: 'search-memory', title: '搜索记忆', tool: 'craft_memory_search', supported: true }] }] });
      if (options?.method === 'POST') return Promise.resolve({ result: { items: [] } });
      if (path.includes('/workspaces/ws-1/plugins')) return Promise.resolve({ bindings: [{ plugin_id: 'plugin-1', status: 'enabled' }] });
      return Promise.resolve({ items: [] });
    },
  }));
  const view = await pages.viewHome();
  view.mounts[0]({ querySelector: (selector: string) => selector === '#agent-workspace' ? {} : selector === '#session-toolbar' ? toolbar
    : selector === '#plugin-advanced-tools' ? advancedHost : selector === '#terminal-out' ? { textContent: '' } : null } as never);
  await new Promise<void>(resolve => setImmediate(resolve));
  requestButton.onclick!();
  await new Promise<void>(resolve => setImmediate(resolve));
  const request = calls.find(call => call.options?.method === 'POST');
  assert.equal(request?.path, '/api/workbench/plugins/plugin-1/tools/search-memory/call');
  assert.deepEqual(request?.options?.body, { workspace_id: 'ws-1', args: { query: 'release checklist', scope: 'workspace:ws-1', max_items: 5 } });
});

test('the extension toolbar does not hide enabled plugins after unrelated catalog entries', async () => {
  const toolbar = { innerHTML: '', querySelectorAll: () => [] };
  const pages = createModePages(context({
    state: { page: 'home', settings: null, composer: { folder: 'ws-1' }, execution: {}, folderGroups: [] },
    api: (path: string) => path.includes('/mods/list') ? Promise.resolve({ items: [] })
      : path.includes('/workspaces/ws-1/plugins') ? Promise.resolve({ bindings: [{ plugin_id: 'p7', status: 'enabled' }] })
      : path.includes('/plugins') ? Promise.resolve({ items: Array.from({ length: 7 }, (_, i) => ({ id: `p${i + 1}`, name: `plugin-${i + 1}` })) })
      : Promise.resolve({ runs: [] }),
  }));
  const view = await pages.viewHome();
  view.mounts[0]({ querySelector: (s: string) => s === '#agent-workspace' ? {} : s === '#session-toolbar' ? toolbar : null } as never);
  await new Promise<void>(r => setImmediate(r));
  assert.match(toolbar.innerHTML, /Plugin: plugin-7/u);
  assert.doesNotMatch(toolbar.innerHTML, /本会话挂载/u);
});

test('the extension toolbar reports unavailable bindings rather than claiming none are enabled', async () => {
  const toolbar = { innerHTML: '', querySelectorAll: () => [] };
  const pages = createModePages(context({
    state: { page: 'home', settings: null, composer: { folder: 'ws-1' }, execution: {}, folderGroups: [] },
    api: (path: string) => path.includes('/workspaces/ws-1/plugins') ? Promise.reject(new Error('offline')) : Promise.resolve({ items: [], runs: [] }),
  }));
  const view = await pages.viewHome();
  view.mounts[0]({ querySelector: (s: string) => s === '#agent-workspace' ? {} : s === '#session-toolbar' ? toolbar : null } as never);
  await new Promise<void>(r => setImmediate(r));
  assert.match(toolbar.innerHTML, /信息暂不可用/u);
  assert.doesNotMatch(toolbar.innerHTML, /未启用插件/u);
});

test('enabled plugin bindings absent from the catalog remain visible', async () => {
  const toolbar = { innerHTML: '', querySelectorAll: () => [] };
  const pages = createModePages(context({
    state: { page: 'home', settings: null, composer: { folder: 'ws-1' }, execution: {}, folderGroups: [] },
    api: (path: string) => Promise.resolve(path.includes('/workspaces/ws-1/plugins')
      ? { bindings: [{ plugin_id: 'missing-plugin', status: 'enabled' }, { plugin_id: 'unnamed-plugin', status: 'enabled' }] }
      : path.includes('/mods/list') ? { items: [{ id: 'unnamed-mod', enabled: true }] }
      : path.includes('/plugins') ? { items: [{ id: 'unnamed-plugin' }] } : { runs: [] }),
  }));
  const view = await pages.viewHome();
  view.mounts[0]({ querySelector: (s: string) => s === '#agent-workspace' ? {} : s === '#session-toolbar' ? toolbar : null } as never);
  await new Promise<void>(r => setImmediate(r));
  assert.match(toolbar.innerHTML, /missing-plugin/u);
  assert.match(toolbar.innerHTML, /详情不可用/u);
  assert.match(toolbar.innerHTML, /unnamed-plugin/u);
  assert.match(toolbar.innerHTML, /unnamed-mod/u);
  assert.doesNotMatch(toolbar.innerHTML, /未启用插件/u);
});

test('the extension toolbar distinguishes an empty workspace from no selection', async () => {
  for (const folder of ['', 'ws-1']) {
    const toolbar = { innerHTML: '', querySelectorAll: () => [] };
    const pages = createModePages(context({
      state: { page: 'home', settings: null, composer: { folder }, execution: {}, folderGroups: [] },
      api: () => Promise.resolve({ items: [], bindings: [], runs: [] }),
    }));
    const view = await pages.viewHome();
    view.mounts[0]({ querySelector: (s: string) => s === '#agent-workspace' ? {} : s === '#session-toolbar' ? toolbar : null } as never);
    await new Promise<void>(r => setImmediate(r));
    assert.match(toolbar.innerHTML, folder ? /本工作区未启用插件/u : /未选择工作区/u);
  }
});

test('viewMyTasks renders the seven-state board and wires a console-local drawer', async () => {
  const ctx = context();
  const pages = createModePages(ctx);
  const view = await pages.viewMyTasks();
  assert.ok(view.html);
  assert.ok(Array.isArray(view.mounts));
  // With no tasks the board still renders an empty state, never a blank page.
  assert.match(view.html, /还没有任务/u);
  assert.doesNotMatch(view.html, /undefined/u);
  assert.equal(view.actions[0].label, '新建任务');
});

test('viewPilot is a minimal superagent surface with internal roles hidden in details', async () => {
  const pages = createModePages(context());
  const view = await pages.viewPilot();
  assert.match(view.html, /pilot-shell/u);
  assert.match(view.html, /自动编排/u);
  assert.match(view.html, /pilot-composer/u);
  assert.doesNotMatch(view.html, /Mainer|Router|Worker|Reviewer/u);
  assert.doesNotMatch(view.html, /领航员模型/u);
  assert.doesNotMatch(view.html, /改派执行模板/u);
  assert.match(view.aside, /领航员边界/u);
  assert.doesNotMatch(view.aside, /Mainer|Router|Worker|Reviewer/u);
});

test('viewPilot flight strip renders four stages and drills into a stage log', async () => {
  const nodes: Record<string, any> = {
    '#pilot-thread': { innerHTML: '' }, '#pilot-form': {}, '#pilot-input': { value: '' },
    '#pilot-send': { disabled: true }, '#pilot-queue-state': { textContent: '' },
    '#pilot-provider': { value: 'auto' }, '#pilot-permission': { value: 'auto' },
    '#pilot-settings': { hidden: true }, '#pilot-plus': { setAttribute() {} },
    '#flight-strip': { innerHTML: '', querySelectorAll: (sel: string) => sel === '[data-flight]' ? flightNodes : [] },
    '#flight-drawer': { innerHTML: '', hidden: true, querySelector: () => null },
  };
  const flightNodes = ['coordination', 'assignment', 'worker', 'review'].map((key) => ({
    getAttribute: () => key, onclick: null as null | (() => void),
  }));
  const root = { isConnected: true, querySelector: (s: string) => nodes[s] ?? null };
  const status = {
    turns: [{ id: 't1', task_ids: ['task-1'], input: 'x', workspace_resolution: { source: 'session' } }],
    tasks: [{ id: 'task-1', title: 'x', goal: 'x', workspace_id: 'ws-1' }],
    routes: [{ task_id: 'task-1', queue_state: 'running' }], reviews: [],
    results: [], progress: { counts: { running: 1, queued: 0 }, result_facts: {} },
  };
  const pages = createModePages(context({
    state: { page: 'pilot', settings: null, composer: { folder: '', models: [] }, execution: {}, folderGroups: [], pilotSessionId: 's1' },
    host: { setTimeout: () => 0, clearTimeout: () => {} },
    api: (path: string) => Promise.resolve(path.endsWith('/status') ? status : { order: [], labels: {}, buckets: {}, tasks: [] }),
  }));
  const view = await pages.viewPilot();
  assert.match(view.html, /id="flight-strip"/u);
  assert.match(view.html, /id="flight-drawer"/u);
  view.mounts[0](root as never);
  await new Promise<void>((r) => setImmediate(r));
  assert.match(nodes['#flight-strip'].innerHTML, /协调中/u);
  assert.match(nodes['#flight-strip'].innerHTML, /Reviewer 审阅/u);
  flightNodes.find((n) => n.getAttribute() === 'assignment')!.onclick!();
  assert.match(nodes['#flight-drawer'].innerHTML, /目录来源：继承会话/u);
  // Click the worker stage to open the drill-down drawer.
  const worker = flightNodes.find((n) => n.getAttribute() === 'worker')!;
  worker.onclick!();
  assert.equal(nodes['#flight-drawer'].hidden, false);
  assert.match(nodes['#flight-drawer'].innerHTML, /运行 1/u);
  assert.match(nodes['#flight-drawer'].innerHTML, /在工作台打开任务/u);
});

test('flight drawer drills into the task in the workbench', async () => {
  const opened: string[] = [];
  const drawer = { innerHTML: '', hidden: true, querySelector: (selector: string) =>
    selector === '[data-flight-open]' ? openButton : null };
  const openButton = { getAttribute: () => 'task-drill', onclick: null as null | (() => void) };
  const flightNodes = ['coordination', 'assignment', 'worker', 'review'].map((key) => ({
    getAttribute: () => key, onclick: null as null | (() => void),
  }));
  const nodes: Record<string, any> = {
    '#pilot-thread': { innerHTML: '' }, '#pilot-form': {}, '#pilot-input': { value: '' },
    '#pilot-send': { disabled: true }, '#pilot-queue-state': { textContent: '' },
    '#pilot-provider': { value: 'auto' }, '#pilot-permission': { value: 'auto' },
    '#pilot-settings': { hidden: true }, '#pilot-plus': { setAttribute() {} },
    '#flight-strip': { innerHTML: '', querySelectorAll: () => flightNodes }, '#flight-drawer': drawer,
  };
  const status = {
    turns: [{ id: 't1', task_ids: ['task-drill'], input: 'x' }],
    tasks: [{ id: 'task-drill', title: '修复', goal: '修复', workspace_id: 'ws-1' }],
    routes: [{ task_id: 'task-drill', queue_state: 'running' }], reviews: [], results: [],
    progress: { counts: { running: 1, queued: 0 }, result_facts: {} },
  };
  const pages = createModePages(context({
    state: { page: 'pilot', settings: null, composer: { folder: '', models: [] }, execution: {}, folderGroups: [], pilotSessionId: 's1' },
    host: { setTimeout: () => 0, clearTimeout: () => {} }, openTask: (id: string) => opened.push(id),
    api: (path: string) => Promise.resolve(path.endsWith('/status') ? status : { order: [], labels: {}, buckets: {}, tasks: [] }),
  }));
  const view = await pages.viewPilot();
  view.mounts[0]({ isConnected: true, querySelector: (s: string) => nodes[s] ?? null } as never);
  await new Promise<void>((r) => setImmediate(r));
  flightNodes[2].onclick!();
  assert.equal(drawer.hidden, false);
  assert.ok(openButton.onclick, 'the drawer wired a real drill-down action');
  openButton.onclick!();
  assert.deepEqual(opened, ['task-drill']);
});

test('viewPilot shows where the working directory came from and flags duplicate work', async () => {
  const nodes: Record<string, any> = {
    '#pilot-thread': { innerHTML: '' }, '#pilot-form': {}, '#pilot-input': { value: '' },
    '#pilot-send': { disabled: true }, '#pilot-queue-state': { textContent: '' },
    '#pilot-provider': { value: 'auto' }, '#pilot-permission': { value: 'auto' },
    '#pilot-settings': { hidden: true }, '#pilot-plus': { setAttribute() {} },
    '#flight-strip': { innerHTML: '', querySelectorAll: () => [] },
    '#flight-drawer': { innerHTML: '', hidden: true },
  };
  const root = { isConnected: true, querySelector: (s: string) => nodes[s] ?? null };
  const status = {
    turns: [{ id: 't1', task_ids: ['task-1'], input: '修复登录',
      workspace_resolution: { source: 'intent', reason: '意图里提到了目录名', confidence: 0.77 },
      conflicts: [{ task_id: 'task-old', title: '修复登录', similarity: 0.8 }] }],
    tasks: [{ id: 'task-1', title: '修复登录', goal: '修复登录', workspace_id: 'ws-1' }],
    routes: [{ task_id: 'task-1', queue_state: 'queued' }], reviews: [],
    results: [], progress: { counts: { running: 0, queued: 1 }, result_facts: {} },
  };
  const pages = createModePages(context({
    state: { page: 'pilot', settings: null, composer: { folder: '', models: [] }, execution: {}, folderGroups: [], pilotSessionId: 's1' },
    host: { setTimeout: () => 0, clearTimeout: () => {} },
    api: (path: string) => Promise.resolve(path.endsWith('/status') ? status : { order: [], labels: {}, buckets: {}, tasks: [] }),
  }));
  const view = await pages.viewPilot();
  view.mounts[0](root as never);
  await new Promise<void>((r) => setImmediate(r));
  assert.match(nodes['#pilot-thread'].innerHTML, /已有 1 个未完成任务的目标和这次重合/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /最高重合 80%/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /修复登录/u);
});

test('viewPilot renders structured clarification cards when the Coordinator needs a choice', async () => {
  let submitted = 0;
  const nodes: Record<string, any> = {
    '#pilot-thread': { innerHTML: '' }, '#pilot-form': { onsubmit: null },
    '#pilot-input': { value: '重构前端', disabled: false, oninput: null, onkeydown: null },
    '#pilot-send': { disabled: false }, '#pilot-queue-state': { textContent: '' },
    '#pilot-provider': { value: 'auto' }, '#pilot-permission': { value: 'auto' },
    '#pilot-settings': { hidden: true }, '#pilot-plus': { setAttribute() {} },
    '#flight-strip': { innerHTML: '', querySelectorAll: () => [] },
    '#flight-drawer': { innerHTML: '', hidden: true },
    '#pilot-clarify': { innerHTML: '', hidden: true, querySelectorAll: () => [], querySelector: () => null },
  };
  const root = { isConnected: true, querySelector: (s: string) => nodes[s] ?? null };
  const pages = createModePages(context({
    state: { page: 'pilot', settings: null, composer: { folder: '', models: [] }, execution: {}, folderGroups: [], pilotSessionId: 's-clarify' },
    host: { setTimeout: () => 0, clearTimeout: () => {} },
    api: (path: string) => {
      if (path.endsWith('/turns/auto')) { submitted += 1; return Promise.resolve({ status: 'blocked', questions: [
        { title: '选择目标工程', questions: ['要重构哪个前端？'], options: ['Admin-UI', 'H5-Portal'] },
      ] }); }
      return Promise.resolve({ order: [], labels: {}, buckets: {}, tasks: [], turns: [], routes: [], reviews: [], results: [], progress: { counts: {}, result_facts: {} } });
    },
  }));
  const view = await pages.viewPilot();
  assert.match(view.html, /id="pilot-clarify"/u);
  view.mounts[0](root as never);
  await new Promise<void>((r) => setImmediate(r));
  nodes['#pilot-form'].onsubmit({ preventDefault() {} });
  await new Promise<void>((r) => setImmediate(r));
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(submitted, 1);
  assert.equal(nodes['#pilot-clarify'].hidden, false);
  assert.match(nodes['#pilot-clarify'].innerHTML, /Admin-UI/u);
  assert.match(nodes['#pilot-clarify'].innerHTML, /H5-Portal/u);
});

test('directory clarification resubmits original input with the selected workspace identity', async () => {
  const option: any = { getAttribute: () => 'ws-1', onclick: null, classList: { add() {}, remove() {} }, disabled: false };
  const confirm: any = { onclick: null }, skip: any = { onclick: null };
  const clarify: any = { innerHTML: '', hidden: true, querySelectorAll: (s: string) => s === '[data-clarify-workspace]' ? [option] : [], querySelector: (s: string) => s === '#clarify-submit' ? confirm : s === '#clarify-skip' ? skip : null };
  const input = '工作目录：/unknown，修复 /api/foo'; const bodies: any[] = [];
  const nodes: Record<string, any> = { '#pilot-thread': { innerHTML: '' }, '#pilot-form': {}, '#pilot-input': { value: input }, '#pilot-send': { disabled: false }, '#pilot-queue-state': {}, '#pilot-provider': { value: 'auto' }, '#pilot-permission': { value: 'auto' }, '#pilot-settings': {}, '#pilot-plus': { setAttribute() {} }, '#pilot-clarify': clarify };
  const pages = createModePages(context({ state: { page: 'pilot', settings: null, composer: { folder: '', models: [] }, execution: {}, folderGroups: [], pilotSessionId: 's' },
    api: (path: string, opts: any) => { if (path.endsWith('/turns/auto')) { bodies.push(opts.body); return Promise.resolve({ status: 'blocked', questions: [{ title: '选择目录', questions: ['请选择'], workspace_options: [{ workspace_id: 'ws-1', root_path: '/known' }] }] }); } return Promise.resolve({ turns: [], tasks: [], routes: [], reviews: [], results: [], progress: { counts: {}, result_facts: {} } }); } }));
  const view = await pages.viewPilot(); view.mounts[0]({ isConnected: true, querySelector: (s: string) => nodes[s] ?? null } as never);
  nodes['#pilot-form'].onsubmit({ preventDefault() {} }); await new Promise<void>(r => setImmediate(r)); await new Promise<void>(r => setImmediate(r));
  assert.match(clarify.innerHTML, /\/known/u); confirm.onclick(); assert.equal(bodies.length, 1);
  nodes['#pilot-input'].value = input + '，补充测试'; option.onclick(); confirm.onclick();
  await new Promise<void>(r => setImmediate(r)); await new Promise<void>(r => setImmediate(r));
  assert.equal(bodies[1].input, input + '，补充测试'); assert.equal(bodies[1].workspace_id, undefined);
  assert.equal(nodes['#pilot-input'].value, input + '，补充测试');
  option.onclick(); confirm.onclick(); await new Promise<void>(r => setImmediate(r)); await new Promise<void>(r => setImmediate(r));
  assert.equal(bodies[2].input, input + '，补充测试'); assert.equal(bodies[2].workspace_id, 'ws-1');
});

test('viewPilot reconciles running Worker state instead of trusting a frozen render', async () => {
  const apiCalls: string[] = [];
  let statusCalls = 0;
  let pending: (() => void) | null = null;
  const nodes: Record<string, any> = {
    '#pilot-thread': { innerHTML: '', onclick: null },
    '#pilot-form': { onsubmit: null },
    '#pilot-input': { value: '', disabled: false, oninput: null, onkeydown: null },
    '#pilot-send': { disabled: true },
    '#pilot-queue-state': { textContent: '' },
    '#pilot-provider': { value: 'auto' },
    '#pilot-permission': { value: 'auto' },
    '#pilot-settings': { hidden: true },
    '#pilot-plus': { setAttribute() {} },
  };
  const root = { isConnected: true, querySelector: (selector: string) => nodes[selector] ?? null };
  const pages = createModePages(context({
    state: {
      page: 'pilot', settings: { workbench: { pilotConcurrency: 2 } }, composer: { folder: '', models: [{ id: 'm', configured: true }] },
      execution: {}, folderGroups: [], pilotSessionId: 'session-1',
    },
    host: { setTimeout: (fn: () => void) => { pending = fn; return 1; }, clearTimeout: () => { pending = null; } },
    api: (path: string) => {
      apiCalls.push(path);
      if (path.endsWith('/providers')) return Promise.resolve({ providers: [{ id: 'codex', status: 'available' }] });
      if (path.endsWith('/status')) {
        statusCalls += 1;
        if (statusCalls > 1) return Promise.resolve({
          turns: [{ id: 'turn-1', task_ids: ['task-1'], input: '做一件事' }],
          tasks: [{ id: 'task-1', title: '做一件事', goal: '做一件事' }],
          routes: [{ task_id: 'task-1', executor_template: 'codex', queue_state: 'finished',
            worker: { state: 'completed' } }],
          reviews: [{ turn_id: 'turn-1', verdict: 'pass', checks: [] }],
          progress: { counts: { running: 0, queued: 0, failed: 0, blocked: 0 } },
        });
        return Promise.resolve({
          turns: [{ id: 'turn-1', task_ids: ['task-1'], input: '做一件事' }],
          tasks: [{ id: 'task-1', title: '做一件事', goal: '做一件事' }],
          routes: [{ task_id: 'task-1', executor_template: 'codex', queue_state: 'running',
            worker: { state: 'started' } }],
          reviews: [],
          progress: { counts: { running: 1, queued: 0, failed: 0, blocked: 0 } },
        });
      }
      if (path.endsWith('/reconcile')) return Promise.resolve({
        turns: [{ id: 'turn-1', task_ids: ['task-1'], input: '做一件事' }],
        tasks: [{ id: 'task-1', title: '做一件事', goal: '做一件事' }],
        routes: [{ task_id: 'task-1', executor_template: 'codex', queue_state: 'finished',
          worker: { state: 'completed' } }],
        reviews: [{ turn_id: 'turn-1', verdict: 'pass', checks: [] }],
        progress: { counts: { running: 0, queued: 0, failed: 0, blocked: 0 } },
      });
      return Promise.resolve({ turns: [], tasks: [], routes: [], reviews: [],
        progress: { counts: { running: 0, queued: 0 } } });
    },
  }));
  const view = await pages.viewPilot();
  view.mounts[0](root);
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending !== null, true);
  const reconcileNow = pending!;
  pending = null;
  reconcileNow();
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(apiCalls.includes('/api/pilot/sessions/session-1/reconcile'));
  assert.match(nodes['#pilot-thread'].innerHTML, /已完成/u);
  assert.equal(pending, null);
});

test('viewPilot retries after a reconcile failure', async () => {
  let pending: (() => void) | null = null;
  const failures: Error[] = [];
  const nodes: Record<string, any> = {
    '#pilot-thread': { innerHTML: '', onclick: null },
    '#pilot-form': { onsubmit: null },
    '#pilot-input': { value: '', disabled: false, oninput: null, onkeydown: null },
    '#pilot-send': { disabled: true },
    '#pilot-queue-state': { textContent: '' },
    '#pilot-provider': { value: 'auto' },
    '#pilot-permission': { value: 'auto' },
    '#pilot-settings': { hidden: true },
    '#pilot-plus': { setAttribute() {} },
  };
  const root = { isConnected: true, querySelector: (selector: string) => nodes[selector] ?? null };
  const pages = createModePages(context({
    state: { page: 'pilot', settings: { workbench: { pilotConcurrency: 2 } }, composer: { folder: '', models: [] },
      execution: {}, folderGroups: [], pilotSessionId: 'session-1' },
    host: { setTimeout: (fn: () => void) => { pending = fn; return 1; }, clearTimeout: () => { pending = null; } },
    fail: (error: Error) => failures.push(error),
    api: (path: string) => {
      if (path.endsWith('/providers')) return Promise.resolve({ providers: [] });
      if (path.endsWith('/reconcile')) return Promise.reject(new Error('session unavailable'));
      return Promise.resolve({ turns: [], tasks: [], routes: [], reviews: [],
        progress: { counts: { running: 1, queued: 0 } } });
    },
  }));
  const view = await pages.viewPilot();
  view.mounts[0](root);
  await new Promise((resolve) => setImmediate(resolve));
  pending!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failures[0].message, 'session unavailable');
  assert.equal(pending !== null, true);
});

function pilotNodes() {
  const nodes: Record<string, any> = {
    '#pilot-thread': { innerHTML: '', onclick: null },
    '#pilot-form': { onsubmit: null },
    '#pilot-input': { value: '', disabled: false, oninput: null, onkeydown: null },
    '#pilot-send': { disabled: true },
    '#pilot-queue-state': { textContent: '' },
    '#pilot-provider': { value: 'auto' },
    '#pilot-permission': { value: 'auto' },
    '#pilot-settings': { hidden: true },
    '#pilot-plus': { setAttribute(name: string, value: string) { nodes['#pilot-plus'][name] = value; } },
  };
  return { isConnected: true, querySelector: (selector: string) => nodes[selector] ?? null };
}

async function flush(count = 8) {
  for (let i = 0; i < count; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

test('viewPilot creates a blocked Pilot session, exposes local controls and opens tasks', async () => {
  const calls: { path: string; body?: any }[] = [];
  const opened: string[] = [];
  const notices: string[] = [];
  const state = { page: 'pilot', settings: null, composer: { folder: 'project', models: [] },
    execution: {}, folderGroups: [], pilotSessionId: '' };
  const pages = createModePages(context({
    state, openTask: (id: string) => opened.push(id), toast: (message: string) => notices.push(message),
    api: (path: string, options?: any) => {
      calls.push({ path, body: options?.body });
      if (path.endsWith('/providers')) return Promise.reject(new Error('offline'));
      if (path.endsWith('/api/pilot/sessions')) return Promise.resolve({ session: { id: 'session-new' } });
      if (path.endsWith('/turns/auto')) return Promise.resolve({ status: 'blocked' });
      return Promise.resolve({ turns: [], tasks: [], routes: [], reviews: [], progress: { counts: {} } });
    },
  }));
  const view = await pages.viewPilot();
  const root = pilotNodes();
  view.mounts[0](root);
  root.querySelector('#pilot-form').onsubmit({ preventDefault() {} });
  await flush();
  assert.equal(calls.some((call) => call.path.endsWith('/turns/auto')), false);
  root.querySelector('#pilot-input').value = '  ';
  root.querySelector('#pilot-input').oninput();
  assert.equal(root.querySelector('#pilot-send').disabled, true);
  root.querySelector('#pilot-input').value = '做一件事';
  root.querySelector('#pilot-input').oninput();
  assert.equal(root.querySelector('#pilot-send').disabled, false);
  root.querySelector('#pilot-plus').onclick();
  assert.equal(root.querySelector('#pilot-settings').hidden, false);
  assert.equal(root.querySelector('#pilot-plus')['aria-expanded'], 'true');
  root.querySelector('#pilot-input').onkeydown({ key: 'Enter', shiftKey: true });
  root.querySelector('#pilot-input').onkeydown({ key: 'Enter', isComposing: true });
  let prevented = false;
  root.querySelector('#pilot-input').onkeydown({ key: 'Enter', preventDefault() { prevented = true; } });
  await flush();
  assert.equal(prevented, true);
  assert.ok(notices.some((message) => message.includes('澄清')));
  root.querySelector('#pilot-thread').onclick({ target: { closest: () => ({ getAttribute: () => 'task-1' }) } });
  root.querySelector('#pilot-thread').onclick({ target: { closest: () => null } });
  assert.deepEqual(opened, ['task-1']);
});

test('viewPilot submits the selected Worker and the configured Craft model', async () => {
  const calls: { path: string; body?: any }[] = [];
  const savedSessions: string[] = [];
  const state = { page: 'pilot', settings: { workbench: { pilotConcurrency: 1 } },
    composer: { folder: 'project', models: [{ id: 'model-1', configured: true }] },
    execution: {}, folderGroups: [], pilotSessionId: '' };
  const pages = createModePages(context({
    state,
    writePilotSession: (_storage: unknown, sessionId: string) => savedSessions.push(sessionId),
    api: (path: string, options?: any) => {
      calls.push({ path, body: options?.body });
      if (path.endsWith('/providers')) return Promise.resolve({ providers: [
        { id: 'codex', status: 'available' }, { id: 'plugin', status: 'plugin' }, { id: 'missing', status: 'not_found' },
      ] });
      if (path.endsWith('/api/pilot/sessions')) return Promise.resolve({ session: { id: 'session-new' } });
      if (path.endsWith('/turns/auto')) return Promise.resolve({ status: 'created' });
      return Promise.resolve({ turns: [], tasks: [], routes: [], reviews: [], progress: { counts: {} } });
    },
  }));
  const view = await pages.viewPilot();
  const root = pilotNodes();
  root.querySelector('#pilot-provider').value = 'codex';
  root.querySelector('#pilot-permission').value = 'ask';
  root.querySelector('#pilot-input').value = '做一件事';
  view.mounts[0](root);
  await flush();
  root.querySelector('#pilot-form').onsubmit({ preventDefault() {} });
  await flush();
  const auto = calls.find((call) => call.path.endsWith('/turns/auto'));
  const dispatch = calls.find((call) => call.path.endsWith('/dispatch'));
  assert.equal(auto?.body.executor, 'codex');
  assert.equal(auto?.body.permission, 'ask');
  // 领航员不借用工作台选的工作区；目录由 Coordinator 按意图识别。
  const session = calls.find((call) => call.path === '/api/pilot/sessions');
  assert.equal(session?.body.workspace_id, undefined);
  assert.equal(auto?.body.workspace_id, undefined);
  assert.deepEqual(dispatch?.body, { permission: 'ask', craft_model: 'model-1' });
  assert.deepEqual(savedSessions, ['session-new']);
});

test('newSessionDrawer validates the workspace and task goal for every provider', () => {
  const notices = [];
  const fields = { workspace: '', provider: 'claude', model: '', permission: 'ask', prompt: '' };
  const doc = {
    querySelector: () => ({
      querySelector: (sel) => {
        const key = /data-field="([^"]+)"/u.exec(sel)?.[1];
        return key ? { get value() { return fields[key] ?? ''; } } : null;
      }
    })
  };
  const pages = createModePages(context({ doc, toast: (m, bad) => notices.push({ m, bad }) }));
  const drawer = pages.newSessionDrawer('/project');
  assert.match(drawer.html, /data-field="provider"/u);
  const create = drawer.actions.find((a) => a.label === '新建');
  assert.ok(create);
  create.run();
  assert.match(notices[0].m, /工作区路径/u);
  fields.workspace = '/project';
  create.run();
  assert.match(notices[1].m, /任务目标/u);
});

function drawerHarness(fields: Record<string, string>, overrides: any = {}) {
  const notices: string[] = [];
  const opened: string[] = [];
  const calls: { path: string; body?: any }[] = [];
  const doc = {
    querySelector: () => ({
      querySelector: (selector: string) => {
        const key = /data-field="([^"]+)"/u.exec(selector)?.[1];
        return key ? { value: fields[key] ?? '' } : null;
      },
      querySelectorAll: () => [],
    }),
  };
  const state = { page: 'tasks', settings: null, composer: { folder: '', models: [{ id: 'model', configured: true }] },
    execution: {}, folderGroups: [{ key: 'known' }], ...overrides.state };
  const pages = createModePages(context({
    state, doc, host: { crypto: { randomUUID: () => 'operation-1' } },
    toast: (message: string) => notices.push(message),
    openTask: (id: string) => opened.push(id),
    openInlineOn: () => {}, dismissInline: () => notices.push('dismissed'),
    renderFolderTree: () => notices.push('tree'),
    api: (path: string, options?: any) => {
      calls.push({ path, body: options?.body });
      if (overrides.reject && path.includes(overrides.reject)) return Promise.reject(new Error('api failed'));
      if (path === '/api/tasks') return Promise.resolve({ task: { id: 'task-1' } });
      if (path.includes('/agent-sessions') && !path.endsWith('/turns')) return Promise.resolve({ link: { id: 'link-1' } });
      return Promise.resolve({ ok: true });
    },
    ...overrides,
  }));
  return { notices, opened, calls, pages };
}

test('newSessionDrawer cancels and creates each supported tool', async () => {
  const cancel = drawerHarness({});
  const cancelDrawer = cancel.pages.newSessionDrawer('/project');
  cancelDrawer.actions[0].run();
  assert.ok(cancel.notices.includes('dismissed'));
  assert.match(cancelDrawer.html, /<option value="model" selected>/u);

  const cases: { provider: string; prompt: string; expected: string[] }[] = [
    { provider: 'codex', prompt: '先做这个', expected: ['/api/tasks', '/api/workbench/agent-sessions', '/api/workbench/agent-sessions/link-1/turns'] },
    { provider: 'craft', prompt: '先做这个', expected: ['/api/tasks', '/api/tasks/task-1/messages'] },
    { provider: 'claude', prompt: '先做这个', expected: ['/api/tasks', '/api/workbench/claude-runs'] },
    { provider: 'dsh', prompt: '先做这个', expected: ['/api/tasks', '/api/workbench/dsh-runs'] },
  ];
  for (const testCase of cases) {
    const harness = drawerHarness({ workspace: '/project', provider: testCase.provider, model: '', permission: 'full', prompt: testCase.prompt });
    const drawer = harness.pages.newSessionDrawer('/project');
    drawer.actions[1].run();
    await flush();
    assert.deepEqual(harness.calls.map((call) => call.path), testCase.expected);
    assert.deepEqual(harness.opened, ['task-1']);
  }

  const missingGoal = drawerHarness({ workspace: '/project', provider: 'codex', model: '', permission: 'ask', prompt: '' });
  missingGoal.pages.newSessionDrawer('/project').actions[1].run();
  assert.deepEqual(missingGoal.calls, []);
  assert.ok(missingGoal.notices.some((message) => message.includes('任务目标')));
});

test('newSessionDrawer blocks missing models and reports API failure', async () => {
  const missing = drawerHarness({ workspace: '/project', provider: 'craft', model: '', permission: 'ask', prompt: '先做这个' },
    { state: { composer: { folder: '', models: [] } } });
  missing.pages.newSessionDrawer('/project').actions[1].run();
  assert.ok(missing.notices.some((message) => message.includes('Craft 模型')));

  const failureNotices: string[] = [];
  const failed = drawerHarness({ workspace: '/project', provider: 'craft', model: 'model', permission: 'auto', prompt: '先做这个' },
    { reject: '/messages', fail: (error: Error) => failureNotices.push(error.message) });
  failed.pages.newSessionDrawer('/project').actions[1].run();
  await flush();
  assert.ok(failureNotices.includes('api failed'), JSON.stringify({ failureNotices, paths: failed.calls.map((x) => x.path) }));
});

test('viewMyTasks wires task rows and console-local drawer', async () => {
  const opened: string[] = [];
  const drawers: string[] = [];
  const state = { page: 'tasks', settings: null, composer: { folder: '' }, execution: {}, folderGroups: [{ key: 'known' }] };
  const pages = createModePages(context({
    state, openTask: (id: string) => opened.push(id), openInlineOn: (_page, drawer: any) => drawers.push(drawer.title),
    api: () => Promise.resolve({
      order: ['running', 'unknown', 'completed', 'failed', 'awaiting_approval', 'queued'],
      labels: { running: '执行中' },
      buckets: {
        running: [{ id: 'task-1', title: '任务', reason: '执行中', state: 'running', workspace_id: 'known' }],
        unknown: [{ id: 'task-2', state: 'unknown' }],
        completed: [{ id: 'task-3', state: 'completed' }],
        failed: [{ id: 'task-4', state: 'failed' }],
        awaiting_approval: [{ id: 'task-5', state: 'awaiting_approval' }],
        queued: [{ id: 'task-6', state: 'queued' }],
      },
    }),
  }));
  const view = await pages.viewMyTasks();
  const buttons: Record<string, any[]> = {
    '[data-board-open]': [{ getAttribute: () => 'task-1' }],
    '[data-board-new-session]': [{ getAttribute: () => 'known' }, { getAttribute: () => 'missing' }],
  };
  const root = { querySelectorAll: (selector: string) => buttons[selector] ?? [] };
  view.mounts[0](root);
  buttons['[data-board-open]'][0].onclick();
  buttons['[data-board-new-session]'][0].onclick();
  buttons['[data-board-new-session]'][1].onclick();
  view.actions[0].run();
  assert.deepEqual(opened, ['task-1']);
  assert.equal(drawers.length, 3);
  assert.equal(state.composer.folder, '');
});

test('viewPilot renders result cards with evidence, acceptance and final review', async () => {
  const adoptionCalls: Array<{ path: string; body?: unknown }> = [];
  const pages = createModePages(context({
    state: { page: 'pilot', settings: null, composer: { folder: '' }, execution: {}, folderGroups: [], pilotSessionId: 'session-edge' },
    esc: (value: unknown) => String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;'),
    api: (path: string, init?: unknown) => {
      if (path === '/api/workbench/pilot/adoption') { adoptionCalls.push({ path, body: init && (init as { body?: unknown }).body }); return Promise.resolve({}); }
      if (path.endsWith('/providers')) return Promise.resolve({});
      return Promise.resolve({
        turns: [{ id: 'turn-edge', task_ids: ['task-empty', 'task-running', 'task-blocked', 'task-failed', 'task-done'],
          input: 'edge' }, { id: 'turn-two' }],
        tasks: [{ id: 'task-empty' }],
        results: [{ task_id: 'task-empty', headline: '待验收', verdict: 'awaiting_verification', summary: '已有回复，等待验收',
          provenance: 'task_message', latest_message: '# 来源\n- https://shop.example/item（访问时间：2026-11-09T09:00:00Z）\n访问失败：public page request timed out\n<script>alert(1)</script>',
          artifacts: [{ name: 'report.md' }], evidence: [{ claim: '测试通过', confidence: 'confirmed' }],
          acceptance: [{ result: 'passed', summary: '报告存在' }], attention: [{ reason: '人工确认' }] },
          { task_id: 'task-done', headline: '已交付', verdict: 'passed', summary: '验收通过',
            provenance: 'task_outcome', latest_message: null, artifacts: [], evidence: [], acceptance: [], attention: [] }],
        routes: [{ task_id: 'task-empty', queue_state: 'queued', worker: { state: 'unknown' } }, { task_id: 'task-running', queue_state: 'running', worker: { state: 'started' } },
          { task_id: 'task-blocked', queue_state: 'blocked', worker: { state: 'awaiting_approval' } }, { task_id: 'task-failed', queue_state: 'finished',
            worker: { state: 'failed', reason: 'missing CLI' } }, { task_id: 'task-done', queue_state: 'finished',
            executor_template: 'plugin-x', worker: { state: 'completed' } }],
        reviews: [{ turn_id: 'turn-edge', phase: 'plan', verdict: 'pass', checks: [] },
          { turn_id: 'turn-edge', phase: 'final', verdict: 'pass', checks: [{ ok: true }] },
          { turn_id: 'turn-two', verdict: 'other', checks: [{ ok: false }] }],
        progress: { counts: { running: 1, queued: 1, failed: 1, blocked: 1 },
          result_facts: { passed: 1, awaiting_verification: 2, needs_attention: 1 } },
      });
    },
  }));
  const view = await pages.viewPilot();
  const queueState = { textContent: '' };
  const nodes: Record<string, any> = {
    '#pilot-thread': { innerHTML: '', onclick: null },
    '#pilot-form': { onsubmit: null },
    '#pilot-input': { value: '', oninput: null, onkeydown: null },
    '#pilot-send': { disabled: true },
    '#pilot-queue-state': queueState,
  };
  const root = { isConnected: true, querySelector: (selector: string) => nodes[selector] ?? null };
  view.mounts[0](root);
  await flush();
  assert.match(nodes['#pilot-thread'].innerHTML, /排队中/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /执行中/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /待核对/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /执行失败/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /已完成/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /正在执行/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /等待你批准/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /执行结果待确认/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /执行结束，等待验收/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /other/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /plugin-x/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /已交付/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /这次交付你怎么用了/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /直接采纳/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /改过再用/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /驳回重来/u);
  const adopt = { getAttribute: (k: string) => k === 'data-task' ? 'task-done' : k === 'data-adoption' ? 'accepted' : null };
  nodes['#pilot-thread'].onclick({ target: { closest: (s: string) => s === '[data-adoption]' ? adopt : null } });
  await flush();
  assert.equal((adoptionCalls[0]?.body as { verdict: string }).verdict, 'accepted');
  assert.match(nodes['#pilot-thread'].innerHTML, /最终复查/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /查看结果与依据/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /产物：report\.md/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /依据：测试通过/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /class="pilot-result-message"/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /https:\/\/shop\.example\/item/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /2026-11-09T09:00:00Z/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /public page request timed out/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /验收：passed/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /待办：人工确认/u);
  assert.match(queueState.textContent, /已交付 1/u);
  assert.match(queueState.textContent, /待验收 2/u);
});

test('viewPilot submit handles missing controls and stops polling after detach', async () => {
  const calls: string[] = [];
  let pending: (() => void) | null = null;
  const pages = createModePages(context({
    state: { page: 'pilot', settings: null, composer: { folder: '' }, execution: {}, folderGroups: [], pilotSessionId: '' },
    api: (path: string) => { calls.push(path); return Promise.resolve({ session: { id: 'no-controls' }, turns: [],
      tasks: [], routes: [], reviews: [], progress: { counts: {} } }); },
  }));
  const view = await pages.viewPilot();
  const nodes: Record<string, any> = {
    '#pilot-thread': { innerHTML: '', onclick: null }, '#pilot-form': { onsubmit: null },
    '#pilot-input': { value: 'no controls', oninput: null, onkeydown: null }, '#pilot-send': { disabled: false },
  };
  const root = { isConnected: true, querySelector: (selector: string) => nodes[selector] ?? null };
  view.mounts[0](root);
  nodes['#pilot-form'].onsubmit({ preventDefault() {} });
  await flush();
  const auto = calls.find((path) => path.endsWith('/turns/auto'));
  assert.equal(Boolean(auto), true);
  assert.equal(calls.some((path) => path.endsWith('/dispatch')), true);

  const timerPages = createModePages(context({
    state: { page: 'pilot', settings: null, composer: { folder: '' }, execution: {}, folderGroups: [],
      pilotSessionId: 'detached-session' },
    host: { setTimeout: (fn: () => void) => { pending = fn; return 1; }, clearTimeout: () => { pending = null; } },
    api: () => Promise.resolve({ turns: [], tasks: [], routes: [], reviews: [],
      progress: { counts: { running: 1 } } }),
  }));
  const timerView = await timerPages.viewPilot();
  const timerRoot = pilotNodes();
  timerView.mounts[0](timerRoot);
  await flush();
  assert.equal(pending !== null, true);
  timerRoot.isConnected = false;
  pending!();
  await flush();
});
test('viewPilot shows the release gate chain when a delivered task has evaluation, signoff and canary records', async () => {
  const pages = createModePages(context({
    state: { page: 'pilot', settings: null, composer: { folder: '' }, execution: {}, folderGroups: [], pilotSessionId: 'session-release' },
    api: (path: string) => {
      if (path.endsWith('/providers')) return Promise.resolve({});
      return Promise.resolve({
        turns: [{ id: 'turn-release', task_ids: ['task-release'], input: 'release' }],
        tasks: [{ id: 'task-release' }],
        results: [{ task_id: 'task-release', headline: '已交付', verdict: 'passed', summary: '验收通过',
          provenance: 'task_outcome', latest_message: null, artifacts: [], evidence: [], acceptance: [], attention: [],
          release: { status: 'released', reason: '已发布', evaluation_run_id: 'run-1', signoff_id: 'signoff-1',
            canary_id: 'canary-1', publication_allowed: false } }],
        routes: [{ task_id: 'task-release', queue_state: 'finished', executor_template: 'craft', worker: { state: 'completed' } }],
        reviews: [{ turn_id: 'turn-release', phase: 'final', verdict: 'pass', checks: [] }],
        progress: { counts: { running: 0, queued: 0 }, result_facts: { passed: 1 } },
      });
    },
  }));
  const view = await pages.viewPilot();
  const nodes: Record<string, any> = {
    '#pilot-thread': { innerHTML: '', onclick: null }, '#pilot-form': { onsubmit: null },
    '#pilot-input': { value: '', oninput: null, onkeydown: null }, '#pilot-send': { disabled: true },
    '#pilot-queue-state': { textContent: '' },
  };
  const root = { isConnected: true, querySelector: (selector: string) => nodes[selector] ?? null };
  view.mounts[0](root);
  await flush();
  assert.match(nodes['#pilot-thread'].innerHTML, /发布门禁明细/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /评估：run-1/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /签署：signoff-1/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /灰度：canary-1/u);
  assert.match(nodes['#pilot-thread'].innerHTML, /是否可发布：否/u);
});
test('viewMyTasks shows a release-gate pill for a delivered task and omits it otherwise', async () => {
  const pages = createModePages(context({
    api: (path) => {
      if (path.indexOf('/api/workbench/task-board') === 0) {
        return Promise.resolve({
          order: ['completed', 'awaiting_input'],
          labels: { completed: '完成', awaiting_input: '待输入' },
          buckets: {
            completed: [{ id: 'task-released', title: '已发布交付', state: 'completed', reason: '任务已完成', release: { status: 'released' } }],
            awaiting_input: [{ id: 'task-plain', title: '普通任务', state: 'awaiting_input', reason: '等待下一步输入' }],
          },
          tasks: [],
        });
      }
      return Promise.resolve({});
    },
  }));
  const view = await pages.viewMyTasks();
  assert.match(view.html, /发布·已发布/u);
  assert.doesNotMatch(view.html, /发布·待评估/u);
});

test('viewMyTasks expands the release gate chain on a delivered task card', async () => {
  const pages = createModePages(context({
    api: (path) => {
      if (path.indexOf('/api/workbench/task-board') === 0) {
        return Promise.resolve({
          order: ['completed'],
          labels: { completed: '完成' },
          buckets: { completed: [{ id: 'task-gate', title: '已交付任务', state: 'completed', reason: '任务已完成',
            release: { status: 'signoff_ready', reason: '评估通过，等待确定性 Signoff', evaluation_run_id: 'run-9' } }] },
          tasks: [],
        });
      }
      return Promise.resolve({});
    },
  }));
  const view = await pages.viewMyTasks();
  assert.match(view.html, /发布·待签署/u);
  assert.match(view.html, /发布门禁明细/u);
  assert.match(view.html, /状态：待签署 · 评估通过，等待确定性 Signoff/u);
  assert.match(view.html, /评估：run-9/u);
  assert.match(view.html, /是否可发布：否/u);
  assert.doesNotMatch(view.html, /签署：/u);
});
test('viewMyTasks lazily shows the context assets a task pulled with recall weights', async () => {
  const calls: string[] = [];
  const navigated: Array<[string, unknown]> = [];
  const pages = createModePages(context({
    go: (page: string, focus: unknown) => { navigated.push([page, focus]); },
    api: (path: string) => {
      calls.push(path);
      if (path.indexOf('/api/workbench/task-board') === 0) {
        return Promise.resolve({ order: ['completed'], labels: { completed: '完成' },
          buckets: { completed: [{ id: 'task-ctx', title: '上下文任务', state: 'completed', reason: '任务已完成' }] }, tasks: [] });
      }
      if (path.indexOf('/api/workbench/task-context-usage') === 0) {
        return Promise.resolve({ task_id: 'task-ctx', working_sets: [{ id: 'ws-1', created_at: 't', source_receipt_id: null }],
          assets: [
            { member: 'experience', id: 'proc-1', version: 1, recall_weight: 1.2, helpful_signals: 1, pending_corrections: 0 },
            { member: 'knowledge', id: 'claim-1', version: 1, recall_weight: 1, helpful_signals: 0, pending_corrections: 0 },
          ], counts: { working_sets: 1, assets: 2 } });
      }
      return Promise.resolve({});
    },
  }));
  const view = await pages.viewMyTasks();
  assert.match(view.html, /上下文使用/u);
  const link = { onclick: null as null | (() => void), getAttribute: (n: string) => n === 'data-usage-page' ? 'workflows' : n === 'data-usage-focus' ? 'experience:proc-1' : '' };
  const list = { hidden: true, textContent: '', innerHTML: '', querySelectorAll: () => [link] };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: (n: string) => n === 'data-context-usage' ? 'task-ctx' : '',
    parentElement: { querySelector: (selector: string) => selector === '[data-context-usage-list]' ? list : null },
  };
  const rows = [button];
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (selector: string) => selector === '[data-context-usage]' ? rows : [], });
  button.onclick!();
  await flush();
  assert.ok(calls.some((path) => path.indexOf('/api/workbench/task-context-usage') === 0));
  assert.match(list.innerHTML, /经验 proc-1 · 权重 1\.20 · 有用 1 \/ 待复核 0/u);
  assert.match(list.innerHTML, /知识 claim-1 · 权重 1\.00/u);
  assert.match(list.innerHTML, /本次使用 2 项资产 · 权重 1\.00–1\.20 · 最高：经验 proc-1/u);
  assert.match(list.innerHTML, /data-usage-page="workflows"/u);
  assert.match(list.innerHTML, /data-usage-focus="experience:proc-1"/u);
  // The second control deep-links straight onto the weight trend.
  assert.match(list.innerHTML, /data-usage-focus="experience:proc-1#trend"/u);
  assert.match(list.innerHTML, /#trend">权重趋势</u);
  link.onclick!();
  assert.deepEqual(navigated, [['workflows', 'experience:proc-1']]);
  // Toggling collapses without refetching.
  calls.length = 0;
  button.onclick!();
  assert.equal(list.hidden, true);
  assert.equal(calls.filter((path) => path.indexOf('/api/workbench/task-context-usage') === 0).length, 0);
});
test('context usage falls back to plain text when the host has no queryable element', async () => {
  const pages = createModePages(context({
    api: (path: string) => {
      if (path.indexOf('/api/workbench/task-board') === 0) {
        return Promise.resolve({ order: ['completed'], labels: { completed: '完成' },
          buckets: { completed: [{ id: 'task-min', title: '极简宿主', state: 'completed', reason: '任务已完成' }] }, tasks: [] });
      }
      if (path.indexOf('/api/workbench/task-context-usage') === 0) {
        return Promise.resolve({ assets: [{ member: 'memory', id: 'mem-1', recall_weight: 1, helpful_signals: 0, pending_corrections: 0 }] });
      }
      return Promise.resolve({});
    },
  }));
  const view = await pages.viewMyTasks();
  const list = { hidden: true, textContent: '' };
  const button: { onclick?: () => void; dataset: Record<string, string>; getAttribute: (n: string) => string; parentElement: unknown } = {
    dataset: {}, getAttribute: (n: string) => n === 'data-context-usage' ? 'task-min' : '',
    parentElement: { querySelector: (selector: string) => selector === '[data-context-usage-list]' ? list : null },
  };
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (selector: string) => selector === '[data-context-usage]' ? [button] : [] });
  button.onclick!();
  await flush();
  assert.match(list.textContent, /记忆 mem-1 · 权重 1\.00/u);
});
