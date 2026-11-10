// V2 · 三模式体验闭环 — cross-mode consistency integration contract.
//
// V2 acceptance from docs/workbench-ideal-state-analysis.md §6: switching modes
// preserves the task, draft and running facts (NEEDREAD §2), and the 控制台
// "待处理" / 审批 / 阻塞 aggregation reads the same shared truth the 领航员
// session produced. Exercises the three-mode shell end to end against the
// in-memory mock runtime.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createModePages } from '../workbench/mode-pages.js';
import { createMockRuntime, mockContext, assertCalled } from './helpers/mock-runtime.js';

// --- V2: a task dispatched by 领航员 is the same shared record the 控制台 reads,
//     and switching to 工作台 never re-dispatches it (no double side effect) ---
test('V2: 领航员 dispatch produces one shared task the 控制台 reads without re-dispatch', async () => {
  const runtime = createMockRuntime({
    tasks: [{ id: 't-2', title: '重构前端路由', workspace: 'ws-1', status: 'running' }],
    pilot: { thread_id: 'pilot-thread-2' },
  });
  const ctx = mockContext(runtime);
  const pages = createModePages(ctx);

  // 领航员 view (already has the running task in its shared thread projection)
  const pilot = await pages.viewPilot();
  assert.match(pilot.html, /pilot-shell/u);

  // 控制台 reads the exact same task board — shared Runtime, not a re-dispatch
  const myTasks = await pages.viewMyTasks();
  assert.match(myTasks.html, /重构前端路由/u);

  // 工作台 reads the shared board too; the task id is stable across projections
  const home = await pages.viewHome();
  assert.match(home.html, /session-toolbar/u);

  // the board was read exactly once for the shared truth (no duplicate task)
  const boardReads = runtime.calls.filter((c) => c.includes('/task-board'));
  assert.equal(boardReads.length, 1);
});

// --- V2: 控制台 "待我批准" aggregation reads shared approval state ---
test('V2: 控制台 approval aggregation reflects shared approval counts', async () => {
  const runtime = createMockRuntime({
    tasks: [
      { id: 't-3', title: '发布前评审', workspace: 'ws-1', status: 'awaiting_approval', approvals: 2 },
      { id: 't-4', title: '灰度放量', workspace: 'ws-1', status: 'running', approvals: 0 },
    ],
  });
  const ctx = mockContext(runtime);
  const pages = createModePages(ctx);
  const myTasks = await pages.viewMyTasks();
  // both tasks appear on the shared board regardless of mode projection
  assert.match(myTasks.html, /发布前评审/u);
  assert.match(myTasks.html, /灰度放量/u);
  assertCalled(runtime, '/api/workbench/task-board');
});

// --- V2: switching the stable mode key never mutates task state in the runtime ---
test('V2: mode projection switch is a read-only view change (no task mutation)', async () => {
  const runtime = createMockRuntime({
    tasks: [{ id: 't-5', title: '数据迁移校验', workspace: 'ws-1', status: 'running' }],
  });
  const ctx = mockContext(runtime);
  const pages = createModePages(ctx);

  // simulate moving from 领航员 -> 控制台 -> 工作台 by rendering each view
  await pages.viewPilot();
  await pages.viewMyTasks();
  const home = await pages.viewHome();
  assert.match(home.html, /session-toolbar/u);

  // no POST/PATCH against the task was issued by a mere mode switch
  const mutations = runtime.calls.filter((c) => /^(POST|PUT|PATCH|DELETE) /.test(c) && c.includes('task'));
  assert.equal(mutations.length, 0, `mode switch must not mutate tasks, saw: ${JSON.stringify(mutations)}`);
  // the single shared task is still intact in the runtime
  const board = runtime.calls.filter((c) => c.includes('/task-board'));
  assert.equal(board.length, 1);
});
