const LABELS = { permission_change: '权限变更', data_migration: '数据迁移', cross_project_write: '跨项目写入', extension_boundary: '扩展执行边界', asset_promotion: '资产晋升', external_write: '外部写入权限' };
export function renderTaskReviewRisk(detail, ui) {
  const rows = (detail.task_runs || []).filter(run => run.review_risk).map(run => {
    const risk = run.review_risk;
    return '<div class="row"><div class="row-main"><span class="row-title">' + ui.esc(run.id) + ' · 必须独立审查</span><p>' + ui.esc(risk.risks.map(value => LABELS[value] || value).join('、')) + '</p><span class="row-sub">策略版本 ' + ui.esc(String(risk.policy_version)) + ' · 审查条件 ' + ui.esc(risk.criterion_id) + '</span><details><summary>查看命中规则与输入版本</summary>' + risk.rule_ids.map(id => '<p class="mono">' + ui.esc(id) + '</p>').join('') + risk.input_refs.map(ref => '<p class="mono">' + ui.esc(ref.id) + ' @ ' + ui.esc(String(ref.version)) + '</p>').join('') + '</details></div></div>';
  }).join('');
  return rows ? ui.taskCard('风险与验收约定', '依据事前合同声明与权限；必须冻结成果、由独立审查者检查，并通过程序验收', rows) : '';
}
