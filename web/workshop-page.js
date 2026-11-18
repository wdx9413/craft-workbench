/**
 * 工作台页面（按项目与原生会话工作）。
 *
 * 独立模块：只依赖窄 ctx，不引用控制台或领航员的任何代码。
 */
export function createWorkshopPage(ctx) {
  const { state, api, toast, fail, go, esc, icon, label, importNativeSession, mountAgentWorkspace, workspacePathOf, renderFolderTree, asideBlock } = ctx;
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
            var modContributions = (results[3] && results[3].mod_contributions) || [];
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
            modContributions.forEach(function (item) {
              var contribution = item.contribution || {};
              var insertionPoint = String(contribution.insertion_point || '');
              var target = insertionPoint === 'composer_toolbar' ? agentRoot.querySelector('.agent-compose-actions')
                : insertionPoint === 'task_context' ? contributionHost
                  : insertionPoint === 'project_sidebar' ? root.querySelector('#project-sidebar, .project-sidebar')
                    : insertionPoint === 'task_header' ? agentRoot.querySelector('.agent-workspace-header, .agent-head') : null;
              if (!target) {
                if (contributionHost) {
                  contributionHost.hidden = false;
                  var unsupported = host.document.createElement('p');
                  unsupported.className = 'aside-note';
                  unsupported.textContent = 'Mod「' + String(item.mod_name || item.mod_id) + '」的「' + insertionPoint + '」位置在当前页面不可用。';
                  contributionHost.appendChild(unsupported);
                }
                return;
              }
              var panel = host.document.createElement('div');
              panel.className = 'mod-ui-contribution';
              panel.setAttribute('data-mod-id', String(item.mod_id));
              panel.setAttribute('data-contribution-id', String(contribution.id));
              panel.setAttribute('aria-label', 'Mod 提供的 ' + insertionPoint + ' 内容');
              var heading = host.document.createElement('b');
              heading.textContent = String(item.mod_name || item.mod_id);
              panel.appendChild(heading);
              (Array.isArray(contribution.layout) ? contribution.layout : []).forEach(function (control) {
                var kind = String(control.type || '');
                if (kind === 'text' || kind === 'status') {
                  var label = host.document.createElement(kind === 'status' ? 'span' : 'p');
                  label.className = kind === 'status' ? 'pill' : 'aside-note';
                  label.textContent = String(control.label || '');
                  panel.appendChild(label);
                } else if (kind === 'button') {
                  var button = host.document.createElement('button');
                  button.className = 'btn sm'; button.type = 'button'; button.textContent = String(control.label || '打开');
                  button.setAttribute('data-mod-action', String(control.action_id || ''));
                  button.onclick = function () {
                    if (!host.crypto || typeof host.crypto.randomUUID !== 'function') { toast('此环境无法安全提交 Mod 操作', true); return; }
                    button.disabled = true;
                    api('/api/workbench/mods/' + encodeURIComponent(item.mod_id) + '/contributions/' + encodeURIComponent(contribution.id) + '/actions/' + encodeURIComponent(control.action_id), {
                      method: 'POST', body: { workspace_id: workspaceId, request_id: host.crypto.randomUUID() }
                    }).then(function () { toast('Mod 操作已通过 Craft Runtime 处理'); })
                      .catch(function (error) { toast('Mod 操作未执行：' + String(error && error.message || error), true); })
                      .finally(function () { button.disabled = false; });
                  };
                  panel.appendChild(button);
                }
              });
              target.appendChild(panel);
            });
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
  return { viewHome };
}
