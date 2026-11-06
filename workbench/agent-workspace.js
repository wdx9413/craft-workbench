import { appendQueueRecovery } from './queue-recovery.js';
import { bindComposerKeys, fitComposer } from './composer-controls.js';
const BASE = '/api/workbench/agent-sessions';
const CLAUDE = '/api/workbench/claude-runs';
const OUTPUT_LIMIT = 512 * 1024;
const OUTPUT_TRUNCATED = '[较早的实时输出已省略，请查看原生历史]\n';
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
/** Keep the live view bounded and follow output only while the reader is near the bottom. */
export function appendNativeOutput(output, text) {
  if (!text) return;
  const follow = output.scrollHeight - output.scrollTop - output.clientHeight <= 32;
  let value = output.textContent + text;
  if (value.length > OUTPUT_LIMIT) {
    value = value.slice(-(OUTPUT_LIMIT - OUTPUT_TRUNCATED.length));
    if (value.charCodeAt(0) >= 0xdc00 && value.charCodeAt(0) <= 0xdfff) value = value.slice(1);
    value = OUTPUT_TRUNCATED + value;
  }
  output.textContent = value;
  if (follow) output.scrollTop = output.scrollHeight;
}
/**
 * The live transcript is DOM-based so user and assistant turns can be laid out
 * independently. Streaming text goes into the current bubble; one click on
 * history still exposes the raw CLI projection.
 */
