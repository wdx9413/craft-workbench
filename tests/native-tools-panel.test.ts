import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalLabel, argumentTemplate, mountNativeTools } from '../workbench/native-tools-panel.js';

/** A node whose querySelectorAll reads the data attributes the panel just wrote. */
class Node {
  innerHTML = ''; textContent = ''; hidden = false; disabled = false; value = ''; onclick: ((...args: unknown[]) => unknown) | undefined;
  private attrs = new Map<string, string>();
  private cache = new Map<string, Node[]>();
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  getAttribute(key: string) { return this.attrs.get(key) ?? null; }
  querySelectorAll(selector: string) {
    // The panel attaches handlers to the nodes it gets back, so the same markup
    // must yield the same node objects on a later call.
    const key = selector + '\u0000' + this.innerHTML;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const name = selector.slice(1, -1).split('=')[0]!;
    const pattern = new RegExp(name + '="([^"]*)"', 'g');
    const found: Node[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(this.innerHTML)) !== null) { const node = new Node(); node.setAttribute(name, match[1]!); found.push(node); }
    this.cache.set(key, found);
    return found;
  }
}

const esc = (value: unknown) => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[ch]!);

function harness() {
  const nodes = new Map<string, Node>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector)!; };
  const host = { innerHTML: '', querySelector: (selector: string) => nodes.get(selector) ?? null };
  for (const key of ['refresh', 'status', 'approvals', 'tools']) node(`[data-native="${key}"]`);
  for (const key of ['args', 'out']) node(`[data-native-${key}="0"]`);
  return { nodes, node, host };
}

