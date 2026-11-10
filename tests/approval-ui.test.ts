import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalIsCurrent, mountPendingApprovals, renderPendingApprovals } from '../workbench/approval-ui.js';

const item = { launch_id: 'launch-1', task_run_id: 'run-1', task_id: 'task-1', launch_version: 2, task_run_version: 3, status: 'awaiting_approval' };
const ui = { esc: (value: string) => value.replaceAll('<', '&lt;'), taskCard: (title: string, subtitle: string, body: string) => [title, subtitle, body].join('|') };

test('approval responses belong only to the current mounted task', () => {
  const button = {}, root = { contains: (node: unknown) => node === button };
  assert.equal(approvalIsCurrent({ page: 'task', selectedTask: 'one' }, 'one', root, button), true);
  assert.equal(approvalIsCurrent({ page: 'home', selectedTask: 'one' }, 'one', root, button), false);
  assert.equal(approvalIsCurrent({ page: 'task', selectedTask: 'two' }, 'one', root, button), false);
  assert.equal(approvalIsCurrent({ page: 'task', selectedTask: 'one' }, 'one', root, {}), false);
});

test('approval card is task scoped and carries launch and run CAS versions', () => {
  assert.equal(renderPendingApprovals({}, ui), '');
  assert.equal(renderPendingApprovals({ pending_work_launches: [{ ...item, status: 'denied' }] }, ui), '');
  const html = renderPendingApprovals({ pending_work_launches: [item] }, ui);
  assert.match(html, /data-launch-version="2"/u);
  assert.match(html, /data-task-run-version="3"/u);
  assert.match(html, /通知只用于返回此任务/u);
});

function mountFixture(fail: false | string = false, isCurrent = () => true) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [], messages: string[] = [];
  const buttons = ['approve', 'deny'].map(decision => ({
    disabled: false, onclick: undefined as (() => unknown) | undefined,
    closest: () => row,
    getAttribute: (name: string) => ({ 'data-approval-decision': decision, 'data-launch-id': 'launch-1', 'data-task-run-id': 'run-1', 'data-launch-version': '2', 'data-task-run-version': '3' }[name])
  }));
  const row = {};
  const root = { querySelectorAll: () => buttons, row };
  mountPendingApprovals(root, 'task-1', {
    api: async (path: string, options: { body: Record<string, unknown> }) => { calls.push({ path, body: options.body }); if (fail) { if (fail === 'plain') throw fail; throw new Error('stale'); } return {}; },
    operatorOf: () => 'owner', toast: (message: string) => messages.push(message), refresh: () => messages.push('refresh'), isCurrent,
  });
  return { buttons, calls, messages, root };
}

test('approval and denial submit only decision identity and exact versions from task UI', async () => {
  const f = mountFixture();
  await f.buttons[0]!.onclick!();
  await f.buttons[1]!.onclick!();
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0]!.path, /launch-1\/decide$/u);
  assert.deepEqual(f.calls[0]!.body, { task_id: 'task-1', task_run_id: 'run-1', launch_version: 2, task_run_version: 3, actor: 'owner', approved: true });
  assert.doesNotMatch(renderPendingApprovals({ pending_work_launches: [item] }, ui), /data-approval-prompt|粘贴准备任务/u);
  assert.equal(f.calls[1]!.body.approved, false);
  assert.equal(f.messages.filter(message => message === 'refresh').length, 2);
});

test('a decision response after leaving its task does not update the current view', async () => {
  const f = mountFixture(false, () => false);
  await f.buttons[0]!.onclick!();
  assert.deepEqual(f.messages, []);
  const failed = mountFixture('plain', () => false);
  await failed.buttons[0]!.onclick!();
  assert.deepEqual(failed.messages, []);
});

test('an unknown decision result keeps both choices disabled and requires reconciliation', async () => {
  const failed = mountFixture(true);
  await failed.buttons[0]!.onclick!();
  assert.equal(failed.buttons[0]!.disabled, true);
  assert.equal(failed.buttons[1]!.disabled, true);
  assert.match(failed.messages[0]!, /结果未知/u);
  assert.match(failed.messages[0]!, /stale/u);
  assert.equal(failed.messages.includes('refresh'), false);
  const plain = mountFixture('plain');
  await plain.buttons[0]!.onclick!();
  assert.match(plain.messages[0]!, /plain/u);
});
