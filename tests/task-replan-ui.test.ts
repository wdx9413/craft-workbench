import assert from 'node:assert/strict';
import test from 'node:test';
import { renderTaskReplans, mountTaskReplans } from '../workbench/task-replan-ui.js';

const ui = { esc: (v: unknown) => String(v).replaceAll('<', '&lt;'), taskCard: (...v: string[]) => v.join('|'), operatorOf: () => 'owner' };
test('replan cards expose current eligible sources and reviewable decisions only to the owner', () => {
  assert.equal(renderTaskReplans({}, ui), '');
  const h = { state_status: 'rework_limit', launch_ref: { id: 'launch', version: 2 }, task_ref: { version: 3 }, task_run_id: 'run', task_run_version: 4 };
  const detail = { task_handoffs: [h, h, { ...h, task_run_version: 3 }, { ...h, state_status: 'done' }], task_runs: [{ id: 'run', version: 4 }], task_replans: ['pending', 'approved', 'consumed', 'rejected', 'revoked', 'custom'].map(status => ({ id: status, version: 1, status, change_summary: '<change>', instruction: '<full>', total_timeout_ms: status === 'pending' ? null : 60000, total_budget_usd: status === 'pending' ? null : 1, expires_at: 'tomorrow', evidence_refs: [{ id: 'evidence', version: 1 }], new_task_run_id: 'next' })) };
  const html = renderTaskReplans(detail, ui);
  assert.equal((html.match(/data-propose-replan=/g) || []).length, 1);
  for (const pattern of [/data-execute-replan/, /data-replan-decision="approve"/, /data-replan-decision="reject"/, /data-replan-decision="revoke"/, /&lt;full>/, /新尝试 next/, /未设置/, /custom/]) assert.match(html, pattern);
  for (const extra of [{ task_assignment: { status: 'active', owner: 'another' } }, { task_runs: [{ id: 'run', version: 4, execution_root_active: false }] }, { task_retries: [{ task_run_id: 'run' }] }]) assert.doesNotMatch(renderTaskReplans({ ...detail, ...extra }, ui), /data-propose-replan=/);
  assert.match(renderTaskReplans({ ...detail, task_assignment: { status: 'active', owner: 'owner' }, task_handoffs: [{ ...h, host_run_ref: { version: 8 } }] }, ui), /data-host-version="8"/);
  assert.match(renderTaskReplans({ task_replans: [{ id: 'x', status: 'pending' }], task_assignment: { status: 'released' } }, ui), /data-decide-replan/);
});
function fixture(answers: Array<string | null> = [], decision = 'approve', accepted = true, hostVersion = '3') {
  const node = (attrs: Record<string, string>) => ({ disabled: false, onclick: undefined as undefined | (() => unknown), getAttribute: (key: string) => attrs[key] ?? null });
  const propose = node({ 'data-propose-replan': 'source', 'data-task-version': '1', 'data-launch-version': '2', 'data-host-version': hostVersion });
  const decide = node({ 'data-decide-replan': 'proposal', 'data-proposal-version': '4', 'data-replan-decision': decision });
  const execute = node({ 'data-execute-replan': 'proposal', 'data-proposal-version': '5' });
  const nodes = { '[data-propose-replan]': [propose], '[data-decide-replan]': [decide], '[data-execute-replan]': [execute] };
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [], messages: string[] = [];
  let fail: unknown = false, refreshes = 0, count = 0;
  mountTaskReplans({ querySelectorAll: (s: string) => nodes[s as keyof typeof nodes] }, { ...ui, api: async (path: string, options: { body: Record<string, unknown> }) => { calls.push({ path, body: options.body }); if (fail) throw fail; }, prompt: () => answers.shift(), confirm: () => accepted, uuid: () => String(++count), toast: (v: string) => messages.push(v), refresh: () => { refreshes++; } });
  return { propose, decide, execute, calls, messages, setFail: (value: unknown) => { fail = value; }, refreshed: () => refreshes };
}
test('replan form validates cancellations and limits before creating an operation', async () => {
  for (const answers of [[null], [' '], ['change', null], ['change', ' '], ['change', 'plan', null], ['change', 'plan', '', null], ...['NaN', '0', '86401', '.0001'].map(v => ['change', 'plan', v, '']), ...['NaN', '0', '-1'].map(v => ['change', 'plan', '', v])]) {
    const f = fixture(answers); await f.propose.onclick!(); assert.equal(f.calls.length, 0); assert.equal(f.propose.disabled, false);
  }
});
test('replan operation retries the same request and dispatches only the approved reference', async () => {
  const f = fixture([' change ', ' full plan ', '60', '1.5']);
  f.setFail(new Error('offline')); await f.propose.onclick!(); assert.equal(f.propose.disabled, false); assert.match(f.messages[0]!, /offline/);
  f.setFail(false); await f.propose.onclick!(); assert.deepEqual(f.calls[0], f.calls[1]); assert.equal(f.calls[0]!.body.total_timeout_ms, 60000); assert.equal(f.calls[0]!.body.total_budget_usd, 1.5); assert.equal(f.calls[0]!.body.prompt, 'full plan');
  await f.decide.onclick!(); assert.equal(f.calls[2]!.body.confirmed_new_plan_and_budget, true); assert.match(f.calls[2]!.path, /\/decide$/);
  await f.execute.onclick!(); assert.deepEqual(f.calls[3]!.body, { proposal_version: 5, actor: 'owner' }); assert.match(f.calls[3]!.path, /\/execute$/); assert.equal(f.refreshed(), 3);
  const blank = fixture(['change', 'plan', '', ''], 'approve', true, ''); await blank.propose.onclick!(); assert.equal(blank.calls[0]!.body.total_timeout_ms, undefined); assert.equal(blank.calls[0]!.body.total_budget_usd, undefined);
  const cancelled = fixture([], 'reject', false); await cancelled.decide.onclick!(); assert.equal(cancelled.calls.length, 0);
  const rejected = fixture([], 'reject'); await rejected.decide.onclick!(); assert.equal(rejected.calls[0]!.body.confirmed_new_plan_and_budget, false);
  rejected.setFail('failed'); await rejected.execute.onclick!(); assert.equal(rejected.execute.disabled, false); assert.match(rejected.messages.at(-1)!, /failed/);
});
