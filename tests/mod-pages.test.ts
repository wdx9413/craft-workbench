import assert from 'node:assert/strict';
import test from 'node:test';
import { createModPages } from '../workbench/mod-pages.js';

const presentation = {
  icon: (name: string) => `<svg>${name}</svg>`,
  esc: (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  head: (title: string, _sub: string, right: string) => `<h2>${title}</h2>${right}`,
  emptyState: (title: string) => `<p>${title}</p>`,
  asideBlock: (_t: string, _r: string, body: string) => body,
  pill: (text: string, tone: string) => `<span class="${tone}">${text}</span>`,
  shortTime: (value: unknown) => String(value ?? ''),
  countChip: (value: unknown) => `<span class="count">${String(value)}</span>`,
};

function button(attrs: Record<string, string>) {
  const node: Record<string, unknown> = { disabled: false, ...attrs };
  return node;
}

function flush() { return new Promise<void>((resolve) => setImmediate(resolve)); }

test('Mod page renders status groups and wires approve/enable/revoke actions', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const refreshes: string[] = [], notifications: string[] = [], edits: unknown[] = [];
  const data = { items: [
    { id: 'm1', name: 'no-hardcode', body: 'forbid literal', status: 'draft', enabled: false, version: 1, scope_kind: 'global', applies_to: 'worker' },
    { id: 'm2', name: 'async-first', body: 'prefer asyncio', status: 'pending', enabled: false, version: 2, scope_kind: 'project', scope_id: 'p1', applies_to: 'all' },
    { id: 'm3', name: 'review-before-merge', body: 'always review', status: 'active', enabled: true, version: 3, scope_kind: 'global', applies_to: 'reviewer' },
    { id: 'm4', name: 'retired', body: 'old', status: 'revoked', enabled: false, version: 4, scope_kind: 'global', applies_to: 'worker' },
  ] };
  const pages = createModPages({
    api: async (path: string, init?: unknown) => {
      calls.push({ path, body: init && (init as { body?: unknown }).body });
      return data;
    },
    presentation, notify: (m: string) => notifications.push(m), fail: (e: Error) => { throw e; },
    ask: () => 'ok', operator: () => 'user:alex', paint: (p: string) => refreshes.push(p), go: () => {},
    openInlineOn: (_page: string, spec: unknown) => edits.push(spec),
  });
  const view = await pages.mods();
  assert.ok(view.html.includes('no-hardcode'));
  assert.ok(view.html.includes('待批准'));
  assert.ok(view.html.includes('已生效'));
  assert.ok(view.html.includes('草稿'));
  assert.ok(view.html.includes('已撤销'));
  const approve = button({ 'data-mod-approve': 'm2', getAttribute: (k: string) => (k === 'data-mod-approve' ? 'm2' : null) } as never);
  const enable = button({ 'data-mod-enable': 'm3', getAttribute: (k: string) => (k === 'data-mod-enable' ? 'm3' : 'true') } as never);
  const revoke = button({ 'data-mod-revoke': 'm3', getAttribute: (k: string) => (k === 'data-mod-revoke' ? 'm3' : null) } as never);
  const add = button({});
  const nodes = {
    querySelector: (s: string) => (s === '#mod-add' ? add : null),
    querySelectorAll: (s: string) =>
      s === '[data-mod-approve]' ? [approve] : s === '[data-mod-enable]' ? [enable] : s === '[data-mod-revoke]' ? [revoke] : [],
  };
  view.mounts[0](nodes as never);
  (add as { onclick?: () => void }).onclick!();
  assert.equal(edits.length, 1);
  (approve as { onclick?: () => void }).onclick!(); await flush();
  assert.ok(calls.some((c) => c.path === '/api/workbench/mods/m2/approve' && (c.body as { approved_by: string }).approved_by === 'user:alex'));
  (enable as { onclick?: () => void }).onclick!(); await flush();
  assert.ok(calls.some((c) => c.path === '/api/workbench/mods/m3/disable'));
  assert.deepEqual(refreshes, ['mods', 'mods']);
});

test('one-click rollback calls the previous-version endpoint', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const pages = createModPages({
    api: async (path: string, init?: unknown) => {
      calls.push({ path, body: init && (init as { body?: unknown }).body });
      return { items: [{ id: 'm2', name: 'async-first', status: 'active', enabled: true, version: 3,
        scope_kind: 'global', applies_to: 'all' }] };
    },
    presentation, notify: () => {}, fail: (e: Error) => { throw e; }, ask: () => '',
    operator: () => 'op', paint: () => {}, go: () => {}, openInlineOn: () => {},
  });
  const view = await pages.mods();
  assert.ok(view.html.includes('回到上一版'));
  const rollback = { getAttribute: () => 'm2', onclick: null as null | (() => void) };
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (s: string) =>
    (s === '[data-mod-rollback-previous]' ? [rollback] : []) } as never);
  rollback.onclick!();
  await flush();
  assert.ok(calls.some((c) => c.path === '/api/workbench/mods/rollback/previous'
    && (c.body as { id: string }).id === 'm2'));
});

