/** Resource pages own rendering and DOM actions; shell owns navigation and editors. */
import { bindRecallAudit, bindWeightTrend } from './recall-audit.js';
export function createResourcePages({ api, presentation, editors, refresh, notify, fail, scope: currentScope, ask, operator }) {
  const askText = typeof ask === "function" ? ask : (message) => (typeof globalThis.prompt === "function" ? globalThis.prompt(message) : "");
  // Never invent a signature: with no configured operator the record says so.
  const operatorOf = typeof operator === "function" ? operator : () => "unattributed";
  const { icon, esc, head, emptyState, asideBlock, catalogRows, countChip, label, STATUS_LABELS, shortTime, pill } = presentation;
  const { memory: openMemoryEditor, workflow: openWorkflowEditor } = editors;
  const paint = refresh, toast = notify;
  // Callers normalize the value once; passing null through a second time would be
  // a default nothing can reach.
  function clip(text, max) { return text.length > max ? text.slice(0, max - 1) + '…' : text; }
  /** A long record stays scannable but can be opened in place, without a hover-only tooltip. */
  function rowTitle(value) {
    var text = String(value ?? '');
    // Clip first and let it decide: the short branch is the common case, not a
    // second threshold that only the long case can reach.
    var shown = clip(text, 180);
    if (shown === text) return '<span class="row-title">' + esc(text) + '</span>';
    return '<details class="row-details"><summary class="row-title" title="' + esc(text) + '">' + esc(shown) +
      '</summary><p class="row-full">' + esc(text) + '</p></details>';
  }
  /** Show where this kind is mirrored, so the copy is visible where the records are. */
  function mirrorNote(result, kind) {
    var status = ((result && result.status) || []).filter(function (entry) { return entry.kind === kind; })[0];
    if (!status || status.mode !== 'mirror') return '本地保存；可在设置里镜像到 Obsidian vault 或任意目录。';
    return '镜像到 ' + (status.path || '未设置目录') + (status.ok ? '' : '（不可写：' + (status.detail || '未知原因') + '）');
  }
  function viewMemory() {
    return Promise.all([
      api('/api/workbench/resources?kind=memory&limit=100&history=1'),
      api('/api/workbench/context-storage').catch(function () { return { status: [] }; })
    ]).then(function (results) {
      var result = results[0], items = result.items || [];
      var rows = items.length ? '<div class="rows">' + items.map(function (item) {
        var status = String(item.status || 'active');
        // Same ranking signal recall uses: helpful receipts raise, corrections lower.
        var weight = item.recall_weight === undefined ? 1 : Number(item.recall_weight);
        var sub = [item.kind, item.scope, item.source, status === 'active' ? null : label(STATUS_LABELS, status, status),
          item.valid_until ? '有效至 ' + item.valid_until : null,
          // Who put this memory forward, or the honest label that nobody did.
          '提出 ' + (item.proposed_by || '未署名'),
          // Who decided it, once decided. The reason itself stays a digest, so
          // only the reviewer and the decision time are shown - never a fake text.
          item.review && item.review.reviewer ? '审核 ' + item.review.reviewer +
            (item.review.reviewed_at ? ' · ' + shortTime(item.review.reviewed_at) : '') : null,
          '权重 ' + (Number.isFinite(weight) ? weight.toFixed(2) : '—') + ' · 有用 ' + String(item.helpful_signals || 0) + ' / 待复核 ' + String(item.pending_corrections || 0)].filter(Boolean).join(' · ');
        return '<div class="row"><span class="row-lead muted">' + icon('db') + '</span><div class="row-main">' + rowTitle(item.content || item.id) + '<span class="row-sub">' + esc(sub) + '</span>' +
          '<button class="btn sm" type="button" data-memory-audit="' + esc(item.id) + '">召回记录</button>' +
          '<button class="btn sm" type="button" data-memory-trend="' + esc(item.id) + '">趋势</button>' +
          '<pre class="out" data-recall-audit-list hidden></pre><pre class="out" data-weight-trend-list hidden></pre></div>' +
          (status === 'active' ? pill(label(STATUS_LABELS, status, status), 'ok') : pill(label(STATUS_LABELS, status, status), 'muted')) +
          // A candidate is a proposal awaiting a person. Only offer what can
          // actually succeed: a conflicting candidate must be settled first, and
          // 'dismiss' is the only rejection that is valid in that state.
          (status === 'candidate'
            ? '<div class="row-actions"><button class="btn sm primary" type="button" data-memory-review="approve" data-memory-candidate="' + esc(item.id) + '">通过</button>'
              + '<button class="btn sm danger" type="button" data-memory-review="reject" data-memory-candidate="' + esc(item.id) + '">驳回</button></div></div>'
            : status === 'conflict_pending'
              // Naming what is at stake, including whether the other side is live:
              // superseding a memory still being recalled is a louder decision
              // than superseding one already retired.
              ? '<div class="row-sub" style="margin-left:8px">与同主题的其他记忆冲突，需人工裁决'
                + ((item.conflict_peers || []).length
                  ? '：' + item.conflict_peers.map(function (peer) {
                    var origin = peer.kind === 'memory' ? '已有记忆 ' : peer.committed ? '候选（已生效） ' : '候选 ';
                    return origin + String(peer.content || peer.id)
                      + (peer.status ? '（' + (peer.status === 'active' ? '正在生效' : peer.status) + '）' : '');
                  }).join('；')
                  : '')
                + '</div>'
                + '<div class="row-actions">'
                + '<button class="btn sm" type="button" data-memory-conflict="keep" data-memory-candidate="' + esc(item.id) + '">保留这条</button>'
                + '<button class="btn sm" type="button" data-memory-conflict="supersede" data-memory-candidate="' + esc(item.id) + '">取代旧记忆</button>'
                + '<button class="btn sm danger" type="button" data-memory-conflict="dismiss" data-memory-candidate="' + esc(item.id) + '">不采纳</button></div></div>'
              // Ledger memories are governed records with their own transition
              // endpoint, so retirement here must carry the version it was read at.
              : item.governed
                ? (status === 'active'
                  ? '<div class="row-actions"><span class="row-sub">受治理的记忆</span>'
                    + '<button class="btn sm danger" type="button" data-ledger-retire="' + esc(item.id) + '"'
                    + ' data-ledger-version="' + esc(String(item.version ?? '')) + '">停用</button></div></div>'
                  : '<div class="row-actions"><span class="row-sub">受治理的记忆</span></div></div>')
                : '<div class="row-actions"><button class="btn sm" data-memory-edit="' + esc(item.id) + '">编辑</button>'
                  + (status === 'active' ? '<button class="btn sm danger" data-memory-retire="' + esc(item.id) + '">停用</button>' : '') + '</div></div>');
      }).join('') + '</div>' : '';
      return {
        html: '<div class="stack"><div class="card">' + head('记忆', '这是 Craft 已保存且仍有效的本地记忆；可由你手动维护', '<button class="btn primary" id="memory-add" type="button">' + icon('plus') + '添加记忆</button>') +
          '<div class="card-body"><div class="aside-note">' + esc(mirrorNote(results[1], 'memory')) + '</div>' + (rows || emptyState('还没有可展示的记忆', '任务运行并显式保存记忆后，它会以结构化记录出现在这里。', 'db')) + '</div></div></div>',
        aside: asideBlock('记忆范围', '', '<div class="aside-note">编辑不会原地篡改旧记录：Craft 会写入替代版本并保留人工来源。任务页只展示任务自身的短期记忆。</div>'),
        mounts: [function (root) {
          var add = root.querySelector('#memory-add');
          if (add) add.onclick = function () { openMemoryEditor(); };
          root.querySelectorAll('[data-memory-edit]').forEach(function (button) {
            button.onclick = function () {
              var item = items.filter(function (entry) { return entry.id === button.getAttribute('data-memory-edit'); })[0];
              if (item) openMemoryEditor(item);
            };
          });
          root.querySelectorAll('[data-memory-retire]').forEach(function (button) {
            button.onclick = function () {
              api('/api/workbench/memory/' + encodeURIComponent(button.getAttribute('data-memory-retire')) + '/retire', { method: 'POST', body: {} })
                .then(function () { toast('记忆已停用'); paint('memory'); }).catch(fail);
            };
          });
          // Governed ledger memories retire through their own version-checked,
          // signed transition; the Studio endpoint would not find them.
          root.querySelectorAll('[data-ledger-retire]').forEach(function (button) {
            button.onclick = function () {
              if (button.disabled) return;
              var memoryId = button.getAttribute('data-ledger-retire');
              var version = Number(button.getAttribute('data-ledger-version'));
              if (!memoryId || !Number.isInteger(version) || version < 1) return;
              var reason = askText('停用这条已生效记忆的理由（取消则不动）');
              if (reason === null || !String(reason).trim()) return;
              button.disabled = true;
              api('/api/workbench/memory/ledger/transition', { method: 'POST', body: {
                memory_id: memoryId, status: 'revoked', expected_version: version,
                actor: operatorOf(), reason: String(reason).trim() } })
                .then(function () { toast('记忆已停用，并记录原因与署名'); paint('memory'); })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
          // Reviewing a candidate is a signed human decision, with a reason.
          root.querySelectorAll('[data-memory-review]').forEach(function (button) {
            button.onclick = function () {
              if (button.disabled) return;
              var decision = button.getAttribute('data-memory-review');
              var candidateId = button.getAttribute('data-memory-candidate');
              if (!decision || !candidateId) return;
              var reason = askText('审核这条记忆候选的理由（取消则不动）');
              if (reason === null || !String(reason).trim()) return;
              button.disabled = true;
              api('/api/workbench/memory/review', { method: 'POST', body: {
                candidate_id: candidateId, decision: decision, reviewer: operatorOf(), reason: String(reason).trim() } })
                .then(function () { toast(decision === 'approve' ? '记忆候选已通过并生效' : '记忆候选已驳回'); paint('memory'); })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
          // Settling a conflict records who chose which memory wins; the reason is
          // mandatory, so an unexplained overwrite cannot happen.
          root.querySelectorAll('[data-memory-conflict]').forEach(function (button) {
            button.onclick = function () {
              if (button.disabled) return;
              var resolution = button.getAttribute('data-memory-conflict');
              var candidateId = button.getAttribute('data-memory-candidate');
              if (!resolution || !candidateId) return;
              var reason = askText('解决这条记忆冲突的理由（取消则不动）');
              if (reason === null || !String(reason).trim()) return;
              button.disabled = true;
              api('/api/workbench/memory/conflicts/resolve', { method: 'POST', body: {
                candidate_id: candidateId, resolution: resolution, actor: operatorOf(), reason: String(reason).trim() } })
                .then(function () {
                  toast(resolution === 'dismiss' ? '冲突记忆已不采纳'
                    : resolution === 'supersede' ? '已取代旧记忆，冲突已记录'
                      : '已保留这条，冲突已记录');
                  paint('memory');
                })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
          bindRecallAudit(root, { api, attribute: 'data-memory-audit', member: 'memory' });
          bindWeightTrend(root, { api, attribute: 'data-memory-trend', member: 'memory' });
        }]
      };
    });
  }

  function viewWorkflows() {
    // scope is captured by captureForm below; declared here so the helper can
    // read it regardless of which branch of the experience page renders.
    var scope = '';
    // The capture form is a standalone form (no .row), so it must use
    // .form-actions to stay visible. A stacked field layout reads better
    // than the inline single-row version when three inputs are involved.
    function captureForm(failed) {
      return '<div class="card">' + head('沉淀这次成果', '把一个已完成任务的真实交付变成经验草稿；没有证据不会生成', '') +
        '<div class="card-body"><div class="aside-note">' + (failed ? '范围 ' + esc(scope) + '。分层读取失败，但沉淀入口仍然可用。' : '范围 ' + esc(scope) + '。捕获只生成草稿与诊断观察，最终成资产仍走提案/评估/签署。') + '</div>' +
        '<div class="stack gap-sm">' +
        '<div class="field"><label for="capture-task">已完成任务 id</label><input id="capture-task" type="text" placeholder="例如 task_01H…"></div>' +
        '<div class="grid-3">' +
        '<div class="field"><label for="capture-name">经验名称</label><input id="capture-name" type="text" placeholder="如 产品设计"></div>' +
        '<div class="field"><label for="capture-scenario">场景名</label><input id="capture-scenario" type="text" placeholder="如 product_design"></div>' +
        '<button class="btn primary capture-submit" type="button" id="experience-capture">沉淀这次成果</button></div>' +
        '<p id="capture-status" role="status"></p></div></div>';
    }
    return Promise.all([
      api('/api/workbench/resources?kind=workflows&limit=100'),
      api('/api/workbench/context-storage').catch(function () { return { status: [] }; }),
      api('/api/workbench/context-corrections?status=pending_review').catch(function () { return { corrections: [] }; }),
      api('/api/workbench/context-corrections?status=decided&limit=10').catch(function () { return { corrections: [] }; })
    ]).then(function (results) {
      var result = results[0], workflows = result.workflows || [], runs = result.runs || [];
      var workflowRows = workflows.length ? '<div class="rows">' + workflows.map(function (item) { return '<div class="row"><span class="row-lead muted">' + icon('refresh') + '</span><div class="row-main"><span class="row-title">' + esc(item.name || item.id) + '</span><span class="row-sub">' + esc(item.description || '没有说明') + '</span></div><button class="btn sm" data-workflow-edit="' + esc(item.id) + '">编辑</button></div>'; }).join('') + '</div>' : '';
      scope = currentScope ? String(currentScope() || '') : '';
      var tierPromise = scope ? api('/api/workbench/experience/overview?scope=' + encodeURIComponent(scope)).catch(function () { return null; }) : Promise.resolve(null);
      return tierPromise.then(function (overview) {
        var tierCard = '';
        // The pending-correction queue is global, so it is built outside the
        // scoped branches: a demotion must be adjudicable even before a scope
        // is chosen, and one unverified report must not keep the penalty forever.
        var corrections = (results[2] && results[2].corrections) || [];
        // Shared section builder used by both the overview and the failed-read
        // branch of the experience page.
        var section = function (title, hint, body, count) { return '<div class="card">' + head(title, hint, countChip(count)) + '<div class="card-body"><div class="rows">' + (body || '<p class="aside-note">暂无</p>') + '</div></div></div>'; };
        var correctionLabels = { memory: '记忆', knowledge: '知识', experience: '经验' };
        var correctionCard = '<div class="card">' + head('待复核纠错', '确认后该资产持续降权，驳回后恢复原权重', countChip(corrections.length)) +
          '<div class="card-body"><div class="rows">' + (corrections.length ? corrections.map(function (item) {
            var ref = item.asset_ref || {};
            return '<div class="row"><span class="row-lead muted">' + icon('shield') + '</span><div class="row-main">' +
              '<span class="row-title">' + esc(correctionLabels[ref.member] || String(ref.member || '资产')) + ' ' + esc(String(ref.id || '')) + '</span>' +
              '<span class="row-sub">' + esc(String(item.outcome || '')) + ' · 来自一次召回反馈，复核前一直降权</span></div>' +
              '<div class="row-actions"><button class="btn sm" type="button" data-correction-decide="confirmed" data-correction-id="' + esc(String(item.id)) + '">确认有误</button>' +
              '<button class="btn sm ghost" type="button" data-correction-decide="dismissed" data-correction-id="' + esc(String(item.id)) + '">驳回</button></div></div>';
          }).join('') : '<p class="aside-note">没有待复核的纠错。</p>') + '</div></div></div>';
        // A resolved demotion must stay visible: the audit view is what makes the
        // penalty explainable later, and it records who settled it and why.
        var decided = (results[3] && results[3].corrections) || [];
        var decidedTotal = (results[3] && results[3].total) || decided.length;
        var decidedRow = function (item) {
          var ref = item.asset_ref || {};
          var who = item.decided_by ? String(item.decided_by) : '未署名';
          var why = item.resolution_reason ? ' · ' + String(item.resolution_reason) : '';
          return '<div class="row"><span class="row-lead muted">' + icon('check') + '</span><div class="row-main">' +
            '<span class="row-title">' + esc(correctionLabels[ref.member] || String(ref.member || '资产')) + ' ' + esc(String(ref.id || '')) + '</span>' +
            '<span class="row-sub">' + esc(String(item.status || '')) + ' · 由 ' + esc(who) + esc(why) + '</span></div></div>';
        };
        var decidedCard = decided.length
          ? '<div class="card">' + head('最近裁决', '已裁决的纠错仍留档；确认持续降权，驳回已恢复',
            countChip(decidedTotal > decided.length ? '显示 ' + decided.length + ' / 共 ' + decidedTotal : decided.length)) +
            '<div class="card-body"><div class="rows" data-decided-rows>' + decided.map(decidedRow).join('') + '</div>' +
            (decidedTotal > decided.length
              ? '<div class="row-actions"><button class="btn sm" type="button" data-decided-more>查看更多（共 ' + decidedTotal + ' 条）</button></div>'
              : '') +
            '</div></div>'
          : '';
        if (!scope) {
          tierCard = '<div class="card"><div class="card-body"><div class="aside-note">先选择一个任务或工作区，再查看该范围的草稿、模式与资产。</div>' +
            '<div class="form-actions"><input id="experience-scope" type="text" placeholder="project:… 或 task:…"><button class="btn" type="button" id="experience-scope-open">打开范围</button></div></div></div>';
        } else if (overview) {
          var draftRows = (overview.drafts || []).map(function (item) { var d = item.design || {}; return '<div class="row"><span class="row-lead muted">' + icon('refresh') + '</span><div class="row-main"><span class="row-title">' + esc(d.name || d.id) + '</span><span class="row-sub">草稿 · ' + esc(String(item.status || '')) + '</span></div><button class="btn sm" data-workflow-edit="' + esc(d.id) + '">编辑</button></div>'; }).join('');
          // 召回反馈是"用了这条经验之后"的人工信号；没有回执时后端会拒绝，
          // 所以按钮只对已路由（routeable）资产显示。
          var feedbackButtons = function (member, id) {
            return '<div class="row-actions">' +
              '<button class="btn sm" type="button" data-exp-feedback="' + esc(member) + '" data-exp-id="' + esc(id) + '" data-exp-outcome="helpful">召回有用</button>' +
              '<button class="btn sm danger" type="button" data-exp-feedback="' + esc(member) + '" data-exp-id="' + esc(id) + '" data-exp-outcome="incorrect">召回有误</button></div>';
          };
          var observationRows = (overview.observations || []).map(function (item) { return '<div class="row"><span class="row-lead muted">' + icon('db') + '</span><div class="row-main"><span class="row-title">观察 · ' + esc(item.kind) + '</span><span class="row-sub">' + esc(item.scenario_key) + ' · 仅诊断 · 证据 ' + esc(String((item.evidence_ids || []).length)) + ' 条</span></div></div>'; }).join('');
          var patternRows = (overview.patterns || []).map(function (item) { return '<div class="row"><span class="row-lead muted">' + icon('layers') + '</span><div class="row-main"><span class="row-title">模式 · ' + esc(item.pattern_kind || item.id) + '</span><span class="row-sub">仅诊断 · ' + esc(String(item.status || '')) + '</span></div></div>'; }).join('');
          var procedureRows = (overview.procedures || []).map(function (item) {
            // The weight is the same number the recall path ranks with: helpful
            // receipts raise it, pending corrections lower it. Showing it makes the
            // self-evolution loop legible instead of silent.
            var weight = item.recall_weight === undefined ? 1 : Number(item.recall_weight);
            var signals = ' · 权重 ' + (Number.isFinite(weight) ? weight.toFixed(2) : '—') +
              ' · 有用 ' + esc(String(item.helpful_signals || 0)) + ' / 待复核 ' + esc(String(item.pending_corrections || 0));
            return '<div class="row"><span class="row-lead muted">' + icon('check') + '</span><div class="row-main"><span class="row-title">资产 · ' + esc(String(item.procedure_kind)) + '</span><span class="row-sub">' + esc(String(item.lifecycle)) + ' · ' + (item.routeable ? '可召回' : '不可召回') + signals + '</span>' +
              '<button class="btn sm" type="button" data-exp-audit="' + esc(String(item.id)) + '">召回记录</button>' +
              '<button class="btn sm" type="button" data-exp-trend="' + esc(String(item.id)) + '">趋势</button>' +
              '<pre class="out" data-recall-audit-list hidden></pre><pre class="out" data-weight-trend-list hidden></pre></div>' + (item.routeable ? feedbackButtons('experience', item.id) : '') + '</div>';
          }).join('');
          tierCard = captureForm(false) +
            section('经验 · 草稿（来自经验系统）', '由「沉淀这次成果」或自动捕获生成的草稿', draftRows, (overview.drafts || []).length) +
            '<div class="grid-2">' + section('经验 · 观察与模式', '仅诊断，不进入执行', observationRows + patternRows, (overview.observations || []).length + (overview.patterns || []).length) +
            section('经验 · 资产', '通过门槛后才可召回', procedureRows, (overview.procedures || []).length) + '</div>';
        } else {
          // The tier read failed, but capture does not depend on it: the entry
          // must survive a failed read instead of disappearing with it.
          tierCard = captureForm(true) +
            section('经验 · 草稿（来自经验系统）', '由「沉淀这次成果」或自动捕获生成的草稿', '', 0) +
            '<div class="grid-2">' + section('经验 · 观察与模式', '仅诊断，不进入执行', '', 0) +
            section('经验 · 资产', '通过门槛后才可召回', '', 0) + '</div>';
        }
        tierCard = decidedCard + correctionCard + tierCard;
      return {
        html: '<div class="stack"><div class="card">' + head('经验 · 草稿', '可复用的步骤编排；可手动编辑为草稿', '<button class="btn primary" id="workflow-add">' + icon('plus') + '新建经验</button>') + '<div class="card-body">' +
          '<div class="aside-note">' + esc(mirrorNote(results[1], 'experience')) + '</div>' +
          (workflowRows || emptyState('还没有经验草稿', '新建一个经验草稿，或后续从插件导入。', 'refresh')) + '</div></div>' +
          '<div class="card">' + head('经验 · 运行记录', '实际运行过的记录', countChip(runs.length)) + '<div class="card-body">' +
          (catalogRows(runs, 'play', function (item) { return item.workflow_id || item.id; }, function (item) { return [label(STATUS_LABELS, item.status, item.status), shortTime(item.updated_at)].filter(Boolean).join(' · '); }) || emptyState('还没有经验运行记录', '没有执行记录时不会填充示例数据。', 'play')) + '</div></div>' + tierCard + '</div>',
        aside: asideBlock('经验分层', '', '<div class="aside-note">经验分三层：草稿（本页）、通过门槛的 Procedure 与已导出的技能（在「技能」页与「待我批准」）。保存只会生成或更新草稿；运行仍要经过任务权限、审批与观测链路。</div>'),
        mounts: [function (root) {
          var add = root.querySelector('#workflow-add'); if (add) add.onclick = function () { openWorkflowEditor(); };
          var scopeOpen = root.querySelector('#experience-scope-open');
          if (scopeOpen && scopeOpen !== add) scopeOpen.onclick = function () { var field = root.querySelector('#experience-scope'); var value = field && String(field.value || '').trim(); if (value) { notify('已打开范围 ' + value); refresh('workflows'); } };
          var capture = root.querySelector('#experience-capture');
          if (capture && capture !== add) capture.onclick = function () {
            var taskField = root.querySelector('#capture-task'), nameField = root.querySelector('#capture-name'), scenarioField = root.querySelector('#capture-scenario'), status = root.querySelector('#capture-status');
            if (!taskField || !String(taskField.value || '').trim()) { notify('请填写已完成任务 id', true); return; }
            capture.disabled = true;
            api('/api/workbench/workflow-designs/capture', { method: 'POST', body: { task_id: taskField.value.trim(), name: (nameField && nameField.value) || '经验草稿', scenario_key: (scenarioField && scenarioField.value) || 'general', scope: scope } })
              .then(function (captured) {
                if (status) status.textContent = captured.observation ? '已沉淀：生成草稿与诊断观察。' : ('草稿已生成；观察未写入：' + (captured.observation_error || '未知'));
                notify('已沉淀为经验草稿'); paint('workflows');
              }).catch(function (error) { capture.disabled = false; fail(error); });
          };
          root.querySelectorAll('[data-workflow-edit]').forEach(function (button) { button.onclick = function () { var workflow = workflows.filter(function (entry) { return entry.id === button.getAttribute('data-workflow-edit'); })[0]; if (workflow) openWorkflowEditor(workflow); }; });
          // 召回反馈要求一个真实回执 id：由使用方（任务详情/回执页）填入。
          root.querySelectorAll('[data-exp-feedback]').forEach(function (button) {
            if (button.getAttribute('data-exp-feedback') !== 'experience') return;
            button.onclick = function () {
              var procedureId = button.getAttribute('data-exp-id');
              var submit = function (receiptId) {
                button.disabled = true;
                api('/api/workbench/experience/feedback', { method: 'POST', body: { receipt_id: receiptId, outcome: button.getAttribute('data-exp-outcome'),
                  members: ['experience'], asset_refs: [{ member: button.getAttribute('data-exp-feedback'), id: procedureId }] } })
                  .then(function () { notify('召回反馈已记录'); paint('workflows'); })
                  .catch(function (error) { button.disabled = false; fail(error); });
              };
              // Prefill with the receipt that actually recalled this procedure;
              // typing an id by hand is the fallback, not the default.
              api('/api/workbench/experience/recall-receipts?procedure_id=' + encodeURIComponent(procedureId))
                .then(function (result) {
                  var latest = (result.receipts || [])[0];
                  if (latest && latest.id) { submit(String(latest.id)); return; }
                  var receipt = askText('召回这条经验的回执 id（context_resolution_receipt）');
                  if (receipt) submit(receipt.trim());
                })
                .catch(function () {
                  var receipt = askText('召回这条经验的回执 id（context_resolution_receipt）');
                  if (receipt) submit(receipt.trim());
                });
            };
          });
          bindRecallAudit(root, { api, attribute: 'data-exp-audit', member: 'experience' });
          bindWeightTrend(root, { api, attribute: 'data-exp-trend', member: 'experience' });
          // Confirming keeps the ranking penalty; dismissing removes it. Either
          // way it is an explicit, attributed decision, never a silent rewrite.
          root.querySelectorAll('[data-correction-decide]').forEach(function (button) {
            button.onclick = function () {
              if (button.disabled) return;
              var decision = button.getAttribute('data-correction-decide');
              var correctionId = button.getAttribute('data-correction-id');
              if (!decision || !correctionId) return;
              // Why a demotion stands (or is lifted) is part of the record; the
              // reason is optional, but the decision is always attributed.
              var reason = askText('可选：记录这次复核的理由（留空直接裁决，取消则不改）');
              if (reason === null) return;
              button.disabled = true;
              var body = { task_id: correctionId, decision: decision, decided_by: operatorOf() };
              if (String(reason).trim()) body.reason = String(reason).trim();
              api('/api/workbench/context-corrections/decide', { method: 'POST', body: body })
                .then(function () { notify(decision === 'confirmed' ? '已确认有误，该资产继续降权' : '已驳回，权重恢复'); paint('workflows'); })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
          // The audit list is capped; let the reader load the rest instead of
          // assuming the visible page is the whole history.
          var decidedMore = root.querySelector('[data-decided-more]');
          if (decidedMore) decidedMore.onclick = function () {
            decidedMore.disabled = true;
            api('/api/workbench/context-corrections?status=decided&limit=50')
              .then(function (result) {
                var target = root.querySelector('[data-decided-rows]');
                if (target) target.innerHTML = ((result && result.corrections) || []).map(decidedRow).join('');
                decidedMore.hidden = true;
              })
              .catch(function (error) { decidedMore.disabled = false; fail(error); });
          };
        }]
      };
      });
    });
  }

  return { memory: viewMemory, workflows: viewWorkflows };
}

