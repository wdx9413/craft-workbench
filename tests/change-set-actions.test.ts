import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChangeSetSelection } from '../workbench/change-set-actions.js';

test('empty selection never dispatches an apply request', async () => {
  const calls: unknown[] = [], events: string[] = [];
  await applyChangeSetSelection({ api: async (...args: unknown[]) => { calls.push(args); }, url: '/changes/cs', patchIndices: [], expectedStateRevision: 4,
    onEmpty: () => events.push('empty'), onSuccess: () => events.push('success'), onFailure: () => events.push('failure'), onRefresh: () => events.push('refresh') });
  assert.deepEqual(calls, []);
  assert.deepEqual(events, ['empty']);
});

test('selected patches use the viewed workspace revision and report success', async () => {
  const calls: unknown[] = [], events: string[] = [];
  await applyChangeSetSelection({ api: async (...args: unknown[]) => { calls.push(args); return {}; }, url: '/changes/cs', patchIndices: [1, 3], expectedStateRevision: 8,
    onEmpty: () => events.push('empty'), onSuccess: () => events.push('success'), onFailure: () => events.push('failure'), onRefresh: () => events.push('refresh') });
  assert.deepEqual(calls, [['/changes/cs/apply', { method: 'POST', body: { patch_indices: [1, 3], expected_state_revision: 8 } }]]);
  assert.deepEqual(events, ['success']);
});

test('failed optimistic apply is never retried and refreshes the latest conflict view', async () => {
  const calls: unknown[] = [], events: unknown[] = [], stale = new Error('Workspace state changed; refresh before applying ChangeSet');
  await applyChangeSetSelection({ api: async (url: string, init?: unknown) => {
    calls.push([url, init]);
    if (url.endsWith('/apply')) throw stale;
    return { preview: { patches: [{ classification: 'conflict' }] } };
  }, url: '/changes/cs', patchIndices: [0], expectedStateRevision: 8,
  onEmpty: () => events.push('empty'), onSuccess: () => events.push('success'), onFailure: error => events.push(error), onRefresh: detail => events.push(detail) });
  assert.deepEqual(calls, [
    ['/changes/cs/apply', { method: 'POST', body: { patch_indices: [0], expected_state_revision: 8 } }],
    ['/changes/cs', undefined]
  ]);
  assert.equal(events[0], stale);
  assert.deepEqual(events[1], { preview: { patches: [{ classification: 'conflict' }] } });
});

test('refresh errors are reported after the original apply failure', async () => {
  const events: unknown[] = [], stale = new Error('stale'), offline = new Error('offline');
  await applyChangeSetSelection({ api: async (url: string) => { throw url.endsWith('/apply') ? stale : offline; }, url: '/changes/cs', patchIndices: [0], expectedStateRevision: 2,
    onEmpty: () => events.push('empty'), onSuccess: () => events.push('success'), onFailure: error => events.push(error), onRefresh: () => events.push('refresh') });
  assert.deepEqual(events, [stale, offline]);
});
