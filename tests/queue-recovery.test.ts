import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Browser module exercised through a DOM port.
import { appendQueueRecovery } from '../workbench/queue-recovery.js';

class Element {
  className = ''; type = ''; textContent = ''; children: Element[] = []; attributes: Record<string, string> = {};
  onclick: (() => unknown) | undefined; onkeydown: ((event: { key: string; preventDefault(): void }) => void) | undefined;
  focused = false;
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]) { this.children = nodes; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  focus() { this.focused = true; }
}

function fixture(resolve: (action: string) => Promise<Record<string, unknown>>, settings: { blocked?: boolean; callbackFailure?: boolean } = {}) {
  const previous = globalThis.document; (globalThis as unknown as { document: unknown }).document = { createElement: () => new Element() };
  const row = new Element(), outcomes: Record<string, unknown>[] = [], calls: string[] = [];
  let current = true, holds = 0, releases = 0;
  appendQueueRecovery(row, {
    resolve: async (action: string) => { calls.push(action); return resolve(action); },
    isCurrent: () => current,
    hold: () => { holds++; return settings.blocked !== true; },
    release: () => { releases++; },
    onResolved: async (result: Record<string, unknown>) => { if (settings.callbackFailure) throw new Error('view refresh failed'); outcomes.push(result); },
  });
  const controls = row.children[0];
  return { row, controls, outcomes, calls, current: (value: boolean) => { current = value; },
    counters: () => ({ holds, releases }), button: (label: string) => { const button = controls.children.find(node => node.type === 'button' && node.textContent === label); assert.ok(button, `missing ${label}`); return button; },
    close: () => { (globalThis as unknown as { document: unknown }).document = previous; } };
}

test('recovery waits for acknowledgement and prevents duplicate requests while retaining accessible state', async () => {
  let release!: (value: Record<string, unknown>) => void;
  const wait = new Promise<Record<string, unknown>>(resolve => { release = resolve; });
  const f = fixture(async () => wait);
  try {
    assert.equal(f.controls.attributes.role, 'group'); assert.equal(f.controls.attributes['aria-label'], '核对排队消息');
    const inspect = f.button('核对'); const pending = inspect.onclick!();
    assert.equal(f.controls.attributes['aria-busy'], 'true'); assert.equal(f.outcomes.length, 0);
    await inspect.onclick!(); assert.deepEqual(f.calls, ['inspect']);
    f.controls.onkeydown!({ key: 'Escape', preventDefault() { assert.fail('pending recovery must not be dismissed'); } });
    release({ resolved: true, outcome: 'accepted' }); await pending;
    assert.deepEqual(f.outcomes, [{ resolved: true, outcome: 'accepted' }]);
    assert.equal(f.controls.attributes['aria-busy'], 'false'); assert.equal(f.counters().releases, 0);
  } finally { f.close(); }
});

test('unknown input requires explicit inline discard and initially focuses retaining the message', async () => {
  let discard!: (value: Record<string, unknown>) => void;
  const wait = new Promise<Record<string, unknown>>(resolve => { discard = resolve; });
  const f = fixture(async action => action === 'inspect' ? { resolved: false, manual_discard_allowed: true } : wait);
  try {
    await f.button('核对').onclick!();
    const keep = f.button('保留消息'); assert.equal(keep.focused, true);
    assert.match(f.controls.children[0].textContent, /是否已发送仍未确认/);
    const pending = f.button('已核对，移出队列').onclick!();
    keep.onclick!(); assert.equal(f.counters().releases, 0);
    discard({ resolved: true, outcome: 'discarded' }); await pending;
    assert.deepEqual(f.calls, ['inspect', 'discard']); assert.equal(f.outcomes[0].outcome, 'discarded');
  } finally { f.close(); }
});

test('unsettled native turns cannot be discarded and Escape safely retains the input', async () => {
  const f = fixture(async () => ({ resolved: false, manual_discard_allowed: false }));
  try {
    await f.button('核对').onclick!();
    assert.equal(f.controls.children.some(node => node.textContent.includes('移出队列')), false);
    assert.match(f.controls.children[0].textContent, /先查看原生历史/);
    f.controls.onkeydown!({ key: 'Enter', preventDefault() { assert.fail('unrelated key handled'); } });
    assert.equal(f.counters().releases, 0);
    f.controls.onkeydown!({ key: 'Escape', preventDefault() {} }); assert.equal(f.counters().releases, 1);
    f.current(false); f.button('保留消息').onclick!(); assert.equal(f.counters().releases, 1);
  } finally { f.close(); }
});

test('network, conflict and view-refresh errors preserve recovery controls without automatic retries', async () => {
  let fail = true;
  const f = fixture(async () => { if (fail) throw new Error('refresh before recovery'); return { resolved: true, outcome: 'accepted' }; });
  try {
    await f.button('核对').onclick!(); assert.equal(f.outcomes.length, 0);
    assert.deepEqual(f.calls, ['inspect']); assert.match(f.controls.children[0].textContent, /核对未完成/);
    assert.equal(f.button('保留消息').focused, true);
    fail = false; await f.button('重试核对').onclick!(); assert.equal(f.outcomes.length, 1);
  } finally { f.close(); }
  const refresh = fixture(async () => ({ resolved: true }), { callbackFailure: true });
  try {
    await refresh.button('核对').onclick!(); assert.match(refresh.controls.children[0].textContent, /view refresh failed/);
    refresh.button('保留消息').onclick!(); assert.equal(refresh.counters().releases, 1);
  } finally { refresh.close(); }
});

test('session switches discard stale success and failure responses, and another row edit blocks recovery', async () => {
  for (const fail of [false, true]) {
    let finish!: () => void;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const f = fixture(async () => { await wait; if (fail) throw new Error('late failure'); return { resolved: true }; });
    try {
      const pending = f.button('核对').onclick!(); f.current(false); finish(); await pending;
      assert.equal(f.outcomes.length, 0); assert.equal(f.counters().releases, 0);
      assert.equal(f.controls.attributes['aria-busy'], 'true');
    } finally { f.close(); }
  }
  const blocked = fixture(async () => ({ resolved: true }), { blocked: true });
  try { await blocked.button('核对').onclick!(); assert.equal(blocked.calls.length, 0); blocked.current(false); await blocked.button('核对').onclick!(); assert.equal(blocked.counters().holds, 1); }
  finally { blocked.close(); }
});
