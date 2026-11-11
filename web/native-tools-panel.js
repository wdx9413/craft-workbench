/* Trial and approval surface for Craft's own tools.
 *
 * The catalogue lists tools the loop can call, but a list is not authority: a
 * trial call goes through the same ActionGateway and InternalActionApprovalBroker
 * the model uses. A read-only effect runs straight away; anything else either
 * runs under the host's allow policy or parks as a pending approval for five
 * minutes. That is why this panel shows the approval queue while a call is in
 * flight — without it a trial would hang with nothing to click.
 *
 * DOM-free helpers are exported so the argument skeleton and the wording can be
 * asserted without a browser, matching the rest of this directory.
 */

const TOOL_BASE = '/api/workbench/native-tools';
const APPROVAL_BASE = '/api/workbench/internal-approvals';
const POLL_MS = 800;

/** The declared type decides the placeholder; an unknown schema stays an empty string. */
function placeholder(schema) {
  if (!schema || typeof schema !== 'object') return '';
  if (schema.type === 'integer' || schema.type === 'number') return 0;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'array') return [];
  if (schema.type === 'object') return {};
  return '';
}

/** Only required keys are pre-filled; guessing optional arguments would invent intent. */
export function argumentTemplate(parameters) {
  const properties = (parameters && parameters.properties) || {};
  const required = Array.isArray(parameters?.required) ? parameters.required : [];
  const args = {};
  for (const key of required) args[key] = placeholder(properties[key]);
  return JSON.stringify(args, null, 2);
}

/** An approval is bound to one digest; the label says what the person is allowing. */
export function approvalLabel(approval) {
  const effect = String(approval?.effect || 'unknown');
  return `${String(approval?.action || 'unknown')} · ${effect}`;
}

