import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Browser module tested with a small DOM port.
import { appendNativeOutput, claudeToolEvent, codexToolEvent, createNativeTranscript, formatNativeHistory, mountAgentWorkspace, nativeHistoryMessages } from '../workbench/agent-workspace.js';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

test('native histories render messages and retain unfamiliar content', () => {
  const codex = formatNativeHistory({ thread: { turns: [{ items: [{ type: 'userMessage', content: [{ type: 'text', text: '你好' }, { type: 'image', url: 'image' }] }, { type: 'agentMessage', text: '完成' }, { type: 'commandExecution', command: 'pwd' }] }] } });
  assert.match(codex, /\[用户\]\n你好/); assert.match(codex, /image/); assert.match(codex, /\[Codex\]\n完成/); assert.match(codex, /\[命令\]\npwd/);
  const claude = formatNativeHistory({ provider: 'claude', messages: [{ type: 'user', message: '你好' }, { type: 'assistant', message: { content: [{ type: 'text', text: '完成' }, { type: 'tool_use', name: 'Bash' }] } }] });
  assert.match(claude, /\[用户\]\n你好/); assert.match(claude, /\[Claude\]\n完成/); assert.match(claude, /tool_use/);
  assert.doesNotMatch(formatNativeHistory({ thread: { turns: [{ items: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'agentMessage', text: 'visible answer' }] }] } }), /private reasoning/);
  assert.deepEqual(nativeHistoryMessages({ thread: { turns: [{ items: [{ type: 'commandExecution', command: 'Get-Content note.txt', status: 'completed', exitCode: 0, aggregatedOutput: 'note contents' }] }] } }), [{ role: '命令', text: 'Get-Content note.txt', status: 'completed', exitCode: 0, detail: 'note contents' }]);
  assert.equal(formatNativeHistory({ thread: { turns: [] } }), '暂无原生历史。');
});

test('native history formats scalar and list content without losing unfamiliar values', () => {
  // A non-array block list is shown as JSON.
  const scalar = formatNativeHistory({ provider: 'claude', messages: [{ type: 'assistant', message: { content: 'plain text' } }] });
  assert.match(scalar, /plain text/);
  // An array of blocks joins text and JSON-renders the rest.
  const blocks = formatNativeHistory({ provider: 'claude', messages: [{ type: 'assistant', message: { content: [{ type: 'text', text: 'one' }, { type: 'image', url: 'x' }] } }] });
  assert.match(blocks, /one/);
  assert.match(blocks, /image/);
});

test('native tool events show commands and results without repeating assistant text', () => {
  assert.deepEqual(codexToolEvent({ method: 'item/started', params: { item: { id: 'cmd', type: 'commandExecution', command: 'echo hi' } } }), { title: 'echo hi', detail: '' });
  assert.equal(codexToolEvent({ method: 'item/started', params: { item: { type: 'commandExecution', command: 'no id' } } }), '');
  assert.deepEqual(codexToolEvent({ method: 'item/completed', params: { item: { id: 'cmd', type: 'commandExecution', status: 'completed', exitCode: 0 } } }), { title: '[命令结束：completed，退出码 0]', detail: '' });
  assert.deepEqual(codexToolEvent({ method: 'item/completed', params: { item: { id: 'cmd', type: 'commandExecution', status: 'completed', exitCode: 0 } } }), { title: '[命令结束：completed，退出码 0]', detail: '' });
  const completion = { method: 'item/completed', params: { item: { id: 'cmd', type: 'commandExecution', status: 'completed', aggregatedOutput: 'command result' } } };
  assert.deepEqual(codexToolEvent(completion), { title: '[命令结束：completed]', detail: 'command result' });
  assert.deepEqual(codexToolEvent(completion, true), { title: '[命令结束：completed]', detail: '' });
  assert.deepEqual(codexToolEvent({ method: 'item/started', params: { item: { id: 'file', type: 'fileChange' } } }), { title: '[文件修改开始]', detail: '' });
  assert.deepEqual(codexToolEvent({ method: 'item/completed', params: { item: { id: 'file', type: 'fileChange', status: 'failed' } } }), { title: '[文件修改：failed]', detail: '' });
  assert.equal(codexToolEvent({ method: 'other' }), '');
  assert.equal(codexToolEvent({ method: 'item/started', params: { item: { type: 'agentMessage' } } }), '');
  assert.deepEqual(claudeToolEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'already streamed' }, { type: 'tool_use', name: 'Bash', input: { command: 'echo hi' } }] } }), [{ title: '[调用工具] Bash', detail: '{"command":"echo hi"}' }]);
  assert.deepEqual(claudeToolEvent({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'failed' }] } }), [{ title: '[工具结果：失败]', detail: 'failed' }]);
  assert.equal(claudeToolEvent({ type: 'assistant', message: { content: 'text' } }), '');
  // An item with an id but a type neither projection knows stays unreported.
  assert.equal(codexToolEvent({ method: 'item/started', params: { item: { id: 'unknown', type: 'agentMessage' } } }), '');
  assert.equal(claudeToolEvent({ type: 'system', message: { content: [{ type: 'text', text: 'hi' }] } }), '');
  // The history projection keeps names for values it cannot render as text.
  assert.deepEqual(nativeHistoryMessages({ thread: { turns: [{ items: [
    { type: 'agentMessage', text: { nested: true } },
    { type: 'mcpToolCall', id: 'call-1' },
    { type: 'reasoning', text: 'private' },
  ] }] } }), [
    { role: 'Codex', text: '{\n  "nested": true\n}' },
    { role: '原生事件：mcpToolCall', text: '{\n  "type": "mcpToolCall",\n  "id": "call-1"\n}' },
  ]);
  assert.deepEqual(nativeHistoryMessages({ provider: 'claude', messages: [
    { type: 'assistant', message: { content: { tool_use: 'raw' } } },
    { type: 'system', message: 'notice' },
  ] }), [
    { role: 'Claude', text: '{\n  "tool_use": "raw"\n}' },
    { role: 'system', text: 'notice' },
  ]);
});

test('live output follows the bottom, preserves manual scroll and limits retained text', () => {
  const output = { textContent: '', scrollTop: 0, clientHeight: 10, get scrollHeight() { return this.textContent.length; } };
  appendNativeOutput(output, '1234567890'); assert.equal(output.scrollTop, 10);
  appendNativeOutput(output, ''); assert.equal(output.textContent, '1234567890');
  output.textContent = 'x'.repeat(100); output.scrollTop = 5;
  appendNativeOutput(output, 'y'); assert.equal(output.scrollTop, 5);
  appendNativeOutput(output, 'z'.repeat(524288));
  assert.ok(output.textContent.length <= 524288); assert.match(output.textContent, /^\[较早的实时输出已省略/);
  const prefixLength = '[较早的实时输出已省略，请查看原生历史]\n'.length;
  output.textContent = 'a'.repeat(prefixLength) + '😀' + 'x'.repeat(524288 - prefixLength - 2); output.scrollTop = 0;
  appendNativeOutput(output, 'y');
  assert.equal(output.textContent.charCodeAt(prefixLength), 'x'.charCodeAt(0));
});

test('transcript separates user, assistant and event turns', () => {
  class Node {
    tagName = 'DIV'; className = ''; textContent = ''; children: Node[] = []; scrollHeight = 0; scrollTop = 0; clientHeight = 0;
    parentElement: Node | null = null;
    append(...items: Node[]) { for (const item of items) { this.children.push(item); item.parentElement = this; } }
    replaceChildren(...items: Node[]) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...items); }
    closest() { return this; }
    querySelectorAll() { return this.children; }
  }
  const output = new Node();
  output.ownerDocument = { createElement: (tag = 'div') => { const node = new Node(); node.tagName = String(tag).toUpperCase(); return node; } };
  const transcript = createNativeTranscript(output);
  transcript.user('你好'); transcript.beginAssistant(); transcript.assistant('第一段'); transcript.assistant('，第二段'); transcript.close(); transcript.event('运行命令'); transcript.info('已截断');
  assert.equal(output.children.length, 4);
  assert.equal(output.children[0].className, 'agent-turn agent-turn-user');
  assert.equal(output.children[0].children[0].textContent, '你好');
  assert.equal(output.children[1].className, 'agent-turn agent-turn-assistant');
  assert.equal(output.children[1].children[0].textContent, '第一段，第二段');
  assert.equal(output.children[2].textContent, '运行命令');
  assert.equal(output.children[2].className, 'agent-turn agent-turn-event');
  assert.equal(output.children[3].textContent, '已截断');
  transcript.assistant('续写');
  assert.equal(output.children.at(-1).children[0].textContent, '续写', 'an empty hidden assistant does not swallow the next reply');
  transcript.clear(); assert.equal(output.children.length, 0);
  assert.deepEqual(nativeHistoryMessages({ provider: 'claude', messages: [{ type: 'user', message: 'hi' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }] }), [{ role: '用户', text: 'hi' }, { role: 'Claude', text: 'ok' }]);
  assert.equal(formatNativeHistory({ provider: 'claude', messages: [{ type: 'assistant', message: { content: 'ok' } }] }), '[Claude]\nok');
});

test('native projections tolerate empty and malformed rows', () => {
  class Node {
    tagName = 'DIV'; className = ''; textContent = ''; children: Node[] = []; scrollHeight = 0; scrollTop = 0; clientHeight = 0;
    append(...items: Node[]) { this.children.push(...items); }
    replaceChildren(...items: Node[]) { this.children = items; }
    closest() { return null; }
    querySelectorAll() { return this.children; }
    setAttribute() {}
  }
  const output = new Node();
  output.ownerDocument = { createElement: (tag = 'div') => { const node = new Node(); node.tagName = String(tag).toUpperCase(); return node; } };
  const transcript = createNativeTranscript(output);
  transcript.user(''); transcript.user('   '); transcript.event(''); transcript.info(''); transcript.command('', '');
  assert.equal(output.children.length, 1, 'an empty command still renders its row');
  assert.equal(output.children[0].children[0].children[0].children[1].textContent, '');
  transcript.close();
  assert.equal(transcript.text, '');
  const previousDocument = globalThis.document;
  (globalThis as any).document = output.ownerDocument;
  try {
    const bare = new Node();
    delete (bare as any).ownerDocument;
    createNativeTranscript(bare).assistant('global document');
    assert.equal(bare.children[0].children[0].textContent, 'global document');
  } finally { (globalThis as any).document = previousDocument; }
  assert.deepEqual(nativeHistoryMessages({ thread: { turns: [{ items: [{ type: 'commandExecution', command: 42 }] }] } }), [
    { role: '原生事件：commandExecution', text: '{\n  "type": "commandExecution",\n  "command": 42\n}' },
  ]);
  assert.deepEqual(claudeToolEvent({ type: 'assistant', message: { content: [{ type: 'tool_use' }, null] } }), [{ title: '[调用工具] 未知', detail: '{}' }]);
  assert.deepEqual(claudeToolEvent({ type: 'user', message: { content: [{ type: 'tool_result', content: { ok: true } }] } }), [{ title: '[工具结果]', detail: '{"ok":true}' }]);
  assert.equal(claudeToolEvent({ type: 'system', message: { content: [] } }), '');
  assert.deepEqual(codexToolEvent({ method: 'item/started', params: { item: { id: 'cmd', type: 'commandExecution' } } }), { title: '', detail: '' });
  assert.equal(formatNativeHistory({ provider: 'claude', messages: [{ type: 'assistant', message: { content: [null, { type: 'text', text: '' }] } }] }), '[Claude]\nnull\n');
});

test('command output is a terminal-style collapsible detail', () => {
  class Node {
    tagName = 'DIV'; className = ''; textContent = ''; open = false; children: Node[] = []; parentElement: Node | null = null;
    append(...items: Node[]) { for (const item of items) { item.parentElement = this; this.children.push(item); } }
    replaceChildren(...items: Node[]) { this.children = []; this.append(...items); }
    closest() { return this; }
    querySelectorAll() { return this.children; }
    setAttribute() {}
  }
  const output = new Node();
  output.ownerDocument = { createElement: (tag = 'div') => { const node = new Node(); node.tagName = String(tag).toUpperCase(); return node; } };
  const transcript = createNativeTranscript(output);
  transcript.command('npm test', '[命令结束：completed，退出码 0]\noutput lines');
  const turn = output.children[0], details = turn.children[0], summary = details.children[0], body = details.children[1];
  assert.equal(turn.className, 'agent-turn agent-turn-command');
  assert.equal(details.tagName, 'DETAILS');
  assert.equal(details.open, false, 'command detail starts collapsed');
  assert.equal(summary.children[1].textContent, 'npm test');
  assert.match(body.textContent, /output lines/);
  assert.match(body.textContent, /退出码 0/);
  details.open = true; assert.equal(details.open, true);
  details.open = false; assert.equal(details.open, false);
});

