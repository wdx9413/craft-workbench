import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApprovalNotificationAction, startApprovalNotifications } from '../workbench/approval-notifications.js';

const approval = { task_id: 'task-1', task_run_id: 'run-1', launch_id: 'launch-1', launch_version: 2, task_run_version: 3, decision_version: 2 };
function fixture(current = true) {
  const opened: string[] = [], messages: string[] = [], calls: string[] = [];
  const ui = {
    api: async (path: string) => { calls.push(path); if (path.includes('/tasks/')) return { pending_work_launches: current ? [{ ...approval, status: 'awaiting_approval' }] : [] }; throw new Error('unexpected'); },
    openTask: (id: string) => opened.push(id), toast: (message: string) => messages.push(message)
  };
  return { ui, opened, messages, calls };
}

test('notification click only navigates after current approval version matches', async () => {
  const f = fixture();
  assert.equal(await handleApprovalNotificationAction({ actionId: 'tap', notification: { extra: approval } }, f.ui), true);
  assert.deepEqual(f.opened, ['task-1']);
  assert.equal(f.calls.length, 1);
  assert.equal(f.messages.length, 0);
  const stale = fixture(false);
  assert.equal(await handleApprovalNotificationAction({ actionId: 'tap', notification: { extra: approval } }, stale.ui), false);
  assert.deepEqual(stale.opened, ['task-1']);
  assert.match(stale.messages[0]!, /已过期/u);
});

test('invalid notification actions and incomplete payloads do not navigate', async () => {
  const f = fixture();
  assert.equal(await handleApprovalNotificationAction({ actionId: 'dismiss', notification: { extra: approval } }, f.ui), false);
  assert.equal(await handleApprovalNotificationAction({ actionId: 'tap', notification: { extra: { ...approval, task_run_version: 'bad' } } }, f.ui), false);
  for (const extra of [null, 'bad', {}, { ...approval, task_id: '' }, { ...approval, task_run_id: 0 }, { ...approval, launch_id: null }, { ...approval, launch_version: Infinity }, { ...approval, task_run_version: 1.2 }, { ...approval, decision_version: Infinity }]) {
    assert.equal(await handleApprovalNotificationAction({ actionId: 'tap', notification: { extra } }, f.ui), false);
  }
  assert.equal(await handleApprovalNotificationAction(undefined, f.ui), false);
  assert.equal(await handleApprovalNotificationAction({ actionId: 'tap' }, f.ui), false);
  assert.deepEqual(f.opened, []);
  const broken = { ...f.ui, api: async () => { throw 'offline'; } };
  assert.equal(await handleApprovalNotificationAction({ actionId: 'tap', notification: { extra: approval } }, broken), false);
  assert.deepEqual(f.opened, ['task-1']);
  assert.match(f.messages.at(-1)!, /offline/u);
});

test('each stale approval identity or version fails closed and still opens the task', async () => {
  for (const changes of [
    { launch_id: 'other' }, { task_id: 'other' }, { task_run_id: 'other' }, { status: 'denied' },
    { launch_version: 9 }, { task_run_version: 9 }
  ]) {
    const f = fixture();
    f.ui.api = async () => ({ pending_work_launches: [{ ...approval, status: 'awaiting_approval', ...changes }] });
    assert.equal(await handleApprovalNotificationAction({ actionId: 'tap', notification: { extra: approval } }, f.ui), false);
    assert.deepEqual(f.opened, ['task-1']);
  }
  const missing = fixture();
  missing.ui.api = async () => ({});
  assert.equal(await handleApprovalNotificationAction({ actionId: 'tap', notification: { extra: approval } }, missing.ui), false);
  const oldDecision = fixture();
  assert.equal(await handleApprovalNotificationAction({ actionId: 'tap', notification: { extra: { ...approval, decision_version: 9 } } }, oldDecision.ui), false);
});