test('shadow-test button runs a real regression instead of claiming a pass', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const notifications: string[] = [];
  const pages = createModPages({
    api: async (path: string, init?: unknown) => {
      calls.push({ path, body: init && (init as { body?: unknown }).body });
      if (path.includes('shadow-test/run')) return { shadowTest: 'passed', regression: { verdict: 'passed', failed: 0, model_calls: 0, cases: [] } };
      return { items: [{ id: 'm1', name: 'auto:retrieval_gap', status: 'pending', enabled: false, version: 1,
        selfEvolved: true, failureClass: 'retrieval_gap', shadowTest: 'pending', applies_to: 'worker', scope_kind: 'global' }] };
    },
    presentation, notify: (m: string) => notifications.push(m), fail: (e: Error) => { throw e; },
    ask: () => '', operator: () => 'op', paint: () => {}, go: () => {}, openInlineOn: () => {},
  });
  const view = await pages.mods();
  assert.ok(view.html.includes('跑影子回归'));
  const shadow = button({ 'data-mod-shadow': 'm1', getAttribute: (k: string) => (k === 'data-mod-shadow' ? 'm1' : null) } as never);
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (s: string) => (s === '[data-mod-shadow]' ? [shadow] : []) } as never);
  (shadow as { onclick?: () => void }).onclick!();
  await flush();
  const run = calls.find((c) => c.path === '/api/workbench/mods/shadow-test/run');
  assert.ok(run, 'calls the deterministic regression endpoint');
  assert.deepEqual(run?.body, { id: 'm1' }, 'no hardcoded pass verdict in the request');
  assert.ok(notifications.some((m) => m.includes('影子回归通过')));
});

test('file-dir-desc page records a directory and promotes it', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const data = { items: [{ id: 'd1', path: 'C:\\projects\\billing', description: 'billing service', hostKind: 'local', useCount: 1, status: 'observed' }] };
  const pages = createModPages({
    api: async (path: string, init?: unknown) => { calls.push({ path, body: init && (init as { body?: unknown }).body }); return data; },
    presentation, notify: () => {}, fail: (e: Error) => { throw e; }, ask: () => null, operator: () => 'op',
    paint: () => {}, go: () => {}, openInlineOn: () => {},
  });
  const view = await pages.filedir();
  assert.ok(view.html.includes('C:\\projects\\billing'));
  assert.ok(view.html.includes('billing service'));
  const promote = button({ 'data-desc-promote': 'd1', getAttribute: (k: string) => (k === 'data-desc-promote' ? 'd1' : null) } as never);
  const nodes = { querySelector: () => null, querySelectorAll: (s: string) => (s === '[data-desc-promote]' ? [promote] : []) };
  view.mounts[0](nodes as never);
  (promote as { onclick?: () => void }).onclick!(); await flush();
  assert.ok(calls.some((c) => c.path === '/api/workbench/file-dir-desc/promote' && (c.body as { id: string }).id === 'd1'));
});

test('file-dir-desc page offers attributed relocation and withdrawal, and marks withdrawn rows', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const data = { items: [
    { id: 'd1', path: 'C:\\projects\\billing', description: 'billing service', hostKind: 'local', useCount: 3, status: 'promoted' },
    { id: 'd2', path: 'C:\\projects\\old', description: 'legacy', hostKind: 'local', useCount: 3, status: 'revoked', revokedReason: 'project moved' },
  ] };
  let promptAnswer: string | null = 'D:\\work\\billing';
  const pages = createModPages({
    api: async (path: string, init?: unknown) => { calls.push({ path, body: init && (init as { body?: unknown }).body }); return data; },
    presentation, notify: () => {}, fail: (e: Error) => { throw e; }, ask: () => promptAnswer, operator: () => 'user:alex',
    paint: () => {}, go: () => {}, openInlineOn: () => {},
  });
  const view = await pages.filedir();
  assert.match(view.html, /撤销后不会因再次使用自动恢复/u);
  assert.match(view.html, /project moved/u);
  const relocate = button({ 'data-desc-relocate': 'd1', getAttribute: (k: string) => (k === 'data-desc-relocate' ? 'd1' : null) } as never);
  const revoke = button({ 'data-desc-revoke': 'd1', getAttribute: (k: string) => (k === 'data-desc-revoke' ? 'd1' : null) } as never);
  const nodes = { querySelector: () => null, querySelectorAll: (s: string) =>
    s === '[data-desc-relocate]' ? [relocate] : s === '[data-desc-revoke]' ? [revoke] : [] };
  view.mounts[0](nodes as never);
  (relocate as { onclick?: () => void }).onclick!(); await flush();
  assert.deepEqual(calls.find((c) => c.path === '/api/workbench/file-dir-desc/relocate')?.body,
    { id: 'd1', path: 'D:\\work\\billing' });
  // A withdrawal without a reason is refused locally, never sent half-formed.
  promptAnswer = '   ';
  const before = calls.length;
  (revoke as { onclick?: () => void }).onclick!(); await flush();
  assert.equal(calls.length, before);
  promptAnswer = 'project moved';
  (revoke as { onclick?: () => void }).onclick!(); await flush();
  assert.deepEqual(calls.find((c) => c.path === '/api/workbench/file-dir-desc/revoke')?.body,
    { id: 'd1', revoked_by: 'user:alex', reason: 'project moved' });
});