test('native workspace creates, connects, renders output and never retries an uncertain submission', async () => {
  class Element {
    tagName = 'DIV'; value = ''; textContent = ''; disabled = false; hidden = false; className = ''; type = ''; children: any[] = []; onclick: any; onchange: any; dataset: Record<string, string> = { state: 'send' }; ownerDocument: any;
    constructor() { this.ownerDocument = { createElement: (tag = 'div') => { const node = new Element(); node.tagName = String(tag).toUpperCase(); node.children = []; return node; } }; }
    append(...items: any[]) { for (const item of items) { if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } } }
    add(item: any) { this.children.push(item); if (item.selected) this.value = item.value; }
    replaceChildren(...items: any[]) { this.children = []; this.append(...items); }
    querySelectorAll(selector?: string) { return selector === '.agent-turn' ? this.children : this.children.filter(item => item.type === 'button'); }
    querySelector() { return new Element(); }
    setAttribute() {} focus() {} scrollIntoView() {} setSelectionRange() {}
    remove() {} closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: (tag = 'div') => { const node = new Element(); node.tagName = String(tag).toUpperCase(); node.children = []; return node; } };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _defaultSelected = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const key of ['workspace', 'model', 'permission', 'work-mode', 'session', 'prompt', 'provider', 'claude-model', 'craft-model', 'dsh-model', 'dsh-reasoning', 'codex-model-group', 'claude-model-group', 'craft-model-group', 'dsh-model-group', 'dsh-reasoning-group', 'run']) fields[key] = new Element();
  for (const key of ['create', 'resume', 'send', 'send-stop', 'composer-plus', 'reference-files', 'interrupt', 'history', 'history-next', 'native-more', 'reconcile', 'reopen', 'refresh-runs', 'refresh-sessions', 'release-run', 'unlink', 'choose-project', 'native-folder', 'provider-install', 'provider-configure', 'provider-refresh']) buttons[key] = new Element();
  buttons.send = buttons['send-stop'];
  for (const key of ['.agent-status', '.agent-output', '.agent-approvals', '.agent-queue', '.agent-history', '.agent-history pre', '.agent-native-picker', '.agent-native-list', '[data-role="mention-menu"]', '[data-role="project-label"]', '[data-role="install-help"]', '[data-provider="codex"]', '[data-provider="claude"]', '[data-provider="qoder"]', '[data-install="codex"]', '[data-install="claude"]', '[data-role="provider-installed"]', '[data-role="provider-missing"]', '[data-action="provider-install"]']) nodes[key] = new Element();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (selector: string) => selector === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : selector === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new Element();
  fields.provider.options = [];
  const root: any = { isConnected: true, innerHTML: '', querySelector(selector: string) { return nodes[selector] || fields[selector.match(/data-field="([^"]+)/)?.[1] || ''] || buttons[selector.match(/data-action="([^"]+)/)?.[1] || '']; }, querySelectorAll(selector: string) { return selector === '[data-provider]' ? [nodes['[data-provider="codex"]'], nodes['[data-provider="claude"]']] : []; } };
  const calls: { path: string; body: any }[] = []; const timers: Function[] = []; const openedPages: string[] = []; let failSend = false; let failList = false; let failConfig = false; let conflict = false; let failHistory = false; let failInterrupt = false; let failReconcile = false; let failUnlink = false; let failGoal = false; let failClaudeUsage = false; let failCodexUsage = false; let failQueueEnqueue = false; let failProviders = false; let failNative = false; let failEvents = false; let queueItems: any[] = []; let pendingApprovals: any[] = []; let claudeApprovals: any[] = [{ id: 'approve', tool: 'Bash', input: { command: 'echo' }, context: { title: '执行命令' } }]; let claude = false; let claudeRunning = false; let claudeUnknown = false; let turnState = 'idle'; let releaseApproval: (() => void) | undefined; let failApproval: (() => void) | undefined;
  let failQueueDispatch = false, queueRecoveryAccepted = false, queueRecoveryLocal = false, cancelReference = false, failReference = false, cancelFiles = false, failFiles = false, cancelProject = false, failProject = false;
  let providerProbe = 0;
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, body: options.body });
    if (path.includes('/queue?')) return { items: queueItems };
    if (path.endsWith('/queue') && options.method === 'POST') { if (failQueueEnqueue) throw new Error('queue unavailable'); return { item: { id: 'queued-new' } }; }
    if (path.endsWith('/queue') && options.method === 'PATCH') { queueItems[0].prompt = options.body.prompt; return { item: queueItems[0] }; }
    if (path.endsWith('/queue-reconcile')) { if (queueRecoveryAccepted || queueRecoveryLocal || options.body.action === 'discard') { queueItems = []; return { resolved: true, outcome: queueRecoveryAccepted ? 'accepted' : queueRecoveryLocal ? 'dispatched' : 'discarded', session_state: 'idle' }; } return { resolved: false, manual_discard_allowed: true }; }
    if (path.endsWith('/queue-dispatch')) { if (failQueueDispatch) { failQueueDispatch = false; queueItems = []; throw new Error('ack response lost'); } return { empty: true }; }
    if (path.endsWith('/directories')) return { path: '/home', parent: '/', directories: [{ name: 'project', path: '/home/project' }] };
    if (path.includes('/directories?')) return { path: '/home/project', parent: '/home', directories: [] };
    if (path.endsWith('/pick-reference-folder')) { if (failReference) throw new Error('picker unavailable'); return cancelReference ? { cancelled: true } : { path: '/project/reference' }; }
    if (path.endsWith('/pick-reference-files')) { if (failFiles) throw new Error('picker unavailable'); return cancelFiles ? { cancelled: true } : { paths: ['/project/a.txt', '/project/b.txt'] }; }
    if (path.endsWith('/pick-project-folder')) { if (failProject) throw new Error('picker unavailable'); return cancelProject ? { cancelled: true } : { path: '/project/chosen' }; }
    if (path.includes('/files?')) return { files: [null, { path: null, name: null }, { path: 'null', name: 'null' }, { path: '$null', name: '$null' }, { path: 'src/$null/file.ts', name: '$null' }, { path: 'src/a.ts', name: 'a.ts' }, { path: 'src/b.ts', name: 'b.ts' }, { path: 'src/c.ts', name: 'c.ts' }, { path: 'src/d.ts', name: 'd.ts' }] };
    if (path.endsWith('/providers')) {
      if (failProviders) throw new Error('provider probe unavailable');
      providerProbe += 1;
      if (providerProbe > 1) return { providers: [{ id: 'codex', status: 'available', version: 'codex 1', install_url: 'https://developers.openai.com/codex/cli/' }, { id: 'claude', status: 'available', version: 'claude 2', install_url: null }, { id: 'dsh', name: 'DSH', status: 'error', version: null, install_url: 'https://github.com/deepseek-ai/deepseek-harness' }, { id: 'qoder', name: 'Qoder CLI', status: 'plugin' }, { id: 'trae', name: 'Trae CLI', status: 'not_found', install_url: 'https://example.test/?a=1&b="2"' }] };
      return { providers: [{ id: 'codex', status: 'available', version: 'codex 1', install_url: 'https://developers.openai.com/codex/cli/' }, { id: 'claude', status: 'not_found', install_url: 'https://code.claude.com/docs/en/setup' }] };
    }
    if (path === '/api/config/models') return { models: [{ id: 'gateway-1', name: 'Gateway One', configured: true }, { id: 'gateway-2', name: 'Gateway Two', configured: false }] };
    if (path.includes('/claude-models')) return { models: [{ id: 'default', name: 'Default', description: '当前模型 test', is_default: true }, { id: 'sonnet', name: 'Sonnet' }] };
    if (path.includes('/claude-usage')) { if (failClaudeUsage) throw new Error('claude usage unavailable'); return { available: true, windows: [{ id: 'five_hour', used_percent: 20, resets_at: null }] }; }
    if (path.includes('/codex-skills')) return { skills: [{ name: 'inspect', description: 'Inspect project' }] };
    if (path.includes('/claude-commands')) return { commands: [{ name: 'review', description: 'Review project' }] };
    if (path.includes('/codex-native')) { if (failNative) throw new Error('native unavailable'); return { threads: [{ id: 'codex-old', title: 'Codex old', workspace: '/project' }], next_cursor: 'more' }; }
    if (path.includes('/claude-native')) { if (failNative) throw new Error('native unavailable'); return { threads: [{ id: 'claude-old', title: 'Claude old', workspace: '/project' }], next_cursor: null }; }
    if (path.endsWith('/models')) return { models: [{ id: 'm', name: 'Model', is_default: true }] };
    if (path.endsWith('/codex-usage')) { if (failCodexUsage) throw new Error('codex usage unavailable'); return { rate_limits: { primary: { usedPercent: 30 }, credits: { balance: '12' } } }; }
    if (path.endsWith('/goal') || path.includes('/goal?')) { if (failGoal) throw new Error('goal unavailable'); return { goal: { objective: 'finish', status: 'active' } }; }
    if (path.endsWith('/configuration')) { if (failConfig) throw new Error('请先处理排队消息'); return { link: { model: options.body.model, permission: options.body.permission } }; }
    if (path === '/api/settings') return {};
    if (path === '/api/workbench/agent-sessions?task_id=task') { if (failList) throw new Error('list unavailable'); return { links: claude ? [{ id: 'c', provider: 'claude', native_session_id: 'native', model: 'm', workspace: '/project', turn_state: 'idle' }] : [{ id: 's', provider: 'codex', model: 'm', workspace: '/project' }, { id: 'q', provider: 'qoder', model: 'qm', workspace: '/plugin' }] }; }
    if (path === '/api/workbench/claude-runs') { claude = true; return { run_id: 'r' }; }
    if (path === '/api/workbench/claude-runs?task_id=task') return { runs: [{ run_id: 'r', state: 'running', native_session_id: 'native' }] };
    if (path.startsWith('/api/workbench/claude-runs/r/events?')) return { state: claudeUnknown ? 'unknown' : claudeRunning ? 'running' : 'completed', native_session_id: 'native', last_sequence: 3, approvals: claudeRunning ? claudeApprovals : [], events: [{ event: { type: 'system', subtype: 'init', session_id: 'native' } }, { event: { type: 'stream_event', event: { delta: { type: 'text_delta', text: 'Claude output' } } } }, { event: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pwd' } }] } } }, { event: { type: 'result', subtype: 'success', is_error: true } }] };
    if (path === '/api/workbench/agent-sessions') return { link: { id: 's' } };
    if (path.endsWith('/resume')) { if (conflict) throw new Error('该 Codex 会话正由其他进程使用'); return {}; }
    if (path.includes('/takeover?')) return { available: true, pid: 123, started: 'start' };
    if (path.endsWith('/takeover')) { conflict = false; return { stopped: true }; }
    if (path.includes('/history?')) { if (failHistory) throw new Error('history unavailable'); return claude ? (path.includes('offset=100') ? { provider: 'claude', messages: [{ type: 'assistant', message: { content: 'second page' } }], next_offset: null } : { provider: 'claude', messages: [{ type: 'user', message: { content: 'first page' } }], truncated: true, next_offset: 100 }) : { thread: { turns: [{ items: [{ type: 'agentMessage', text: '<history>' }] }] } }; }
    if (path.includes('/events?')) { if (failEvents) throw new Error('events unavailable'); return { generation: 'g', last_sequence: 1, events: [{ event: { method: 'item/reasoning/summaryTextDelta', params: { itemId: 'r', delta: '<reasoning>' } } }, { event: { method: 'item/agentMessage/delta', params: { delta: '<safe>' } } }, { event: { method: 'item/started', params: { item: { id: 'cmd-start', type: 'commandExecution', command: 'pwd' } } } }, { event: { method: 'item/completed', params: { item: { id: 'a', type: 'commandExecution', aggregatedOutput: 'only-summary' } } } }, { event: { method: 'item/commandExecution/outputDelta', params: { itemId: 'b', delta: 'streamed-once' } } }, { event: { method: 'item/completed', params: { item: { id: 'b', type: 'commandExecution', aggregatedOutput: 'streamed-once' } } } }], approvals: pendingApprovals, status: { connected: true, link: { turn_state: turnState } } }; }
    if (path.endsWith('/reconcile')) { if (failReconcile) throw new Error('reconcile failed'); turnState = 'idle'; return { link: { turn_state: 'idle' } }; }
    if (path.endsWith('/interrupt')) { if (failInterrupt) throw new Error('interrupt failed'); return {}; }
    if (path === '/api/workbench/agent-sessions/s?task_id=task' && failUnlink) throw new Error('unlink failed');
    if (path === '/api/workbench/agent-sessions/s/approval') return new Promise((resolve, reject) => { releaseApproval = () => resolve({}); failApproval = () => reject(new Error('lost')); });
    if (path.endsWith('/turns') && failSend) throw new Error('connection lost');
    return {};
  };
  try {
    const opened: any[] = []; let rejectOpen = false;
    const imported: any[] = [];
    mountAgentWorkspace(root, { api, taskId: 'task', workspace: '/selected', defaultPermission: 'auto', defaultProvider: '', clock: { setTimeout: (fn: Function) => timers.push(fn) }, onOpenNative: async (...args: any[]) => imported.push(args), onOpenPage: (page: string) => openedPages.push(page), invoke: async (command: string, args: any) => { opened.push({ command, args }); if (rejectOpen) throw new Error('unavailable'); } }); await settle();
    assert.ok(fields.session.children.some((option: any) => option.text === 'qoder · qm · /plugin'));
    assert.equal(fields.permission.value, 'auto');
    assert.equal(nodes['[data-role="provider-installed"]'].children.length, 1);
    assert.equal(nodes['[data-role="provider-missing"]'].children.length, 1);
    assert.equal(fields.provider.value, '');
    fields.provider.value = 'claude'; fields.provider.onchange(); await settle();
    assert.equal(calls.find(call => call.path === '/api/settings' && call.body?.lastProvider === 'claude') !== undefined, true);
    assert.equal(nodes['[data-action="provider-install"]'].hidden, false);
    if (nodes['[data-action="provider-install"]'].onclick) { nodes['[data-action="provider-install"]'].onclick(); await settle(); }
    assert.deepEqual(opened.find(call => call.command === 'open_external_url')?.args, { url: 'https://code.claude.com/docs/en/setup' });
    assert.equal(nodes['[data-role="install-help"]'].hidden, false);
    assert.match(nodes['[data-role="install-help"]'].innerHTML, /code\.claude\.com/u);
    assert.match(nodes['[data-role="install-help"]'].innerHTML, /npm install -g --allow-scripts=@anthropic-ai\/claude-code @anthropic-ai\/claude-code/u);
    assert.match(nodes['[data-role="install-help"]'].innerHTML, /data-install-run/u);
    assert.match(nodes['[data-role="install-help"]'].innerHTML, /执行安装/u);
    assert.equal(buttons['provider-configure'].hidden, false); buttons['provider-configure'].onclick(); assert.deepEqual(openedPages, ['settings']);
    fields.provider.value = '__new__'; fields.provider.onchange(); assert.deepEqual(openedPages, ['settings', 'plugins']); assert.equal(fields.provider.value, '');
    assert.equal(buttons['choose-project'].hidden, false);
    assert.equal(nodes['[data-role="project-label"]'].textContent, '项目 · selected');
    await buttons['choose-project'].onclick(); await settle(); assert.equal(fields.workspace.value, '/project/chosen'); assert.equal(nodes['[data-role="project-label"]'].textContent, '项目 · chosen'); assert.match(nodes['.agent-status'].textContent, /已选择项目/);
    fields.workspace.value = '/project/keep'; cancelProject = true; await buttons['choose-project'].onclick(); await settle(); assert.equal(fields.workspace.value, '/project/keep'); assert.equal(nodes['[data-role="project-label"]'].textContent, '项目 · keep'); cancelProject = false;
    failProject = true; await buttons['choose-project'].onclick(); await settle(); assert.equal(nodes['[data-role="project-label"]'].textContent, '项目 · keep'); assert.match(nodes['.agent-status'].textContent, /无法选择项目/); failProject = false; fields.workspace.value = '/selected';
    fields.provider.value = 'codex'; fields.permission.value = 'ask'; fields.model.value = ''; fields.provider.onchange(); await settle();
    assert.equal(buttons.send.disabled, true);
    let blockedEnter = false; fields.prompt.value = 'blocked'; fields.prompt.onkeydown({ key: 'Enter', preventDefault() { blockedEnter = true; } }); await settle();
    assert.equal(blockedEnter, true); assert.equal(calls.some(call => call.path === '/api/tasks'), false); fields.prompt.value = '';
    fields.model.value = 'm'; fields.model.onchange(); await settle(); assert.equal(buttons.send.disabled, false);
    fields.permission.value = ''; fields.permission.onchange(); assert.equal(buttons.send.disabled, true);
    fields.permission.value = 'ask'; fields.permission.onchange(); assert.equal(buttons.send.disabled, false);
    fields.provider.value = ''; fields.provider.onchange(); assert.equal(buttons.send.disabled, true);
    fields.provider.value = 'codex'; fields.provider.onchange(); assert.equal(buttons.send.disabled, false);
    const chooseReference = async (index: number) => {
      buttons['reference-files'].onclick();
      const entries = nodes['[data-role="mention-menu"]'].querySelectorAll('.agent-mention-item');
      await entries[index].onclick(); await settle();
    };
    await chooseReference(0); assert.match(fields.prompt.value, /请参考以下本地文件：\n- \/project\/a\.txt\n- \/project\/b\.txt/); assert.equal(buttons['reference-files'].disabled, false); fields.prompt.value = 'keep';
    cancelFiles = true; await chooseReference(0); assert.equal(fields.prompt.value, 'keep'); cancelFiles = false;
    failFiles = true; await chooseReference(0); assert.match(nodes['.agent-status'].textContent, /无法引用文件/); failFiles = false; fields.prompt.value = '';
    await chooseReference(1); assert.match(fields.prompt.value, /请参考以下本地文件夹：\n- \/project\/reference/); assert.equal(buttons['reference-files'].disabled, false); fields.prompt.value = 'keep';
    cancelReference = true; await chooseReference(1); assert.equal(fields.prompt.value, 'keep'); cancelReference = false;
    failReference = true; await chooseReference(1); assert.match(nodes['.agent-status'].textContent, /无法引用文件夹/); failReference = false; fields.prompt.value = '';
    fields.prompt.value = '@'; fields.prompt.oninput(); await settle();
    let mentionEntries = nodes['[data-role="mention-menu"]'].querySelectorAll('.agent-mention-item');
    assert.deepEqual(mentionEntries.map((entry: any) => entry.children[0].textContent), ['@src/a.ts', '@src/b.ts', '@src/c.ts', '手动选择文件或文件夹…']);
    for (let index = 0; index < 3; index++) fields.prompt.onkeydown({ key: 'ArrowDown', preventDefault() {} });
    fields.prompt.onkeydown({ key: 'Enter', preventDefault() {} }); await settle();
    assert.equal(fields.prompt.value, '');
    mentionEntries = nodes['[data-role="mention-menu"]'].querySelectorAll('.agent-mention-item');
    assert.deepEqual(mentionEntries.map((entry: any) => entry.children[0].textContent), ['选择文件…', '选择文件夹…']);
    fields.prompt.onkeydown({ key: 'Escape', preventDefault() {} });
    buttons['composer-plus'].onclick(); await settle();
    let modeEntries = nodes['[data-role="mention-menu"]'].querySelectorAll('.agent-mention-item');
    assert.equal(modeEntries[0].children[0].textContent, '执行模式');
    assert.match(modeEntries[0].children[1].textContent, /当前模式/);
    await modeEntries[0].onclick(); assert.equal(fields.prompt.value, '', 'already in default mode leaves the prompt untouched');
    fields['work-mode'].value = 'plan';
    buttons['composer-plus'].onclick(); await settle();
    modeEntries = nodes['[data-role="mention-menu"]'].querySelectorAll('.agent-mention-item');
    assert.equal(modeEntries[0].children[1].textContent, '切回执行模式');
    await modeEntries[0].onclick(); assert.equal(fields['work-mode'].value, 'default');
    fields['work-mode'].value = 'default';
    buttons['composer-plus'].onclick(); await settle();
    modeEntries = nodes['[data-role="mention-menu"]'].querySelectorAll('.agent-mention-item');
    assert.equal(modeEntries[1].children[1].textContent, '先计划再执行');
    await modeEntries[1].onclick(); assert.equal(fields['work-mode'].value, 'plan');
    fields.prompt.value = ''; fields['work-mode'].value = 'default';
    fields.provider.value = 'codex'; nodes['.agent-native-picker'].open = true; nodes['.agent-native-picker'].ontoggle(); await settle();
    fields.prompt.value = '/'; fields.prompt.selectionStart = 1; fields.prompt.oninput(); await settle();
    let slashEntries = nodes['[data-role="mention-menu"]'].querySelectorAll('.agent-mention-item');
    assert.equal(slashEntries[2].children[0].textContent, '$inspect', 'codex skills are offered in the / menu');
    slashEntries[2].onclick(); assert.equal(fields.prompt.value, '$inspect '); fields.prompt.value = '';
    assert.equal(nodes['.agent-native-list'].children[0].children[0].textContent, 'Codex old'); assert.equal(buttons['native-more'].hidden, false);
    buttons['native-more'].onclick(); await settle();
    assert.ok(calls.some(call => call.path.includes('/codex-native?cursor=more')));
    assert.equal(nodes['.agent-native-list'].children.length, 2);
    await nodes['.agent-native-list'].children[0].onclick(); assert.equal(imported[0][1], 'codex');
    fields.provider.value = 'claude'; fields.provider.onchange(); nodes['.agent-native-picker'].open = true; nodes['.agent-native-picker'].ontoggle(); await settle();
    fields.prompt.value = '/'; fields.prompt.selectionStart = 1; fields.prompt.oninput(); await settle();
    slashEntries = nodes['[data-role="mention-menu"]'].querySelectorAll('.agent-mention-item');
    assert.equal(slashEntries[2].children[0].textContent, '/review', 'claude commands are offered in the / menu');
    slashEntries[2].onclick(); assert.equal(fields.prompt.value, '/review '); fields.prompt.value = '';
    assert.equal(nodes['.agent-native-list'].children[0].children[0].textContent, 'Claude old');
    await nodes['.agent-native-list'].children[0].onclick(); assert.equal(imported[1][1], 'claude'); nodes['.agent-native-picker'].open = false;
    failNative = true; nodes['.agent-native-picker'].open = true; nodes['.agent-native-picker'].ontoggle(); await settle();
    assert.match(nodes['.agent-native-list'].textContent, /读取历史会话失败：native unavailable/);
    failNative = false;
    assert.equal(fields.workspace.value, '/selected'); assert.equal(fields.workspace.readOnly, true); assert.equal(buttons['choose-project'].hidden, false);
    const outputText = () => nodes['.agent-output'].children.map((turn: any) => turn.className?.includes('agent-turn-command') ? turn.children[0].children.map((node: any) => node.textContent).join('\n') : turn.className?.includes('agent-turn-user') || turn.className?.includes('agent-turn-assistant') ? turn.children[0].textContent : turn.textContent).join('\n\n');
    fields.prompt.value = '/plan'; await buttons.send.onclick(); assert.equal(fields['work-mode'].value, 'plan'); fields.prompt.value = '/plan'; await buttons.send.onclick(); assert.equal(fields['work-mode'].value, 'default');
    fields.provider.value = 'codex'; failCodexUsage = true; fields.prompt.value = '/status'; await buttons.send.onclick();
    assert.match(outputText(), /无法读取 Codex 用量/);
    failCodexUsage = false; fields.prompt.value = '/status'; await buttons.send.onclick();
    assert.match(outputText(), /已使用 30%/); assert.match(outputText(), /额度余额：12/);
    fields.provider.value = 'claude'; fields.provider.onchange(); await settle();
    failClaudeUsage = true; fields.prompt.value = '/status'; await buttons.send.onclick(); assert.match(outputText(), /无法读取 Claude 用量/);
    failClaudeUsage = false; fields.prompt.value = '/status'; await buttons.send.onclick(); assert.match(outputText(), /five_hour：已使用 20%/);
    assert.equal(fields['claude-model'].children[0].text, '选择模型'); assert.equal(fields['claude-model'].children[1].value, 'sonnet');
    assert.ok(calls.some(call => call.path.includes('/claude-models?workspace=')));
    fields.provider.value = 'codex'; fields.provider.onchange();
    let prevented = false; nodes['[data-install="codex"]'].onclick({ preventDefault() { prevented = true; } }); await settle();
    assert.equal(prevented, true); assert.ok(opened.some(open => open.command === 'open_external_url' && open.args?.url === 'https://developers.openai.com/codex/cli/'));
    rejectOpen = true; nodes['[data-install="claude"]'].onclick({ preventDefault() {} }); await settle();
    assert.match(nodes['.agent-status'].textContent, /无法打开安装页/);
    assert.doesNotMatch(root.innerHTML, /agent-folder-picker/);
    assert.match(root.innerHTML, /空会话在重启后可能无法恢复/);
    fields.model.value = 'm'; assert.equal(fields.model.value, 'm');
    assert.equal(fields['claude-model-group'].hidden, true);
    assert.match(nodes['[data-provider="codex"]'].textContent, /codex 1/);
    assert.match(nodes['[data-provider="claude"]'].textContent, /未找到/);
    fields.provider.value = 'craft'; fields.provider.onchange(); await settle();
    assert.equal(fields['craft-model-group'].hidden, false);
    assert.equal(fields['codex-model-group'].hidden, true);
    assert.equal(fields['craft-model'].value, 'gateway-1');
    fields.provider.value = 'codex'; fields.provider.onchange();
    buttons['provider-refresh'].onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /检测完成/);
    assert.equal(nodes['[data-role="provider-installed"]'].children.length, 3);
    assert.equal(nodes['[data-role="provider-missing"]'].children.length, 2);
    assert.match(nodes['[data-provider="qoder"]'].textContent, /由插件提供/);
    fields.provider.value = 'trae'; fields.provider.onchange(); await settle();
    assert.equal(nodes['[data-action="provider-install"]'].hidden, false);
    nodes['[data-action="provider-install"]'].onclick(); await settle();
    assert.match(nodes['[data-role="install-help"]'].innerHTML, /&amp;/);
    assert.match(nodes['[data-role="install-help"]'].innerHTML, /&quot;/);
    failProviders = true; buttons['provider-refresh'].onclick(); await settle();
    assert.match(nodes['[data-provider="codex"]'].textContent, /检测失败/);
    assert.match(nodes['[data-provider="claude"]'].textContent, /检测失败/);
    failProviders = false;
    fields.provider.value = 'dsh'; fields.provider.onchange(); await settle();
    assert.equal(nodes['[data-action="provider-install"]'].hidden, false);
    assert.equal(buttons['provider-configure'].hidden, false);
    fields.provider.value = 'codex'; fields.provider.onchange();
    fields.workspace.value = '/project'; fields.permission.value = 'ask';
    failList = true; await buttons.create.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /会话已创建/); assert.equal(buttons.create.disabled, false); assert.equal(buttons['choose-project'].hidden, true);
    buttons['refresh-sessions'].onclick(); await settle(); assert.match(nodes['.agent-status'].textContent, /刷新会话失败/);
    failList = false; buttons['refresh-sessions'].onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /会话列表已刷新/);
    conflict = true; fields.session.value = 's'; buttons.resume.onclick(); await settle();
    const takeover = nodes['.agent-approvals'].children[0]; assert.match(takeover.children[0].textContent, /中断/);
    assert.equal(takeover.children[1].textContent, '接管会话');
    assert.doesNotMatch(nodes['.agent-output'].textContent, /接管会话/, 'the takeover action must not rely on the hidden transcript fallback');
    await takeover.children[1].onclick(); await settle();
    assert.deepEqual(calls.find(call => call.path.endsWith('/takeover'))?.body, { task_id: 'task', pid: 123, started: 'start' });
    failEvents = true; timers.shift()?.(); await settle();
    assert.match(nodes['.agent-status'].textContent, /读取失败：events unavailable。请重新连接/);
    failEvents = false;
    fields.session.value = 's'; await buttons.resume.onclick(); await settle(); await settle();
  assert.match(outputText(), /<safe>/); assert.doesNotMatch(outputText(), /<reasoning>/);
  const commands = nodes['.agent-output'].children.filter((turn: any) => turn.className?.includes('agent-turn-command'));
  assert.equal(commands[0].children[0].children[0].children[1].textContent, 'pwd');
    assert.match(outputText(), /only-summary/); assert.equal(outputText().split('streamed-once').length - 1, 1);
    assert.equal(buttons.send.disabled, false);
    fields.model.value = 'm2'; fields.model.onchange(); await settle(); assert.equal(calls.find(call => call.path.endsWith('/configuration'))?.body.model, 'm2'); assert.match(nodes['.agent-status'].textContent, /下一回合生效/);
    failConfig = true; fields.permission.value = 'full'; fields.permission.onchange(); await settle(); assert.equal(fields.permission.value, 'ask'); assert.match(nodes['.agent-status'].textContent, /排队消息/); failConfig = false;
    failGoal = true; fields.prompt.value = '/goal finish'; await buttons.send.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /目标操作未确认，请检查当前会话：goal unavailable/);
    failGoal = false; fields.prompt.value = '/goal finish'; await buttons.send.onclick();
    assert.equal(calls.find(call => call.path.endsWith('/goal'))?.body.objective, 'finish');
    assert.match(outputText(), /\[目标\]/);
    turnState = 'running'; queueItems = []; timers.shift()?.(); await settle();
    fields.prompt.value = 'queue fails'; fields.prompt.oninput(); await settle();
    fields.prompt.value = 'queue fails'; failQueueEnqueue = true;
    await buttons.send.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /加入队列失败：queue unavailable/);
    assert.equal(fields.prompt.value, 'queue fails');
    failQueueEnqueue = false;
    fields.prompt.value = 'queued while running'; fields.prompt.oninput(); await settle();
    assert.equal(buttons['send-stop'].dataset.state, 'send'); assert.equal(buttons.send.disabled, false);
    let queuedEnter = false; fields.prompt.onkeydown({ key: 'Enter', preventDefault() { queuedEnter = true; } }); await settle();
    assert.equal(queuedEnter, true); assert.equal(fields.prompt.value, ''); assert.equal(calls.find(call => call.path.endsWith('/queue') && call.body?.prompt === 'queued while running')?.body?.work_mode, 'default');
    assert.equal(calls.some(call => call.path.endsWith('/queue-dispatch') || call.path.endsWith('/queue-steer')), false);
    assert.equal(buttons['send-stop'].dataset.state, 'stop'); assert.equal(buttons.send.disabled, false);
    failInterrupt = true; await buttons.send.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /停止未确认：interrupt failed/);
    failInterrupt = false; await buttons.send.onclick(); assert.ok(calls.some(call => call.path.endsWith('/interrupt')));
    queueItems = [{ id: 'queued', state: 'queued', prompt: 'old' }]; timers.shift()?.(); await settle();
    const queuedRow = nodes['.agent-queue'].children[0]; queuedRow.children[1].onclick();
    queuedRow.children[0].value = 'edited'; await queuedRow.children[1].onclick();
    assert.equal(queueItems[0].prompt, 'edited'); assert.equal(calls.find(call => call.path.endsWith('/queue') && call.body?.item_id === 'queued')?.body.prompt, 'edited');
    queueItems = []; turnState = 'idle'; timers.shift()?.(); await settle();
    queueItems = [{ id: 'uncertain', version: 4, state: 'unknown', prompt: 'needs review' }];
    timers.shift()?.(); await settle();
    const recoveryRow = nodes['.agent-queue'].children[0], recovery = recoveryRow.children[1];
    timers.shift()?.(); await settle(); assert.equal(nodes['.agent-queue'].children[0], recoveryRow, 'unchanged polling must retain actionable DOM nodes');
    await recovery.children[0].onclick();
    assert.match(recovery.children[0].textContent, /是否已发送仍未确认/);
    timers.shift()?.(); await settle(); assert.equal(nodes['.agent-queue'].children[0], recoveryRow, 'polling must not destroy inline confirmation');
    // Keeping the message releases the inline hold without discarding it.
    recovery.children.find((node: any) => node.textContent === '保留消息').onclick(); await settle();
    const keptRow = nodes['.agent-queue'].children[0], kept = keptRow.children[1];
    await kept.children[0].onclick(); await settle();
    await kept.children.find((node: any) => node.textContent === '已核对，移出队列').onclick();
    assert.equal(nodes['.agent-queue'].children.length, 0);
    assert.deepEqual(calls.find(call => call.path.endsWith('/queue-reconcile'))?.body, { task_id: 'task', item_id: 'uncertain', expected_version: 4, action: 'inspect' });
    queueItems = [{ id: 'lost-ack', version: 2, state: 'queued', prompt: 'already accepted' }]; failQueueDispatch = true; queueRecoveryAccepted = true;
    const sendsBeforeRecovery = calls.filter(call => call.path.endsWith('/turns')).length;
    timers.shift()?.(); await settle();
    assert.equal(buttons.send.disabled, true);
    const lostAck = nodes['.agent-queue'].children[0];
    await lostAck.children[1].children[0].onclick(); await settle();
    assert.equal(buttons.send.disabled, false); assert.equal(nodes['.agent-queue'].children.length, 0);
    assert.equal(calls.filter(call => call.path.endsWith('/turns')).length, sendsBeforeRecovery);
    queueRecoveryAccepted = false; queueRecoveryLocal = true;
    queueItems = [{ id: 'local', version: 3, state: 'unknown', prompt: 'locally dispatched' }];
    timers.shift()?.(); await settle(); await nodes['.agent-queue'].children[0].children[1].children[0].onclick();
    assert.match(nodes['.agent-status'].textContent, /本地派发回执/);
    queueRecoveryLocal = false;
    failHistory = true; await buttons.history.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /原生历史读取失败：history unavailable/);
    failHistory = false; await buttons.history.onclick(); assert.match(nodes['.agent-history pre'].textContent, /<history>/);
    failHistory = true; buttons['history-next'].onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /原生历史读取失败：history unavailable/);
    failHistory = false;
    pendingApprovals = [{ id: 3, method: 'item/commandExecution/requestApproval', params: { command: '<echo>' } }];
    timers.shift()?.(); await settle();
    const approval = nodes['.agent-approvals'].children[0];
    assert.match(approval.children[1].textContent, /<echo>/);
    const deciding = approval.children[3].onclick();
    timers.shift()?.(); await settle();
    const refreshedApproval = nodes['.agent-approvals'].children[0];
    assert.equal(refreshedApproval.children[3].disabled, true);
    await refreshedApproval.children[3].onclick();
    assert.equal(calls.filter(call => call.path.endsWith('/approval')).length, 1);
    releaseApproval!(); await deciding;
    assert.equal(calls.find(call => call.path.endsWith('/approval'))?.body.decision, 'decline');
    pendingApprovals = [{ id: 4, method: 'item/fileChange/requestApproval', params: {} }];
    timers.shift()?.(); await settle();
    const failedDecision = nodes['.agent-approvals'].children[0].children[2].onclick();
    failApproval!(); await failedDecision; assert.match(nodes['.agent-status'].textContent, /审批未确认/);
    timers.shift()?.(); await settle();
    const failedBox = nodes['.agent-approvals'].children[0];
    assert.match(failedBox.children[2].textContent, /未确认/); assert.equal(failedBox.children[3].disabled, true);
    pendingApprovals = [];
    fields.prompt.value = 'private prompt'; failSend = true;
    await buttons.send.onclick();
    assert.equal(buttons.send.disabled, true); assert.match(nodes['.agent-status'].textContent, /勿重复发送/);
    queueRecoveryAccepted = true; queueItems = [{ id: 'other-input', version: 4, state: 'unknown', prompt: 'a different operation' }];
    timers.shift()?.(); await settle();
    // Reading queue state is available even while a different submission is uncertain.
    fields.prompt.value = ''; fields.prompt.oninput(); await settle();
    turnState = 'running'; timers.shift()?.(); await settle();
    assert.equal(nodes['.agent-queue'].children.length, 1);
    await nodes['.agent-queue'].children[0].children[1].children[0].onclick();
    assert.equal(buttons['send-stop'].dataset.state, 'stop');
    assert.equal(buttons['send-stop'].disabled, false, 'a running turn remains interruptible even with another uncertain input');
    timers.shift()?.(); await settle(); assert.match(nodes['.agent-status'].textContent, /勿重复发送/);
    assert.equal(calls.filter(call => call.path.endsWith('/turns')).length, 1);
    assert.equal(calls.find(call => call.path.endsWith('/turns'))?.body.prompt, 'private prompt');
    turnState = 'unknown'; timers.shift()?.(); await settle();
    assert.equal(buttons.reconcile.disabled, false); assert.equal(buttons.send.disabled, true);
    failReconcile = true; await buttons.reconcile.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /无法确认回合结束/);
    failReconcile = false; await buttons.reconcile.onclick(); assert.equal(buttons.send.disabled, false); assert.match(nodes['.agent-status'].textContent, /确认回合结束/);
    failUnlink = true; await buttons.unlink.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /解除关联未确认/);
    failUnlink = false; failList = true;
    await buttons.unlink.onclick(); assert.ok(calls.some(call => call.path === '/api/workbench/agent-sessions/s?task_id=task')); assert.match(nodes['.agent-status'].textContent, /已解除关联，刷新列表失败/);
    failList = false;
    fields.provider.value = 'claude'; fields.permission.value = 'auto'; fields.prompt.value = 'first Claude message';
    fields.provider.onchange(); assert.equal(fields['codex-model-group'].hidden, true); assert.equal(fields['claude-model-group'].hidden, false);
    await settle(); fields['claude-model'].value = 'sonnet';
    await buttons.create.onclick(); await settle();
    await approval.children[2].onclick(); assert.equal(calls.filter(call => call.path === '/api/workbench/agent-sessions/s/approval').length, 2);
    assert.match(outputText(), /Claude output/); assert.match(outputText(), /失败/);
    const claudeTools = nodes['.agent-output'].children.filter((turn: any) => turn.className?.includes('agent-turn-command'));
    assert.ok(claudeTools.some((turn: any) => turn.children[0].children[0].children[1].textContent === '[调用工具] Bash'));
    assert.equal(calls.find(call => call.path === '/api/workbench/claude-runs')?.body.prompt, 'first Claude message');
    assert.equal(calls.find(call => call.path === '/api/workbench/claude-runs')?.body.model, 'sonnet'); assert.equal(calls.find(call => call.path === '/api/workbench/claude-runs')?.body.permission, 'auto');
    assert.ok(calls.some(call => call.path === '/api/workbench/claude-runs/r?task_id=task'));
    fields.session.value = 'c'; await buttons.resume.onclick(); await settle();
    await buttons.history.onclick(); assert.match(nodes['.agent-history pre'].textContent, /first page/); assert.equal(buttons['history-next'].hidden, false);
    buttons['history-next'].onclick(); await settle(); assert.match(nodes['.agent-history pre'].textContent, /second page/); assert.equal(buttons['history-next'].hidden, true);
    claudeRunning = true; fields.run.value = 'r'; buttons.reopen.onclick(); await settle();
    const restoredApproval = nodes['.agent-approvals'].children[0]; assert.equal(restoredApproval.children[0].textContent, '执行命令');
    await restoredApproval.children[3].onclick();
    assert.equal(calls.find(call => call.path === '/api/workbench/claude-runs/r/approval')?.body.request_id, 'approve');
    claudeApprovals = [{ id: 'question', tool: 'AskUserQuestion', context: {}, input: { questions: [{ question: 'Which?', multiSelect: true, options: [{ label: 'A', description: 'first' }, { label: 'B', description: 'second' }] }, { question: '__proto__', options: [] }] } }];
    timers.forEach(fn => fn()); await settle();
    const question = nodes['.agent-approvals'].children[0], answer = question.children[1].children[0];
    assert.equal(question.children[2].textContent, 'A'); assert.equal(question.children[2].title, 'first');
    await question.children[5].onclick(); assert.match(nodes['.agent-status'].textContent, /回答每个问题/);
    answer.value = 'A, B'; answer.oninput();
    const unusualAnswer = question.children[4].children[0]; unusualAnswer.value = 'custom'; unusualAnswer.oninput();
    timers.forEach(fn => fn()); await settle();
    assert.equal(nodes['.agent-approvals'].children[0].children[1].children[0].value, 'A, B');
    claudeApprovals.push({ id: 'another', tool: 'Bash', input: {}, context: {} });
    timers.forEach(fn => fn()); await settle();
    assert.equal(nodes['.agent-approvals'].children[0].children[1].children[0].value, 'A, B');
    assert.equal(nodes['.agent-approvals'].children[0].children[4].children[0].value, 'custom');
    await nodes['.agent-approvals'].children[0].children[5].onclick();
    assert.deepEqual(calls.filter(call => call.path.endsWith('/approval')).at(-1)?.body.answers, Object.fromEntries([['Which?', 'A, B'], ['__proto__', 'custom']]));
    assert.equal(buttons.unlink.disabled, true);
    const releases = calls.filter(call => call.path === '/api/workbench/claude-runs/r?task_id=task').length;
    claudeRunning = false; claudeUnknown = true; timers.forEach(fn => fn()); await settle();
    assert.equal(calls.filter(call => call.path === '/api/workbench/claude-runs/r?task_id=task').length, releases);
    assert.equal(buttons.send.disabled, true); assert.match(nodes['.agent-status'].textContent, /结果未知/);
    fields.run.value = 'r'; await buttons['release-run'].onclick(); assert.equal(calls.filter(call => call.path === '/api/workbench/claude-runs/r?task_id=task').length, releases + 1);
    assert.match(nodes['.agent-status'].textContent, /运行记录已清除/); assert.equal(buttons.send.disabled, true);
    root.isConnected = false; const before = calls.length; timers.forEach(fn => fn()); await settle(); assert.equal(calls.length, before);
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});

