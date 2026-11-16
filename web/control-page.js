/**
 * 控制台页面（看见全局：任务、审批、阻塞）。
 *
 * 独立模块：只依赖窄 ctx 与共享的新建会话表单。
 */
export function createControlPage(ctx) {
  const { state, api, go, openTask, esc, icon, label, pill, head, emptyState, countChip, settled, openInlineOn, asideBlock, newSessionDrawer } = ctx;
  // 内部失败原因以英文内核句到达界面，这里换成用户能照做的中文。
  const failureText = typeof ctx.failureText === 'function' ? ctx.failureText : function (value) { return String(value == null ? '' : value); };
  function viewMyTasks() {
    return settled(api('/api/workbench/task-board?limit=50'), { order: [], labels: {}, buckets: {}, tasks: [] }).then(function (board) {
      var labels = board.labels || {};
      var order = board.order || [];
      var buckets = board.buckets || {};
      var toneOf = function (state) {
        return state === 'running' ? 'info' : state === 'awaiting_approval' ? 'warn' : state === 'failed' ? 'danger'
          : state === 'unknown' ? 'warn' : state === 'completed' ? 'ok' : 'muted';
      };
      var releaseNames = {
        pending_evaluation: '待评估', signoff_ready: '待签署', canary_ready: '待灰度',
        released: '已发布', blocked: '发布受阻',
      };
      var releasePill = function (release) {
        if (!release || !release.status || release.status === 'not_applicable') return '';
        var label = releaseNames[release.status] || release.status;
        var tone = release.status === 'released' ? 'ok' : release.status === 'blocked' ? 'danger' : 'info';
        return ' ' + pill('发布·' + label, tone);
      };
      // Same gate chain as the 领航员 result card: evaluation -> signoff -> canary ->
      // publication. Collapsed by default so the cockpit stays dense.
      var releaseDetails = function (release) {
        if (!release || !release.status || release.status === 'not_applicable') return '';
        var rows = ['<span>状态：' + esc(releaseNames[release.status] || release.status) +
          (release.reason ? ' · ' + esc(String(release.reason)) : '') + '</span>'];
        if (release.evaluation_run_id) rows.push('<span>评估：' + esc(String(release.evaluation_run_id)) + '</span>');
        if (release.signoff_id) rows.push('<span>签署：' + esc(String(release.signoff_id)) + '</span>');
        if (release.canary_id) rows.push('<span>灰度：' + esc(String(release.canary_id)) + '</span>');
        rows.push('<span>是否可发布：' + (release.publication_allowed ? '是' : '否') + '</span>');
        return '<details class="pilot-task-detail"><summary>发布门禁明细</summary><div>' + rows.join('') + '</div></details>';
      };
      var groupHtml = order.map(function (state) {
        var rows = buckets[state] || [];
        if (!rows.length) return '';
        return '<div class="card">' + head(labels[state] || state, '按真实回执与执行状态归组', countChip(rows.length)) +
          '<div class="card-body"><div class="rows">' + rows.map(function (item) {
            return '<div class="row"><span class="row-lead muted">' + icon('tasks') + '</span>' +
              '<div class="row-main"><span class="row-title">' + esc(item.title || item.id) + '</span>' +
              '<span class="row-sub">' + esc(failureText(String(item.reason || ''))) + (item.workspace_id ? ' · 工作区 ' + esc(String(item.workspace_id)) : '') + '</span>' +
              releaseDetails(item.release) +
              '<pre class="out" data-context-usage-list hidden></pre></div>' +
              pill(labels[item.state] || item.state, toneOf(item.state)) + releasePill(item.release) +
              '<div class="row-actions"><button class="btn sm" type="button" data-context-usage="' + esc(item.id) + '">上下文使用</button>' +
              '<button class="btn sm" type="button" data-board-open="' + esc(item.id) + '">打开</button>' +
              '<button class="btn sm" type="button" data-board-new-session="' + esc(item.workspace_id || '') + '">新建会话</button></div></div>';
          }).join('') + '</div></div></div>';
      }).join('');
      return {
        html: '<div class="stack">' + (groupHtml || emptyState('还没有任务', '新建会话后，任务会按状态出现在这里。', 'tasks')) + '</div>',
        aside: asideBlock('任务状态', '', '<div class="aside-note">状态来自真实记录：执行中的 Host/原生会话、待批准的控制点、持久队列、失败结果与未知回合。</div>' +
          '<div class="aside-note">宿主退出后停在 active 的任务不会再动，它们归入「已停止」，而不是假装在等你输入。</div>'),
        actions: [{ label: '新建任务', icon: 'plus', primary: true, run: function () {
          openInlineOn('tasks', newSessionDrawer(state.composer.folder || ''));
        } }],
        mounts: [function (root) {
          // Context usage per task: which memory/knowledge/experience assets this
          // task actually pulled, with the same weights recall ranked by. Lazy so a
          // board of fifty tasks does not fan out fifty requests on paint.
          root.querySelectorAll('[data-context-usage]').forEach(function (button) {
            if (button.dataset && button.dataset.usageBound === '1') return;
            if (button.dataset) button.dataset.usageBound = '1';
            button.onclick = function () {
              var row = typeof button.closest === 'function' ? button.closest('.row') : button.parentElement;
              var box = row && row.querySelector('[data-context-usage-list]');
              if (!box) return;
              if (!box.hidden) { box.hidden = true; return; }
              box.hidden = false;
              box.textContent = '正在读取上下文使用…';
              api('/api/workbench/task-context-usage?task_id=' + encodeURIComponent(button.getAttribute('data-context-usage')))
                .then(function (result) {
                  var memberNames = { memory: '记忆', knowledge: '知识', experience: '经验' };
                  // Where each member's own audit surface lives, so a task card can
                  // hand the reader straight to the asset instead of a bare string.
                  var pageFor = { memory: 'memory', knowledge: 'knowledge', experience: 'workflows' };
                  var assets = result.assets || [];
                  var rows = assets.map(function (asset) {
                    var weight = Number(asset.recall_weight);
                    return (memberNames[asset.member] || asset.member) + ' ' + String(asset.id) +
                      ' · 权重 ' + (Number.isFinite(weight) ? weight.toFixed(2) : '—') +
                      ' · 有用 ' + String(asset.helpful_signals || 0) + ' / 待复核 ' + String(asset.pending_corrections || 0);
                  });
                  // One glanceable line: how many assets this task used and how
                  // trustworthy they were, before the per-asset detail.
                  var weights = assets.map(function (asset) { return Number(asset.recall_weight); }).filter(Number.isFinite);
                  var summary = weights.length
                    ? '本次使用 ' + assets.length + ' 项资产 · 权重 ' + Math.min.apply(null, weights).toFixed(2) +
                      '–' + Math.max.apply(null, weights).toFixed(2) + ' · 最高：' +
                      String((memberNames[assets[weights.indexOf(Math.max.apply(null, weights))]?.member] || '') + ' ' +
                        String(assets[weights.indexOf(Math.max.apply(null, weights))]?.id || ''))
                    : '';
                  var text = rows.length ? [summary].concat(rows).filter(Boolean).join('\n') : '这个任务还没有可审计的上下文使用。';
                  if (assets.length && typeof box.querySelectorAll === 'function') {
                    box.innerHTML = '<div class="usage-summary">' + esc(summary) + '</div>' + assets.map(function (asset, index) {
                      var target = String(asset.member) + ':' + String(asset.id);
                      return '<div class="row"><span class="row-sub">' + esc(rows[index]) + '</span>' +
                        '<button class="btn sm" type="button" data-usage-page="' + esc(pageFor[asset.member] || '') +
                        '" data-usage-focus="' + esc(target) + '">召回记录</button>' +
                        '<button class="btn sm" type="button" data-usage-page="' + esc(pageFor[asset.member] || '') +
                        '" data-usage-focus="' + esc(target + '#trend') + '">权重趋势</button></div>';
                    }).join('');
                    box.querySelectorAll('[data-usage-page]').forEach(function (link) {
                      link.onclick = function () {
                        var page = link.getAttribute('data-usage-page');
                        if (page) go(page, link.getAttribute('data-usage-focus'));
                      };
                    });
                  } else {
                    box.textContent = text;
                  }
                })
                .catch(function (error) { box.textContent = '读取失败：' + String(error && error.message ? error.message : error); });
            };
          });
          root.querySelectorAll('[data-board-open]').forEach(function (button) {
            button.onclick = function () { openTask(button.getAttribute('data-board-open')); };
          });
          root.querySelectorAll('[data-board-new-session]').forEach(function (button) {
            button.onclick = function () {
              var workspace = button.getAttribute('data-board-new-session') || '';
              // Only a group we can resolve back to a directory may be preselected;
              // otherwise start blank rather than passing an id where a path is required.
              var known = workspace && (state.folderGroups || []).some(function (g) { return g.key === workspace; });
              state.composer.folder = known ? workspace : '';
             openInlineOn('tasks', newSessionDrawer(workspace));
            };
          });
        }]
      };
    });
  }
  return { viewMyTasks };
}
