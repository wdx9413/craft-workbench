import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Browser module tested with a small DOM port.
import { mountProjectShell } from '../workbench/project-shell.js';
const settle = async () => { for (let i=0; i<8; i++) await new Promise(resolve => setImmediate(resolve)); };
class Element {
  textContent = ''; className = ''; type = ''; hidden = false; disabled = false; children: Element[] = []; onclick: any; dataset: Record<string, string> = {};
  removed = false;
  append(...items: Element[]) { this.children.push(...items); }
  replaceChildren(...items: Element[]) { this.children = items; this.textContent = ''; }
  get childNodes() { return this.children; }
  querySelector(selector: string) { return this.children.find(item => selector === '.' + item.className) || null; }
  remove() { this.removed = true; }
  closest() { return this; }
}
test('desktop opens a fresh conversation and restores a selected native session', async () => {
  const previous = globalThis.document; (globalThis as any).document = { createElement: () => new Element() };
  try {
    const agent = new Element(), recent = new Element(), fresh = new Element(), nav = new Element();
    const root: any = { classList: { add() {} }, hidden: true, innerHTML: '', querySelector: (key: string) => ({ '.project-agent': agent, '.project-recent': recent, '.project-new': fresh, '.project-nav': nav } as any)[key] };
    const calls: any[] = []; const legacy = { hidden: false };
    const api = async (url: string) => ({ links: [{ id: 's', task_id: 't', workspace: '/proj', provider: 'codex', model: 'm', title: 'First' }, { id: 's2', task_id: 't2', workspace: '/proj', provider: 'codex', model: 'm', title: 'Second' }] });
    const openedPages: string[] = [];
    const shell = mountProjectShell({ root, legacy, api, mountWorkspace: (_: any, opts: any) => calls.push(opts), defaultProvider: 'claude', onOpenPage: (page: string) => openedPages.push(page) });
    shell.show(); await settle();
    assert.equal(calls[0].taskId, ''); assert.equal(calls[0].selectedLink, ''); assert.equal(legacy.hidden, true);
    assert.equal(calls[0].defaultProvider, 'claude');
    calls[0].onOpenPage('plugins'); assert.deepEqual(openedPages, ['plugins']);
    nav.onclick({ target: Object.assign(new Element(), { dataset: { page: 'settings' } }) });
    assert.deepEqual(openedPages, ['plugins', 'settings']);
    assert.doesNotMatch(root.innerHTML, /project-welcome|能力与设置/);
    assert.equal(recent.children[0].children[0].textContent, 'proj');
    assert.equal(recent.children.length, 1); assert.equal(recent.children[0].children.length, 3);
    recent.children[0].children[1].onclick(); assert.equal(calls[1].taskId, 't'); assert.equal(calls[1].selectedLink, 's');
    fresh.onclick(); assert.equal(calls[2].taskId, ''); assert.equal(calls[2].selectedLink, '');
  } finally { (globalThis as any).document = previous; }
});

test('imports one native session from the new-session view', async () => {
  const previous = globalThis.document; (globalThis as any).document = { createElement: () => new Element() };
  try {
    const agent = new Element(), recent = new Element(), fresh = new Element(), nav = new Element();
    const root: any = { classList: { add() {} }, hidden: true, innerHTML: '', querySelector: (key: string) => ({ '.project-agent': agent, '.project-recent': recent, '.project-new': fresh, '.project-nav': nav } as any)[key] };
    const calls: any[] = [], requests: any[] = [];
    const api = async (url: string, options: any = {}) => {
      requests.push({ url, options });
      if (url.includes('/projects?')) return { links: [] };
      if (url === '/api/tasks') return { task: { id: 'imported' } };
      if (url === '/api/workbench/agent-sessions/codex-native' && options.method === 'POST') return { link: { id: 'linked', workspace: '/proj' } };
      if (url === '/api/workbench/agent-sessions/codex-native') return { threads: [{ id: 'old', workspace: '/proj', title: 'Earlier work' }], next_cursor: null };
      return {};
    };
    const shell = mountProjectShell({ root, legacy: { hidden: false }, api, mountWorkspace: (_: any, opts: any) => calls.push(opts) });
    shell.show(); await settle();
    assert.equal(recent.children.length, 0);
    await calls[0].onOpenNative({ id: 'old', workspace: '/proj', title: 'Earlier work' }, 'codex', '', 'ask'); await settle();
    assert.equal(calls.at(-1).taskId, 'imported'); assert.equal(calls.at(-1).selectedLink, 'linked');
    assert.deepEqual(requests.find(item => item.options.method === 'POST' && item.url.endsWith('/codex-native')).options.body, { task_id: 'imported', thread_id: 'old' });
  } finally { (globalThis as any).document = previous; }
});