test('first send creates the task and native session once, with the chosen project and full access', async () => {
  class El {
    value = ''; textContent = ''; disabled = false; hidden = false; children: any[] = []; onclick: any; onchange: any; scrollHeight = 0; scrollTop = 0; clientHeight = 0; dataset: Record<string, string> = { state: 'send' }; ownerDocument: any;
    constructor() { this.ownerDocument = { createElement: () => new El() }; }
    add(item: any) { this.children.push(item); }
    append(...items: any[]) { for (const item of items) { if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } } }
    replaceChildren(...items: any[]) { this.children = []; this.append(...items); }
    querySelectorAll(selector?: string) { return selector === '.agent-turn' ? this.children : []; }
    querySelector() { return new El(); }
    setAttribute() {} closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: () => new El() };
  (globalThis as any).Option = class { text: string; value: string; constructor(text: string, value: string) { this.text = text; this.value = value; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const k of ['workspace','model','permission','work-mode','session','prompt','provider','claude-model','codex-model-group','claude-model-group','run']) fields[k] = new El();
  for (const k of ['create','resume','send','send-stop','composer-plus','reference-files','interrupt','history','history-next','native-more','reconcile','reopen','refresh-runs','refresh-sessions','release-run','unlink','choose-project','native-folder','provider-install']) buttons[k] = new El();
  buttons.send = buttons['send-stop'];
  for (const k of ['.agent-status','.agent-output','.agent-approvals','.agent-history','.agent-history pre','.agent-native-picker','.agent-native-list','[data-provider="codex"]','[data-provider="claude"]','[data-install="codex"]','[data-install="claude"]','[data-role="provider-installed"]','[data-role="provider-missing"]','[data-action="provider-install"]']) nodes[k] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (s: string) => s === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : s === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  fields.provider.options = [];
  const root: any = { isConnected: true, innerHTML: '', querySelector(s: string) { return nodes[s] || fields[s.match(/data-field="([^"]+)/)?.[1] || ''] || buttons[s.match(/data-action="([^"]+)/)?.[1] || '']; } };
  const calls: any[] = [];
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, body: options.body });
    if (path === '/api/tasks') return { task: { id: 'task' } };
    if (path === '/api/workbench/agent-sessions') return { link: { id: 's' } };
    if (path.includes('/agent-sessions?')) return { links: [{ id:'s', provider:'codex', workspace:'/project', model:'m', permission:'full', turn_state:'idle' }] };
    if (path.includes('/events?')) return { generation:'g', last_sequence:0, events:[], approvals:[], status:{ connected:true, link:{ turn_state:'idle' } } };
    if (path.includes('/history?')) return { thread:{ turns:[] } };
    if (path.endsWith('/models')) return { models:[] };
    if (path.endsWith('/providers')) return { providers: [{ id: 'codex', status: 'available', install_url: 'https://developers.openai.com/codex/cli/' }, { id: 'claude', status: 'not_found', install_url: 'https://code.claude.com/docs/en/setup' }] };
    if (path.startsWith('/api/workbench/claude-runs?')) return { runs:[] };
    return {};
  };
  try {
    mountAgentWorkspace(root, { api, taskId:'', clock:{ setTimeout() {} }, invoke:async () => '/project' }); await settle();
    fields.provider.value='codex'; fields.permission.value='full'; fields.model.value='m'; fields.prompt.value='hello';
    fields.provider.onchange(); fields.permission.onchange(); fields.model.onchange(); await settle();
    await buttons['native-folder'].onclick();
    fields.prompt.oncompositionstart();
    fields.prompt.oninput({ isComposing: true });
    await fields.prompt.onkeydown({ key: 'Enter', preventDefault() { throw new Error('IME Enter must stay native'); } });
    assert.equal(calls.filter(x => x.path === '/api/tasks').length, 0);
    fields.prompt.oncompositionend();
    fields.prompt.oninput();
    await fields.prompt.onkeydown({ key: 'Enter', preventDefault() {} });
    assert.deepEqual(calls.filter(x => x.path === '/api/tasks').map(x => x.body.title), ['project']);
    assert.equal(calls.find(x => x.path === '/api/tasks')?.body.permission_mode, 'full_access');
    assert.equal(calls.find(x => x.path === '/api/workbench/agent-sessions').body.permission, 'full');
    assert.equal(calls.find(x => x.path.endsWith('/turns')).body.prompt, 'hello');
    assert.equal(nodes['.agent-output'].children.at(-1).children[0].textContent, 'hello');
    assert.equal(fields.prompt.value, '');
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});