test('onboarding page shows completion state and reset; mode-confirm shows counts', async () => {
  let settings: Record<string, unknown> = { workbench: { onboarding: { completedAt: null } } };
  const pages = createModPages({
    api: async (path: string) => path === '/api/settings' ? settings : { running: 2, queued: 1, active: 3 },
    presentation, notify: () => {}, fail: (e: Error) => { throw e; }, ask: () => null, operator: () => 'op',
    paint: () => {}, go: () => {}, openInlineOn: () => {},
  });
  const first = await pages.onboard();
  assert.ok(first.html.includes('尚未完成'));
  settings = { workbench: { onboarding: { completedAt: '2026-10-01T00:00:00.000Z' } } };
  const done = await pages.onboard();
  assert.ok(done.html.includes('已完成'));
  const confirm = await pages.modeConfirm();
  assert.ok(confirm.html.includes('2 个'));
  assert.ok(confirm.html.includes('1 个'));
});

test('evolution room surfaces self-evolved Mods and approves plugin discovery proposals', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const data: Record<string, unknown> = {
    '/api/workbench/mods/list': { items: [
      { id: 'm1', name: 'auto:retrieval_gap', status: 'pending', enabled: false, version: 1, selfEvolved: true,
        failureClass: 'retrieval_gap', evidenceId: 'ev-1', shadowTest: 'pending', applies_to: 'worker', scope_kind: 'global' },
    ] },
    '/api/workbench/plugin-discovery/list?status=proposed': { items: [
      { id: 'd1', capability: 'search', reason: '源材料缺少答案', candidate_count: 1, status: 'proposed' },
    ] },
    '/api/workbench/pilot/failure-observations': { items: [
      { id: 'f1', task_id: 'task-9', verdict: 'needs_attention', summary: '验收未通过',
        evidence_count: 2, acceptance_count: 1, attention_count: 0, attributed: false, failure_class: null },
    ] },
    '/api/workbench/pilot/outcomes': { total: 2, counts: { accepted: 1, accepted_with_edits: 1, rejected: 0 },
      items: [{ task_id: 'task-1', verdict: 'accepted', note: null }, { task_id: 'task-2', verdict: 'accepted_with_edits', note: '改了文档' }] },
  };
  const pages = createModPages({
    api: async (path: string, init?: unknown) => { calls.push({ path, body: init && (init as { body?: unknown }).body }); return data[path] || { items: [] }; },
    presentation, notify: () => {}, fail: (e: Error) => { throw e; }, ask: () => null, operator: () => 'user:alex',
    paint: () => {}, go: () => {}, openInlineOn: () => {},
  });
  const view = await pages.evolution();
  assert.ok(view.html.includes('auto:retrieval_gap'));
  assert.ok(view.html.includes('影子测试 pending'));
  assert.ok(view.html.includes('插件发现提案'));
  assert.ok(view.html.includes('不写宿主配置'));
  assert.ok(view.html.includes('待归因的失败轨迹'));
  assert.ok(view.html.includes('验收未通过'));
  assert.ok(view.html.includes('交付结局（飞轮真值'));
  assert.ok(view.html.includes('改过再用'));
  const attributeButton = button({ 'data-failure-attribute': 'f1', getAttribute: (k: string) => (k === 'data-failure-attribute' ? 'f1' : null) } as never);
  const prior = globalThis.prompt;
  (globalThis as { prompt?: unknown }).prompt = () => 'relevant_retrieved=false';
  try {
    view.mounts[0]({ querySelector: () => null, querySelectorAll: (s: string) => (s === '[data-failure-attribute]' ? [attributeButton] : []) } as never);
    (attributeButton as { onclick?: () => void }).onclick!();
    await flush();
  } finally { (globalThis as { prompt?: unknown }).prompt = prior; }
  assert.ok(calls.some((c) => c.path === '/api/workbench/pilot/failure-observations/attribute'
    && (c.body as { signals: Record<string, boolean> }).signals.relevant_retrieved === false));
  const approve = button({ 'data-discovery-approve': 'd1', getAttribute: (k: string) => (k === 'data-discovery-approve' ? 'd1' : null) } as never);
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (s: string) => (s === '[data-discovery-approve]' ? [approve] : []) } as never);
  (approve as { onclick?: () => void }).onclick!();
  await flush();
  assert.ok(calls.some((c) => c.path === '/api/workbench/plugin-discovery/approve'
    && (c.body as { id: string; approved_by: string }).approved_by === 'user:alex'));
});