export function mountNativeTools(host, { api, esc, clock = globalThis, onNotice = () => {} }) {
  if (!host) return { refresh() {}, destroy() {} };
  host.innerHTML =
    '<div class="stack"><div class="form-actions"><button class="btn" type="button" data-native="refresh">刷新工具与待批准</button>' +
    '<span class="row-sub" data-native="status" role="status" aria-live="polite"></span></div>' +
    '<div data-native="approvals" class="stack" aria-live="polite"></div>' +
    '<div data-native="tools" class="rows"></div></div>';
  const q = key => host.querySelector(`[data-native="${key}"]`);
  let stopped = false, inflight = 0, timer, serial = 0;
  let approvals = [], tools = [];

  const say = text => { q('status').textContent = text; };

  function approvalRows() {
    if (!approvals.length) return '';
    return '<div class="card"><div class="card-body stack"><h3>待批准的原生工具调用</h3>' +
      '<p class="doc-p">每条记录只对你看到的那一次调用生效；过期后需要重新发起。</p>' +
      approvals.map((item, index) => '<div class="row"><div class="row-main"><span class="row-title">' + esc(approvalLabel(item)) + '</span>' +
        '<span class="row-sub">' + esc(String(item.args_digest || '').slice(0, 16)) + ' · 到期 ' + esc(String(item.expires_at || '未知')) + '</span></div>' +
        '<div class="row-actions"><button class="btn primary" type="button" data-native-approve="' + index + '">接受</button>' +
        '<button class="btn danger" type="button" data-native-decline="' + index + '">拒绝</button></div></div>').join('') +
      '</div></div>';
  }

  function toolRows() {
    if (!tools.length) return '<p class="doc-p">原生工具目录不可用。</p>';
    return tools.map((tool, index) => '<div class="row"><span class="row-lead accent">T</span><div class="row-main">' +
      '<span class="row-title">' + esc(tool.name) + '</span><span class="row-sub">' + esc(tool.description || '') + '</span>' +
      '<details class="form-block"><summary>试运行参数</summary><div class="field"><label for="native-args-' + index + '">参数（JSON）</label>' +
      '<textarea id="native-args-' + index + '" data-native-args="' + index + '" rows="4">' + esc(argumentTemplate(tool.parameters)) + '</textarea></div>' +
      '<div class="row-actions"><button class="btn primary" type="button" data-native-run="' + index + '">执行</button></div>' +
      '<pre class="out" data-native-out="' + index + '" hidden></pre></details></div></div>').join('');
  }

  function paint() {
    q('approvals').innerHTML = approvalRows();
    q('tools').innerHTML = toolRows();
    q('approvals').querySelectorAll('[data-native-approve]').forEach(button => {
      button.onclick = () => decide(approvals[Number(button.getAttribute('data-native-approve'))], 'accept', button);
    });
    q('approvals').querySelectorAll('[data-native-decline]').forEach(button => {
      button.onclick = () => decide(approvals[Number(button.getAttribute('data-native-decline'))], 'decline', button);
    });
    q('tools').querySelectorAll('[data-native-run]').forEach(button => {
      button.onclick = () => run(Number(button.getAttribute('data-native-run')), button);
    });
  }

  async function decide(approval, decision, button) {
    if (stopped || !approval) return;
    button.disabled = true;
    try {
      await api(`${APPROVAL_BASE}/${encodeURIComponent(String(approval.id))}`, { method: 'POST', body: { decision } });
      if (stopped) return;
      onNotice(decision === 'accept' ? '已批准这次调用。' : '已拒绝这次调用。');
    } catch (error) { if (!stopped) onNotice('审批未确认：' + error.message, true); }
    if (!stopped) await refreshApprovals();
  }

  async function run(index, button) {
    const tool = tools[index];
    if (stopped || !tool) return;
    const field = host.querySelector(`[data-native-args="${index}"]`);
    const out = host.querySelector(`[data-native-out="${index}"]`);
    let args;
    try { args = JSON.parse(String(field?.value ?? '')); }
    catch { if (out) { out.hidden = false; out.textContent = '参数不是合法 JSON。'; } return; }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      if (out) { out.hidden = false; out.textContent = '参数必须是一个 JSON 对象。'; }
      return;
    }
    button.disabled = true; inflight += 1;
    if (out) { out.hidden = false; out.textContent = '正在执行；需要审批时请在上方批准。'; }
    void poll();
    try {
      const result = await api(`${TOOL_BASE}/call`, { method: 'POST', body: { tool: tool.name, args } });
      if (stopped) return;
      if (out) out.textContent = JSON.stringify(result, null, 2);
      onNotice(tool.name + ' 执行完成。');
    } catch (error) { if (!stopped && out) out.textContent = '执行失败：' + error.message; }
    finally { inflight -= 1; if (!stopped) { button.disabled = false; await refreshApprovals(); } }
  }

  async function refreshApprovals() {
    const ticket = ++serial;
    try {
      const result = await api(APPROVAL_BASE);
      if (stopped || ticket !== serial) return;
      approvals = Array.isArray(result.approvals) ? result.approvals : [];
    } catch (error) { if (!stopped && ticket === serial) onNotice('待批准列表读取失败：' + error.message, true); return; }
    if (!stopped) paint();
  }

  // One self-rescheduling loop covers the whole trial: a pending call only exists
  // while a request is open, so the queue is polled until it settles.
  async function poll() {
    if (stopped || inflight <= 0) return;
    await refreshApprovals();
    if (stopped || inflight <= 0) return;
    timer = clock.setTimeout(() => { void poll(); }, POLL_MS);
  }

  async function refresh() {
    try {
      const result = await api(TOOL_BASE);
      if (stopped) return;
      tools = Array.isArray(result.tools) ? result.tools : [];
    } catch (error) { if (!stopped) say('工具目录读取失败：' + error.message); }
    await refreshApprovals();
  }

  q('refresh').onclick = () => { if (!stopped) { say('正在刷新…'); void refresh().then(() => { if (!stopped) say('已刷新。'); }); } };
  paint();
  void refresh();
  return { refresh, destroy() { stopped = true; ++serial; clock.clearTimeout?.(timer); } };
}