test('missing tools open the desktop install guide in the browser when no native bridge is available', async () => {
  class El {
    value = ''; textContent = ''; disabled = false; hidden = false; children: any[] = []; onclick: any; onchange: any; dataset: Record<string, string> = { state: 'send' }; ownerDocument: any; options: any[] = [];
    constructor() { this.ownerDocument = { createElement: () => new El() }; }
    add(item: any) { this.children.push(item); }
    append(...items: any[]) { for (const item of items) { if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } } }
    replaceChildren(...items: any[]) { this.children = []; this.append(...items); }
    querySelectorAll(selector?: string) { return selector === '.agent-turn' ? this.children : []; }
    querySelector() { return new El(); }
    setAttribute() {} closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option, priorWindow = globalThis.window;
  (globalThis as any).document = { createElement: () => new El() };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _defaultSelected = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const k of ['workspace','model','permission','work-mode','session','prompt','provider','claude-model','codex-model-group','claude-model-group','run']) fields[k] = new El();
  for (const k of ['create','resume','send','send-stop','composer-plus','reference-files','interrupt','history','history-next','native-more','reconcile','reopen','refresh-runs','refresh-sessions','release-run','unlink','choose-project','native-folder','provider-install']) buttons[k] = new El();
  buttons.send = buttons['send-stop'];
  for (const k of ['.agent-status','.agent-output','.agent-approvals','.agent-queue','.agent-history','.agent-history pre','.agent-native-picker','.agent-native-list','[data-role="mention-menu"]','[data-role="project-label"]','[data-provider="codex"]','[data-provider="claude"]','[data-install="codex"]','[data-install="claude"]','[data-role="provider-installed"]','[data-role="provider-missing"]','[data-action="provider-install"]']) nodes[k] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (s: string) => s === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : s === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  const root: any = { isConnected: true, innerHTML: '', querySelector(s: string) { return nodes[s] || fields[s.match(/data-field="([^"]+)/)?.[1] || ''] || buttons[s.match(/data-action="([^"]+)/)?.[1] || '']; } };
  const calls: any[] = [];
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, options });
    if (path.endsWith('/providers')) return { providers: [{ id: 'codex', status: 'available', install_url: 'https://developers.openai.com/codex/cli/' }, { id: 'claude', status: 'not_found', install_url: 'https://code.claude.com/docs/en/setup' }] };
    if (path.includes('/agent-sessions?')) return { links: [] };
    if (path.endsWith('/claude-runs') || path.includes('/claude-runs?')) return { runs: [] };
    if (path.endsWith('/models')) return { models: [] };
    if (path === '/api/settings') return {};
    return {};
  };
  try {
    const opened: any[] = [];
    (globalThis as any).window = { open: (url: string) => opened.push(url) };
    mountAgentWorkspace(root, { api, taskId: '', clock: { setTimeout() {} }, invoke: null }); await settle();
    fields.provider.value = 'claude'; fields.provider.onchange(); await settle();
    assert.equal(nodes['[data-action="provider-install"]'].hidden, false);
    nodes['[data-action="provider-install"]'].onclick();
    assert.deepEqual(opened, ['https://code.claude.com/docs/en/setup']);
    (globalThis as any).window.open = () => null;
    nodes['[data-action="provider-install"]'].onclick();
    assert.match(nodes['.agent-status'].textContent, /浏览器拦截了安装页/);
    await buttons['native-folder'].onclick();
    assert.match(nodes['.agent-status'].textContent, /请使用桌面版选择文件夹/);
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; (globalThis as any).window = priorWindow; }
});