export function createNativeTranscript(output) {
  const doc = output.ownerDocument || globalThis.document;
  let current = null, currentKind = '';
  function follow() {
    const box = output.closest?.('.project-agent .agent-output');
    const target = box || output;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight <= 48;
    if (nearBottom) target.scrollTop = target.scrollHeight;
  }
  function append(kind, text, create = false) {
    if (!text && !create) return;
    const bubbleKind = kind === 'assistant' || kind === 'user';
    if (kind === 'command') {
      const [title, detail = ''] = text;
      const group = doc.createElement('div');
      group.className = 'agent-turn agent-turn-command';
      const details = doc.createElement('details');
      details.className = 'agent-turn-details';
      const summary = doc.createElement('summary');
      const icon = doc.createElement('span');
      icon.className = 'agent-turn-caret'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '›';
      const label = doc.createElement('span');
      label.className = 'agent-turn-command-label'; label.textContent = title;
      summary.append(icon, label); details.append(summary);
      current = label; currentKind = 'command-label';
      if (detail) { const body = doc.createElement('pre'); body.className = 'agent-turn-command-output'; body.textContent = detail; details.append(body); }
      group.append(details); output.append(group);
      current = null; currentKind = ''; follow(); return;
    }
    if (!current || currentKind !== kind) {
      const turn = doc.createElement('div');
      turn.className = 'agent-turn agent-turn-' + kind;
      current = turn; currentKind = kind;
      if (bubbleKind) {
        const bubble = doc.createElement('div');
        bubble.className = 'agent-turn-bubble';
        output.append(turn);
        turn.append(bubble);
        current = bubble;
      } else {
        output.append(turn);
      }
    }
    current.textContent += text;
    follow();
  }
  return {
    user: text => append('user', String(text || '').trim()),
    assistant: text => append('assistant', text),
    beginAssistant: () => append('assistant', '', true),
    event: text => append('event', String(text || '').trim()),
    info: text => append('info', String(text || '').trim()),
    command: (title, detail = '') => append('command', [String(title || ''), String(detail || '')]),
    close() { current = null; currentKind = ''; },
    clear() { output.replaceChildren(); current = null; currentKind = ''; },
    get text() { return Array.from(output.querySelectorAll('.agent-turn')).map(node => (node.classList?.contains('agent-turn-user') || node.classList?.contains('agent-turn-assistant') ? node.children[0] : node).textContent).join('\n\n'); },
  };
}
/** Format provider tool events without storing a second transcript. */
export function codexToolEvent(event, streamed = false) {
  if (event.method !== 'item/started' && event.method !== 'item/completed') return '';
  const item = event.params?.item;
  if (item?.id === undefined) return '';
  const status = () => String(item.status || '未知');
  if (item?.type === 'commandExecution') {
    if (event.method === 'item/started') return { title: String(item.command || ''), detail: '' };
    const output = streamed || typeof item.aggregatedOutput !== 'string' || !item.aggregatedOutput ? '' : String(item.aggregatedOutput);
    return { title: '[命令结束：' + status() + (typeof item.exitCode === 'number' ? '，退出码 ' + item.exitCode : '') + ']', detail: output };
  }
  if (item?.type === 'fileChange') return { title: '[文件修改' + (event.method === 'item/started' ? '开始' : '：' + status()) + ']', detail: '' };
  return '';
}
export function claudeToolEvent(event) {
  const content = event.message?.content;
  if (!Array.isArray(content)) return '';
  if (event.type === 'assistant') return content.filter(block => block?.type === 'tool_use').map(block => ({ title: '[调用工具] ' + String(block.name || '未知'), detail: JSON.stringify(block.input ?? {}) }));
  if (event.type === 'user') return content.filter(block => block?.type === 'tool_result').map(block => ({ title: '[工具结果' + (block.is_error ? '：失败' : '') + ']', detail: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '') }));
  return '';
}
/** Readable projection of native history; unknown content remains visible as JSON. */
export function formatNativeHistory(result) {
  const show = value => typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
  const blocks = value => Array.isArray(value) ? value.map(block => block?.type === 'text' && typeof block.text === 'string' ? block.text : show(block)).join('\n') : show(value);
  return nativeHistoryMessages(result).map(({ role, text }) => '[' + role + ']\n' + text).join('\n\n') || '暂无原生历史。';
}
/** Preserve message roles so history can be laid out as a conversation. */
export function nativeHistoryMessages(result) {
  const show = value => typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
  const blocks = value => Array.isArray(value) ? value.map(block => block?.type === 'text' && typeof block.text === 'string' ? block.text : show(block)).join('\n') : show(value);
  let entries;
  if (result.provider === 'claude') {
    entries = (result.messages || []).map(row => ({ role: row.type === 'user' ? '用户' : row.type === 'assistant' ? 'Claude' : String(row.type || '记录'), text: blocks(row.message?.content ?? row.message) }));
  } else {
    entries = (result.thread?.turns || []).flatMap(turn => (turn.items || []).map(item => {
      if (item.type === 'userMessage') return { role: '用户', text: blocks(item.content) };
      if (item.type === 'agentMessage') return { role: 'Codex', text: show(item.text) };
      if (String(item.type || '').toLowerCase().includes('reasoning')) return null;
      if (item.type === 'commandExecution' && typeof item.command === 'string') {
        return { role: '命令', text: String(item.command), status: item.status, exitCode: item.exitCode, detail: item.aggregatedOutput };
      }
      return { role: '原生事件：' + String(item.type || '未知'), text: show(item) };
    }).filter(Boolean));
  }
  return entries;
}
/** Native output is held only in this view; the CLI owns its persistent history. */
export function mountAgentWorkspace(root, { api, taskId, clock = globalThis, invoke = null, workspace = '', selectedLink = '', defaultPermission = '', defaultProvider = '', onSessionsChanged = () => {}, onOpenNative = null, onOpenPage = () => {} }) {
  if (!root) return;
  root.innerHTML = '<div class="agent-head"><div class="agent-heading"><span class="agent-heading-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5h6l2 2h9v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="m9 13 2 2-2 2m4 0h3"/></svg></span><div><h2>工作会话</h2><p>选择项目与工具，用 Codex / Claude / DSH 或 Craft 一起工作。</p></div></div><span class="agent-badge">本地工作区</span></div>' +
    '<div class="agent-body"><div class="agent-providers" aria-label="命令行工具状态"><div class="agent-provider"><span data-provider="codex">Codex：检测中</span><a data-install="codex" href="https://developers.openai.com/codex/cli/" target="_blank" rel="noopener noreferrer">安装指南</a></div><div class="agent-provider"><span data-provider="claude">Claude：检测中</span><a data-install="claude" href="https://code.claude.com/docs/en/setup" target="_blank" rel="noopener noreferrer">安装指南</a></div></div><div class="agent-install-help" data-role="install-help" hidden></div><div class="agent-section agent-configuration"><div class="agent-section-title"><h3>开始工作</h3><span>选择项目与工具</span></div><div class="agent-setup"><label class="agent-workspace-field">项目文件夹<input data-field="workspace" placeholder="选择文件夹或输入完整路径"></label><button type="button" class="btn agent-native-folder" data-action="native-folder" aria-label="选择项目文件夹">选择目录</button>' +
    '<button class="btn primary" type="button" data-action="create">新建会话</button></div></div>' +
    '<div class="agent-section agent-session"><div class="agent-section-title"><h3>当前会话</h3><span>连接后查看输出和历史</span></div>' +
    '<div class="agent-bar"><label>当前会话<select data-field="session"><option value="">选择已关联会话</option></select></label><button class="btn" type="button" data-action="resume">连接</button></div><details class="agent-more"><summary>核对会话状态</summary><div class="agent-bar"><button class="btn" type="button" data-action="refresh-sessions">刷新会话</button><button class="btn" type="button" data-action="history">查看原生历史</button><button class="btn" type="button" data-action="reconcile">核对回合状态</button><button class="btn" type="button" data-action="unlink">解除关联</button></div>' +
    '<div class="agent-bar"><label>Claude 运行<select data-field="run"><option value="">选择进行中或未查看的运行</option></select></label><button class="btn" type="button" data-action="reopen">继续查看</button><button class="btn" type="button" data-action="refresh-runs">刷新运行</button><button class="btn" type="button" data-action="release-run">清除运行记录</button></div>' +
    '<details class="agent-history"><summary>原生历史</summary><pre aria-label="原生会话历史">连接后可读取 CLI 保存的历史。</pre><button class="btn" type="button" data-action="history-next" hidden>加载更多历史</button></details></details></div>' +
    '<div class="agent-console"><div class="agent-console-head"><h3>开始一段新工作</h3><p class="agent-status" role="status" aria-live="polite">正在准备…</p></div><div class="agent-approvals" aria-live="polite"></div>' +
    '<div class="agent-output" role="log" aria-label="会话消息"></div></div>' +
    '<div class="agent-compose">' +
    '<button class="btn agent-choose-project" type="button" data-action="choose-project" aria-label="选择项目" title="选择项目" hidden><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h4l1.3 1.5h5.7v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/></svg><span data-role="project-label">选择项目</span></button><div class="agent-queue" aria-live="polite"></div>' +
    '<div class="agent-mention-menu" data-role="mention-menu" role="listbox" aria-label="引用建议" hidden></div>' +
    '<div class="agent-command-panel" data-role="command-panel" role="menu" aria-label="会话命令" hidden></div>' +
    '<div class="agent-mode-chip" data-role="mode-chip" hidden>计划模式</div>' +
    '<details class="agent-native-picker agent-composer-native" hidden><summary class="agent-visually-hidden">接入已有会话</summary><p>选择当前工具的原生会话，逐个接入。</p><div class="agent-native-list" aria-live="polite"></div><button class="btn" type="button" data-action="native-more" hidden>加载更多</button></details>' +
    '<label>发送给当前会话<textarea data-field="prompt" rows="3" aria-description="回车发送，Shift+回车换行" placeholder="输入任务、文件、插件、技能或命令"></textarea></label>' +
    '<div class="agent-compose-actions"><button class="btn agent-plus" type="button" data-action="composer-plus" aria-label="更多" title="更多">＋</button><div class="agent-inline-field"><span>工具</span><select data-field="provider"><option value="">请选择</option><option value="craft">Craft</option><optgroup data-role="provider-installed" label="已安装工具" hidden></optgroup><optgroup data-role="provider-missing" label="未安装工具" hidden></optgroup><option value="__new__">新增</option></select><button class="btn" type="button" data-action="provider-install" hidden>安装</button><button class="btn" type="button" data-action="provider-configure" hidden>配置路径</button><button class="btn" type="button" data-action="provider-refresh" title="安装完成后重新检测本机工具">重新检测</button></div><label class="agent-inline-field" data-field="codex-model-group">模型<select data-field="model"><option value="">选择模型</option></select></label><label class="agent-inline-field" data-field="craft-model-group" hidden>Craft 模型<select data-field="craft-model"><option value="">选择模型</option></select></label><label class="agent-inline-field" data-field="claude-model-group" hidden>Claude 模型<select data-field="claude-model"><option value="">选择模型</option></select></label><label class="agent-inline-field" data-field="dsh-model-group" hidden>DSH 模型<select data-field="dsh-model"><option value="">选择模型</option></select></label><label class="agent-inline-field" data-field="dsh-reasoning-group" hidden>推理<select data-field="dsh-reasoning"><option value="">默认</option></select></label><label class="agent-inline-field">权限<select data-field="permission"><option value="ask">人工审批</option><option value="auto">自动审批</option><option value="full">完整权限</option></select></label><select data-field="work-mode" hidden><option value="default">执行</option><option value="plan">计划</option></select><button class="btn" type="button" data-action="reference-files" aria-label="引用文件或文件夹" title="引用文件或文件夹"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 8.5 10.3 4a2.1 2.1 0 0 1 3 3L7.4 13a3.3 3.3 0 0 1-4.7-4.7l5.9-5.9"/></svg></button><button class="btn primary" type="button" data-action="send-stop" data-state="send" aria-label="发送" title="发送"><svg data-role="send-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5v-9m-3.5 3.5L8 3.5l3.5 3.5"/></svg><svg data-role="stop-icon" viewBox="0 0 16 16" aria-hidden="true" hidden><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/></svg></button></div></div>' +
    '<p class="agent-note">Codex 默认审批模式允许在项目和 CLI 临时目录内写入；CLI 允许规则可能无需逐项审批。新建 Codex 会话后请尽快发送第一条消息：空会话在重启后可能无法恢复。解除关联或清除运行记录不会删除原生历史。Claude 首轮需填写消息。恢复连接不会自动重发结果未知的输入。</p></div>';
  const field = name => root.querySelector('[data-field="' + name + '"]');
  field('workspace').value = workspace;
  if (!selectedLink && ['ask', 'auto', 'full'].includes(defaultPermission)) field('permission').value = defaultPermission;
  if (!selectedLink && typeof defaultProvider === 'string' && /^[A-Za-z0-9_-]{0,32}$/u.test(defaultProvider)) field('provider').value = defaultProvider;
  const button = name => root.querySelector('[data-action="' + name + '"]');
  const providerSelect = field('provider');
  let providerCatalog = []; let chosenProvider = '';
  const status = root.querySelector('.agent-status');
  const conversationTitle = root.querySelector('.agent-console-head h3');
  if (conversationTitle) conversationTitle.textContent = selectedLink ? '对话' : '新对话';
  const output = root.querySelector('.agent-output');
  const transcript = createNativeTranscript(output);
  const queueBox = root.querySelector('.agent-queue');
  const approvals = root.querySelector('.agent-approvals');
  const history = root.querySelector('.agent-history pre');
  const mentionMenu = root.querySelector('[data-role="mention-menu"]');
  const commandPanel = root.querySelector('[data-role="command-panel"]');
  const modeChip = root.querySelector('[data-role="mode-chip"]');
  let mentionSerial = 0, mentionOpen = false, mentionTrigger = '', mentionQuery = '', mentionItems = [], mentionIndex = 0;
  const sendStop = button('send-stop');
  // Commands and skills are offered through the `/` and `@` suggestions above the
  // box; there is no separate list below it. Enter sends unless a suggestion list
  // or an IME composition is in the way.
  const promptComposing = bindComposerKeys(field('prompt'), sendStop, () => !mentionOpen && sendStop.dataset.state === 'send');
  const setPrompt = value => { field('prompt').value = value; fitComposer(field('prompt')); };
  const commandCache = new Map();
  function closeMention() {
    mentionOpen = false; mentionTrigger = ''; mentionQuery = ''; mentionItems = []; mentionIndex = 0;
    if (mentionMenu) { mentionMenu.hidden = true; mentionMenu.replaceChildren(); } ++mentionSerial;
  }
  function mentionToken(before) {
    const at = /(?:^|\s)@([^\s@]*)$/u.exec(before);
    if (at) return { trigger: '@', query: at[1], match: at[0] };
    const slash = /(?:^|\s)\/([^\s/]*)$/u.exec(before);
    return slash ? { trigger: '/', query: slash[1], match: slash[0] } : null;
  }
  function mentionStatus(text) {
    mentionItems = []; if (!mentionMenu) return; mentionMenu.replaceChildren();
    const row = document.createElement('div'); row.className = 'agent-mention-empty'; row.textContent = text; mentionMenu.append(row); mentionMenu.hidden = false;
  }
  function highlightMention(index) {
    if (!mentionMenu || !mentionItems.length) return;
    mentionIndex = (index + mentionItems.length) % mentionItems.length;
    for (const entry of mentionMenu.querySelectorAll('.agent-mention-item')) entry.setAttribute('aria-selected', Number(entry.dataset.index) === mentionIndex ? 'true' : 'false');
    mentionMenu.querySelector('.agent-mention-item[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  function renderMention(items) {
    mentionItems = items; mentionIndex = 0; if (!mentionMenu) return; mentionMenu.replaceChildren();
    if (!items.length) { mentionStatus('没有匹配的文件、插件、技能或命令。'); return; }
    let group = '';
    items.forEach((item, index) => {
      if (item.group !== group) { group = item.group; const label = document.createElement('div'); label.className = 'agent-mention-group'; label.textContent = group; mentionMenu.append(label); }
      const entry = document.createElement('button'); entry.type = 'button'; entry.className = 'agent-mention-item'; entry.dataset.index = String(index); entry.setAttribute('role', 'option');
      const title = document.createElement('strong'); title.textContent = item.label; const desc = document.createElement('span'); desc.textContent = item.description || ''; entry.append(title, desc);
      entry.onmousedown = event => event.preventDefault();
      entry.onclick = () => acceptMention(item);
      mentionMenu.append(entry);
    });
    mentionMenu.hidden = false; highlightMention(0);
  }
  function manualReferenceItem() {
    return {
      group: '手动', label: '手动选择文件或文件夹…', value: '', description: '打开系统文件或文件夹选择器',
      action: () => { removeActiveMention(); openReferenceMenu(); },
    };
  }
  function nullLikeSuggestion(value) {
    const normalized = value.trim().toLowerCase();
    return normalized === 'null' || normalized === 'undefined' || normalized === '$null' || normalized === '$undefined'
      || /(?:^|[\\/])(?:\$null|\$undefined)(?=$|[\\/])/u.test(normalized);
  }
  async function loadMention(trigger, query) {
    if (!mentionMenu) return;
    const serial = ++mentionSerial, selectedProvider = field('provider').value, workspace = field('workspace').value.trim();
    mentionOpen = true; mentionTrigger = trigger; mentionQuery = query; mentionStatus('正在读取…');
    let immediate = [];
    try {
      if (trigger === '/') {
        const needle = query.toLowerCase();
        const builtins = [
          { group: '内置', label: '/plan', value: '/plan', description: '切换计划/执行模式' },
          { group: '内置', label: '/goal', value: '/goal', description: '查看或设置当前目标' },
        ].filter(item => !needle || item.label.includes(needle) || item.description.includes(needle));
        immediate = builtins;
        if (builtins.length) renderMention(builtins);
        if (selectedProvider === 'codex' && !workspace) {
          renderMention([...builtins, { group: '提示', label: '请先选择项目文件夹', value: '', description: 'Codex 技能按项目读取' }]); return;
        }
        const commandProvider = selectedProvider === 'codex' ? 'codex' : selectedProvider === 'claude' ? 'claude' : '';
        if (!commandProvider) { renderMention(builtins); return; }
        const key = commandProvider + '\0' + workspace; let result = commandCache.get(key);
        if (!result) { result = await api(BASE + '/' + (commandProvider === 'codex' ? 'codex-skills' : 'claude-commands') + (workspace ? '?workspace=' + encodeURIComponent(workspace) : '')); commandCache.set(key, result); }
        if (!root.isConnected || serial !== mentionSerial) return;
        const items = [...builtins, ...(commandProvider === 'codex' ? result.skills || [] : result.commands || []).filter(item => !needle || item.name.toLowerCase().includes(needle) || String(item.description || '').toLowerCase().includes(needle)).slice(0, 40).map(item => ({
          group: commandProvider === 'codex' ? '技能' : '命令', label: (commandProvider === 'codex' ? '$' : '/') + item.name,
          value: (commandProvider === 'codex' ? '$' : '/') + item.name, description: item.description || (item.builtin ? '内置命令' : '技能'),
        }))];
        renderMention(items); return;
      }
      const items = [];
      immediate = items;
      if (workspace) {
        const files = await api(BASE + '/files?workspace=' + encodeURIComponent(workspace) + '&query=' + encodeURIComponent(query) + '&limit=100');
        if (!root.isConnected || serial !== mentionSerial) return;
        for (const file of files.files || []) {
          if (items.length >= 3) break;
          if (!file || typeof file.path !== 'string') continue;
          const path = file.path.trim();
          if (!path || nullLikeSuggestion(path)) continue;
          const name = typeof file.name === 'string' && file.name.trim() && !nullLikeSuggestion(file.name) ? file.name.trim() : '';
          items.push({ group: '文件', label: '@' + path, value: '@' + path, description: name === path ? '' : name });
        }
        if (items.length) renderMention([...items, manualReferenceItem()]);
      }
      if (selectedProvider === 'codex' && workspace) {
        const key = 'codex\0' + workspace; let result = commandCache.get(key);
        if (!result) { result = await api(BASE + '/codex-skills?workspace=' + encodeURIComponent(workspace)); commandCache.set(key, result); }
        if (!root.isConnected || serial !== mentionSerial) return;
        const needle = query.toLowerCase();
        for (const skill of (result.skills || []).filter(item => item.plugin && typeof item.name === 'string' && item.name.trim() && item.name.toLowerCase() !== 'null' && (!needle || item.name.toLowerCase().includes(needle) || String(item.plugin).toLowerCase().includes(needle))).slice(0, 20)) items.push({
          group: '插件', label: '$' + skill.name, value: '$' + skill.name, description: skill.plugin + (skill.description ? ' · ' + skill.description : ''),
        });
      }
      if (!workspace) items.unshift({ group: '提示', label: '请先选择项目文件夹', value: '', description: '文件与插件按项目读取' });
      renderMention([...items.slice(0, 59), manualReferenceItem()]);
    } catch (error) {
      if (!root.isConnected || serial !== mentionSerial) return;
      if (immediate.length) renderMention([...immediate, { group: '提示', label: '部分建议读取失败', value: '', description: error.message }]);
      else mentionStatus('读取失败：' + error.message);
    }
  }
  function removeActiveMention() {
    const prompt = field('prompt'), cursor = prompt.selectionStart ?? prompt.value.length, before = prompt.value.slice(0, cursor), token = mentionToken(before);
    if (!token) return;
    const tokenStart = cursor - token.match.length + (token.match.startsWith(' ') ? 1 : 0);
    prompt.value = prompt.value.slice(0, tokenStart) + prompt.value.slice(cursor);
    prompt.setSelectionRange(tokenStart, tokenStart);
    fitComposer(prompt);
  }
  function acceptMention(item) {
    if (!item) return;
    if (typeof item.action === 'function') { closeMention(); item.action(); return; }
    if (!item.value) return;
    const prompt = field('prompt'), cursor = prompt.selectionStart ?? prompt.value.length, before = prompt.value.slice(0, cursor), token = mentionToken(before);
    if (!token) { closeMention(); return; }
    const tokenStart = cursor - token.match.length + (token.match.startsWith(' ') ? 1 : 0), base = prompt.value.slice(0, tokenStart);
    const separator = base && !/\s$/u.test(base) ? ' ' : '';
    prompt.value = base + separator + item.value + ' ' + prompt.value.slice(cursor);
    const next = base.length + separator.length + item.value.length + 1;
    prompt.setSelectionRange(next, next); prompt.focus(); closeMention(); fitComposer(prompt);
  }
  function refreshMention() {
    const prompt = field('prompt'), before = prompt.value.slice(0, prompt.selectionStart ?? prompt.value.length), token = mentionToken(before);
    if (!token) { if (mentionOpen) closeMention(); return; }
    if (!mentionOpen || mentionTrigger !== token.trigger || mentionQuery !== token.query) void loadMention(token.trigger, token.query);
  }
  const basePromptKeydown = field('prompt').onkeydown;
  field('prompt').onkeydown = event => {
    if (mentionOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); highlightMention(mentionIndex + (event.key === 'ArrowDown' ? 1 : -1)); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); acceptMention(mentionItems[mentionIndex]); return; }
      if (event.key === 'Escape') { event.preventDefault(); closeMention(); return; }
    }
    const result = basePromptKeydown?.(event);
    if (result && typeof result.then === 'function') result.then(() => sendStop.dataset.state === 'stop' && lock(false), () => {});
    return result;
  };
  if (mentionMenu) mentionMenu.onmousedown = event => event.preventDefault();
  field('prompt').onclick = () => refreshMention();
  field('prompt').onfocus = () => { nativePicker.open = false; closeCommandPanel(); fitComposer(field('prompt')); };
  field('prompt').oninput = event => { nativePicker.open = false; closeCommandPanel(); fitComposer(field('prompt')); if (!busy) lock(false); if (promptComposing(event)) return; refreshMention(); };
  const nativePicker = root.querySelector('.agent-native-picker'), nativeList = root.querySelector('.agent-native-list');
  nativePicker.hidden = !!selectedLink || !onOpenNative;
  let nativeCursor = null, nativeSerial = 0;
  async function loadNative(append = false) {
    const serial = ++nativeSerial, selectedProvider = field('provider').value;
    if (!append) { nativeList.replaceChildren(); nativeList.textContent = '正在读取…'; nativeCursor = null; }
    button('native-more').hidden = true;
    if (!['codex', 'claude', 'dsh'].includes(selectedProvider)) {
      nativeList.textContent = selectedProvider ? '该工具没有可接入的原生会话。' : '请先选择工具。';
      return;
    }
    try {
      const nativeUrl = selectedProvider === 'dsh' ? '/api/workbench/dsh-native' : BASE + '/' + selectedProvider + '-native';
      const result = await api(nativeUrl + (append && nativeCursor ? '?cursor=' + encodeURIComponent(nativeCursor) : ''));
      if (!root.isConnected || serial !== nativeSerial || selectedProvider !== field('provider').value) return;
      if (!append) nativeList.replaceChildren();
      for (const thread of result.threads || []) {
        const item = document.createElement('button'); item.type = 'button'; item.className = 'agent-native-item';
        const title = document.createElement('strong'); title.textContent = thread.title || '未命名会话';
        const meta = document.createElement('span'); meta.textContent = thread.workspace + (thread.linked_id ? ' · 已接入' : '');
        item.append(title, meta);
        item.onclick = async () => { item.disabled = true; try { await onOpenNative(thread, selectedProvider, modelFieldFor(selectedProvider)?.value || '', field('permission').value); nativePicker.open = false; } catch (error) { if (root.isConnected) { item.disabled = false; message(error.message); } } };
        nativeList.append(item);
      }
      if (!nativeList.children.length) nativeList.textContent = '没有可显示的原生会话。';
      nativeCursor = result.next_cursor || null; button('native-more').hidden = !nativeCursor;
    } catch (error) { if (root.isConnected && serial === nativeSerial) nativeList.textContent = '读取历史会话失败：' + error.message; }
  }
  nativePicker.ontoggle = () => { if (nativePicker.open) void loadNative(); };
  function setWorkMode(mode) {
    const selectedProvider = field('provider').value;
    const applyMode = () => {
      field('work-mode').value = mode;
      if (modeChip) modeChip.hidden = mode !== 'plan';
      if (!busy) lock(false);
    };
    if (mode === 'plan') {
      if (selectedProvider === 'dsh') { message('DSH 不支持计划模式，请使用执行模式。'); return; }
      if (selectedProvider === 'codex' && !field('model').value) {
        applyMode();
        message('已选择计划模式；发送前请先选择 Codex 模型。');
        return;
      }
    }
    applyMode();
    message(mode === 'plan' ? '已选择计划模式。' : '已选择执行模式。');
  }
  // The `+` menu is a command panel, not a mention suggestion list. Keeping it
  // in its own node means `@`/`/` tokens and session commands never share state.
  function closeCommandPanel() {
    if (commandPanel) commandPanel.hidden = true;
    if (!commandPanel && mentionMenu) mentionMenu.hidden = true;
  }
  function renderCommandPanel(items) {
    nativePicker.open = false;
    closeMention();
    // Minimal DOM hosts (tests, embedded previews) may not provide the dedicated
    // command node; fall back to the mention surface so commands stay reachable.
    const panel = commandPanel || mentionMenu;
    if (!panel) return;
    const dedicated = panel === commandPanel;
    panel.replaceChildren();
    let group = '';
    for (const item of items) {
      if (item.group !== group) {
        group = item.group;
        const label = document.createElement('div');
        label.className = dedicated ? 'agent-command-group' : 'agent-mention-group';
        label.textContent = group;
        panel.append(label);
      }
      const entry = document.createElement('button');
      entry.type = 'button'; entry.className = dedicated ? 'agent-command-item' : 'agent-mention-item';
      entry.setAttribute('role', dedicated ? 'menuitem' : 'option');
      const title = document.createElement('strong'); title.textContent = item.label;
      const desc = document.createElement('span'); desc.textContent = item.description;
      entry.append(title, desc);
      entry.onclick = () => { closeCommandPanel(); item.run(); };
      panel.append(entry);
    }
    panel.hidden = false;
  }
  function openPlusMenu() {
    const mode = field('work-mode').value || 'default';
    const selectedProvider = field('provider').value;
    renderCommandPanel([
      { group: '模式', label: '执行模式', description: mode === 'default' ? '当前模式' : '切回执行模式',
        run: () => setWorkMode('default') },
      { group: '模式', label: '计划模式', description: mode === 'plan' ? '当前模式' : selectedProvider === 'dsh' ? 'DSH 不支持计划模式' : '先计划再执行',
        run: () => setWorkMode('plan') },
      { group: '会话', label: '新会话', description: '用当前工具与项目创建新会话',
        run: () => { if (!busy) void button('create').onclick(); } },
      { group: '会话', label: '接入已有会话', description: '从 Codex / Claude / DSH 原生会话接入',
        run: () => { nativePicker.hidden = false; nativePicker.open = true; nativePicker.ontoggle?.(); } },
      { group: '文件', label: '引用文件', description: '从电脑选择一个或多个文件',
        run: () => { void chooseReferenceFiles(); } },
      { group: '文件', label: '引用文件夹', description: '从电脑选择文件夹',
        run: () => { void chooseReferenceFolder(); } },
    ]);
  }
  button('composer-plus').onclick = () => {
    const activePanel = commandPanel || mentionMenu;
    if (activePanel && !activePanel.hidden && commandPanel) { closeCommandPanel(); return; }
    if (!busy) openPlusMenu();
  };
  button('native-more').onclick = () => { if (nativeCursor) void loadNative(true); };
  if (workspace) field('workspace').readOnly = true;
  button('native-folder').onclick = async () => {
    if (id || busy) return;
    try { if (!invoke) throw new Error('请使用桌面版选择文件夹'); const selected = await invoke('choose_project_folder'); if (selected) { field('workspace').value = selected; button('native-folder').textContent = selected.split(/[\\/]/).filter(Boolean).pop() || selected; message('已选择项目文件夹。'); if (!busy) lock(false); const selectedProvider = field('provider').value; if (selectedProvider === 'claude') void loadClaudeModels(); else if (selectedProvider === 'dsh') void loadDshModels(); } }
    catch (error) { message('无法选择文件夹：' + String(error)); }
  };
  let id = '', generation = null, cursor = 0, token = 0, busy = false, createUncertain = false, connected = false, provider = 'codex', runId = '', runActive = false, serverUnsettled = false, codexRunning = false, links = [];
  let projectPicking = false;
  const chooseProject = button('choose-project');
  const projectLabel = root.querySelector('[data-role="project-label"]');
  function updateProjectLabel() {
    const workspace = field('workspace').value.trim();
    const name = workspace.split(/[\\/]/).filter(Boolean).pop() || workspace;
    if (projectLabel) projectLabel.textContent = workspace ? '项目 · ' + name : '选择项目';
    chooseProject.title = workspace || '选择项目';
    chooseProject.setAttribute('aria-label', workspace ? '当前项目 ' + name + '，点击切换' : '选择项目');
  }
  function updateProjectControls() {
    const canChoose = !id && !selectedLink && !runActive;
    chooseProject.hidden = !canChoose;
    chooseProject.disabled = busy || projectPicking;
    updateProjectLabel();
  }
  async function chooseProjectFolder() {
    if (id || selectedLink || busy || runActive || projectPicking) return;
    projectPicking = true; updateProjectControls();
    try {
      // The desktop shell owns the real OS picker; the HTTP fallback keeps the
      // browser-hosted workbench usable.
      let path = null;
      if (typeof invoke === 'function') path = await invoke('choose_project_folder');
      if (!path) {
        const result = await post(BASE + '/pick-project-folder', { workspace: field('workspace').value.trim() || null });
        if (result.cancelled) return;
        path = result.path;
      }
      if (!root.isConnected || !path || id || selectedLink || runActive) return;
      if (typeof path !== 'string' || !path || /[\u0000-\u001f\u007f]/u.test(path)) throw new Error('文件夹路径无效');
      field('workspace').value = path;
      button('native-folder').textContent = path.split(/[\\/]/).filter(Boolean).pop() || path;
      message('已选择项目：' + path);
      const selectedProvider = field('provider').value;
      if (selectedProvider === 'claude') void loadClaudeModels();
      else if (selectedProvider === 'dsh') void loadDshModels();
    } catch (error) { if (root.isConnected) message('无法选择项目：' + String(error)); }
    finally { projectPicking = false; if (root.isConnected) { if (!busy) lock(false); else updateProjectControls(); } }
  }
  chooseProject.onclick = () => { void chooseProjectFolder(); };
  const uncertain = new Set();
  const queueUncertain = new Map();
  function markQueueUnknown(item) {
    if (!uncertain.has(id)) queueUncertain.set(id, new Map());
    queueUncertain.get(id)?.set(item.id, { ...item, state: 'unknown' });
    uncertain.add(id);
  }
  const approvalStates = new Map();
  const answerDrafts = new Map();
  let approvalSignature = '';
  const commandOutputSeen = new Set();
  const agentMessageSeen = new Set();
  const path = action => BASE + '/' + encodeURIComponent(id) + '/' + action;
  const post = (url, body) => api(url, { method: 'POST', body });
  async function chooseReferenceFiles() {
    const prompt = field('prompt');
    const picker = button('reference-files');
    if (picker.disabled) return;
    picker.disabled = true;
    try {
      let paths = null;
      if (typeof invoke === 'function') paths = await invoke('choose_reference_files');
      if (!paths) {
        const result = await post(BASE + '/pick-reference-files', { workspace: field('workspace').value.trim() || null });
        if (result.cancelled) return;
        paths = result.paths;
      }
      if (!root.isConnected || !paths) return;
      if (!Array.isArray(paths) || !paths.length || paths.length > 20
        || paths.some(path => typeof path !== 'string' || !path || /[\u0000-\u001f\u007f]/u.test(path))) throw new Error('文件路径无效或数量超过 20 个');
      prompt.value += (prompt.value ? '\n\n' : '') + '请参考以下本地文件：\n' + paths.map(path => '- ' + path).join('\n') + '\n';
      prompt.focus();
      message('已添加文件路径，工具会按当前权限读取。');
    } catch (error) { if (root.isConnected) message('无法引用文件：' + String(error)); }
    finally { if (root.isConnected) picker.disabled = false; }
  }
  async function chooseReferenceFolder() {
    const prompt = field('prompt');
    const picker = button('reference-files');
    if (picker.disabled) return;
    picker.disabled = true;
    try {
      const result = await post(BASE + '/pick-reference-folder', { workspace: field('workspace').value.trim() || null });
      if (!root.isConnected || result.cancelled) return;
      if (typeof result.path !== 'string' || !result.path || /[\u0000-\u001f\u007f]/u.test(result.path)) throw new Error('文件夹路径无效');
      prompt.value += (prompt.value ? '\n\n' : '') + '请参考以下本地文件夹：\n- ' + result.path + '\n';
      prompt.focus();
      message('已添加文件夹路径，工具会按当前权限读取。');
    } catch (error) { if (root.isConnected) message('无法引用文件夹：' + String(error)); }
    finally { if (root.isConnected) picker.disabled = false; }
  }
  function openReferenceMenu() {
    if (button('reference-files').disabled) return;
    renderCommandPanel([
      { group: '文件', label: '选择文件…', description: '从电脑选择一个或多个文件', run: () => { void chooseReferenceFiles(); } },
      { group: '文件夹', label: '选择文件夹…', description: '从电脑选择一个文件夹', run: () => { void chooseReferenceFolder(); } },
    ]);
  }
  button('reference-files').onclick = openReferenceMenu;
  let editingQueue = null, queueSignature = '';
  function holdQueueRow(row, itemId) {
    if (editingQueue && editingQueue !== itemId) { message('请先完成当前消息的核对或编辑。'); return false; }
    editingQueue = itemId;
    for (const other of queueBox.children) if (other !== row) for (const action of other.querySelectorAll('button')) action.disabled = true;
    return true;
  }
  async function refreshQueue() {
    if (!queueBox || !id || !taskId) return [];
    const ticket = token, queueTask = taskId, queueLink = id;
    const result = await api(path('queue') + '?task_id=' + encodeURIComponent(taskId));
    if (!active(ticket) || queueTask !== taskId || queueLink !== id) return [];
    const items = [...(result.items || [])];
    for (const item of queueUncertain.get(id)?.values() || []) if (!items.some(row => row.id === item.id)) items.push(item);
    if (editingQueue) return items;
    const signature = JSON.stringify([queueTask, queueLink, ticket, provider, codexRunning, items.map(item => [item.id, item.version, item.state, item.prompt, item.work_mode])]);
    if (signature === queueSignature) return items;
    queueSignature = signature; queueBox.replaceChildren();
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'agent-queued-item';
      const content = document.createElement('span'); content.textContent = (item.state === 'queued' ? '排队中' + (item.work_mode === 'plan' ? '（计划）' : '') + '：' : '待核对：') + item.prompt; row.append(content);
      if (item.state === 'queued') { const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn'; edit.textContent = '编辑'; edit.onclick = () => { if (editingQueue || !holdQueueRow(row, item.id)) return; const input = document.createElement('textarea'); input.value = item.prompt; input.setAttribute('aria-label', '编辑排队消息'); row.replaceChildren(input); const save = document.createElement('button'); save.type = 'button'; save.className = 'btn'; save.textContent = '保存'; save.onclick = async () => { save.disabled = true; try { await api(path('queue'), { method: 'PATCH', body: { task_id: taskId, item_id: item.id, prompt: input.value } }); editingQueue = null; queueSignature = ''; await refreshQueue(); } catch (error) { save.disabled = false; message('保存失败：' + error.message); } }; const close = document.createElement('button'); close.type = 'button'; close.className = 'btn'; close.textContent = '取消'; close.onclick = () => { editingQueue = null; queueSignature = ''; void refreshQueue(); }; row.append(save, close); input.focus(); }; row.append(edit); }
      if (item.state === 'queued' && provider === 'codex' && codexRunning && item.work_mode !== 'plan') { const steer = document.createElement('button'); steer.type = 'button'; steer.className = 'btn'; steer.textContent = '立即指导'; steer.title = '立即指导沿用当前回合的模式'; steer.onclick = async () => { if (busy || editingQueue) return; steer.disabled = true; lock(true); try { const result = await post(path('queue-steer'), { task_id: taskId, item_id: item.id }); transcript.user('立即指导：' + result.prompt); await refreshQueue(); message('已提交指导，沿用当前回合模式。'); } catch (error) { markQueueUnknown(item); message('指导结果未确认，请核对会话：' + error.message); await refreshQueue().catch(() => {}); } finally { lock(false); } }; row.append(steer); }
      if (item.state === 'queued') { const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = '撤回'; cancel.onclick = async () => { if (editingQueue) return; try { await api(path('queue') + '?' + new URLSearchParams({ task_id: taskId, item_id: item.id }), { method: 'DELETE' }); await refreshQueue(); } catch (error) { message('撤回失败：' + error.message); } }; row.append(cancel); }
      if (item.state === 'unknown' || item.state === 'dispatching') appendQueueRecovery(row, {
        resolve: action => post(BASE + '/' + encodeURIComponent(queueLink) + '/queue-reconcile', { task_id: queueTask, item_id: item.id, expected_version: item.version, action }),
        isCurrent: () => active(ticket) && id === queueLink && taskId === queueTask,
        hold: () => holdQueueRow(row, item.id),
        release: () => { editingQueue = null; queueSignature = ''; void refreshQueue().catch(error => message('刷新队列失败：' + error.message)); field('prompt').focus(); },
        onResolved: async result => {
          editingQueue = null; queueSignature = '';
          const guarded = queueUncertain.get(queueLink);
          guarded?.delete(item.id);
          if (guarded && !guarded.size) { queueUncertain.delete(queueLink); if (result.session_state === 'idle') uncertain.delete(queueLink); }
          if (result.session_state === 'idle') serverUnsettled = false;
          lock(false);
          message(result.outcome === 'accepted' ? '已核对到原生接收回执。' : result.outcome === 'dispatched' ? '已核对到本地派发回执，请继续核对原生回合。' : '已移出待核对消息，未重新发送。');
          await refreshQueue(); if (active(ticket) && id === queueLink) field('prompt').focus();
        },
      });
      queueBox.append(row);
    }
    return items;
  }
  const active = ticket => root.isConnected && ticket === token;
  let queueDispatching = false;
  async function dispatchQueue(ticket) {
    if (!queueBox || queueDispatching || busy || !id || !connected || uncertain.has(id)) return;
    queueDispatching = true;
    let pendingItem = null;
    try {
      const items = await refreshQueue();
      if (!active(ticket) || editingQueue || !items.length || items[0].state !== 'queued') return;
      pendingItem = items[0];
      const result = await post(path('queue-dispatch'), { task_id: taskId });
      if (!active(ticket) || result.empty) return;
      transcript.user(result.prompt);
      await refreshQueue();
      if (result.provider === 'claude') { runId = result.run_id; runActive = true; serverUnsettled = true; cursor = 0; const next = ++token; lock(false); void pollClaude(next); }
      else if (result.provider === 'dsh') { runId = result.run_id; runActive = true; serverUnsettled = true; cursor = 0; const next = ++token; lock(false); void pollDsh(next); }
    } catch (error) { if (active(ticket)) { if (pendingItem) markQueueUnknown(pendingItem); lock(false); message('队列已暂停，请核对会话：' + error.message); await refreshQueue().catch(() => {}); } }
    finally { queueDispatching = false; }
  }
  let modelSerial = 0, modelsLoading = false;
  async function loadClaudeModels() {
    const serial = ++modelSerial, select = field('claude-model'), previous = select.value, workspace = field('workspace').value.trim();
    select.replaceChildren(new Option('正在读取模型…', '')); select.disabled = true; modelsLoading = true; if (!busy) lock(false);
    try {
      const result = await api(BASE + '/claude-models' + (workspace ? '?workspace=' + encodeURIComponent(workspace) : ''));
      if (!root.isConnected || serial !== modelSerial) return;
      select.replaceChildren(new Option('选择模型', ''));
      for (const model of result.models || []) {
        if (model.is_default) continue;
        const name = model.name === model.id ? model.name : model.name + ' · ' + model.id;
        select.add(new Option(name, model.id));
      }
      if (previous) { if (select.options && !Array.from(select.options).some(option => option.value === previous)) select.add(new Option(previous, previous)); select.value = previous; }
      if (result.truncated) message('Claude Code 模型列表已截断。');
    } catch (error) { if (root.isConnected && serial === modelSerial) { select.replaceChildren(new Option('选择模型', '')); message('Claude Code 模型读取失败，请检查 CLI 后重新选择工具：' + error.message); } }
    finally { if (root.isConnected && serial === modelSerial) { modelsLoading = false; if (!id && !runActive && !busy) select.disabled = false; if (!busy) lock(false); } }
  }
  async function loadDshModels() {
    const serial = ++modelSerial, select = field('dsh-model'), reasoning = field('dsh-reasoning');
    const previous = select.value, previousReasoning = reasoning.value, workspace = field('workspace').value.trim();
    if (!workspace) { select.replaceChildren(new Option('请先选择项目文件夹', '')); reasoning.replaceChildren(new Option('默认', '')); return; }
    select.replaceChildren(new Option('正在读取模型…', '')); select.disabled = true; modelsLoading = true; if (!busy) lock(false);
    try {
      const result = await api('/api/workbench/dsh-models?workspace=' + encodeURIComponent(workspace));
      if (!root.isConnected || serial !== modelSerial) return;
      select.replaceChildren(new Option('选择模型', ''));
      for (const model of result.models || []) select.add(new Option((model.group ? model.group + ' · ' : '') + model.name, model.id));
      reasoning.replaceChildren(new Option('默认', ''));
      for (const item of result.reasoning_efforts || []) reasoning.add(new Option(item.name, item.id));
      if (previous) { if (!Array.from(select.options).some(option => option.value === previous)) select.add(new Option(previous, previous)); select.value = previous; }
      if (previousReasoning && Array.from(reasoning.options).some(option => option.value === previousReasoning)) reasoning.value = previousReasoning;
      if (!result.models?.length) message('DSH 未返回可用模型，请检查 DSH 模型配置。');
    } catch (error) {
      if (root.isConnected && serial === modelSerial) {
        select.replaceChildren(new Option('读取失败', '')); reasoning.replaceChildren(new Option('默认', ''));
        message('DSH 模型读取失败：' + error.message);
      }
    } finally {
      if (root.isConnected && serial === modelSerial) { modelsLoading = false; if (!busy) select.disabled = false; lock(busy); }
    }
  }
  let craftModelsLoaded = false, craftModelsLoading = false;
  /**
   * Craft runs its own loop through the configured model gateway (`settings.models`),
   * not through the Codex model catalog. The select therefore lists gateway models.
   */
  async function loadCraftModels() {
    const select = field('craft-model');
    if (!select || craftModelsLoaded) return;
    let previous = select.value;
    craftModelsLoading = true; select.disabled = true;
    select.replaceChildren(new Option('正在读取…', ''));
    try {
      const result = await api('/api/config/models');
      craftModelsLoaded = true;
      if (select.value) previous = select.value;
      select.replaceChildren(new Option('选择模型', ''));
      for (const model of result.models || []) select.add(new Option((model.name || model.id) + (model.configured ? '' : '（未配置密钥）'), model.id));
      if (previous) {
        if (!Array.from(select.options).some(option => option.value === previous)) select.add(new Option(previous, previous));
        select.value = previous;
      }
      if (!select.value) {
        const usable = (result.models || []).filter(model => model.configured);
        if (usable.length) select.value = usable[0].id;
        else message('还没有可用模型：先到「模型」页配置一个模型的 API Key。');
      }
    } catch (error) {
      select.replaceChildren(new Option('读取失败', ''));
      message('Craft 模型读取失败：' + error.message);
    }
    finally { craftModelsLoading = false; if (root.isConnected) lock(busy); }
  }
  function showProviderModel(load = true) {
    const selected = field('provider').value, isClaude = selected === 'claude', isDsh = selected === 'dsh', isCraft = selected === 'craft';
    field('codex-model-group').hidden = isClaude || isDsh || isCraft;
    field('claude-model-group').hidden = !isClaude;
    const dshModelGroup = field('dsh-model-group'), dshReasoningGroup = field('dsh-reasoning-group');
    if (dshModelGroup) dshModelGroup.hidden = !isDsh;
    if (dshReasoningGroup) dshReasoningGroup.hidden = !isDsh;
    const craftModelGroup = field('craft-model-group');
    if (craftModelGroup) craftModelGroup.hidden = !isCraft;
    if (isClaude && load && !id) void loadClaudeModels();
    if (isDsh && load && !id) void loadDshModels();
    if (isCraft) void loadCraftModels();
  }
  function providerOption(provider) {
    const option = document.createElement('option');
    option.value = String(provider.id || ''); option.textContent = String(provider.name || provider.id || '工具');
    if (provider.version) option.title = '已安装：' + provider.version; return option;
  }
  function refreshProviderOptions() {
    if (!providerSelect) return;
    const installed = providerSelect.querySelector('[data-role="provider-installed"]');
    const missing = providerSelect.querySelector('[data-role="provider-missing"]');
    if (!installed || !missing) return;
    installed.replaceChildren(); missing.replaceChildren();
    for (const provider of providerCatalog) {
      const group = provider.status === 'available' || provider.status === 'plugin' ? installed : missing;
      group.append(providerOption(provider));
    }
    installed.hidden = !installed.children.length; missing.hidden = !missing.children.length;
    const previous = chosenProvider; chosenProvider = providerSelect.value;
    if (previous && previous !== '__new__' && [...providerSelect.options].some(option => String(option.value) === previous)) providerSelect.value = previous;
  }
  // A tool whose status is `error` (resolved but not runnable) still needs a way
  // out, so 安装 and 配置路径 stay reachable for both not_found and error.
  function syncProviderControls() {
    const selected = providerCatalog.find(provider => String(provider.id || '') === String(providerSelect.value || ''));
    const stuck = !!selected && (selected.status === 'not_found' || selected.status === 'error');
    const install = button('provider-install');
    if (install) { install.hidden = !stuck || !selected.install_url; if (stuck && selected.install_url) install.dataset.url = String(selected.install_url); }
    const configure = button('provider-configure');
    if (configure) configure.hidden = !stuck;
  }
  const installHelp = root.querySelector('[data-role="install-help"]');
  const INSTALL_GUIDES = {
    codex: { label: 'Codex CLI', repo: 'https://github.com/openai/codex', command: 'npm install -g --allow-scripts=@openai/codex @openai/codex' },
    claude: { label: 'Claude Code', repo: 'https://github.com/anthropics/claude-code', command: 'npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code' },
    dsh: { label: 'DSH', repo: 'https://github.com/deepseek-ai/deepseek-harness', command: 'npm install -g --allow-scripts=@deepseek-ai/dsh,@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs @deepseek-ai/dsh' },
  };
  function copyValue(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(() => message('已复制：' + value)).catch(() => message(value));
    }
    message(value);
    return Promise.resolve();
  }
  function openInstallGuide(url) {
    // The embedded webview does not use the machine's proxy settings, so an
    // unreachable docs host renders as a blank window. Prefer the system browser.
    if (typeof invoke === 'function') {
      return Promise.resolve(invoke('open_external_url', { url }))
        .catch(() => invoke('open_embedded_page', { url }))
        .catch(error => message('无法打开安装页：' + String(error) + '。地址：' + url));
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) message('浏览器拦截了安装页，请手动打开：' + url);
    return Promise.resolve();
  }
  function showInstallHelp(providerId, url) {
    if (!installHelp) return;
    const guide = INSTALL_GUIDES[providerId] || { label: providerId || '工具', repo: null, command: null };
    installHelp.hidden = false;
    installHelp.innerHTML =
      '<div class="agent-install-head"><strong>' + escapeHtml(guide.label) + ' 安装</strong><button class="btn sm" type="button" data-install-close>收起</button></div>' +
      '<div class="agent-install-row"><span>官方页面</span><code>' + escapeHtml(url) + '</code><button class="btn sm" type="button" data-install-open="' + escapeHtml(url) + '">用浏览器打开</button><button class="btn sm" type="button" data-install-copy="' + escapeHtml(url) + '">复制地址</button></div>' +
      (guide.repo ? '<div class="agent-install-row"><span>备用地址</span><code>' + escapeHtml(guide.repo) + '</code><button class="btn sm" type="button" data-install-open="' + escapeHtml(guide.repo) + '">打开</button><button class="btn sm" type="button" data-install-copy="' + escapeHtml(guide.repo) + '">复制</button></div>' : '') +
      (guide.command ? '<div class="agent-install-row"><span>安装命令</span><code>' + escapeHtml(guide.command) + '</code><button class="btn sm" type="button" data-install-copy="' + escapeHtml(guide.command) + '">复制命令</button></div>' : '') +
      '<p class="agent-install-note">装好后点「重新检测」。若页面打不开，可先复制安装命令在本机终端执行。</p>' +
      '<div class="agent-install-actions">' +
        (typeof invoke === 'function' ? '<button class="btn primary" type="button" data-install-run>执行安装</button>' : '') +
        '<button class="btn sm" type="button" data-install-refresh>重新检测</button></div>' +
      '<pre class="agent-install-output" data-install-output hidden></pre>';
    const close = installHelp.querySelector('[data-install-close]');
    if (close) close.onclick = () => { installHelp.hidden = true; };
    installHelp.querySelectorAll('[data-install-open]').forEach(node => { node.onclick = () => { void openInstallGuide(node.getAttribute('data-install-open')); }; });
    installHelp.querySelectorAll('[data-install-copy]').forEach(node => { node.onclick = () => { void copyValue(node.getAttribute('data-install-copy')); }; });
    const refresh = installHelp.querySelector('[data-install-refresh]');
    if (refresh) refresh.onclick = () => { message('正在重新检测本机工具…'); void loadProviders().then(() => { if (root.isConnected) message('检测完成；已安装的工具会出现在「已安装工具」里。'); }); };
    const run = installHelp.querySelector('[data-install-run]');
    if (run) run.onclick = () => {
      run.disabled = true;
      const output = installHelp.querySelector('[data-install-output]');
      if (output) { output.hidden = false; output.textContent = '正在执行 ' + (guide.command || '安装命令') + ' …'; }
      message('正在安装 ' + guide.label + '，可能需要几分钟…');
      Promise.resolve(invoke('install_cli', { provider: providerId }))
        .then(result => {
          if (output) output.textContent = (result.command ? '$ ' + result.command + '\n' : '') + (result.output || '(无输出)');
          message(result.ok ? guide.label + ' 安装完成，正在重新检测…' : guide.label + ' 安装失败（退出码 ' + result.code + '）');
          return loadProviders();
        })
        .then(() => { if (root.isConnected) message('检测完成；若仍未找到，请检查 npm 全局目录是否在 PATH 中。'); })
        .catch(error => message('安装失败：' + String(error)))
        .finally(() => { run.disabled = false; });
    };
  }
  function applyProviderChoice() {
    const value = String(providerSelect.value || '');
    if (value === '__new__') { if (root.isConnected) onOpenPage('plugins'); providerSelect.value = ''; return; }
    syncProviderControls();
    persistProvider();
    showProviderModel(); field('permission').onchange(); if (nativePicker.open && !nativePicker.hidden) void loadNative(); if (!busy) lock(false);
    if (value === 'craft' && taskId && !id) void loadCraftTask();
  }
  field('provider').onchange = applyProviderChoice;
  const providerInstall = button('provider-install');
  if (providerInstall) providerInstall.onclick = () => {
    const url = providerInstall.dataset.url;
    const providerId = String(providerSelect.value || '');
    if (!url) { message('该工具没有安装指引，请到「插件」页查看可安装项。'); return; }
    showInstallHelp(providerId, url);
    message('已显示安装指引；装好后点「重新检测」。');
    void openInstallGuide(url);
  };
  const providerConfigure = button('provider-configure');
  if (providerConfigure) providerConfigure.onclick = () => onOpenPage('settings');
  showProviderModel(false);
  function message(text) { status.textContent = text; }
  function freezeConfiguration() { field('provider').disabled = true; button('native-folder').disabled = true; }
  let savedModel = '', savedPermission = 'ask';
  async function saveConfiguration() {
    if (!id || !connected || busy || runActive || serverUnsettled) return;
    const select = modelFieldFor(provider), model = select?.value || '', permission = field('permission').value;
    if (!select) return;
    if (!model) { select.value = savedModel; message('请选择模型。'); return; }
    const ticket = token; lock(true);
    try { const result = await post(path('configuration'), { task_id: taskId, model, permission }); if (!active(ticket)) return; savedModel = result.link.model; savedPermission = result.link.permission; const link = links.find(item => item.id === id); if (link) Object.assign(link, result.link); message('配置已保存，将从下一回合生效。'); void onSessionsChanged(); }
    catch (error) { if (active(ticket)) { select.value = savedModel; field('permission').value = savedPermission; message('配置未更改：' + error.message); } }
    finally { if (active(ticket)) lock(false); }
  }
  field('model').onchange = () => { if (!id && !busy) lock(false); void saveConfiguration(); };
  field('claude-model').onchange = () => { if (!id && !busy) lock(false); void saveConfiguration(); };
  const dshModelField = field('dsh-model');
  if (dshModelField) dshModelField.onchange = () => { if (!id && !busy) lock(false); void saveConfiguration(); };
  const craftModelField = field('craft-model');
  if (craftModelField) craftModelField.onchange = () => { if (!id && !busy) lock(false); void saveConfiguration(); };
  function permissionMessage(selected, mode) {
    if (mode === 'full') return selected === 'codex' ? '完整权限：Codex CLI 不使用沙箱，也不会请求审批。'
      : selected === 'claude' ? '完整权限：Claude Code 跳过权限审批；沙箱仍取决于 Claude 自身配置。'
        : selected === 'dsh' ? '完整权限：DSH 自动接受权限请求；仍受 DSH 自身能力边界限制。'
          : selected === 'craft' ? 'Craft 对话不会执行文件或命令；权限模式只记录给后续工具回合。'
            : '完整权限：由当前工具适配器解释。';
    if (mode === 'auto') return selected === 'codex' ? '自动审批：Codex CLI 使用原生自动审查决定批准或拒绝。'
      : selected === 'claude' ? '自动审批：Claude Code 使用自身分类器，无法判断时仍可能请求人工审批。'
        : selected === 'dsh' ? '自动审批：DSH 自动接受权限请求。'
          : selected === 'craft' ? 'Craft 对话不会执行文件或命令；权限模式只记录给后续工具回合。'
            : '自动审批：由当前工具适配器解释。';
    return selected === 'dsh' ? '人工审批：DSH 在需要权限时暂停并等待你批准。' : '人工审批：按 CLI 权限规则在需要时请求确认。';
  }
  field('permission').onchange = () => { if (id) { void saveConfiguration(); return; } message(permissionMessage(field('provider').value, field('permission').value)); if (!busy) lock(false); };
  if (typeof invoke === 'function') for (const [provider, url] of [['codex', 'https://developers.openai.com/codex/cli/'], ['claude', 'https://code.claude.com/docs/en/setup']]) {
    const link = root.querySelector('[data-install="' + provider + '"]');
    if (link) link.onclick = event => { event.preventDefault(); void openInstallGuide(url); };
  }
  function lock(value) {
    busy = value;
    const waitingModels = (['claude', 'dsh'].includes(field('provider').value) && modelsLoading)
      || (field('provider').value === 'craft' && craftModelsLoading);
    const currentLink = id ? links.find(item => item.id === id) : null;
    const turnState = currentLink && currentLink.turn_state !== undefined ? String(currentLink.turn_state) : 'idle';
    const configDisabled = value || runActive || serverUnsettled || !!id && (turnState !== 'idle' || uncertain.has(id));
    const selectedProvider = field('provider').value;
    const selectedModel = modelFieldFor(selectedProvider)?.value || '';
    const configurationReady = !!selectedProvider && !!selectedModel && !!field('permission').value;
    field('permission').disabled = configDisabled;
    field('model').disabled = configDisabled;
    field('claude-model').disabled = configDisabled || modelsLoading;
    const craftModel = field('craft-model');
    if (craftModel) craftModel.disabled = configDisabled || craftModelsLoading;
    const dshModel = field('dsh-model'), dshReasoning = field('dsh-reasoning');
    if (dshModel) dshModel.disabled = configDisabled || modelsLoading;
    if (dshReasoning) dshReasoning.disabled = configDisabled || modelsLoading;
    button('create').disabled = value || createUncertain || runActive || waitingModels;
    button('resume').disabled = value || runActive;
    button('reopen').disabled = value || runActive;
    button('release-run').disabled = value || runActive;
    button('refresh-runs').disabled = value;
    button('refresh-sessions').disabled = value;
    updateProjectControls();
    const activeRun = (provider === 'claude' || provider === 'dsh') ? runActive : !!(id && connected && codexRunning);
    const showStop = activeRun && !field('prompt').value.trim();
    sendStop.dataset.state = showStop ? 'stop' : 'send';
    sendStop.querySelector('[data-role="send-icon"]').hidden = showStop;
    sendStop.querySelector('[data-role="stop-icon"]').hidden = !showStop;
    sendStop.setAttribute('aria-label', showStop ? '停止' : '发送');
    sendStop.title = showStop ? '停止' : '发送';
    sendStop.disabled = showStop
      ? value || !id || !connected
      : value || waitingModels || createUncertain || !configurationReady || (id
        ? !connected || uncertain.has(id)
        : !!selectedLink || runActive || !field('workspace').value.trim());
    button('history').disabled = value || !id || !connected;
    button('reconcile').disabled = value || provider !== 'codex' || !id || !connected || !serverUnsettled;
    button('unlink').disabled = value || runActive || serverUnsettled || !id || uncertain.has(id);
  }
  function showApprovals(items, isClaude = false) {
    const ticket = token;
    const endpoint = isClaude ? CLAUDE + '/' + encodeURIComponent(runId) + '/approval' : path('approval');
    const current = new Set((items || []).map(item => JSON.stringify([ticket, endpoint, item.id])));
    for (const [key, state] of approvalStates) if (state !== 'pending' && !current.has(key)) approvalStates.delete(key);
    for (const key of answerDrafts.keys()) if (!current.has(key)) answerDrafts.delete(key);
    const signature = JSON.stringify([ticket, endpoint, items || [], [...approvalStates]]);
    if (signature === approvalSignature && approvals.children.length === (items || []).length) return;
    approvalSignature = signature;
    approvals.replaceChildren();
    for (const item of items || []) {
      const key = JSON.stringify([ticket, endpoint, item.id]);
      const box = document.createElement('div'); box.className = 'agent-approval';
      const codexQuestion = !isClaude && item.method === 'item/tool/requestUserInput';
      const isQuestion = codexQuestion || isClaude && item.tool === 'AskUserQuestion';
      const title = document.createElement('strong'); title.textContent = isQuestion ? (isClaude ? 'Claude' : 'Codex') + ' 需要你的回答' : isClaude ? String(item.context?.title || (item.tool + ' 需要审批')) : item.method === 'item/fileChange/requestApproval' ? '文件修改需要审批' : '命令需要审批'; box.append(title);
      if (!isQuestion) { const details = document.createElement('pre'); details.textContent = JSON.stringify(isClaude ? { input: item.input, context: item.context } : item.params, null, 2); box.append(details); }
      const questionInputs = [];
      if (isQuestion) {
        for (const question of (isClaude ? item.input.questions : item.params.questions) || []) {
          const label = document.createElement('label'); label.textContent = String(question.question);
          const answer = document.createElement('input'); answer.type = question.isSecret ? 'password' : 'text'; answer.placeholder = question.multiSelect ? '输入选择，多项用逗号分隔；也可输入其他答案' : '输入答案，或选择下方选项';
          const answerKey = isClaude ? question.question : question.id;
          const draft = answerDrafts.get(key) || Object.create(null); answerDrafts.set(key, draft); answer.value = draft[answerKey] || '';
          answer.oninput = () => { draft[answerKey] = answer.value; answerDrafts.set(key, draft); };
          label.append(answer); box.append(label); questionInputs.push([answerKey, answer]);
          for (const option of question.options || []) { const choice = document.createElement('button'); choice.type = 'button'; choice.className = 'btn'; choice.textContent = String(option.label || ''); choice.title = String(option.description || ''); choice.onclick = () => { const value = String(option.label || ''); if (question.multiSelect) { const selected = answer.value.split(',').map(part => part.trim()).filter(Boolean); answer.value = (selected.includes(value) ? selected.filter(part => part !== value) : [...selected, value]).join(', '); } else answer.value = value; answer.oninput(); }; box.append(choice); }
        }
      }
      if (approvalStates.has(key)) { const notice = document.createElement('span'); notice.textContent = approvalStates.get(key) === 'unknown' ? '审批结果未确认，请核对原生会话。' : '审批已提交，等待状态更新。'; box.append(notice); }
      for (const [decision, label] of (codexQuestion ? [['accept', '提交回答']] : [['accept', isQuestion ? '提交回答' : '批准'], ['decline', isQuestion ? '取消' : '拒绝']])) {
        const control = document.createElement('button'); control.className = 'btn'; control.type = 'button'; control.textContent = label; control.disabled = approvalStates.has(key);
        control.onclick = async () => {
          if (!active(ticket) || approvalStates.has(key)) return;
          const answers = isQuestion && decision === 'accept' ? Object.fromEntries(questionInputs.map(([question, input]) => [question, codexQuestion ? [input.value] : input.value])) : undefined;
          if (questionInputs.some(([, input]) => !input.value.trim()) && answers) { message('请回答每个问题。'); return; }
          approvalStates.set(key, 'pending');
          for (const b of box.querySelectorAll('button')) b.disabled = true;
          try { await post(codexQuestion ? path('answer') : endpoint, { task_id: taskId, request_id: item.id, ...(codexQuestion ? {} : { decision }), ...(answers ? { answers } : {}) }); approvalStates.set(key, 'resolved'); if (active(ticket)) box.remove(); }
          catch (error) { approvalStates.set(key, 'unknown'); if (active(ticket)) message('审批未确认，请核对原生会话：' + error.message); }
        };
        box.append(control);
      }
      approvals.append(box);
    }
  }
  async function poll(ticket) {
    if (!active(ticket) || !id) return;
    try {
      const query = new URLSearchParams({ task_id: taskId, after: String(cursor) });
      if (generation !== null) query.set('generation', generation);
      const result = await api(path('events') + '?' + query);
      if (!active(ticket)) return;
      generation = result.generation; cursor = result.last_sequence;
      if (result.truncated) transcript.info('部分实时输出已丢失，请在原生 CLI 中查看历史。');
      for (const row of result.events || []) {
        const event = row.event || {}, params = event.params || {};
        if (typeof params.delta === 'string') {
          if (String(event.method).toLowerCase().includes('reasoning')) continue;
          if (event.method === 'item/commandExecution/outputDelta' && typeof params.itemId === 'string') commandOutputSeen.add(params.itemId);
          if (event.method === 'item/agentMessage/delta') {
            const itemId = String(params.itemId || params.item?.id || 'agent-message');
            if (!agentMessageSeen.has(itemId)) { agentMessageSeen.add(itemId); transcript.beginAssistant(); }
          }
          transcript.assistant(params.delta);
        } else if (event.method === 'turn/completed') { commandOutputSeen.clear(); agentMessageSeen.clear(); transcript.close(); transcript.event('回合结束：' + String(params.turn?.status || '未知')); }
        else {
          const itemId = params.item?.id;
          const toolEvent = codexToolEvent(event, commandOutputSeen.has(itemId)); if (toolEvent) transcript.command(toolEvent.title, toolEvent.detail);
          if (event.method === 'item/completed') commandOutputSeen.delete(itemId);
          if (event.method === 'item/completed' && params.item?.type === 'agentMessage') transcript.close();
        }
      }
      showApprovals(result.approvals);
      const link = result.status?.link || {};
      codexRunning = link.turn_state === 'running';
      root.querySelector('.agent-session')?.setAttribute('data-recovery', String(link.turn_state === 'unknown' || uncertain.has(id)));
      serverUnsettled = link.turn_state !== 'idle' && link.turn_state !== undefined; connected = !!result.status?.connected; if (!busy) lock(false);
      message(!result.status?.connected ? '连接已断开；回合结果需核对。' : uncertain.has(id) || link.turn_state === 'unknown' ? '上次提交结果未知，请核对原生会话，勿重复发送。' : link.turn_state === 'running' || link.turn_state === 'starting' ? '运行中' : '已连接');
      if (connected && link.turn_state === 'idle') void dispatchQueue(ticket);
      else if (connected && codexRunning) void refreshQueue().catch(() => {});
      if (result.status?.connected) clock.setTimeout(() => { void poll(ticket); }, 800);
    } catch (error) { if (active(ticket)) { connected = false; if (!busy) lock(false); message('读取失败：' + error.message + '。请重新连接。'); } }
  }
  async function pollClaude(ticket) {
    if (!active(ticket) || !runId) return;
    try {
      const result = await api(CLAUDE + '/' + encodeURIComponent(runId) + '/events?' + new URLSearchParams({ task_id: taskId, after: String(cursor) }));
      if (!active(ticket)) return;
      cursor = result.last_sequence;
      if (!id && result.native_session_id) { await list(); if (!active(ticket)) return; const linked = links.find(item => item.provider === 'claude' && item.native_session_id === result.native_session_id); if (linked) { id = linked.id; savedModel = linked.model || ''; savedPermission = linked.permission || 'ask'; field('session').value = id; connected = true; void onSessionsChanged(); } }
      if (result.truncated) transcript.info('部分实时输出已丢失，请查看原生历史。');
      for (const row of result.events || []) {
        const event = row.event || {};
        if (event.type === 'system' && event.subtype === 'init') {
          await list(); if (!active(ticket)) return;
          const link = links.find(item => item.provider === 'claude' && item.native_session_id === event.session_id);
          if (link && id !== link.id) { id = link.id; field('session').value = id; connected = true; void onSessionsChanged(); }
        }
        if (event.type === 'stream_event' && event.event?.delta?.type === 'text_delta') transcript.assistant(event.event.delta.text || '');
        if (event.type === 'result') { transcript.close(); transcript.event('回合结束：' + (event.subtype === 'success' && !event.is_error ? '完成' : '失败')); }
        for (const toolEvent of claudeToolEvent(event) || []) transcript.command(toolEvent.title, toolEvent.detail);
      }
      showApprovals(result.approvals, true);
      runActive = result.state === 'running';
      serverUnsettled = runActive || result.state === 'unknown';
      if (result.state === 'unknown') { if (id) uncertain.add(id); else createUncertain = true; }
      if (!busy) lock(false);
      const reasons = { settings_mismatch: 'Claude 返回的模型或权限与所选设置不一致。', initialization_missing: 'Claude 没有返回初始化信息。', session_mismatch: 'Claude 返回的会话身份不匹配。' };
      message(result.state === 'unknown' ? (reasons[result.reason] || 'Claude 运行中断。') + '结果未知，请核对原生会话，勿重复发送。' : runActive ? 'Claude 运行中' : 'Claude 回合已结束');
      if (result.state === 'completed' && !serverUnsettled) void dispatchQueue(ticket);
      if (runActive) clock.setTimeout(() => { void pollClaude(ticket); }, 800);
      else if (result.state === 'completed') void api(CLAUDE + '/' + encodeURIComponent(runId) + '?task_id=' + encodeURIComponent(taskId), { method: 'DELETE' }).then(() => listRuns()).catch(() => {});
    } catch (error) { if (active(ticket)) { runActive = false; if (id) uncertain.add(id); else createUncertain = true; if (!busy) lock(false); message('读取失败，请核对原生会话：' + error.message); } }
  }
  function showDshApprovals(items) {
    const ticket = token, endpoint = '/api/workbench/dsh-runs/' + encodeURIComponent(runId) + '/approval';
    const current = new Set((items || []).map(item => JSON.stringify([ticket, endpoint, item.id])));
    for (const [key, state] of approvalStates) if (state !== 'pending' && !current.has(key)) approvalStates.delete(key);
    const signature = JSON.stringify([ticket, endpoint, items || [], [...approvalStates]]);
    if (signature === approvalSignature && approvals.children.length === (items || []).length) return;
    approvalSignature = signature;
    approvals.replaceChildren();
    for (const item of items || []) {
      const key = JSON.stringify([ticket, endpoint, item.id]);
      const box = document.createElement('div'); box.className = 'agent-approval';
      const title = document.createElement('strong'); title.textContent = 'DSH 需要你的审批';
      const detail = document.createElement('pre'); detail.textContent = JSON.stringify(item.tool_call || {}, null, 2);
      box.append(title, detail);
      if (approvalStates.has(key)) { const notice = document.createElement('span'); notice.textContent = approvalStates.get(key) === 'unknown' ? '审批结果未确认，请核对原生会话。' : '审批已提交，等待状态更新。'; box.append(notice); }
      for (const [decision, label] of [['accept', '批准'], ['decline', '拒绝']]) {
        const action = document.createElement('button'); action.type = 'button'; action.className = 'btn'; action.textContent = label;
        action.onclick = async () => {
          if (busy || !runId) return;
          approvalStates.set(key, 'pending'); lock(true);
          try {
            await post(endpoint, { task_id: taskId, request_id: String(item.request_id), decision });
            approvalStates.set(key, decision); message('审批已提交。');
          } catch (error) {
            approvalStates.set(key, 'unknown'); message('审批结果未确认：' + error.message);
          } finally { if (root.isConnected) lock(false); }
        };
        box.append(action);
      }
      approvals.append(box);
    }
  }
  async function pollDsh(ticket) {
    if (!active(ticket) || !runId) return;
    try {
      const result = await api('/api/workbench/dsh-runs/' + encodeURIComponent(runId) + '/events?' + new URLSearchParams({ task_id: taskId, after: String(cursor) }));
      if (!active(ticket)) return;
      cursor = result.last_sequence;
      if (result.truncated) transcript.info('部分 DSH 实时输出已丢失。');
      for (const row of result.events || []) {
        const event = row.event || {};
        if (event.type !== 'session_update') continue;
        const update = event.update || {};
        const kind = update.sessionUpdate;
        if (kind === 'agent_message_chunk' && update.content?.type === 'text') transcript.assistant(update.content.text || '');
        else if (kind === 'agent_thought_chunk' && update.content?.type === 'text') transcript.info('[思考] ' + update.content.text);
        else if (kind === 'tool_call') transcript.command(String(update.title || 'DSH 工具调用'), JSON.stringify(update.rawInput ?? update.content ?? '', null, 2));
        else if (kind === 'tool_call_update') transcript.command('DSH 工具：' + String(update.toolCallId || ''), String(update.status || ''));
        else if (kind === 'plan') transcript.info('[计划] ' + JSON.stringify(update.entries || update, null, 2));
        else if (kind === 'config_option_update') transcript.info('[配置更新] ' + JSON.stringify(update.configOptions || update, null, 2));
      }
      showDshApprovals(result.approvals || []);
      runActive = result.state === 'running';
      serverUnsettled = result.state === 'unknown';
      if (result.state === 'unknown' && id) uncertain.add(id);
      if (!busy) lock(false);
      message(result.state === 'unknown' ? 'DSH 回合结果未知，请核对原生会话。' : runActive ? 'DSH 运行中' : result.state === 'failed' ? 'DSH 回合失败' : 'DSH 回合已结束');
      if (result.state === 'completed' && !serverUnsettled) void dispatchQueue(ticket);
      if (runActive) clock.setTimeout(() => { void pollDsh(ticket); }, 800);
      else if (result.state === 'completed') void api('/api/workbench/dsh-runs/' + encodeURIComponent(runId) + '?task_id=' + encodeURIComponent(taskId), { method: 'DELETE' }).catch(() => {});
    } catch (error) {
      if (active(ticket)) { runActive = false; if (id) uncertain.add(id); if (!busy) lock(false); message('读取 DSH 失败，请核对原生会话：' + error.message); }
    }
  }
  async function list() {
    if (!taskId) return;
    const result = await api(BASE + '?task_id=' + encodeURIComponent(taskId));
    if (!root.isConnected) return;
    const select = field('session'); select.replaceChildren(new Option('选择已关联会话', ''));
    links = result.links || [];
    for (const link of links) select.add(new Option(providerLabel(link.provider) + ' · ' + (link.model || '默认模型') + ' · ' + link.workspace, link.id));
    if (id) select.value = id;
    if (result.truncated) message('会话列表仅显示前 100 项。');
  }
  async function loadCraftTask() {
    if (!taskId) return;
    try {
      const result = await api('/api/tasks/' + encodeURIComponent(taskId));
      if (!root.isConnected) return;
      const task = result.task || {};
      const model = typeof task.model_id === 'string' ? task.model_id : '';
      const select = modelFieldFor('craft');
      if (select && model && select.options && !Array.from(select.options).some(option => option.value === model)) select.add(new Option(model, model));
      if (select && model && !select.value) select.value = model;
      transcript.clear();
      for (const message of result.messages || []) {
        if (!message || typeof message.content !== 'string') continue;
        if (message.role === 'user') transcript.user(message.content);
        else if (message.role === 'assistant') { transcript.beginAssistant(); transcript.assistant(message.content); transcript.close(); }
      }
      if (result.truncated) transcript.info('Craft 对话仅显示前 100 条。');
      message('已恢复 Craft 对话。');
    } catch (error) {
      if (root.isConnected) message('Craft 历史读取失败：' + error.message);
    }
  }
  function providerLabel(value) { return value === 'codex' ? 'Codex CLI' : value === 'claude' ? 'Claude Code' : value === 'dsh' ? 'DSH' : value === 'craft' ? 'Craft' : value ? String(value) : '工具'; }
  function modelFieldFor(value) {
    return field(value === 'claude' ? 'claude-model' : value === 'dsh' ? 'dsh-model' : value === 'craft' ? 'craft-model' : 'model');
  }
  function taskPermissionMode(value) {
    return value === 'full' ? 'full_access' : value === 'auto' ? 'assisted_approval' : 'human_approval';
  }
  async function listRuns() {
    if (!taskId) return;
    const result = await api(CLAUDE + '?task_id=' + encodeURIComponent(taskId));
    if (!root.isConnected) return;
    const select = field('run'); select.replaceChildren(new Option('选择进行中或未查看的运行', ''));
    for (const item of result.runs || []) select.add(new Option((item.state === 'running' ? '运行中' : item.state === 'unknown' ? '结果未知' : '已结束') + ' · ' + item.run_id.slice(0, 8), item.run_id));
  }
  button('refresh-runs').onclick = () => { void listRuns().catch(error => message('读取运行失败：' + error.message)); };
  button('release-run').onclick = async () => {
    if (busy || runActive) return;
    const selected = field('run').value; if (!selected) { message('请先选择 Claude 运行。'); return; }
    lock(true); let released = false;
    try { await api(CLAUDE + '/' + encodeURIComponent(selected) + '?task_id=' + encodeURIComponent(taskId), { method: 'DELETE' }); released = true; await listRuns(); message('运行记录已清除，原生历史仍由 CLI 保存。'); }
    catch (error) { message((released ? '运行记录已清除，但刷新列表失败：' : '清除运行记录未确认：') + error.message); }
    finally { if (root.isConnected) lock(false); }
  };
  button('refresh-sessions').onclick = () => { void list().then(() => message('会话列表已刷新。')).catch(error => message('刷新会话失败：' + error.message)); };
  button('reopen').onclick = () => {
    if (busy || runActive) return;
    const selected = field('run').value; if (!selected) { message('请先选择 Claude 运行。'); return; }
    provider = 'claude'; id = ''; connected = false; runId = selected; runActive = true; cursor = 0; output.textContent = ''; approvals.replaceChildren(); const ticket = ++token; lock(false); void pollClaude(ticket);
  };
  async function connect(selected) {
    nativePicker.open = false; closeMention();
    if (!selected) { message('请先选择会话。'); return; }
    const chosen = links.find(link => link.id === selected); if (!chosen) { message('会话不存在，请刷新任务。'); return; }
    field('workspace').value = chosen.workspace; button('native-folder').textContent = chosen.workspace.split(/[\\/]/).filter(Boolean).pop() || chosen.workspace;
    field('provider').value = chosen.provider;
    if (conversationTitle) conversationTitle.textContent = chosen.workspace.split(/[\\/]/).filter(Boolean).pop() || '对话';
    const permissionField = field('permission');
    if (chosen.permission === 'read_only' && permissionField.options && !Array.from(permissionField.options).some(option => option.value === 'read_only')) permissionField.add(new Option('只读（旧会话）', 'read_only'));
    permissionField.value = chosen.permission || 'ask';
    const modelField = modelFieldFor(chosen.provider);
    if (chosen.model && modelField?.options && !Array.from(modelField.options).some(option => option.value === chosen.model)) modelField.add(new Option(chosen.model, chosen.model));
    if (modelField) modelField.value = chosen.model || '';
    savedModel = chosen.model || ''; savedPermission = chosen.permission || 'ask';
    showProviderModel(false);
    freezeConfiguration();
    nativePicker.hidden = true;
    const ticket = ++token; editingQueue = null; queueSignature = ''; id = selected; provider = chosen.provider; runId = ''; connected = false; serverUnsettled = chosen.turn_state !== 'idle'; generation = null; cursor = 0; commandOutputSeen.clear(); agentMessageSeen.clear(); transcript.clear();  history.textContent = '连接后可读取 CLI 保存的历史。'; historyOffset = null; button('history-next').hidden = true; approvals.replaceChildren(); lock(true);
    if (provider === 'claude') void loadClaudeModels();
    else if (provider === 'dsh') void loadDshModels();
    async function showHistory() {
      try { const result = await api(path('history') + '?task_id=' + encodeURIComponent(taskId)); if (active(ticket)) { transcript.clear(); if (result.unavailable) transcript.info(String(result.note || '该工具不提供原生历史回放。')); for (const message of nativeHistoryMessages(result)) { if (message.role === '用户') transcript.user(message.text); else if (message.role === 'Claude' || message.role === 'Codex' || message.role === 'DSH') transcript.assistant(message.text); else if (message.role === '命令') transcript.command(message.text, message.status === undefined ? '' : '[命令结束：' + String(message.status || '未知') + (typeof message.exitCode === 'number' ? '，退出码 ' + message.exitCode : '') + ']' + (message.detail ? '\n' + message.detail : '')); else transcript.info('[' + message.role + ']'); } if (result.truncated) transcript.info('历史仅显示前 100 条。'); } }
      catch (error) { if (active(ticket)) message('历史读取失败：' + error.message); }
    }
    if (provider === 'claude') { connected = true; if (chosen.turn_state !== 'idle') uncertain.add(id); await showHistory(); lock(false); message(uncertain.has(id) ? '上次回合未决，请核对原生历史。' : '已选择 Claude 会话；发送时恢复。'); if (!uncertain.has(id)) void dispatchQueue(ticket); return; }
    if (provider === 'dsh') {
      try {
        await post(path('resume'), { task_id: taskId });
        if (!active(ticket)) return;
        connected = true; await showHistory(); lock(false);
        message(chosen.turn_state !== 'idle' ? 'DSH 上次回合未决，请核对原生会话。' : '已选择 DSH 会话；发送时继续。');
      } catch (error) { if (active(ticket)) { lock(false); message('连接 DSH 失败：' + error.message); } }
      return;
    }
    try { await post(path('resume'), { task_id: taskId }); if (active(ticket)) { connected = true; await showHistory(); if (active(ticket)) { lock(false); await poll(ticket); } } }
    catch (error) {
      if (!active(ticket)) return;
      lock(false); message('连接失败：' + error.message);
      if (!String(error.message).includes('该 Codex 会话正由其他进程使用')) return;
      try {
        const owner = await api(path('takeover') + '?task_id=' + encodeURIComponent(taskId));
        if (!active(ticket) || !owner.available) return;
        const box = document.createElement('div'); box.className = 'agent-approval';
        const notice = document.createElement('p'); notice.textContent = (owner.source === 'external' ? 'Codex 进程 ' : 'Craft 的旧进程 ') + owner.pid + ' 正占用此会话。接管将结束该进程并中断其中的运行。' + (owner.source === 'external' ? ' 此进程打开了 ' + owner.session_count + ' 个会话，其他会话也可能中断。' : ''); box.append(notice);
        const take = document.createElement('button'); take.type = 'button'; take.className = 'btn'; take.textContent = '接管会话';
        take.onclick = async () => { if (!active(ticket) || busy) return; take.disabled = true; lock(true); try { await post(path('takeover'), { task_id: taskId, pid: owner.pid, started: owner.started, ...(owner.source === 'external' ? { session_count: owner.session_count } : {}) }); if (active(ticket)) { lock(false); await connect(selected); } } catch (failure) { if (active(ticket)) { lock(false); message('接管失败：' + failure.message); box.remove(); } } };
        box.append(take); approvals.append(box);
      } catch { if (active(ticket)) message('连接失败：无法确认占用进程，请在原窗口退出后重试。'); }
    }
  }
  button('resume').onclick = () => { if (!busy) void connect(field('session').value); };
  function persistProvider() {
    const value = String(field('provider').value || '');
    if (!value || value === '__new__') return;
    if (defaultProvider === value) return;
    void api('/api/settings', { method: 'PATCH', body: { lastProvider: value } }).catch(() => {});
  }
  button('create').onclick = async () => {
    if (busy || createUncertain) return;
    const workspace = field('workspace').value.trim(); if (!workspace) { message('请填写项目目录。'); return; }
    const selectedProvider = field('provider').value;
    if (selectedProvider === 'craft') { lock(false); message('Craft 自身由本任务的对话驱动，模型取自「模型」页配置的网关；直接在下方对话里发送消息即可。'); return; }
    if (!selectedProvider || selectedProvider === '__new__') { lock(false); message('请先选择工具（Codex CLI、Claude Code 或 DSH）。'); return; }
    if (!['codex', 'claude', 'dsh'].includes(selectedProvider)) { lock(false); message('该工具插件还没有可用的会话适配器。'); return; }
    lock(true); message('正在创建原生会话…');
    let created = false;
    try {
      if (field('provider').value === 'claude') {
        const prompt = field('prompt').value.trim(); if (!prompt) { lock(false); message('Claude 新会话需要先输入第一条消息。'); return; }
        if (!['ask', 'auto', 'full'].includes(field('permission').value)) { lock(false); message('Claude 权限模式不可用。'); return; }
        const result = await post(CLAUDE, { task_id: taskId, workspace, model: field('claude-model').value.trim() || null, permission: field('permission').value, work_mode: field('work-mode').value || 'default', prompt, operation_id: crypto.randomUUID() });
        provider = 'claude'; id = ''; connected = false; runId = result.run_id; runActive = true; cursor = 0; setPrompt(''); output.textContent = '[你]\n' + prompt + '\n\n'; freezeConfiguration(); const ticket = ++token; lock(false); await pollClaude(ticket); return;
      }
      if (field('provider').value === 'dsh') {
        const prompt = field('prompt').value.trim(); if (!prompt) { lock(false); message('DSH 新会话需要先输入第一条消息。'); return; }
        const result = await post('/api/workbench/dsh-runs', { task_id: taskId, workspace, model: field('dsh-model').value.trim() || null,
          reasoning_effort: field('dsh-reasoning').value.trim() || null, permission: field('permission').value,
          prompt, operation_id: crypto.randomUUID() });
        provider = 'dsh'; id = result.link?.id || ''; connected = !!id; runId = result.run_id; runActive = true; cursor = 0;
        setPrompt(''); output.textContent = '[你]\n' + prompt + '\n\n'; freezeConfiguration(); const ticket = ++token; lock(false);
        if (id) { await list(); void onSessionsChanged(); }
        await pollDsh(ticket); return;
      }
      const result = await post(BASE, { provider: 'codex', task_id: taskId, workspace, model: field('model').value || null, permission: field('permission').value, operation_id: crypto.randomUUID() });
      id = result.link.id; created = true; await list(); void onSessionsChanged(); lock(false); await connect(id);
    } catch (error) { createUncertain = !created; lock(false); message(created ? '会话已创建，但列表刷新失败；请刷新会话后连接：' + error.message : '创建未确认，请先核对会话列表和原生 CLI：' + error.message); }
  };
  async function sendCraftPrompt(prompt) {
    if (!prompt) return;
    const model = modelFieldFor('craft')?.value || '';
    const workspace = field('workspace').value.trim();
    if (!workspace) { message('请先选择项目文件夹。'); return; }
    if (!model) { message('请先选择 Craft 模型。'); return; }
    if (busy || createUncertain) return;
    const hadTask = !!taskId;
    lock(true);
    transcript.user(prompt);
    try {
      if (!taskId) {
        const name = workspace.split(/[\\/]/).filter(Boolean).pop() || workspace;
        const created = await post('/api/tasks', {
          title: name,
          goal: prompt,
          model_id: model,
          permission_mode: taskPermissionMode(field('permission').value),
          workspace,
        });
        if (!created.task?.id) throw new Error('未获得任务身份');
        taskId = created.task.id;
        void onSessionsChanged();
      }
      const result = await post('/api/tasks/' + encodeURIComponent(taskId) + '/messages', {
        content: prompt,
        model_id: model,
        permission_mode: taskPermissionMode(field('permission').value),
      });
      setPrompt('');
      transcript.beginAssistant();
      transcript.assistant(String(result.assistant?.content || '模型未返回文本。'));
      transcript.close();
      message('Craft 回合已完成。');
      void onSessionsChanged();
    } catch (error) {
      transcript.close();
      if (!hadTask && !taskId) createUncertain = true;
      message('Craft 回合未完成：' + error.message);
    } finally {
      if (root.isConnected) lock(false);
    }
  }
  async function sendPrompt() {
    const prompt = field('prompt').value.trim();
    if (prompt === '/plan') { setPrompt(''); setWorkMode(field('work-mode').value === 'plan' ? 'default' : 'plan'); return; }
    if (prompt === '/goal' || prompt.startsWith('/goal ')) {
      if (provider !== 'codex' || !id || !connected) { message('请先打开一个 Codex 会话，再查看或设置目标。'); return; }
      const objective = prompt.slice(5).trim(); lock(true);
      try {
        const result = objective ? await post(path('goal'), { task_id: taskId, objective }) : await api(path('goal') + '?task_id=' + encodeURIComponent(taskId));
        setPrompt('');
        const goal = result.goal; transcript.event('[目标] ' + (goal ? String(goal.objective || '') + ' · ' + String(goal.status || '未知') : '当前没有目标。'));
      } catch (error) { message('目标操作未确认，请检查当前会话：' + error.message); }
      finally { lock(false); }
      return;
    }
    if (prompt === '/status') {
      setPrompt('');
      const chosen = field('provider').value;
      transcript.assistant('状态\n工具：' + providerLabel(chosen) + '\n模型：' + (modelFieldFor(chosen)?.value || '尚未选择') + '\n权限：' + field('permission').value);
      if (chosen === 'claude') {
        try {
          const workspace = field('workspace').value.trim();
          const usage = await api(BASE + '/claude-usage' + (workspace ? '?workspace=' + encodeURIComponent(workspace) : ''));
          if (!usage.available || !usage.windows?.length) transcript.assistant('订阅额度：当前账号或服务未提供。');
          else for (const window of usage.windows) transcript.assistant(String(window.id) + '：已使用 ' + window.used_percent + '%' + (window.resets_at ? '，重置时间：' + window.resets_at : ''));
          transcript.assistant('账户余额和本次会话费用：当前未提供。');
        } catch { transcript.assistant('无法读取 Claude 用量，请稍后重试。'); }
        return;
      }
      if (chosen !== 'codex') {
        transcript.assistant('订阅额度：当前工具不提供。');
        return;
      }
      try {
        const usage = await api(BASE + '/codex-usage'); const snapshot = usage.rate_limits || {};
        for (const key of ['primary', 'secondary']) {
          const window = snapshot[key]; if (!window || typeof window.usedPercent !== 'number') continue;
          const reset = typeof window.resetsAt === 'number' ? '，重置时间：' + new Date(window.resetsAt * 1000).toLocaleString() : '';
          transcript.assistant('额度窗口' + (window.windowDurationMins ? '（' + window.windowDurationMins + ' 分钟）' : '') + '：已使用 ' + window.usedPercent + '%' + reset);
        }
        transcript.assistant(snapshot.credits?.balance != null ? '额度余额：' + String(snapshot.credits.balance) : '账户余额：服务未提供。');
      } catch { transcript.assistant('无法读取 Codex 用量，请稍后重试。'); }
      return;
    }
    if (field('provider').value === 'craft') {
      await sendCraftPrompt(prompt);
      return;
    }
    if (id && connected && !busy && !uncertain.has(id) && (runActive || codexRunning || serverUnsettled) && prompt) {
      lock(true);
      try { await post(path('queue'), { task_id: taskId, prompt, work_mode: field('work-mode').value || 'default' }); setPrompt(''); await refreshQueue(); lock(false); message('已加入队列，当前回合结束后发送；立即插入请点击“立即指导”。'); }
      catch (error) { message('加入队列失败：' + error.message); }
      finally { lock(false); }
      return;
    }
    if (!id && !busy && !createUncertain && !runActive && !selectedLink && prompt) {
      const workspace = field('workspace').value.trim();
      if (!workspace) { message('请先选择项目文件夹。'); return; }
      const modelValue = field('provider').value === 'claude' ? field('claude-model').value
        : field('provider').value === 'dsh' ? field('dsh-model').value
          : field('provider').value === 'craft' ? (field('craft-model') || {}).value : field('model').value;
      if (!modelValue) { message('请先选择模型。'); return; }
      lock(true);
      if (!taskId) {
        try {
          const name = workspace.split(/[\\/]/).filter(Boolean).pop() || workspace;
          const result = await post('/api/tasks', { title: name, goal: '在选定的项目中工作', permission_mode: taskPermissionMode(field('permission').value), workspace });
          if (!result.task?.id) throw new Error('未获得任务身份');
          taskId = result.task.id;
        } catch (error) { createUncertain = true; lock(false); message('项目准备结果未确认，请检查后重新打开工作台：' + error.message); return; }
      }
      lock(false);
      await button('create').onclick();
      if (provider === 'claude' || !id || !connected) return;
    }
    if (busy || serverUnsettled || !id || !connected || uncertain.has(id) || !prompt) { message('请填写内容并核对未确认的提交。'); return; }
    lock(true); message('正在提交…');
    try {
      if (provider === 'claude') {
        const result = await post(CLAUDE + '/turns', { task_id: taskId, link_id: id, prompt, work_mode: field('work-mode').value || 'default', operation_id: crypto.randomUUID() });
        runId = result.run_id; runActive = true; cursor = 0; setPrompt(''); transcript.user(prompt); const ticket = ++token; lock(false); await pollClaude(ticket); return;
      }
      if (provider === 'dsh') {
        const result = await post('/api/workbench/dsh-runs/turns', { task_id: taskId, link_id: id, prompt,
          work_mode: field('work-mode').value || 'default', operation_id: crypto.randomUUID() });
        runId = result.run_id; runActive = true; cursor = 0; setPrompt(''); transcript.user(prompt);
        const ticket = ++token; lock(false); await pollDsh(ticket); return;
      }
      await post(path('turns'), { task_id: taskId, prompt, work_mode: field('work-mode').value || 'default', operation_id: crypto.randomUUID() }); codexRunning = true; setPrompt(''); transcript.user(prompt); message('已提交');
    }
    catch (error) { uncertain.add(id); message('提交未确认，请核对原生会话，勿重复发送：' + error.message); }
    finally { lock(false); }
  }
  async function interruptRun() { if ((!id && !runId) || busy) return; lock(true); try {
    const endpoint = provider === 'claude' ? CLAUDE + '/' + encodeURIComponent(runId) + '/interrupt'
      : provider === 'dsh' ? '/api/workbench/dsh-runs/' + encodeURIComponent(runId) + '/interrupt'
      : path('interrupt');
    await post(endpoint, { task_id: taskId }); message('已请求停止，等待原生回合结束。');
  } catch (error) { message('停止未确认：' + error.message); } finally { lock(false); } }
  sendStop.onclick = () => sendStop.dataset.state === 'stop' ? interruptRun() : sendPrompt();
  button('unlink').onclick = async () => {
    if (busy || runActive || serverUnsettled || !id || uncertain.has(id)) return;
    const ticket = token; lock(true);
    try {
      await api(BASE + '/' + encodeURIComponent(id) + '?task_id=' + encodeURIComponent(taskId), { method: 'DELETE' });
      if (!active(ticket)) return;
      ++token; id = ''; connected = false; output.textContent = '连接后显示实时输出；历史由 CLI 保存。'; approvals.replaceChildren();
      try { await list(); message('已解除关联，原生历史仍由 CLI 保存。'); }
      catch (error) { message('已解除关联，刷新列表失败：' + error.message); }
    } catch (error) { if (active(ticket)) message('解除关联未确认，请刷新会话列表：' + error.message); }
    finally { if (root.isConnected) lock(false); }
  };
  button('reconcile').onclick = async () => {
    if (busy || provider !== 'codex' || !id || !connected || !serverUnsettled) return;
    const ticket = token; lock(true);
    try { await post(path('reconcile'), { task_id: taskId }); if (active(ticket)) { uncertain.delete(id); serverUnsettled = false; message('已根据原生历史确认回合结束。'); } }
    catch (error) { if (active(ticket)) message('无法确认回合结束，请查看原生历史：' + error.message); }
    finally { if (active(ticket)) lock(false); }
  };
  let historyOffset = null;
  async function loadHistoryPage(offset) {
    if (!id || !connected || busy) return;
    const ticket = token; lock(true);
    try {
      const result = await api(path('history') + '?task_id=' + encodeURIComponent(taskId) + (offset ? '&offset=' + offset : ''));
      if (!active(ticket)) return;
      const page = formatNativeHistory(result);
      history.textContent = offset ? history.textContent + '\n\n' + page : page;
      historyOffset = result.provider === 'claude' ? result.next_offset : null;
      button('history-next').hidden = historyOffset == null;
      if (result.truncated && historyOffset == null) history.textContent += '\n[历史显示不完整]';
      root.querySelector('.agent-history').open = true;
    } catch (error) { if (active(ticket)) message('原生历史读取失败：' + error.message); }
    finally { if (active(ticket)) lock(false); }
  }
  button('history').onclick = () => loadHistoryPage(0);
  button('history-next').onclick = () => { if (historyOffset != null) void loadHistoryPage(historyOffset); };
  lock(false);
  /** The user may install a CLI while the app stays open, so detection repeats. */
  async function loadProviders() {
    const refresh = button('provider-refresh');
    if (refresh) refresh.disabled = true;
    try {
      const result = await api(BASE + '/providers');
      if (!root.isConnected) return;
      providerCatalog = (result.providers || []).filter(provider => provider && typeof provider.id === 'string');
      refreshProviderOptions();
      syncProviderControls();
      showProviderModel(false);
      for (const provider of result.providers || []) {
        const node = root.querySelector('[data-provider="' + provider.id + '"]');
        if (!node) continue;
        const state = provider.status === 'available' ? provider.version
          : provider.status === 'not_found' ? '当前环境未找到'
            : provider.status === 'plugin' ? '由插件提供' : '启动失败';
        node.textContent = (provider.id === 'codex' ? 'Codex CLI：' : provider.id === 'claude' ? 'Claude Code：' : String(provider.name || provider.id) + '：') + state;
      }
    } catch { if (root.isConnected) for (const node of root.querySelectorAll('[data-provider]')) node.textContent = '检测失败，请查看官方安装说明'; }
    finally { if (root.isConnected && refresh) refresh.disabled = false; }
  }
  const providerRefresh = button('provider-refresh');
  if (providerRefresh) providerRefresh.onclick = () => {
    message('正在重新检测本机工具…');
    void loadProviders().then(() => { if (root.isConnected) message('检测完成；已安装的工具会出现在「已安装工具」里。'); });
  };
  void loadProviders();
  void Promise.all([list(), listRuns(), api(BASE + '/models').then(result => {
    if (!root.isConnected) return;
    for (const model of result.models || []) field('model').add(new Option(model.name, model.id));
    if (result.truncated) message('模型列表已截断。');
  })]).then(async () => {
    if (root.isConnected && selectedLink) return connect(selectedLink);
    if (root.isConnected && taskId && !id && field('provider').value === 'craft') {
      await loadCraftTask();
      return;
    }
    if (root.isConnected && !id) message('选择项目和工作方式，然后发送消息。');
  }).catch(error => { if (root.isConnected) message('读取失败：' + error.message); });
}
