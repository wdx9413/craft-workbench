const BASE = '/api/workbench/evaluations';

/** Local-only Context receipt audit. It does not prove model use or task benefit. */
export function mountContextAuditPanel(root, { api, invoke, storage = globalThis.localStorage, crypto = globalThis.crypto }) {
  const q = key => root.querySelector(`[data-eval="${key}"]`);
  let id = '', operation = '', busy = false, serial = 0, stopped = false;

  function controls() {
    const ready = !!q('context-pack').value.trim() && !!q('context-expectations').value.trim();
    q('context-audit-start').disabled = stopped || busy || !ready;
    q('context-audit-check').disabled = stopped || busy || !id;
    q('context-audit-new').disabled = stopped || busy || !id;
    for (const key of ['pack', 'expectations']) {
      const input = q(`context-${key}`), picker = root.querySelector(`[data-pick-context="${key}"]`);
      input.disabled = stopped || busy;
      if (picker) picker.disabled = stopped || busy;
    }
  }
  function reset(message = '') {
    ++serial; id = ''; operation = '';
    try { storage?.removeItem('craft-context-audit-operation'); } catch { /* Optional retry cache. */ }
    try { storage?.removeItem('craft-context-audit-id'); } catch { /* Server report remains intact. */ }
    q('context-audit-report').replaceChildren(); q('context-audit-identity').textContent = '';
    if (message) q('context-audit-status').textContent = message;
    controls();
  }
  function render(result) {
    const report = result?.report;
    if (!report || typeof report !== 'object') throw new Error('服务未返回有效审计报告');
    const view = q('context-audit-report'); view.replaceChildren();
    const statusText = { passed: '通过', failed: '未通过', inconclusive: '证据不足' }[report.status] || '未知';
    const omitted = Number.isSafeInteger(report.metrics?.response_omitted_items) ? report.metrics.response_omitted_items : 0;
    const summary = document.createElement('p');
    summary.textContent = `${statusText} · 引用 ${report.metrics?.selected_ref_count ?? '—'} · 条目 ${report.metrics?.selected_item_count ?? '—'} · 字符 ${report.metrics?.selected_chars ?? '—'} · 估算 Token ${report.metrics?.estimated_tokens ?? '未记录'} · Host Token ${report.metrics?.host_measured_tokens ?? '未记录'}${omitted ? ` · 响应不完整，省略 ${omitted} 条` : ''}`;
    view.append(summary);
    const checks = Array.isArray(report.checks) ? report.checks : [];
    for (const check of checks.slice(0, 100)) {
      const row = document.createElement('p');
      row.textContent = `${check.status === 'passed' ? '通过' : check.status === 'failed' ? '未通过' : '未判定'} · ${check.id} · 观测 ${check.observed ?? '—'} · 期望 ${check.expected ?? '—'}`;
      view.append(row);
    }
    if (checks.length > 100) { const note = document.createElement('p'); note.textContent = '页面显示前 100 项检查。'; view.append(note); }
    const details = document.createElement('details'), title = document.createElement('summary'), metadata = document.createElement('pre');
    title.textContent = '审计来源与限制';
    metadata.textContent = JSON.stringify({ case_id: report.case_id, metrics: report.metrics, partial: report.partial, input_digest: result.audit?.input_digest, report_digest: result.audit?.report_digest, evaluator_version: result.audit?.evaluator_version, integrity: result.integrity }, null, 2);
    details.append(title, metadata); view.append(details);
  }
  async function digest(value) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function check() {
    if (!id || stopped) return;
    const ticket = ++serial; busy = true; controls();
    q('context-audit-status').textContent = '正在读取并校验已保存的报告…';
    try {
      const result = await api(`${BASE}/context-audit/${id}/report`);
      if (stopped || ticket !== serial) return;
      render(result);
      const label = { passed: '通过', failed: '未通过', inconclusive: '证据不足' }[result.audit?.status || result.report.status] || '未知';
      q('context-audit-identity').textContent = `审计 ${id.slice(0, 12)} · 评测器 ${result.audit?.evaluator_version || '未记录'} · 输入摘要 ${result.audit?.input_digest || '未记录'}`;
      q('context-audit-status').textContent = `审计状态：${label} · 完整性已校验`;
    } catch (error) {
      if (!stopped && ticket === serial) q('context-audit-status').textContent = '读取未确认：' + error.message;
    } finally { if (ticket === serial) { busy = false; controls(); } }
  }
  async function audit() {
    if (q('context-audit-start').disabled || stopped) return;
    const ticket = ++serial; busy = true; controls(); q('context-audit-report').replaceChildren();
    q('context-audit-status').textContent = '正在审计本机文件…';
    try {
      if (!operation) {
        operation = crypto.randomUUID();
        try { storage?.setItem('craft-context-audit-operation', operation); } catch { /* Stable for this mounted panel. */ }
      }
      id = await digest(operation);
      if (stopped || ticket !== serial) return;
      try { storage?.setItem('craft-context-audit-id', id); } catch { /* Report remains readable in this panel. */ }
      const result = await api(`${BASE}/context-audit`, { method: 'POST', body: { operation_id: operation, pack_path: q('context-pack').value.trim(), expectations_path: q('context-expectations').value.trim() } });
      if (stopped || ticket !== serial) return;
      id = result.audit?.id || id;
      render(result);
      const label = { passed: '通过', failed: '未通过', inconclusive: '证据不足' }[result.audit?.status || result.report.status] || '未知';
      q('context-audit-identity').textContent = `审计 ${id.slice(0, 12)} · 评测器 ${result.audit?.evaluator_version || '未记录'} · 输入摘要 ${result.audit?.input_digest || '未记录'}`;
      q('context-audit-status').textContent = `审计状态：${label} · 完整性已校验`;
    } catch (error) {
      if (!stopped && ticket === serial) q('context-audit-status').textContent = '审计未确认；可用“核对结果”安全重试：' + error.message;
    } finally { if (ticket === serial) { busy = false; controls(); } }
  }
  for (const key of ['pack', 'expectations']) {
    const input = q(`context-${key}`);
    input.oninput = () => { if (!stopped) reset('输入文件已变更，请创建新的审计。'); };
    const picker = root.querySelector(`[data-pick-context="${key}"]`);
    if (picker) {
      picker.hidden = !invoke;
      picker.onclick = async () => {
        if (picker.disabled || stopped) return;
        try {
          const selected = await invoke('choose_reference_files');
          const path = Array.isArray(selected) ? selected[0] : selected;
          if (!stopped && typeof path === 'string' && path) { input.value = path; reset('输入文件已变更，请创建新的审计。'); }
        } catch (error) { if (!stopped) q('context-audit-status').textContent = '无法选择文件：' + error.message; }
      };
    }
  }
  q('context-audit-start').onclick = () => audit();
  q('context-audit-check').onclick = () => check();
  q('context-audit-new').onclick = () => { if (!q('context-audit-new').disabled) reset('已创建新的审计。'); };
  try {
    operation = storage?.getItem('craft-context-audit-operation') || '';
    id = storage?.getItem('craft-context-audit-id') || '';
    if (!/^[a-f0-9]{64}$/u.test(id)) id = '';
    if (id) void check();
  } catch { id = ''; operation = ''; }
  controls();
  return { destroy() { stopped = true; ++serial; controls(); } };
}