test('a DSH turn streams its updates, shows approvals, settles and stops polling', async () => {
  class El {
    tagName = 'DIV'; value = ''; textContent = ''; disabled = false; hidden = false; className = ''; type = ''; open = false;
    children: any[] = []; onclick: any; onchange: any; dataset: Record<string, string> = { state: 'send' }; ownerDocument: any;
    constructor() { this.ownerDocument = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } }; }
    append(...items: any[]) { for (const item of items) if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } }
    add(item: any) { this.children.push(item); if (item.selected) this.value = item.value; }
    replaceChildren(...items: any[]) { this.children = []; this.append(...items); }
    querySelectorAll(selector?: string) { return selector === '.agent-turn' ? this.children : this.children.filter(item => item.type === 'button'); }
    querySelector() { return new El(); }
    setAttribute() {} focus() {} setSelectionRange() {} remove() {} closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _d = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const key of ['workspace', 'model', 'permission', 'work-mode', 'session', 'prompt', 'provider', 'claude-model', 'craft-model', 'dsh-model', 'dsh-reasoning', 'run']) fields[key] = new El();
  for (const key of ['create', 'resume', 'send', 'send-stop', 'composer-plus', 'reference-files', 'history', 'history-next', 'native-more', 'reconcile', 'reopen', 'refresh-runs', 'refresh-sessions', 'release-run', 'unlink', 'choose-project', 'native-folder', 'provider-install', 'provider-configure', 'provider-refresh']) buttons[key] = new El();
  buttons.send = buttons['send-stop'];
  for (const key of ['.agent-status', '.agent-output', '.agent-approvals', '.agent-queue', '.agent-history', '.agent-native-picker', '.agent-native-list', '[data-role="mention-menu"]', '[data-role="provider-installed"]', '[data-role="provider-missing"]']) nodes[key] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (selector: string) => selector === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : selector === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  const root: any = { isConnected: true, innerHTML: '', querySelector(selector: string) { return nodes[selector] || fields[selector.match(/data-field="([^"]+)/)?.[1] || ''] || buttons[selector.match(/data-action="([^"]+)/)?.[1] || ''] || new El(); }, querySelectorAll: () => [] };
  const timers: Array<() => void> = [];
  const calls: Array<{ path: string; body: any }> = [];
  const nativeOpened: any[] = [];
  const approvals: any[] = [{ id: 'a1', request_id: 'req-1', tool_call: { name: 'shell', command: 'ls' } }];
  let polls = 0, state = 'running', truncated = true, stream = '', linkTurnState: string | undefined;
  let dispatchPending = false;
  let failApproval = false;
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, body: options.body });
    // The run-creating POST carries the link, so it must be matched before the
    // catch-all POST branch that only needs to acknowledge.
    if (path.includes('/dsh-runs/turns')) return { run_id: 'run-dsh' };
    if (path.endsWith('/dsh-runs') && options.method === 'POST') return { run_id: 'run-dsh', link: { id: 'link-dsh' } };
    if (path.endsWith('/configuration')) return { link: { model: options.body.model, permission: options.body.permission } };
    if (path.includes('/approval')) { if (failApproval) throw new Error('approval offline'); return {}; }
    if (path.includes('/queue?')) return { items: dispatchPending ? [{ id: 'q1', state: 'queued', prompt: 'queued dsh' }] : [] };
    if (path.endsWith('/queue-dispatch')) { if (!dispatchPending) return { empty: true }; dispatchPending = false; return { prompt: 'queued dsh', provider: 'dsh', run_id: 'run-dsh-2' }; }
    if (options.method === 'POST') return {};
    if (path === '/api/workbench/dsh-native') return { threads: [{ id: 'dsh-old', title: 'DSH old', workspace: '/proj' }], next_cursor: null };
    if (path.includes('/dsh-models')) return { models: [{ id: 'm1', name: 'Model One', is_default: true }] };
    if (path.includes('/providers')) return { providers: [{ id: 'dsh', name: 'DSH', status: 'available', version: 'dsh 1' }] };
    if (path === '/api/workbench/agent-sessions?task_id=task') return { links: [{ id: 'link-dsh', provider: 'dsh', model: 'm1', workspace: '/proj', turn_state: linkTurnState }] };
    if (path.includes('/events?')) {
      polls += 1;
      if (polls > 1) return { state: 'completed', last_sequence: 2, events: [], approvals: [] };
      stream = JSON.stringify([
        { event: { type: 'session_update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'DSH says hi' } } } },
        { event: { type: 'session_update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'weighing options' } } } },
        { event: { type: 'session_update', update: { sessionUpdate: 'tool_call', title: 'Run shell', rawInput: { command: 'ls' } } } },
        { event: { type: 'session_update', update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' } } },
        { event: { type: 'session_update', update: { sessionUpdate: 'plan', entries: [{ step: 'one' }] } } },
        { event: { type: 'session_update', update: { sessionUpdate: 'config_option_update', configOptions: { model: 'm1' } } } },
        { event: { type: 'not_session_update' } },
      ]);
      return { state, last_sequence: 1, truncated, events: JSON.parse(stream), approvals };
    }
    if (path.includes('/models')) return { models: [] };
    return {};
  };
  try {
    mountAgentWorkspace(root, { api, taskId: 'task', clock: { setTimeout: (cb: () => void) => { timers.push(cb); return 1; } }, onOpenNative: async (...args: any[]) => { nativeOpened.push(args); } });
    await settle();
    fields.provider.value = 'dsh'; fields.provider.onchange(); await settle();
    fields['dsh-model'].value = 'm1'; fields.workspace.value = '/proj'; fields.permission.value = 'ask';
    nodes['.agent-native-picker'].open = true; nodes['.agent-native-picker'].ontoggle(); await settle();
    assert.equal(nodes['.agent-native-list'].children[0].children[0].textContent, 'DSH old');
    await nodes['.agent-native-list'].children[0].onclick(); await settle();
    assert.equal(nativeOpened[0][1], 'dsh'); assert.equal(nativeOpened[0][2], 'm1');
    fields.prompt.value = 'look around';
    await buttons['create'].onclick(); await settle();
    assert.ok(calls.some(call => call.path === '/api/workbench/dsh-runs' && call.body.prompt === 'look around'));
    // The stub DOM does not propagate textContent upward, so concatenate the tree.
    const flatten = (node: any): string => [String(node.textContent || ''), ...(node.children || []).map(flatten)].join('\n');
    const out = flatten(nodes['.agent-output']);
    assert.match(out, /DSH says hi/); assert.match(out, /\[思考\] weighing options/);
    assert.match(out, /Run shell/); assert.match(out, /DSH 工具：t1/);
    assert.match(out, /\[计划\]/); assert.match(out, /\[配置更新\]/);
    assert.match(nodes['.agent-status'].textContent, /DSH 运行中|部分 DSH 实时输出已丢失/);
    // The approval card lists the tool call and offers exactly one accept/decline pair.
    const approvalBox = nodes['.agent-approvals'].children[0];
    assert.equal(approvalBox.children[0].textContent, 'DSH 需要你的审批');
    assert.match(approvalBox.children[1].textContent, /"name": "shell"/);
    const [accept, decline] = approvalBox.children.filter((child: any) => child.type === 'button');
    assert.equal(accept.textContent, '批准'); assert.equal(decline.textContent, '拒绝');
    await accept.onclick(); await settle();
    const approvalPost = calls.find(call => call.path.includes('/approval'));
    assert.deepEqual(approvalPost.body, { task_id: 'task', request_id: 'req-1', decision: 'accept' });
    // A decision the server never confirmed is named instead of assumed.
    failApproval = true;
    await decline.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /审批结果未确认：approval offline/);
    failApproval = false;
    assert.equal(timers.length, 1, 'a running turn schedules the next poll');
    // A queued prompt leaves through the dispatch route once the turn settles.
    dispatchPending = true;
    timers.shift()!(); await settle();
    assert.ok(polls >= 2, 'the next poll ran');
    assert.ok(calls.some(call => call.path.endsWith('/queue-dispatch')));
    assert.ok(calls.some(call => call.path.includes('/dsh-runs/run-dsh-2/events?')), 'a dispatched DSH prompt starts its own poll');
    assert.match(nodes['.agent-status'].textContent, /DSH 回合已结束/);
    assert.equal(nodes['.agent-approvals'].children.length, 0, 'a settled turn clears the approval card');
    assert.ok(calls.some(call => call.path.includes('/dsh-runs/run-dsh?task_id=task')));
    assert.equal(timers.length, 0, 'a finished turn stops polling');
    // Selecting an existing DSH link goes through the DSH resume branch, which
    // reports an unconfirmed turn differently from a Codex connection.
    fields.session.value = 'link-dsh';
    await buttons['resume'].onclick(); await settle();
    assert.ok(calls.some(call => call.path.includes('/resume')));
    assert.equal(fields['dsh-model'].value, 'm1');
    assert.ok(calls.some(call => call.path.includes('/dsh-models?workspace=')));
    assert.match(nodes['.agent-status'].textContent, /DSH 上次回合未决，请核对原生会话。/);
    linkTurnState = 'idle';
    buttons['refresh-sessions'].onclick(); await settle();
    fields.session.value = 'link-dsh';
    await buttons['resume'].onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /已选择 DSH 会话；发送时继续。/);
    fields['dsh-model'].value = 'm2'; fields['dsh-model'].onchange(); await settle();
    assert.deepEqual(calls.find(call => call.path.endsWith('/configuration'))?.body, { task_id: 'task', model: 'm2', permission: 'ask' });
    fields.permission.value = 'auto'; fields.permission.onchange(); await settle();
    assert.equal(calls.filter(call => call.path.endsWith('/configuration')).at(-1)?.body.permission, 'auto');
    // A connected DSH session submits the next prompt as its own turn.
    fields.prompt.value = 'keep going';
    await buttons.send.onclick(); await settle();
    assert.ok(calls.some(call => call.path === '/api/workbench/dsh-runs/turns' && call.body.prompt === 'keep going'));
    // A failing poll reports it instead of leaving the turn silently running.
    const failing = async () => { throw new Error('dsh unreachable'); };
    fields.provider.value = 'dsh'; fields.provider.onchange(); await settle();
    fields.prompt.value = 'again';
    const restore = api;
    await mountAgentWorkspace(root, { api: async (path: string, options: any = {}) => {
      if (path.includes('/events?')) return failing();
      if (path.includes('/dsh-runs')) return { run_id: 'run-dsh', link: { id: 'link-dsh' } };
      if (path === '/api/workbench/agent-sessions?task_id=task') return { links: [{ id: 'link-dsh', provider: 'dsh', workspace: '/proj' }] };
      return restore(path, options);
    }, taskId: 'task', clock: { setTimeout: (cb: () => void) => { timers.push(cb); return 1; } } });
    await settle();
    fields.provider.value = 'dsh'; fields.provider.onchange(); await settle();
    fields['dsh-model'].value = 'm1'; fields.workspace.value = '/proj'; fields.prompt.value = 'boom';
    await buttons['create'].onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /读取 DSH 失败/);
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});

test('the desktop install guide runs the installer and wires copy, open, close and refresh', async () => {
  class El {
    value = ''; textContent = ''; disabled = false; hidden = false; children: any[] = []; onclick: any; onchange: any;
    dataset: Record<string, string> = { state: 'send' }; ownerDocument: any; options: any[] = []; cached: Map<string, El> | null = null;
    attrs: Map<string, string> | null = null;
    constructor() { this.ownerDocument = { createElement: () => new El() }; }
    add(item: any) { this.children.push(item); }
    append(...items: any[]) { for (const item of items) if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } }
    replaceChildren(...items: any[]) { this.children = []; this.append(...items); }
    querySelector(selector?: string) { this.cached ??= new Map(); const key = String(selector); if (!this.cached.has(key)) this.cached.set(key, new El()); return this.cached.get(key)!; }
    querySelectorAll(selector?: string) { return [this.querySelector(selector)]; }
    setAttribute(name: string, value: string) { (this.attrs ??= new Map()).set(name, value); }
    getAttribute(name: string) { return (this.attrs ??= new Map()).get(name) ?? null; }
    closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: () => new El() };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _d = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const k of ['workspace', 'model', 'permission', 'work-mode', 'session', 'prompt', 'provider', 'claude-model', 'craft-model', 'dsh-model', 'dsh-reasoning', 'codex-model-group', 'claude-model-group', 'run']) fields[k] = new El();
  for (const k of ['create', 'resume', 'send', 'send-stop', 'composer-plus', 'reference-files', 'history', 'history-next', 'native-more', 'reconcile', 'reopen', 'refresh-runs', 'refresh-sessions', 'release-run', 'unlink', 'choose-project', 'native-folder', 'provider-install', 'provider-configure', 'provider-refresh']) buttons[k] = new El();
  buttons.send = buttons['send-stop'];
  for (const k of ['.agent-status', '.agent-output', '.agent-approvals', '.agent-queue', '.agent-history', '.agent-history pre', '.agent-native-picker', '.agent-native-list', '[data-role="mention-menu"]', '[data-role="install-help"]', '[data-role="provider-installed"]', '[data-role="provider-missing"]']) nodes[k] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (s: string) => s === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : s === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  const root: any = { isConnected: true, innerHTML: '', querySelector(s: string) { return nodes[s] || fields[s.match(/data-field="([^"]+)"/)?.[1] || ''] || buttons[s.match(/data-action="([^"]+)"/)?.[1] || ''] || null; } };
  const apiCalls: Array<{ path: string; init: any }> = [];
  const api = async (path: string, init: any = {}) => {
    apiCalls.push({ path, init });
    if (path === '/api/workbench/tool-install' && init.method === 'POST') {
      return { job: { id: 'install_1', provider: 'claude', state: 'running', stage: 'install', command: 'npm install -g', output: '$ npm install -g\n', exit_code: null, detected_executable: null, error: null, started_at: '2026-11-08T00:00:00Z', finished_at: null } };
    }
    if (path === '/api/workbench/tool-install/install_1') {
      return { job: { id: 'install_1', provider: 'claude', state: 'succeeded', stage: 'done', command: 'npm install -g', output: 'added 1 package\n[已验证] 可用\n', exit_code: 0, detected_executable: '/mock/bin/claude', error: null, started_at: '2026-11-08T00:00:00Z', finished_at: '2026-11-08T00:01:00Z' } };
    }
    if (path.endsWith('/providers')) return { providers: [{ id: 'codex', status: 'available', install_url: 'https://developers.openai.com/codex/cli/' },
      { id: 'claude', status: 'not_found', install_url: 'https://code.claude.com/docs/en/setup' }] };
    if (path.includes('/agent-sessions?')) return { links: [] };
    if (path.includes('/claude-runs')) return { runs: [] };
    if (path.endsWith('/models')) return { models: [] };
    if (path === '/api/settings') return {};
    return {};
  };
  const invokes: Array<{ command: string; args: any }> = [];
  const invoke = async (command: string, args: any) => {
    invokes.push({ command, args });
    return {};
  };
  try {
    mountAgentWorkspace(root, { api, taskId: '', clock: { setTimeout() {} }, invoke });
    await settle();
    fields.provider.value = 'claude'; fields.provider.onchange(); await settle();
    assert.equal(buttons['provider-install'].hidden, false);
    assert.equal(buttons['provider-configure'].hidden, false);
    buttons['provider-install'].onclick(); await settle();
    const help = nodes['[data-role="install-help"]'];
    assert.equal(help.hidden, false);
    assert.match(help.innerHTML, /Claude Code 安装/);
    assert.match(help.innerHTML, /npm install -g --allow-scripts=@anthropic-ai\/claude-code/);
    assert.ok(invokes.some(call => call.command === 'open_external_url' && call.args.url === 'https://code.claude.com/docs/en/setup'));
    assert.match(nodes['.agent-status'].textContent, /已显示安装指引/);

    // 复制 without a clipboard falls back to printing the value where it can be selected.
    const copy = help.querySelector('[data-install-copy]');
    copy.setAttribute('data-install-copy', 'npm install -g demo');
    delete (globalThis.navigator as any).clipboard;
    await copy.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /npm install -g demo/);
    // A working clipboard reports what it copied instead.
    const copied: string[] = [];
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (value: string) => { copied.push(value); } }, configurable: true });
    await copy.onclick(); await settle();
    assert.deepEqual(copied, ['npm install -g demo']);
    assert.match(nodes['.agent-status'].textContent, /已复制：npm install -g demo/);
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
    await copy.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /npm install -g demo/);

    const open = help.querySelector('[data-install-open]');
    open.setAttribute('data-install-open', 'https://example.test/download');
    await open.onclick(); await settle();
    assert.ok(invokes.some(call => call.args && call.args.url === 'https://example.test/download'));

    const output = help.querySelector('[data-install-output]');
    const run = help.querySelector('[data-install-run]');
    run.onclick(); await settle(); await settle();
    assert.ok(apiCalls.some(call => call.path === '/api/workbench/tool-install' && call.init.method === 'POST' && call.init.body.provider === 'claude'));
    assert.equal(output.hidden, false);
    assert.match(nodes['.agent-status'].textContent, /已验证并写入配置/);
    assert.ok(apiCalls.some(call => call.path === '/api/settings' && call.init.method === 'PATCH' && call.init.body && call.init.body.workbench && call.init.body.workbench.claudeExecutable === '/mock/bin/claude'));

    const refresh = help.querySelector('[data-install-refresh]');
    refresh.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /检测完成/);
    const close = help.querySelector('[data-install-close]');
    close.onclick();
    assert.equal(help.hidden, true);
  } finally { delete (globalThis.navigator as any).clipboard; (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});

