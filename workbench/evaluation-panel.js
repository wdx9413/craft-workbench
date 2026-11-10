import { mountContextAuditPanel } from './context-audit-panel.js';
const BASE = '/api/workbench/evaluations';
const labels = { starting: '准备中', running: '评测中', cancelling: '正在取消', cancelled: '已取消', completed: '已生成报告', failed: '执行失败', unknown: '结果未知，需核对' };
const comparisonErrors = {
  'actual execution controls are missing, invalid or different': '实际执行预算或运行方式缺失、无效或不一致。请用相同条件重新评测后比较；旧报告仍可查看。',
  'runs are not comparable': '两次运行的评测集、运行配置、试验次数或被测类型不同。请选择条件一致的运行。',
  'observed evaluator environments are not comparable': '两次运行使用的评测器或系统环境不同。请在同一环境重新评测后比较。',
  'Failed to fetch': '连接中断，请检查网络或本地服务后重试。',
  'Load failed': '连接中断，请检查网络或本地服务后重试。',
};

/** Optional advanced tool; it neither copies native chat history nor grants release approval. */
export function mountEvaluationPanel(root, { api, invoke, clock = globalThis, storage = globalThis.localStorage, crypto = globalThis.crypto }) {
  root.innerHTML = `<div class="evaluation-intro"><strong>验证工作结果</strong><p>选择评测配置，在独立副本中执行检查。配置中的命令应来自你信任的项目。</p></div>
    <div class="evaluation-fields">${[['workspace', '项目文件夹'], ['suite', '评测集'], ['subject', '被测版本配置'], ['runtime', '运行配置']].map(([key, title]) => `<label>${title}<span><input data-eval="${key}" aria-label="${title}" placeholder="完整路径"><button type="button" data-pick="${key}">选择</button></span></label>`).join('')}</div>
    <div class="evaluation-actions"><button type="button" class="btn primary" data-eval="start">开始评测</button><button type="button" class="btn" data-eval="cancel" disabled>取消评测</button><button type="button" class="btn" data-eval="refresh" disabled>核对运行</button><button type="button" class="btn" data-eval="new" disabled>新评测</button></div>
    <p data-eval="status" role="status" aria-live="polite">尚未开始。</p><p data-eval="provenance" class="evaluation-run-identity"></p><div data-eval="progress" class="evaluation-progress"></div><div data-eval="report" class="evaluation-report"></div>
    <details class="evaluation-comparison evaluation-context-audit" data-eval="context-audit-section"><summary>审计 Context 回执</summary>
      <p>核对回执中的引用、条目数量和预算约束。由本机 Workbench 有界读取，不保存原始回执正文；审计不证明模型实际使用或任务收益。</p>
      <div class="evaluation-fields">
        <label>Context 回执 JSON<span><input data-eval="context-pack" aria-label="Context 回执 JSON" placeholder="选择 craft_context_open 响应文件"><button type="button" data-pick-context="pack">选择</button></span></label>
        <label>期望清单 JSON<span><input data-eval="context-expectations" aria-label="期望清单 JSON" placeholder="选择冻结的期望引用与预算"><button type="button" data-pick-context="expectations">选择</button></span></label>
      </div>
      <div class="evaluation-actions"><button type="button" class="btn primary" data-eval="context-audit-start">审计回执</button><button type="button" class="btn" data-eval="context-audit-check" disabled>核对结果</button><button type="button" class="btn" data-eval="context-audit-new" disabled>新审计</button></div>
      <p data-eval="context-audit-status" role="status" aria-live="polite">尚未审计。</p><p data-eval="context-audit-identity" class="evaluation-run-identity"></p><div data-eval="context-audit-report" class="evaluation-report"></div>
    </details>
    <section data-eval="recovery" class="evaluation-recovery" aria-label="核对未知结果" hidden><strong>先核对这次运行</strong><p>结果未知不代表执行已停止。请检查输出目录及相关进程，避免重复执行。</p><p data-eval="identity" class="evaluation-run-identity"></p><label><input type="checkbox" data-eval="confirmed">我已核对输出和进程，确认原执行已停止</label><button type="button" class="btn" data-eval="prepare" disabled>保留记录并准备新评测</button><p>原结果保持未知。这里只准备新表单，不会停止进程、修改记录或重新发送。</p></section>
    <details data-eval="unresolved" class="evaluation-comparison" hidden><summary>待核对的评测</summary><p>最近 20 个本机查看过的未知运行。记录不会因新评测而删除，查看时会重新核对服务状态。</p><div class="evaluation-fields"><label>运行记录<select data-eval="unknown-run" aria-label="待核对运行"></select></label></div><button type="button" class="btn" data-eval="open-unknown" disabled>查看运行记录</button></details>
    <details class="evaluation-comparison"><summary>比较两次评测</summary><p>选择在本机查看过的两次已完成运行。比较只用于诊断，不代表知识晋级或发布通过。</p>
    <div class="evaluation-fields"><label>基准运行<select data-eval="baseline" aria-label="基准运行"></select></label><label>候选运行<select data-eval="candidate" aria-label="候选运行"></select></label></div>
    <button type="button" class="btn" data-eval="compare" disabled>比较结果</button><p data-eval="comparison-status" role="status" aria-live="polite"></p><div data-eval="comparison-report" class="evaluation-report"></div></details>
    <details class="evaluation-comparison"><summary>知识效果门槛</summary><p>用一次已登记的检索运行和上面选中的两次已完成评测，核对这条知识是否够格进入晋级流程。结论只作诊断，不代替人工授权。</p>
    <div class="evaluation-fields"><label>检索运行 ID<input data-eval="gate-run" aria-label="检索运行 ID" placeholder="knowledge_evaluation_run 的 id"></label></div>
    <button type="button" class="btn" data-eval="gate-assess" disabled>评估门槛结论</button><p data-eval="gate-status" role="status" aria-live="polite"></p><div data-eval="gate-report" class="evaluation-report"></div></details>`;
  const q = key => root.querySelector(`[data-eval="${key}"]`);
  let id = '', operation = '', active = false, unknown = false, stopped = false, serial = 0, timer;
  let completed = [], unresolved = [], comparing = false, assessing = false;
  function unresolvedOptions() {
    const selected = q('unknown-run').value;
    q('unknown-run').replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = '选择待核对运行'; q('unknown-run').append(empty);
    for (const runId of unresolved) { const option = document.createElement('option'); option.value = runId; option.textContent = runId; q('unknown-run').append(option); }
    q('unknown-run').value = unresolved.includes(selected) ? selected : '';
    q('unresolved').hidden = !unresolved.length;
  }
  function rememberUnknown() {
    unresolved = [...unresolved.filter(runId => runId !== id), id].slice(-20);
    try { storage?.setItem('craft-evaluation-unresolved', JSON.stringify(unresolved)); } catch { /* Server records remain intact when local storage is unavailable. */ }
    unresolvedOptions();
  }
  try { const saved = JSON.parse(storage?.getItem('craft-evaluation-unresolved') || '[]'); if (Array.isArray(saved)) unresolved = [...new Set(saved.filter(runId => typeof runId === 'string' && /^[a-f0-9]{64}$/.test(runId)))].slice(-20); } catch { /* Local history is optional. */ }
  unresolvedOptions();
  // The gate reuses the comparison selection: it needs the same two completed runs
  // plus the retrieval run the claim was measured against.
  const gateControls = () => { q('gate-assess').disabled = assessing || !q('gate-run').value.trim() || !q('baseline').value || !q('candidate').value || q('baseline').value === q('candidate').value; };
  const comparisonControls = () => { q('compare').disabled = comparing || !q('baseline').value || !q('candidate').value || q('baseline').value === q('candidate').value; gateControls(); };
  function comparisonOptions() {
    for (const key of ['baseline', 'candidate']) {
      const selected = q(key).value; q(key).replaceChildren();
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = '选择已完成运行'; q(key).append(empty);
      for (const run of completed) { const option = document.createElement('option'); option.value = run.id; option.textContent = run.title; q(key).append(option); }
      q(key).value = completed.some(run => run.id === selected) ? selected : '';
    }
    comparisonControls();
  }
  function rememberCompleted(record) {
    const run = { id, title: `${record.completed_at || record.updated_at || '已完成'} · ${id.slice(0, 10)}` };
    completed = [...completed.filter(item => item.id !== id), run].slice(-20);
    try { storage?.setItem('craft-evaluation-completed', JSON.stringify(completed)); } catch { /* Optional cache, never proof that a report is trusted. */ }
    comparisonOptions();
  }
  try {
    const saved = JSON.parse(storage?.getItem('craft-evaluation-completed') || '[]');
    if (Array.isArray(saved)) completed = saved.filter(item => item && /^[a-f0-9]{64}$/.test(item.id) && typeof item.title === 'string' && item.title.length <= 256).slice(-20);
  } catch { /* Ignore invalid or unavailable browser storage. */ }
  comparisonOptions();
  const contextAudit = mountContextAuditPanel(root, { api, invoke, storage, crypto });
  for (const key of ['baseline', 'candidate']) q(key).onchange = () => {
    q('comparison-report').replaceChildren(); q('comparison-status').textContent = ''; comparisonControls();
  };
  q('compare').onclick = async () => {
    if (q('compare').disabled || stopped) return;
    const body = { baseline_id: q('baseline').value, candidate_id: q('candidate').value };
    comparing = true; comparisonControls();
    for (const key of ['baseline', 'candidate']) q(key).disabled = true;
    q('comparison-report').replaceChildren(); q('comparison-status').textContent = '正在校验并比较两次运行…';
    try {
      const result = await api(`${BASE}/compare`, { method: 'POST', body });
      if (stopped) return;
      const metrics = result.comparison.metrics;
      q('comparison-status').textContent = metrics.status === 'comparable' ? `有效配对 ${metrics.measured_pairs} / ${metrics.expected_pairs} · 候选胜 ${metrics.candidate_wins} · 基准胜 ${metrics.baseline_wins} · 平局 ${metrics.ties}` : '证据不足，无法得出比较结论。';
      const details = document.createElement('details'), title = document.createElement('summary'), content = document.createElement('pre');
      title.textContent = '查看统计与护栏'; content.textContent = JSON.stringify(metrics, null, 2);
      details.append(title, content); q('comparison-report').append(details);
    } catch (error) { if (!stopped) q('comparison-status').textContent = '无法比较：' + (Object.hasOwn(comparisonErrors, error.message) ? comparisonErrors[error.message] : error.message); }
    finally { comparing = false; if (!stopped) { for (const key of ['baseline', 'candidate']) q(key).disabled = false; comparisonControls(); } }
  };
  // A changed retrieval run invalidates the last conclusion: the gate is bound to
  // one exact run, so leaving the old verdict on screen would misattribute it.
  q('gate-run').onchange = () => {
    if (stopped) return;
    q('gate-report').replaceChildren(); q('gate-status').textContent = ''; gateControls();
  };
  q('gate-assess').onclick = async () => {
    if (q('gate-assess').disabled || stopped) return;
    assessing = true; gateControls();
    q('gate-report').replaceChildren(); q('gate-status').textContent = '正在核对输入并评估…';
    try {
      const result = await api(`${BASE}/knowledge-assess`, { method: 'POST', body: {
        retrieval_run_id: q('gate-run').value.trim(), baseline_id: q('baseline').value, candidate_id: q('candidate').value } });
      if (stopped) return;
      const assessment = result.assessment || {};
      const reasons = Array.isArray(assessment.reasons) ? assessment.reasons : [];
      q('gate-status').textContent = assessment.status === 'eligible'
        ? '门槛通过：这条知识可以进入晋级流程，仍需人工授权。'
        : '门槛未通过：' + (reasons.length ? reasons.join('、') : '缺少可判定的证据');
      const details = document.createElement('details'), title = document.createElement('summary'), body = document.createElement('pre');
      title.textContent = '查看门槛依据'; body.textContent = JSON.stringify(assessment, null, 2);
      details.append(title, body); q('gate-report').append(details);
    } catch (error) { if (!stopped) q('gate-status').textContent = '无法评估：' + (Object.hasOwn(comparisonErrors, error.message) ? comparisonErrors[error.message] : error.message); }
    finally { assessing = false; if (!stopped) gateControls(); }
  };
  const live = ticket => !stopped && ticket === serial;
  const status = text => { q('status').textContent = text; };
  const remember = () => { try { if (id) storage?.setItem('craft-evaluation-id', id); else storage?.removeItem('craft-evaluation-id'); } catch { /* Storage is optional. */ } };
  function controls(busy) {
    q('start').disabled = busy || !!id;
    q('cancel').disabled = busy || !active || unknown;
    q('refresh').disabled = busy || !id;
    q('new').disabled = busy || active || !id;
    q('recovery').hidden = !unknown;
    q('confirmed').disabled = busy || !unknown;
    q('prepare').disabled = busy || !unknown || !q('confirmed').checked;
    q('unknown-run').disabled = busy || active;
    q('open-unknown').disabled = busy || active || !unresolved.includes(q('unknown-run').value);
    for (const key of ['workspace', 'suite', 'subject', 'runtime']) {
      q(key).disabled = busy || !!id;
      root.querySelector(`[data-pick="${key}"]`).disabled = q(key).disabled;
    }
  }
  function reportView(report) {
    const view = q('report'); view.replaceChildren();
    const summary = document.createElement('p');
    summary.textContent = `通过 ${report.passed} · 失败 ${report.failed} · 未判定 ${report.inconclusive} · 缺失 ${report.missing} · 无效 ${report.invalid}`;
    view.append(summary);
    for (const item of (report.results || []).slice(0, 100)) {
      const row = document.createElement('details'), title = document.createElement('summary'), body = document.createElement('pre');
      title.textContent = `${item.case_id} · ${item.verdict}`;
      body.textContent = JSON.stringify({ issue: item.issue, workspace_snapshot: item.workspace_snapshot, host: item.host, checks: item.checks, safety_checks: item.safety_checks }, null, 2);
      row.append(title, body); view.append(row);
    }
    if ((report.results || []).length > 100) { const note = document.createElement('p'); note.textContent = '页面显示前 100 项，完整结果保存在本次运行目录。'; view.append(note); }
  }
  async function refresh() {
    if (!id || stopped) return;
    clearTimeout(timer);
    const ticket = ++serial;
    unknown = false; q('confirmed').checked = false; controls(true);
    let terminal = false;
    try {
      const data = await api(`${BASE}/${encodeURIComponent(id)}/events`);
      if (!live(ticket)) return;
      const record = data.evaluation;
      terminal = ["completed", "failed", "cancelled"].includes(record.state);
      if (typeof record.workspace === 'string') q('workspace').value = record.workspace;
      if (Array.isArray(record.input_paths)) ['suite', 'subject', 'runtime'].forEach((key, index) => { if (typeof record.input_paths[index] === 'string') q(key).value = record.input_paths[index]; });
      active = ['starting', 'running', 'cancelling', 'unknown'].includes(record.state);
      unknown = record.state === 'unknown';
      if (unknown) { q('identity').textContent = `运行标识：${id}\n输出目录：${typeof record.report_root === 'string' ? record.report_root : '服务未提供，请先检查运行环境'}`; rememberUnknown(); }
      status((labels[record.state] || '未知状态') + (record.error ? '：' + record.error : ''));
      // Which evaluator produced this, and which run it was: a conclusion that
      // cannot be attributed to a version cannot be compared later.
      q('provenance').textContent = `运行 ${id.slice(0, 10)} · 评测器 ${
        typeof record.evaluator_version === 'string' && record.evaluator_version ? record.evaluator_version : '未记录'}`;
      q('progress').textContent = (data.events || []).map(event => `${event.case_id} · ${event.verdict}`).join('\n');
      controls(false);
      if (active && record.state !== 'unknown') timer = clock.setTimeout(() => { void refresh(); }, 600);
      else if (record.state === 'completed' || record.run_directory) {
        const result = await api(`${BASE}/${encodeURIComponent(id)}/report`);
        if (live(ticket)) { reportView(result.report); if (record.state === 'completed') rememberCompleted(record); }
      }
    } catch (error) { if (live(ticket)) { unknown = false; q('confirmed').checked = false; if (error.status === 404) { id = ''; active = false; remember(); status('未找到本次运行，请检查配置后重新提交。'); } else { active = !terminal; status((terminal ? '报告读取未确认：' : '读取未确认，请核对运行：') + error.message); } controls(false); } }
  }
  q('start').onclick = async () => {
    if (q('start').disabled) return;
    const body = Object.fromEntries(['workspace', 'suite', 'subject', 'runtime'].map(key => [key, q(key).value.trim()]));
    const missing = Object.keys(body).find(key => !body[key]);
    if (missing) { status('请先填写或选择所有路径。'); q(missing).focus(); return; }
    controls(true);
    try {
      operation = crypto.randomUUID();
      id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(operation))), byte => byte.toString(16).padStart(2, '0')).join('');
      if (stopped) return;
      remember(); active = true;
      await api(BASE, { method: 'POST', body: { ...body, operation_id: operation } });
      if (!stopped) await refresh();
    } catch (error) { if (!stopped) { active = !!id; status('提交未确认，请核对运行：' + error.message); controls(false); } }
  };
  q('cancel').onclick = async () => {
    if (q('cancel').disabled) return;
    controls(true);
    try { await api(`${BASE}/${id}/cancel`, { method: 'POST', body: {} }); if (!stopped) await refresh(); }
    catch (error) { if (!stopped) { status('取消未确认，请核对运行：' + error.message); controls(false); } }
  };
  q('refresh').onclick = () => { void refresh(); };
  function prepareDraft(message) {
    ++serial; clearTimeout(timer); id = ''; operation = ''; active = false; unknown = false; q('confirmed').checked = false; remember();
    q('progress').textContent = ''; q('report').replaceChildren(); q('provenance').textContent = ''; status(message); controls(false); q('workspace').focus();
  }
  q('new').onclick = () => { if (!q('new').disabled && !stopped) prepareDraft('选择配置后开始下一次评测。'); };
  q('confirmed').onchange = () => { if (!stopped) controls(false); };
  q('prepare').onclick = () => { if (!q('prepare').disabled && !stopped) prepareDraft('原运行结果保持未知，记录已保留。新提交会创建独立运行。'); };
  q('unknown-run').onchange = () => { if (!stopped) controls(false); };
  q('open-unknown').onclick = async () => {
    if (q('open-unknown').disabled || stopped) return;
    id = q('unknown-run').value; operation = ''; active = true; remember();
    q('progress').textContent = ''; q('report').replaceChildren(); await refresh();
  };
  for (const key of ['workspace', 'suite', 'subject', 'runtime']) {
    const button = root.querySelector(`[data-pick="${key}"]`);
    button.hidden = !invoke;
    button.onclick = async () => {
      if (button.disabled || stopped) return;
      try { const selected = await invoke(key === 'workspace' ? 'choose_project_folder' : 'choose_reference_files'); if (!stopped && !q(key).disabled && selected) q(key).value = Array.isArray(selected) ? selected[0] || q(key).value : selected; }
      catch (error) { if (!stopped) status('无法选择：' + error.message); }
    };
  }
  try { id = storage?.getItem('craft-evaluation-id') || ''; } catch { /* Private mode can disable storage. */ }
  if (id && /^[a-f0-9]{64}$/.test(id)) { active = true; controls(false); void refresh(); }
  else { id = ''; controls(false); }
  return { refresh, destroy() { stopped = true; ++serial; clearTimeout(timer); contextAudit.destroy(); } };
}
