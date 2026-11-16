/**
 * 领航员页面（面向非技术用户：只说目标）。
 *
 * 独立模块：只依赖窄 ctx，不引用控制台或工作台的任何代码。
 */
export function createPilotPage(ctx) {
  const { state, api, toast, fail, openTask, esc, icon, label, pill, head, settled, writePilotSession, asideBlock } = ctx;
  // 内部失败原因以英文内核句到达界面，这里换成用户能照做的中文。
  const failureText = typeof ctx.failureText === 'function' ? ctx.failureText : function (value) { return String(value == null ? '' : value); };
  const host = ctx.host || (typeof window === 'undefined' ? {} : window);
  function viewPilot() {
    return Promise.resolve({
      html: '<div class="pilot-shell">' +
        '<section class="pilot-stage" aria-label="领航员会话">' +
        '<div class="pilot-thread" id="pilot-thread" aria-live="polite">' +
        '<div class="pilot-empty"><span class="pilot-mark" aria-hidden="true">' + icon('spark') + '</span>' +
        '<b>把目标交给领航员</b><span>你不用决定几个任务、谁来做、先做哪一个。领航员会在内部拆解、排队、分派和复查。</span>' +
        '<div class="pilot-samples" role="list" aria-label="示例目标">' +
        ['审查当前仓库最近的改动并列出风险', '把这次需求拆成可验收的任务', '梳理项目文档并生成一份索引']
          .map(function (sample) {
            return '<button class="pilot-sample" type="button" role="listitem" data-pilot-sample="' + esc(sample) + '">' + esc(sample) + '</button>';
          }).join('') +
        '</div></div></div>' +
        '<div class="flight-strip" id="flight-strip" aria-label="任务全景进度" hidden></div>' +
        '<div class="flight-drawer" id="flight-drawer" hidden></div>' +
        '<div class="pilot-clarify" id="pilot-clarify" hidden></div>' +
        '<form class="pilot-composer" id="pilot-form">' +
        '<div class="pilot-composer-meta"><span class="pilot-pipeline">自动编排</span>' +
        '<span class="pilot-queue-state" id="pilot-queue-state">并发上限 ' + esc(String((state.settings && state.settings.workbench && state.settings.workbench.pilotConcurrency) || 3)) + '</span></div>' +
        '<textarea id="pilot-input" rows="2" maxlength="32000" placeholder="告诉领航员你要完成什么。可以一次说多个目标。"></textarea>' +
        '<div class="pilot-composer-bar">' +
        '<button class="btn pilot-plus" type="button" id="pilot-plus" aria-label="设置" title="设置">＋</button>' +
        '<div class="pilot-settings" id="pilot-settings" hidden>' +
        '<label class="pilot-inline">执行<select id="pilot-provider"><option value="craft">Craft（固定）</option></select></label>' +
        '<label class="pilot-inline">权限<select id="pilot-permission"><option value="ask">人工审批</option><option value="auto" selected>自动审批</option><option value="full">完整权限</option></select></label></div>' +
        '<span class="grow"></span><button class="btn primary pilot-send" id="pilot-send" type="submit" disabled aria-label="发送" title="发送">' + icon('arrow') + '</button></div>' +
        '</form></section></div>',
      aside: asideBlock('领航员边界', '', '<div class="aside-note">输入没有歧义时全程走确定性程序；只有真正需要识别或作业时才调用模型。</div>' +
        '<div class="aside-note">每个拆分结果都会落成普通任务，控制台与领航员读取同一份进度和审批记录。</div>' +
        '<div class="aside-note">切换模式不会停止任务。需要批量处理时去控制台；要按项目直接对话时去工作台。</div>'),
      mounts: [function (root) {
        var thread = root.querySelector('#pilot-thread');
        var form = root.querySelector('#pilot-form');
        var input = root.querySelector('#pilot-input');
        var send = root.querySelector('#pilot-send');
        if (!thread || !form || !input || !send) return;
        var sessionId = state.pilotSessionId || '';
        var queueState = root.querySelector('#pilot-queue-state');
        var provider = root.querySelector('#pilot-provider');
        var permission = root.querySelector('#pilot-permission');
        var settings = root.querySelector('#pilot-settings');
        var plus = root.querySelector('#pilot-plus');
        var concurrency = (state.settings && state.settings.workbench && state.settings.workbench.pilotConcurrency) || 3;
        // Move the reminder dock into this stage so it occupies flow space above
        // the composer; a fixed overlay either covered the input or left a gap.
        // Partial DOM stand-ins used by module tests may expose createElement but
        // no getElementById; tolerate that instead of crashing the Pilot page.
        var dock = typeof document === 'undefined' || !document || typeof document.getElementById !== 'function'
          ? null : document.getElementById('message-dock');
        var dockHome = dock && dock.parentNode;
        if (dock && form.parentNode) form.parentNode.insertBefore(dock, form);
        var providerNames = { craft: 'Craft' };
        var queueNames = { queued: '排队中', running: '执行中', completed: '已完成', failed: '执行失败', blocked: '待核对' };
        var workerNames = { started: '正在执行', awaiting_approval: '等待你批准', completed: '执行结束，等待验收', failed: '执行失败', unknown: '执行结果待确认' };
        var reviewNames = { pass: '复查通过', needs_human: '等待你决定', block: '已阻断' };
        var reviewTone = { pass: 'ok', needs_human: 'warn', block: 'danger' };
        var resultNames = { working: '执行中', awaiting_verification: '待验收', passed: '已交付', needs_attention: '需要核对' };
        var resultTone = { working: 'info', awaiting_verification: 'warn', passed: 'ok', needs_attention: 'danger' };
        // Coordinator 的目录解析来源：中文说明，别把内部枚举甩给用户。
        var sourceLabel = { explicit: '你指定的', intent: '按意图识别', session: '继承会话', cwd: '当前目录', unbound: '未识别', ambiguous: '需要你选' };
        var availableExecutors = ['craft'];
        var configuredCraftModel = function () {
          var models = (state.composer && state.composer.models) || [];
          var chosen = models.filter(function (item) { return item.configured; })[0];
          return chosen ? String(chosen.id) : '';
        };
        var syncSend = function () { send.disabled = !String(input.value || '').trim(); };
        // A first-run user has nothing to type yet; a sample fills the composer
        // (without sending) so they can edit a real goal instead of a blank box.
        if (typeof root.querySelectorAll === 'function') {
          Array.prototype.forEach.call(root.querySelectorAll('[data-pilot-sample]'), function (sample) {
            sample.onclick = function () {
              input.value = sample.getAttribute('data-pilot-sample') || '';
              syncSend();
              if (typeof input.focus === 'function') input.focus();
            };
          });
        }
        var pollTimer = null;
        var outcomeFor = function (route) {
          var worker = route.worker || {};
          var queue = String(route.queue_state || 'queued');
          if (queue === 'running') return 'running';
          if (queue === 'blocked') return 'blocked';
          if (queue === 'finished') return worker.state === 'failed' ? 'failed' : 'completed';
          return queue;
        };
        var stopPolling = function () {
          if (pollTimer != null) host.clearTimeout(pollTimer);
          pollTimer = null;
        };
        if (plus && settings) plus.onclick = function () {
          settings.hidden = !settings.hidden;
          plus.setAttribute('aria-expanded', String(!settings.hidden));
        };
        var empty = function () {
          thread.innerHTML = '<div class="pilot-empty"><span class="pilot-mark" aria-hidden="true">' + icon('spark') + '</span>' +
            '<b>把目标交给领航员</b><span>你不用决定几个任务、谁来做、先做哪一个。领航员会在内部拆解、排队、分派和复查。</span></div>';
          // 没有会话时进度条没有任何内容可显示，留着只会是一条空白的边框。
          var emptyStrip = root.querySelector('#flight-strip');
          if (emptyStrip) emptyStrip.hidden = true;
        };
        var renderStatus = function (status) {
          var turns = status.turns || [];
          var tasks = status.tasks || [];
          var routes = status.routes || [];
          var reviews = status.reviews || [];
          var results = status.results || [];
          var taskById = {};
          tasks.forEach(function (task) { taskById[String(task.id)] = task; });
          var routeByTask = {};
          routes.forEach(function (route) { routeByTask[String(route.task_id)] = route; });
          var resultByTask = {};
          results.forEach(function (result) { resultByTask[String(result.task_id)] = result; });
          var counts = (status.progress && status.progress.counts) || {};
          var resultFacts = (status.progress && status.progress.result_facts) || {};
          if (queueState) {
            var queueSummary = ['并发上限 ' + esc(String(concurrency)), '执行 ' + esc(String(counts.running || 0)), '排队 ' + esc(String(counts.queued || 0)),
              '已交付 ' + esc(String(resultFacts.passed || 0)), '待验收 ' + esc(String(resultFacts.awaiting_verification || 0))];
            if (counts.failed) queueSummary.push('失败 ' + esc(String(counts.failed)));
            if (counts.blocked) queueSummary.push('待核对 ' + esc(String(counts.blocked)));
            queueState.textContent = queueSummary.join(' · ');
          }
          // Flight Strip：四个工程阶段的呼吸感进度条；点击任一节点下钻该阶段日志。
          var strip = root.querySelector('#flight-strip');
          var drawer = root.querySelector('#flight-drawer');
          if (strip && drawer) {
            var stages = [
              { key: 'coordination', label: '协调中', detail: 'Coordinator 解析意图、匹配工作目录、检查历史任务冲突' },
              { key: 'assignment', label: '分配目录', detail: '把目标落到具体工作区，生成稳定的任务 id' },
              { key: 'worker', label: 'Mainer 派发', detail: 'Mainer 排队并把 Worker 绑定到已配置的执行器' },
              { key: 'review', label: 'Reviewer 审阅', detail: 'Reviewer 用硬规则核对计划与结果，超过 3 轮自动熔断' }
            ];
            var activeStage = !turns.length ? 0 : (counts.running || 0) > 0 ? 2 :
              (reviews.length && reviews[reviews.length - 1].phase !== 'final') ? 3 :
                (counts.queued || 0) > 0 ? 1 : (resultFacts.passed || 0) > 0 ? 3 : 0;
            strip.innerHTML = stages.map(function (stage, index) {
              var tone = index < activeStage ? 'done' : index === activeStage ? 'active' : 'idle';
              return '<button type="button" class="flight-node ' + tone + '" data-flight="' + stage.key + '">' +
                '<span class="flight-dot"></span><span>' + esc(stage.label) + '</span></button>' +
                (index < stages.length - 1 ? '<span class="flight-link"></span>' : '');
            }).join('');
            strip.hidden = false;
            strip.querySelectorAll('[data-flight]').forEach(function (node) {
              node.onclick = function () {
                var key = node.getAttribute('data-flight');
                var stage = stages.filter(function (s) { return s.key === key; })[0];
                var lines = ['<b>' + esc(stage.label) + '</b>', esc(stage.detail)];
                if (key === 'assignment') {
                  var latest = (turns || [])[turns.length - 1] || {};
                  var ws = latest.workspace_resolution || {};
                  lines.push('任务：' + tasks.length + ' 个 · 工作区：' + esc(String(tasks[0] && tasks[0].workspace_id || '未绑定')));
                  // 解析来源必须说清楚：用户才知道这次是系统猜的还是自己指的。
                  if (ws.source) lines.push('目录来源：' + esc(sourceLabel[ws.source] || ws.source) +
                    (ws.reason ? ' · ' + esc(ws.reason) : '') +
                    (ws.confidence ? ' · 把握 ' + Math.round(Number(ws.confidence) * 100) + '%' : ''));
                }
                if (key === 'worker') lines.push('运行 ' + (counts.running || 0) + ' · 排队 ' + (counts.queued || 0) + ' · 路由 ' + routes.length + ' 条');
                if (key === 'review') lines.push('审阅记录 ' + reviews.length + ' 条 · 最近结论 ' + esc(String((reviews[reviews.length - 1] || {}).verdict || '无')));
                // 一键下钻：抽屉里既有阶段日志，也能直接进工作台接管这个任务。
                var firstTask = tasks[0] && tasks[0].id;
                drawer.innerHTML = lines.join('<br>') + (firstTask
                  ? '<div class="flight-actions"><button class="btn sm primary" type="button" data-flight-open="' +
                    esc(String(firstTask)) + '">在工作台打开任务</button></div>'
                  : '');
                drawer.hidden = false;
                var openButton = drawer.querySelector ? drawer.querySelector('[data-flight-open]') : null;
                if (openButton) openButton.onclick = function () { openTask(openButton.getAttribute('data-flight-open')); };
              };
            });
          }
          schedulePoll(status);
          if (!turns.length) { empty(); return; }
          thread.innerHTML = turns.map(function (turn) {
            var ids = turn.task_ids || [];
            var review = reviews.filter(function (item) { return item.turn_id === turn.id && item.phase !== 'final'; }).pop() ||
              reviews.filter(function (item) { return item.turn_id === turn.id; }).pop();
            var finalReview = reviews.filter(function (item) { return item.turn_id === turn.id && item.phase === 'final'; }).pop();
            var cards = ids.map(function (taskId) {
              var task = taskById[String(taskId)] || { id: taskId, title: taskId, goal: '' };
              var route = routeByTask[String(taskId)] || {};
              var worker = route.worker || {};
              var queueStateValue = outcomeFor(route);
              var result = resultByTask[String(taskId)] || {};
              var detailRows = [];
              if (result.summary) detailRows.push('<span>结论：' + esc(failureText(String(result.summary))) + '</span>');
              if (result.latest_message) detailRows.push('<pre class="pilot-result-message">回复：' + esc(String(result.latest_message)) + '</pre>');
              detailRows.push('<span>来源：' + esc(String(result.provenance || 'none')) + '</span>');
              (result.artifacts || []).forEach(function (item) {
                detailRows.push('<span>产物：' + esc(String(item.name || item.uri || item.id)) + '</span>');
              });
              (result.evidence || []).forEach(function (item) {
                detailRows.push('<span>依据：' + esc(String(item.claim || item.locator || item.id)) +
                  ' · ' + esc(String(item.confidence || 'unverified')) + '</span>');
              });
              (result.acceptance || []).forEach(function (item) {
                detailRows.push('<span>验收：' + esc(String(item.result || item.status || item.effective_status || item.kind)) +
                  ' · ' + esc(String(item.summary || item.acceptance_status || item.id)) + '</span>');
              });
              (result.attention || []).forEach(function (item) {
                detailRows.push('<span>待办：' + esc(String(item.reason || item.action || item.id)) + '</span>');
              });
              var release = result.release || {};
              var releaseLabel = {
                not_applicable: '无需发布', pending_evaluation: '待评估', signoff_ready: '待签署',
                canary_ready: '待灰度', released: '已发布', blocked: '发布受阻',
              }[String(release.status)] || '发布状态未知';
              // A delivered task earns a release gate. Surface the gate chain
              // (evaluation -> signoff -> canary -> publication) so the user can see
              // exactly where a deliverable stands before it becomes reusable.
              var releaseRows = [];
              if (release.status && release.status !== 'not_applicable') {
                releaseRows.push('<span>发布门禁：' + esc(releaseLabel) +
                  (release.reason ? ' · ' + esc(String(release.reason)) : '') + '</span>');
                if (release.evaluation_run_id) releaseRows.push('<span>评估：' + esc(String(release.evaluation_run_id)) + '</span>');
                if (release.signoff_id) releaseRows.push('<span>签署：' + esc(String(release.signoff_id)) + '</span>');
                if (release.canary_id) releaseRows.push('<span>灰度：' + esc(String(release.canary_id)) + '</span>');
                releaseRows.push('<span>是否可发布：' + (release.publication_allowed ? '是' : '否') + '</span>');
              } else {
                releaseRows.push('<span>发布门禁：无需发布</span>');
              }
              return '<article class="pilot-task" data-state="' + esc(queueStateValue) + '">' +
                '<div class="pilot-task-head"><span class="pilot-task-dot"></span><b>' + esc(String(task.title || task.id)) + '</b>' +
                pill(queueNames[queueStateValue] || queueStateValue, queueStateValue === 'running' ? 'info' : queueStateValue === 'completed' ? 'ok' : 'warn') + '</div>' +
                (result.headline ? '<div class="pilot-result-line">' + icon(result.verdict === 'passed' ? 'check' : 'shield') +
                  '<span>' + esc(String(result.headline)) + '</span>' + pill(resultNames[String(result.verdict)] || String(result.verdict), resultTone[String(result.verdict)] || '') +
                  (release.status && release.status !== 'not_applicable' ? ' ' + pill(releaseLabel, release.status === 'released' ? 'ok' : release.status === 'blocked' ? 'warn' : 'info') : '') + '</div>' : '') +
                (release.status && release.status !== 'not_applicable'
                  ? '<details class="pilot-task-detail"><summary>发布门禁明细</summary><div>' + releaseRows.join('') + '</div></details>'
                  : '') +
                '<p>' + esc(String(task.goal || '').slice(0, 360)) + '</p>' +
                // 飞轮真值：只有用户真的用了这次交付，经验才算好用。
                (result.verdict === 'passed'
                  ? '<div class="pilot-adoption"><span>这次交付你怎么用了？</span>' +
                    '<button class="btn sm" type="button" data-adoption="accepted" data-task="' + esc(String(task.id)) + '">直接采纳</button>' +
                    '<button class="btn sm" type="button" data-adoption="accepted_with_edits" data-task="' + esc(String(task.id)) + '">改过再用</button>' +
                    '<button class="btn sm" type="button" data-adoption="rejected" data-task="' + esc(String(task.id)) + '">驳回重来</button></div>'
                  : '') +
                '<div class="pilot-task-foot"><span>' + esc(providerNames[String(route.executor_template)] || String(route.executor_template || '待路由')) + '</span>' +
                '<button class="btn sm ghost" type="button" data-pilot-task="' + esc(String(task.id)) + '">打开任务</button></div>' +
                '<details class="pilot-task-detail"><summary>查看结果与依据</summary><div>' +
                '<span>路由：' + esc(String(route.reason || '尚未生成')) + '</span>' +
                '<span>置信：' + esc(String(route.confidence === undefined ? '—' : route.confidence)) + '</span>' +
                '<span>Worker：' + esc(workerNames[String(worker.state)] || String(worker.state || '尚未启动')) +
                (worker.reason ? ' · ' + esc(failureText(String(worker.reason))) : '') + '</span>' +
                detailRows.join('') + '<span>任务：' + esc(String(task.id)) + '</span></div></details></article>';
            }).join('');
            var reviewHtml = review ? '<div class="pilot-review">' + icon(review.verdict === 'pass' ? 'check' : 'shield') +
              '<span>' + esc(reviewNames[String(review.verdict)] || String(review.verdict)) + '</span>' +
              pill(String((review.checks || []).filter(function (check) { return !check.ok; }).length) + ' 项提示', reviewTone[String(review.verdict)] || '') + '</div>' : '';
            var finalReviewHtml = finalReview ? '<div class="pilot-review">' + icon(finalReview.verdict === 'pass' ? 'check' : 'shield') +
              '<span>最终复查：' + esc(reviewNames[String(finalReview.verdict)] || String(finalReview.verdict)) + '</span>' +
              pill(String((finalReview.checks || []).filter(function (check) { return !check.ok; }).length) + ' 项提示', reviewTone[String(finalReview.verdict)] || '') + '</div>' : '';
            // 重复劳动要看得见：同一个目标已有未结束任务时直接说，不让人白等一轮。
            var conflicts = turn.conflicts || [];
            var conflictHtml = conflicts.length ? '<div class="pilot-review">' + icon('alert') +
              '<span>已有 ' + esc(String(conflicts.length)) + ' 个未完成任务的目标和这次重合：' +
              esc(conflicts.slice(0, 3).map(function (item) { return item.title; }).join('、')) + '</span>' +
              pill(conflicts[0] && conflicts[0].similarity ? '最高重合 ' + Math.round(Number(conflicts[0].similarity) * 100) + '%' : '', 'warn') + '</div>' : '';
            return '<div class="pilot-message pilot-message-user"><div>' + esc(String(turn.input || '')) + '</div></div>' +
              '<div class="pilot-message pilot-message-agent"><div class="pilot-agent-copy"><span class="pilot-agent-name">领航员</span>' +
              '<p>我已经把这次目标整理成 ' + esc(String(ids.length)) + ' 个任务，并按当前执行器完成排队。</p>' + conflictHtml + reviewHtml + finalReviewHtml + '</div>' +
              '<div class="pilot-task-list">' + cards + '</div></div>';
          }).join('');
        };
        var schedulePoll = function (status) {
          stopPolling();
          var counts = (status.progress && status.progress.counts) || {};
          if (!sessionId || (!counts.running && !counts.queued)) return;
          pollTimer = host.setTimeout(function () {
            pollTimer = null;
            if (!root.isConnected) return;
            api('/api/pilot/sessions/' + encodeURIComponent(sessionId) + '/reconcile', { method: 'POST', body: {} })
              .then(loadStatus)
              .catch(function (error) {
                if (!root.isConnected) return;
                fail(error);
                pollTimer = host.setTimeout(function () { pollTimer = null; if (root.isConnected) loadStatus().catch(fail); }, 8000);
              });
          }, 2500);
        };
        var loadStatus = function () {
          if (!sessionId) return Promise.resolve();
          return api('/api/pilot/sessions/' + encodeURIComponent(sessionId) + '/status').then(function (status) {
            if (root.isConnected) renderStatus(status);
            return status;
          });
        };
        var ensureSession = function (value) {
          if (sessionId) return Promise.resolve(sessionId);
          return api('/api/pilot/sessions', { method: 'POST', body: {
            // 领航员不借用工作台选的工作区：目录由 Coordinator 按意图自动识别。
            input: value, concurrency: concurrency,
          } }).then(function (result) {
            sessionId = String(result.session.id);
            state.pilotSessionId = sessionId;
            if (typeof writePilotSession === 'function') {
              writePilotSession(typeof localStorage === 'undefined' ? null : localStorage, sessionId);
            }
            return sessionId;
          });
        };
        var submit = function (workspaceId) {
          var value = String(input.value || '').trim();
          if (!value || send.disabled) return;
          send.disabled = true;
          ensureSession(value).then(function (id) {
            return api('/api/pilot/sessions/' + encodeURIComponent(id) + '/turns/auto', { method: 'POST', body: {
              input: value,
              executor: provider && provider.value !== 'auto' ? provider.value : undefined,
              executors: availableExecutors,
              permission: permission ? permission.value : 'auto',
              ...(workspaceId ? { workspace_id: workspaceId } : {}),
            } });
          }).then(function (result) {
            if (result.status === 'blocked') {
              // NEEDREAD 意图补全：Coordinator 发现模糊时在对话框上方弹出结构化
              // 组件，用户点选/补充即可，不必自己组织一段新指令。
              toast('领航员需要你先澄清问题');
              renderClarify(result.questions || [], value);
            } else {
              clearClarify();
              input.value = '';
              syncSend();
              var craftModel = configuredCraftModel();
              return api('/api/workbench/pilot-sessions/' + encodeURIComponent(sessionId) + '/dispatch', {
                method: 'POST', body: { permission: permission ? permission.value : 'auto',
                  ...(craftModel ? { craft_model: craftModel } : {}) },
              });
            }
            return null;
          }).then(function () { return loadStatus(); }).catch(fail).finally(syncSend);
        };
        var clarify = function () { return root.querySelector('#pilot-clarify'); };
        var clearClarify = function () {
          var node = clarify();
          if (node) { node.hidden = true; node.innerHTML = ''; }
        };
        var renderClarify = function (questions, original) {
          var node = clarify();
          if (!node) return;
          var groups = (questions || []).map(function (group, index) {
            var list = group.questions || [];
            if (Array.isArray(group.workspace_options)) {
              return '<div class="clarify-group"><b>' + esc(group.title || '选择工作区') + '</b>' + list.map(function (q) {
                return '<div class="clarify-question"><span>' + esc(q) + '</span><div class="clarify-options">' +
                  (group.workspace_options.length ? group.workspace_options.map(function (opt) {
                    return '<button class="btn sm" type="button" data-clarify-workspace="' + esc(String(opt.workspace_id)) + '">' + esc(String(opt.root_path)) + '</button>';
                  }).join('') : '<span>请先登记工作区，再重新提交。</span>') + '</div></div>';
              }).join('') + '</div>';
            }
            var options = (group.options || []).length ? group.options : ['继续', '跳过'];
            return '<div class="clarify-group"><b>' + esc(group.title || ('澄清 ' + (index + 1))) + '</b>' +
              list.map(function (q) {
                return '<div class="clarify-question"><span>' + esc(q) + '</span><div class="clarify-options">' +
                  options.map(function (opt) {
                    return '<button class="btn sm" type="button" data-clarify-opt="' + esc(String(opt)) + '">' + esc(String(opt)) + '</button>';
                  }).join('') + '</div></div>';
              }).join('') + '</div>';
          }).join('');
          node.innerHTML = '<div class="clarify-head">领航员需要你先澄清，点选即可：</div>' + groups +
            '<div class="clarify-foot"><button class="btn primary sm" type="button" id="clarify-submit">提交澄清</button>' +
            '<button class="btn sm" type="button" id="clarify-skip">跳过</button></div>';
          node.hidden = false;
          var chosen = [];
          var selectedWorkspace = '';
          var requiresWorkspace = (questions || []).some(function (group) { return Array.isArray(group.workspace_options); });
          node.querySelectorAll('[data-clarify-workspace]').forEach(function (btn) {
            btn.onclick = function () {
              selectedWorkspace = String(btn.getAttribute('data-clarify-workspace'));
              node.querySelectorAll('[data-clarify-workspace]').forEach(function (other) { other.classList.remove('selected'); });
              btn.classList.add('selected');
            };
          });
          node.querySelectorAll('[data-clarify-opt]').forEach(function (btn) {
            btn.onclick = function () {
              chosen.push(String(btn.getAttribute('data-clarify-opt')));
              btn.classList.add('selected');
              btn.disabled = true;
            };
          });
          var submitClarify = node.querySelector('#clarify-submit');
          if (submitClarify) submitClarify.onclick = function () {
            if (String(input.value || '').trim() !== original) {
              clearClarify(); syncSend(); submit(); return;
            }
            if (requiresWorkspace) {
              if (!selectedWorkspace) { toast('请选择已登记的工作区'); return; }
              clearClarify(); syncSend(); submit(selectedWorkspace); return;
            }
            input.value = String(input.value || '') + '\n澄清：' + chosen.join('；');
            clearClarify(); syncSend(); submit();
          };
          var skip = node.querySelector('#clarify-skip');
          if (skip) skip.onclick = function () { clearClarify(); };
        };
        form.onsubmit = function (event) {
          event.preventDefault();
          submit();
        };
        input.oninput = syncSend;
        input.onkeydown = function (event) {
          if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
          event.preventDefault();
          submit();
        };
        thread.onclick = function (event) {
          var button = event.target.closest('[data-pilot-task]');
          if (button) openTask(button.getAttribute('data-pilot-task'));
          var adoption = event.target.closest('[data-adoption]');
          if (adoption) {
            api('/api/workbench/pilot/adoption', { method: 'POST', body: {
              task_id: adoption.getAttribute('data-task'), verdict: adoption.getAttribute('data-adoption'),
              decided_by: (state.settings && state.settings.workbench && state.settings.workbench.operator) || ''
            } }).then(function () { toast('已记录这次交付的采纳结论'); loadStatus(); }).catch(fail);
          }
        };
        settled(api('/api/workbench/agent-sessions/providers'), { providers: [] }).then(function () {
          // 领航员固定只用 Craft；此处保留读取用于诊断其它模式，
          // 但绝不把外部 CLI 写回 availableExecutors。
          availableExecutors = ['craft'];
        });
        if (sessionId) settled(loadStatus(), null).then(function () { if (root.isConnected) syncSend(); });
        else stopPolling();
        syncSend();
        return {
          destroy: function () {
            stopPolling();
            if (dock && dockHome && typeof dockHome.appendChild === 'function') dockHome.appendChild(dock);
          }
        };
      }]
    });
  }
  return { viewPilot };
}