test('model pickers name the catalog that failed instead of pretending it is empty', async () => {
  class El {
    value = ''; textContent = ''; disabled = false; hidden = false; children: any[] = []; onclick: any; onchange: any; dataset: Record<string, string> = { state: 'send' }; ownerDocument: any; options: any[] = [];
    constructor() { this.ownerDocument = { createElement: () => new El() }; }
    add(item: any) { this.children.push(item); if (item.selected) this.value = item.value; }
    append(...items: any[]) { for (const item of items) if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } }
    replaceChildren(...items: any[]) { this.children = []; this.append(...items); }
    querySelectorAll(selector?: string) { return selector === '.agent-turn' ? this.children : []; }
    querySelector() { return new El(); }
    setAttribute() {} remove() {} focus() {}
    closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: () => new El() };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _d = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const k of ['workspace', 'model', 'permission', 'work-mode', 'session', 'prompt', 'provider', 'claude-model', 'craft-model', 'dsh-model', 'dsh-reasoning', 'codex-model-group', 'claude-model-group', 'craft-model-group', 'dsh-model-group', 'dsh-reasoning-group', 'run']) fields[k] = new El();
  for (const k of ['create', 'resume', 'send', 'send-stop', 'composer-plus', 'reference-files', 'history', 'history-next', 'native-more', 'reconcile', 'reopen', 'refresh-runs', 'refresh-sessions', 'release-run', 'unlink', 'choose-project', 'native-folder', 'provider-install', 'provider-configure', 'provider-refresh']) buttons[k] = new El();
  buttons.send = buttons['send-stop'];
  for (const k of ['.agent-status', '.agent-output', '.agent-approvals', '.agent-queue', '.agent-history', '.agent-history pre', '.agent-native-picker', '.agent-native-list', '[data-role="mention-menu"]', '[data-role="install-help"]', '[data-role="provider-installed"]', '[data-role="provider-missing"]']) nodes[k] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (s: string) => s === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : s === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  const root: any = { isConnected: true, innerHTML: '', querySelector(s: string) { return nodes[s] || fields[s.match(/data-field="([^"]+)"/)?.[1] || ''] || buttons[s.match(/data-action="([^"]+)"/)?.[1] || ''] || null; } };
  let dshModelsFail = true, dshModelsEmpty = false, claudeModelsFail = false, claudeModelsTruncated = false, craftCatalogFail = true, craftModels: any[] = [{ id: 'g1', name: 'Gateway One', configured: false }];
  const calls: string[] = [];
  const api = async (path: string) => {
    calls.push(path);
    if (path.endsWith('/providers')) return { providers: [{ id: 'dsh', status: 'available' }, { id: 'craft', status: 'available' }] };
    if (path.includes('/agent-sessions?')) return { links: [] };
    if (path.includes('/claude-runs')) return { runs: [] };
    if (path.includes('/dsh-models')) { if (dshModelsFail) throw new Error('dsh catalog down'); return dshModelsEmpty ? { models: [], reasoning_efforts: [] } : { models: [{ id: 'm1', name: 'Model One', group: 'fast' }], reasoning_efforts: [{ id: 'low', name: 'Low' }] }; }
    if (path.includes('/claude-models')) { if (claudeModelsFail) throw new Error('claude catalog down'); return { models: [{ id: 'default', name: 'Default', is_default: true }, { id: 'sonnet', name: 'Sonnet' }], truncated: claudeModelsTruncated }; }
    if (path === '/api/config/models') { if (craftCatalogFail) throw new Error('gateway catalog down'); return { models: craftModels }; }
    if (path.endsWith('/models')) return { models: [] };
    if (path === '/api/settings') return {};
    return {};
  };
  try {
    mountAgentWorkspace(root, { api, taskId: '', clock: { setTimeout() {} }, invoke: async () => '/proj2' });
    await settle();
    fields.provider.value = 'dsh'; fields.provider.onchange(); await settle();
    assert.equal(fields['dsh-model'].children[0].text, '请先选择项目文件夹');
    fields.workspace.value = '/proj';
    fields.provider.value = 'dsh'; fields.provider.onchange(); await settle();
    assert.match(nodes['.agent-status'].textContent, /DSH 模型读取失败：dsh catalog down/);
    dshModelsFail = false;
    fields.provider.value = ''; fields.provider.onchange();
    fields.provider.value = 'dsh'; fields.provider.onchange(); await settle();
    assert.equal(fields['dsh-model'].children[1]!.text, 'fast · Model One');
    assert.equal(fields['dsh-reasoning'].children[1]!.text, 'Low');
    fields.permission.value = 'auto'; fields.permission.onchange();
    assert.match(nodes['.agent-status'].textContent, /DSH 自动接受权限请求/);
    fields.permission.value = 'full'; fields.permission.onchange();
    assert.match(nodes['.agent-status'].textContent, /DSH 自动接受权限请求；仍受 DSH 自身能力边界限制/);
    dshModelsEmpty = true;
    fields.provider.value = ''; fields.provider.onchange();
    fields.provider.value = 'dsh'; fields.provider.onchange(); await settle();
    assert.match(nodes['.agent-status'].textContent, /DSH 未返回可用模型/);
    dshModelsEmpty = false;
    calls.length = 0;
    await buttons['choose-project'].onclick(); await settle();
    assert.ok(calls.some(path => path.includes('/dsh-models?workspace=%2Fproj2')));
    fields['claude-model'].value = 'custom-model';
    claudeModelsTruncated = true;
    fields.provider.value = 'claude'; fields.provider.onchange(); await settle();
    assert.match(nodes['.agent-status'].textContent, /Claude Code 模型列表已截断/);
    assert.ok(fields['claude-model'].children.some((option: any) => option.value === 'custom-model'));
    claudeModelsTruncated = false; claudeModelsFail = true;
    fields.provider.value = ''; fields.provider.onchange();
    fields.provider.value = 'claude'; fields.provider.onchange(); await settle();
    assert.match(nodes['.agent-status'].textContent, /Claude Code 模型读取失败/);
    claudeModelsFail = false;
    // A Craft gateway with no configured model must say so, not silently stay empty.
    fields.provider.value = 'craft'; fields.provider.onchange(); await settle();
    assert.match(nodes['.agent-status'].textContent, /Craft 模型读取失败：gateway catalog down/);
    craftCatalogFail = false;
    fields.provider.value = ''; fields.provider.onchange();
    fields.provider.value = 'craft'; fields.provider.onchange(); await settle();
    assert.match(nodes['.agent-status'].textContent, /还没有可用模型/);
    craftModels = [{ id: 'g2', name: 'Gateway Two', configured: true }];
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});

test('mention suggestions cover the plugin, hint and failure paths, and plan mode waits for a model', async () => {
  class El {
    tagName = 'DIV'; value = ''; textContent = ''; disabled = false; hidden = false; className = ''; type = ''; children: any[] = [];
    onclick: any; oninput: any; onkeydown: any; onchange: any; dataset: Record<string, string> = { state: 'send' }; ownerDocument: any; options: any[] = [];
    constructor() { this.ownerDocument = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } }; }
    add(item: any) { this.children.push(item); if (item.selected) this.value = item.value; }
    append(...items: any[]) { for (const item of items) if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } }
    replaceChildren(...items: any[]) { this.children = []; this.append(...items); }
    querySelectorAll(selector?: string) { return selector === '.agent-turn' ? this.children : this.children.filter(item => item.type === 'button'); }
    querySelector() { return new El(); }
    setAttribute() {} remove() {} focus() {} setSelectionRange() {} scrollIntoView() {} closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _d = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const k of ['workspace', 'model', 'permission', 'work-mode', 'session', 'prompt', 'provider', 'claude-model', 'craft-model', 'dsh-model', 'dsh-reasoning', 'codex-model-group', 'claude-model-group', 'craft-model-group', 'dsh-model-group', 'dsh-reasoning-group', 'run']) fields[k] = new El();
  for (const k of ['create', 'resume', 'send', 'send-stop', 'composer-plus', 'reference-files', 'history', 'history-next', 'native-more', 'reconcile', 'reopen', 'refresh-runs', 'refresh-sessions', 'release-run', 'unlink', 'choose-project', 'native-folder', 'provider-install', 'provider-configure', 'provider-refresh']) buttons[k] = new El();
  buttons.send = buttons['send-stop'];
  for (const k of ['.agent-status', '.agent-output', '.agent-approvals', '.agent-queue', '.agent-history', '.agent-history pre', '.agent-native-picker', '.agent-native-list', '[data-role="mention-menu"]', '[data-role="provider-installed"]', '[data-role="provider-missing"]', '[data-role="install-help"]']) nodes[k] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (s: string) => s === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : s === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  const root: any = { isConnected: true, innerHTML: '', querySelector(s: string) { return nodes[s] || fields[s.match(/data-field="([^"]+)"/)?.[1] || ''] || buttons[s.match(/data-action="([^"]+)"/)?.[1] || ''] || null; } };
  let filesFail = false, skillsFail = false;
  const calls: Array<{ path: string; body: any }> = [];
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, body: options.body });
    if (path.endsWith('/providers')) return { providers: [{ id: 'codex', status: 'available' }] };
    if (path.includes('/agent-sessions?')) return { links: [] };
    if (path.includes('/claude-runs')) return { runs: [] };
    if (path.includes('/files?')) { if (filesFail) throw new Error('files down'); return { files: [{ path: 'src/a.ts', name: 'a.ts' }] }; }
    if (path.includes('/codex-skills')) { if (skillsFail) throw new Error('skills down'); return { skills: [{ name: 'inspect', description: 'Inspect project', plugin: 'demo-pack' }] }; }
    if (path.endsWith('/models')) return { models: [] };
    if (path === '/api/settings') return {};
    return {};
  };
  try {
    mountAgentWorkspace(root, { api, taskId: '', clock: { setTimeout() {} } });
    await settle();
    fields.provider.value = 'codex'; fields.provider.onchange(); await settle();
    const menu = nodes['[data-role="mention-menu"]'];
    const labels = () => menu.querySelectorAll('.agent-mention-item').map((item: any) => item.children[0].textContent);
    // Codex reads skills per project, so `/` says so instead of listing nothing.
    fields.prompt.value = '/'; fields.prompt.oninput(); await settle();
    assert.deepEqual(labels(), ['/plan', '/goal', '请先选择项目文件夹']);
    fields.workspace.value = '/proj';
    fields.prompt.value = '@'; fields.prompt.oninput(); await settle();
    assert.deepEqual(labels(), ['@src/a.ts', '$inspect', '手动选择文件或文件夹…']);
    assert.equal(menu.children.find((item: any) => item.className === 'agent-mention-group')!.textContent, '文件');
    let prevented = 0;
    menu.onmousedown({ preventDefault() { prevented += 1; } });
    menu.querySelectorAll('.agent-mention-item')[0].onmousedown({ preventDefault() { prevented += 1; } });
    assert.equal(prevented, 2);
    fields.prompt.onclick(); await settle();
    assert.equal(menu.hidden, false);
    fields.prompt.onfocus();
    assert.equal(nodes['.agent-native-picker'].open, false);
    // A file search that fails while nothing has rendered yet says so directly.
    filesFail = true; fields.prompt.value = '@x'; fields.prompt.oninput(); await settle();
    assert.match(menu.children[0].textContent, /读取失败：files down/);
    // A skill search that fails after the builtins rendered keeps them and appends the reason.
    skillsFail = true; fields.workspace.value = '/proj2'; fields.prompt.value = '/'; fields.prompt.oninput(); await settle();
    assert.deepEqual(labels(), ['/plan', '/goal', '部分建议读取失败']);
    filesFail = false; skillsFail = false;
    // 计划模式 without a Codex model parks the mode and says what is missing.
    fields.model.value = ''; fields.prompt.value = '/plan'; await buttons.send.onclick(); await settle();
    assert.equal(fields['work-mode'].value, 'plan');
    assert.match(nodes['.agent-status'].textContent, /已选择计划模式；发送前请先选择 Codex 模型。/);
    fields.provider.value = 'dsh'; fields.provider.onchange(); await settle();
    fields['work-mode'].value = 'default';
    fields.prompt.value = '/plan'; await buttons.send.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /DSH 不支持计划模式/);
    fields.prompt.value = '';
    buttons['composer-plus'].onclick(); await settle();
    let plusEntries = nodes['[data-role="mention-menu"]'].querySelectorAll('.agent-mention-item');
    await plusEntries[2].onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /DSH 新会话需要先输入第一条消息/);
    buttons['composer-plus'].onclick(); await settle();
    plusEntries = nodes['[data-role="mention-menu"]'].querySelectorAll('.agent-mention-item');
    await plusEntries[3].onclick(); await settle();
    assert.equal(nodes['.agent-native-picker'].hidden, false);
    assert.equal(nodes['.agent-native-picker'].open, true);
    fields['dsh-model'].value = 'ds1'; fields['dsh-reasoning'].value = 'low';
    fields.prompt.value = 'dsh first'; fields.workspace.value = '/proj'; fields.permission.value = 'auto';
    fields['dsh-model'].onchange(); await settle();
    await buttons.create.onclick(); await settle();
    const dshCreate = calls.find(call => call.path === '/api/workbench/dsh-runs')?.body;
    assert.equal(typeof dshCreate?.operation_id, 'string');
    assert.deepEqual({ ...dshCreate, operation_id: 'id' }, { task_id: '', workspace: '/proj', model: 'ds1', reasoning_effort: 'low', permission: 'auto', prompt: 'dsh first', operation_id: 'id' });
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});

test('a Claude session dispatches its queue and a Codex session answers /goal', async () => {
  class El {
    tagName = 'DIV'; value = ''; textContent = ''; disabled = false; hidden = false; className = ''; type = ''; children: any[] = [];
    onclick: any; onchange: any; oninput: any; dataset: Record<string, string> = { state: 'send' }; ownerDocument: any; options: any[] = [];
    constructor() { this.ownerDocument = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } }; }
    add(item: any) { this.children.push(item); if (item.selected) this.value = item.value; }
    append(...items: any[]) { for (const item of items) if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } }
    replaceChildren(...items: any[]) { this.children = []; this.append(...items); }
    querySelectorAll(selector?: string) { return selector === '.agent-turn' ? this.children : this.children.filter(item => item.type === 'button'); }
    querySelector() { return new El(); }
    setAttribute() {} remove() {} focus() {} setSelectionRange() {} scrollIntoView() {} closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _d = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const k of ['workspace', 'model', 'permission', 'work-mode', 'session', 'prompt', 'provider', 'claude-model', 'craft-model', 'dsh-model', 'dsh-reasoning', 'codex-model-group', 'claude-model-group', 'craft-model-group', 'dsh-model-group', 'dsh-reasoning-group', 'run']) fields[k] = new El();
  for (const k of ['create', 'resume', 'send', 'send-stop', 'composer-plus', 'reference-files', 'history', 'history-next', 'native-more', 'reconcile', 'reopen', 'refresh-runs', 'refresh-sessions', 'release-run', 'unlink', 'choose-project', 'native-folder', 'provider-install', 'provider-configure', 'provider-refresh']) buttons[k] = new El();
  buttons.send = buttons['send-stop'];
  for (const k of ['.agent-status', '.agent-output', '.agent-approvals', '.agent-queue', '.agent-history', '.agent-history pre', '.agent-native-picker', '.agent-native-list', '[data-role="mention-menu"]', '[data-role="provider-installed"]', '[data-role="provider-missing"]', '[data-role="install-help"]']) nodes[k] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (s: string) => s === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : s === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  const root: any = { isConnected: true, innerHTML: '', querySelector(s: string) { return nodes[s] || fields[s.match(/data-field="([^"]+)"/)?.[1] || ''] || buttons[s.match(/data-action="([^"]+)"/)?.[1] || ''] || null; } };
  const calls: Array<{ path: string; body: any; method?: string }> = [];
  let dispatches = 0, queued = [{ id: 'q1', state: 'queued', prompt: 'queued work' }];
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, body: options.body, method: options.method });
    if (path.endsWith('/providers')) return { providers: [{ id: 'claude', status: 'available' }, { id: 'codex', status: 'available' }] };
    if (path.includes('/claude-models')) return { models: [{ id: 'default', name: 'Default', is_default: true }, { id: 'sonnet', name: 'Sonnet' }] };
    if (path.includes('/agent-sessions?')) return { links: [
      { id: 'link-claude', provider: 'claude', model: 'sonnet', workspace: '/proj', turn_state: 'idle' },
      { id: 'link-codex', provider: 'codex', model: 'm', workspace: '/proj', turn_state: 'idle' },
    ] };
    if (path.includes('/queue?')) return { items: queued };
    if (path.endsWith('/queue-dispatch')) { dispatches += 1; if (dispatches > 1) return { empty: true }; return { prompt: 'queued work', provider: 'claude', run_id: 'run-q' }; }
    if (path.endsWith('/turns') && options.method === 'POST') return { run_id: 'run-c' };
    if (path.endsWith('/goal') && options.method === 'POST') return { goal: { objective: 'ship it', status: 'active' } };
    if (path.includes('/history?')) return { provider: 'claude', messages: [{ type: 'user', message: 'earlier' }] };
    if (path.includes('/claude-runs?')) return { runs: [] };
    if (path.includes('/events?')) return { state: 'completed', last_sequence: 1, events: [], approvals: [], status: { connected: true, link: { turn_state: 'idle' } } };
    if (path.endsWith('/models')) return { models: [] };
    if (path === '/api/settings') return {};
    return {};
  };
  try {
    mountAgentWorkspace(root, { api, taskId: 'task', clock: { setTimeout() {} } });
    await settle();
    fields.provider.value = 'claude'; fields.provider.onchange(); await settle();
    assert.equal(fields['claude-model'].children[1]!.text, 'Sonnet · sonnet');
    fields.session.value = 'link-claude';
    await buttons['resume'].onclick(); await settle(); await settle();
    assert.match(nodes['.agent-status'].textContent, /已选择 Claude 会话；发送时恢复。|Claude 回合已结束/);
    // Resume drains a queued prompt through the queue-dispatch route.
    const dispatch = calls.find(call => call.path.endsWith('/queue-dispatch'));
    assert.deepEqual(dispatch!.body, { task_id: 'task' });
    assert.ok(calls.some(call => call.path.includes('/claude-runs/run-q/events?')), 'a dispatched prompt starts polling its run');
    const flatten = (node: any): string => [String(node.textContent || ''), ...(node.children || []).map(flatten)].join('\n');
    assert.match(flatten(nodes['.agent-output']), /queued work/);
    // Sending while a run is active queues instead of submitting a second turn.
    queued = [];
    fields.prompt.value = 'next thing';
    fields['claude-model'].value = 'sonnet'; fields.permission.value = 'ask';
    await buttons.send.onclick(); await settle();
    assert.ok(calls.some(call => call.path.endsWith('/turns') && call.body.prompt === 'next thing'), 'a Claude send posts a turn for the linked session');

    // Codex answers /goal from the same conversation surface.
    fields.session.value = 'link-codex';
    await buttons['resume'].onclick(); await settle(); await settle();
    fields.prompt.value = '/goal make it ship';
    await buttons.send.onclick(); await settle();
    const goal = calls.find(call => call.path.endsWith('/goal'));
    assert.deepEqual(goal!.body, { task_id: 'task', objective: 'make it ship' });
    assert.match(flatten(nodes['.agent-output']), /\[目标\] ship it · active/);
    fields.prompt.value = '/goal';
    await buttons.send.onclick(); await settle();
    assert.match(flatten(nodes['.agent-output']), /\[目标\] ship it · active/);
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});

