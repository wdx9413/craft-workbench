/**
 * Recall audit for any context member: which receipts pulled this asset into
 * context, and how each was judged. Lazily expanded per asset so a long history
 * never blocks paint. Shared by the memory, knowledge and experience pages.
 */
export function bindRecallAudit(root, { api, attribute, member }) {
  root.querySelectorAll('[' + attribute + ']').forEach(function (button) {
    if (!button.dataset) { if (button.onclick) return; }
    else { if (button.dataset.auditBound === '1') return; button.dataset.auditBound = '1'; }
    button.onclick = function () {
      var box = button.parentElement && button.parentElement.querySelector('[data-recall-audit-list]');
      if (!box) return;
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false;
      box.textContent = '正在读取召回记录…';
      api('/api/workbench/experience/recall-receipts?limit=10&member=' + encodeURIComponent(member) +
        '&asset_id=' + encodeURIComponent(button.getAttribute(attribute)))
        .then(function (result) {
          var rows = (result.receipts || []).map(function (receipt) {
            var verdict = (receipt.feedback || []).map(function (entry) { return String(entry.outcome || '未标注'); }).join('、') || '未标注';
            return '回执 ' + String(receipt.id) + ' · ' + verdict;
          });
          box.textContent = rows.length ? rows.join('\n') : '这条资产还没有召回记录。';
        })
        .catch(function (error) { box.textContent = '读取失败：' + String(error && error.message ? error.message : error); });
    };
  });
}

/**
 * Weight trend for any context member: the running weight after each counted
 * feedback event, so "it gets better with use" is measurable rather than a
 * claim. Same formula the recall path ranks with.
 */
function escapeText(value) {
  return String(value ?? '').replace(/[&<>"]/gu, function (character) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character];
  });
}

/** Inline SVG line so the trend is visible without pulling in a chart library. */
/**
 * A weight curve is a step function: it only changes when an event counts, so
 * collapsing equal neighbours preserves the shape exactly while keeping the
 * polyline sparse. A hard cap samples evenly if every event changed the value.
 */
function compressCurve(values, max) {
  var collapsed = [];
  for (var index = 0; index < values.length; index += 1) {
    if (!collapsed.length || Math.abs(collapsed[collapsed.length - 1] - values[index]) > 1e-9) collapsed.push(values[index]);
  }
  if (!collapsed.length && values.length) collapsed.push(values[values.length - 1]);
  if (collapsed.length <= max) return collapsed;
  var sampled = [];
  for (var slot = 0; slot < max; slot += 1) {
    sampled.push(collapsed[Math.round(slot * (collapsed.length - 1) / (max - 1))]);
  }
  return sampled;
}

function sparkline(values) {
  if (values.length < 2) return '';
  var width = 240, height = 48, pad = 4;
  var min = Math.min.apply(null, values.concat([1]));
  var max = Math.max.apply(null, values.concat([1]));
  if (max - min < 1e-9) { min -= 0.1; max += 0.1; }
  var coordinates = values.map(function (value, index) {
    var x = pad + (width - pad * 2) * (index / (values.length - 1));
    var y = height - pad - (height - pad * 2) * ((value - min) / (max - min));
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="权重趋势">' +
    '<polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="' +
    coordinates + '"/></svg>';
}

export function bindWeightTrend(root, { api, attribute, member }) {
  root.querySelectorAll('[' + attribute + ']').forEach(function (button) {
    if (!button.dataset) { if (button.onclick) return; }
    else { if (button.dataset.trendBound === '1') return; button.dataset.trendBound = '1'; }
    button.onclick = function () {
      var box = button.parentElement && button.parentElement.querySelector('[data-weight-trend-list]');
      if (!box) return;
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false;
      box.textContent = '正在读取权重趋势…';
      api('/api/workbench/experience/feedback-history?limit=50&member=' + encodeURIComponent(member) +
        '&asset_id=' + encodeURIComponent(button.getAttribute(attribute)))
        .then(function (result) {
          var raw = (result.points || []).map(function (point) { return Number(point.weight); }).filter(Number.isFinite);
          var points = raw.map(function (value) { return value.toFixed(2); });
          var counts = result.counts || {};
          var head = ['当前权重 ' + Number(result.current_weight ?? 1).toFixed(2),
            points.length ? points.join(' → ') : '还没有计入权重的事件。',
            '计入：有用 ' + Number(counts.positive || 0) + ' 条 · 纠错 ' + Number(counts.negative || 0) +
              ' 条 · 已驳回纠错 ' + Number(counts.dismissed || 0) + ' 条'];
          // An empty curve is not a dead end: say exactly how the first counted
          // event is produced, so the feature teaches its own governance rule.
          if (!points.length) head.push('怎么产生第一条：任务召回该资产后点“召回有用”（需同回执的程序证据）；纠错需经复核确认才计入。');
          var events = (result.timeline || []).map(function (event) {
            // A correction line names who settled it and why, so the curve reads
            // as a chain of accountable decisions rather than an unexplained drop.
            var settled = event.status === 'pending_review' ? ' · 待复核'
              : (event.decided_by ? ' · 由 ' + String(event.decided_by) + ' ' : ' · ')
                + (event.status === 'confirmed' ? '确认' : event.status === 'dismissed' ? '驳回' : String(event.status || '已处理'))
                + (event.resolution_reason ? '：' + String(event.resolution_reason) : '');
            return String(event.at || '时间未知') + ' · ' + String(event.kind || 'unknown') +
              ' · ' + (event.counted ? '计入' : '未计入') + ' · 权重 ' + Number(event.weight_after ?? 1).toFixed(2) +
              (event.source === 'correction' ? settled : '');
          });
          // Per-day rollup only when the history actually spans more than a day,
          // so a single-day curve is not padded with redundant lines.
          var daily = (result.daily || []).length > 1
            ? (result.daily || []).slice(-7).map(function (day) {
              return '按天 ' + String(day.day) + ' · 有用 ' + Number(day.positive || 0) +
                ' / 纠错 ' + Number(day.negative || 0) + ' → ' + Number(day.end_weight ?? 1).toFixed(2);
            })
            : [];
          var text = head.concat(daily).concat(events).join('\n');
          var graphic = sparkline(compressCurve(raw, 48));
          // Keep the text summary as the accessible fallback; the SVG is additive.
          box.innerHTML = (graphic ? '<div class="weight-spark">' + graphic + '</div>' : '') +
            '<pre class="weight-summary">' + escapeText(text) + '</pre>';
        })
        .catch(function (error) { box.textContent = '读取失败：' + String(error && error.message ? error.message : error); });
    };
  });
}
