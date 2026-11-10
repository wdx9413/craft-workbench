import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Browser JavaScript is exercised without generated declarations.
import { createLatestRequest, createChangesetPager } from '../workbench/latest-request.js';

test('render seam suppresses obsolete results and obsolete errors across same-page selections', async () => {
  const render = createLatestRequest();
  const commits: string[] = [], failures: string[] = [];
  const commit = (value: string) => { commits.push(value); };
  const fail = (error: Error) => { failures.push(error.message); };
  let finish!: (value: string) => void;
  let oldCurrent!: () => boolean;
  const slow = render((ticket: { current: () => boolean }) => {
    oldCurrent = ticket.current; assert.equal(ticket.current(), true);
    return new Promise<string>((resolve) => { finish = resolve; });
  }, commit, fail);
  await render(() => 'new project', commit, fail);
  assert.equal(oldCurrent(), false);
  finish('old project'); await slow;
  let reject!: (error: Error) => void;
  const staleError = render(() => new Promise<string>((_, rejecter) => { reject = rejecter; }), commit, fail);
  await render(() => 'new task', commit, fail);
  reject(new Error('old failure')); await staleError;
  await render(() => { throw new Error('synchronous failure'); }, commit, fail);
  await render(() => Promise.reject(new Error('current failure')), commit, fail);
  assert.deepEqual(commits, ['new project', 'new task']);
  assert.deepEqual(failures, ['synchronous failure', 'current failure']);
});

test('changeset pager ignores obsolete callbacks and disables pagination until the latest request settles', async () => {
  const callbacks: string[] = [], loading: boolean[] = [];
  const pending: Array<(value: string) => void> = [];
  const pager = createChangesetPager(
    (offset: number) => new Promise<string>(resolve => { pending[offset] = resolve; }),
    (value: string) => callbacks.push(value), (error: Error) => callbacks.push(error.message),
    (busy: boolean) => loading.push(busy),
  );
  const old = pager.load(0); const latest = pager.load(100);
  pending[100]!('new page'); await latest;
  pending[0]!('old page'); await old;
  assert.deepEqual(callbacks, ['new page']);
  assert.deepEqual(loading, [true, true, false]);
});

test('changeset details show only the latest selection and returning to the list invalidates pending detail', async () => {
  const request = createLatestRequest(); const shown: string[] = [];
  let finishA!: (value: string) => void, finishB!: (value: string) => void, finishC!: (value: string) => void;
  const a = request(() => new Promise<string>(resolve => { finishA = resolve; }), (value: string) => shown.push(value), assert.fail);
  const b = request(() => new Promise<string>(resolve => { finishB = resolve; }), (value: string) => shown.push(value), assert.fail);
  finishB('B'); await b; finishA('A'); await a;
  const c = request(() => new Promise<string>(resolve => { finishC = resolve; }), (value: string) => shown.push(value), assert.fail);
  request.invalidate(); finishC('C'); await c;
  assert.deepEqual(shown, ['B']);
});

test('changeset pager reports only current failures and releases the loading state', async () => {
  const errors: string[] = [], loading: boolean[] = [];
  let reject!: (error: Error) => void;
  const pager = createChangesetPager(
    (offset: number) => offset === 0 ? new Promise((_, fail) => { reject = fail; }) : Promise.reject(new Error('current')),
    () => assert.fail('unexpected commit'), (error: Error) => errors.push(error.message), (busy: boolean) => loading.push(busy),
  );
  const old = pager.load(0); await pager.load(1); reject(new Error('obsolete')); await old;
  assert.deepEqual(errors, ['current']); assert.deepEqual(loading, [true, true, false]);
});