test('blocked queue lists suspended routes and resumes a session', async () => {
  const calls: Array<{ path: string }> = [];
  const pages = createModPages({
    api: async (path: string) => {
      calls.push({ path });
      return path.includes('blocked-queue') ? { items: [
        { id: 'route-1', session_id: 's1', task_id: 'task-1', suspended_reason: '超过 3 轮', executor_template: 'codex', suspended_at: 'now' },
      ] } : {};
    },
    presentation, notify: () => {}, fail: (e: Error) => { throw e; }, ask: () => null, operator: () => 'op',
    paint: () => {}, go: () => {}, openInlineOn: () => {},
  });
  const view = await pages.blocked();
  assert.ok(view.html.includes('超过 3 轮'));
  assert.ok(view.html.includes('codex'));
  const resume = button({ 'data-blocked-resume': 's1', getAttribute: () => 's1' } as never);
  view.mounts[0]({ querySelector: () => null, querySelectorAll: (s: string) => (s === '[data-blocked-resume]' ? [resume] : []) } as never);
  (resume as { onclick?: () => void }).onclick!();
  await flush();
  assert.ok(calls.some((c) => c.path.includes('/api/workbench/pilot/resume-session?session_id=s1')));
});

test('relation health separates internal gaps from external references and keeps the workspace choice', async () => {
  const calls: Array<{ path: string }> = [];
  const refreshes: string[] = [];
  const status = {
    workspace_id: 'ws-1', enabled: true, readiness: 'ready',
    indexes: [{
      id: 'idx-1', analyzer: 'multi-language-static', analyzer_version: 'ts9+py1', created_at: '2026-11-06T00:00:00.000Z',
      node_count: 74089, edge_count: 311056, graph_storage: 'project-sharded-v5',
      relation_analysis: { status: 'partial', partial_reasons: ['degraded_languages', 'unresolved_calls'] },
    }],
    // Health is top-level for the newest index, not repeated on every row.
    relation_diagnostics: {
        unresolved_relations: 218, unresolved_type_references: 0, unresolved_heritage: 0,
        unresolved_imports: 0, unresolved_calls: 218, external_references: 124863,
        local_type_parameters: 112, computed_invocations: 128, inline_invocations: 47,
        unresolved_call_samples: ['run'], unresolved_type_reference_samples: [],
        degraded_languages: [{ language: 'yaml', reason: 'unsupported_lsp_language' }],
    },
  };
  const pages = createModPages({
    api: async (path: string) => {
      calls.push({ path });
      if (path === '/api/workspaces') return { workspaces: [{ id: 'ws-1', name: 'craft' }, { id: 'ws-2', name: 'other' }] };
      if (path.startsWith('/api/workbench/codebase/status')) return status;
      return {};
    },
    presentation, notify: () => {}, fail: (e: Error) => { throw e; }, ask: () => null, operator: () => 'op',
    paint: (page: string) => refreshes.push(page), go: () => {}, openInlineOn: () => {},
  });
  const view = await pages.relations();
  // Both facts are shown side by side: the big external number must not read as a defect.
  assert.match(view.html, /内部缺口 218/u);
  assert.match(view.html, /外部引用 124,863/u);
  assert.match(view.html, /待收敛 218/u);
  assert.match(view.html, /degraded_languages/u);
  assert.match(view.html, /yaml/u);
  assert.match(view.html, /unsupported_lsp_language/u);
  assert.match(view.html, /id="rel-workspace"/u);
  assert.equal(calls.some((c) => c.path === '/api/workbench/codebase/status?workspace_id=ws-1'), true);
  // Switching workspaces repaints instead of re-rendering stale numbers.
  const select = { value: 'ws-2', onchange: undefined as unknown as () => void };
  view.mounts[0]({ querySelector: (s: string) => (s === '#rel-workspace' ? select : null) } as never);
  select.onchange!();
  assert.deepEqual(refreshes, ['relations']);
});

test('relation health explains itself when no workspace has been indexed yet', async () => {
  const pages = createModPages({
    api: async () => ({ workspaces: [] }),
    presentation, notify: () => {}, fail: (e: Error) => { throw e; }, ask: () => null, operator: () => 'op',
    paint: () => {}, go: () => {}, openInlineOn: () => {},
  });
  const view = await pages.relations();
  assert.match(view.html, /还没有工作区/u);
  assert.deepEqual(view.mounts, []);
});