test('a busy Codex session offers a takeover that reconnects', async () => {
  class El {
    tagName = 'DIV'; value = ''; textContent = ''; disabled = false; hidden = false; className = ''; type = ''; children: any[] = [];
    onclick: any; onchange: any; dataset: Record<string, string> = { state: 'send' }; ownerDocument: any; options: any[] = [];
    constructor() { this.ownerDocument = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } }; }
    add(item: any) { this.children.push(item); if (item.selected) this.value = item.value; }
    append(...items: any[]) { for (const item of items) if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } }
    replaceChildren(...items: any[]) { this.children = []; this.append(...items); }
    querySelectorAll(selector?: string) { return selector === '.agent-turn' ? this.children : this.children.filter(item => item.type === 'button'); }
    querySelector() { return new El(); }
    setAttribute() {} remove() {} focus() {} setSelectionRange() {} scrollIntoView() {} closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _d = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const k of ['workspace', 'model', 'permission', 'work-mode', 'session', 'prompt', 'provider', 'claude-model', 'craft-model', 'dsh-model', 'dsh-reasoning', 'codex-model-group', 'claude-model-group', 'craft-model-group', 'dsh-model-group', 'dsh-reasoning-group', 'run']) fields[k] = new El();
  for (const k of ['create', 'resume', 'send', 'send-stop', 'composer-plus', 'reference-files', 'history', 'history-next', 'native-more', 'reconcile', 'reopen', 'refresh-runs', 'refresh-sessions', 'release-run', 'unlink', 'choose-project', 'native-folder', 'provider-install', 'provider-configure', 'provider-refresh']) buttons[k] = new El();
  buttons.send = buttons['send-stop'];
  for (const k of ['.agent-status', '.agent-output', '.agent-approvals', '.agent-queue', '.agent-history', '.agent-history pre', '.agent-native-picker', '.agent-native-list', '[data-role="mention-menu"]', '[data-role="provider-installed"]', '[data-role="provider-missing"]', '[data-role="install-help"]']) nodes[k] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (s: string) => s === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : s === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  const root: any = { isConnected: true, innerHTML: '', querySelector(s: string) { return nodes[s] || fields[s.match(/data-field="([^"]+)"/)?.[1] || ''] || buttons[s.match(/data-action="([^"]+)"/)?.[1] || ''] || null; } };
  const calls: Array<{ path: string; body: any; method?: string }> = [];
  let busy = true;
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, body: options.body, method: options.method });
    if (path.endsWith('/providers')) return { providers: [{ id: 'codex', status: 'available', version: 'codex 1' }] };
    if (path.includes('/agent-sessions?')) return { links: [{ id: 'link-1', provider: 'codex', model: 'm', workspace: '/proj', turn_state: 'idle' }] };
    if (path.endsWith('/resume')) { if (busy) throw new Error('该 Codex 会话正由其他进程使用'); return {}; }
    if (path.includes('/takeover?')) return { available: true, pid: 4242, started: 'ts', source: 'external', session_count: 2 };
    if (path.endsWith('/takeover')) { busy = false; return { stopped: true }; }
    if (path.includes('/events?')) return { generation: 'g', last_sequence: 1, events: [], approvals: [], status: { connected: true, link: { turn_state: 'idle' } } };
    if (path.includes('/history?')) return { thread: { turns: [] } };
    if (path.endsWith('/models')) return { models: [] };
    if (path.includes('/claude-runs')) return { runs: [] };
    if (path === '/api/settings') return {};
    return {};
  };
  try {
    mountAgentWorkspace(root, { api, taskId: 'task', clock: { setTimeout() {} } });
    await settle();
    fields.session.value = 'link-1';
    await buttons.resume.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /连接失败：该 Codex 会话正由其他进程使用/);
    const box = nodes['.agent-approvals'].children.find((child: any) => child.className === 'agent-approval');
    assert.ok(box, 'a busy session must offer a way out instead of only an error');
    assert.match(box.children[0].textContent, /Codex 进程 4242 正占用此会话/);
    assert.match(box.children[0].textContent, /打开了 2 个会话/);
    const take = box.children.find((child: any) => child.type === 'button' && child.textContent === '接管会话');
    assert.ok(take);
    await take.onclick(); await settle(); await settle();
    const takeoverPost = calls.find(call => call.path.endsWith('/takeover') && call.method === 'POST');
    assert.deepEqual(takeoverPost!.body, { task_id: 'task', pid: 4242, started: 'ts', session_count: 2 });
    assert.equal(calls.filter(call => call.path.endsWith('/resume')).length, 2, 'reconnects after the takeover');
    assert.equal(nodes['.agent-status'].textContent, '已连接');
    assert.equal(nodes['.agent-approvals'].children.length, 0, 'the takeover prompt clears once connected');
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});

test('a Claude question collects options and refuses to submit a partial answer', async () => {
  class El {
    tagName = 'DIV'; value = ''; textContent = ''; disabled = false; hidden = false; className = ''; type = ''; placeholder = ''; children: any[] = [];
    onclick: any; oninput: any; onchange: any; dataset: Record<string, string> = { state: 'send' }; ownerDocument: any; options: any[] = [];
    constructor() { this.ownerDocument = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } }; }
    add(item: any) { this.children.push(item); if (item.selected) this.value = item.value; }
    append(...items: any[]) { for (const item of items) if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } }
    replaceChildren(...items: any[]) { this.children = []; this.append(...items); }
    querySelectorAll(selector?: string) { return selector === '.agent-turn' ? this.children : this.children.filter(item => item.type === 'button'); }
    querySelector() { return new El(); }
    setAttribute() {} remove() {} focus() {} setSelectionRange() {} scrollIntoView() {} closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _d = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const k of ['workspace', 'model', 'permission', 'work-mode', 'session', 'prompt', 'provider', 'claude-model', 'craft-model', 'dsh-model', 'dsh-reasoning', 'codex-model-group', 'claude-model-group', 'craft-model-group', 'dsh-model-group', 'dsh-reasoning-group', 'run']) fields[k] = new El();
  for (const k of ['create', 'resume', 'send', 'send-stop', 'composer-plus', 'reference-files', 'history', 'history-next', 'native-more', 'reconcile', 'reopen', 'refresh-runs', 'refresh-sessions', 'release-run', 'unlink', 'choose-project', 'native-folder', 'provider-install', 'provider-configure', 'provider-refresh']) buttons[k] = new El();
  buttons.send = buttons['send-stop'];
  for (const k of ['.agent-status', '.agent-output', '.agent-approvals', '.agent-queue', '.agent-history', '.agent-history pre', '.agent-native-picker', '.agent-native-list', '[data-role="mention-menu"]', '[data-role="provider-installed"]', '[data-role="provider-missing"]', '[data-role="install-help"]']) nodes[k] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (s: string) => s === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : s === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  const root: any = { isConnected: true, innerHTML: '', querySelector(s: string) { return nodes[s] || fields[s.match(/data-field="([^"]+)"/)?.[1] || ''] || buttons[s.match(/data-action="([^"]+)"/)?.[1] || ''] || null; } };
  const calls: Array<{ path: string; body: any }> = [];
  let withApproval = true;
  const api = async (path: string, options: any = {}) => {
    if (path.endsWith('/providers')) return { providers: [{ id: 'claude', status: 'available', version: 'claude 1' }] };
    if (path.includes('/claude-models')) return { models: [{ id: 'default', name: 'Default', is_default: true }, { id: 'sonnet', name: 'Sonnet' }] };
    if (path.includes('/agent-sessions?')) return { links: [{ id: 'link-c', provider: 'claude', model: 'sonnet', workspace: '/proj', turn_state: 'idle' }] };
    if (path.includes('/claude-runs?')) return { runs: [] };
    if (path.endsWith('/claude-runs') && options.method === 'POST') return { run_id: 'run-q' };
    if (path.includes('/claude-runs/run-q/events?')) {
      calls.push({ path, body: null });
      return { state: 'running', native_session_id: 'native-q', last_sequence: 1, events: [],
        approvals: withApproval ? [{ id: 'ask-1', tool: 'AskUserQuestion', input: { questions: [
          { question: 'Pick one', multiSelect: true, options: [{ label: 'A', description: 'first' }, { label: 'B' }] },
          { question: 'Why', options: [] },
        ] } }] : [] };
    }
    if (path.endsWith('/claude-runs/run-q/approval')) { calls.push({ path, body: options.body }); withApproval = false; return {}; }
    if (path.includes('/models')) return { models: [] };
    if (path === '/api/settings') return {};
    return {};
  };
  try {
    mountAgentWorkspace(root, { api, taskId: 'task', clock: { setTimeout() {} } });
    await settle();
    fields.provider.value = 'claude'; fields.provider.onchange(); await settle();
    fields['claude-model'].value = 'sonnet'; fields.workspace.value = '/proj'; fields.permission.value = 'ask';
    fields.prompt.value = 'ask me something';
    await buttons.create.onclick(); await settle(); await settle();
    const box = nodes['.agent-approvals'].children.find((child: any) => child.className === 'agent-approval');
    assert.ok(box, 'a Claude question is rendered as an approval card');
    assert.equal(box.children[0].textContent, 'Claude 需要你的回答');
    const inputs = box.children.filter((child: any) => child.tagName === 'LABEL').map((label: any) => label.children[0]);
    assert.equal(inputs.length, 2, 'one input per question');
    const [first, second] = inputs;
    const options = box.children.filter((child: any) => child.type === 'button' && ['A', 'B'].includes(child.textContent));
    assert.equal(options.length, 2, 'only the question with options renders choices');
    options[0].onclick(); first.oninput();
    assert.equal(first.value, 'A');
    options[1].onclick(); first.oninput();
    assert.equal(first.value, 'A, B');
    options[1].onclick(); first.oninput();
    assert.equal(first.value, 'A');
    const submit = box.children.filter((child: any) => child.type === 'button').find((child: any) => child.textContent === '提交回答');
    assert.ok(submit);
    // The empty second answer blocks submission instead of sending a partial reply.
    await submit.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /请回答每个问题/);
    assert.equal(calls.filter(call => call.path.endsWith('/approval')).length, 0);
    second.value = 'because'; second.oninput();
    await submit.onclick(); await settle();
    const posted = calls.find(call => call.path.endsWith('/approval'))!;
    assert.deepEqual(posted.body, { task_id: 'task', request_id: 'ask-1', decision: 'accept', answers: { 'Pick one': 'A', Why: 'because' } });
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});

test('a queued prompt can be edited, steered or withdrawn from its row', async () => {
  class El {
    tagName = 'DIV'; value = ''; textContent = ''; disabled = false; hidden = false; className = ''; type = ''; children: any[] = [];
    onclick: any; onchange: any; dataset: Record<string, string> = { state: 'send' }; ownerDocument: any; options: any[] = [];
    constructor() { this.ownerDocument = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } }; }
    add(item: any) { this.children.push(item); if (item.selected) this.value = item.value; }
    append(...items: any[]) { for (const item of items) if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } }
    replaceChildren(...items: any[]) { this.children = []; this.append(...items); }
    querySelectorAll(selector?: string) { return selector === '.agent-turn' ? this.children : this.children.filter(item => item.type === 'button'); }
    querySelector() { return new El(); }
    setAttribute() {} remove() {} focus() {} setSelectionRange() {} scrollIntoView() {} closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _d = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const k of ['workspace', 'model', 'permission', 'work-mode', 'session', 'prompt', 'provider', 'claude-model', 'craft-model', 'dsh-model', 'dsh-reasoning', 'codex-model-group', 'claude-model-group', 'craft-model-group', 'dsh-model-group', 'dsh-reasoning-group', 'run']) fields[k] = new El();
  for (const k of ['create', 'resume', 'send', 'send-stop', 'composer-plus', 'reference-files', 'history', 'history-next', 'native-more', 'reconcile', 'reopen', 'refresh-runs', 'refresh-sessions', 'release-run', 'unlink', 'choose-project', 'native-folder', 'provider-install', 'provider-configure', 'provider-refresh']) buttons[k] = new El();
  buttons.send = buttons['send-stop'];
  for (const k of ['.agent-status', '.agent-output', '.agent-approvals', '.agent-queue', '.agent-history', '.agent-history pre', '.agent-native-picker', '.agent-native-list', '[data-role="mention-menu"]', '[data-role="provider-installed"]', '[data-role="provider-missing"]', '[data-role="install-help"]']) nodes[k] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (s: string) => s === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : s === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  const root: any = { isConnected: true, innerHTML: '', querySelector(s: string) { return nodes[s] || fields[s.match(/data-field="([^"]+)"/)?.[1] || ''] || buttons[s.match(/data-action="([^"]+)"/)?.[1] || ''] || null; } };
  const calls: Array<{ path: string; body: any; method?: string }> = [];
  let queued: any[] = [{ id: 'q1', state: 'queued', prompt: 'queued work', version: 1, work_mode: 'default' }];
  let failQueueEdit = false, failQueueDelete = false;
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, body: options.body, method: options.method });
    if (path.endsWith('/providers')) return { providers: [{ id: 'codex', status: 'available', version: 'codex 1' }] };
    if (path.includes('/agent-sessions?') && !path.includes('/queue')) return { links: [{ id: 'link-1', provider: 'codex', model: 'm', workspace: '/proj', turn_state: 'running' }] };
    if (path.endsWith('/resume')) return {};
    if (path.includes('/events?')) return { generation: 'g', last_sequence: 1, events: [], approvals: [], status: { connected: true, link: { turn_state: 'running' } } };
    if (path.includes('/history?')) return { thread: { turns: [] } };
    if (path.endsWith('/queue-steer')) return { prompt: 'queued work' };
    if (options.method === 'DELETE' && path.includes('/queue?')) { if (failQueueDelete) throw new Error('withdraw failed'); queued = []; return {}; }
    if (options.method === 'PATCH' && path.endsWith('/queue')) { if (failQueueEdit) throw new Error('edit conflict'); queued = [{ ...queued[0], prompt: options.body.prompt }]; return { item: queued[0] }; }
    if (path.includes('/queue?') && options.method === undefined) return { items: queued };
    if (path.endsWith('/models')) return { models: [] };
    if (path.endsWith('/claude-runs') || path.includes('/claude-runs?')) return { runs: [] };
    if (path === '/api/settings') return {};
    return {};
  };
  try {
    mountAgentWorkspace(root, { api, taskId: 'task', clock: { setTimeout() {} } });
    await settle();
    fields.session.value = 'link-1';
    await buttons.resume.onclick(); await settle(); await settle();
    const row = () => nodes['.agent-queue'].children[0];
    assert.ok(row(), 'a running turn surfaces its queued prompt');
    assert.match(row().children[0].textContent, /^排队中：queued work$/);
    const label = (text: string) => row().children.find((child: any) => child.type === 'button' && child.textContent === text);
    assert.ok(label('编辑') && label('立即指导') && label('撤回'));
    // Cancelling an inline edit restores the untouched queued row.
    label('编辑').onclick();
    label('取消').onclick(); await settle();
    assert.match(row().children[0].textContent, /queued work/);
    // A failed save keeps the editor and says why instead of dropping the draft.
    failQueueEdit = true;
    label('编辑').onclick();
    row().children.find((child: any) => child.tagName === 'TEXTAREA').value = 'rejected edit';
    await label('保存').onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /保存失败：edit conflict/);
    assert.ok(row().children.some((child: any) => child.tagName === 'TEXTAREA'));
    label('取消').onclick(); await settle();
    failQueueEdit = false;
    // Editing replaces the row with an input and saves the new prompt.
    label('编辑').onclick();
    const editor = row().children.find((child: any) => child.tagName === 'TEXTAREA');
    assert.equal(editor.value, 'queued work');
    editor.value = 'edited work';
    await label('保存').onclick(); await settle();
    assert.deepEqual(calls.filter(call => call.method === 'PATCH').at(-1)?.body, { task_id: 'task', item_id: 'q1', prompt: 'edited work' });
    assert.match(row().children[0].textContent, /edited work/);
    // 立即指导 submits the queued prompt into the running turn.
    await label('立即指导').onclick(); await settle();
    assert.deepEqual(calls.find(call => call.path.endsWith('/queue-steer')).body, { task_id: 'task', item_id: 'q1' });
    assert.match(nodes['.agent-status'].textContent, /已提交指导/);
    // 撤回 removes the queued prompt without sending it.
    failQueueDelete = true;
    await label('撤回').onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /撤回失败：withdraw failed/);
    assert.ok(row());
    failQueueDelete = false;
    await label('撤回').onclick(); await settle();
    assert.ok(calls.some(call => call.method === 'DELETE' && call.path.includes('/queue')));
    assert.equal(nodes['.agent-queue'].children.length, 0);
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});