test('desktop notification sender binds source, launch, task-run and decision versions and deduplicates', async () => {
  const notifications: unknown[] = [], listeners: Function[] = [], timers: Function[] = [];
  const storage = new Map<string, string>();
  const ui = {
    host: { __TAURI__: { notification: {
      sendNotification: (value: unknown) => notifications.push(value),
      onAction: (listener: Function) => { listeners.push(listener); return Promise.resolve(() => {}); }
    } } },
    api: async (path: string) => path.includes('/inbox/')
      ? { cards: [{ action: 'review_work_launch', source_kind: 'work_launch', source_id: 'launch-1', source_version: 2, task_id: 'task-1' }] }
      : { pending_work_launches: [{ ...approval, status: 'awaiting_approval' }] },
    openTask: () => {}, toast: () => {}, storage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) },
    setInterval: (callback: Function) => { timers.push(callback); return 4; }, clearInterval: (id: number) => assert.equal(id, 4)
  };
  const stop = startApprovalNotifications(ui);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(notifications.length, 1);
  const sent = notifications[0] as { extra: Record<string, unknown> };
  assert.deepEqual(sent.extra, approval);
  await (timers[0] as () => void)();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(notifications.length, 1);
  assert.equal(listeners.length, 1);
  listeners[0]!({ actionId: 'dismiss', notification: { extra: approval } });
  stop();
});

test('notification refresh ignores unrelated, stale and missing approval cards and suppresses work after stop', async () => {
  const sent: unknown[] = [], cleared: number[] = [];
  const notification = { sendNotification: (value: unknown) => sent.push(value), onAction: () => Promise.resolve(() => {}) };
  const base = {
    host: { __TAURI__: { notification } }, openTask: () => {}, toast: () => {},
    setInterval: () => 7, clearInterval: (id: number) => cleared.push(id)
  };
  const mismatched = startApprovalNotifications({ ...base, api: async (path: string) => path.includes('/inbox/')
    ? { cards: [
      { action: 'other', source_kind: 'work_launch', source_id: 'launch-1', source_version: 2, task_id: 'task-1' },
      { action: 'review_work_launch', source_kind: 'other', source_id: 'launch-1', source_version: 2, task_id: 'task-1' },
      { action: 'review_work_launch', source_kind: 'work_launch', source_id: 'launch-1', source_version: 2 }
    ] } : { pending_work_launches: [] } });
  await new Promise(resolve => setImmediate(resolve));
  mismatched();
  assert.equal(sent.length, 0);
  assert.deepEqual(cleared, [7]);

  const noStorage = startApprovalNotifications({ ...base, api: async (path: string) => path.includes('/inbox/')
    ? { cards: [{ action: 'review_work_launch', source_kind: 'work_launch', source_id: 'launch-1', source_version: 2, task_id: 'task-1' }] }
    : { pending_work_launches: [{ ...approval, status: 'awaiting_approval' }] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1);
  noStorage();

  const failed = startApprovalNotifications({ ...base, api: async () => { throw new Error('offline'); } });
  await new Promise(resolve => setImmediate(resolve));
  failed();
  assert.deepEqual(cleared, [7, 7, 7]);

  const empty = startApprovalNotifications({ ...base, api: async () => ({}) });
  await new Promise(resolve => setImmediate(resolve));
  empty();

  const absentPending = startApprovalNotifications({ ...base, api: async (path: string) => path.includes('/inbox/')
    ? { cards: [{ action: 'review_work_launch', source_kind: 'work_launch', source_id: 'launch-1', source_version: 2, task_id: 'task-1' }] }
    : {} });
  await new Promise(resolve => setImmediate(resolve));
  absentPending();
});

test('stopping before inbox refresh completes prevents notification delivery', async () => {
  let resolveInbox!: (value: unknown) => void;
  const sent: unknown[] = [];
  const stop = startApprovalNotifications({
    host: { __TAURI__: { notification: { sendNotification: (value: unknown) => sent.push(value), onAction: () => Promise.resolve() } } },
    api: () => new Promise(resolve => { resolveInbox = resolve; }), openTask: () => {}, toast: () => {},
    storage: { getItem: () => null, setItem: () => {} }, setInterval: () => 1, clearInterval: () => {}
  });
  stop();
  resolveInbox({ cards: [{ action: 'review_work_launch', source_kind: 'work_launch', source_id: 'launch-1', source_version: 2, task_id: 'task-1' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 0);
});

test('browser mode does not create timers or native notifications', () => {
  let timers = 0;
  const noNative = startApprovalNotifications({ host: {}, api: () => { throw new Error('unused'); }, setInterval: () => { timers++; }, clearInterval: () => {} });
  assert.doesNotThrow(noNative);
  noNative();
  for (const notification of [{ sendNotification: () => {} }, { onAction: () => {} }, null]) {
    assert.doesNotThrow(() => startApprovalNotifications({ host: { __TAURI__: { notification } }, setInterval: () => { timers++; }, clearInterval: () => {} }));
  }
  assert.equal(timers, 0);
});
