// V3 · 上下文与自进化可视 — evolution room / blocked queue / evaluation panel
// integration contract against the in-memory mock runtime.
//
// V3 acceptance from docs/workbench-ideal-state-analysis.md §6: the 观察室
// surfaces self-evolved Mods, shadow tests, plugin discovery and failure
// trajectories; the 阻塞队列 lists suspended routes; the 评测面板 reads
// craft-eval-shaped reports. Missing real data is mocked per delivery directive.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createModPages } from '../workbench/mod-pages.js';
import { createMockRuntime, assertCalled } from './helpers/mock-runtime.js';

const presentation = {
  icon: (name) => `<svg>${name}</svg>`,
  esc: (value) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  head: (title, _sub, right) => `<h2>${title}</h2>${right}`,
  emptyState: (title) => `<p>${title}</p>`,
  asideBlock: (_title, _right, body) => body,
  pill: (text, tone) => `<span class="${tone}">${text}</span>`,
  shortTime: (value) => String(value ?? ''),
  countChip: (value) => `<span class="count">${String(value)}</span>`,
};

function modPages(runtime) {
  return createModPages({
    api: runtime.api,
    presentation,
    notify: () => {},
    fail: (error) => { throw error; },
    ask: () => 'ok',
    operator: () => 'user:alex',
    paint: () => {},
    go: () => {},
    openInlineOn: () => {},
  });
}

// --- V3.1: 观察室 reads all four shared truth sources ---
test('V3.1 观察室 聚合 Mod/失败/插件发现/交付结局 四类共享证据', async () => {
  const runtime = createMockRuntime({
    mods: [{ id: 'm1', name: 'no-hardcode', status: 'pending', selfEvolved: true, shadow_test: 'pending', version: 2 }],
    pilot: {
      failure_observations: [{ id: 'fo-1', task_id: 't-1', summary: '超时未落盘', evidence_count: 1 }],
      outcomes: {
        total: 2,
        counts: { accepted: 1, accepted_with_edits: 1, rejected: 0 },
        items: [{ task_id: 't-1', verdict: 'accepted' }],
      },
    },
    discoveries: [{ id: 'd-1', capability: 'lsp', reason: '缺工具补救', candidate_count: 1 }],
  });
  const pages = modPages(runtime);
  const view = await pages.evolution();
  assert.match(view.html, /自进化观察室/u);
  assert.match(view.html, /no-hardcode/u);
  assert.match(view.html, /未归因的失败/u);
  assert.match(view.html, /插件发现提案/u);
  assert.match(view.html, /飞轮真值/u);
  assertCalled(runtime, '/api/workbench/mods/list');
  assertCalled(runtime, '/api/workbench/plugin-discovery/list');
  assertCalled(runtime, '/api/workbench/pilot/failure-observations');
  assertCalled(runtime, '/api/workbench/pilot/outcomes');
});

// --- V3.1: shadow test + rollback reach the real governance endpoints ---
test('V3.1 影子测试与一键回滚命中治理端点且状态可追溯', async () => {
  const runtime = createMockRuntime({
    mods: [{ id: 'm1', name: 'no-hardcode', status: 'active', enabled: true, version: 3, shadow_test: 'pending' }],
  });
  const pages = modPages(runtime);
  await pages.mods();
  // shadow test must hit the real regression endpoint, not just mark a pass locally
  await runtime.dispatch('/api/workbench/mods/shadow-test/run', { method: 'POST', body: { id: 'm1' } });
  assert.equal(runtime.state.mods.get('m1').shadow_test, 'passed');
  assertCalled(runtime, '/api/workbench/mods/shadow-test/run');
  // rollback to previous version must be a real endpoint call
  await runtime.dispatch('/api/workbench/mods/rollback/previous', { method: 'POST', body: { id: 'm1' } });
  assert.equal(runtime.state.mods.get('m1').version, 2);
  assertCalled(runtime, '/api/workbench/mods/rollback/previous');
});

// --- V3.1: 阻塞队列 lists suspended routes from the shared Pilot thread ---
test('V3.1 控制台阻塞队列读取共享领航线程的挂起路由', async () => {
  const runtime = createMockRuntime({
    tasks: [{ id: 't-9', title: '审查超限', workspace: 'ws-1', status: 'blocked', blocked: true }],
  });
  const pages = modPages(runtime);
  const view = await pages.blocked();
  assert.match(view.html, /审查超限/u);
  assertCalled(runtime, '/api/workbench/pilot/blocked-queue');
});

// V3.4 (评测面板 / Context 审计 / 报告不可伪造) 已由
// tests/three-mode-evaluation-flow.test.ts 的真实 HTTP 集成测试覆盖，
// 此处不再保留较弱的静态源码 grep 断言，避免重复证据。
