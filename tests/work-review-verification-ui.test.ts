import assert from 'node:assert/strict';
import test from 'node:test';
import { renderReviewVerifications, mountReviewVerifications } from '../workbench/work-review-verification-ui.js';
const ui = { esc: (value: unknown) => String(value).replaceAll('<', '&lt;'), operatorOf: () => 'reviewer', taskCard: (...v: string[]) => v.join('|') };
const candidate = { id: '<candidate>', version: 1, actor: 'worker', verification_configuration: { image: '<pinned-image>', argv: ['check'], profile_id: 'profile', profile_version: 2, allow_simulated: true } };
test('frozen verifier cards distinguish simulation, incomplete cleanup and independent roles', () => {
  assert.equal(renderReviewVerifications({}, ui), ''); assert.equal(renderReviewVerifications({ work_reviews: [{}] }, ui), '');
  assert.match(renderReviewVerifications({ work_reviews: [candidate] }, ui), /data-verification-action="prepare"/);
  assert.doesNotMatch(renderReviewVerifications({ work_reviews: [{ ...candidate, actor: 'reviewer' }] }, ui), /data-frozen-verification=/);
  assert.doesNotMatch(renderReviewVerifications({ work_reviews: [candidate], task_assignment: { owner: 'reviewer', status: 'active' } }, ui), /data-frozen-verification=/);
  for (const status of ['prepared', 'staging', 'running', 'stopping', 'unknown', 'cancelled', 'custom', 'completed']) {
    const job = { id: 'job', version: 3, status, result: 'passed', basis: 'simulated_container', evidence_ids: ['evidence'] };
    const html = renderReviewVerifications({ work_reviews: [{ ...candidate, verification: job }], task_assignment: { status: 'released' } }, ui);
    assert.match(html, /模拟容器回执/); assert.match(html, /证据 evidence/); assert.match(html, /&lt;pinned-image>/);
    assert.equal(html.includes('data-verification-action="execute"'), status === 'prepared');
    assert.equal(html.includes('data-verification-action="stop"'), ['staging', 'running', 'stopping', 'unknown'].includes(status));
  }
  assert.match(renderReviewVerifications({ work_reviews: [{ ...candidate, verification: { id: 'job', version: 3, status: 'completed', result: 'passed', current: false, cleanup: { confirmation_basis: 'operator_declaration' } } }] }, ui), /回执已失效/);
  for (const result of ['failed', 'blocked']) assert.match(renderReviewVerifications({ work_reviews: [{ ...candidate, verification_configuration: { ...candidate.verification_configuration, allow_simulated: false }, verification: { id: 'job', version: 3, status: 'completed', result, basis: 'docker_runtime' } }] }, ui), /Docker 容器回执/);
});
function fixture(action = 'prepare', accepted = true) {
  const button = { disabled: false, onclick: undefined as (() => Promise<void>) | undefined, getAttribute: (key: string) => ({ 'data-frozen-verification': 'candidate/id', 'data-verification-version': '2', 'data-verification-action': action })[key] };
  const calls: Array<{ path: string; options: any }> = [], messages: string[] = []; let fail = '', refreshes = 0;
  mountReviewVerifications({ querySelectorAll: () => [button] }, { ...ui, confirm: () => accepted, toast: (message: string) => messages.push(message), refresh: () => refreshes++, api: async (path: string, options: any) => { calls.push({ path, options }); if (fail && path.endsWith(fail)) throw fail === '/execute' ? new Error('offline') : 'failed'; return { verification: { id: 'prepared/id', version: 5 } }; } });
  return { button, calls, messages, setFail: (v: string) => { fail = v; }, refreshed: () => refreshes };
}
test('verifier UI explicitly confirms and retries the same prepared job without another preparation', async () => {
  const cancelled = fixture('prepare', false); await cancelled.button.onclick!(); assert.equal(cancelled.calls.length, 0);
  const f = fixture(); f.setFail('/execute'); await f.button.onclick!(); assert.equal(f.button.disabled, false); assert.match(f.messages[0]!, /offline/);
  f.setFail(''); await f.button.onclick!(); assert.equal(f.calls.length, 3); assert.deepEqual(f.calls[1], f.calls[2]); assert.match(f.calls[0]!.path, /candidate%2Fid\/verify-prepare$/); assert.match(f.calls[2]!.path, /prepared%2Fid\/execute$/); assert.equal(f.calls[2]!.options.body.confirmed_command, true); assert.equal(f.refreshed(), 1);
  const prepareFailure = fixture(); prepareFailure.setFail('/verify-prepare'); await prepareFailure.button.onclick!(); assert.match(prepareFailure.messages[0]!, /failed/);
  for (const action of ['execute', 'stop']) { const direct = fixture(action); await direct.button.onclick!(); assert.equal(direct.calls.length, 1); assert.match(direct.calls[0]!.path, new RegExp('/' + action + '$')); assert.equal(direct.calls[0]!.options.body.verification_version, 2); assert.equal(direct.calls[0]!.options.body.confirmed_command, action === 'execute' ? true : undefined); assert.equal(direct.calls[0]!.options.body.confirmed_execution_stopped, action === 'stop' ? true : undefined); }
});
