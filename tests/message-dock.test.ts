import assert from 'node:assert/strict';
import test from 'node:test';
import { mountMessageDock } from '../workbench/message-dock.js';

// A tiny DOM stand-in: enough to prove rendering and zero-inference display.
function fakeDom() {
  const host = {
    id: '', className: '', innerHTML: '',
    setAttribute(_k: string, _v: string) {},
    remove() {},
    querySelectorAll(selector: string) {
      const out: Array<Record<string, unknown>> = [];
      const matches = this.innerHTML.match(/data-msg-(?:read|process)="([^"]+)"/g) || [];
      for (const m of matches) {
        if (selector.includes('read') && m.startsWith('data-msg-read')) out.push({ getAttribute: () => m.slice(15, -1), onclick: null });
        if (selector.includes('process') && m.startsWith('data-msg-process')) out.push({ getAttribute: () => m.slice(18, -1), onclick: null });
      }
      return out;
    },
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => host,
    body: { appendChild: () => {} },
  };
  return host;
}

test('console batch bar marks selected messages read without any model call', async () => {
  // A DOM stand-in that keeps one stable node per rendered control, so bind()
  // can attach real handlers and we can click them like a user would.
  const controls = new Map<string, Record<string, unknown>>();
  const host = {
    id: '', className: '', innerHTML: '',
    setAttribute(_k: string, _v: string) {}, remove() {},
    querySelectorAll(selector: string) {
      const ids = [...this.innerHTML.matchAll(/data-(msg-check|msg-read|msg-process|batch)="([^"]+)"/g)];
      return ids.filter(([, kind]) => selector.includes(`data-${kind}`)).map(([, kind, value]) => {
        const key = `${kind}:${value}`;
        if (!controls.has(key)) controls.set(key, {
          checked: false, getAttribute: (name: string) => name === `data-${kind}` ? value : null,
          onchange: null, onclick: null,
        });
        return controls.get(key);
      });
    },
  };
  (globalThis as unknown as { document: unknown }).document = { createElement: () => host, body: { appendChild: () => {} } };
  const calls: Array<{ path: string; body?: unknown }> = [];
  const messages = [{ id: 'm1', from: 'a@x', subject: 'A', priority: 'normal', readAt: null, processedAt: null }];
  const dock = mountMessageDock({
    api: async (path: string, init?: unknown) => {
      calls.push({ path, body: init && (init as { body?: unknown }).body });
      return path.includes('/messages/list') ? { items: messages } : { succeeded: 1, failed: 0 };
    },
    modeOf: () => 'control', notify: () => {}, fail: () => {},
    esc: (v: unknown) => String(v ?? ''), icon: (n: string) => `<svg>${n}</svg>`,
  });
  await new Promise<void>((r) => setImmediate(r));
  assert.match(host.innerHTML, /data-msg-check="m1"/u, 'control mode offers a checkbox');
  const check = controls.get('msg-check:m1')!;
  check.checked = true;
  (check.onchange as () => void)();
  assert.match(host.innerHTML, /data-batch="read"/u, 'selecting reveals the batch bar');
  const read = controls.get('batch:read')!;
  (read.onclick as () => void)();
  await new Promise<void>((r) => setImmediate(r));
  assert.ok(calls.some((c) => c.path === '/api/workbench/messages/batch'
    && (c.body as { action: string; ids: string[] }).action === 'read'
    && (c.body as { ids: string[] }).ids[0] === 'm1'));
  dock.stop();
});

test('workshop message can be dragged into the chat composer as context', async () => {
  const host = fakeDom();
  const input = { value: '先看看', focus() {} };
  const notifications: string[] = [];
  const dock = mountMessageDock({
    api: async (path: string) => path.includes('/messages/list')
      ? { items: [{ id: 'm1', from: '张总', subject: '下周构想反馈', priority: 'high', readAt: null, processedAt: null }] } : {},
    modeOf: () => 'workshop', notify: (m: string) => notifications.push(m), fail: () => {},
    esc: (v: unknown) => String(v ?? ''), icon: (n: string) => `<svg>${n}</svg>`,
    composerOf: () => input,
  });
  await new Promise<void>((r) => setImmediate(r));
  assert.match(host.innerHTML, /data-msg-drag="m1"/u);
  // The real handler is bound by bind(); drive it with a drag event.
  const card = { getAttribute: () => 'm1', ondragstart: null as null | ((e: unknown) => void) };
  const originalQuery = host.querySelectorAll.bind(host);
  host.querySelectorAll = ((selector: string) => selector.includes('data-msg-drag') ? [card] : originalQuery(selector)) as typeof host.querySelectorAll;
  // Re-render to bind against the augmented node set.
  dock.refresh(); await new Promise<void>((r) => setImmediate(r));
  const stored: Record<string, string> = {};
  card.ondragstart?.({ dataTransfer: { setData: (k: string, v: string) => { stored[k] = v; } } });
  assert.match(input.value, /参考消息：张总《下周构想反馈》/u);
  assert.match(stored['text/plain'], /下周构想反馈/u);
  assert.ok(notifications.some((m) => m.includes('输入框')));
  dock.stop();
});

