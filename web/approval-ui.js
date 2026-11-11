export function approvalIsCurrent(state, taskId, root, button) {
  return state.page === 'task' && state.selectedTask === taskId && root.contains(button);
}

export function renderPendingApprovals(detail, ui) {
  const pending = (detail?.pending_work_launches || []).filter(item => item.status === 'awaiting_approval');
  if (!pending.length) return '';
  const { esc, taskCard } = ui;
  const rows = pending.map(item => '<div class="row" data-pending-approval="' + esc(item.launch_id) + '">' +
    '<div class="row-main"><span class="row-title">写入操作等待批准</span><span class="row-sub">任务运行 ' +
    esc(item.task_run_id) + ' · 审批版本 ' + esc(String(item.launch_version)) +
    '</span></div>' +
    '<button type="button" class="btn sm primary" data-approval-decision="approve" data-launch-id="' + esc(item.launch_id) +
    '" data-task-run-id="' + esc(item.task_run_id) + '" data-launch-version="' + esc(String(item.launch_version)) +
    '" data-task-run-version="' + esc(String(item.task_run_version)) + '">核对并批准</button>' +
    '<button type="button" class="btn sm" data-approval-decision="deny" data-launch-id="' + esc(item.launch_id) +
    '" data-task-run-id="' + esc(item.task_run_id) + '" data-launch-version="' + esc(String(item.launch_version)) +
    '" data-task-run-version="' + esc(String(item.task_run_version)) + '">拒绝</button></div>').join('');
  return taskCard('待批准的执行', '通知只用于返回此任务；决定时会再次检查任务与执行版本。', rows);
}

export function mountPendingApprovals(root, taskId, ui) {
  const { api, operatorOf, toast, refresh, isCurrent } = ui;
  const buttons = root.querySelectorAll('[data-approval-decision]');
  buttons.forEach(button => {
    button.onclick = () => {
      const approved = button.getAttribute('data-approval-decision') === 'approve';
      buttons.forEach(item => { if (item.closest('[data-pending-approval]') === button.closest('[data-pending-approval]')) item.disabled = true; });
      return api('/api/work-launches/' + encodeURIComponent(button.getAttribute('data-launch-id')) + '/decide', { method: 'POST', body: {
        task_id: taskId, task_run_id: button.getAttribute('data-task-run-id'),
        launch_version: Number(button.getAttribute('data-launch-version')),
        task_run_version: Number(button.getAttribute('data-task-run-version')),
        actor: operatorOf(), approved
      } }).then(() => { if (!isCurrent(button)) return; toast(approved ? '已批准，执行已开始' : '已拒绝这次执行'); refresh(); })
        .catch(error => { if (!isCurrent(button)) return; toast('审批结果未知，请先核对任务和运行状态，确认原请求已结束后再操作：' + (error?.message || String(error)), true); });
    };
  });
}