test('the argument skeleton follows the declared types and never invents optional keys', () => {
  assert.equal(argumentTemplate({ properties: { a: { type: 'string' }, b: { type: 'integer' }, c: { type: 'number' },
    d: { type: 'boolean' }, e: { type: 'array' }, f: { type: 'object' }, g: {} }, required: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
  '{\n  "a": "",\n  "b": 0,\n  "c": 0,\n  "d": false,\n  "e": [],\n  "f": {},\n  "g": ""\n}');
  assert.equal(argumentTemplate({}), '{}');
  assert.equal(argumentTemplate(undefined), '{}');
  assert.equal(argumentTemplate({ properties: { a: null }, required: ['a'] }), '{\n  "a": ""\n}');
  assert.equal(approvalLabel({ action: 'workspace_write', effect: 'local_write' }), 'workspace_write · local_write');
  assert.equal(approvalLabel(undefined), 'unknown · unknown');
  const idle = mountNativeTools(null, { api: async () => ({}), esc });
  idle.refresh(); idle.destroy();
});

test('mounting lists tools with a template and shows the approval queue', async () => {
  const { node, host } = harness();
  const calls: string[] = [];
  const api = async (path: string) => {
    calls.push(path);
    if (path.endsWith('/native-tools')) return { tools: [{ name: 'workspace_list', description: '列出文件', parameters: { properties: { workspace: { type: 'string' } }, required: ['workspace'] } }] };
    if (path.endsWith('/internal-approvals')) return { approvals: [{ id: 'a1', action: 'workspace_write', effect: 'local_write', args_digest: 'd'.repeat(64), expires_at: '2026-01-01T00:00:00.000Z' }] };
    return {};
  };
  const notices: string[] = [];
  const panel = mountNativeTools(host, { api, esc, onNotice: (text: string) => notices.push(text) });
  await panel.refresh();
  assert.match(node('[data-native="tools"]').innerHTML, /workspace_list/);
  assert.match(node('[data-native="tools"]').innerHTML, /&quot;workspace&quot;/);
  assert.match(node('[data-native="approvals"]').innerHTML, /待批准的原生工具调用/);
  assert.match(node('[data-native="approvals"]').innerHTML, /workspace_write · local_write/);
  const approve = node('[data-native="approvals"]').querySelectorAll('[data-native-approve]')[0]!;
  await approve.onclick!();
  assert.ok(calls.some(path => path.endsWith('/internal-approvals/a1')));
  assert.deepEqual(notices, ['已批准这次调用。']);
  node('[data-native="refresh"]').onclick!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(node('[data-native="status"]').textContent, '已刷新。');
  panel.destroy();
});

test('a declined or unconfirmed decision keeps the record and reports it', async () => {
  const { node, host } = harness();
  let fail = false;
  const api = async (path: string, options?: { body: { decision: string } }) => {
    if (path.endsWith('/native-tools')) return { tools: [] };
    if (options) { if (fail) throw new Error('offline'); return {}; }
    return { approvals: [{ id: 'a2', action: 'command_run', effect: 'destructive', args_digest: 'e'.repeat(64), expires_at: 'x' }] };
  };
  const notices: string[] = [];
  const panel = mountNativeTools(host, { api, esc, onNotice: (text: string) => notices.push(text) });
  await panel.refresh();
  assert.match(node('[data-native="tools"]').innerHTML, /原生工具目录不可用/);
  await node('[data-native="approvals"]').querySelectorAll('[data-native-decline]')[0]!.onclick!();
  assert.equal(notices[0], '已拒绝这次调用。');
  fail = true;
  await node('[data-native="approvals"]').querySelectorAll('[data-native-approve]')[0]!.onclick!();
  assert.match(notices[1]!, /审批未确认：offline/);
  panel.destroy();
  // A panel that has been unmounted ignores later clicks.
  await node('[data-native="approvals"]').querySelectorAll('[data-native-approve]')[0]!.onclick!();
});

test('a trial rejects malformed arguments before it reaches the gateway', async () => {
  const { node, host } = harness();
  const calls: string[] = [];
  let failApprovals = false;
  const api = async (path: string) => {
    calls.push(path);
    if (path.endsWith('/native-tools')) return { tools: [{ name: 'command_run', description: '', parameters: {} }] };
    if (failApprovals) throw new Error('queue down');
    return { approvals: [] };
  };
  const panel = mountNativeTools(host, { api, esc });
  await panel.refresh();
  const out = node('[data-native-out="0"]');
  node('[data-native-args="0"]').value = 'not json';
  const run = node('[data-native="tools"]').querySelectorAll('[data-native-run]')[0]!;
  await run.onclick!();
  assert.equal(out.textContent, '参数不是合法 JSON。');
  node('[data-native-args="0"]').value = '[]';
  await run.onclick!();
  assert.equal(out.textContent, '参数必须是一个 JSON 对象。');
  assert.equal(calls.some(path => path.endsWith('/call')), false);
  // Mounted without a notice hook, a read failure still has to be survivable.
  failApprovals = true; await panel.refresh();
  panel.destroy();
});

test('a trial posts the tool call, follows the queue while it is open and reports the result', async () => {
  const { node, host } = harness();
  const timers: Array<() => void> = [];
  let release: (() => void) | undefined, failCall = false;
  const posts: Array<{ path: string; body: unknown }> = [];
  const api = async (path: string, options?: { body: unknown }) => {
    if (options && path.endsWith('/call')) {
      posts.push({ path, body: options.body });
      await new Promise<void>(resolve => { release = resolve; });
      if (failCall) throw new Error('denied by host policy');
      return { result: { entries: ['a.txt'] } };
    }
    if (options) return {};
    return path.endsWith('/native-tools') ? { tools: [{ name: 'workspace_list', description: '', parameters: { properties: { workspace: { type: 'string' } }, required: ['workspace'] } }] } : { approvals: [] };
  };
  const notices: string[] = [];
  const clock = { setTimeout: (callback: () => void) => { timers.push(callback); return 1; }, clearTimeout: () => undefined };
  const panel = mountNativeTools(host, { api, esc, clock, onNotice: (text: string) => notices.push(text) });
  await panel.refresh();
  node('[data-native-args="0"]').value = JSON.stringify({ workspace: '/tmp' });
  const run = node('[data-native="tools"]').querySelectorAll('[data-native-run]')[0]!;
  const inFlight = run.onclick!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 1, 'an open trial polls the approval queue');
  release!(); await inFlight;
  assert.deepEqual(posts[0], { path: '/api/workbench/native-tools/call', body: { tool: 'workspace_list', args: { workspace: '/tmp' } } });
  assert.match(node('[data-native-out="0"]').textContent, /a\.txt/);
  assert.deepEqual(notices, ['workspace_list 执行完成。']);
  timers[0]!(); await new Promise(resolve => setImmediate(resolve));
  failCall = true;
  const failed = run.onclick!(); release!(); await failed;
  assert.match(node('[data-native-out="0"]').textContent, /执行失败：denied by host policy/);
  panel.destroy();
});

test('read failures are named instead of silently emptied', async () => {
  const { node, host } = harness();
  let failTools = true, failApprovals = true;
  const api = async (path: string) => {
    if (path.endsWith('/native-tools')) { if (failTools) throw new Error('catalogue down'); return { tools: [] }; }
    if (failApprovals) throw new Error('queue down');
    return { approvals: [] };
  };
  const notices: Array<[string, boolean | undefined]> = [];
  const clock = { setTimeout: () => 1 };
  const panel = mountNativeTools(host, { api, esc, clock, onNotice: (text: string, bad?: boolean) => notices.push([text, bad]) });
  await panel.refresh();
  assert.match(node('[data-native="status"]').textContent, /工具目录读取失败：catalogue down/);
  assert.match(notices[0]![0], /待批准列表读取失败：queue down/);
  failTools = false; failApprovals = false;
  await panel.refresh();
  assert.match(node('[data-native="tools"]').innerHTML, /原生工具目录不可用/);
  assert.equal(node('[data-native="approvals"]').innerHTML, '');
  panel.destroy();
  panel.refresh();
  node('[data-native="refresh"]').onclick!();
});

test('stale rows, missing fields and non-array payloads never throw', async () => {
  const nodes = new Map<string, Node>();
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector)!; };
  const host = { innerHTML: '', querySelector: (selector: string) => nodes.get(selector) ?? null };
  for (const key of ['refresh', 'status', 'approvals', 'tools']) node(`[data-native="${key}"]`);
  // No argument or output field for index 0: a trial still has to fail closed.
  let approvals: unknown = [{ id: 'a3', action: 'mcp_call', effect: 'external_write' }];
  let tools: unknown = [{ name: 'workspace_list', description: '', parameters: {} }];
  const api = async (path: string) => path.endsWith('/native-tools') ? { tools } : { approvals };
  const panel = mountNativeTools(host, { api, esc, onNotice: () => undefined });
  await panel.refresh();
  assert.match(node('[data-native="approvals"]').innerHTML, /到期 未知/);
  const approve = node('[data-native="approvals"]').querySelectorAll('[data-native-approve]')[0]!;
  const run = node('[data-native="tools"]').querySelectorAll('[data-native-run]')[0]!;
  // A tool whose argument field is missing still fails closed instead of throwing.
  await run.onclick!();
  approvals = []; tools = [];
  await panel.refresh();
  await approve.onclick!();
  await run.onclick!();
  tools = 'not an array'; approvals = {};
  await panel.refresh();
  assert.match(node('[data-native="tools"]').innerHTML, /原生工具目录不可用/);
  assert.equal(node('[data-native="approvals"]').innerHTML, '');
  panel.destroy();
});