test('a blocked process intent is not reported as dispatched', async () => {
  const controls = new Map<string, Record<string, unknown>>();
  const host = {
    id: '', className: '', innerHTML: '', setAttribute(_k: string, _v: string) {}, remove() {},
    querySelectorAll(selector: string) {
      const ids = [...this.innerHTML.matchAll(/data-(msg-read|msg-process|msg-check|batch)="([^"]+)"/g)];
      return ids.filter(([, kind]) => selector.includes(`data-${kind}`)).map(([, kind, value]) => {
        const key = `${kind}:${value}`;
        if (!controls.has(key)) controls.set(key, { getAttribute: () => value, onclick: null, onchange: null, checked: false });
        return controls.get(key);
      });
    },
  };
  (globalThis as unknown as { document: unknown }).document = { createElement: () => host, body: { appendChild: () => {} } };
  const notifications: string[] = [];
  const messages = [{ id: 'm1', from: 'ci', subject: '构建失败', priority: 'high', readAt: null, processedAt: null }];
  const dock = mountMessageDock({
    api: async (path: string) => {
      if (path.includes('/messages/list')) return { items: messages };
      if (path.includes('process-intent')) return { dispatched: false, status: 'blocked',
        questions: [{ title: '选目录', options: ['D:/a', 'D:/b'] }] };
      return {};
    },
    modeOf: () => 'control', notify: (m: string) => notifications.push(m), fail: () => {},
    esc: (v: unknown) => String(v ?? ''), icon: (n: string) => `<svg>${n}</svg>`,
  });
  await new Promise<void>((r) => setImmediate(r));
  const processNode = controls.get('msg-process:m1')!;
  assert.ok(processNode.onclick, 'process button is bound');
  (processNode.onclick as () => void)();
  await new Promise<void>((r) => setImmediate(r));
  assert.ok(notifications.some((m) => m.includes('候选：D:/a / D:/b')));
  assert.equal(notifications.some((m) => m.includes('已派发')), false);
  assert.match(host.innerHTML, /data-msg-id="m1"/u, 'the message stays in the inbox');
  dock.stop();
});

test('message dock renders all three mode projections without any model call', async () => {
  const host = fakeDom();
  const calls: string[] = [];
  const messages = [{ id: 'm1', from: 'boss@x.com', subject: '下周构想反馈', priority: 'high', readAt: null, processedAt: null }];
  let mode = 'pilot';
  const dock = mountMessageDock({
    api: async (path: string) => { calls.push(path); return path.includes('/messages/list') ? { items: messages } : {}; },
    modeOf: () => mode, notify: () => {}, fail: () => {},
    esc: (v: unknown) => String(v ?? ''), icon: (n: string) => `<svg>${n}</svg>`,
  });
  await new Promise<void>((r) => setImmediate(r));
  assert.equal((host as { innerHTML: string }).innerHTML.includes('领航员提醒'), true);
  mode = 'control'; dock.refresh(); await new Promise<void>((r) => setImmediate(r));
  assert.equal((host as { innerHTML: string }).innerHTML.includes('外部消息'), true);
  mode = 'workshop'; dock.refresh(); await new Promise<void>((r) => setImmediate(r));
  assert.equal((host as { innerHTML: string }).innerHTML.includes('msg-toast'), true);
  // Zero-token contract: only the inbox list endpoint was ever called.
  assert.equal(calls.every((c) => c.includes('/messages/list') || c.includes('/messages/')), true);
  assert.equal(calls.some((c) => c.includes('model') || c.includes('chat')), false);
  dock.stop();
});

test('console source form pulls a drop directory through the poll route and refreshes', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const sourceField = { value: 'C:\\inbox-drop' };
  const pollBtn: { onclick?: () => void; disabled?: boolean } = {};
  const host: Record<string, unknown> = {
    id: '', className: '', innerHTML: '',
    setAttribute() {}, remove() {},
    querySelectorAll: (selector: string) => selector.includes('data-msg-poll') ? [pollBtn] : [],
    querySelector: (selector: string) => selector === '#msg-source-dir' ? sourceField
      : selector === '[data-msg-poll]' ? pollBtn : null,
  };
  (globalThis as unknown as { document: unknown }).document = { createElement: () => host, body: { appendChild: () => {} } };
  const dock = mountMessageDock({
    api: async (path: string, init?: { body?: unknown }) => {
      calls.push({ path, body: init && init.body });
      if (path.includes('/messages/poll')) return { reports: [{ source: 'drop', ingested: 2 }], ingested: 2 };
      if (path.includes('/messages/list')) return { items: [] };
      return {};
    },
    modeOf: () => 'control', notify: () => {}, fail: () => {},
    esc: (value: unknown) => String(value ?? ''), icon: () => '', composerOf: () => null,
  });
  await new Promise<void>((r) => setImmediate(r));
  assert.match(String(host.innerHTML), /data-msg-poll/u, 'control mode exposes a source poll form');
  pollBtn.onclick!();
  await new Promise<void>((r) => setImmediate(r));
  const poll = calls.find((c) => c.path === '/api/workbench/messages/poll');
  assert.deepEqual(poll && poll.body, { drop_dirs: ['C:\\inbox-drop'] });
  assert.equal(pollBtn.disabled, false);
  dock.stop();
});
