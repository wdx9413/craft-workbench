/**
 * Three-mode page views (工作台 home / 控制台 my-tasks / 领航员 pilot).
 * The module owns only presentation: all runtime facts, navigation and shell
 * state arrive through one narrow context interface, so a page is testable
 * without booting the whole app.
 */
export function createModePages(ctx) {
  const { state, api, toast, fail, go, openTask, importNativeSession, mountAgentWorkspace,
    workspacePathOf, folderNameOf, renderFolderTree, asideBlock, openInlineOn, dismissInline,
    settled, icon, esc, label, pill, head, emptyState, countChip, writePilotSession } = ctx;
  const doc = ctx.doc || (typeof document === 'undefined' ? null : document);
  const host = ctx.host || (typeof window === 'undefined' ? {} : window);

function viewHome() {
  return Promise.resolve({
    html: '<div class="stack home">' +
      '<details class="session-config"><summary>配置状态 · Mod 与插件</summary>' +
      '<div class="session-toolbar" id="session-toolbar" aria-label="Mod 与插件配置状态"></div></details>' +
      '<section class="plugin-context-actions" id="plugin-context-actions" aria-label="插件提供的上下文操作" hidden></section>' +
      '<section class="plugin-context-actions" id="plugin-advanced-tools" aria-label="插件高级工具" hidden></section>' +
      '<section class="home-agent" id="agent-workspace" aria-label="工作会话"></section>' +
      '<details class="dual-terminal" id="dual-terminal"><summary>原始终端流（命令执行事件，点开查看）</summary>' +
      '<pre id="terminal-out" class="out">加载中…</pre></details></div>',
    aside: asideBlock('工作会话', '', '<div class="aside-note">选择项目与工具后开始工作。会话记录由 Codex / Claude / DSH 原生 CLI 保存，Craft 只保存关联、审批与上下文。</div>'),
    mounts: [function (root) {
      var agentRoot = root.querySelector('#agent-workspace');
      if (!agentRoot) return;
        var nativeDesktop = !!(host.__TAURI__ && host.__TAURI__.core);
      var settings = state.settings || {};
      // 配置状态不代表原生会话已加载或在途运行已更新。
      var toolbar = root.querySelector('#session-toolbar');
      if (toolbar) {
        var workspaceId = state.composer.folder || '';
        Promise.all([
          api('/api/workbench/mods/list?status=active'),
          api('/api/workbench/plugins'),
          workspaceId ? api('/api/workspaces/' + encodeURIComponent(workspaceId) + '/plugins') : Promise.resolve({ bindings: [] }),
          workspaceId ? api('/api/workbench/contributions?workspace_id=' + encodeURIComponent(workspaceId) + '&context=project').catch(function () { return { contributions: [] }; }) : Promise.resolve({ contributions: [] })
        ]).then(function (results) {
          var mods = (results[0] && results[0].items) || [];
          var plugins = (results[1] && results[1].items) || [];
          var bindings = (results[2] && results[2].bindings) || [];
          var contributionHost = root.querySelector('#plugin-context-actions');
          var contributions = (results[3] && results[3].contributions) || [];
          var actions = contributions.flatMap(function (item) { return (item.context_actions || []).map(function (action) {
            return { plugin: item.source, title: action.title, target: action.target };
          }); });
          if (contributionHost && actions.length) {
            contributionHost.hidden = false;
            contributionHost.innerHTML = '<b>当前工作区的上下文操作</b><div class="row-actions">' + actions.map(function (action, index) {
              return '<button class="btn sm" type="button" data-plugin-context-action="' + index + '">' + esc(action.title) +
                '<span class="row-sub">来自 ' + esc(action.plugin) + '</span></button>';
            }).join('') + '</div>';
            contributionHost.querySelectorAll('[data-plugin-context-action]').forEach(function (button) {
              button.onclick = function () { var action = actions[Number(button.getAttribute('data-plugin-context-action'))]; if (action) go(action.target); };
            });
          }
          var advancedHost = root.querySelector('#plugin-advanced-tools');
          var advancedTools = contributions.flatMap(function (item) { return (item.advanced_tools || []).map(function (tool) {
            return { plugin: item.source, pluginId: item.plugin_id, id: tool.id, title: tool.title, tool: tool.tool, supported: tool.supported === true };
          }); });
          if (advancedHost && advancedTools.length) {
            advancedHost.hidden = false;
            advancedHost.innerHTML = '<b>插件高级工具</b><div class="row-actions">' + advancedTools.map(function (tool, index) {
              return '<button class="btn sm" type="button" data-plugin-tool="' + index + '"' + (tool.supported ? '' : ' disabled') + '>' + esc(tool.title) +
                '<span class="row-sub">来自 ' + esc(tool.plugin) + (tool.supported ? '' : ' · 当前宿主不支持') + '</span></button>';
            }).join('') + '</div><div class="plugin-tool-result" aria-live="polite"></div>';
            advancedHost.querySelectorAll('[data-plugin-tool]').forEach(function (button) {
              button.onclick = function () {
                var tool = advancedTools[Number(button.getAttribute('data-plugin-tool'))];
                if (!tool || !tool.supported) return;
                var query = typeof host.prompt === 'function' ? host.prompt('输入要搜索的内容') : null;
                if (!query || !query.trim()) return;
                button.disabled = true;
                var args = tool.tool === 'craft_workflow_search' ? { query: query.trim(), limit: 5 }
                  : tool.tool === 'craft_knowledge_search' ? { query: query.trim(), scope_kind: 'workspace', scope_id: workspaceId, limit: 5 }
                    : { query: query.trim(), scope: 'workspace:' + workspaceId, max_items: 5 };
                api('/api/workbench/plugins/' + encodeURIComponent(tool.pluginId) + '/tools/' + encodeURIComponent(tool.id) + '/call',
                  { method: 'POST', body: { workspace_id: workspaceId, args: args } }).then(function (result) {
                  var data = result.result || result;
                  var rows = data.results || data.items || data.workflows || [];
                  var slot = advancedHost.querySelector('.plugin-tool-result');
                  if (slot) slot.innerHTML = rows.length ? '<div class="rows">' + rows.map(function (item) {
                    return '<div class="row"><div class="row-main"><span class="row-title">' + esc(item.content || item.name || item.title || item.id || '结果') + '</span></div></div>';
                  }).join('') + '</div>' : '<p class="aside-note">没有找到匹配内容。</p>';
                }).catch(function (error) { var slot = advancedHost.querySelector('.plugin-tool-result'); if (slot) slot.textContent = '工具调用失败：' + String(error && error.message || error); })
                  .finally(function () { button.disabled = false; });
              };
            });
          }
          var enabled = Array.from(new Set(bindings.filter(function (b) { return b.status === 'enabled'; }).map(function (b) { return String(b.plugin_id); })));
          var modChips = mods.filter(function (m) { return m.enabled === true; }).map(function (m) {
            return '<span class="mount-chip">' + icon('layers') + 'Mod: ' + esc(m.name || m.id) +
              (m.version == null ? '' : ' · v' + esc(String(m.version))) +
              '<button class="btn sm" type="button" data-unmount-mod="' + esc(m.id) + '" title="全局停用这个 Mod 配置">全局停用</button></span>';
          }).join('');
          var pluginChips = enabled.map(function (id) {
            var plugin = plugins.find(function (p) { return String(p.id) === id; });
            return '<span class="mount-chip">' + icon('plug') + 'Plugin: ' + esc(plugin ? (plugin.name || id) : id + '（详情不可用）') +
              (plugin && plugin.package_version ? ' · v' + esc(String(plugin.package_version)) : '') +
              (plugin && plugin.runtime_status === 'unsupported' ? ' · 不可用：' + esc(plugin.unsupported_reason || '请查看插件详情') : '') +
              '<button class="btn sm" type="button" data-unmount-plugin="' + esc(id) +
              '" title="在配置工作区 ' + esc(workspaceId) + ' 停用这个插件">停用 ' + esc(workspaceId) + '</button></span>';
          }).join('');
          toolbar.innerHTML = '<span class="mount-label">配置状态（不代表本会话已生效）；' + (workspaceId ? '配置工作区：' + esc(workspaceId) + '，可能与当前会话的目录不同' : '未选择配置工作区') + '</span>' +
            (modChips || '<span class="mount-empty">无已启用 Mod</span>') +
            (pluginChips || '<span class="mount-empty">' + (workspaceId ? '本工作区未启用插件' : '未选择工作区') + '</span>');
          toolbar.querySelectorAll('[data-unmount-mod]').forEach(function (btn) {
            btn.onclick = function () {
              var id = btn.getAttribute('data-unmount-mod');
              api('/api/workbench/mods/' + encodeURIComponent(id) + '/disable', { method: 'POST', body: {} })
                .then(function () { toast('Mod 配置已全局停用；在途会话状态请查看运行记录'); go('home'); }).catch(fail);
            };
          });
          toolbar.querySelectorAll('[data-unmount-plugin]').forEach(function (btn) {
            btn.onclick = function () {
              var id = btn.getAttribute('data-unmount-plugin');
              api('/api/workspaces/' + encodeURIComponent(workspaceId) + '/plugins/' + encodeURIComponent(id) + '/disable',
                { method: 'POST', body: {} })
                .then(function () { toast('插件已在配置工作区 ' + workspaceId + ' 停用；在途会话状态请查看运行记录'); go('home'); }).catch(fail);
            };
          });
        }).catch(function () { toolbar.innerHTML = '<span class="mount-empty">扩展配置信息暂不可用</span>'; });
      }
      // 双轨终端流：可折叠的纯文本命令执行事件，数据来自 host-run 真实事件。
      var terminal = root.querySelector('#terminal-out');
      if (terminal) {
        api('/api/host-runs').then(function (result) {
          var runs = (result && result.runs) || [];
          if (!runs.length) { terminal.textContent = '暂无命令执行事件'; return; }
          return Promise.all(runs.slice(0, 3).map(function (run) {
            return api('/api/host-runs/' + encodeURIComponent(run.id)).then(function (detail) {
              return (detail.events || []).map(function (event) {
                return '[' + esc(event.created_at || '') + '] ' + esc(event.event_type) + ' · ' + esc(String((event.payload || {}).status || ''));
              }).join('\n');
            });
          })).then(function (blocks) { terminal.textContent = blocks.filter(Boolean).join('\n') || '暂无命令执行事件'; });
        }).catch(function () { terminal.textContent = '终端流暂不可用'; });
      }
      mountAgentWorkspace(agentRoot, {
        api: api,
        taskId: '',
        workspace: workspacePathOf(state.composer.folder),
        defaultProvider: settings.lastProvider || '',
        defaultPermission: (settings.workbench && settings.workbench.defaultPermission) || 'auto',
          invoke: nativeDesktop ? host.__TAURI__.core.invoke : null,
        onSessionsChanged: function () { renderFolderTree(true); },
        onOpenNative: importNativeSession,
        onOpenPage: function (page) { go(page); }
      });
    }]
  });
}

function viewPilot() {
  return Promise.resolve({
    html: '<div class="pilot-shell">' +
      '<section class="pilot-stage" aria-label="领航员会话">' +
      '<div class="pilot-thread" id="pilot-thread" aria-live="polite">' +
      '<div class="pilot-empty"><span class="pilot-mark" aria-hidden="true">' + icon('spark') + '</span>' +
      '<b>把目标交给领航员</b><span>你不用决定几个任务、谁来做、先做哪一个。领航员会在内部拆解、排队、分派和复查。</span></div></div>' +
      '<div class="flight-strip" id="flight-strip" aria-label="任务全景进度"></div>' +
      '<div class="flight-drawer" id="flight-drawer" hidden></div>' +
      '<div class="pilot-clarify" id="pilot-clarify" hidden></div>' +
      '<form class="pilot-composer" id="pilot-form">' +
      '<div class="pilot-composer-meta"><span class="pilot-pipeline">自动编排</span>' +
      '<span class="pilot-queue-state" id="pilot-queue-state">并发上限 ' + esc(String((state.settings && state.settings.workbench && state.settings.workbench.pilotConcurrency) || 3)) + '</span></div>' +
      '<textarea id="pilot-input" rows="2" maxlength="32000" placeholder="告诉领航员你要完成什么。可以一次说多个目标。"></textarea>' +
      '<div class="pilot-composer-bar">' +
      '<button class="btn pilot-plus" type="button" id="pilot-plus" aria-label="设置" title="设置">＋</button>' +
      '<div class="pilot-settings" id="pilot-settings" hidden>' +
      '<label class="pilot-inline">执行<select id="pilot-provider"><option value="auto">自动选择</option><option value="craft">Craft</option><option value="codex">Codex</option><option value="claude">Claude</option><option value="dsh">DSH</option></select></label>' +
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
      var providerNames = { craft: 'Craft', codex: 'Codex', claude: 'Claude', dsh: 'DSH', 'agent-desktop': 'Agent Desktop' };
      var queueNames = { queued: '排队中', running: '执行中', completed: '已完成', failed: '执行失败', blocked: '待核对' };
      var workerNames = { started: '正在执行', awaiting_approval: '等待你批准', completed: '执行结束，等待验收', failed: '执行失败', unknown: '执行结果待确认' };
      var reviewNames = { pass: '复查通过', needs_human: '等待你决定', block: '已阻断' };
      var reviewTone = { pass: 'ok', needs_human: 'warn', block: 'danger' };
      var resultNames = { working: '执行中', awaiting_verification: '待验收', passed: '已交付', needs_attention: '需要核对' };
      var resultTone = { working: 'info', awaiting_verification: 'warn', passed: 'ok', needs_attention: 'danger' };
      // Coordinator 的目录解析来源：中文说明，别把内部枚举甩给用户。
      var sourceLabel = { explicit: '你指定的', intent: '按意图识别', session: '继承会话', unbound: '未识别', ambiguous: '需要你选' };
      var availableExecutors = ['craft'];
      var configuredCraftModel = function () {
        var models = (state.composer && state.composer.models) || [];
        var chosen = models.filter(function (item) { return item.configured; })[0];
        return chosen ? String(chosen.id) : '';
      };
      var syncSend = function () { send.disabled = !String(input.value || '').trim(); };
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
            if (result.summary) detailRows.push('<span>结论：' + esc(String(result.summary)) + '</span>');
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
              (worker.reason ? ' · ' + esc(String(worker.reason)) : '') + '</span>' +
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
      settled(api('/api/workbench/agent-sessions/providers'), { providers: [] }).then(function (catalog) {
        var available = (catalog.providers || []).filter(function (item) { return item.status === 'available' || item.status === 'plugin'; })
          .map(function (item) { return String(item.id); });
        if (configuredCraftModel()) available = available.filter(function (item) { return item !== 'craft'; }).concat('craft');
        availableExecutors = available.length ? available : ['craft'];
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

function newSessionDrawer(workspace) {
  var requestPending = false;
  var creationMayExist = false;
  var pendingTaskId = '';
  var operationId = '';
  var configuredModels = (state.composer.models || []).filter(function (item) { return item.configured; });
  var selectedModel = state.composer.model || (configuredModels[0] && configuredModels[0].id) || '';
  var modelOptions = configuredModels.map(function (item) {
    return '<option value="' + esc(item.id) + '"' + (selectedModel === item.id ? ' selected' : '') + '>' +
      esc(item.name || item.model || item.id) + '</option>';
  }).join('');
  return {
    title: '新建任务',
    sub: '先写清楚要完成什么，再选择工作目录、执行工具和权限。创建失败时会保留输入。',
    html:
      '<label class="field"><span>工作目录</span><input type="text" data-field="workspace" placeholder="选择或粘贴项目文件夹路径" value="' +
      esc(workspace || '') + '"><span class="hint">任务和执行器会在这个目录下工作。</span></label>' +
      '<label class="field"><span>执行工具</span><select data-field="provider"><option value="codex">Codex CLI</option><option value="claude">Claude Code</option><option value="dsh">DSH</option><option value="craft">Craft 对话</option></select></label>' +
      '<label class="field"><span>模型</span><select data-field="model"><option value="">使用工具默认模型</option>' + modelOptions + '</select></label>' +
      '<label class="field"><span>执行权限</span><select data-field="permission"><option value="ask">每次操作前询问</option><option value="auto">按任务权限规则</option><option value="full">完整访问</option></select></label>' +
      '<label class="field"><span>任务目标</span><textarea data-field="prompt" rows="4" required placeholder="例如：修复登录超时，并补上回归用例。描述期望结果和必须遵守的限制。"></textarea><span class="hint">这段内容会作为任务目标和执行器的第一条消息。</span></label><p class="hint" data-create-status aria-live="polite"></p>',
    mount: function (card) {
      var provider = card.querySelector('[data-field="provider"]');
      var model = card.querySelector('[data-field="model"]');
      if (!provider || !model) return;
      var loaded = false;
      function loadCraftModels() {
        if (loaded || model.options.length > 1) return;
        loaded = true;
        api('/api/config/models').then(function (result) {
          var models = (result.models || []).filter(function (item) { return item && item.configured; });
          state.composer.models = result.models || [];
          models.forEach(function (item) { model.add(new Option(item.name || item.model || item.id, item.id)); });
          if (models[0] && !model.value) { model.value = models[0].id; state.composer.model = models[0].id; }
        }).catch(function () { loaded = false; });
      }
      provider.onchange = function () { if (provider.value === 'craft') loadCraftModels(); };
      if (provider.value === 'craft') loadCraftModels();
    },
    actions: [
      { label: '取消', icon: 'x', run: function () { dismissInline('tasks'); } },
      { label: '新建', icon: 'plus', primary: true, run: function () {
        if (requestPending) return;
        if (creationMayExist) { toast('上次请求结果尚未确认。请先检查「我的任务」，避免重复创建。', true); return; }
        var card = doc ? doc.querySelector('.inline-form') : null;
        var ws = (card && card.querySelector('[data-field="workspace"]')) ? card.querySelector('[data-field="workspace"]').value.trim() : '';
        var provider = (card && card.querySelector('[data-field="provider"]')) ? card.querySelector('[data-field="provider"]').value : '';
        var model = (card && card.querySelector('[data-field="model"]')) ? card.querySelector('[data-field="model"]').value : '';
        var permission = (card && card.querySelector('[data-field="permission"]')) ? card.querySelector('[data-field="permission"]').value : 'ask';
        var prompt = (card && card.querySelector('[data-field="prompt"]')) ? card.querySelector('[data-field="prompt"]').value.trim() : '';
        if (!ws) { toast('请填写工作区路径。', true); return; }
        if (!prompt) { toast('请描述任务目标再创建。', true); var input = card && card.querySelector('[data-field="prompt"]'); if (input && typeof input.focus === 'function') input.focus(); return; }
        if (!model && provider === 'craft') {
          var configured = (state.composer.models || []).filter(function (item) { return item.configured; })[0];
          model = configured ? configured.id : '';
        }
        if (provider === 'craft' && !model) { toast('请先在设置中添加可用的 Craft 模型。', true); return; }
        var providerName = provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude' : provider === 'dsh' ? 'DSH' : 'Craft';
        var title = (prompt.split(/\r?\n/)[0] || '新建 ' + providerName + ' 会话').slice(0, 60);
        var permissionMode = permission === 'full' ? 'full_access' : permission === 'auto' ? 'assisted_approval' : 'human_approval';
        var opId = operationId || ((host.crypto && host.crypto.randomUUID) ? host.crypto.randomUUID() : String(Date.now()) + String(Math.random()));
        operationId = opId;
        pendingTaskId = pendingTaskId || 'task_' + ((host.crypto && host.crypto.randomUUID) ? host.crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + String(Math.random()).slice(2));
        requestPending = true;
        var status = card && card.querySelector('[data-create-status]');
        if (status) status.textContent = '正在创建任务…';
        var controls = card ? card.querySelectorAll('input, select, textarea') : [];
        Array.prototype.forEach.call(controls, function (control) { control.disabled = true; });
        api('/api/tasks', { method: 'POST', body: {
          task_id: pendingTaskId, title: title, goal: prompt, workspace: ws,
          ...(provider === 'craft' ? { model_id: model } : {}), permission_mode: permissionMode,
        } }).then(function (created) {
          var taskId = String((created.task || created).id);
          if (provider === 'craft') {
            if (!prompt) return { task_id: taskId };
            return api('/api/tasks/' + encodeURIComponent(taskId) + '/messages', { method: 'POST', body: {
              content: prompt, model_id: model, permission_mode: permissionMode,
            } }).then(function () { return { task_id: taskId }; });
          }
          if (provider === 'codex') {
            return api('/api/workbench/agent-sessions', { method: 'POST', body: {
              task_id: taskId, workspace: ws, provider: 'codex', model: model || null,
              permission: permission, operation_id: opId,
            } }).then(function (createdSession) {
              var link = createdSession.link || {};
              if (!prompt || !link.id) return { task_id: taskId, link: link };
              return api('/api/workbench/agent-sessions/' + encodeURIComponent(String(link.id)) + '/turns', { method: 'POST', body: {
                task_id: taskId, prompt: prompt, operation_id: opId + '-turn', work_mode: 'default',
              } }).then(function () { return { task_id: taskId, link: link }; });
            });
          }
          var base = provider === 'claude' ? '/api/workbench/claude-runs' : '/api/workbench/dsh-runs';
          return api(base, { method: 'POST', body: {
            task_id: taskId, workspace: ws, prompt: prompt, permission: permission,
            model: model || null, work_mode: 'default', operation_id: opId,
          } }).then(function () { return { task_id: taskId }; });
        }).then(function (result) {
          creationMayExist = false;
          requestPending = false;
          dismissInline('tasks');
          toast('会话已创建。');
          state.composer.folder = ws;
          renderFolderTree(true);
          openTask(String(result.task_id));
        }).catch(function (error) {
          requestPending = false;
          creationMayExist = true;
          Array.prototype.forEach.call(controls, function (control) { control.disabled = true; });
          if (status) status.textContent = '创建状态未知，输入已保留。请先到「我的任务」确认是否已出现同名任务，再决定下一步；本表单不会重复提交。';
          fail(error);
        });
      }}
    ]
  };
}

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
            '<span class="row-sub">' + esc(item.reason || '') + (item.workspace_id ? ' · 工作区 ' + esc(String(item.workspace_id)) : '') + '</span>' +
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
      aside: asideBlock('任务状态', '', '<div class="aside-note">状态来自真实记录：执行中的 Host/原生会话、待批准的控制点、持久队列、失败结果与未知回合。没有信号的任务显示为待输入，而不是被丢弃。</div>'),
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
  return { viewHome, viewPilot, newSessionDrawer, viewMyTasks };
}
