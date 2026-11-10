function displayValue(value) {
  if (value === undefined) return '（不存在）';
  const rendered = JSON.stringify(value);
  return rendered === undefined ? String(value) : rendered;
}

function classificationLabel(classification) {
  if (classification === 'applied') return '已接受';
  if (classification === 'auto_apply') return '可接受';
  return '需要复核';
}

/** Render version-aware ChangeSet detail. Values are escaped by the host Workbench. */
export function renderChangeSetDetail(detail, esc) {
  const escape = typeof esc === 'function' ? esc : value => String(value);
  const changeSet = detail && detail.change_set && typeof detail.change_set === 'object' ? detail.change_set : {};
  const patches = detail && Array.isArray(detail.patches) ? detail.patches : [];
  const stateRevision = Number.isSafeInteger(detail && detail.state_revision) ? detail.state_revision : null;
  const summary = changeSet.summary || changeSet.id || '变更集';
  const version = Number.isSafeInteger(changeSet.version) ? 'v' + changeSet.version : '版本未知';
  const rows = patches.length ? patches.map(patch => {
    if (!patch || typeof patch !== 'object') return '<div class="row"><span class="row-sub">无补丁内容</span></div>';
    const classification = String(patch.classification || 'unknown');
    const selectable = classification === 'auto_apply' && Number.isSafeInteger(patch.patch_index) && patch.patch_index >= 0;
    const patchIndex = Number.isSafeInteger(patch.patch_index) ? String(patch.patch_index) : '';
    const operation = patch.op === 'remove' ? '删除' : '设为';
    const suggested = patch.op === 'remove' ? '删除' : displayValue(patch.value);
    const baseVersion = Number.isSafeInteger(patch.base_version) ? 'v' + patch.base_version : '未知';
    const currentVersion = Number.isSafeInteger(patch.current_version) ? 'v' + patch.current_version : '未知';
    return '<label class="row"><input type="checkbox" data-patch-index="' + escape(patchIndex) + '"' + (selectable ? '' : ' disabled') + '>' +
      '<span class="row-main"><span class="row-title">' + escape(patch.object_id || '成果') + ' · ' + escape(patch.path || '未知字段') + '</span>' +
      '<span class="row-sub">' + escape(operation) + ' · ' + escape(classificationLabel(classification)) + '</span>' +
      '<span class="row-sub">基线 ' + escape(baseVersion) + '：' + escape(displayValue(patch.base_value)) + '</span>' +
      '<span class="row-sub">当前 ' + escape(currentVersion) + '：' + escape(displayValue(patch.current_value)) + '</span>' +
      '<span class="row-sub">建议值：' + escape(suggested) + '</span></span></label>';
  }).join('') : '<div class="row"><span class="row-sub">没有补丁内容</span></div>';
  return '<div class="stack"><button class="btn sm" type="button" data-changes-back>返回变更集</button>' +
    '<strong>' + escape(summary) + ' · 变更集 ' + escape(version) + '</strong>' +
    '<span class="row-sub">' + escape(changeSet.id || '') + ' · ' +
    escape(stateRevision === null ? '当前工作区版本未知' : '当前工作区版本 ' + stateRevision) + '</span>' + rows +
    '<button class="btn primary" type="button" data-apply-changes>接受所选变更</button></div>';
}
