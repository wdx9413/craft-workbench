/** Render the latest task artifact identity so a reopened task can be checked against its file. */
export function renderTaskArtifactRows(artifacts, { lead, esc, label, emptyState, receiptName, artifactKindLabels }) {
  if (!Array.isArray(artifacts) || !artifacts.length) {
    return emptyState('还没有产物', '任务产生的文件、报告和代码改动都会列在这里', 'layers');
  }
  return artifacts.map(function (item) {
    const version = Number.isSafeInteger(item && item.version) ? ' · 版本 v' + item.version : '';
    const digest = typeof (item && item.digest) === 'string' && item.digest ? ' · 摘要 ' + item.digest : '';
    return '<div class="row">' + lead('layers', 'accent') +
      '<div class="row-main"><span class="row-title">' +
      esc(item.kind === 'route_receipt' && typeof receiptName === 'function' ? receiptName(item.name) : (item.name || item.id)) + '</span>' +
      (item.uri ? '<span class="row-sub mono">' + esc(item.uri) + '</span>' : '') +
      (version || digest ? '<span class="row-sub mono">' + esc((version + digest).replace(/^ · /u, '')) + '</span>' : '') + '</div>' +
      '<span class="row-time">' + esc(label(artifactKindLabels, item.kind, item.kind)) + '</span></div>';
  }).join('');
}
