import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitTaskAttempt } from '../workbench/task-submission.js';

function composer() { return { submission: null as null | { fingerprint: string; taskId: string; messageId: string; uncertain?: boolean }, submitting: false }; }
function ids() { let value = 0; return { randomUUID: () => `id-${++value}` }; }

test('a successful task submission binds the initial message and clears its attempt', async () => {
  const state = composer(); const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const result = await submitTaskAttempt({ composer: state, body: { goal: 'goal' }, prompt: 'goal', crypto: ids(), api: async (path, options) => {
    requests.push({ path, body: options.body });
    return path === '/api/tasks' ? { task: { id: options.body.task_id } } : { assistant: { id: 'reply' } };
  } });
  assert.equal(result.task.id, 'task_id1');
  assert.equal(requests[1]?.body.message_id, 'task_message_id2');
  assert.equal(state.submission, null);
  assert.equal(state.submitting, false);
});

test('an uncertain send keeps its identity and blocks a changed draft until the original is reconciled', async () => {
  const state = composer(); const generated = ids(); const attempted: Array<{ path: string; body: Record<string, unknown> }> = [];
  let firstMessageId = '';
  const failed = await submitTaskAttempt({ composer: state, body: { goal: 'first' }, prompt: 'first', crypto: generated,
    api: async (path, options) => {
      attempted.push({ path, body: options.body });
      if (path === '/api/tasks') return { task: { id: options.body.task_id } };
      firstMessageId = String(options.body.message_id);
      throw new Error('response lost after server accepted the message');
    } });
  assert.equal(failed.outcome_unknown, true);
  assert.equal(state.submitting, false);
  assert.equal(state.submission?.uncertain, true);
  const changed = await submitTaskAttempt({ composer: state, body: { goal: 'second' }, prompt: 'second', crypto: generated,
    api: async () => { throw new Error('a changed draft must not be sent'); } });
  assert.equal(changed.outcome_unknown, true);
  assert.equal(attempted.length, 2);
  const replay = await submitTaskAttempt({ composer: state, body: { goal: 'first' }, prompt: 'first', crypto: generated,
    api: async (path, options) => {
      attempted.push({ path, body: options.body });
      return path === '/api/tasks' ? { task: { id: options.body.task_id } } : { assistant: { id: 'reply' } };
    } });
  assert.ok(replay.task);
  assert.equal(attempted[3]?.body.message_id, firstMessageId);
});

test('concurrent clicks are ignored and a retry reuses the same identifiers', async () => {
  const state = composer(); const generated = ids(); let release!: (value: unknown) => void;
  const api = (path: string, options: { body: Record<string, unknown> }) => new Promise<unknown>(resolve => {
    if (path === '/api/tasks') release = resolve;
    else resolve({ assistant: { id: 'reply' } });
  });
  const first = submitTaskAttempt({ composer: state, body: { goal: 'same' }, prompt: 'same', crypto: generated, api });
  const taskId = state.submission?.taskId;
  const ignored = await submitTaskAttempt({ composer: state, body: { goal: 'same' }, prompt: 'same', crypto: generated, api });
  assert.deepEqual(ignored, { ignored: true });
  release({ task: { id: taskId } });
  await first;
  assert.equal(state.submitting, false);
});

test('an unknown message outcome is returned without clearing the retry identity', async () => {
  const state = composer(); const generated = ids(); const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const api = async (path: string, options: { body: Record<string, unknown> }) => {
    calls.push({ path, body: options.body });
    return path === '/api/tasks' ? { task: { id: options.body.task_id } } : { outcome_unknown: true };
  };
  const result = await submitTaskAttempt({ composer: state, body: { goal: 'same' }, prompt: 'same', crypto: generated, api });
  assert.equal(result.outcome_unknown, true);
  assert.equal(result.task_id, state.submission?.taskId);
  assert.equal(state.submitting, false);
  await submitTaskAttempt({ composer: state, body: { goal: 'same' }, prompt: 'same', crypto: generated, api });
  assert.equal(calls[1]?.body.message_id, calls[3]?.body.message_id);
});

test('submission requires a secure id source and a task identity from the Runtime', async () => {
  const state = composer();
  await assert.rejects(submitTaskAttempt({ composer: state, body: { goal: 'goal' }, prompt: 'goal', crypto: null,
    api: async () => ({}) }), /安全的提交编号/u);
  const uncertain = await submitTaskAttempt({ composer: state, body: { goal: 'goal' }, prompt: 'goal', crypto: ids(),
    api: async () => ({}) });
  assert.equal(uncertain.outcome_unknown, true);
  assert.equal(state.submission?.uncertain, true);
  assert.equal(state.submitting, false);
});

test('a known unsent attempt can be replaced by an edited draft', async () => {
  const state = composer(); state.submission = { fingerprint: 'old', taskId: 'task_old', messageId: 'message_old' };
  const result = await submitTaskAttempt({ composer: state, body: { goal: 'new' }, prompt: 'new', crypto: ids(), api: async path =>
    path === '/api/tasks' ? { task: { id: 'task_new' } } : { assistant: { id: 'reply' } } });
  assert.equal(result.task.id, 'task_new');
});
