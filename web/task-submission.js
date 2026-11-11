export async function submitTaskAttempt({ composer, body, prompt, crypto, api }) {
  if (composer.submitting) return { ignored: true };
  var fingerprint = JSON.stringify({ body: body, prompt: prompt });
  if (composer.submission && composer.submission.fingerprint !== fingerprint) {
    if (composer.submission.uncertain) return { outcome_unknown: true, task_id: composer.submission.taskId,
      message: '上一条提交结果仍不确定，草稿已更改。请先核对原任务记录；确认前不能重新发送。' };
    composer.submission = null;
  }
  if (!composer.submission) {
    if (!crypto || typeof crypto.randomUUID !== 'function') throw new Error('当前环境无法生成安全的提交编号，请更新工作台');
    var attempt = crypto.randomUUID().replace(/-/g, '');
    composer.submission = { fingerprint: fingerprint, taskId: 'task_' + attempt,
      messageId: 'task_message_' + crypto.randomUUID().replace(/-/g, '') };
  }
  body.task_id = composer.submission.taskId;
  var messageId = composer.submission.messageId;
  composer.submitting = true;
  try {
    var created = await api('/api/tasks', { method: 'POST', body: body });
    var task = created.task || {};
    if (!task.id) throw new Error('任务创建未返回任务编号');
    var result = await api('/api/tasks/' + encodeURIComponent(task.id) + '/messages', { method: 'POST', body: { content: prompt, message_id: messageId } });
    composer.submitting = false;
    if (result && result.outcome_unknown === true) {
      composer.submission.uncertain = true;
      return { outcome_unknown: true, task_id: task.id,
        message: '这条消息已记录，但模型回复状态不确定。请先核对任务记录，Workbench 不会重复发送。' };
    }
    composer.submission = null;
    return { task: task };
  } catch {
    composer.submitting = false;
    composer.submission.uncertain = true;
    return { outcome_unknown: true, task_id: composer.submission.taskId,
      message: '提交结果暂时无法确认。请先核对原任务记录；Workbench 会保留原提交编号，避免重复创建。' };
  }
}
