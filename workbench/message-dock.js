/**
 * 消息插件三模式落地（NEEDREAD.md）。
 *
 * 冷热分流：接收、过滤、展示全是纯工程代码，0 Token；只有用户点「智能处理」
 * 才调用 /process 记录意图，真正的模型推理由 Pilot/Worker 层执行，此处不调用。
 *
 * - 领航 pilot：对话流下方的播报卡片（助理口吻）。
 * - 观象 control：待办条目（可批量标记已读 / 智能处理）。
 * - 灵策 workshop：右下角轻量 Toast + 侧栏消息流。
 */
export function mountMessageDock({ api, modeOf, notify, fail, esc, icon, composerOf }) {
  var POLL_MS = 15000;
  var host = document.createElement('div');
  host.id = 'message-dock';
  host.className = 'message-dock';
  document.body.appendChild(host);
  var current = [];
  var seen = {};
  var chosen = {};

  function labelFor(mode) {
    return mode === 'pilot' ? '领航员提醒' : mode === 'control' ? '外部消息（待办）' : '消息流';
  }

  function card(m, mode) {
    var from = esc(m.from || '未知来源');
    var subject = esc(m.subject || '(无主题)');
    var priority = m.priority === 'high' ? '<span class="msg-prio high">高</span>' : '';
    var body = mode === 'pilot'
      ? '收到来自 ' + from + ' 的新消息《' + subject + '》。是否需要我为您生成简报或草拟回复？'
      : from + ' · ' + subject;
    return '<div class="msg-card" data-msg-id="' + esc(m.id) + '"' +
      (mode === 'workshop' ? ' draggable="true" data-msg-drag="' + esc(m.id) + '"' : '') + '>' +
      (mode === 'control' ? '<label class="msg-check"><input type="checkbox" data-msg-check="' + esc(m.id) + '"' +
        (chosen[m.id] ? ' checked' : '') + ' aria-label="选择这条消息"></label>' : '') +
      '<span class="msg-lead">' + icon('inbox') + '</span>' +
      '<div class="msg-main"><span class="msg-title">' + labelFor(mode) + priority + '</span>' +
      '<span class="msg-sub">' + body + '</span></div>' +
      '<div class="msg-actions">' +
      '<button class="btn sm" type="button" data-msg-read="' + esc(m.id) + '">标记已读</button>' +
      '<button class="btn sm" type="button" data-msg-process="' + esc(m.id) + '">智能处理</button>' +
      '</div></div>';
  }

  function render() {
    var mode = modeOf();
    host.setAttribute('data-mode', mode);
    // In the console the governance shell (with its source poll form) must stay
    // reachable even at zero unread messages: pulling a new source is how the
    // first message ever arrives. Other modes render nothing when empty.
    if (!current.length && mode !== 'control') { host.innerHTML = ''; return; }
    if (mode === 'pilot') {
      host.innerHTML = '<div class="msg-pilot">' + current.slice(0, 3).map(function (m) { return card(m, mode); }).join('') + '</div>';
    } else if (mode === 'control') {
      host.innerHTML = '<div class="msg-console"><div class="msg-console-head">' + icon('inbox') + '<b>' + labelFor(mode) + '</b><span>' + current.length + ' 条待处理</span>' + sourceForm() + '</div>' +
        current.slice(0, 8).map(function (m) { return card(m, mode); }).join('') + batchBar() + '</div>';
    } else {
      // Workshop: a single lightweight toast, plus a compact side dock.
      var latest = current[0];
      host.innerHTML = '<div class="msg-toast">' + icon('inbox') + '<span>' + esc(latest.from) + ' · ' + esc(latest.subject) + '</span>' +
        '<button class="btn sm" type="button" data-msg-read="' + esc(latest.id) + '">已读</button></div>' +
        '<details class="msg-side"><summary>消息流 (' + current.length + ')</summary>' +
        current.slice(0, 8).map(function (m) { return card(m, mode); }).join('') + '</details>';
    }
    bind();
  }

  function selectedIds() { return Object.keys(chosen).filter(function (id) { return chosen[id]; }); }

  // 消息源目录：运营者在控制台填一个本地/挂载云目录，点拉取即把该目录里的新
  // 消息经门禁（脱敏+归一）存入收件箱。纯工程、0 Token；一源失败不影响其余。
  function sourceForm() {
    return '<span class="msg-source"><input id="msg-source-dir" type="text" placeholder="消息源目录（本地/挂载云目录）" aria-label="消息源目录">' +
      '<button class="btn sm" type="button" data-msg-poll>拉取新消息</button></span>';
  }

  function batchBar() {
    var count = selectedIds().length;
    if (!count) return '';
    return '<div class="msg-batch"><span>已选 ' + count + ' 条</span>' +
      '<button class="btn sm" type="button" data-batch="read">批量标记已读</button>' +
      '<button class="btn sm primary" type="button" data-batch="summarize">丢给 AI 统一总结</button>' +
      '<button class="btn sm" type="button" data-batch="clear">取消选择</button></div>';
  }

  function bind() {
    // The poll button lives in the console source form; bind via querySelectorAll
    // like every other control so the handler survives a repaint. The directory
    // field is read lazily on click, so it is looked up through the same button's
    // owning form rather than a separate querySelector call.
    host.querySelectorAll('[data-msg-poll]').forEach(function (btn) {
      btn.onclick = function () {
        var field = host.querySelector ? host.querySelector('#msg-source-dir') : null;
        var dir = field && String(field.value || '').trim();
        if (!dir) { notify('请先填写消息源目录', true); return; }
        btn.disabled = true;
        api('/api/workbench/messages/poll', { method: 'POST', body: { drop_dirs: [dir] } })
          .then(function (result) {
            var reports = (result && result.reports) || [];
            var failed = reports.filter(function (r) { return r.error; });
            var got = result && typeof result.ingested === 'number' ? result.ingested : reports.reduce(function (n, r) { return n + (r.ingested || 0); }, 0);
            btn.disabled = false;
            if (failed.length) notify('拉取完成但有源失败：' + failed[0].error, true);
            else notify('已从目录拉取 ' + got + ' 条新消息（0 Token）');
            poll();
          }).catch(function (error) { btn.disabled = false; fail(error); });
      };
    });
    host.querySelectorAll('[data-msg-read]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-msg-read');
        api('/api/workbench/messages/' + encodeURIComponent(id) + '/read', { method: 'POST', body: {} })
          .then(function () { current = current.filter(function (m) { return m.id !== id; }); render(); }).catch(fail);
      };
    });
    host.querySelectorAll('[data-msg-process]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-msg-process');
        // On-demand AI: dispatch a Pilot turn (Mainer -> Worker) only here;
        // basic listing/rendering above never spends a token.
        api('/api/workbench/messages/process-intent', { method: 'POST', body: { id: id } })
          .then(function (result) {
            if (result && result.dispatched === false) {
              // Coordinator 在等一个人工决定（例如两个同样可能的目录），
              // 不能谎称已派发，也不能把消息从待办里悄悄抹掉。
              var qs = result.questions || [];
              var hint = qs.length && qs[0].options && qs[0].options.length
                ? '候选：' + qs[0].options.join(' / ') : '请在领航里补充目录后重试';
              notify('领航需要你先确认：' + hint);
              return;
            }
            notify('已派发领航处理这条消息，Worker 将按需生成摘要或回复草稿');
            current = current.filter(function (m) { return m.id !== id; }); render();
          }).catch(fail);
      };
    });
    host.querySelectorAll('[data-msg-check]').forEach(function (box) {
      box.onchange = function () {
        var id = box.getAttribute('data-msg-check');
        chosen[id] = !!box.checked;
        render();
      };
    });
    host.querySelectorAll('[data-batch]').forEach(function (btn) {
      btn.onclick = function () {
        var action = btn.getAttribute('data-batch');
        if (action === 'clear') { chosen = {}; render(); return; }
        var ids = selectedIds();
        if (!ids.length) return;
        api('/api/workbench/messages/batch', { method: 'POST', body: { action: action, ids: ids } })
          .then(function (result) {
            notify(action === 'read' ? '已批量标记 ' + String(result.succeeded) + ' 条（0 Token）' :
              '已派发 ' + String(result.succeeded) + ' 条给领航按需总结');
            chosen = {};
            render();
          }).catch(fail);
      };
    });
    // 一键拖拽到 Chat：把消息作为上下文插进当前输入框，不发送、0 Token。
    host.querySelectorAll('[data-msg-drag]').forEach(function (node) {
      node.ondragstart = function (event) {
        var m = current.filter(function (item) { return item.id === node.getAttribute('data-msg-drag'); })[0];
        if (!m) return;
        var text = '参考消息：' + (m.from || '未知来源') + '《' + (m.subject || '无主题') + '》';
        if (event && event.dataTransfer) event.dataTransfer.setData('text/plain', text);
        var input = typeof composerOf === 'function' ? composerOf() : null;
        if (input) {
          input.value = (input.value ? input.value.replace(/\s*$/u, '') + '\n' : '') + text;
          if (input.focus) input.focus();
        }
        notify('已把消息作为上下文放进输入框');
      };
    });
  }

  function poll() {
    api('/api/workbench/messages/list?unread_only=true').then(function (result) {
      var items = (result && result.items) || [];
      var fresh = items.filter(function (m) { return !seen[m.id]; });
      fresh.forEach(function (m) { seen[m.id] = true; });
      current = items;
      render();
      if (fresh.length && modeOf() !== 'pilot') notify('收到 ' + fresh.length + ' 条新消息');
    }).catch(function () { /* 离线时静默，不打断工作 */ });
  }

  poll();
  var timer = setInterval(poll, POLL_MS);
  return { stop: function () { clearInterval(timer); host.remove(); }, refresh: poll };
}
