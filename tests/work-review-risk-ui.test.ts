import assert from 'node:assert/strict';
import test from 'node:test';
import { renderTaskReviewRisk } from '../workbench/work-review-risk-ui.js';
test('risk card explains fixed rules and source versions while keeping ungoverned tasks compact', () => {
  const ui = { esc: (value: unknown) => String(value).replaceAll('<', '&lt;'), taskCard: (...args: string[]) => args.join('|') };
  assert.equal(renderTaskReviewRisk({}, ui), '');
  assert.equal(renderTaskReviewRisk({ task_runs: [{ id: 'legacy' }] }, ui), '');
  const html = renderTaskReviewRisk({ task_runs: [{ id: '<run>', review_risk: { risks: ['data_migration', 'permission_change', 'cross_project_write', 'extension_boundary', 'asset_promotion', 'external_write', 'future_rule'], policy_version: 1, criterion_id: 'risk_independent_review', rule_ids: ['independent_review:data_migration'], input_refs: [{ id: '<contract>', version: 2 }] } }] }, ui);
  for (const label of ['必须独立审查', '权限变更', '数据迁移', '跨项目写入', '扩展执行边界', '资产晋升', '外部写入权限', 'future_rule', 'risk_independent_review', '&lt;run>', '&lt;contract> @ 2', 'independent_review:data_migration']) assert.ok(html.includes(label), label);
});