test('Craft sends through the configured gateway and binds a new task to its model', async () => {
  class El {
    tagName = 'DIV'; value = ''; textContent = ''; disabled = false; hidden = false; className = ''; type = '';
    children: any[] = []; onclick: any; onchange: any; oninput: any; dataset: Record<string, string> = { state: 'send' };
    ownerDocument: any; options: any[] = []; selectionStart = 0;
    constructor() {
      this.ownerDocument = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } };
    }
    add(item: any) { this.children.push(item); this.options.push(item); if (item.selected) this.value = item.value; }
    append(...items: any[]) { for (const item of items) if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } }
    replaceChildren(...items: any[]) { this.children = []; this.options = []; this.append(...items); }
    querySelectorAll(selector?: string) {
      if (selector === '.agent-turn') return this.children;
      if (selector === '.agent-mention-item') return this.children.filter(item => item.className === 'agent-mention-item');
      return this.children.filter(item => item.type === 'button');
    }
    querySelector(selector?: string) {
      if (selector === '.agent-mention-item[aria-selected="true"]') return this.children.find(item => item.className === 'agent-mention-item') || new El();
      return new El();
    }
    setAttribute() {} remove() {} focus() {} setSelectionRange() {} scrollIntoView() {} closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _d = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const key of ['workspace', 'model', 'permission', 'work-mode', 'session', 'prompt', 'provider', 'claude-model', 'craft-model', 'dsh-model', 'dsh-reasoning', 'codex-model-group', 'claude-model-group', 'craft-model-group', 'dsh-model-group', 'dsh-reasoning-group', 'run']) fields[key] = new El();
  for (const key of ['create', 'resume', 'send', 'send-stop', 'composer-plus', 'reference-files', 'history', 'history-next', 'native-more', 'reconcile', 'reopen', 'refresh-runs', 'refresh-sessions', 'release-run', 'unlink', 'choose-project', 'native-folder', 'provider-install', 'provider-configure', 'provider-refresh']) buttons[key] = new El();
  buttons.send = buttons['send-stop'];
  for (const key of ['.agent-status', '.agent-output', '.agent-approvals', '.agent-queue', '.agent-history', '.agent-history pre', '.agent-native-picker', '.agent-native-list', '[data-role="mention-menu"]', '[data-role="provider-installed"]', '[data-role="provider-missing"]', '[data-role="install-help"]']) nodes[key] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (selector: string) => selector === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : selector === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  const root: any = { isConnected: true, innerHTML: '', querySelector(selector: string) { return nodes[selector] || fields[selector.match(/data-field="([^"]+)"/)?.[1] || ''] || buttons[selector.match(/data-action="([^"]+)"/)?.[1] || ''] || null; } };
  const calls: Array<{ path: string; method?: string; body: any }> = [];
  let failCraft = false, changed = 0;
  const api = async (path: string, options: any = {}) => {
    calls.push({ path, method: options.method, body: options.body });
    if (path.endsWith('/providers')) return { providers: [{ id: 'craft', name: 'Craft', status: 'available' }] };
    if (path === '/api/config/models') return { models: [{ id: 'gateway-1', name: 'Gateway One', configured: true }] };
    if (path === '/api/tasks' && options.method === 'POST') return { task: { id: 'task-craft' } };
    if (path === '/api/tasks/task-craft/messages') { if (failCraft) throw new Error('gateway unavailable'); return { assistant: { content: 'gateway answer' } }; }
    if (path === '/api/workbench/agent-sessions/models') return { models: [] };
    if (path === '/api/workbench/agent-sessions?task_id=') return { links: [] };
    if (path === '/api/workbench/claude-runs?task_id=') return { runs: [] };
    if (path === '/api/settings') return {};
    return {};
  };
  try {
    mountAgentWorkspace(root, { api, taskId: '', defaultPermission: 'auto', onSessionsChanged: () => { changed += 1; } });
    await settle();
    nodes['.agent-native-picker'].open = true; nodes['.agent-native-picker'].ontoggle(); await settle();
    assert.equal(nodes['.agent-native-list'].textContent, '请先选择工具。');
    fields.provider.value = 'craft'; fields.provider.onchange(); await settle();
    assert.equal(fields['craft-model'].value, 'gateway-1');
    fields.permission.value = 'auto'; fields.permission.onchange();
    assert.match(nodes['.agent-status'].textContent, /Craft 对话不会执行文件或命令/);
    fields.permission.value = 'full'; fields.permission.onchange();
    assert.match(nodes['.agent-status'].textContent, /权限模式只记录给后续工具回合/);
    fields.permission.value = 'auto'; fields.permission.onchange();
    fields['craft-model'].onchange(); await settle();
    nodes['.agent-native-picker'].open = true; nodes['.agent-native-picker'].ontoggle(); await settle();
    assert.equal(nodes['.agent-native-list'].textContent, '该工具没有可接入的原生会话。');
    fields.workspace.value = '/project';
    fields.prompt.value = '/status'; fields.prompt.selectionStart = 7; fields.prompt.oninput(); await settle();
    await buttons.send.onclick(); await settle();
    assert.match(nodes['.agent-output'].children.at(-1).children[0].textContent, /当前工具不提供/);
    fields.prompt.value = '/'; fields.prompt.selectionStart = 1; fields.prompt.oninput(); await settle();
    assert.ok(nodes['[data-role="mention-menu"]'].children.some((item: any) => item.children?.[0]?.textContent === '/plan'));
    assert.equal(calls.some(call => call.path.includes('/claude-commands')), false);
    fields.prompt.value = 'hello'; fields.prompt.selectionStart = 5; fields.prompt.oninput(); await settle();
    assert.equal(buttons.send.disabled, false);
    await buttons.send.onclick(); await settle();
    const created = calls.find(call => call.path === '/api/tasks');
    assert.deepEqual(created?.body, { title: 'project', goal: 'hello', model_id: 'gateway-1', permission_mode: 'assisted_approval', workspace: '/project' });
    assert.deepEqual(calls.find(call => call.path === '/api/tasks/task-craft/messages')?.body, { content: 'hello', model_id: 'gateway-1', permission_mode: 'assisted_approval' });
    assert.equal(fields.prompt.value, '');
    assert.match(nodes['.agent-output'].children.at(-1).children[0].textContent, /gateway answer/);
    assert.equal(changed, 2, 'task creation and the completed turn both refresh the task list');
    fields.prompt.value = 'again'; fields.prompt.selectionStart = 5; fields.prompt.oninput(); await settle();
    await buttons.send.onclick(); await settle();
    assert.equal(calls.filter(call => call.path === '/api/tasks').length, 1, 'the existing Craft task is reused');
    assert.equal(calls.filter(call => call.path === '/api/tasks/task-craft/messages').length, 2);
    assert.equal(changed, 3);
    assert.deepEqual(calls.filter(call => call.path === '/api/tasks/task-craft/messages').at(-1)?.body, { content: 'again', model_id: 'gateway-1', permission_mode: 'assisted_approval' });
    failCraft = true; fields.prompt.value = 'keep me'; fields.prompt.selectionStart = 7; fields.prompt.oninput(); await settle();
    await buttons.send.onclick(); await settle();
    assert.equal(fields.prompt.value, 'keep me');
    assert.match(nodes['.agent-status'].textContent, /Craft 回合未完成：gateway unavailable/);
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});

test('Craft setup failures retain the prompt and an empty model reply is named', async () => {
  class El {
    tagName = 'DIV'; value = ''; textContent = ''; disabled = false; hidden = false; className = ''; type = '';
    children: any[] = []; onclick: any; onchange: any; oninput: any; dataset: Record<string, string> = { state: 'send' };
    ownerDocument: any; options: any[] = []; selectionStart = 0;
    constructor() {
      this.ownerDocument = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } };
    }
    add(item: any) { this.children.push(item); this.options.push(item); if (item.selected) this.value = item.value; }
    append(...items: any[]) { for (const item of items) if (item && typeof item === 'object') { this.children.push(item); item.parentElement = this; } }
    replaceChildren(...items: any[]) { this.children = []; this.options = []; this.append(...items); }
    querySelectorAll(selector?: string) { return selector === '.agent-turn' ? this.children : this.children.filter(item => item.type === 'button'); }
    querySelector() { return new El(); }
    setAttribute() {} remove() {} focus() {} setSelectionRange() {} scrollIntoView() {} closest() { return this; }
  }
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  (globalThis as any).document = { createElement: (tag = 'div') => { const node = new El(); node.tagName = String(tag).toUpperCase(); return node; } };
  (globalThis as any).Option = class { text: string; value: string; selected: boolean; constructor(text: string, value: string, _d = false, selected = false) { this.text = text; this.value = value; this.selected = selected; } };
  const fields: Record<string, any> = {}, buttons: Record<string, any> = {}, nodes: Record<string, any> = {};
  for (const key of ['workspace', 'model', 'permission', 'work-mode', 'session', 'prompt', 'provider', 'claude-model', 'craft-model', 'dsh-model', 'dsh-reasoning', 'codex-model-group', 'claude-model-group', 'craft-model-group', 'dsh-model-group', 'dsh-reasoning-group', 'run']) fields[key] = new El();
  for (const key of ['create', 'resume', 'send', 'send-stop', 'composer-plus', 'reference-files', 'history', 'history-next', 'native-more', 'reconcile', 'reopen', 'refresh-runs', 'refresh-sessions', 'release-run', 'unlink', 'choose-project', 'native-folder', 'provider-install', 'provider-configure', 'provider-refresh']) buttons[key] = new El();
  buttons.send = buttons['send-stop'];
  for (const key of ['.agent-status', '.agent-output', '.agent-approvals', '.agent-queue', '.agent-history', '.agent-history pre', '.agent-native-picker', '.agent-native-list', '[data-role="mention-menu"]', '[data-role="provider-installed"]', '[data-role="provider-missing"]', '[data-role="install-help"]']) nodes[key] = new El();
  nodes['.agent-output'].ownerDocument = (globalThis as any).document;
  fields.provider.querySelector = (selector: string) => selector === '[data-role="provider-installed"]' ? nodes['[data-role="provider-installed"]'] : selector === '[data-role="provider-missing"]' ? nodes['[data-role="provider-missing"]'] : new El();
  const root: any = { isConnected: true, innerHTML: '', querySelector(selector: string) { return nodes[selector] || fields[selector.match(/data-field="([^"]+)"/)?.[1] || ''] || buttons[selector.match(/data-action="([^"]+)"/)?.[1] || ''] || null; } };
  const calls: Array<{ path: string; body: any }> = [];
  let createMissing = true, failCraftHistory = false;
  let deferCraftModels = false, releaseCraftModels: (() => void) | undefined;
  const baseApi = async (path: string, options: any = {}) => {
    calls.push({ path, body: options.body });
    if (path.endsWith('/providers')) return { providers: [{ id: 'craft', name: 'Craft', status: 'available' }] };
    if (path === '/api/config/models') {
      const models = { models: [{ id: 'gateway-1', name: 'Gateway One', configured: true }] };
      if (!deferCraftModels) return models;
      return new Promise(resolve => { releaseCraftModels = () => resolve(models); });
    }
    if (path === '/api/tasks' && options.method === 'POST') return createMissing ? {} : { task: { id: 'task-craft' } };
    if (path === '/api/tasks/task-craft' && options.method === undefined) {
      if (failCraftHistory) throw new Error('history unavailable');
      return { task: { model_id: 'gateway-1' }, messages: [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
      ] };
    }
    if (path === '/api/tasks/task-craft/messages') return { assistant: {} };
    if (path === '/api/workbench/agent-sessions/models') return { models: [] };
    if (path.startsWith('/api/workbench/agent-sessions?task_id=')) return { links: [] };
    if (path.startsWith('/api/workbench/claude-runs?task_id=')) return { runs: [] };
    if (path === '/api/settings') return {};
    return {};
  };
  try {
    mountAgentWorkspace(root, { api: baseApi, taskId: '', defaultPermission: 'ask' });
    await settle();
    fields.provider.value = 'craft'; fields.provider.onchange(); await settle();
    fields.prompt.value = 'keep'; fields.prompt.selectionStart = 4; fields.prompt.oninput(); await settle();
    const beforeEmpty = calls.length;
    fields.prompt.value = ''; await buttons.send.onclick(); await settle();
    assert.equal(calls.length, beforeEmpty, 'an empty Craft prompt never reaches the gateway');
    fields.prompt.value = 'keep'; await buttons.send.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /请先选择项目文件夹/);
    fields.workspace.value = '/project'; fields['craft-model'].value = '';
    await buttons.send.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /请先选择 Craft 模型/);
    fields['craft-model'].value = 'gateway-1';
    await buttons.send.onclick(); await settle();
    assert.match(nodes['.agent-status'].textContent, /未获得任务身份/);
    assert.equal(fields.prompt.value, 'keep');
    assert.equal(buttons.send.disabled, true, 'an unknown task creation blocks a silent retry');

    createMissing = false; deferCraftModels = true;
    mountAgentWorkspace(root, { api: baseApi, taskId: 'task-craft', defaultPermission: 'ask', defaultProvider: 'craft' });
    await settle();
    releaseCraftModels!(); await settle();
    assert.equal(fields['craft-model'].value, 'gateway-1');
    fields.workspace.value = '/project'; fields.prompt.value = 'empty answer'; fields.prompt.selectionStart = 12; fields.prompt.oninput(); await settle();
    const flatten = (node: any): string => [String(node.textContent || ''), ...(node.children || []).map(flatten)].join('\n');
    assert.match(flatten(nodes['.agent-output']), /earlier question/);
    assert.match(flatten(nodes['.agent-output']), /earlier answer/);
    assert.match(nodes['.agent-status'].textContent, /已恢复 Craft 对话/);
    failCraftHistory = true; fields.provider.onchange(); await settle();
    assert.match(nodes['.agent-status'].textContent, /Craft 历史读取失败：history unavailable/);
    failCraftHistory = false;
    await buttons.send.onclick(); await settle();
    assert.match(nodes['.agent-output'].children.at(-1).children[0].textContent, /模型未返回文本/);
  } finally { (globalThis as any).document = priorDocument; (globalThis as any).Option = priorOption; }
});