test('a recent-session cursor loads one more page and disables itself while it does', async () => {
  const previous = globalThis.document; (globalThis as any).document = { createElement: () => new Element() };
  try {
    const agent = new Element(), recent = new Element(), fresh = new Element(), nav = new Element();
    const root: any = { classList: { add() {} }, hidden: true, innerHTML: '', querySelector: (key: string) => ({ '.project-agent': agent, '.project-recent': recent, '.project-new': fresh, '.project-nav': nav } as any)[key] };
    const urls: string[] = [];
    const api = async (url: string) => {
      urls.push(url);
      if (url.includes('cursor=page2')) return { links: [] };
      return { links: [{ id: 's', task_id: 't', workspace: '/proj', provider: 'claude', model: 'm', title: 'First' }], next_cursor: 'page2' };
    };
    const shell = mountProjectShell({ root, legacy: { hidden: false }, api, mountWorkspace: () => {} });
    shell.show(); await settle();
    const group = recent.children[0]!;
    // The page button is appended to the recent list, not into the last group.
    const more = recent.children[recent.children.length - 1]!;
    assert.equal(more.className, 'project-more');
    assert.equal(more.textContent, '加载更多'); assert.equal(more.disabled, false);
    assert.equal(group.children[1]!.children[1]!.textContent, 'Claude Code · m');
    more.onclick(); await settle();
    assert.equal(more.disabled, true);
    assert.equal(more.removed, true);
    assert.ok(urls.some(url => url.includes('cursor=page2')));
    // Without an onOpenPage callback the rail click stays a no-op instead of throwing.
    nav.onclick({ target: { closest: () => ({ dataset: { page: 'memory' } }) } });
  } finally { (globalThis as any).document = previous; }
});

test('importing a native session covers linked, DSH, missing-identity and failure paths', async () => {
  const previous = globalThis.document; (globalThis as any).document = { createElement: () => new Element() };
  try {
    const agent = new Element(), recent = new Element(), fresh = new Element();
    const root: any = { classList: { add() {} }, hidden: true, innerHTML: '', querySelector: (key: string) => ({ '.project-agent': agent, '.project-recent': recent, '.project-new': fresh } as any)[key] };
    const calls: any[] = [], requests: any[] = [];
    let createFails = false, taskShape = 'nested', importFails = false;
    const api = async (url: string, options: any = {}) => {
      requests.push({ url, options });
      if (url === '/api/tasks') {
        if (importFails) throw new Error('offline');
        if (createFails) return {};
        const task = { id: 'created' };
        return taskShape === 'nested' ? { task } : task;
      }
      if (url.includes('-native')) return { link: { id: 'linked', workspace: '/proj' } };
      if (url.includes('/projects?')) return { links: [] };
      return {};
    };
    const shell = mountProjectShell({ root, legacy: { hidden: false }, api, mountWorkspace: (_: any, opts: any) => calls.push(opts) });
    shell.show(); await settle();
    const importNative = calls[0].onOpenNative;
    // A session already carried by a task opens that task instead of creating one.
    await importNative({ id: 'old', workspace: '/proj', title: 'Earlier', linked_task_id: 'task-1', linked_id: 'link-1' }, 'codex', '', 'ask');
    assert.equal(calls.at(-1).taskId, 'task-1'); assert.equal(calls.at(-1).selectedLink, 'link-1');
    assert.equal(requests.some(item => item.url === '/api/tasks'), false);
    // A DSH thread resumes through the DSH route and carries its workspace and permission.
    await importNative({ id: 'dsh-1', workspace: '/proj', title: 'DSH work' }, 'dsh', '', 'full'); await settle();
    assert.deepEqual(requests.find(item => item.url === '/api/workbench/dsh-native').options.body, { task_id: 'created', thread_id: 'dsh-1', workspace: '/proj', permission: 'full' });
    // A Claude thread sends the chosen model instead, and an untitled thread gets a default name.
    await importNative({ id: 'claude-1', workspace: '/proj' }, 'claude', 'sonnet', 'ask'); await settle();
    assert.deepEqual(requests.find(item => item.url.includes('claude-native')).options.body, { task_id: 'created', thread_id: 'claude-1', model: 'sonnet', permission: 'ask' });
    assert.equal(requests.filter(item => item.url === '/api/tasks').at(-1).options.body.title, '历史会话');
    await importNative({ id: 'claude-2', workspace: '/proj', title: 'No model' }, 'claude', '', 'ask'); await settle();
    assert.equal(requests.filter(item => item.url.includes('claude-native')).at(-1).options.body.model, null);
    // A flat task payload still yields the id, and a missing one is refused.
    taskShape = 'flat';
    await importNative({ id: 'x', workspace: '/proj', title: 'Flat' }, 'codex', '', 'ask'); await settle();
    assert.equal(calls.at(-1).taskId, 'created');
    taskShape = 'nested'; createFails = true;
    await assert.rejects(() => importNative({ id: 'x', workspace: '/proj', title: 'No id' }, 'codex', '', 'ask'), /无法接入会话：创建任务失败/);
    createFails = false; importFails = true;
    await assert.rejects(() => importNative({ id: 'x', workspace: '/proj', title: 'Fails' }, 'codex', '', 'ask'), /无法接入会话：offline/);
    importFails = false;
    // A second import while one is in flight is dropped rather than doubled.
    const before = requests.length;
    const first = importNative({ id: 'a', workspace: '/proj', title: 'First' }, 'codex', '', 'ask');
    const second = importNative({ id: 'b', workspace: '/proj', title: 'Second' }, 'codex', '', 'ask');
    await Promise.all([first, second]); await settle();
    assert.equal(requests.slice(before).filter(item => item.url === '/api/tasks').length, 1);
  } finally { (globalThis as any).document = previous; }
});

