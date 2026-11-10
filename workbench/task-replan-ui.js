const STATES = new Set(['attempt_budget_exhausted', 'rework_limit', 'recovery', 'blocked', 'needs_replan']);
const LABELS = { pending: '待决定', approved: '已批准待执行', consumed: '已创建新尝试', rejected: '已拒绝', revoked: '已撤销' };
export function renderTaskReplans(detail, ui) {
  const { esc, taskCard, operatorOf } = ui;
  const runs = detail.task_runs || [], retries = detail.task_retries || [], proposals = detail.task_replans || [];
  const owner = detail.task_assignment;
  const mine = !owner || owner.status !== 'active' || owner.owner === operatorOf();
  const handoffs = (detail.task_handoffs || []).filter(h => mine && STATES.has(h.state_status) && h.launch_ref && h.task_ref && runs.some(r => r.id === h.task_run_id && r.version === h.task_run_version && r.execution_root_active !== false) && !retries.some(r => r.task_run_id === h.task_run_id));
  const seen = new Set();
  const sources = handoffs.filter(h => { if (seen.has(h.launch_ref.id)) return false; seen.add(h.launch_ref.id); return true; }).map(h => '<button class="btn sm" data-propose-replan="' + esc(h.launch_ref.id) + '" data-task-version="' + esc(String(h.task_ref.version)) + '" data-launch-version="' + esc(String(h.launch_ref.version)) + '" data-host-version="' + esc(String(h.host_run_ref ? h.host_run_ref.version : '')) + '">以计划变更申请重新规划</button>').join('');
  const rows = proposals.map(p => {
    const button = (decision, title) => '<button class="btn sm" data-decide-replan="' + esc(p.id) + '" data-proposal-version="' + esc(String(p.version)) + '" data-replan-decision="' + decision + '">' + title + '</button>';
    let buttons = '';
    if (mine && p.status === 'pending') buttons = button('approve', '核对并批准新计划') + button('reject', '拒绝');
    if (mine && p.status === 'approved') buttons = '<button class="btn sm" data-execute-replan="' + esc(p.id) + '" data-proposal-version="' + esc(String(p.version)) + '">按获批计划创建新尝试</button>' + button('revoke', '撤销未消费的批准');
    return '<div class="row"><div class="row-main"><span class="row-title">' + esc(p.id) + ' · ' + esc(LABELS[p.status] || p.status) + '</span><p>' + esc(p.change_summary) + '</p><span class="row-sub">新总时限 ' + esc(p.total_timeout_ms === null ? '未设置' : String(p.total_timeout_ms) + ' 毫秒') + ' · 新美元额度 ' + esc(p.total_budget_usd === null ? '未设置' : String(p.total_budget_usd)) + ' · 申请到期 ' + esc(p.expires_at) + '</span><details><summary>核对完整执行指令与证据</summary><pre>' + esc(p.instruction) + '</pre>' + (p.evidence_refs || []).map(ref => '<p class="mono">' + esc(ref.id) + ' @ ' + esc(String(ref.version)) + '</p>').join('') + '</details>' + (p.status === 'consumed' ? '<span class="row-sub">新尝试 ' + esc(p.new_task_run_id) + '</span>' : '') + '</div>' + buttons + '</div>';
  }).join('');
  return sources || rows ? taskCard('重新规划', '批准不覆盖旧账单，也不代替写入审批；计划变更说明是人工证据', sources + rows) : '';
}
export function mountTaskReplans(root, ui) {
  const { api, operatorOf, toast, refresh, prompt, confirm, uuid } = ui;
  const submit = (button, url, body, success) => {
    button.disabled = true;
    return api(url, { method: 'POST', body }).then(() => { toast(success); refresh(); }).catch(error => { button.disabled = false; toast('操作失败，可重试同一请求；状态变化时请刷新：' + (error?.message || String(error)), true); });
  };
  root.querySelectorAll('[data-propose-replan]').forEach(button => {
    let request;
    button.onclick = () => {
      if (!request) {
        const summary = prompt('说明计划具体改变了什么。此说明作为人工变更证据，不代表系统已验证环境修复。');
        if (!summary || !summary.trim()) return;
        const instruction = prompt('填写完整新计划执行指令，批准前会展示供核对');
        if (!instruction || !instruction.trim()) return;
        const seconds = prompt('新计划总时限（秒；留空沿用原总时限）'); if (seconds === null) return;
        const usd = prompt('新计划美元总额（留空沿用原额度；仅内部 Host 支持）'); if (usd === null) return;
        if ((seconds.trim() && (!Number.isFinite(Number(seconds)) || Number(seconds) < 1 || Number(seconds) > 86400 || !Number.isInteger(Number(seconds) * 1000))) || (usd.trim() && (!Number.isFinite(Number(usd)) || Number(usd) <= 0))) { toast('请填写有效时限与正美元额度', true); return; }
        request = { proposal_id: 'replan_' + uuid(), new_task_run_id: 'replanned_' + uuid(), source_launch_id: button.getAttribute('data-propose-replan'), task_version: Number(button.getAttribute('data-task-version')), launch_version: Number(button.getAttribute('data-launch-version')), host_run_version: button.getAttribute('data-host-version') ? Number(button.getAttribute('data-host-version')) : null, actor: operatorOf(), change_type: 'plan_change', change_summary: summary.trim(), prompt: instruction.trim() };
        if (seconds.trim()) request.total_timeout_ms = Number(seconds) * 1000;
        if (usd.trim()) request.total_budget_usd = Number(usd);
      }
      return submit(button, '/api/task-replans/prepare', request, '申请已保存，尚未批准或派发');
    };
  });
  root.querySelectorAll('[data-decide-replan]').forEach(button => {
    button.onclick = () => {
      const decision = button.getAttribute('data-replan-decision');
      if (!confirm(decision === 'approve' ? '确认已核对完整指令、证据和新预算？批准不修改旧账单，也不代替写入授权。' : '确认拒绝或撤销这份未消费的计划批准？')) return;
      return submit(button, '/api/task-replans/' + encodeURIComponent(button.getAttribute('data-decide-replan')) + '/decide', { proposal_version: Number(button.getAttribute('data-proposal-version')), actor: operatorOf(), decision, confirmed_new_plan_and_budget: decision === 'approve' }, '计划决定已记录，尚未启动执行');
    };
  });
  root.querySelectorAll('[data-execute-replan]').forEach(button => {
    button.onclick = () => submit(button, '/api/task-replans/' + encodeURIComponent(button.getAttribute('data-execute-replan')) + '/execute', { proposal_version: Number(button.getAttribute('data-proposal-version')), actor: operatorOf() }, '已创建获批的新尝试；写入仍须另行批准');
  });
}
