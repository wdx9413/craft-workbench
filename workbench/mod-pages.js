/**
 * Mod 页与文件目录描述页：把 NEEDREAD P0 能力露到工作台 UI。
 */
export function createModPages({ api, presentation, notify, fail, ask, operator, paint, go, openInlineOn }) {
  const { icon, esc, head, emptyState, asideBlock, pill, shortTime } = presentation;
  const operatorOf = typeof operator === 'function' ? operator : () => 'unattributed';
  const toast = notify;

  function val(id) { var node = document.getElementById(id); return node ? String(node.value || '').trim() : ''; }

  function clip(text, max) {
    var t = String(text == null ? '' : text);
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  function rowTitle(value) {
    var raw = String(value == null ? '' : value);
    var shown = clip(raw, 180);
    if (shown === raw) return '<span class="row-title">' + esc(raw) + '</span>';
    return '<details class="row-details"><summary class="row-title" title="' + esc(raw) + '">' + esc(shown) +
      '</summary><p class="row-full">' + esc(raw) + '</p></details>';
  }

  function modStatusLabel(status, enabled) {
    if (status === 'active' && enabled) return pill('已生效', 'ok');
    if (status === 'active' && !enabled) return pill('已生效·已停用', 'muted');
    if (status === 'pending') return pill('待批准', 'warn');
    if (status === 'revoked') return pill('已撤销', 'danger');
    return pill('草稿', '');
  }

  function modRow(m) {
    var actions = '<div class="row-actions">' + modStatusLabel(m.status, m.enabled) +
      '<span class="row-sub">v' + esc(m.version) + ' · ' + esc(m.applies_to || 'worker') + ' · ' + esc(m.scope_kind || 'global') + '</span>';
    if (m.status === 'pending') actions += '<button class="btn sm primary" type="button" data-mod-approve="' + esc(m.id) + '">批准</button>';
    if (m.selfEvolved) {
      actions += '<span class="row-sub">自进化 · ' + esc(m.failureClass || '') + ' · 影子测试 ' + esc(m.shadowTest || 'pending') +
        (m.evidenceId ? ' · 证据 ' + esc(m.evidenceId) : '') + '</span>';
      if (m.shadowTest !== 'passed') actions += '<button class="btn sm" type="button" data-mod-shadow="' + esc(m.id) + '">跑影子回归</button>';
    }
    if (m.status === 'active') {
      actions += '<button class="btn sm" type="button" data-mod-enable="' + esc(m.id) + '" data-enable="' + m.enabled + '">' + (m.enabled ? '停用' : '启用') + '</button>';
      actions += '<button class="btn sm danger" type="button" data-mod-revoke="' + esc(m.id) + '">撤销</button>';
    }
    if (m.status !== 'active') actions += '<button class="btn sm" type="button" data-mod-edit="' + esc(m.id) + '">编辑</button>';
    if (Number(m.version) > 1) {
      actions += '<button class="btn sm primary" type="button" data-mod-rollback-previous="' + esc(m.id) + '">回到上一版</button>' +
        '<button class="btn sm" type="button" data-mod-rollback="' + esc(m.id) + '" data-mod-version="' + esc(m.version) + '">指定版本</button>';
    }
    actions += '</div>';
    return '<div class="row"><span class="row-lead muted">' + icon('layers') + '</span><div class="row-main">' +
      rowTitle(m.name || m.id) + '<span class="row-sub">' + esc(m.body ? String(m.body).slice(0, 120) : '') + '</span>' + actions + '</div></div>';
  }

  function section(title, rowsHtml) {
    if (!rowsHtml) return '';
    return '<div class="rows"><h3 class="section-title">' + esc(title) + '</h3>' + rowsHtml + '</div>';
  }

  function viewMods() {
    return api('/api/workbench/mods/list').then(function (result) {
      var items = (result && result.items) || [];
      var byStatus = items.reduce(function (acc, item) { (acc[item.status] = acc[item.status] || []).push(item); return acc; }, {});
      var rows = '';
      rows += section('待批准', (byStatus.pending || []).map(modRow).join(''));
      rows += section('已生效', (byStatus.active || []).map(modRow).join(''));
      rows += section('草稿', (byStatus.draft || []).map(modRow).join(''));
      rows += section('已撤销', (byStatus.revoked || []).map(modRow).join(''));
      var header = head('认知约束（Mod）', 'Mod 是注入 Worker/Reviewer 上下文的行为规范；仅已生效且启用的才会进入上下文',
        '<button class="btn primary" id="mod-add" type="button">' + icon('plus') + '新建 Mod</button>');
      var body = '<div class="card-body"><div class="rows">' + (rows || emptyState('还没有 Mod', '新建一条 Mod 后先以草稿形态存在，批准并启用后才会被注入上下文。', 'layers')) + '</div></div>';
      return {
        html: '<div class="stack"><div class="card">' + header + body + '</div></div>',
        aside: asideBlock('批准流程', '', '<div class="aside-note">新建 Mod 为草稿；由你点批准生效后写入签名与版本。已生效的 Mod 不可直接编辑，需撤销后重建。</div>'),
        mounts: [function (root) {
          var add = root.querySelector('#mod-add');
          if (add) add.onclick = function () { openModEditor(); };
          root.querySelectorAll('[data-mod-approve]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-mod-approve');
              var reason = ask('批准这条 Mod 的理由（可留空）');
              if (reason === null) return;
              button.disabled = true;
              api('/api/workbench/mods/' + encodeURIComponent(id) + '/approve', { method: 'POST', body: { approved_by: operatorOf(), reason: String(reason || '').trim() } })
                .then(function () { toast('Mod 已批准并生效'); paint('mods'); }).catch(function (e) { button.disabled = false; fail(e); });
            };
          });
          root.querySelectorAll('[data-mod-enable]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-mod-enable');
              // data-enable records the current state; the click flips it.
              var enable = button.getAttribute('data-enable') !== 'true';
              api('/api/workbench/mods/' + encodeURIComponent(id) + '/' + (enable ? 'enable' : 'disable'), { method: 'POST', body: {} })
                .then(function () { toast(enable ? 'Mod 已启用' : 'Mod 已停用'); paint('mods'); }).catch(fail);
            };
          });
          root.querySelectorAll('[data-mod-revoke]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-mod-revoke');
              if (!confirm('确定撤销这条 Mod 吗？撤销后它将不再进入上下文。')) return;
              api('/api/workbench/mods/' + encodeURIComponent(id) + '/revoke', { method: 'POST', body: {} })
                .then(function () { toast('Mod 已撤销'); paint('mods'); }).catch(fail);
            };
          });
          root.querySelectorAll('[data-mod-edit]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-mod-edit');
              var item = items.filter(function (m) { return m.id === id; })[0];
              if (item) openModEditor(item);
            };
          });
          root.querySelectorAll('[data-mod-shadow]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-mod-shadow');
              // 结论由确定性回归集给出，按钮不能替系统宣称通过。
              api('/api/workbench/mods/shadow-test/run', { method: 'POST', body: { id: id } })
                .then(function (result) {
                  var verdict = result.regression ? result.regression.verdict : result.shadowTest;
                  toast(verdict === 'passed' ? '影子回归通过，可批准生效' :
                    '影子回归未通过（' + String((result.regression && result.regression.failed) || 0) + ' 项失败），不予批准');
                  paint('mods');
                }).catch(fail);
            };
          });
          root.querySelectorAll('[data-mod-rollback]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-mod-rollback');
              var current = Number(button.getAttribute('data-mod-version'));
              var target = Number(ask('回滚到哪个历史版本？（当前 v' + current + '，需小于 ' + current + '）'));
              if (!Number.isInteger(target) || target < 1 || target >= current) { toast('版本号无效', true); return; }
              api('/api/workbench/mods/rollback', { method: 'POST', body: { id: id, to_version: target } })
                .then(function () { toast('已回滚到 v' + target + '（写为新版本）'); paint('mods'); }).catch(fail);
            };
          });
          root.querySelectorAll('[data-mod-rollback-previous]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-mod-rollback-previous');
              api('/api/workbench/mods/rollback/previous', { method: 'POST', body: { id: id } })
                .then(function () { toast('已回到上一稳定版本（写为新版本）'); paint('mods'); }).catch(fail);
            };
          });
        }]
      };
    });
  }

  function openModEditor(item) {
    item = item || {};
    openInlineOn('mods', {
      title: item.id ? '编辑 Mod' : '新建 Mod',
      sub: item.id ? '修改草稿；已生效的 Mod 不可直接编辑，需撤销后重建。' : '新建一条行为规范，先保留为草稿，再批准生效。',
      html: '<div class="field"><label for="mod-name">名称</label><input id="mod-name" value="' + esc(item.name || '') + '"></div>' +
        '<div class="field"><label for="mod-body">行为规范正文（Markdown / YAML）</label><textarea id="mod-body" class="tall">' + esc(item.body || '') + '</textarea></div>' +
        '<div class="field-row"><div class="field"><label for="mod-scope-kind">范围种类</label><select id="mod-scope-kind"><option value="global">全局</option><option value="project">项目</option><option value="task">任务</option></select></div>' +
        '<div class="field"><label for="mod-scope-id">范围 ID（全局留空）</label><input id="mod-scope-id" value="' + esc(item.scope_id || '') + '"></div>' +
        '<div class="field"><label for="mod-applies-to">适用对象</label><select id="mod-applies-to"><option value="worker">Worker</option><option value="reviewer">Reviewer</option><option value="all">全部</option></select></div></div>',
      actions: [{ label: '保存草稿', primary: true, run: function () {
        var body = { mod_id: item.id, name: val('mod-name'), body: val('mod-body'), scope_kind: val('mod-scope-kind') || 'global', scope_id: val('mod-scope-id') || undefined, applies_to: val('mod-applies-to') || 'worker' };
        api('/api/workbench/mods', { method: 'POST', body: body }).then(function () { toast(item.id ? 'Mod 已更新为草稿' : 'Mod 已新建为草稿'); paint('mods'); }).catch(fail);
      } }]
    });
  }

  function viewFileDirDesc() {
    return api('/api/workbench/file-dir-desc/list?limit=200').then(function (result) {
      var items = (result && result.items) || [];
      var rows = items.length ? items.map(function (item) {
        var actions = '<button class="btn sm" type="button" data-desc-promote="' + esc(item.id) + '">提升正式</button>';
        return '<div class="row"><span class="row-lead muted">' + icon('folder') + '</span><div class="row-main">' +
          rowTitle(item.path) + '<span class="row-sub">' + esc(item.description || '（暂无描述）') + ' · ' + esc(item.hostKind || 'local') +
          ' · 已用 ' + Number(item.useCount || 0) + ' 次 · ' + modStatusLabel(item.status, item.status === 'promoted') + '</span>' + actions + '</div></div>';
      }).join('') : '';
      var form = '<input id="desc-path" placeholder="绝对路径"><input id="desc-desc" placeholder="语义描述">' +
        '<select id="desc-host"><option value="local">本地</option><option value="cloud">云端</option></select>' +
        '<button class="btn primary" id="desc-record" type="button">' + icon('plus') + '记录</button>';
      var body = '<div class="card-body"><div class="rows">' + (rows || emptyState('还没有目录记录', '先记录一个目录，再反复使用，它会自动提升为正式可召回条目。', 'folder')) + '</div></div>';
      return {
        html: '<div class="stack"><div class="card">' + head('目录 ↔ 语义描述', '记录常用目录与它的含义，按语义找目录、按目录找含义；用过才存，常用才转正。', form) + body + '</div></div>',
        aside: asideBlock('检索', '', '<div class="field"><label>按描述查目录</label><input id="desc-query" placeholder="描述关键词"></div>' +
          '<button class="btn" id="desc-search" type="button">' + icon('search') + '搜索</button>' +
          '<pre id="desc-result" class="out" style="white-space:pre-wrap;margin-top:8px"></pre>' +
          '<div class="aside-note">只会召回已转正条目；一条目录被使用 3 次后自动转正，或手动提升正式。</div>'),
        mounts: [function (root) {
          var recordBtn = root.querySelector('#desc-record');
          if (recordBtn) recordBtn.onclick = function () {
            var path = val('desc-path'), desc = val('desc-desc');
            if (!path || !desc) { toast('路径与描述都必填', true); return; }
            recordBtn.disabled = true;
            api('/api/workbench/file-dir-desc/record', { method: 'POST', body: { path: path, description: desc, host_kind: val('desc-host') || 'local' } })
              .then(function () { toast('目录已记录'); paint('filedir'); recordBtn.disabled = false; }).catch(function (e) { recordBtn.disabled = false; fail(e); });
          };
          var searchBtn = root.querySelector('#desc-search');
          if (searchBtn) searchBtn.onclick = function () {
            var query = val('desc-query');
            if (!query) { toast('请输入描述关键词', true); return; }
            searchBtn.disabled = true;
            api('/api/workbench/file-dir-desc/resolve?description=' + encodeURIComponent(query) + '&limit=10')
              .then(function (res) {
                var results = (res && res.results) || [];
                var pre = root.querySelector('#desc-result');
                if (pre) pre.textContent = results.length ? results.map(function (r) { return '- ' + r.path + ' （' + r.description + '）'; }).join('\n') : '未匹配到已转正的目录';
                searchBtn.disabled = false;
              }).catch(function (e) { searchBtn.disabled = false; fail(e); });
          };
          root.querySelectorAll('[data-desc-promote]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-desc-promote');
              api('/api/workbench/file-dir-desc/promote', { method: 'POST', body: { id: id } })
                .then(function () { toast('目录已提升为正式'); paint('filedir'); }).catch(fail);
            };
          });
        }]
      };
    });
  }

  function viewOnboarding() {
    return api('/api/settings').then(function (result) {
      var done = result && result.workbench && result.workbench.onboarding;
      var completedAt = done ? done.completedAt : null;
      var right = completedAt ? '<button class="btn primary" id="onboard-reset" type="button">' + icon('refresh') + '重新引导</button>'
        : '<button class="btn primary" id="onboard-go" type="button">' + icon('spark') + '去设置模型</button>';
      var body = '<div class="card-body"><div class="row"><span class="row-title">状态</span><span class="row-sub">' +
        (completedAt ? '已完成于 ' + esc(shortTime(completedAt)) : '尚未完成') + '</span></div>' +
        '<div class="row"><span class="row-title">作用</span><span class="row-sub">只影响首次登录的向导弹窗；已完成的不会再显示。</span></div>' +
        '<div class="row"><span class="row-title">工作目录</span><span class="row-sub">不在引导里绑定：领航员模式按意图自动识别，灵策/观象在创建任务时选择。</span></div></div>';
      return {
        html: '<div class="stack"><div class="card">' + head('一次性引导', '首次打开后配置一个模型，完成后终身不再弹出。', right) + body + '</div></div>',
        mounts: [function (root) {
          var goBtn = root.querySelector('#onboard-go');
          if (goBtn) goBtn.onclick = function () { go('models'); };
          var resetBtn = root.querySelector('#onboard-reset');
          if (resetBtn) resetBtn.onclick = function () {
            api('/api/settings/onboarding/reset', { method: 'POST', body: {} }).then(function () { toast('引导已重新启用'); paint('onboard'); }).catch(fail);
          };
        }]
      };
    });
  }

  function viewModeConfirm() {
    return api('/api/workbench/task-active-count').then(function (result) {
      var running = result && result.running ? Number(result.running) : 0;
      var queued = result && result.queued ? Number(result.queued) : 0;
      var body = '<div class="card-body"><div class="row"><span class="row-title">运行中</span><span class="row-sub">' + running + ' 个</span></div>' +
        '<div class="row"><span class="row-title">排队中</span><span class="row-sub">' + queued + ' 个</span></div>' +
        '<p class="doc-p">切换到领航 / 观象 / 灵策 只改变导航与展示，不会停止或改动任何任务。</p></div>';
      return { html: '<div class="stack"><div class="card">' + head('切换模式确认', '后台任务不会被切换中断；若有运行中/排队任务，可在此确认后继续。', '') + body + '</div></div>', mounts: [] };
    });
  }

  /** 控制台「自进化观察室」：Agent 最近自己总结了什么，可批准或废弃。 */
  function viewEvolution() {
    return Promise.all([
      api('/api/workbench/mods/list').catch(function () { return { items: [] }; }),
      api('/api/workbench/plugin-discovery/list?status=proposed').catch(function () { return { items: [] }; }),
      api('/api/workbench/pilot/failure-observations').catch(function () { return { items: [] }; }),
      api('/api/workbench/pilot/outcomes').catch(function () { return { counts: {}, total: 0, items: [] }; })
    ]).then(function (results) {
      var mods = (results[0] && results[0].items) || [];
      var discoveries = (results[1] && results[1].items) || [];
      var failures = (results[2] && results[2].items) || [];
      var outcomes = results[3] || { counts: {}, total: 0, items: [] };
      var modRows = mods.filter(function (m) { return m.selfEvolved || m.status === 'pending'; }).map(function (m) {
        return '<div class="row"><span class="row-lead muted">' + icon('layers') + '</span><div class="row-main">' +
          rowTitle(m.name || m.id) + '<span class="row-sub">' + esc(m.failureClass || m.status) + ' · 影子测试 ' + esc(m.shadowTest || 'n/a') +
          (m.evidenceId ? ' · 证据 ' + esc(m.evidenceId) : '') + '</span></div>' + modStatusLabel(m.status, m.enabled) + '</div>';
      }).join('');
      var discoveryRows = discoveries.map(function (d) {
        return '<div class="row"><span class="row-lead muted">' + icon('plug') + '</span><div class="row-main">' +
          rowTitle(d.capability + ' 插件发现') + '<span class="row-sub">' + esc(d.reason) + ' · 候选 ' + esc(d.candidate_count) + ' 个 · 不写宿主配置</span></div>' +
          '<button class="btn sm primary" type="button" data-discovery-approve="' + esc(d.id) + '">批准提案</button></div>';
      }).join('');
      var failureRows = failures.map(function (f) {
        return '<div class="row"><span class="row-lead muted">' + icon('alert') + '</span><div class="row-main">' +
          rowTitle('未归因的失败 · ' + (f.task_id || f.id)) + '<span class="row-sub">' + esc(f.summary || '结果需要核对') +
          ' · 依据 ' + esc(String(f.evidence_count || 0)) + ' · 验收 ' + esc(String(f.acceptance_count || 0)) +
          ' · 待办 ' + esc(String(f.attention_count || 0)) + '</span></div>' +
          '<button class="btn sm" type="button" data-failure-attribute="' + esc(f.id) + '">记录归因</button></div>';
      }).join('');
      var outcomeNames = { accepted: '直接采纳', accepted_with_edits: '改过再用', rejected: '驳回重来' };
      var outcomeRows = (outcomes.items || []).slice(0, 8).map(function (o) {
        return '<div class="row"><span class="row-lead muted">' + icon('check') + '</span><div class="row-main">' +
          rowTitle(String(o.task_id)) + '<span class="row-sub">' + esc(outcomeNames[o.verdict] || o.verdict) +
          (o.note ? ' · ' + esc(String(o.note)) : '') + '</span></div></div>';
      }).join('');
      var outcomeHead = outcomes.total ? '<h3 class="section-title">交付结局（飞轮真值 · 共 ' +
        esc(String(outcomes.total)) + ' 次：直接采纳 ' + esc(String(outcomes.counts.accepted || 0)) +
        ' / 改过再用 ' + esc(String(outcomes.counts.accepted_with_edits || 0)) +
        ' / 驳回重来 ' + esc(String(outcomes.counts.rejected || 0)) + '）</h3>' + outcomeRows : '';
      var body = '<div class="card-body"><div class="rows">' +
        (modRows || emptyState('还没有自进化候选', '归因后自动生成的 Mod 候选会出现在这里。', 'layers')) +
        (discoveryRows ? '<h3 class="section-title">插件发现提案</h3>' + discoveryRows : '') +
        (failureRows ? '<h3 class="section-title">待归因的失败轨迹</h3>' + failureRows : '') +
        outcomeHead +
        '</div></div>';
      return {
        html: '<div class="stack"><div class="card">' + head('自进化观察室', 'Agent 最近自己总结了什么；批准前必须过影子测试，插件提案不会自动安装。', '') + body + '</div></div>',
        mounts: [function (root) {
          root.querySelectorAll('[data-discovery-approve]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-discovery-approve');
              api('/api/workbench/plugin-discovery/approve', { method: 'POST', body: { id: id, approved_by: operatorOf() } })
                .then(function () { toast('插件发现提案已批准（未自动安装）'); paint('evolution'); }).catch(fail);
            };
          });
          root.querySelectorAll('[data-failure-attribute]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-failure-attribute');
              // 观测必须人说：这里只收集可核验的信号，原因由后端 attributeFailure 判定。
              var observed = globalThis.prompt && globalThis.prompt(
                '这次失败哪些是可核验的事实？多个用逗号分隔：\n' +
                'relevant_retrieved=false, source_contained_answer=false, fact_extracted=false, ' +
                'answer_wrong_with_full_context=true, wrong_scope_applied=true, superseded_by_newer=true\n' +
                '留空表示观测不足，系统会如实记为「无法归因」而不编造规则。');
              if (observed === null) return;
              var signals = {};
              String(observed).split(/[,，\s]+/u).filter(Boolean).forEach(function (pair) {
                var parts = pair.split('=');
                if (parts.length !== 2 || !parts[0]) return;
                if (parts[1] === 'true' || parts[1] === 'false') signals[parts[0].trim()] = parts[1] === 'true';
              });
              api('/api/workbench/pilot/failure-observations/attribute', { method: 'POST', body: {
                observation_id: id, signals: signals, attributed_by: operatorOf()
              } }).then(function (result) {
                toast(result.mod ? '已归因，生成待影子测试的 Mod 候选' : '观测不足，如实记为无法归因');
                paint('evolution');
              }).catch(fail);
            };
          });
        }]
      };
    });
  }

  /** 控制台「异常阻塞队列」：Worker/Reviewer 超过 3 轮被硬中断的任务。 */
  function viewBlockedQueue() {
    return api('/api/workbench/pilot/blocked-queue').then(function (result) {
      var items = (result && result.items) || [];
      var rows = items.map(function (item) {
        return '<div class="row"><span class="row-lead muted">' + icon('alert') + '</span><div class="row-main">' +
          rowTitle(item.task_id || item.id) + '<span class="row-sub">' + esc(item.suspended_reason || '已挂起') +
          ' · ' + esc(item.executor_template || '') + ' · ' + esc(item.suspended_at || '') + '</span></div>' +
          '<button class="btn sm primary" type="button" data-blocked-resume="' + esc(item.session_id) + '">解除熔断</button></div>';
      }).join('');
      var body = '<div class="card-body"><div class="rows">' +
        (rows || emptyState('没有异常阻塞任务', 'Worker 与 Reviewer 超过 3 轮仍未达成一致时，任务会自动挂到这里并等待人工核对。', 'check')) +
        '</div></div>';
      return {
        html: '<div class="stack"><div class="card">' + head('异常阻塞队列', '硬中断熔断后的任务；核对后可解除，解除只回到排队态，不自动重跑。', '') + body + '</div></div>',
        mounts: [function (root) {
          root.querySelectorAll('[data-blocked-resume]').forEach(function (button) {
            button.onclick = function () {
              var sessionId = button.getAttribute('data-blocked-resume');
              api('/api/workbench/pilot/resume-session?session_id=' + encodeURIComponent(sessionId), { method: 'POST', body: {} })
                .then(function () { toast('已解除熔断，任务回到排队态'); paint('blocked'); }).catch(fail);
            };
          });
        }]
      };
    });
  }

  return { mods: viewMods, filedir: viewFileDirDesc, onboard: viewOnboarding, modeConfirm: viewModeConfirm,
    evolution: viewEvolution, blocked: viewBlockedQueue };
}
