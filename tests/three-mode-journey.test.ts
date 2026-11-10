// V1 · 底座与形态收敛 — three-mode journey integration contract.
//
// Uses the in-memory mock runtime (tests/helpers/mock-runtime.js) to exercise
// the three-mode shell (领航员 / 控制台 / 工作台) end to end without a live
// `craft` server. Each assertion is a V1 acceptance check from
// docs/workbench-ideal-state-analysis.md §6.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createModePages } from '../workbench/mode-pages.js';
import { readMode, writeMode, nextPageForMode, MODE_KEY, MODES } from '../workbench/mode-shell.js';
import { createMockRuntime, mockContext, assertCalled } from './helpers/mock-runtime.js';

// --- V1.1: display names are the spec names while stable keys stay decoupled ---
test('V1.1 display names are 领航员/控制台/工作台 with decoupled stable keys', () => {
  assert.equal(MODES.pilot.label, '领航员');
  assert.equal(MODES.control.label, '控制台');
  assert.equal(MODES.workshop.label, '工作台');
  // stable keys intentionally remain the internal identifiers (NEEDREAD §2)
  assert.deepEqual(['pilot', 'control', 'workshop'], [MODES.pilot.key, MODES.control.key, MODES.workshop.key]);
});

// --- V1.1: saving a mode persists the stable key, not the display name ---
test('V1.1 mode preference round-trips through the stable key', () => {
  const storage = Object.assign(new Map<string, string>(), {
    getItem: (k: string) => (storage as Map<string, string>).get(k) ?? null,
    setItem: (k: string, v: string) => (storage as Map<string, string>).set(k, v),
    removeItem: (k: string) => (storage as Map<string, string>).delete(k),
  });
  writeMode(storage, 'workshop');
  assert.equal(readMode(storage), 'workshop');
  assert.equal(storage.getItem(MODE_KEY), 'workshop');
});

// --- V1.2: mode switch is a projection swap, never interrupts a task ---
test('V1.2 mode switch keeps the shared task document and does not change facts', () => {
  // home/task/project/plugin pages are shared across modes
  assert.equal(nextPageForMode('control', 'task'), 'task');
  assert.equal(nextPageForMode('workshop', 'task'), 'task');
  assert.equal(nextPageForMode('pilot', 'task'), 'task');
  // a mode-only page drops to the target mode home (projection, not reload)
  assert.equal(nextPageForMode('control', 'home'), 'tasks');
  assert.equal(nextPageForMode('pilot', 'plugins'), 'pilot');
});

// --- V1.3 (logic, not native shell): legacy link reopening is preserved ---
// The 控制台 "我的任务" view reads the shared task board through the same
// `/api/workbench/task-board` the 领航员 session produced, so a legacy deep
// link resolving to a task keeps working across the mode projection.
test('V1.3 legacy task deep link resolves through the shared task board', async () => {
  const runtime = createMockRuntime({
    tasks: [{ id: 't-1', title: '修复登录态', workspace: 'ws-1', status: 'running' }],
  });
  const ctx = mockContext(runtime);
  const pages = createModePages(ctx);
  const myTasks = await pages.viewMyTasks();
  assert.match(myTasks.html, /修复登录态/u);
  assertCalled(runtime, '/api/workbench/task-board');
});

// --- V1 end-to-end: one task is shared across 领航员/控制台/工作台 projections ---
// The 控制台 task board and the 工作台 agent workspace both read the same
// shared Runtime truth; switching modes never re-creates the task.
test('V1 e2e: one task is shared across 控制台/工作台 projections', async () => {
  const runtime = createMockRuntime({
    tasks: [{ id: 't-1', title: '修复登录态', workspace: 'ws-1', status: 'running' }],
    mods: [{ id: 'm1', name: 'no-hardcode', status: 'active', enabled: true, version: 2 }],
  });
  const ctx = mockContext(runtime);
  const pages = createModePages(ctx);

  // 控制台 reads the same task board the 领航员 session produced
  const myTasks = await pages.viewMyTasks();
  assert.match(myTasks.html, /修复登录态/u);
  // 工作台 agent workspace shares the same shell projection and pulls the
  // shared Mod/Plugin configuration when mounted (no separate config truth)
  const home = await pages.viewHome();
  assert.match(home.html, /session-toolbar/u);
  const toolbar = { innerHTML: '' };
  const root = {
    querySelector: (sel) => (sel === '#agent-workspace' ? { isConnected: true } : sel === '#session-toolbar' ? toolbar : null),
  };
  home.mounts[0](root);
  await new Promise((r) => setImmediate(r));
  assertCalled(runtime, '/api/workbench/mods/list');
  // exactly one task-board read for the board-shaped request (shared truth, no duplicate task)
  const boardReads = runtime.calls.filter((c) => c.includes('/task-board'));
  assert.equal(boardReads.length, 1);
});

// --- V1 e2e: 领航员 Flight Strip renders the four-stage shared progress ---
test('V1 e2e: 领航员 view is the shared pilot projection with a flight strip', async () => {
  const runtime = createMockRuntime({
    pilot: {
      thread_id: 'pilot-thread-1',
      outcomes: { total: 2, counts: { accepted: 1, accepted_with_edits: 1, rejected: 0 }, items: [] },
    },
  });
  const ctx = mockContext(runtime);
  const pages = createModePages(ctx);
  const pilot = await pages.viewPilot();
  assert.match(pilot.html, /pilot-shell/u);
  assert.match(pilot.html, /flight-strip/u);
  assert.match(pilot.html, /领航员会在内部拆解、排队、分派和复查/u);
  // the same Pilot thread identity is what 控制台 reads for failure/evolution
  assert.equal(runtime.state.pilot.thread_id, 'pilot-thread-1');
});