test('the recent list labels every turn state and survives a stale read', async () => {
  const previous = globalThis.document; (globalThis as any).document = { createElement: () => new Element() };
  try {
    const agent = new Element(), recent = new Element(), fresh = new Element();
    const root: any = { classList: { add() {} }, hidden: true, innerHTML: '', querySelector: (key: string) => ({ '.project-agent': agent, '.project-recent': recent, '.project-new': fresh } as any)[key] };
    let links: any[] | null = [];
    const api = async (_url: string) => ({ links });
    const shell = mountProjectShell({ root, legacy: { hidden: false }, api, mountWorkspace: () => {} });
    shell.show(); await settle();
    assert.equal(recent.textContent, '还没有会话');
    links = [
      { id: 's1', task_id: 't1', workspace: 'proj', provider: 'codex', turn_state: 'running', title: 'Run' },
      { id: 's2', task_id: 't2', workspace: 'proj', provider: 'claude', turn_state: 'unknown', title: 'Unknown' },
      { id: 's3', task_id: 't3', workspace: 'proj', provider: 'claude', turn_state: 'idle', model: 'sonnet', title: 'Idle' },
    ];
    await shell.show(); await settle();
    const group = recent.children[0]!;
    const labels = group.children.slice(1).map((button: any) => button.children[1].textContent);
    assert.deepEqual(labels, ['Codex CLI · 运行中', 'Claude Code · 待核对', 'Claude Code · sonnet']);
    assert.equal(group.children[0].textContent, 'proj', 'a workspace without separators is its own label');
    links = [
      { id: 's4', task_id: 't4', workspace: 'dsh', provider: 'dsh', turn_state: 'idle', title: 'DSH idle' },
      { id: 's5', task_id: 't5', workspace: 'craft', provider: 'craft', model: 'gateway', title: 'Craft' },
      { id: 's6', task_id: 't6', workspace: 'plugin', provider: 'qoder', title: 'Plugin' },
      { id: 's7', task_id: 't7', workspace: 'native', title: 'Native' },
      { id: 'missing-workspace', task_id: 't6', provider: 'codex', title: 'Invalid' },
    ];
    await shell.show(); await settle();
    const mixed = recent.children.filter((item: any) => item.className === 'project-group');
    assert.deepEqual(mixed.flatMap((group: any) => group.children.slice(1).map((button: any) => button.children[1].textContent)), ['DSH · 就绪', 'Craft · gateway', 'qoder · 就绪', '原生工具 · 就绪']);
    links = [{ id: 's6', task_id: 't7', workspace: '/proj', provider: 'claude', title: '' }];
    await shell.show(); await settle();
    const untitled = recent.children[0]!.children[1]!;
    assert.equal(untitled.children[0].textContent, '工作会话');
    assert.equal(untitled.children[1].textContent, 'Claude Code · 就绪');
    links = [{ id: 'root', task_id: 't8', workspace: '/', provider: 'codex', title: 'Root' }];
    await shell.show(); await settle();
    assert.equal(recent.children[0]!.children[0].textContent, '/');
    links = null;
    await shell.show(); await settle();
    assert.equal(recent.textContent, '还没有会话');
  } finally { (globalThis as any).document = previous; }
});

test('a late older refresh cannot replace a newer recent list', async () => {
  const previous = globalThis.document; (globalThis as any).document = { createElement: () => new Element() };
  try {
    const agent = new Element(), recent = new Element(), fresh = new Element();
    const root: any = { classList: { add() {} }, hidden: true, innerHTML: '', querySelector: (key: string) => ({ '.project-agent': agent, '.project-recent': recent, '.project-new': fresh } as any)[key] };
    let release: (() => void) | undefined, calls = 0;
    const api = async () => {
      calls += 1;
      if (calls === 1) return new Promise(resolve => { release = () => resolve({ links: [{ id: 'old', task_id: 'old-task', workspace: '/old', provider: 'codex', title: 'Old' }] }); });
      return { links: [{ id: 'new', task_id: 'new-task', workspace: '/new', provider: 'codex', title: 'New' }] };
    };
    const shell = mountProjectShell({ root, legacy: { hidden: false }, api, mountWorkspace: () => {} });
    shell.show(); await settle();
    shell.show(); await settle();
    release!(); await settle();
    assert.equal(recent.children[0]!.children[0].textContent, 'new');
    assert.equal(recent.children[0]!.children[1]!.children[0].textContent, 'New');
  } finally { (globalThis as any).document = previous; }
});
