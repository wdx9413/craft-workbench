const APPROVAL_ACTION = 'review_work_launch';

function payloadOf(extra) {
  if (!extra || typeof extra !== 'object') return null;
  const { task_id, task_run_id, launch_id } = extra;
  const launch_version = Number(extra.launch_version), task_run_version = Number(extra.task_run_version);
  const decision_version = Number(extra.decision_version);
  if (![task_id, task_run_id, launch_id].every(value => typeof value === 'string' && value.length > 0) ||
      ![launch_version, task_run_version, decision_version].every(Number.isSafeInteger)) return null;
  return { task_id, task_run_id, launch_id, launch_version, task_run_version, decision_version };
}

function currentApproval(detail, payload) {
  return (detail?.pending_work_launches || []).find(item => item.launch_id === payload.launch_id &&
    item.task_id === payload.task_id && item.task_run_id === payload.task_run_id &&
    item.status === 'awaiting_approval' && Number(item.launch_version) === payload.launch_version &&
    Number(item.task_run_version) === payload.task_run_version &&
    Number(item.launch_version) === payload.decision_version);
}

export function handleApprovalNotificationAction(event, ui) {
  const actionId = event?.actionId;
  const payload = payloadOf(event?.notification?.extra);
  if (actionId !== 'tap' || !payload) return Promise.resolve(false);
  return ui.api('/api/tasks/' + encodeURIComponent(payload.task_id)).then(detail => {
    const current = currentApproval(detail, payload);
    ui.openTask(payload.task_id);
    if (!current) ui.toast('这条审批通知已过期。任务已打开，请刷新后查看当前决定。', true);
    return Boolean(current);
  }).catch(error => {
    ui.openTask(payload.task_id);
    ui.toast('无法核对审批状态，请刷新任务后再决定：' + (error?.message || String(error)), true);
    return false;
  });
}

export function startApprovalNotifications(ui) {
  const api = ui.host?.__TAURI__?.notification;
  if (!api?.sendNotification || !api?.onAction) return () => {};
  const seen = ui.storage;
  let stopped = false;
  const listener = api.onAction(event => { void handleApprovalNotificationAction(event, ui); });
  const refresh = () => ui.api('/api/inbox/refresh', { method: 'POST', body: {} }).then(async inbox => {
    for (const card of inbox.cards || []) {
      if (stopped || card.action !== APPROVAL_ACTION || card.source_kind !== 'work_launch' || !card.task_id) continue;
      const detail = await ui.api('/api/tasks/' + encodeURIComponent(card.task_id));
      const pending = (detail.pending_work_launches || []).find(item => item.launch_id === card.source_id);
      if (!pending || Number(card.source_version) !== Number(pending.launch_version)) continue;
      const payload = { task_id: pending.task_id, task_run_id: pending.task_run_id, launch_id: pending.launch_id,
        launch_version: Number(pending.launch_version), task_run_version: Number(pending.task_run_version),
        decision_version: Number(card.source_version) };
      const key = 'craft.approval-notification:' + pending.launch_id + ':' + payload.decision_version;
      if (seen?.getItem(key)) continue;
      api.sendNotification({ title: 'Craft 有一项待批准任务', body: '打开任务查看详情并决定是否继续。', extra: payload });
      seen?.setItem(key, 'sent');
    }
  }).catch(() => {});
  void refresh();
  const timer = ui.setInterval(refresh, 30000);
  return () => { stopped = true; ui.clearInterval(timer); void Promise.resolve(listener).then(unlisten => unlisten?.()); };
}
