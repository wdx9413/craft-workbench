import assert from 'node:assert/strict';
import test from 'node:test';
import { createModPages } from '../web/mod-pages.js';

const presentation = {
  icon: (name: string) => `<svg>${name}</svg>`, esc: (value: unknown) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  head: (title: string, _sub: string, right: string) => `<h2>${title}</h2>${right}`, emptyState: (title: string) => `<p>${title}</p>`,
  asideBlock: (_t: string, _r: string, body: string) => body, pill: (text: string) => `<span>${text}</span>`, shortTime: String, countChip: String,
};
const flush = () => new Promise(resolve => setImmediate(resolve));

test('Craft Notes page guides required device notes and reviews only explicit candidates', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [], notifications: string[] = [], refreshes: string[] = [];
  const pages = createModPages({
    api: async (path: string, init?: unknown) => {
      calls.push({ path, body: (init as { body?: unknown } | undefined)?.body });
      if (path.includes('/devices?')) return { items: [{ id: 'laptop', name: 'Laptop', deviceNote: '主力开发机' }] };
      if (path.includes('/candidates')) return { items: [{ id: 'n1', subject_type: 'file', subject_key: 'local:/work/prod.env', text: '只读配置', status: 'candidate', version: 7, evidence_refs: ['e1'], freshness: 'path_only' }] };
      return { status: 'confirmed' };
    },
    presentation, notify: (value: string) => notifications.push(value), fail: (error: Error) => { throw error; }, ask: () => 'obsolete',
    operator: () => 'user:alex', paint: (page: string) => refreshes.push(page), go: () => {}, openInlineOn: () => {},
  });
  const view = await pages.notes();
  assert.ok(view.html.includes('Craft Notes'));
  assert.ok(view.html.includes('设备说明（必填）'));
  assert.ok(view.html.includes('只读配置'));
  assert.ok(view.html.includes('1 条任务使用证据'));
  const create = { onclick: null as null | (() => void), disabled: false };
  const confirm = { onclick: null as null | (() => void), disabled: false, getAttribute: (name: string) => name === 'data-note-confirm' ? 'n1' : name === 'data-note-version' ? '7' : null };
  const revoke = { onclick: null as null | (() => void), disabled: false, getAttribute: (name: string) => name === 'data-note-revoke' ? 'n1' : name === 'data-note-version' ? '7' : null };
  const edit = { value: '生产环境配置，只读' };
  view.mounts[0]({
    querySelector: (selector: string) => selector === '#notes-device-create' ? create : selector === '[data-note-text="n1"]' ? edit : null,
    querySelectorAll: (selector: string) => selector === '[data-note-confirm]' ? [confirm] : selector === '[data-note-revoke]' ? [revoke] : [],
  } as never);
  confirm.onclick!(); await flush();
  revoke.onclick!(); await flush();
  assert.ok(calls.some(item => item.path === '/api/workbench/notes/n1/confirm' && (item.body as { note: string; expected_version: number }).note === '生产环境配置，只读' && (item.body as { expected_version: number }).expected_version === 7));
  assert.ok(calls.some(item => item.path === '/api/workbench/notes/n1/revoke' && (item.body as { revoked_by: string; expected_version: number }).revoked_by === 'user:alex' && (item.body as { expected_version: number }).expected_version === 7));
  assert.deepEqual(refreshes, ['notes', 'notes']);
  assert.ok(notifications.includes('备注已确认并启用'));
  assert.ok(notifications.includes('备注已撤销'));
});

test('device onboarding requires an id and a note, then submits the note as user supplied input', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [], notifications: string[] = [], refreshes: string[] = [];
  const pages = createModPages({
    api: async (path: string, init?: unknown) => {
      calls.push({ path, body: (init as { body?: unknown } | undefined)?.body });
      return { items: [] };
    },
    presentation, notify: (value: string) => notifications.push(value), fail: (error: Error) => { throw error; }, ask: () => null,
    operator: () => 'user', paint: (page: string) => refreshes.push(page), go: () => {}, openInlineOn: () => {},
  });
  const view = await pages.notes();
  const button = { onclick: null as null | (() => void), disabled: false };
  const values: Record<string, string> = { 'notes-device-id': 'laptop-2', 'notes-device-name': '工作站', 'notes-device-note': '本地代理和模型节点' };
  view.mounts[0]({ querySelector: (selector: string) => selector === '#notes-device-create' ? button : null,
    querySelectorAll: () => [], } as never);
  const oldGetById = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: (id: string) => ({ value: values[id] ?? '' }) } });
  try {
    button.onclick!(); await flush();
  } finally {
    if (oldGetById === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: oldGetById });
  }
  const request = calls.find(item => item.path === '/api/workbench/notes/devices' && item.body);
  assert.deepEqual(request?.body, { id: 'laptop-2', name: '工作站', note: '本地代理和模型节点' });
  assert.deepEqual(refreshes, ['notes']);
});

test('important directory and file notes are submitted only as pinned review candidates', async () => {
  const calls: Array<{ path: string; body?: Record<string, unknown> }> = [], notifications: string[] = [];
  const pages = createModPages({
    api: async (path: string, init?: unknown) => {
      calls.push({ path, body: (init as { body?: Record<string, unknown> } | undefined)?.body });
      if (path.includes('/devices?')) return { items: [{ id: 'laptop', name: 'Laptop' }] };
      return { items: [] };
    },
    presentation, notify: (value: string) => notifications.push(value), fail: (error: Error) => { throw error; }, ask: () => null,
    operator: () => 'user', paint: () => {}, go: () => {}, openInlineOn: () => {},
  });
  const view = await pages.notes();
  assert.ok(view.html.includes('重要目录路径'));
  assert.ok(view.html.includes('重要文件路径'));
  const directory = { onclick: null as null | (() => void), disabled: false };
  const file = { onclick: null as null | (() => void), disabled: false };
  const values: Record<string, string> = { 'notes-target-device': 'laptop', 'notes-directory-path': '/work/core',
    'notes-directory-text': '核心后端架构文档', 'notes-file-path': '/work/config/prod.yaml', 'notes-file-text': '生产配置只读' };
  const originalDocument = globalThis.document;
  view.mounts[0]({ querySelector: (selector: string) => selector === '#notes-directory-create' ? directory : selector === '#notes-file-create' ? file : null,
    querySelectorAll: () => [], } as never);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: (id: string) => ({ value: values[id] ?? '' }) } });
  try { directory.onclick!(); file.onclick!(); await flush(); }
  finally { Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument }); }
  assert.deepEqual(calls.filter(item => item.path.endsWith('observe-directory'))[0]?.body,
    { path: '/work/core', note: '核心后端架构文档', device_id: 'laptop', pin: true });
  assert.deepEqual(calls.filter(item => item.path.endsWith('observe-file'))[0]?.body,
    { path: '/work/config/prod.yaml', note: '生产配置只读', device_id: 'laptop', pin: true });
  assert.ok(notifications.some(message => message.includes('未读取文件内容')));
});
