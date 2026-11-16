/**
 * 新建会话表单：领航员与控制台共用的唯一一份实现。
 *
 * 这里只放两个模式都需要的“创建任务 + 选择执行器”表单，模式专属页面不引用
 * 它之外的任何内容，避免三套页面互相加载。
 */
export function createNewSessionDrawer(ctx) {
  const { state, api, toast, fail, openTask, esc, label, dismissInline, renderFolderTree } = ctx;
  const doc = ctx.doc || (typeof document === 'undefined' ? null : document);
  const host = ctx.host || (typeof window === 'undefined' ? {} : window);
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
  return newSessionDrawer;
}
