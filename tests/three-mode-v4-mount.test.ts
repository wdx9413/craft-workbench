// V4 · 端到端挂载：把真实 UI 模块接到真实 HTTP mock 服务上。
//
// 前几轮 V4 只测了 API 合同；这里把 message-dock.js / native-tools-panel.js
// 真正挂到 DOM 桩并用 fetch 驱动通过 node:http 服务，证明三模式消息流、
// 批量已读的状态变化、工具目录读回都走同一套 Runtime 合同。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockServer } from '../scripts/mock-runtime-server.mjs';
import { mountMessageDock } from '../workbench/message-dock.js';
import { mountNativeTools } from '../workbench/native-tools-panel.js';

const esc = (value) => String(value ?? '');
const icon = (name) => `<svg>${name}</svg>`;

/** Wait for the real HTTP poll to land (fetch spans several event-loop ticks). */
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function dockDom() {
  const controls = new Map();
  const host = {
    id: '', className: '', innerHTML: '', setAttribute() {}, remove() {},
    querySelectorAll(selector) {
      const ids = [...this.innerHTML.matchAll(/data-(msg-check|msg-read|msg-process|batch)="([^"]+)"/g)];
      return ids.filter(([, kind]) => selector.includes(`data-${kind}`)).map(([, kind, value]) => {
        const key = `${kind}:${value}`;
        if (!controls.has(key)) controls.set(key, {
          checked: false, getAttribute: (name) => (name === `data-${kind}` ? value : null),
          onchange: null, onclick: null,
        });
        return controls.get(key);
      });
    },
  };
  const saved = globalThis.document;
  globalThis.document = { createElement: () => host, body: { appendChild: () => {} } };
  return { host, controls, restore: () => { globalThis.document = saved; } };
}

async function withServer(run) {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, opts) => {
    const method = opts?.method ?? 'GET';
    const response = await fetch(base + path, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
      body: method === 'POST' ? JSON.stringify(opts?.body ?? {}) : undefined,
    });
    if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
    return response.json();
  };
  try { return await run(base, api); } finally { await new Promise((done) => server.close(done)); }
}

test('V4 e2e: message dock renders three modes from the real HTTP service', async () => {
  await withServer(async (base, api) => {
    const dom = dockDom();
    let dock;
    try {
      let mode = 'pilot';
      dock = mountMessageDock({ api, modeOf: () => mode, notify: () => {}, fail: (e) => { throw e; }, esc, icon });
      await waitFor(() => dom.host.innerHTML.includes('领航员提醒'), 'pilot dock render');
      assert.match(dom.host.innerHTML, /领航员提醒/u);
      mode = 'control'; dock.refresh();
      await waitFor(() => dom.host.innerHTML.includes('外部消息（待办）'), 'control dock render');
      assert.match(dom.host.innerHTML, /外部消息（待办）/u);
      assert.match(dom.host.innerHTML, /data-msg-check="msg-1"/u);
      mode = 'workshop'; dock.refresh();
      await waitFor(() => dom.host.innerHTML.includes('消息流'), 'workshop dock render');
      assert.match(dom.host.innerHTML, /消息流/u);
    } finally { dock?.stop(); dom.restore(); }
  });
});

test('V4 e2e: 控制台批量已读经 UI 点击真实改变服务端消息状态', async () => {
  await withServer(async (base, api) => {
    const dom = dockDom();
    let dock;
    try {
      dock = mountMessageDock({ api, modeOf: () => 'control', notify: () => {}, fail: (e) => { throw e; }, esc, icon });
      await waitFor(() => dom.host.innerHTML.includes('data-msg-check="msg-1"'), 'message checkbox');
      const check = dom.controls.get('msg-check:msg-1');
      assert.ok(check, 'message checkbox is rendered from HTTP list');
      check.checked = true;
      check.onchange();
      assert.match(dom.host.innerHTML, /data-batch="read"/u);
      const read = dom.controls.get('batch:read');
      read.onclick();
      await waitFor(async () => {
        const list = await api('/api/workbench/messages/list?unread_only=true');
        return !list.items.some((m) => m.id === 'msg-1');
      }, 'server-side read state');
      // read back through the same HTTP service, not through the UI cache
      const after = await api('/api/workbench/messages/list?unread_only=true');
      assert.ok(!after.items.some((m) => m.id === 'msg-1'), 'msg-1 is marked read on the server');
      assert.ok(after.items.some((m) => m.id === 'msg-2'), 'unrelated message is untouched');
    } finally { dock?.stop(); dom.restore(); }
  });
});

test('V4 e2e: native tools panel reads the tool catalog from the HTTP service', async () => {
  await withServer(async (base, api) => {
    const nodes = new Map();
    const node = (selector) => { if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', hidden: false, disabled: false, value: '', querySelectorAll: () => [] }); return nodes.get(selector); };
    const host = { querySelector: (selector) => nodes.get(selector) ?? null };
    for (const key of ['refresh', 'status', 'approvals', 'tools']) node(`[data-native="${key}"]`);
    const saved = globalThis.document;
    globalThis.document = { createElement: () => ({}) };
    try {
      const panel = mountNativeTools(host, { api, esc, clock: { setTimeout: () => 0, clearTimeout: () => {} }, onNotice: () => {} });
      await panel.refresh();
      assert.match(nodes.get('[data-native="tools"]').innerHTML, /read_file/u);
      panel.destroy();
    } finally { globalThis.document = saved; }
  });
});