test('a destroyed trial stops, and an unmounted trial stops polling once its reply lands', async () => {
  const { node, host } = harness();
  const timers: Array<() => void> = [];
  let releaseCall: (() => void) | undefined, releasePoll: (() => void) | undefined, deferPoll = false;
  const api = async (path: string, options?: unknown) => {
    if (!options && path.endsWith('/native-tools')) return { tools: [{ name: 'workspace_list', description: '', parameters: {} }] };
    if (options && path.endsWith('/call')) { await new Promise<void>(resolve => { releaseCall = resolve; }); return {}; }
    if (!options) { if (deferPoll) { deferPoll = false; await new Promise<void>(resolve => { releasePoll = resolve; }); } return { approvals: [] }; }
    return {};
  };
  const clock = { setTimeout: (callback: () => void) => { timers.push(callback); return 1; }, clearTimeout: () => undefined };
  const panel = mountNativeTools(host, { api, esc, clock, onNotice: () => undefined });
  await panel.refresh();
  const run = node('[data-native="tools"]').querySelectorAll('[data-native-run]')[0]!;
  node('[data-native-args="0"]').value = '{}';
  deferPoll = true;
  const flight = run.onclick!();
  await new Promise(resolve => setImmediate(resolve));
  releaseCall!(); await flight;
  releasePoll!(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 0, 'a trial that settled during a refresh never schedules another poll');
  const destroyed = run.onclick!();
  await new Promise(resolve => setImmediate(resolve));
  panel.destroy();
  assert.equal(timers.length, 1, 'an open trial keeps one poll scheduled');
  releaseCall!(); await destroyed;
});

test('a decision that lands after the panel is gone changes nothing', async () => {
  const { node, host } = harness();
  let release: (() => void) | undefined;
  const api = async (path: string, options?: unknown) => {
    if (!options && path.endsWith('/native-tools')) return { tools: [] };
    if (options) { await new Promise<void>(resolve => { release = resolve; }); return {}; }
    return { approvals: [{ id: 'a5', action: 'command_run', effect: 'destructive', args_digest: 'a'.repeat(64), expires_at: 'z' }] };
  };
  const notices: string[] = [];
  const panel = mountNativeTools(host, { api, esc, onNotice: (text: string) => notices.push(text) });
  await panel.refresh();
  const approve = node('[data-native="approvals"]').querySelectorAll('[data-native-approve]')[0]!;
  const decision = approve.onclick!();
  await new Promise(resolve => setImmediate(resolve));
  panel.destroy();
  release!(); await decision;
  assert.deepEqual(notices, []);
});
