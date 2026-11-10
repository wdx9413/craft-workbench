export function renderReviewVerifications(detail, ui) {
  const rows = (detail.work_reviews || []).filter(candidate => candidate.verification_configuration).map(candidate => {
    const config = candidate.verification_configuration, job = candidate.verification;
    const owner = detail.task_assignment;
    const independent = candidate.actor !== ui.operatorOf() && !(owner?.status === 'active' && owner.owner === ui.operatorOf());
    const id = job ? job.id : candidate.id, version = job ? job.version : candidate.version;
    const button = (action, title) => '<button class="btn sm" data-frozen-verification="' + ui.esc(id) + '" data-verification-action="' + action + '" data-verification-version="' + ui.esc(String(version)) + '">' + title + '</button>';
    let actions = '';
    if (independent && (!job || job.status === 'prepared')) actions = button(job ? 'execute' : 'prepare', '核对命令并复验冻结副本');
    if (job && ['staging', 'running', 'stopping', 'unknown'].includes(job.status)) actions = button('stop', '停止并确认复验容器清理');
    const status = !job ? '等待独立复验' : job.current === false && job.status === 'completed' ? '回执已失效，须重新冻结复验' : job.status === 'completed' ? (job.result === 'passed' ? '检查通过' : job.result === 'failed' ? '检查失败' : '检查阻塞') : ({ prepared: '已准备待确认', staging: '正在准备副本', running: '检查中', stopping: '正在停止', unknown: '结果或清理未知', cancelled: '已停止，须冻结新候选后复验' }[job.status] || job.status);
    return '<div class="row"><div class="row-main"><span class="row-title">' + ui.esc(candidate.id) + ' · ' + ui.esc(status) + '</span>' + (job?.basis ? '<p>' + (job.basis === 'simulated_container' ? '模拟容器回执' : 'Docker 容器回执') + '</p>' : '') + '<details><summary>核对固定镜像、命令和资源合同</summary><p class="mono">' + ui.esc(config.image) + '</p><pre>' + ui.esc(JSON.stringify(config.argv)) + '</pre><p>' + ui.esc(config.profile_id) + ' @ ' + ui.esc(String(config.profile_version)) + (config.allow_simulated ? ' · 合同允许模拟' : ' · 合同要求实际执行') + '</p></details>' + (job?.cleanup?.confirmation_basis === 'operator_declaration' ? '<p>停止依据含操作者声明</p>' : '') + (job?.evidence_ids || []).map(id => '<p class="mono">证据 ' + ui.esc(id) + '</p>').join('') + '</div>' + actions + '</div>';
  }).join('');
  return rows ? ui.taskCard('冻结副本复验', '仅使用冻结字节；程序检查不替代独立审查，未知清理须先处理', rows) : '';
}
export function mountReviewVerifications(root, ui) {
  root.querySelectorAll('[data-frozen-verification]').forEach(button => {
    let prepared;
    button.onclick = async () => {
      const action = button.getAttribute('data-verification-action');
      if (!ui.confirm(action === 'stop' ? '请求停止并核对容器残留。在途操作会继续等待；若控制进程已丢失或结果未知，此操作同时声明你已核对旧检查执行彻底停止。不能确认时请取消。' : '确认已核对卡片中的固定镜像、完整命令与资源合同，并运行冻结副本检查？')) return;
      button.disabled = true;
      try {
        const id = button.getAttribute('data-frozen-verification'), version = Number(button.getAttribute('data-verification-version'));
        if (action === 'prepare' && !prepared) prepared = (await ui.api('/api/work-reviews/' + encodeURIComponent(id) + '/verify-prepare', { method: 'POST', body: { candidate_version: version, actor: ui.operatorOf() } })).verification;
        const target = prepared || { id, version };
        await ui.api('/api/review-verifications/' + encodeURIComponent(target.id) + (action === 'stop' ? '/stop' : '/execute'), { method: 'POST', body: { verification_version: target.version, actor: ui.operatorOf(), ...(action === 'stop' ? { confirmed_execution_stopped: true } : { confirmed_command: true }) } });
        ui.toast('复验状态已记录，请以当前检查与清理结果为准'); ui.refresh();
      } catch (error) { button.disabled = false; ui.toast('复验操作失败，可重试同一请求或刷新读取：' + (error?.message || String(error)), true); }
    };
  });
}
