import { createAssetRevisionPage } from './asset-revisions.js';
import { createContextWorkflowPages } from './context-workflows.js';
import { createResourcePages } from './resource-pages.js';
import { createModPages } from './mod-pages.js';
import { mountMessageDock } from './message-dock.js';
import { createModelSetup } from './model-setup.js';
import { createLatestRequest } from './latest-request.js';
import { groupByFolder, createProjectPage } from './project-page.js';
import { createRuntimeClient } from './runtime-client.js';
import { mountAgentWorkspace } from './agent-workspace.js';
import { resizeComposers } from './composer-controls.js';
import { splitRail, railNavHtml } from './rail-nav.js';
import { mountEvaluationPanel } from './evaluation-panel.js';
import { mountNativeTools } from './native-tools-panel.js';
import { bindRecallAudit, bindWeightTrend } from './recall-audit.js';
import { applyAssetFocus } from './asset-focus.js';
import { MODES, MODE_ORDER, modeNavKeys, readMode, writeMode, readPilotSession, writePilotSession, legacyNavEnabled } from './mode-shell.js';
import { createModePages } from './mode-pages.js';
import { icon, esc, pill, shortTime, label, fromLabel, statusPill, effectPill, settled, receiptName, head, emptyState, statTile, lead, countChip, asideBlock, asideRows, $, val, checked, lines, ICONS, TONE, STATUS_LABELS, EFFECT_LABELS, HEALTH_LABELS, ASSET_TYPE_LABELS, STAGE_LABELS, TRACE_LABELS, TASK_PERMISSION_LABELS, CONFIDENCE_LABELS, ARTIFACT_KIND_LABELS, RECEIPT_ACTION_LABELS, ESCAPES } from './ui.js';

/* Craft Workbench — desktop shell for the Craft runtime.
   Layout borrows from the VS Code family (fixed viewport, activity rail,
   document tabs, context panel, status bar) and from the AI desktop clients
   (Cherry Studio / WorkBuddy) for the information architecture.
   Vanilla JS on purpose: the Workbench server serves this from disk under a
   strict same-origin CSP, so there is no bundler, no CDN and no framework. */
(function () {
  'use strict';

  var THEME_KEY = 'craft.theme';

  var state = {
    page: 'home', token: '', focus: null,
    selectedProject: null, selectedProvider: null, selectedTier: 'standard',
    selectedTask: null, selectedTaskTitle: '', collapsedFolders: {}, showAllFolders: {}, folderGroups: null,
    counts: {}, settings: null, theme: 'light',
    execution: { mode: '', provider: null, tier: 'standard' },
    pendingSheet: null,
    // Console 待我批准：跨重绘记住勾选，供「批量批准」浮条使用；决定仍逐条落库。
    approvalSelection: {},
    // The rail's task list has two shapes: grouped by folder (the default) or a
    // single flat list ordered by latest update. The rail header carries the
    // switch, so the shape is view state rather than a URL.
    taskView: 'folder',
    // Creating a task is the only moment a folder gets chosen, so the composer
    // owns that choice instead of a modal form that disappears on submit.
    composer: { folder: '', model: '', permission: 'human_approval', caps: [], models: [] },
    // A launch that needs approval can only be approved while its work-loop id
    // is still in hand, so it is parked here for the page that renders it.
    pendingApproval: null,
    // Which object the centre column shows. View state rather than a URL, matching how
    // the other pages keep their selection.
    selectedObject: null,
    // The plugin whose detail page is open. View state carried in the hash like a task.
    selectedPlugin: null,
    asideOpen: {}, capabilitySetupOpen: false,
    // 开发兜底开关：#...&legacyNav=1 恢复旧的完整一级导航，仅用于对齐期，不是第二套界面。
    legacyNav: false,
    // 三模式（灵策 / 观象 / 领航）是同一 Runtime 的展示投影；切换模式不中断任务，
    // 也不改变执行事实。首次进入领航，之后恢复上次使用的模式。
    mode: 'pilot', pilotSessionId: readPilotSession(typeof localStorage === 'undefined' ? null : localStorage)
  };

  // ------------------------------------------------------------------ icons


  // ---------------------------------------------------------------- utilities


  // -------------------------------------------------------------------- theme

  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function resolvedTheme() {
    if (state.theme === 'dark') return 'dark';
    if (state.theme === 'light') return 'light';
    return media.matches ? 'dark' : 'light';       // 'system'
  }

  function applyTheme() {
    var effective = resolvedTheme();
    document.documentElement.setAttribute('data-theme', effective);
    try { localStorage.setItem(THEME_KEY, effective); } catch (_) { /* storage off */ }
    var button = $('theme-toggle');
    if (button) {
      var dark = effective === 'dark';
      button.innerHTML = icon(dark ? 'sun' : 'moon');
      button.title = dark ? '切换到浅色主题' : '切换到深色主题';
      button.setAttribute('aria-label', button.title);
    }
  }

  function saveTheme(next) {
    state.theme = next;
    applyTheme();
    if (state.settings) state.settings.theme = next;
    api('/api/settings', { method: 'PATCH', body: { theme: next } })
      .then(function () { toast(next === 'dark' ? '已切换到深色主题' : next === 'light' ? '已切换到浅色主题' : '已跟随系统主题'); })
      .catch(function () { toast('主题已切换，但写入设置失败', true); });
  }

  function toggleTheme() { saveTheme(resolvedTheme() === 'dark' ? 'light' : 'dark'); }

  var openMenu = null;
  function closeTopMenu() {
    var node = $('top-menu');
    if (node) node.remove();
    document.querySelectorAll('[data-menu]').forEach(function (button) { button.setAttribute('aria-expanded', 'false'); });
    openMenu = null;
  }
  function openTopMenu(name, button) {
    if (openMenu === name) { closeTopMenu(); return; }
    closeTopMenu(); openMenu = name; button.setAttribute('aria-expanded', 'true');
    var commands = {
      file: [['新建任务', openComposer], ['设置', function () { go('settings'); }]],
      edit: [['复制', function () { try { document.execCommand('copy'); } catch (_) { /* browser policy */ } }], ['粘贴', function () { toast('请在输入框中使用 Ctrl+V 粘贴'); }]],
      view: [['收起左侧栏', function () { $('rail-toggle').click(); }], ['收起右侧信息', function () { $('aside-toggle').click(); }], ['在应用内查看网页', openEmbeddedBrowser], ['在受管浏览器中登录', openManagedBrowser], [resolvedTheme() === 'dark' ? '切换浅色主题' : '切换深色主题', toggleTheme]],
      help: [['键盘快捷键', function () { toast('Ctrl/⌘ + Enter 发送对话；Esc 关闭面板。'); }], ['关于 Craft Workbench', function () { toast('Craft Workbench · 本机任务工作台'); }]]
    }[name] || [];
    var menu = document.createElement('div'); menu.id = 'top-menu'; menu.className = 'top-menu'; menu.setAttribute('role', 'menu');
    commands.forEach(function (command) { var item = document.createElement('button'); item.type = 'button'; item.textContent = command[0]; item.onclick = function () { closeTopMenu(); command[1](); }; menu.appendChild(item); });
    document.body.appendChild(menu);
    var rect = button.getBoundingClientRect(); menu.style.left = Math.round(rect.left) + 'px'; menu.style.top = Math.round(rect.bottom + 4) + 'px';
  }

  // ------------------------------------------------------------- view helpers


  function toast(message, bad) {
    var host = $('toast-host');
    var node = document.createElement('div');
    node.className = 'toast' + (bad ? ' bad' : '');
    node.innerHTML = icon(bad ? 'alert' : 'check') + '<span>' + esc(message) + '</span>';
    host.appendChild(node);
    setTimeout(function () { node.remove(); }, bad ? 7000 : 3600);
  }

  function fail(error) { toast(error && error.message ? error.message : String(error), true); }

  function skeleton() {
    var tiles = [0, 1, 2, 3, 4, 5].map(function () {
      return '<div class="stat"><div class="sk-bar" style="width:28px;height:28px;border-radius:6px"></div>' +
        '<div class="stat-body"><div class="sk-bar" style="width:52px;height:17px"></div><div class="sk-bar" style="width:70px;height:11px;margin-top:5px"></div></div></div>';
    }).join('');
    return '<div class="stack"><div class="metrics">' + tiles + '</div>' +
      '<div class="grid-2"><div class="sk sk-card"></div><div class="sk sk-card"></div></div></div>';
  }

  // ---------------------------------------------------------------------- api

  var api = createRuntimeClient({
    invoke: window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core.invoke : null,
    fetch: window.fetch.bind(window), token: function () { return state.token; }
  });

  // The three-mode pages are a deep module: presentation in mode-pages.js,
  // runtime facts and navigation arrive through this one narrow context.
  // Function declarations below are hoisted, so wiring here (before NAV is
  // built) is safe.
  var modePages = createModePages({
    state: state, api: api, host: window, doc: document,
    toast: toast, fail: fail, go: go, openTask: openTask,
    importNativeSession: importNativeSession, mountAgentWorkspace: mountAgentWorkspace,
    writePilotSession: writePilotSession,
    workspacePathOf: workspacePathOf, folderNameOf: folderNameOf, renderFolderTree: renderFolderTree,
    asideBlock: asideBlock, openInlineOn: openInlineOn, dismissInline: dismissInline,
    settled: settled, icon: icon, esc: esc, label: label, pill: pill, head: head,
    emptyState: emptyState, countChip: countChip
  });
  var viewHome = modePages.viewHome, viewPilot = modePages.viewPilot,
      viewMyTasks = modePages.viewMyTasks, newSessionDrawer = modePages.newSessionDrawer;

  function readUpload(input, accepted, callback) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    if (accepted && accepted.indexOf(file.name.split('.').pop().toLowerCase()) < 0) { toast('请选择 .' + accepted.join('、.') + ' 文件', true); input.value = ''; return; }
    if (file.size > 48 * 1024) { toast('上传内容不能超过 48 KiB', true); input.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function () { input.value = ''; callback(String(reader.result || ''), file.name); };
    reader.onerror = function () { input.value = ''; toast('读取文件失败', true); };
    reader.readAsText(file, 'utf-8');
  }

  function call(tool, args) { return api('/api/workbench/call', { method: 'POST', body: { tool: tool, args: args || {} } }); }

  // ------------------------------------------------------------- inline form
  // A desktop workspace should not interrupt with a dialog. Anything a page's
  // action bar opens renders as a card at the top of the MIDDLE column instead:
  // the form sits in the same column as the thing it edits, Esc or 取消 clears
  // it, and switching page drops it (see paint()).
  //
  // The form is state, not a live DOM node we show and hide — the next paint
  // either renders it or does not, which is what keeps it in sync with the page.

  var inlineForm = null;   // { page, options }

  function openInlineOn(page, options) {
    inlineForm = { page: page, options: options };
    paint(page);
  }

  function openInline(options) { openInlineOn(state.page, options); }

  function clearInline() { inlineForm = null; }

  function dismissInline(page) {
    var target = page || (inlineForm && inlineForm.page) || state.page;
    inlineForm = null;
    paint(target);
  }

  function inlineFormHtml() {
    var options = inlineForm.options;
    var actions = (options.actions || []).map(function (action, index) {
      return '<button class="btn' + (action.primary ? ' primary' : '') + (action.danger ? ' danger' : '') +
        '" type="button" data-inline="' + index + '">' +
        (action.icon ? icon(action.icon) : '') + esc(action.label) + '</button>';
    }).join('');
    return '<div class="card inline-form" role="group" aria-label="' + esc(options.title) + '">' +
      head(options.title, options.sub ? esc(options.sub) : '',
        '<button class="icon-btn" type="button" data-inline="close" aria-label="取消">' + icon('x') + '</button>') +
      '<div class="card-body"><div class="stack">' + (options.html || '') + '</div>' +
      '<div class="inline-foot">' + actions + '</div></div></div>';
  }

  function mountInlineForm(root) {
    var card = root.querySelector('.inline-form');
    if (!card) return;
    card.querySelectorAll('[data-inline]').forEach(function (button) {
      button.onclick = function () {
        var key = button.getAttribute('data-inline');
        if (key === 'close') { dismissInline(inlineForm.page); return; }
        var action = (inlineForm.options.actions || [])[Number(key)];
        if (action && action.run) action.run();
      };
    });
    if (inlineForm.options.mount) inlineForm.options.mount(card);
    var first = card.querySelector('input, textarea, select');
    if (first) first.focus();
  }

  // ------------------------------------------------------------------ palette

  var paletteIndex = 0;
  var paletteHits = [];

  function paletteCommands() {
    var commands = [{ label: '任务', kind: '页面', icon: 'tasks', run: function () { go('home'); } }];
    commands = commands.concat(FLAT.map(function (item) {
      return { label: item.title, kind: '页面', icon: item.icon, run: function () { go(item.key); } };
    }));
    commands.push({ label: '新建任务', kind: '操作', icon: 'plus', run: function () { openComposer(); } });
    // 文档 5.3：L3 的唯一合法使命是孵化一个新的工作对象。它刻意只出现在命令面板里，
    // 而不是主界面上最显眼的动作（15.3 把它降级为次要入口）。
    commands.push({ label: '孵化一个新对象', kind: '操作', icon: 'spark', run: openHatch });
    commands.push({ label: resolvedTheme() === 'dark' ? '切换到浅色主题' : '切换到深色主题', kind: '操作', icon: 'sun', run: toggleTheme });
    commands.push({ label: '刷新当前页面', kind: '操作', icon: 'refresh', run: function () { paint(state.page); } });
    return commands;
  }

  function renderPalette(query) {
    var all = paletteCommands();
    var needle = String(query || '').trim().toLowerCase();
    paletteHits = needle
      ? all.filter(function (item) { return item.label.toLowerCase().indexOf(needle) >= 0 || item.kind.toLowerCase().indexOf(needle) >= 0; })
      : all;
    if (paletteIndex >= paletteHits.length) paletteIndex = 0;
    var list = $('palette-list');
    if (!list) return;
    list.innerHTML = paletteHits.length
      ? paletteHits.map(function (item, index) {
          return '<button class="palette-item" type="button" data-hit="' + index + '" aria-selected="' + (index === paletteIndex) + '">' +
            icon(item.icon) + '<span>' + esc(item.label) + '</span><span class="kind">' + esc(item.kind) + '</span></button>';
        }).join('')
      : '<div class="palette-empty">没有匹配项</div>';
    list.querySelectorAll('[data-hit]').forEach(function (button) {
      button.onclick = function () { runPaletteHit(Number(button.getAttribute('data-hit'))); };
    });
  }

  function runPaletteHit(index) {
    var item = paletteHits[index];
    closePalette();
    if (item) item.run();
  }

  function openPalette() {
    var host = $('palette-host');
    paletteIndex = 0;
    host.innerHTML = '<div class="palette" role="dialog" aria-modal="true" aria-label="快速跳转">' +
      '<input class="palette-input" id="palette-input" type="text" placeholder="跳转到页面或执行操作…" autocomplete="off">' +
      '<div class="palette-list" id="palette-list"></div></div>';
    host.hidden = false;
    renderPalette('');
    host.onclick = function (event) { if (event.target === host) closePalette(); };
    var input = $('palette-input');
    input.focus();
    input.oninput = function () { paletteIndex = 0; renderPalette(input.value); };
    input.onkeydown = function (event) {
      if (event.key === 'Escape') { closePalette(); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, paletteHits.length - 1); renderPalette(input.value); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); paletteIndex = Math.max(paletteIndex - 1, 0); renderPalette(input.value); }
      else if (event.key === 'Enter') { event.preventDefault(); runPaletteHit(paletteIndex); }
    };
  }

  function closePalette() {
    var host = $('palette-host');
    host.hidden = true;
    host.innerHTML = '';
    host.onclick = null;
  }

  // ---------------------------------------------------------------- navigation

  // A folder deliberately has no nav entry: it is an attribute of a task — picked
  // when the task is created and shown as a group in the rail — not a place. It
  // used to sit here as 一级菜单 and duplicated the rail's own grouping.
  /**
   * The signature attached to a human decision. It comes from the operator's own
   * settings; when they have not named themselves we say so instead of inventing
   * an identity, so an unattributed decision is visible as such.
   */
  function operatorOf() {
    var value = state.settings && state.settings.workbench && state.settings.workbench.operator;
    return typeof value === 'string' && value.trim() ? value.trim() : 'unattributed';
  }

  var resourcePages = createResourcePages({
    api: api, presentation: { icon: icon, esc: esc, head: head, emptyState: emptyState, asideBlock: asideBlock, catalogRows: catalogRows, countChip: countChip, label: label, STATUS_LABELS: STATUS_LABELS, shortTime: shortTime, pill: pill },
    editors: { memory: openMemoryEditor, workflow: openWorkflowEditor }, refresh: paint, notify: toast, fail: fail,
    // Human decisions are signed by the configured operator, never by a
    // hard-coded name; with no operator set the record says "unattributed".
    operator: function () { return operatorOf(); },
    scope: function () {
      if (state.selectedTask) return 'task:' + state.selectedTask;
      var folder = state.composer.folder || state.selectedProject;
      if (!folder) return '';
      // A workspace group is a directory identity; scope it as such so the
      // experience overview matches the observation's workspace scope.
      var group = (state.folderGroups || []).filter(function (g) { return g.key === folder; })[0];
      return (group && group.kind === 'workspace' ? 'workspace:' : 'project:') + folder;
    },
    ask: function (message) { return window.prompt(message); }
  });
  var contextPages = createContextWorkflowPages({ api: api, esc: esc, fail: fail, operator: operatorOf });
  // NEEDREAD P0/P1 能力页：Mod、目录描述、一次性引导、切模式确认。
  var modPages = createModPages({
    api: api,
    presentation: { icon: icon, esc: esc, head: head, emptyState: emptyState, asideBlock: asideBlock, pill: pill, shortTime: shortTime },
    notify: toast, fail: fail, ask: function (message) { return window.prompt(message); },
    operator: function () { return operatorOf(); },
    paint: paint, go: go,
    openInlineOn: function (page, spec) {
      // The inline editor clears itself before a repaint, so saving does not
      // leave a stale form on the next page.
      var original = spec.actions || [];
      openInlineOn(page, Object.assign({}, spec, {
        actions: original.map(function (action) { return { label: action.label, primary: action.primary, run: function () { clearInline(); action.run(); } }; })
      }));
    }
  });
  // The rail is grouped so the four everyday surfaces stay together and the
  // governance/observation pages sit apart. `group` drives a header in paintNav.
  var NAV = [
    { key: 'overview', group: '工作', label: '概要', title: '概要', sub: '现在有没有需要你的事', icon: 'inbox', view: viewOverview },
    { key: 'tasks', group: '工作', label: '我的任务', title: '我的任务', sub: '排队、运行、待批准、待输入、完成、失败与未知', icon: 'tasks', view: viewMyTasks },
    // 你的注意力 answers 「现在有没有需要我」 first, then the durable authorizations.
    { key: 'approvals', group: '你的注意力', label: '待我批准', title: '待我批准', sub: '需要人工决定才能继续的工作', icon: 'shield', view: viewApprovals },
    { key: 'objects', group: '你的注意力', label: '我的对象', title: '我的对象', sub: '按「需要你」排序的工作对象；中央一次只放一个待裁决项', icon: 'layers', view: viewObjects },
    // 文档 7.1：每一次事件订阅都是一条显式、有期限、可撤销的授权记录。这一页就是那条记录
    // 的可见形态——没有它，订阅是一张看不见期限的空白支票。
    { key: 'subscriptions', group: '你的注意力', label: '订阅', title: '订阅', sub: '事件订阅即长期授权：可查触发历史、有期限、可撤销', icon: 'refresh', view: viewSubscriptions },
    // 能力 are the installable/inspectable building blocks.
    { key: 'plugins', group: '能力', label: '插件', title: '插件', sub: '可安装或已登记的能力包：Craft 原生工具、DSH/Claude/Codex 插件适配', icon: 'plug', view: viewPlugins },
    { key: 'permissions', group: '你的注意力', label: '权限', title: '权限', sub: '记住的审批授权：精确指纹、工作区、有效期、可撤销', icon: 'key', view: viewPermissions },
    { key: 'executors', group: '任务治理', label: '执行配置', title: '执行配置', sub: '执行模板、只读专家与监督档案：规则硬门，模型只建议', icon: 'cpu', view: viewExecutors },
    { key: 'skills', group: '能力', label: '技能', title: '技能', sub: '把具体方法与提示词作为可复用资产管理', icon: 'spark', view: viewSkills },
    { key: 'connectors', group: '能力', label: '连接器', title: '连接器', sub: '连接本机目录、MCP 服务和外部来源', icon: 'server', view: viewCapabilities },
    { key: 'models', group: '能力', label: '模型', title: '模型', sub: '配置任务对话和推理使用的模型网关', icon: 'cpu', view: viewModels },
    // 上下文 is what Craft remembers, knows and has learned.
    { key: 'memory', group: '上下文', label: '记忆', title: '记忆', sub: '查看被保存的短期与长期任务记忆', icon: 'db', view: resourcePages.memory },
    { key: 'knowledge', group: '上下文', label: '知识', title: '知识', sub: '将 Markdown、JSON 和可核验结论组织成知识库', icon: 'layers', view: viewKnowledge },
    { key: 'workflows', group: '上下文', label: '经验', title: '经验', sub: '从真实运行沉淀出的可复用经验：草稿、Procedure 与已导出的技能', icon: 'refresh', view: resourcePages.workflows },
    { key: 'mods', group: '上下文', label: '认知约束', title: '认知约束', sub: 'Mod：注入 Worker/Reviewer 上下文的行为规范，需批准才生效', icon: 'layers', view: modPages.mods },
    { key: 'filedir', group: '上下文', label: '目录语义', title: '目录语义', sub: '目录 ↔ 语义描述双向检索，用过才存、常用才转正', icon: 'folder', view: modPages.filedir },
    { key: 'evolution', group: '任务治理', label: '自进化观察室', title: '自进化观察室', sub: 'Agent 最近总结了什么：Mod 候选、影子测试与插件发现提案', icon: 'refresh', view: modPages.evolution },
    { key: 'blocked', group: '任务治理', label: '异常阻塞队列', title: '异常阻塞队列', sub: 'Worker/Reviewer 超过 3 轮被硬中断的任务，核对后解除熔断', icon: 'alert', view: modPages.blocked },
    // 高级 keeps the observation and revision surfaces reachable without crowding.
    { key: 'onboard', group: '高级', label: '首次引导', title: '首次引导', sub: '一次性冷启动引导的完成状态与重新启用入口', icon: 'spark', view: modPages.onboard },
    { key: 'mode-confirm', group: '高级', label: '切模式确认', title: '切模式确认', sub: '切模式前查看后台运行/排队任务数', icon: 'layers', view: modPages.modeConfirm },
    { key: 'asset-revisions', group: '高级', label: '版本与依据', title: '版本与依据', sub: '查看修订、使用依据和恢复候选', icon: 'layers', view: createAssetRevisionPage({ api: api, esc: esc, fail: fail }) },
    { key: 'context-usage', group: '高级', label: '上下文使用', title: '上下文使用', sub: '按范围查看提供记录与验证依据', icon: 'layers', view: contextPages.usage },
    { key: 'workflow-designs', group: '高级', label: '梳理流程', title: '梳理流程', sub: '从真实样例整理可交接规格', icon: 'refresh', view: contextPages.designs },
    { key: 'evaluations', group: '高级', label: '评测', title: '评测', sub: '在独立副本中执行评测集，比较运行并核对未知结果', icon: 'check', view: viewEvaluations }
  ];

  // Settings remains routable, but is deliberately anchored at the rail bottom
  // rather than competing with the everyday working surfaces above.
  var SETTINGS_PAGE = { key: 'settings', label: '设置', title: '设置', sub: '外观、默认档位与高级选项', icon: 'sliders', view: viewSettings };
  var ADVANCED_GROUP = '高级';
  var FLAT = NAV.concat([SETTINGS_PAGE]);
  var NAV_COUNT = { connectors: 'capability_connector', plugins: 'capability_asset', skills: 'capability_asset', memory: 'memory_item', knowledge: 'knowledge_claim', workflows: 'workflow' };

  // Mode membership, persistence and switch rules live in mode-shell.js; the
  // shell only resolves those keys back to the page definitions.
  function modeNavItems(mode) {
    var byKey = {};
    FLAT.forEach(function (item) { byKey[item.key] = item; });
    var items = modeNavKeys(mode).map(function (key) { return byKey[key]; }).filter(Boolean);
    return { everyday: items, advanced: [] };
  }

  // Home is where the app already lands, so it needs no nav entry either: it is
  // the composer and nothing else — the task list lives in the rail.
  var HOME_PAGE = { key: 'home', label: '任务区', title: '任务区', sub: '说清楚要做什么，选一个文件夹，其余交给 Craft', icon: 'tasks', view: viewHome };

  // The folder detail page is reached by clicking a folder name in the rail. It
  // stays out of NAV, but keeps a hash of its own so a reload lands back on it.
  var FOLDER_PAGE = { key: 'projects', label: '文件夹', title: '文件夹', sub: '每个文件夹记下的目标、决策、资料与成果', icon: 'folder', view: viewProjects };

  // A task is a document, not a nav destination: it is opened from a task row in
  // the left rail, so it stays outside NAV but still rides the hash — a reload or
  // a pasted link lands on the same task.
  var TASK_PAGE = { key: 'task', label: '任务', title: '任务', sub: '这个任务的目标、进度、产物与验证结论', icon: 'tasks', view: viewTask };

  // 插件详情：概览 / 技能 / 连接器 / 页面 / 设置。插件本身不贡献一级导航，页面统一挂在这里。
  var PLUGIN_PAGE = { key: 'plugin', label: '插件详情', title: '插件详情', sub: '这个插件带来了什么，以及如何启用或停用', icon: 'plug', view: viewPlugin };

  function definition(page) {
    if (page === 'task') return TASK_PAGE;
    if (page === 'home') return HOME_PAGE;
    if (page === 'pilot') return { key: 'pilot', label: MODES.pilot.title, title: MODES.pilot.title, sub: MODES.pilot.sub, icon: MODES.pilot.icon, view: viewPilot };
    if (page === 'projects') return FOLDER_PAGE;
    if (page === 'plugin') return PLUGIN_PAGE;
    return FLAT.filter(function (item) { return item.key === page; })[0] || HOME_PAGE;
  }

  function knownPage(page) {
    return page === 'task' || page === 'home' || page === 'pilot' || page === 'projects' || page === 'plugin' ||
      FLAT.some(function (item) { return item.key === page; });
  }

  function go(page, focus) {
    if (page !== 'task') state.selectedTask = null;
    if (page !== 'projects') state.selectedProject = null;
    state.focus = focus || null;
    var next = '#token=' + encodeURIComponent(state.token) + '&page=' + page +
      (focus ? '&focus=' + encodeURIComponent(focus) : '') + (state.legacyNav ? '&legacyNav=1' : '');
    if (location.hash === next) paint(page); else location.hash = next;
  }

  /**
   * The target is consumed once, so a later repaint of the same page does not
   * re-expand or re-scroll. The DOM effect itself lives in asset-focus.js.
   */
  function consumeAssetFocus(root) {
    var focus = state.focus;
    if (!focus) return;
    state.focus = null;
    applyAssetFocus(root, focus, toast);
  }

  // Opening a folder is a two-parameter hash: which page, and which folder.
  function openFolder(key) {
    state.selectedTask = null;
    state.selectedProject = key;
    var next = '#token=' + encodeURIComponent(state.token) + '&page=projects&project=' + encodeURIComponent(key);
    if (location.hash === next) paint('projects'); else location.hash = next;
  }

  function openTask(taskId) {
    state.selectedTask = taskId;
    state.selectedTaskTitle = taskTitleOf(taskId);
    var next = '#token=' + encodeURIComponent(state.token) + '&page=task&task=' + encodeURIComponent(taskId);
    if (location.hash === next) paint('task'); else location.hash = next;
  }

  // A plugin is a document too: it is opened from the plugin list, never a nav entry.
  function openPlugin(pluginId) {
    state.selectedPlugin = pluginId;
    var next = '#token=' + encodeURIComponent(state.token) + '&page=plugin&plugin=' + encodeURIComponent(pluginId);
    if (location.hash === next) paint('plugin'); else location.hash = next;
  }

  // The rail already holds every task title, so read it from there instead of
  // flashing a generic「任务」heading while the detail request is in flight.
  function taskTitleOf(taskId) {
    var groups = state.folderGroups || [];
    for (var i = 0; i < groups.length; i += 1) {
      for (var j = 0; j < groups[i].tasks.length; j += 1) {
        if (groups[i].tasks[j].id === taskId) return groups[i].tasks[j].title || '';
      }
    }
    return '';
  }

  // Mount a Codex / Claude / DSH native session into a new Craft task, then
  // jump to that task's conversation page.
  function importNativeSession(thread, provider, model, permission) {
    if (!thread || typeof thread.id !== 'string' || !thread.id) return Promise.reject(new Error('无效的原生会话'));
    if (thread.linked_task_id && thread.linked_id) { openTask(thread.linked_task_id); return Promise.resolve({ task_id: thread.linked_task_id, link_id: thread.linked_id }); }
    return api('/api/tasks', { method: 'POST', body: { title: thread.title || '历史会话', goal: '继续已有的原生会话', permission_mode: 'human_approval' } })
      .then(function (created) {
        var taskId = (created.task || created).id;
        if (!taskId) throw new Error('创建任务失败');
        var nativeBase = provider === 'dsh' ? '/api/workbench/dsh-native' : '/api/workbench/agent-sessions/' + provider + '-native';
        return api(nativeBase, { method: 'POST', body: Object.assign({ task_id: taskId, thread_id: thread.id },
          provider === 'dsh' ? { workspace: thread.workspace, permission: permission } : provider === 'claude' ? { model: model || null, permission: permission } : {}) })
          .then(function (result) { openTask(taskId); return result; });
      });
  }

  function paintNav() {
    // Home, a folder and a task all live "under" 任务 in the rail, so none of the
    // remaining nav entries is current for them.
    var current = state.page;
    // 导航随全局模式切换：灵策 / 观象 / 领航 各只暴露自己需要的入口。
    // The old complete workbench survives only as an explicit dev fallback so a
    // page that has no mode entry yet stays reachable; it is not a second UI.
    var rail = state.legacyNav ? splitRail(NAV, ADVANCED_GROUP) : modeNavItems(state.mode);
    // 版本与依据 / 上下文使用 / 梳理流程 are observation surfaces, not everyday
    // work. railNavHtml keeps them routable but behind one disclosure so the
    // working rail stays short; landing on one opens the disclosure for context.
    $('nav').innerHTML = railNavHtml({
      everyday: rail.everyday, advanced: rail.advanced, current: current, showAdvanced: state.showAdvanced,
      counts: state.counts, countKeys: NAV_COUNT, esc: esc, icon: icon
    });
    $('nav').onclick = function (event) {
      var more = event.target.closest('[data-nav-more]');
      if (more) { state.showAdvanced = !(more.getAttribute('aria-expanded') === 'true'); paintNav(); return; }
      var button = event.target.closest('[data-page]');
      if (button) go(button.getAttribute('data-page'));
    };
  }

  // 全局模式切换：领航 / 观象 / 灵策。切换只换导航与展示投影，不中断任务、不改权限。
  function paintModeSwitch() {
    var host = $('mode-switch');
    if (!host) return;
    host.innerHTML = MODE_ORDER.map(function (key) {
      var m = MODES[key];
      var active = key === state.mode;
      return '<button type="button" class="mode-btn' + (active ? ' active' : '') + '" role="tab" aria-selected="' + active + '" data-mode="' + key + '" title="' + esc(m.sub) + '">' +
        icon(m.icon) + '<span class="mode-btn-copy"><b>' + esc(m.label) + '</b><small>' + esc(m.tagline) + '</small></span></button>';
    }).join('');
    var wrap = document.createElement('div');
    wrap.className = 'mode-switch';
    wrap.innerHTML = host.innerHTML;
    host.innerHTML = '';
    host.appendChild(wrap);
    host.onclick = function (event) {
      var btn = event.target.closest('[data-mode]');
      if (!btn || btn.getAttribute('data-mode') === state.mode) return;
      setMode(btn.getAttribute('data-mode'));
    };
    var modeLabel = $('page-mode');
    var current = MODES[state.mode] || MODES.pilot;
    if (modeLabel) {
      modeLabel.textContent = current.label;
      modeLabel.setAttribute('data-mode', state.mode);
      modeLabel.title = current.sub;
    }
  }

  // 切换模式：记录偏好并落到该模式自己的首页。模式是产品上下文，不是同一页上
  // 换一层导航；总是回到首页能让三种工作方式保持清晰边界，也避免运行中的任务
  // 被误认为已经切到另一条执行链路。
  function setMode(mode) {
    if (!MODES[mode]) return;
    // NEEDREAD：切换模式时若后台仍有运行/排队任务，先弹轻量确认；任务本身不会被中断。
    // 计数不可用时不能悄悄放行——那等于把「有任务先确认」变成「网络失败就跳过」。
    // 未知状态按保守处理：明确告知无法核对，由用户决定是否仍要切换。
    api('/api/workbench/task-active-count').then(function (count) {
      var active = count && Number(count.active);
      if (!Number.isFinite(active)) { askUnknownActiveTasks(); return; }
      if (active > 0 && !window.confirm('当前有 ' + active + ' 个任务正在后台运行或排队，切换模式后可在控制台/工作台继续追踪，是否确认切换？')) return;
      commitModeSwitch(mode);
    }).catch(askUnknownActiveTasks);

    function askUnknownActiveTasks() {
      if (window.confirm('暂时无法核对后台运行中的任务数。切换不会中断任务，但仍要切换模式吗？')) commitModeSwitch(mode);
    }
  }

  function commitModeSwitch(mode) {
    if (!MODES[mode]) return;
    state.mode = mode;
    saveMode();
    // A mode is a product context with its own layout and lifecycle. Reload the
    // single document so timers, polls and mounted adapters cannot leak across
    // modes; runtime work continues in the server, not in the WebView.
    var params = new URLSearchParams(location.hash.replace(/^#/, ''));
    params.set('page', MODES[mode].home || 'home');
    params.delete('task'); params.delete('project'); params.delete('plugin');
    location.hash = '#' + params.toString();
    if (location.reload) location.reload();
  }

  // ------------------------------------------------------------------- render

  var viewRequests = createLatestRequest();

  // Panels that own timers register here so a page change stops them before their
  // host node is replaced. Without this a trial in flight would keep polling a
  // detached node after the user navigated away.
  var pagePanels = [];
  function stopPagePanels() {
    pagePanels.forEach(function (panel) { if (panel && typeof panel.destroy === 'function') panel.destroy(); });
    pagePanels = [];
  }

  function paint(page) {
    stopPagePanels();
    state.page = page;
    var def = definition(page);
    var app = $('app');
    if (app) app.setAttribute('data-page', page);
    // Changing page drops a form that belonged to the old one, so a half-filled
    // 「记一个目标」 can never follow you onto another page.
    if (inlineForm && inlineForm.page !== def.key) inlineForm = null;
    paintNav();
    var title = def.key === 'task' && state.selectedTaskTitle ? state.selectedTaskTitle : def.title;
    $('page-title').textContent = title;
    $('page-sub').textContent = def.sub;
    $('page-actions').innerHTML = '';
    var panel = $('aside-panel');
    if (panel) panel.innerHTML = '';
    document.title = title + ' · Craft Workbench';

    var content = $('content');
    content.innerHTML = skeleton();
    viewRequests(function (ticket) { return def.view(ticket); }, function (view) {
      content.innerHTML = view.html;
      // Render contextual info into the right panel
      if (panel) panel.innerHTML = view.aside || '';
      (view.mounts || []).forEach(function (mount) { mount(content); });
      consumeAssetFocus(content);
      // A form opened from this page's action bar belongs at the top of the
      // column, right above the content it edits.
      if (inlineForm && inlineForm.page === def.key) {
        content.insertAdjacentHTML('afterbegin', inlineFormHtml());
        mountInlineForm(content);
      }
      if (view.asideMount) view.asideMount(panel || $('aside'));
      bindAsideCollapsible(panel);
      var actions = $('page-actions');
      actions.innerHTML = '';
      (view.actions || []).forEach(function (action) {
        var button = document.createElement('button');
        button.className = 'btn' + (action.primary ? ' primary' : '');
        button.type = 'button';
        button.innerHTML = (action.icon ? icon(action.icon) : '') + esc(action.label);
        button.onclick = action.run;
        actions.appendChild(button);
      });
      // A sheet requested before the page finished painting (first-run model
      // setup) has to wait until now, otherwise the page would overwrite it.
      if (state.pendingSheet) {
        var pending = state.pendingSheet;
        state.pendingSheet = null;
        if (pending.page === state.page) pending.run();
      }
    }, function (error) {
      content.innerHTML = '<div class="callout warn">' + icon('alert') + '<span>页面加载失败：' + esc(error.message) + '</span></div>';
    });
  }

  // -------------------------------------------------------------------- tasks

  var HOSTS = [['codex-cli', 'Codex CLI'], ['claude-code', 'Claude Code']];
  var SANDBOXES = [['read-only', '只看不改（只读）'], ['workspace-write', '允许改动工作区文件']];

  function options(pairs, selected) {
    return pairs.map(function (pair) {
      return '<option value="' + esc(pair[0]) + '"' + (pair[0] === selected ? ' selected' : '') + '>' + esc(pair[1]) + '</option>';
    }).join('');
  }

  // Users write completion conditions in plain Chinese; the runtime still gets
  // the enum it validates against.
  var CRITERION_WORDS = {
    'file': 'file', '文件': 'file',
    'program': 'program', '命令': 'program',
    'model': 'model', '模型': 'model',
    'human': 'human', '人工': 'human',
    'business_signal': 'business_signal', '业务信号': 'business_signal'
  };

  function parseCriteria() {
    var raw = lines('task-acceptance');
    var specs = raw.map(function (line, index) {
      var match = line.match(/^(program|model|human|business_signal|file|命令|文件|模型|人工|业务信号)\s*[:：]\s*(.+)$/);
      var kind = match ? (CRITERION_WORDS[match[1]] || 'human') : 'human';
      var body = match ? match[2].trim() : line;
      return { id: 'criterion_' + (index + 1), name: (kind === 'file' ? '产出文件：' : '') + body,
        method: kind === 'file' ? 'program' : kind, required: true, file_path: kind === 'file' ? body : null };
    });
    return {
      criteria: specs.map(function (spec) { return { id: spec.id, name: spec.name, method: spec.method, required: true }; }),
      files: specs.filter(function (spec) { return spec.file_path; })
    };
  }

  // ----------------------------------------------------------------- composer
  // A task's folder is decided exactly once — when the task is created — so the
  // picker belongs on the composer, right under the input box, instead of behind
  // a folder menu. Nothing here opens a dialog: what needs more room uses the
  // right panel.

  var WORKSPACE_KEY = 'craft.workspace';
  var caps = { connectors: [], assets: [], userSkills: [] };

  // Sort order is the rail's: folders the store knows first, 「默认」 last, and
  // a folder the store has no record for is still offered (tasks can point at one).
  function composerFolders() {
    var html = '<option value="">默认（不选文件夹）</option>';
    (state.folderGroups || []).forEach(function (group) {
      if (!group.key) return;
      html += '<option value="' + esc(group.key) + '"' + (state.composer.folder === group.key ? ' selected' : '') + '>' +
        esc(group.name) + '（' + group.tasks.length + '）</option>';
    });
    return html + '<option value="__new__">＋ 新建文件夹</option>';
  }

  function capNameOf(id) {
    var list = caps.assets || [];
    for (var i = 0; i < list.length; i += 1) { if (list[i].id === id) return list[i].name || id; }
    list = caps.userSkills || [];
    for (var j = 0; j < list.length; j += 1) { if (list[j].id === id) return list[j].name || id; }
    return id;
  }

  function loadCapabilities() {
    if (caps.assets.length || caps.userSkills.length) return Promise.resolve(caps);
    return Promise.all([api('/api/connectors?limit=100'), api('/api/workbench/resources?kind=skills&limit=100')]).then(function (results) {
      caps.connectors = results[0].connectors || [];
      caps.assets = results[0].assets || [];
      caps.userSkills = results[1].items || [];
      return caps;
    });
  }

  function renderComposerChips() {
    var host = $('composer-chips');
    if (!host) return;
    var chosen = state.composer.caps || [];
    host.innerHTML = chosen.length
      ? '<div class="chips">' + chosen.map(function (id) {
          return '<span class="chip">' + icon('plug') + esc(capNameOf(id)) +
            '<button type="button" data-cap-drop="' + esc(id) + '" aria-label="移除这个能力">' + icon('x') + '</button></span>';
        }).join('') + '</div>'
      : '';
    host.querySelectorAll('[data-cap-drop]').forEach(function (button) {
      button.onclick = function () {
        var id = button.getAttribute('data-cap-drop');
        state.composer.caps = (state.composer.caps || []).filter(function (item) { return item !== id; });
        renderComposerChips();
      };
    });
  }

  // Toggling 更多 flips visibility instead of re-rendering, so whatever the user
  // already typed into the box or the work-directory field survives.
  function composerHtml() {
    var c = state.composer;
    var modelOptions = (c.models || []).map(function (model) {
      return '<option value="' + esc(model.id) + '"' + (model.id === c.model ? ' selected' : '') + '>' +
        esc(model.name + ' · ' + model.model) + (model.configured ? '' : '（待填密钥）') + '</option>';
    }).join('');
    var ready = (c.models || []).filter(function (model) { return model.configured; });
    return '<div class="composer">' +
      '<textarea id="composer-text" rows="3" placeholder="说说要做的事，例如：修复登录超时，并补上回归用例"></textarea>' +
      '<div id="composer-chips"></div>' +
      '<div class="composer-bar">' +
        '<button class="cbtn" type="button" id="composer-caps" title="这个任务可以用哪些已登记的能力">' + icon('plus') + '<span>能力</span></button>' +
        '<label class="cbtn cbtn-pick" title="这个任务算在哪个文件夹">' + icon('folder') +
          '<select id="composer-folder" aria-label="选择文件夹">' + composerFolders() + '</select></label>' +
        '<label class="cbtn cbtn-pick" title="选择本次对话使用的模型">' + icon('cpu') +
          '<select id="composer-model" aria-label="选择模型"' + (ready.length ? '' : ' disabled') + '>' +
            (modelOptions || '<option value="">先到设置添加模型</option>') + '</select></label>' +
        '<label class="cbtn cbtn-pick" title="选择任务权限">' + icon('shield') +
          '<select id="task-permission" aria-label="选择权限">' +
            options([['human_approval', '手动审批'], ['assisted_approval', '帮我审批'], ['full_access', '完全访问']], c.permission) +
          '</select></label>' +
        '<span class="grow"></span>' +
        (ready.length ? '<button class="cbtn primary" type="button" id="composer-send">' + icon('play') + '<span>开始</span></button>' :
          '<button class="cbtn" type="button" id="composer-model-setup">先添加模型</button>') +
      '</div>' +
      '<div class="composer-note">对话从模型开始。文件、命令与外部动作会依照所选权限另行确认。</div>' +
      '</div>';
  }

  function bindComposer(root) {
    var box = root.querySelector('#composer-text');
    if (!box) return;
    var folder = root.querySelector('#composer-folder');
    folder.onchange = function () {
      if (folder.value === '__new__') {
        // Put the picker back where it was, then ask for the new folder in the
        // right panel; createProject() hands the new id back to the composer.
        folder.value = state.composer.folder || '';
        openCreateProjectSheet();
        return;
      }
      state.composer.folder = folder.value;
      var node = $('aside-folder');
      if (node) node.textContent = folderNameOf(folder.value);
    };
    var model = root.querySelector('#composer-model');
    if (model) model.onchange = function () { state.composer.model = model.value; };
    var permission = root.querySelector('#task-permission');
    if (permission) permission.onchange = function () { state.composer.permission = permission.value; };
    root.querySelector('#composer-caps').onclick = openCapabilitySheet;
    var send = root.querySelector('#composer-send');
    if (send) send.onclick = submitComposer;
    var setup = root.querySelector('#composer-model-setup');
    if (setup) setup.onclick = function () { go('models'); };
    box.onkeydown = function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submitComposer(); }
    };
    renderComposerChips();
  }

  // 「新建任务」 means "put the cursor where a task gets written", so it focuses
  // the composer instead of opening a dialog.
  // 文档 14 红线 3：表单不再是常驻的，而是按下时才出现的一张内联卡，用完即收。
  // 「新建任务」 now lands on the conversation surface, which owns the input.
  function openComposer() { go('home'); }

  function submitComposer() {
    var raw = val('composer-text');
    if (!raw) { toast('先说一下要做什么', true); return; }
    var model = val('composer-model') || state.composer.model;
    if (!model) { toast('请先选择一个可用模型', true); return; }
    var configuredModel = (state.composer.models || []).filter(function (item) { return item.id === model; })[0];
    if (!configuredModel || !configuredModel.configured) { toast('这个模型还没有可用密钥，请先到设置完成配置', true); return; }
    var folder = $('composer-folder') ? $('composer-folder').value : '';
    if (folder === '__new__') folder = '';
    var firstLine = raw.split(/\r?\n/)[0].trim();
    var title = firstLine.length > 42 ? firstLine.slice(0, 42) + '…' : firstLine;
    var chosen = state.composer.caps || [];
    // The runtime has no field for capability selection yet, so the names ride
    // along in the prompt as an explicit instruction instead of being dropped.
    var selectedSkills = (caps.userSkills || []).filter(function (item) { return chosen.indexOf(item.id) >= 0; });
    var prompt = chosen.length ? raw + '\n\n可用的能力：' + chosen.map(capNameOf).join('、') : raw;
    if (selectedSkills.length) prompt += '\n\n<craft-user-skills>\n' + selectedSkills.map(function (item) { return '### ' + item.name + '\n' + item.content; }).join('\n\n') + '\n</craft-user-skills>';
    var body = { title: title, goal: raw, model_id: model, permission_mode: val('task-permission') || 'human_approval' };
    if (folder) {
      // A folder group keyed by canonical workspace_id binds the task to that
      // workspace; a logical project group keeps using project_id.
      var group = (state.folderGroups || []).filter(function (g) { return g.key === folder; })[0];
      if (group && group.kind === 'workspace') body.workspace_id = folder;
      else body.project_id = folder;
    }
    state.composer.model = model;
    state.composer.permission = body.permission_mode;
    state.composer.lastPrompt = prompt;
    api('/api/tasks', { method: 'POST', body: body }).then(function (created) {
      var task = created.task || {};
      if (!task.id) throw new Error('任务创建未返回任务编号');
      return api('/api/tasks/' + encodeURIComponent(task.id) + '/messages', { method: 'POST', body: { content: prompt } }).then(function () { return task; });
    }).then(function (task) {
      toast('任务已开始');
      state.composer.folder = '';
      state.composer.caps = [];
      // 文档 14 红线 3：表单是按需出现的内联卡，提交后即收起，不再停留。
      clearInline();
      renderFolderTree(true);
      openTask(task.id);
    }).catch(fail);
  }

  // `/api/home` caps its task list server-side (default 10, max 50) and used to
  // slice silently: the rail showed 10 rows while the status bar said 12. Ask
  // for the 50-cap, and if the store ever outgrows it, say so on screen instead
  // of dropping rows without a word.
  var TASK_LIST_LIMIT = 50;

  // ------------------------------------------------------------- folder tree
  // The rail groups tasks by folder. Folders are derived from the tasks
  // themselves and unioned with the folder records, because a task may point at
  // a folder that has no record yet (the local store has such a case) and
  // listing records alone would make those tasks vanish.

  function taskRowHtml(task) {
    var active = state.selectedTask === task.id;
    return '<button class="conv-item" type="button" data-task="' + esc(task.id) + '"' + (active ? ' aria-current="true"' : '') + '>' +
      '<span class="conv-icon">' + icon('tasks') + '</span>' +
      '<span class="conv-main"><span class="conv-title">' + esc(task.title || '未命名任务') + '</span>' +
      '<span class="conv-sub">' + esc(task.goal || '—') + '</span></span></button>';
  }

  // Same tasks, rendered for a page body rather than the rail (wider rows).
  function taskListRows(tasks) {
    return tasks.map(function (task) {
      return '<div class="row selectable" data-task="' + esc(task.id) + '">' + lead('tasks') +
        '<div class="row-main"><span class="row-title">' + esc(task.title || '未命名任务') + '</span>' +
        '<span class="row-sub">' + esc(task.goal || '—') + '</span></div>' +
        statusPill(task.status) + '</div>';
    }).join('');
  }

  // A folder shows its five most recent tasks; anything beyond that is behind one
  // click, so a folder holding ten tasks does not push the rest of the rail off
  // the screen.
  var FOLDER_PREVIEW = 5;

  function folderGroupHtml(group) {
    var collapsed = !!state.collapsedFolders[group.key];
    var all = group.tasks;
    var expanded = state.showAllFolders[group.key] === true;
    var shown = expanded ? all : all.slice(0, FOLDER_PREVIEW);
    var rest = all.length - shown.length;
    var more = '';
    if (expanded && all.length > FOLDER_PREVIEW) {
      more = '<button class="ft-more" type="button" data-more="' + esc(group.key) + '">收起</button>';
    } else if (rest > 0) {
      more = '<button class="ft-more" type="button" data-more="' + esc(group.key) + '">还有 ' + rest + ' 个，展开</button>';
    }
    var body = all.length
      ? '<div class="conv-list ft-tasks">' + shown.map(taskRowHtml).join('') + '</div>' + more
      : '<div class="ft-empty">还没有任务</div>';
    return '<div class="ft-group"' + (collapsed ? ' data-collapsed="true"' : '') + '>' +
      '<button class="ft-head" type="button" data-folder="' + esc(group.key) + '" aria-expanded="' + String(!collapsed) + '">' +
        '<span class="ft-chev" data-chev="' + esc(group.key) + '">' + icon('chev') + '</span>' +
        icon(group.key ? 'folder' : 'inbox', 'ft-ic') +
        '<span class="ft-name">' + esc(group.name) + '</span>' +
        '<span class="ft-count">' + group.tasks.length + '</span>' +
      '</button>' + (collapsed ? '' : body) + '</div>';
  }

  function paintFolderTree() {
    var host = $('folder-tree');
    if (!host) return;
    var groups = state.folderGroups || [];
    var fetched = groups.reduce(function (sum, group) { return sum + group.tasks.length; }, 0);
    // Prefer the real total from /api/workbench/summary so the chip matches the
    // status bar even if the fetch hit the 50-row cap.
    var total = Number(state.counts.task || 0) || fetched;
    var count = $('task-list-count');
    if (count) count.textContent = String(total);
    var sw = $('task-view');
    if (sw) {
      sw.textContent = state.taskView === 'task' ? '按任务' : '按文件夹';
      sw.setAttribute('title', state.taskView === 'task'
        ? '现在按更新时间倒序，点一下切回按文件夹'
        : '现在按文件夹分组，点一下切成按更新时间倒序');
    }
    // 全部展开/折叠 only means something while folders are on screen; a flat list
    // has nothing to fold, so the control goes away instead of doing nothing.
    var fold = $('task-fold');
    if (fold) fold.hidden = state.taskView === 'task';
    var body;
    if (state.taskView === 'task') {
      // One flat list, newest update first — the rail's answer to "what did I
      // touch last?" without opening a single folder.
      var flat = groups.reduce(function (all, group) { return all.concat(group.tasks); }, [])
        .sort(function (a, b) { return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });
      body = flat.length ? '<div class="conv-list">' + flat.map(taskRowHtml).join('') + '</div>' : '';
    } else {
      body = groups.length ? groups.map(folderGroupHtml).join('') : '';
      if (fetched < total) {
        body += '<div class="aside-note" style="padding:8px">共 ' + total + ' 个任务，这里显示最近 ' + fetched + ' 个。</div>';
      }
    }
    host.innerHTML = body || '<div class="aside-note" style="padding:8px">还没有任务，在上面的输入框里说一句就开始。</div>';
  }

  function renderFolderTree(refetch) {
    var host = $('folder-tree');
    if (!host) return;
    if (!refetch && state.folderGroups) { paintFolderTree(); return; }
    Promise.all([
      settled(api('/api/projects?limit=200'), { projects: [] }),
      api('/api/home?limit=' + TASK_LIST_LIMIT)
    ]).then(function (results) {
      state.folderGroups = groupByFolder(results[0].projects || [], results[1].tasks || [], results[1].workspaces || []);
      paintFolderTree();
    }).catch(function () {
      var count = $('task-list-count');
      if (count) count.textContent = '—';
      // A fresh workspace has no tasks. Do not turn an empty or unavailable
      // projection into invented sample data or a permanent error row.
      host.innerHTML = '';
    });
  }

  function toggleFolder(key) {
    if (state.collapsedFolders[key]) delete state.collapsedFolders[key];
    else state.collapsedFolders[key] = true;
    renderFolderTree(false);
  }

  // --------------------------------------------------------------------- home
  // Home is the composer and nothing else. The rail already lists every task, so
  // repeating the list here would just be a second copy of the same rows.

  // Right-panel blocks that only repeat what the page already says can be folded
  // away — collapsed by default, because the panel should not explain itself
  // before being asked.
  function asideCollapsible(title, bodyHtml) {
    var open = state.asideOpen[title] === true;
    return '<div class="aside-block">' +
      '<button class="aside-head aside-fold" type="button" data-fold="' + esc(title) + '" aria-expanded="' + String(open) + '">' +
        '<span>' + esc(title) + '</span>' + icon('chev') + '</button>' +
      (open ? bodyHtml : '') + '</div>';
  }

  function bindAsideCollapsible(panel) {
    if (!panel) return;
    panel.querySelectorAll('[data-fold]').forEach(function (button) {
      button.onclick = function () {
        var key = button.getAttribute('data-fold');
        state.asideOpen[key] = !(state.asideOpen[key] === true);
        paint(state.page);
      };
    });
  }

  // The workbench home is the conversation surface: the native-session
  // workspace that used to live in the separate entry shell, mounted inside
  // the main shell so the rail, settings and context panel stay visible.
  // Mode pages live in mode-pages.js; the shell wires them below.

  // 领航：连续对话区 + 底部输入框。首版复用 Agent 工作区作为对话面；意图拆分、并发队列与
  // 路由改派：会话与拆分任务走服务端 /api/pilot 会话与 intake API（模型拆分仍是后续里程碑）。

  // 控制台「新建会话」抽屉：创建成功后停留在控制台，任务插入“我的任务”，
  // 不跳转到工坊首页，保持任务治理上下文不中断。

  // 我的任务：控制台按计划要求的七种状态分组展示，卡片带「新建会话」入口。
  function viewOverview() {
    return Promise.all([
      loadCapabilities().catch(function () { return caps; }),
      settled(api('/api/config/models'), { models: [] }),
      settled(api('/api/objects?limit=50'), {}),
      settled(api('/api/subscriptions'), { subscriptions: [] }),
      settled(api('/api/claims/l1-report'), {}),
      settled(api('/api/inbox/refresh', { method: 'POST', body: {} }), { cards: [] })
    ]).then(function (results) {
      state.composer.models = results[1].models || [];
      if (!state.composer.model && state.composer.models.length) state.composer.model = state.composer.models[0].id;
      // 文档 14 红线 3：不许有常驻的大输入框。输入框是 L3 的入口，L3 应该稀有；
      // 把稀有通道做成常驻，等于承认系统大部分时间不知道你要什么。home 只放入口卡，
      // 表单在按下时才以内联卡出现，用完即收。
      var ready = (state.composer.models || []).filter(function (item) { return item.configured; });
      // 文档 2：发起权在系统。首页先回答「现在有没有需要我」，再给出入口。
      var railCounts = (results[2] && results[2].counts) || {};
      var subscriptions = (results[3] && results[3].subscriptions) || [];
      var l1 = results[4] || {};
      var attention = (results[5] && results[5].cards) || [];
      var pendingApprovals = attention.filter(function (card) {
        return (card.audience === 'human' || card.audience === undefined) && card.status === 'open';
      }).length;
      var now = Date.now();
      var subsNeedingYou = subscriptions.filter(function (item) {
        if (item.state === 'revoked') return false;
        if (item.state === 'suspended') return true;
        var expires = item.expires_at ? Date.parse(item.expires_at) : NaN;
        return Number.isFinite(expires) && expires <= now;
      }).length;
      var needsYou = Number(railCounts.needs_you || 0);
      var l1Ratio = (l1.l1_ratio === null || l1.l1_ratio === undefined) ? '尚无决策' : Math.round(Number(l1.l1_ratio) * 100) + '%';
      var needRows = [
        { label: '待你批准', value: pendingApprovals, page: 'approvals', tone: pendingApprovals ? 'bad' : 'muted', hint: '写入、外部操作与生成代码执行前需要你的决定' },
        { label: '待裁决对象', value: needsYou, page: 'objects', tone: needsYou ? 'bad' : 'muted', hint: '中央一次只放一个待裁决项' },
        { label: '需确认的订阅', value: subsNeedingYou, page: 'subscriptions', tone: subsNeedingYou ? 'warn' : 'muted', hint: '到期或结构漂移都只挂起，等你确认' },
        { label: '进行中的对象', value: Number(railCounts.in_progress || 0), page: 'objects', tone: 'muted', hint: '系统在推进，不需要你' },
        { label: 'L1 占比 ' + l1Ratio, value: null, page: 'approvals', tone: 'muted', hint: '确定性检查器 ' + Number(l1.deterministic_checkers || 0) + ' 个 · 决策 ' + Number(l1.total_decisions || 0) + ' 次' }
      ].map(function (row) {
        return '<div class="row"><div class="row-main"><span class="row-title">' + esc(row.label) + '</span>' +
          '<span class="row-sub">' + esc(row.hint) + '</span></div>' +
          (row.value === null ? '' : pill(String(row.value), row.tone)) +
          '<div class="row-actions"><button class="btn" type="button" data-home-go="' + row.page + '">去看</button></div></div>';
      }).join('');
      var startEntries = ready.length
        ? '<div class="aside-note">要开始一件事，从下面这扇门进。它不会一直开着——大部分时间，系统应该自己知道该做什么。</div>' +
          '<div class="home-entries">' +
          '<button class="btn primary" type="button" id="home-intent">' + icon('plus') + '<span>说一个意图</span></button>' +
          '<button class="btn" type="button" id="home-hatch">' + icon('spark') + '<span>孵化一个新对象</span></button>' +
          '<button class="btn" type="button" id="home-configure">' + icon('sliders') + '<span>配置</span></button>' +
          '</div>'
        : '<div class="aside-note">还没有可用的模型。先在「模型」里完成配置，Craft 才能开始工作。</div>' +
          '<div class="home-entries">' +
          '<button class="btn primary" type="button" id="home-setup">去配置模型</button>' +
          '<button class="btn" type="button" id="home-configure">' + icon('sliders') + '<span>设置</span></button>' +
          '</div>';
      return {
        html: '<div class="stack home">' +
          '<div class="card">' + head('需要你', '系统发起的工作；没有需要你的裁决时不打扰', countChip(needsYou)) +
          '<div class="card-body"><div class="rows">' + needRows + '</div>' +
          (needsYou || subsNeedingYou || pendingApprovals ? '' : '<div class="aside-note">现在没有需要你的决定。系统会在必要时才打断你。</div>') +
          '</div></div>' +
          '<div class="card">' + head('从这里开始', '交付物本身，而不是与它的对话') + '<div class="card-body">' + startEntries + '</div></div>' +
          '<p class="home-hint">所有任务在左边「任务」里，默认按文件夹分组。</p>' +
          '</div>',
        aside: asideCollapsible('文件夹是什么',
            '<div class="aside-note">一个文件夹记录一个方向：目标是什么、做过哪些决定、参考了哪些资料、最后得到了什么。' +
            'Craft 只保存引用与摘要，不保存原文。</div>') +
          asideBlock('这次任务', '', '<div class="aside-list">' +
            '<div class="aside-row"><span class="k">文件夹</span><span class="v" id="aside-folder">' + esc(folderNameOf(state.composer.folder)) + '</span></div>' +
            '<div class="aside-row"><span class="k">权限</span><span class="v" id="aside-sandbox">' + esc(state.composer.sandbox === 'workspace-write' ? '完全访问' : '有限访问') + '</span></div>' +
            '</div>'),
        mounts: [function (root) {
          var intent = root.querySelector('#home-intent');
          if (intent) intent.onclick = openComposer;
          var hatch = root.querySelector('#home-hatch');
          if (hatch) hatch.onclick = openHatch;
          var setup = root.querySelector('#home-setup');
          if (setup) setup.onclick = function () { go('models'); };
          var configure = root.querySelector('#home-configure');
          if (configure) configure.onclick = function () { go('models'); };
          Array.prototype.forEach.call(root.querySelectorAll('[data-home-go]'), function (button) {
            button.onclick = function () { go(button.getAttribute('data-home-go')); };
          });
        }]
      };
    });
  }

  // ----------------------------------------------------------------- projects

  function createProject() {
    var name = val('project-name');
    if (!name) { toast('请填写文件夹名称', true); return; }
    // The folder's internal id stays invisible; it is derived, never typed.
    var id = 'folder-' + Date.now().toString(36);
    api('/api/projects', { method: 'POST', body: { project_id: id, name: name, description: val('project-desc') } })
      .then(function (result) {
        // Whichever route asked for a new folder, the point was to put something
        // in it, so hand the new id back to the composer's picker.
        state.composer.folder = id;
        state.selectedProject = id;
        toast('文件夹「' + name + '」' + (result.idempotent ? '已存在' : '已创建'));
        return renderFolderTree(true);
      }).then(function () {
        paint(state.page === 'projects' ? 'projects' : 'home');
      }).catch(fail);
  }

  // No dialog: the form renders in the right panel like every other sheet.
  function openCreateProjectSheet() {
    openSheet(function (panel) {
      panel.innerHTML = sheetHead('新建文件夹', '把一组相关任务归到一起') +
        '<div class="sheet-body">' +
          '<div class="field"><label for="project-name">名称</label><input id="project-name" type="text" placeholder="例如：登录体验优化"></div>' +
          '<div class="field"><label for="project-desc">说明（可选）</label><textarea id="project-desc" placeholder="这个方向想达成什么"></textarea></div>' +
          '<button class="btn primary" type="button" id="project-create">' + icon('plus') + '创建</button>' +
        '</div>';
      panel.querySelector('#project-create').onclick = createProject;
      bindSheetBack(panel);
    });
  }

  // The ＋ in the composer picks which already-confirmed capabilities this task
  // may use. A right-panel sheet, like everything else that needs more room.
  function openCapabilitySheet() {
    openSheet(function (panel) {
      panel.innerHTML = sheetHead('这个任务可以用哪些能力', '只有已确认可用的能力才能勾选') +
        '<div class="sheet-body"><div class="splash"><span class="spin"></span>正在读取…</div></div>';
      bindSheetBack(panel);
      loadCapabilities().then(function () {
        var chosen = state.composer.caps || [];
        var usable = (caps.assets || []).filter(function (item) { return item.status === 'approved'; }).map(function (item) { return { id: item.id, name: item.name, sub: label(ASSET_TYPE_LABELS, item.asset_type, item.asset_type) + ' · ' + label(EFFECT_LABELS, item.effect, item.effect) }; });
        var personalSkills = (caps.userSkills || []).filter(function (item) { return item.status === 'active'; }).map(function (item) { return { id: item.id, name: item.name, sub: '已安装技能 · 将作为任务上下文附带' }; });
        var available = usable.concat(personalSkills);
        var body = available.length
          ? available.map(function (item) {
              return '<label class="check cap-row"><input type="checkbox" data-cap="' + esc(item.id) + '"' +
                (chosen.indexOf(item.id) >= 0 ? ' checked' : '') + '>' +
                '<span class="cap-text"><b>' + esc(item.name) + '</b><span>' +
                esc(item.sub) + '</span></span></label>';
            }).join('') + '<div class="aside-note" style="margin-top:10px">外部能力需先在「连接器」确认；本地上传的技能可直接作为任务指令上下文使用。</div>'
          : '<div class="aside-note">还没有可用能力。先上传技能，或在「连接器」里添加一个来源并确认能力。</div>';
        panel.innerHTML = sheetHead('这个任务可以用哪些能力', '只有已确认可用的能力才能勾选') +
          '<div class="sheet-body">' + body + '</div>';
        bindSheetBack(panel);
        panel.querySelectorAll('[data-cap]').forEach(function (input) {
          input.onchange = function () {
            var id = input.getAttribute('data-cap');
            var list = state.composer.caps || [];
            state.composer.caps = input.checked
              ? list.concat([id]).filter(function (x, i, all) { return all.indexOf(x) === i; })
              : list.filter(function (x) { return x !== id; });
            renderComposerChips();
          };
        });
      }).catch(fail);
    });
  }

  // Approving a launch only works while its work-loop id is still in hand, so the
  // button is offered only when it can actually do something — never as a control
  // that fails when pressed. A durable「等我批准」list belongs to the inbox work.
  function taskPageActions(task) {
    var actions = [
      { label: '回到任务', icon: 'tasks', run: function () { go('home'); } },
      { label: '新建任务', icon: 'plus', run: openComposer }
    ];
    var pending = state.pendingApproval;
    if (pending && pending.taskId === task.id && pending.loopId) {
      actions.unshift({ label: '批准并开始', icon: 'check', primary: true, run: function () { approveLaunch(pending.loopId); } });
    }
    return actions;
  }

  function approveLaunch(loopId) {
    // The kernel rejects a decision with no summary and a launch with no prompt,
    // so both are supplied here — passing them empty is what made the old
    // 「批准并开始」 button fail with a 422 every time.
    api('/api/verified-work-loops/' + encodeURIComponent(loopId) + '/decide', {
      method: 'POST', body: {
        decision: 'approve', actor: operatorOf(), approved: true,
        summary: '用户确认这次执行可以改文件',
        prompt: state.composer.lastPrompt || '按原指令执行'
      }
    }).then(function () {
      state.pendingApproval = null;
      toast('已批准，任务开始执行');
      paint('task');
    }).catch(fail);
  }

  function projectAction(kind, body) {
    api('/api/projects/' + encodeURIComponent(state.selectedProject) + '/' + kind, { method: 'POST', body: body })
      .then(function () { clearInline(); toast('已记录'); paint('projects'); }).catch(fail);
  }

  function addGoal() { projectAction('goals', { title: val('goal-title'), metric: val('goal-metric') || undefined, constraint_digests: [] }); }

  function addDecision() {
    projectAction('decisions', { title: val('decision-title'), rationale: val('decision-rationale'), chosen_ref: val('decision-chosen'), excluded_refs: [] });
  }

  function addMaterial() {
    projectAction('materials', { name: val('material-name'), uri: val('material-uri'), content_digest: val('material-digest'), source_type: 'user' });
  }

  function addOutcome() {
    projectAction('outcomes', { verdict: val('outcome-verdict'), summary: val('outcome-summary'), evidence_ids: [], artifact_ids: [] });
  }

  var loadProjectPage = createProjectPage(api, TASK_LIST_LIMIT);
  function viewProjects(ticket) {
    var selected = state.selectedProject;
    return loadProjectPage(selected).then(function (page) {
      if (!ticket.current()) return null;
      var groups = page.groups;
      var selectedGroup = page.selectedGroup;
      state.folderGroups = groups;
      paintFolderTree();

      var rows = groups.length
        ? groups.map(function (group) {
            var monogram = String(group.name || '?').trim().charAt(0).toUpperCase();
            return '<div class="row selectable" data-project="' + esc(group.key) + '"' + (group.key === selected ? ' aria-selected="true"' : '') + '>' +
              '<span class="row-lead accent">' + esc(monogram) + '</span>' +
              '<div class="row-main"><span class="row-title">' + esc(group.name) + '</span>' +
              '<span class="row-sub">' + (group.tasks.length ? group.tasks.length + ' 个任务' : '还没有任务') + '</span></div>' +
              countChip(group.tasks.length) + '</div>';
          }).join('')
        : emptyState('还没有文件夹', '文件夹用来把相关任务归到一起，并记下这个方向的目标与结论', 'folder');

      var detail = '<div class="card"><div class="card-body">' + emptyState('还没有选中文件夹', '从左边选一个文件夹，看它记下的目标、决策和成果', 'folder') + '</div></div>';
      var aside = asideBlock('文件夹是什么', '', '<div class="aside-note">一个文件夹记录一个方向：目标是什么、做过哪些决定、参考了哪些资料、最后得到了什么。Craft 只保存引用与摘要，不保存原文。</div>');
      var chain = Promise.resolve();

      // 工作区分组是目录身份，没有 Project Brain 快照，落到列任务的分支。
      if (selectedGroup && selectedGroup.known && page.snapshot) {
        chain = Promise.resolve(page.snapshot).then(function (snapshot) {
          var groups = [
            ['目标', 'spark', snapshot.goals || []],
            ['决策', 'check', snapshot.decisions || []],
            ['资料', 'file', snapshot.materials || []],
            ['成果', 'layers', snapshot.outcomes || []],
            ['任务', 'tasks', snapshot.tasks || []],
            ['经验', 'db', snapshot.experiences || []]
          ];
          var section = function (title, iconName, items) {
            var body = items.length ? items.map(function (item) {
              return '<div class="row"><div class="row-main">' +
                '<span class="row-title">' + esc(item.title || item.name || item.summary || item.id) + '</span>' +
                (item.metric || item.rationale
                  ? '<span class="row-sub">' + esc(item.metric || item.rationale) + '</span>' : '') +
                '</div>' + statusPill(item.status) + '</div>';
            }).join('') : emptyState('还没有' + title, null, iconName);
            return '<div class="card">' + head(title, items.length + ' 条') + '<div class="card-body tight"><div class="rows">' + body + '</div></div></div>';
          };
          var next = snapshot.next_action;
          detail = '<div class="stack">' +
            '<div class="card">' + head(snapshot.brain.name, '文件夹：' + esc(snapshot.brain.name),
              pill(next === 'replan_session' ? '需要重新规划' : '正常', next === 'replan_session' ? 'warn' : 'info')) +
              '<div class="card-body"><div class="callout accent">' + icon('shield') +
              '<span>Craft 在这个文件夹里只保存引用与摘要，不保存原文。</span></div></div></div>' +
            '<div class="grid-2">' + groups.map(function (group) { return section(group[0], group[1], group[2]); }).join('') + '</div>' +
          '</div>';
          aside = asideBlock('记录概览', '', asideRows(groups.map(function (group) { return [group[0], group[2].length]; }))) +
            asideBlock('下一步', '', '<div class="aside-note">' + esc(next === 'replan_session' ? '这个文件夹里的任务需要重新规划一次' : '暂时不需要额外处理') + '</div>');
        });
      } else if (selectedGroup) {
        //「默认」and folders the store has no record for have no brain snapshot
        // to read, so list the tasks hanging off them instead of an empty pane.
        detail = '<div class="stack">' +
          '<div class="card">' + head(selectedGroup.name, null, countChip(selectedGroup.tasks.length)) +
            '<div class="card-body tight"><div class="rows">' +
              (selectedGroup.tasks.length ? taskListRows(selectedGroup.tasks) : emptyState('还没有任务', null, 'tasks')) +
            '</div></div></div>' +
          (selectedGroup.kind === 'workspace'
            ? '<div class="card"><div class="card-body"><div id="workspace-plugins">正在读取工作区插件…</div></div></div>'
            : '') +
          (selectedGroup.key ? '<div class="callout warn">' + icon('alert') +
            '<span>' + (selectedGroup.kind === 'workspace'
              ? '这是一个按目录归组的工作区；目标与成果要到对应的逻辑项目里登记。'
              : '这个文件夹还没有登记信息，所以看不到它的目标与成果，只能列出挂在它下面的任务。') + '</span></div>' : '') +
        '</div>';
        aside = asideBlock('这个文件夹', '', asideRows([
          ['任务', selectedGroup.tasks.length],
          ['信息', selectedGroup.kind === 'workspace' ? '工作区（目录）' : selectedGroup.key ? '未登记' : '默认文件夹']
        ])) + asideBlock('说明', '', '<div class="aside-note">' +
          (selectedGroup.key
            ? (selectedGroup.kind === 'workspace'
                ? '工作区按规范化目录归组；插件按工作区启用或停用。'
                : '它只有任务，还没有登记过目标与成果。')
            : '新建任务时没有选文件夹，就会落到这里。') + '</div>');
      }

      return chain.then(function () {
        var actions = [{ label: '新建文件夹', icon: 'plus', run: openCreateProjectSheet }];
        if (selectedGroup && selectedGroup.known && page.snapshot) {
          actions.push(['记一个目标', 'spark', function () {
            openInline({ title: '记一个目标', sub: selectedGroup.name, html:
              '<div class="stack"><div class="field"><label for="goal-title">目标</label><input id="goal-title" type="text" placeholder="让首屏加载进入 1 秒内"></div>' +
              '<div class="field"><label for="goal-metric">怎么算达成</label><input id="goal-metric" type="text" placeholder="首屏 p95 小于 1 秒"></div></div>',
              actions: [{ label: '保存', primary: true, run: addGoal }] });
          }]);
          actions.push(['记一个决策', 'check', function () {
            openInline({ title: '记一个决策', sub: selectedGroup.name, html:
              '<div class="stack"><div class="field"><label for="decision-title">决定了什么</label><input id="decision-title" type="text"></div>' +
              '<div class="field"><label for="decision-chosen">选了哪个方案</label><input id="decision-chosen" type="text"></div>' +
              '<div class="field"><label for="decision-rationale">为什么这么选</label><textarea id="decision-rationale"></textarea></div></div>',
              actions: [{ label: '保存', primary: true, run: addDecision }] });
          }]);
          actions.push(['加一份资料', 'file', function () {
            openInline({ title: '加一份资料', sub: selectedGroup.name, html:
              '<div class="stack"><div class="field"><label for="material-name">资料名称</label><input id="material-name" type="text" placeholder="接口设计文档"></div>' +
              '<div class="field"><label for="material-uri">文件位置</label><input id="material-uri" type="text" placeholder="D:\\docs\\spec.md"></div>' +
              '<div class="field"><label for="material-digest">内容指纹（可选）</label><input id="material-digest" type="text" placeholder="留空即可"></div></div>',
              actions: [{ label: '保存', primary: true, run: addMaterial }] });
          }]);
          actions.push(['记一个成果', 'layers', function () {
            openInline({ title: '记一个成果', sub: selectedGroup.name, html:
              '<div class="stack"><div class="field"><label for="outcome-verdict">结论</label><input id="outcome-verdict" type="text" placeholder="达成了 / 部分达成 / 没达成"></div>' +
              '<div class="field"><label for="outcome-summary">说明</label><textarea id="outcome-summary"></textarea></div></div>',
              actions: [{ label: '保存', primary: true, run: addOutcome }] });
          }]);
        }

        return {
          actions: actions.map(function (entry) {
            return Array.isArray(entry)
              ? { label: entry[0], icon: entry[1], run: entry[2] }
              : entry;
          }),
          html: '<div class="split">' +
            '<div class="card">' + head('文件夹', '把相关任务归到一起', countChip(groups.length)) +
              '<div class="card-body tight"><div class="rows">' + rows + '</div></div></div>' +
            detail + '</div>',
          aside: aside,
          mounts: [function (root) {
            root.querySelectorAll('[data-project]').forEach(function (row) {
              row.onclick = function () { state.selectedProject = row.getAttribute('data-project'); paint('projects'); };
            });
            root.querySelectorAll('[data-task]').forEach(function (row) {
              row.onclick = function () { openTask(row.getAttribute('data-task')); };
            });
            // 插件按工作区启用/停用；未启用的插件不贡献页面。
            var pluginHost = selectedGroup && selectedGroup.kind === 'workspace' ? root.querySelector('#workspace-plugins') : null;
            if (pluginHost) {
              Promise.all([
                settled(api('/api/workbench/resources?kind=plugins&limit=100'), { items: [] }),
                settled(api('/api/workspaces/' + encodeURIComponent(selectedGroup.key) + '/plugins'), { bindings: [] }),
              ]).then(function (pair) {
                var installed = pair[0].items || [];
                var enabledByPlugin = {};
                (pair[1].bindings || []).forEach(function (binding) { enabledByPlugin[binding.plugin_id] = binding.status; });
                if (!installed.length) { pluginHost.innerHTML = emptyState('这个 Craft 还没有安装插件', '在「插件」页安装后可按工作区启用。', 'plug'); return; }
                pluginHost.innerHTML = '<div class="rows">' + installed.map(function (item) {
                  var status = enabledByPlugin[item.id] || 'disabled';
                  return '<div class="row"><div class="row-main"><span class="row-title">' + esc(item.name) + '</span>' +
                    '<span class="row-sub">' + (status === 'enabled' ? '本工作区已启用' : '本工作区未启用') + '</span></div>' +
                    pill(status === 'enabled' ? '启用' : '停用', status === 'enabled' ? 'ok' : 'muted') +
                    '<div class="row-actions"><button class="btn sm" type="button" data-ws-plugin="' + esc(item.id) + '" data-ws-plugin-action="' + (status === 'enabled' ? 'disable' : 'enable') + '">' +
                    (status === 'enabled' ? '停用' : '启用') + '</button></div></div>';
                }).join('') + '</div>';
                pluginHost.querySelectorAll('[data-ws-plugin]').forEach(function (button) {
                  button.onclick = function () {
                    button.disabled = true;
                    var url = '/api/workspaces/' + encodeURIComponent(selectedGroup.key) + '/plugins/' +
                      encodeURIComponent(button.getAttribute('data-ws-plugin')) + '/' + button.getAttribute('data-ws-plugin-action');
                    api(url, { method: 'POST', body: {} })
                      .then(function () { toast('工作区插件已更新'); paint('projects'); })
                      .catch(function (error) { button.disabled = false; fail(error); });
                  };
                });
              }).catch(function (error) { pluginHost.textContent = ''; fail(error); });
            }
          }]
        };
      });
    });
  }

  // -------------------------------------------------------------- task page
  // Everything on this page comes from GET /api/tasks/{id}, which already returns
  // human-readable fields (checkpoint.summary/completed/pending, outcome.verdict,
  // artifact.name, evidence.claim) — so the detail page needed no backend change.

  function folderNameOf(projectId) {
    if (!projectId) return '默认';
    var groups = state.folderGroups || [];
    for (var i = 0; i < groups.length; i += 1) {
      if (groups[i].key === String(projectId)) return groups[i].name;
    }
    return String(projectId);
  }

  // A composer folder may be a canonical workspace id (directory identity). Agent
  // sessions need a real absolute directory, so map the group back to root_path;
  // logical projects and plain paths pass through unchanged.
  function workspacePathOf(folder) {
    if (!folder) return '';
    var groups = state.folderGroups || [];
    for (var i = 0; i < groups.length; i += 1) {
      if (groups[i].key === String(folder)) return groups[i].root_path || (groups[i].kind === 'workspace' ? '' : String(folder));
    }
    return String(folder);
  }

  function stageRows(stages, done) {
    return (stages || []).map(function (stage) {
      return '<div class="row">' + lead(done ? 'check' : 'dot', done ? 'success' : 'muted') +
        '<div class="row-main"><span class="row-title">' + esc(label(STAGE_LABELS, stage, stage)) + '</span></div></div>';
    }).join('');
  }

  function taskCard(title, sub, body, right) {
    return '<div class="card">' + head(title, sub, right) + '<div class="card-body">' + body + '</div></div>';
  }

  function viewTask(ticket) {
    var taskId = state.selectedTask;
    if (!taskId) {
      return Promise.resolve({
        html: '<div class="card"><div class="card-body">' +
          emptyState('还没有选中任务', '从左边的文件夹里点一个任务，看它的目标、进度、产物与验证结论', 'tasks') + '</div></div>',
        aside: asideBlock('任务是什么', '', '<div class="aside-note">一个任务是一次完整的工作：一个目标、一条执行过程、一份验证结论。</div>')
      });
    }
    return Promise.all([
      api('/api/tasks/' + encodeURIComponent(taskId)),
      settled(api('/api/workbench-experience?task_id=' + encodeURIComponent(taskId) + '&limit=100'), { sessions: [], launches: [], traces: [], outcomes: [], artifacts: [], timeline: [], next_action: '' })
    ]).then(function (results) {
      if (!ticket.current()) return null;
      var detail = results[0], experience = results[1];
      var task = detail.task || {};
      var checkpoints = detail.checkpoints || [];
      var latest = checkpoints[0] || null;
      var outcomes = detail.outcomes || [];
      var artifacts = detail.artifacts || [];
      var evidence = detail.evidence || [];
      var trace = detail.trace || [];
      var messages = detail.messages || [];
      var hostRuns = detail.host_runs || [];
      var activity = detail.activity || [];
      var context = detail.context || {};
      var usage = messages.reduce(function (total, message) {
        var value = message.usage || {};
        return total + Number(value.total_tokens || value.input_tokens || 0) + Number(value.output_tokens || 0);
      }, 0);

      state.selectedTaskTitle = task.title || '';
      if (state.page === 'task') {
        var heading = state.selectedTaskTitle || '任务';
        $('page-title').textContent = heading;
        document.title = heading + ' · Craft Workbench';
      }

      var folder = folderNameOf(task.project_id);

      var goalCard = taskCard('目标', '文件夹：' + esc(folder),
        '<p class="doc-p">' + esc(task.goal || '这个任务还没有写下目标') + '</p>');

      var progressCard;
      if (!latest) {
        progressCard = taskCard('进度', '还没有记录',
          emptyState('还没开始执行', '任务跑起来之后，每一步的进展都会记在这里', 'refresh'));
      } else {
        var stages = stageRows(latest.completed, true) + stageRows(latest.pending, false);
        progressCard = taskCard('进度', '最近一次记录 · ' + shortTime(latest.created_at),
          '<div class="stack">' +
            (latest.summary ? '<p class="doc-p">' + esc(latest.summary) + '</p>' : '') +
            (stages ? '<div class="rows">' + stages + '</div>' : '') +
          '</div>');
      }

      var verdictCard;
      if (!outcomes.length) {
        verdictCard = taskCard('结论', '还没有验收结论',
          '<p class="doc-p">任务完成后，Craft 会给出一条独立的验收结论。</p>');
      } else {
        var outcome = outcomes[0];
        verdictCard = taskCard('结论', null,
          '<div class="stack">' +
            '<div>' + statusPill(outcome.verdict) + '</div>' +
            (outcome.summary ? '<p class="doc-p">' + esc(outcome.summary) + '</p>' : '') +
            (outcome.failure_type ? '<p class="doc-p">没通过的原因：' + esc(outcome.failure_type) + '</p>' : '') +
          '</div>');
      }

      var artifactRows = artifacts.length ? artifacts.map(function (item) {
        return '<div class="row">' + lead('layers', 'accent') +
          '<div class="row-main"><span class="row-title">' +
            esc(item.kind === 'route_receipt' ? receiptName(item.name) : (item.name || item.id)) + '</span>' +
            (item.uri ? '<span class="row-sub mono">' + esc(item.uri) + '</span>' : '') + '</div>' +
          '<span class="row-time">' + esc(label(ARTIFACT_KIND_LABELS, item.kind, item.kind)) + '</span></div>';
      }).join('') : emptyState('还没有产物', '任务产生的文件、报告和代码改动都会列在这里', 'layers');

      var evidenceRows = evidence.length ? evidence.map(function (item) {
        return '<div class="row">' + lead('shield', item.confidence === 'confirmed' ? 'success' : 'muted') +
          '<div class="row-main"><span class="row-title">' + esc(item.claim || item.id) + '</span>' +
          (item.confidence
            ? '<span class="row-sub">依据强度：' + esc(label(CONFIDENCE_LABELS, item.confidence, item.confidence)) + '</span>'
            : '') + '</div></div>';
      }).join('') : emptyState('还没有验证记录', '每条站得住的结论都会在这里留下依据', 'shield');

      var traceRows = trace.length ? trace.map(function (item) {
        return '<div class="row">' + lead('dot', 'muted') +
          '<div class="row-main"><span class="row-title">' +
            esc(label(TRACE_LABELS, item.event_type, item.event_type)) + '</span></div>' +
          '<span class="row-time">' + esc(shortTime(item.created_at)) + '</span></div>';
      }).join('') : emptyState('还没有过程记录', null, 'dot');

      var activityRows = activity.length ? activity.map(function (item) {
        return '<div class="row"><span class="row-lead muted">' + icon('dot') + '</span><div class="row-main"><span class="row-title">' +
          esc(label(TRACE_LABELS, item.event_type, item.event_type)) + '</span>' +
          (item.run_id ? '<span class="row-sub mono">运行 ' + esc(item.run_id) + '</span>' : '') +
          '</div><span class="row-time">' + esc(shortTime(item.created_at)) + '</span></div>';
      }).join('') : emptyState('还没有活动记录', '真正发起对话或运行后，时间线会出现在这里。', 'dot');

      var observationTimeline = experience.timeline || [];
      var observationRows = observationTimeline.length ? observationTimeline.map(function (item) {
        return '<div class="row">' + lead('dot', 'muted') + '<div class="row-main"><span class="row-title">' +
          esc(label(TRACE_LABELS, item.event_kind, item.event_kind || '执行事件')) + '</span><span class="row-sub mono">链路 ' + esc(item.trace_id || '—') + ' · #' + esc(item.sequence || '—') + '</span></div>' +
          '<span class="row-time">' + esc(shortTime(item.created_at)) + '</span></div>';
      }).join('') : emptyState('还没有链路事件', '当任务通过受控执行路径运行时，事件会按顺序记录在这里。', 'dot');
      var hostRunRows = hostRuns.length ? hostRuns.map(function (run) {
        return '<div class="row">' + lead('play', run.status === 'completed' ? 'success' : 'muted') + '<div class="row-main"><span class="row-title">' + esc(run.host || '本机运行') + '</span><span class="row-sub mono">' + esc(run.id || '—') + ' · ' + esc(run.event_count || 0) + ' 条事件</span></div>' + statusPill(run.status) + '</div>';
      }).join('') : emptyState('还没有执行运行', '模型对话已经记录在上方；文件、命令等受控运行开始后会在这里显示。', 'play');
      var observeCard = taskCard('观测', '日志、链路追踪与指标',
        '<div class="metrics"><div class="stat"><div class="stat-body"><b>' + esc(messages.length) + '</b><span>对话消息</span></div></div><div class="stat"><div class="stat-body"><b>' + esc(hostRuns.length) + '</b><span>受控运行</span></div></div><div class="stat"><div class="stat-body"><b>' + esc((experience.traces || []).length) + '</b><span>链路</span></div></div><div class="stat"><div class="stat-body"><b>' + esc(usage || 0) + '</b><span>已记录 Token</span></div></div></div>' +
        '<details class="task-observe-fold" open><summary>运行记录与日志</summary><div class="rows">' + hostRunRows + '</div></details>' +
        '<details class="task-observe-fold" open><summary>链路追踪</summary><div class="rows">' + observationRows + '</div></details>');
      var memories = context.memories || [], knowledge = context.knowledge || [], workflows = context.workflows || [], workflowRuns = context.workflow_runs || [], manifests = context.manifests || [];
      var memoryRows = memories.length ? memories.map(function (item) { return '<div class="row">' + lead('db', 'muted') + '<div class="row-main"><span class="row-title">' + esc(item.content || item.id) + '</span><span class="row-sub">' + esc([item.kind, item.source].filter(Boolean).join(' · ')) + '</span></div></div>'; }).join('') : emptyState('没有任务短期记忆', '任务显式记录的有效记忆会显示在这里。', 'db');
      var knowledgeRows = knowledge.length ? knowledge.map(function (item) { return '<div class="row">' + lead('layers', 'muted') + '<div class="row-main"><span class="row-title">' + esc(item.content || item.id) + '</span><span class="row-sub">' + esc(label(STATUS_LABELS, item.status, item.status || '—')) + '</span></div></div>'; }).join('') : emptyState('没有任务知识', '从这个任务中提取且绑定到该任务的知识会显示在这里。', 'layers');
      var workflowRows = workflowRuns.length ? workflowRuns.map(function (item) { return '<div class="row">' + lead('refresh', 'muted') + '<div class="row-main"><span class="row-title">' + esc(item.workflow_id || item.id) + '</span><span class="row-sub">' + esc(shortTime(item.updated_at)) + '</span></div>' + statusPill(item.status) + '</div>'; }).join('') : emptyState('没有任务工作流', workflows.length || manifests.length ? '已有关联上下文，但没有可展示的工作流运行。' : '通过工作流运行该任务后，记录会显示在这里。', 'refresh');
        var contextCard = taskCard('任务上下文', '短期记忆、知识与经验',
        '<details class="task-observe-fold" open><summary>短期记忆 · ' + esc(memories.length) + '</summary><div class="rows">' + memoryRows + '</div></details>' +
        '<details class="task-observe-fold"><summary>任务知识 · ' + esc(knowledge.length) + '</summary><div class="rows">' + knowledgeRows + '</div></details>' +
        '<details class="task-observe-fold"><summary>工作流与上下文清单 · ' + esc(workflowRuns.length + manifests.length) + '</summary><div class="rows">' + workflowRows + '</div></details>');

      var pending = (latest && latest.pending) || [];
      var aside = asideCollapsible('任务信息', asideRows([
        ['状态', label(STATUS_LABELS, task.status, task.status || '—')],
        ['文件夹', folder],
        ['模型', task.model_id || '—'],
        ['权限', label(TASK_PERMISSION_LABELS, task.permission_mode, '手动审批')],
        ['创建时间', shortTime(task.created_at) || '—'],
        ['最近更新', shortTime(task.updated_at) || '—']
      ])) +
      asideCollapsible('查看说明', '<div class="aside-note">' +
        '目标＝这件事要达成什么；进度＝最近一次做到哪一步；结论＝独立验收的结果；' +
        '产物＝产出的文件与代码改动；验证＝每条结论的依据；活动＝对话与运行过程中发生的事。</div>') +
      (pending.length ? asideCollapsible('还剩 ' + pending.length + ' 步', '<div class="aside-note">' +
        pending.map(function (stage) { return esc(label(STAGE_LABELS, stage, stage)); }).join('、') + '</div>') : '');

      return {
        html: '<div class="stack task-page">' + goalCard + '<section class="card" id="agent-workspace" aria-label="原生会话"></section>' + observeCard + contextCard +
          taskCard('活动', (hostRuns.length ? hostRuns.length + ' 次运行' : '暂无运行'), '<div class="rows">' + activityRows + '</div>') +
          '<div class="grid-2">' + progressCard + verdictCard + '</div>' +
          taskCard('产物', artifacts.length + ' 项', '<div class="rows">' + artifactRows + '</div>') +
          '<div class="grid-2">' +
            taskCard('验证', evidence.length + ' 条依据', '<div class="rows">' + evidenceRows + '</div>') +
            taskCard('过程', trace.length + ' 条', '<div class="rows">' + traceRows + '</div>') +
          '</div></div>',
        aside: aside,
        mounts: [function (root) { mountAgentWorkspace(root.querySelector('#agent-workspace'), {
          api: api,
          taskId: taskId,
          invoke: window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core.invoke : null,
          defaultProvider: task.model_id ? 'craft' : ((state.settings || {}).lastProvider || ''),
          defaultPermission: task.permission_mode === 'full_access' ? 'full' : task.permission_mode === 'assisted_approval' ? 'auto' : 'ask'
        }); }],
        actions: taskPageActions(task),
      };
    });
  }

  // ------------------------------------------------------------- capabilities

  var SOURCE_KINDS = [
    { key: 'plugins', label: '插件市场', icon: 'plug', hint: '从一个 Git 仓库或能力市场里获取插件与 Skill。填仓库地址即可。',
      kinds: [['github_skill', 'GitHub 仓库']],
      fields: [['git-url', '仓库地址', 'https://github.com/wdx9413/craft']] },
    { key: 'skills', label: 'Skill 集市', icon: 'db', hint: '外部 Skill 来源。Craft 只登记来源与摘要，不会自动下载或运行。',
      kinds: [['github_skill', 'GitHub 仓库'], ['volcengine_skill', '火山引擎']],
      fields: [['git-url', '来源地址', 'https://github.com/example/skills']] },
    { key: 'mcp', label: 'MCP 服务', icon: 'server', hint: '一个 MCP 服务，可以是在本机启动的命令，也可以是一个在线地址。',
      kinds: [['mcp_stdio', '本机启动的命令'], ['mcp_http', '在线地址（HTTPS）'], ['serena_mcp', 'Serena（只读）']],
      fields: [['git-url', '启动命令或服务地址', 'npx -y @modelcontextprotocol/server-filesystem D:\\docs']] },
    { key: 'local', label: '本机文件夹', icon: 'folder', hint: '把本机的一个文件夹作为能力来源，扫描后即可被 Craft 检索。',
      kinds: [], fields: [] }
  ];

  var activeSource = 'plugins';

  function registerSource() {
    var name = val('source-name');
    if (!name) { toast('名称不能为空', true); return; }
    if (activeSource === 'local') {
      api('/api/sources', { method: 'POST', body: { path: val('source-path'), label: name, scan: checked('source-scan'), priority: 0 } })
        .then(function () { toast('已添加本机文件夹'); paint('connectors'); }).catch(fail);
      return;
    }
    var body = { kind: val('source-kind'), name: name, endpoint: val('source-endpoint') || undefined,
      approved: true, approval_ref: operatorOf() + '-approval',
      metadata: { registered_from: 'craft-workbench', note: val('source-note') || undefined } };
    var ops = val('source-ops');
    if (ops) body.allowed_operations = ops.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    api('/api/connectors', { method: 'POST', body: body })
      .then(function () {
        toast('已添加来源「' + name + '」');
        // Not an interstitial any more: the next step is a card at the top of
        // the column, right next to the list of sources it refers to.
        openInlineOn('connectors', {
          title: '来源已添加',
          sub: name,
          html: '<div class="callout info">' + icon('arrow') + '<span>下一步：点该来源上的「扫描可用能力」，把里面的能力登记进来。扫描只是登记，不会下载也不会运行。</span></div>' +
            '<div class="aside-note">Craft 只保存来源信息与摘要，不保存任何密码或密钥。</div>',
          actions: [{ label: '知道了', primary: true, run: function () { dismissInline('connectors'); } }]
        });
      }).catch(fail);
  }

  function discoverAssets(connectorId) {
    var raw = ($('discover-lines') ? $('discover-lines').value : '') || '';
    var assets = raw.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean).map(function (line, index) {
      var parts = line.split('|').map(function (x) { return x.trim(); });
      return {
        logical_id: parts[1] || (connectorId + ':asset:' + (index + 1)),
        name: parts[2] || parts[1] || '能力 ' + (index + 1),
        asset_type: fromLabel(ASSET_TYPE_LABELS, parts[0], 'skill'),
        effect: fromLabel(EFFECT_LABELS, parts[3], 'read_only'),
        summary: parts[4] || undefined,
        aliases: []
      };
    });
    if (!assets.length) { toast('请至少填写一个能力', true); return; }
    api('/api/connectors/' + encodeURIComponent(connectorId) + '/discover', { method: 'POST', body: { assets: assets } })
      .then(function () { clearInline(); toast('资产已登记，等待审批'); paint('connectors'); })
      .catch(fail);
  }

  function viewCapabilities() {
    return Promise.all([api('/api/connectors?limit=100'), settled(api('/api/sources'), { sources: [] })]).then(function (results) {
      var connectors = results[0].connectors || [], assets = results[0].assets || [], sources = results[1].sources || [];
      var spec = SOURCE_KINDS.filter(function (item) { return item.key === activeSource; })[0];

      var form = activeSource === 'local'
        ? '<div class="field-row">' +
            '<div class="field"><label for="source-name">名称</label><input id="source-name" type="text" placeholder="我的技能库"></div>' +
            '<div class="field"><label for="source-path">文件夹路径</label><input id="source-path" type="text" placeholder="D:\\skills"></div>' +
          '</div>' +
          '<label class="check"><input id="source-scan" type="checkbox" checked> 添加后立即扫描一次</label>'
        : '<div class="field-row">' +
            '<div class="field"><label for="source-name">名称</label><input id="source-name" type="text" placeholder="craft 插件市场"></div>' +
            '<div class="field"><label for="source-kind">类型</label><select id="source-kind">' + options(spec.kinds, spec.kinds[0][0]) + '</select></div>' +
          '</div>' +
          '<div class="field"><label for="source-endpoint">' + esc(spec.fields[0][1]) + '</label>' +
            '<input id="source-endpoint" type="text" placeholder="' + esc(spec.fields[0][2]) + '"></div>' +
          '<div class="field"><label for="source-ops">允许 Craft 做的操作（可选，逗号分隔）</label>' +
            '<input id="source-ops" type="text" placeholder="inspect, read">' +
            '<span class="hint">留空表示按 Craft 的默认策略放开；填了就只允许这些操作。</span></div>' +
          '<div class="field"><label for="source-note">备注（可选）</label><input id="source-note" type="text" placeholder="为什么要接入这个来源"></div>';

      var tabs = '<div class="tabs" id="source-tabs">' + SOURCE_KINDS.map(function (item) {
        return '<button class="tab-btn" type="button" data-source="' + item.key + '" aria-selected="' + (item.key === activeSource) + '">' + esc(item.label) + '</button>';
      }).join('') + '</div>';

      var pendingAssets = assets.filter(function (asset) { return asset.status === 'discovered'; });

      var connectorRows = connectors.length
        ? connectors.map(function (item) {
            var own = assets.filter(function (asset) { return asset.connector_id === item.id; });
            var assetRows = own.length ? own.map(function (asset) {
              var actions = asset.status === 'discovered'
                ? '<div class="row-actions"><button class="btn sm primary" data-approve-asset="' + esc(asset.id) + '">' + icon('check') + '确认可用</button></div>'
                : '<div class="row-actions">' + pill(label(STATUS_LABELS, asset.status, '已确认'), asset.status === 'approved' ? 'ok' : '') + '</div>';
              return '<div class="row">' + lead('db', 'muted') + '<div class="row-main"><span class="row-title">' + esc(asset.name) + '</span>' +
                '<span class="row-sub">' + esc(label(ASSET_TYPE_LABELS, asset.asset_type, asset.asset_type)) + '</span></div>' +
                effectPill(asset.effect) + actions + '</div>';
            }).join('') : emptyState('还没有扫描到条目', '点「扫描可用能力」把该来源里的能力登记进来', 'inbox');
            var healthTone = item.health === 'healthy' ? 'ok' : (item.health === 'unhealthy' ? 'danger' : '');
            return '<div class="card">' + head(item.name, '外部能力来源',
                '<div class="row-actions">' + statusPill(item.status) +
                (item.health ? pill(label(HEALTH_LABELS, item.health), healthTone) : '') +
                '<button class="btn sm" data-discover="' + esc(item.id) + '">' + icon('plus') + '扫描可用能力</button>' +
                '<button class="btn sm" data-toggle="' + esc(item.id) + '" data-active="' + (item.status === 'active') + '">' + (item.status === 'active' ? '停用' : '启用') + '</button>' +
                '<button class="btn sm danger" data-revoke="' + esc(item.id) + '">移除</button></div>') +
              '<div class="card-body tight"><div class="rows">' + assetRows + '</div></div></div>';
          }).join('')
        : '<div class="card"><div class="card-body">' + emptyState('还没有添加任何外部能力', '在上方选择一种来源，把 Craft 还不会做的事接进来', 'plug') + '</div></div>';

      var sourceRows = sources.length
        ? '<div class="rows">' + sources.map(function (item) {
            return '<div class="row">' + lead('folder', 'muted') + '<div class="row-main"><span class="row-title">' + esc(item.label || item.id) + '</span>' +
              '<span class="row-sub mono">' + esc(item.path || '') + '</span></div>' +
              pill(item.enabled === false ? '已停用' : '已启用', item.enabled === false ? '' : 'ok') + '</div>';
          }).join('') + '</div>'
        : emptyState('没有挂载本地能力目录', '切到「本地目录」标签即可挂载', 'folder');

      var setupCard = state.capabilitySetupOpen
        ? '<div class="card">' + head('添加能力来源', esc(spec.hint),
            '<button class="btn" id="source-setup-close" type="button">完成</button>' +
            '<button class="btn primary" id="source-register" type="button">' + (activeSource === 'local' ? icon('folder') + '添加文件夹' : icon('plus') + '添加来源') + '</button>') +
            '<div class="card-body"><div class="stack">' + tabs + form +
            '<div class="callout info">' + icon('shield') + '<span>外部来源需要你点一下确认才生效。Craft 只保存来源信息与摘要，不保存任何密码或密钥，也不会替你安装或启动服务。</span></div>' +
            '</div></div></div>'
        : '<div class="card">' + head('能力来源', '把已确认的本机目录、插件或 MCP 服务接入任务',
            '<div class="row-actions"><button class="btn" id="connector-config-upload" type="button">' + icon('file') + '导入配置</button><input id="connector-config-file" type="file" accept="application/json,.json" hidden><button class="btn primary" id="source-setup-open" type="button">' + icon('plus') + '添加来源</button></div>') +
            '<div class="card-body"><div class="source-summary">' +
              '<div><b>' + esc(connectors.length) + '</b><span>外部来源</span></div>' +
              '<div><b>' + esc(sources.length) + '</b><span>本机目录</span></div>' +
              '<div><b>' + esc(assets.length) + '</b><span>已登记能力</span></div>' +
            '</div><p class="doc-p">来源只在你添加并确认后才会可用；这里不会预置演示数据或自动安装任何东西。</p></div></div>';

      return {
        html: '<div class="stack">' +
          setupCard +
          connectorRows +
          '<div class="card">' + head('本机能力文件夹', '扫描结果会进入能力检索，做任务时可以直接用', countChip(sources.length)) +
            '<div class="card-body tight">' + sourceRows + '</div></div>' +
        '</div>',
        aside: asideBlock('已有来源', String(connectors.length),
            connectors.length
              ? '<div class="aside-list">' + connectors.map(function (item) {
                  return '<div class="aside-row"><span class="k">' + esc(item.name) + '</span>' + statusPill(item.status) + '</div>';
                }).join('') + '</div>'
              : '<div class="aside-note">还没有添加任何外部能力来源。</div>') +
          asideBlock('等你确认的能力', String(pendingAssets.length),
            '<div class="aside-note">' + (pendingAssets.length ? '有' + pendingAssets.length + '个能力等你确认，确认后才可以被使用。' : '没有等待确认的能力。') + '</div>') +
          asideBlock('本机能力文件夹', String(sources.length),
            sources.length
              ? '<div class="aside-list">' + sources.map(function (item) {
                  return '<div class="aside-row"><span class="k">' + esc(item.label || item.id) + '</span><span class="v">' + esc(item.enabled === false ? '已停用' : '已启用') + '</span></div>';
                }).join('') + '</div>'
              : '<div class="aside-note">没有添加本机能力文件夹。</div>'),
        mounts: [function (root) {
          var setupOpen = root.querySelector('#source-setup-open');
          if (setupOpen) setupOpen.onclick = function () { state.capabilitySetupOpen = true; paint('connectors'); };
          var configUpload = root.querySelector('#connector-config-upload'), configFile = root.querySelector('#connector-config-file');
          if (configUpload && configFile) { configUpload.onclick = function () { configFile.click(); }; configFile.onchange = function () { readUpload(configFile, ['json'], function (content) { try { var config = JSON.parse(content); api('/api/connectors', { method: 'POST', body: { kind: config.kind, name: config.name, endpoint: config.endpoint, allowed_operations: config.allowed_operations, approved: true, approval_ref: operatorOf() + '-import', metadata: { imported_from: 'user_file' } } }).then(function () { toast('连接器配置已导入，等待扫描与审核'); paint('connectors'); }).catch(fail); } catch (_) { toast('连接器配置不是有效 JSON', true); } }); }; }
          var setupClose = root.querySelector('#source-setup-close');
          if (setupClose) setupClose.onclick = function () { state.capabilitySetupOpen = false; paint('connectors'); };
          var register = root.querySelector('#source-register');
          if (register) register.onclick = registerSource;
          var sourceTabs = root.querySelector('#source-tabs');
          if (sourceTabs) sourceTabs.onclick = function (event) {
            var tab = event.target.closest('[data-source]');
            if (tab) { activeSource = tab.getAttribute('data-source'); paint('connectors'); }
          };
          root.querySelectorAll('[data-discover]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-discover');
              openInline({
                title: '扫描可用能力', sub: '手动登记这个来源里有哪些能力',
                html: '<div class="field"><label for="discover-lines">每行一个能力，用竖线分成 5 段：<b>类型 | 唯一标识 | 名称 | 影响范围 | 一句话说明</b></label>' +
                  '<textarea id="discover-lines" class="tall" placeholder="skill | your-skill-id | 能力名称 | read_only | 一句话说明"></textarea>' +
                  '<span class="hint">类型可填：Skill、MCP 服务、工具、工作流、适配器、校验器、评分器、评测集。影响范围可填：仅查看 / 可改本机文件 / 会对外发送 / 有破坏性。</span></div>',
                actions: [{ label: '确认登记', primary: true, run: function () { discoverAssets(id); } }]
              });
            };
          });
          root.querySelectorAll('[data-approve-asset]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-approve-asset');
              api('/api/connector-assets/' + encodeURIComponent(id) + '/approve', { method: 'POST', body: { approval_ref: operatorOf() + '-approval' } })
                .then(function () { toast('已确认可用'); paint('connectors'); }).catch(fail);
            };
          });
          root.querySelectorAll('[data-toggle]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-toggle');
              api('/api/connectors/' + encodeURIComponent(id) + '/status', { method: 'POST', body: { active: button.getAttribute('data-active') !== 'true' } })
                .then(function () { paint('connectors'); }).catch(fail);
            };
          });
          root.querySelectorAll('[data-revoke]').forEach(function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-revoke');
              // Still confirmed before it runs — but in the column, not with a
              // browser dialog the app cannot style or explain.
              openInline({
                title: '撤销这个来源？', sub: id,
                html: '<div class="callout warn">' + icon('alert') + '<span>撤销后，这个来源上已经确认可用的能力会全部失效，用到它们的任务不能再调用。本机文件不会被删除。</span></div>',
                actions: [
                  { label: '取消', run: function () { clearInline(); paint('connectors'); } },
                  { label: '确认撤销', primary: true, danger: true, run: function () {
                    api('/api/connectors/' + encodeURIComponent(id) + '/revoke', { method: 'POST', body: { reason: 'revoked from Craft Workbench' } })
                      .then(function () { clearInline(); toast('已撤销'); paint('connectors'); }).catch(fail);
                  } }
                ]
              });
            };
          });
        }]
      };
    });
  }

  // --------------------------------------------------------- resource pages
  // The storage layer is plugin-oriented, but people do not think in storage
  // tables.  These views are intentionally separate, while projecting the same
  // local records that the connector and knowledge kernels already manage.

  function catalogRows(items, iconName, title, sub) {
    return items.length ? '<div class="rows">' + items.map(function (item) {
      return '<div class="row">' + lead(iconName, 'muted') + '<div class="row-main"><span class="row-title">' + esc(title(item)) + '</span>' +
        (sub(item) ? '<span class="row-sub">' + esc(sub(item)) + '</span>' : '') + '</div>' +
        (item.status ? statusPill(item.status) : '') + '</div>';
    }).join('') + '</div>' : '';
  }

  // 插件详情：宿主按 manifest 生成统一分区；没有自定义页面的插件也有可用的详情页。
  function viewPlugin() {
    var pluginId = state.selectedPlugin;
    if (!pluginId) return Promise.resolve({
      html: '<div class="stack">' + emptyState('没有选中插件', '从「插件」列表打开一个插件，看它带来的能力。', 'plug') + '</div>',
      aside: '', mounts: []
    });
    return Promise.all([
      settled(api('/api/workbench/resources?kind=plugins&limit=100'), { items: [] }),
      settled(api('/api/workbench/plugins/' + encodeURIComponent(pluginId) + '/pages'), { pages: [] }),
      settled(api('/api/workspaces'), { workspaces: [] }),
    ]).then(function (results) {
      var plugin = (results[0].items || []).filter(function (item) { return String(item.id) === String(pluginId); })[0];
      if (!plugin) return { html: '<div class="stack">' + emptyState('插件已不在本机清单', '它可能已被卸载；返回「插件」重新选择。', 'plug') + '</div>', aside: '', mounts: [] };
      var pages = results[1].pages || [];
      var workspaces = results[2].workspaces || [];
      var adapters = Array.isArray(plugin.mapped_adapter_ids) ? plugin.mapped_adapter_ids : [];
      var skills = Array.isArray(plugin.mapped_skill_ids) ? plugin.mapped_skill_ids : [];
      var section = function (title, hint, body) { return '<div class="card">' + head(title, hint, '') + '<div class="card-body">' + body + '</div></div>'; };
      var list = function (items, empty) {
        return items.length ? '<div class="rows">' + items.map(function (value) {
          return '<div class="row"><div class="row-main"><span class="row-title mono">' + esc(String(value)) + '</span></div></div>';
        }).join('') + '</div>' : '<p class="aside-note">' + esc(empty) + '</p>';
      };
      var overview = '<div class="callout accent">' + icon('plug') + '<span>' + esc(plugin.name) + ' · v' + esc(plugin.package_version) +
        ' · ' + esc(plugin.runtime_status || 'descriptor_only') + (plugin.unsupported_reason ? ' · ' + esc(plugin.unsupported_reason) : '') + '</span></div>' +
        '<p class="doc-p">' + esc(plugin.description || '没有说明') + '</p>' +
        '<div class="rows">' + (plugin.hosts || []).map(function (host) { return '<div class="row"><div class="row-main"><span class="row-title">' + esc(pluginHostLabel(host)) + '</span><span class="row-sub">声明宿主</span></div></div>'; }).join('') + '</div>';
      var bindingRows = workspaces.length ? '<div class="rows">' + workspaces.map(function (workspace) {
        return '<div class="row"><div class="row-main"><span class="row-title">' + esc(workspace.name || workspace.root_path || workspace.id) + '</span>' +
          '<span class="row-sub mono">' + esc(workspace.id) + '</span></div>' +
          '<div class="row-actions"><button class="btn sm" type="button" data-ws-enable="' + esc(workspace.id) + '">启用</button>' +
          '<button class="btn sm" type="button" data-ws-disable="' + esc(workspace.id) + '">停用</button></div></div>';
      }).join('') + '</div>' : '<p class="aside-note">还没有工作区；工作区按规范化目录归组。</p>';
      return {
        html: '<div class="stack">' + section('概览', '这个插件是什么、装到哪、当前能否运行', overview) +
          section('技能', '插件带来的可复用技能', list(skills, '这个插件没有带来技能。')) +
          section('连接器 / 适配器', '插件带来的宿主适配器与连接器', list(adapters, '这个插件没有映射出适配器。')) +
          section('页面', '插件声明的贡献页面（声明式，按需加载）', pages.length ? list(pages.map(function (page) { return page.title + ' · ' + page.kind; }), '') : '<p class="aside-note">这个插件没有声明页面。</p>') +
          section('设置', '按工作区启用或停用；未启用的插件不贡献页面', bindingRows) + '</div>',
        aside: asideBlock('安装边界', '', '<div class="aside-note">插件页面都是数据，不携带脚本；按工作区启用只影响这里列出的工作区，不会写 Codex / Claude 的任何配置。</div>'),
        mounts: [function (root) {
          var act = function (selector, verb) {
            root.querySelectorAll(selector).forEach(function (button) {
              button.onclick = function () {
                button.disabled = true;
                var workspace = button.getAttribute(selector.indexOf('enable') >= 0 ? 'data-ws-enable' : 'data-ws-disable');
                api('/api/workspaces/' + encodeURIComponent(workspace) + '/plugins/' + encodeURIComponent(pluginId) + '/' + verb, { method: 'POST', body: {} })
                  .then(function () { toast('已' + (verb === 'enable' ? '启用' : '停用') + '该工作区的插件'); paint('plugin'); })
                  .catch(function (error) { button.disabled = false; fail(error); });
              };
            });
          };
          act('[data-ws-enable]', 'enable');
          act('[data-ws-disable]', 'disable');
        }]
      };
    });
  }

  function viewPlugins() {
    return Promise.all([api('/api/connectors?limit=100'), api('/api/workbench/resources?kind=plugins&limit=100'), api('/api/workbench/plugins'), api('/api/workbench/native-tools')]).then(function (results) {
      var connectors = (results[0].connectors || []).filter(function (item) { return item.kind === 'github_skill'; });
      var assets = results[0].assets || [], installed = results[1].items || [], runtime = results[2] || {};
      var nativeTools = (results[3] && results[3].tools) || [];
      var adapters = runtime.adapters || [], dshHost = runtime.dsh_host || {}, agentDesktop = runtime.agent_desktop || {};
      var sourceRows = catalogRows(connectors, 'plug', function (item) { return item.name || item.id; }, function (item) {
        var count = assets.filter(function (asset) { return asset.connector_id === item.id; }).length;
        return 'GitHub 来源 · 已登记 ' + count + ' 项';
      });
      var installedRows = installed.length ? '<div class="rows">' + installed.map(function (item) {
        var hosts = Array.isArray(item.target_hosts) && item.target_hosts.length ? item.target_hosts : ['craft'];
        var adapters = Array.isArray(item.mapped_adapter_ids) ? item.mapped_adapter_ids : [];
        var skills = Array.isArray(item.mapped_skill_ids) ? item.mapped_skill_ids : [];
        var mapped = item.runtime_status === 'mapped_adapter' ? ' · adapter ' + adapters.length + ' 个' + (adapters.length ? '（' + adapters.join('、') + '）' : '')
          : item.runtime_status === 'mapped_skill' ? ' · 技能 ' + skills.length + ' 个'
            : item.runtime_status === 'unsupported' ? ' · ' + (item.unsupported_reason || '不支持') : '';
        // An unsupported plugin already shows its reason; do not print it twice.
        var notes = Array.isArray(item.adapter_notes) && item.adapter_notes.length && item.runtime_status !== 'unsupported'
          ? ' · ' + item.adapter_notes.join('；') : '';
        var sub = (item.description || '本机插件清单') + ' · 安装到 ' + hosts.map(pluginHostLabel).join(' / ') + mapped + notes;
        var pages = Array.isArray(item.workbench_pages) ? item.workbench_pages : [];
        var pagesNote = pages.length ? ' · 贡献页面 ' + pages.length + ' 个' : '';
        // Uninstall is a delete, so it asks twice and says what leaves with it.
        return '<div class="row"><span class="row-lead muted">' + icon('plug') + '</span><div class="row-main">' +
          '<span class="row-title">' + esc(item.name + ' · v' + item.package_version) + '</span>' +
          '<span class="row-sub">' + esc(sub + pagesNote) + '</span></div>' +
          '<div class="row-actions"><button class="btn sm" type="button" data-plugin-detail="' + esc(item.id) + '">详情</button>' +
          (pages.length ? '<button class="btn sm" type="button" data-plugin-pages="' + esc(item.id) + '">贡献页面</button>' : '') + '</div>' +
          (pages.length ? '<div class="row-detail" data-plugin-pages-detail="' + esc(item.id) + '"></div>' : '') +
          '<div class="row-actions"><details class="row-confirm"><summary class="btn sm danger">卸载</summary>' +
          '<div class="stack"><span class="row-sub">卸载会移除插件登记，以及它创建的适配器与技能；Codex / Claude 的配置不动。</span>' +
          '<button class="btn sm danger" type="button" data-plugin-remove="' + esc(item.id) + '" data-plugin-version="' + esc(item.version) + '">确认卸载</button></div></details></div></div>';
      }).join('') + '</div>' : '';
      // An adapter's `active` means enabled, not "in progress" like a task.
      // Quarantine stops an adapter without deleting the plugin that brought it,
      // so a misbehaving connector is reversible instead of all-or-nothing.
      var adapterRows = adapters.length ? '<div class="rows">' + adapters.map(function (item) {
        var enabled = item.status === 'active';
        var sub = (item.metadata && item.metadata.source ? item.metadata.source + ' · ' : '') + 'effect ' + (item.effects || []).join(' / ');
        return '<div class="row"><span class="row-lead muted">' + icon('cpu') + '</span><div class="row-main">' +
          '<span class="row-title">' + esc(item.adapter_id + ' · ' + item.kind) + '</span><span class="row-sub">' + esc(sub) + '</span></div>' +
          pill(enabled ? '已启用' : item.status === 'quarantined' ? '已停用' : String(item.status || '未知'), enabled ? 'ok' : 'muted') +
          '<div class="row-actions">' + (enabled
            ? '<button class="btn sm danger" type="button" data-adapter-quarantine="' + esc(item.adapter_id) + '">停用</button>'
            : item.status === 'quarantined'
              ? '<button class="btn sm" type="button" data-adapter-rollback="' + esc(item.adapter_id) + '">启用</button>' : '') +
          '</div></div>';
      }).join('') + '</div>' : '';
      return {
        html: '<div class="stack"><div class="card">' + head('已安装插件', '本机插件清单；每个包的技能与连接器仍需独立确认',
          '<div class="row-actions"><button class="btn" id="plugins-add" type="button">' + icon('plus') + '添加来源</button></div>') +
          '<div class="card-body">' + (installedRows || emptyState('还没有本机插件', '上传一个 plugin.json，或添加一个 Marketplace / GitHub 来源。', 'plug')) + '</div></div>' +
          '<div class="card">' + head('安装插件', 'Claude / Codex / DSH 格式先归一化，再映射成 Craft 的 adapter 与技能') +
            '<div class="card-body"><div class="stack">' +
              '<div class="field-row">' +
                '<div class="field"><label for="plugin-source">来源格式</label><select id="plugin-source"><option value="auto">自动检测</option><option value="claude">Claude 插件</option><option value="codex">Codex 插件</option><option value="dsh">DSH 插件</option><option value="craft">Craft 插件</option></select></div>' +
                '<div class="field"><label for="plugin-host">安装到</label><select id="plugin-host"><option value="craft">Craft</option><option value="codex">Codex CLI</option><option value="claude">Claude Code</option><option value="dsh">DSH</option></select>' +
                  '<span class="hint">选 Codex / Claude 只登记目标宿主并把插件映射成 Craft 的适配器与技能：Craft 不改这两个 CLI 的配置，它们的插件与 MCP 仍由宿主自己管理。DSH 只写入隔离 profile。</span></div>' +
              '</div>' +
              '<div class="field"><label for="plugin-root">插件根目录（可选）</label><input id="plugin-root" type="text" placeholder="用于替换 ${CLAUDE_PLUGIN_ROOT} 等占位符"><span class="hint">只上传 manifest 时可以不填；填了 Craft 会把占位符替换成真实路径。</span></div>' +
              '<div class="row-actions"><button class="btn primary" id="plugin-upload" type="button">' + icon('file') + '选择 plugin.json 并安装</button><input id="plugin-file" type="file" accept="application/json,.json" hidden></div>' +
              '<div class="field"><label for="plugin-dir-path">插件目录</label><input id="plugin-dir-path" type="text" placeholder="包含 plugin.json 或 .claude-plugin/plugin.json 的目录"><span class="hint">从目录安装会一并读取 .mcp.json 与 skills/*/SKILL.md，并自动替换插件根目录占位符。</span></div>' +
              '<div class="row-actions"><button class="btn" id="plugin-dir-pick" type="button">' + icon('folder') + '选择插件目录</button><button class="btn primary" id="plugin-dir-install" type="button">从目录安装</button></div>' +
            '</div></div></div>' +
          '<div class="card">' + head('已注册适配器', 'Craft 可执行的命令、MCP 与浏览器适配器', countChip(adapters.length)) + '<div class="card-body">' + (adapterRows || emptyState('还没有适配器', 'Agent Desktop 检测成功后会出现在这里。', 'cpu')) + '</div></div>' +
          '<div class="card">' + head('Craft 原生工具', '与模型同一套判权与审批路径：试运行同样要先获批', countChip(nativeTools.length)) + '<div class="card-body"><div id="native-tools-mount"></div></div></div>' +
          '<div class="card">' + head('插件来源', '来自已连接的市场或 GitHub', countChip(connectors.length)) + '<div class="card-body">' + (sourceRows || emptyState('还没有插件来源', '添加来源后可扫描并确认其中的能力。', 'plug')) + '</div></div>' +
          '<div class="card">' + head('DSH Cordis 工具桥', '使用独立 DSH profile；安装的 DSH 工具插件在 DSH 会话内生效，不经由 Craft 直接代理执行', statusPill(dshHost.status || 'unavailable')) + '<div class="card-body"><div class="row"><span class="row-lead accent">D</span><div class="row-main"><span class="row-title">' + esc(dshHost.profile || 'craft-plugin-host') + '</span><span class="row-sub">' + esc(dshHost.detail || dshHost.dsh_home || '配置 DSH 后可安装工具插件') + '</span></div></div>' +
            (Array.isArray(dshHost.installed_tools) && dshHost.installed_tools.length
              ? '<div class="row-actions"><span class="row-sub">已安装 DSH 工具插件：' + dshHost.installed_tools.map(function (tool) { return esc(tool.name); }).join('、') + '</span></div>'
              : '') +
            '<div class="row-actions"><input id="dsh-plugin-spec" type="text" placeholder="npm 包名、GitHub spec 或 link:本地路径"><button class="btn" id="dsh-plugin-install" type="button">安装 DSH 工具插件</button></div></div></div>' +
          '<div class="card">' + head('推荐工具', '可被 Codex / Claude 直接调用，也可作为 Craft 通用命令适配器') + '<div class="card-body">' +
            '<div class="row"><span class="row-lead accent">A</span><div class="row-main"><span class="row-title">Agent Desktop</span><span class="row-sub">' + esc(agentDesktop.status === 'available' ? '已检测到并自动注册为 Craft command adapter' : '通过操作系统可访问性树观察和操作桌面应用；安装后自动注册。') + '</span></div><button class="btn" id="copy-agent-desktop" type="button">复制安装命令</button></div>' +
          '</div></div></div>',
        aside: asideBlock('安装边界', '', '<div class="aside-note">上传 manifest 只安装描述，不执行上传文件中的代码。技能与连接器必须分别安装、审核和启用。Craft 不写 Codex / Claude 的任何配置：这两个宿主的插件与 MCP 由它们自己管理，工作台只做检测与提示。</div>'),
        mounts: [function (root) {
          var button = root.querySelector('#plugins-add'); if (button) button.onclick = function () { activeSource = 'plugins'; state.capabilitySetupOpen = true; go('connectors'); };
          var upload = root.querySelector('#plugin-upload'), file = root.querySelector('#plugin-file');
          var host = root.querySelector('#plugin-host'), source = root.querySelector('#plugin-source'), pluginRoot = root.querySelector('#plugin-root');
          var copy = root.querySelector('#copy-agent-desktop');
          var dshInstall = root.querySelector('#dsh-plugin-install'), dshSpec = root.querySelector('#dsh-plugin-spec');
          if (copy) copy.onclick = function () {
            var command = 'npm install -g agent-desktop';
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(command).then(function () { toast('安装命令已复制'); }).catch(function () { toast(command); });
            else toast(command);
          };
          // A host plugin manifest rarely names Craft, but Craft can host its
          // normalized adapters. Infer the source format, then offer Craft as a
          // target without pretending the plugin declared it.
          var detectPluginFormat = function (manifest) {
            if (!manifest || typeof manifest !== 'object') return 'craft';
            if (manifest.interface || typeof manifest.mcpServers === 'string') return 'codex';
            if (manifest.hooks || (manifest.mcpServers && typeof manifest.mcpServers === 'object' && !Array.isArray(manifest.mcpServers))) return 'claude';
            return 'craft';
          };
          if (upload && file) {
            upload.onclick = function () { file.click(); };
            file.onchange = function () {
              readUpload(file, ['json'], function (content) {
                var manifest;
                try { manifest = JSON.parse(content); } catch (_) { toast('plugin.json 不是有效 JSON', true); return; }
                var format = source && source.value !== 'auto' ? source.value : detectPluginFormat(manifest);
                var declared = Array.isArray(manifest.hosts) && manifest.hosts.length ? manifest.hosts.slice() : [format];
                manifest.hosts = declared;
                var targets = declared.indexOf('craft') < 0 ? declared.concat(['craft']) : declared;
                if (host) host.innerHTML = targets.map(function (item) { return '<option value="' + esc(item) + '">' + esc(pluginHostLabel(item)) + '</option>'; }).join('');
                var target = host && targets.indexOf(host.value) >= 0 ? host.value : targets[0];
                var body = { manifest: manifest, target_hosts: [target] };
                if (pluginRoot && pluginRoot.value.trim()) body.plugin_root = pluginRoot.value.trim();
                api('/api/workbench/plugins', { method: 'POST', body: body }).then(function (result) {
                  var plugin = (result && result.plugin) || {};
                  var mapped = Array.isArray(plugin.mapped_adapter_ids) && plugin.mapped_adapter_ids.length ? '，映射 ' + plugin.mapped_adapter_ids.length + ' 个 adapter'
                    : Array.isArray(plugin.mapped_skill_ids) && plugin.mapped_skill_ids.length ? '，导入 ' + plugin.mapped_skill_ids.length + ' 个技能' : '';
                  toast('已安装到 ' + pluginHostLabel(target) + mapped);
                  paint('plugins');
                }).catch(fail);
              });
            };
          }
          // A directory install resolves what a bare manifest cannot: .mcp.json,
          // skills/*/SKILL.md and the real plugin root.
          var dirPath = root.querySelector('#plugin-dir-path');
          var dirPick = root.querySelector('#plugin-dir-pick'), dirInstall = root.querySelector('#plugin-dir-install');
          if (dirPick) dirPick.onclick = function () {
            var bridge = window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core.invoke : null;
            if (!bridge) { toast('浏览器模式没有系统目录选择器，请直接填写目录路径', true); return; }
            Promise.resolve(bridge('choose_project_folder')).then(function (path) { if (path && dirPath) dirPath.value = String(path); }).catch(fail);
          };
          if (dirInstall) dirInstall.onclick = function () {
            var path = dirPath ? String(dirPath.value || '').trim() : '';
            if (!path) { toast('请先选择或填写插件目录', true); return; }
            dirInstall.disabled = true;
            api('/api/workbench/plugins/install-directory', { method: 'POST', body: { path: path, target_hosts: [(host && host.value) || 'craft'] } })
              .then(function (result) {
                var plugin = (result && result.plugin) || {};
                var mapped = Array.isArray(plugin.mapped_adapter_ids) && plugin.mapped_adapter_ids.length ? '，映射 ' + plugin.mapped_adapter_ids.length + ' 个 adapter'
                  : Array.isArray(plugin.mapped_skill_ids) && plugin.mapped_skill_ids.length ? '，导入 ' + plugin.mapped_skill_ids.length + ' 个技能' : '';
                toast('已从目录安装' + mapped);
                paint('plugins');
              }).catch(fail).finally(function () { dirInstall.disabled = false; });
          };
          if (dshInstall && dshSpec) dshInstall.onclick = function () { var spec = String(dshSpec.value || '').trim(); if (!spec) { toast('请输入 DSH 插件包名或路径', true); return; } dshInstall.disabled = true; api('/api/workbench/plugins/install', { method: 'POST', body: { host: 'dsh', spec: spec } }).then(function () { toast('DSH 工具插件已安装'); paint('plugins'); }).catch(fail).finally(function () { dshInstall.disabled = false; }); };
          root.querySelectorAll('[data-plugin-remove]').forEach(function (button) {
            button.onclick = function () {
              var pluginId = button.getAttribute('data-plugin-remove');
              var version = String(button.getAttribute('data-plugin-version') || '');
              button.disabled = true;
              var target = '/api/workbench/plugins/' + encodeURIComponent(pluginId) + (version ? '?version=' + encodeURIComponent(version) : '');
              api(target, { method: 'DELETE' })
                .then(function (result) {
                  var parts = [];
                  if (result.removed_adapters && result.removed_adapters.length) parts.push('移除适配器 ' + result.removed_adapters.length + ' 个');
                  if (result.removed_skills && result.removed_skills.length) parts.push('移除技能 ' + result.removed_skills.length + ' 个');
                  if (result.kept_adapters && result.kept_adapters.length) parts.push('保留非插件来源的适配器 ' + result.kept_adapters.length + ' 个');
                  toast('已卸载' + (parts.length ? '：' + parts.join('，') : '；没有需要一并移除的内容'));
                  paint('plugins');
                }).catch(function (error) { button.disabled = false; fail(error); });
            };
          });
          root.querySelectorAll('[data-plugin-detail]').forEach(function (button) {
            button.onclick = function () { openPlugin(button.getAttribute('data-plugin-detail')); };
          });
          // 贡献页面：按需拉取声明式页面 schema（白名单组件），不执行插件代码。
          root.querySelectorAll('[data-plugin-pages]').forEach(function (button) {
            button.onclick = function () {
              var pluginId = button.getAttribute('data-plugin-pages');
              var slot = root.querySelector('[data-plugin-pages-detail="' + pluginId + '"]');
              if (!slot) return;
              slot.textContent = '正在读取声明式页面…';
              api('/api/workbench/plugins/' + encodeURIComponent(pluginId) + '/pages')
                .then(function (result) {
                  var pages = result.pages || [];
                  slot.innerHTML = '';
                  pages.forEach(function (page) {
                    var item = document.createElement('div');
                    item.className = 'row';
                    item.innerHTML = '<div class="row-main"><span class="row-title">' + esc(page.title) + '</span>' +
                      '<span class="row-sub">' + esc(page.kind) + (page.requires && page.requires.length ? ' · 需要 ' + esc(page.requires.join('、')) : '') + '</span></div>';
                    var actions = document.createElement('div');
                    actions.className = 'row-actions';
                    if (page.kind === 'declarative') {
                      var open = document.createElement('button');
                      open.className = 'btn sm'; open.type = 'button'; open.textContent = '打开页面';
                      open.onclick = function () {
                        open.disabled = true;
                        api('/api/workbench/plugins/' + encodeURIComponent(pluginId) + '/pages/' + encodeURIComponent(page.id))
                          .then(function (loaded) {
                            var pre = document.createElement('pre');
                            pre.textContent = JSON.stringify(loaded.schema, null, 2);
                            slot.innerHTML = '';
                            slot.appendChild(pre);
                          }).catch(function (error) { open.disabled = false; fail(error); });
                      };
                      actions.appendChild(open);
                    } else {
                      var disabled = document.createElement('span');
                      disabled.className = 'row-sub';
                      disabled.textContent = '沙箱页面（下一里程碑）';
                      actions.appendChild(disabled);
                    }
                    item.appendChild(actions);
                    slot.appendChild(item);
                  });
                })
                .catch(function (error) { slot.textContent = ''; fail(error); });
            };
          });
          root.querySelectorAll('[data-adapter-quarantine]').forEach(function (button) {
            button.onclick = function () {
              var adapterId = button.getAttribute('data-adapter-quarantine');
              button.disabled = true;
              call('craft_adapter_quarantine', { adapter_id: adapterId, reason: 'stopped from the workbench adapter list' })
                .then(function () { toast('已停用 ' + adapterId + '；它的插件登记还在，可随时启用'); paint('plugins'); })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
          root.querySelectorAll('[data-adapter-rollback]').forEach(function (button) {
            button.onclick = function () {
              var adapterId = button.getAttribute('data-adapter-rollback');
              button.disabled = true;
              call('craft_adapter_rollback', { adapter_id: adapterId })
                .then(function () { toast('已重新启用 ' + adapterId); paint('plugins'); })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
          // The trial surface holds no authority of its own: it posts to the same
          // native-tool seam the loop uses, and shows the approval queue so a
          // write-effect trial can actually be decided instead of hanging.
          var nativeHost = root.querySelector('#native-tools-mount');
          var nativePanel = nativeHost ? mountNativeTools(nativeHost, { api: api, esc: esc, onNotice: function (text, bad) { toast(text, bad); } }) : null;
          if (nativePanel) pagePanels.push(nativePanel);
        }]
      };
    });
  }

  function pluginHostLabel(host) {
    return ({ craft: 'Craft', codex: 'Codex CLI', claude: 'Claude Code', dsh: 'DSH' })[host] || String(host || '未知');
  }

  // 「待我批准」是本版新增的持久入口。此前运行时的核心卖点是审批门禁，但
  // Studio 没有任何待办审批的落点：批准决定只经由会话临时状态存在，刷新即
  // 消失。这里直接消费 /api/inbox（refresh/decide），它本来就是持久化投影，
  // 因此不需要任何内核改动。
  //
  // 卡片字段以 src/attention.ts 的 Candidate 类型为准：id / source_kind /
  // priority(数字) / reason / action / audience / details。decide 只接受
  // acknowledge 与 defer 两种决定，推迟必须给出未来的 deferred_until。
  var ATTENTION_ACTIONS = { approve: '批准', resume: '恢复', retry: '重试', review: '审核', decide: '决定' };

  function attentionActionLabel(action) { return label(ATTENTION_ACTIONS, action, action); }

  function attentionDetail(card) {
    var details = card.details || {};
    var parts = [];
    if (details.workspace) parts.push(String(details.workspace));
    if (details.task_id) parts.push('任务 ' + String(details.task_id));
    return parts.join(' · ');
  }

  // 文档 7.1：订阅是长期授权，不是一个开关。这一页必须让四件事同时看得见——
  // 允许的动作范围、最高风险等级、有效期、以及它过去真的做过什么。
  // 文档 9：裁决面按「决策类型」生成，不按 schema 生成。
  // schema 只能告诉你这是个枚举，永远告诉不了你「这里该并排展示两个版本的 diff」。
  // 所以每个 decision_kind 有自己的渲染器；未注册的类型由后端拒绝，不会退化成通用表单。
  function renderDecisionControl(control) {
    switch (control.renderer) {
      case 'comparison':
        // 二选一 → 并排对比：差异本身就是界面。
        return '<div class="decision-compare">' + control.options.map(function (option) {
          return '<div class="decision-option"><b>' + esc(option.label) + '</b>' +
            (option.detail ? '<span>' + esc(option.detail) + '</span>' : '') + '</div>';
        }).join('') + '</div>';
      case 'threshold_slider':
        // 阈值取舍 → 单滑块 + 实时预览。
        return '<div class="decision-slider"><input type="range" min="0" max="100" value="50" ' +
          'oninput="this.nextElementSibling.textContent=this.value" aria-label="阈值">' +
          '<output>50</output></div>';
      case 'diff_view':
        // 多字段校验 → diff 视图，差异高亮。
        return '<div class="decision-diff">' + (control.fields || []).map(function (field) {
          return '<div class="decision-line"><span class="sign">±</span>' + esc(field.label) + '</div>';
        }).join('') + '</div>';
      case 'release_summary':
        // 放行 → 凭证摘要 + 显式确认。
        return '<div class="decision-receipt"><span>凭证摘要：' + esc(control.summary) + '</span>' +
          '<em>放行前请确认这是你看到的那个状态</em></div>';
      case 'inline_tuning':
        // 参数微调 → 原地展开，不跳回原系统。
        return '<div class="decision-inline">' + (control.fields || []).map(function (field) {
          return '<label><span>' + esc(field.label) + '</span><input data-field="' + esc(field.name) + '"></label>';
        }).join('') + '</div>';
      case 'field_form':
        // 信息补全 → 结构化表单（不是自由对话，见 5.3）。
        return '<div class="decision-form">' + (control.fields || []).map(function (field) {
          var input = field.value_kind === 'boolean' ? '<input type="checkbox" data-field="' + esc(field.name) + '">'
            : '<input type="' + (field.value_kind === 'number' ? 'number' : 'text') + '" data-field="' + esc(field.name) + '">';
          return '<label><span>' + esc(field.label) + '</span>' + input + '</label>';
        }).join('') + '</div>';
      default:
        // 后端已经拒绝未注册类型，能走到这里说明前后端注册表不一致；宁可显式报错，
        // 也不要悄悄渲染成一个通用表单。
        return '<div class="decision-unknown">未知的裁决形态：' + esc(String(control.renderer)) + '</div>';
    }
  }

  // 权限：展示可撤销的精确审批授权（ApprovalGrant）。它只证明人做过决定，不证明动作已执行。
  function viewPermissions() {
    return Promise.all([
      settled(api('/api/approval-grants'), { grants: [] }),
      settled(api('/api/workspaces'), { workspaces: [] }),
    ]).then(function (results) {
      var grants = results[0].grants || [];
      var workspaceName = {};
      (results[1].workspaces || []).forEach(function (item) { workspaceName[item.id] = item.name || item.root_path || item.id; });
      var tone = function (status) { return status === 'active' ? 'ok' : status === 'expired' ? 'warn' : 'muted'; };
      var label = function (status) { return status === 'active' ? '生效中' : status === 'expired' ? '已过期' : status === 'revoked' ? '已撤销' : String(status); };
      var rows = grants.length ? grants.map(function (item) {
        return '<div class="row"><div class="row-main">' +
          '<span class="row-title">' + esc(item.action) + ' · ' + esc(String(item.risk_level || '')) + '</span>' +
          '<span class="row-sub">工作区 ' + esc(workspaceName[item.workspace_id] || item.workspace_id) +
          ' · 影响 ' + esc(item.effect) + ' · 指纹 ' + esc(String(item.action_fingerprint || '')) +
          ' · 策略 ' + esc(String(item.policy_version || '')) +
          ' · ' + (item.expires_at ? '有效至 ' + esc(shortTime(item.expires_at)) : '未设到期') +
          // An authorization is only meaningful as a person's decision, so the
          // page shows who granted it and who took it back - or says plainly that
          // nobody signed it, rather than leaving the reader to guess.
          ' · 由 ' + esc(item.granted_by || '未署名') + ' 授权' +
          (item.revoked_by ? ' · 由 ' + esc(item.revoked_by) + ' 撤销' : '') +
          (item.revoked_reason ? ' · 撤销原因 ' + esc(item.revoked_reason) : '') + '</span></div>' +
          pill(label(item.status), tone(item.status)) +
          (item.status === 'active' ? '<div class="row-actions"><button class="btn danger" type="button" data-grant-revoke="' + esc(item.id) + '">撤销</button></div>' : '') +
          '</div>';
      }).join('') : emptyState('还没有记住的授权', '“批准并记住”会为精确动作创建一条有期限、可撤销的授权；R3 永不记住。', 'shield');
      return {
        html: '<div class="stack"><div class="card">' +
          head('记住的审批授权', '精确动作指纹 + 工作区 + 有效期；到期或撤销后必须重新确认', countChip(grants.length)) +
          '<div class="card-body"><div class="rows">' + rows + '</div></div></div></div>',
        aside: asideBlock('授权的边界', '', '<div class="aside-note">授权只证明人作过决定，不证明动作已执行或业务已验收。权限只允许逐级收紧，不能突破只读安全底线。</div>'),
        mounts: [function (root) {
          Array.prototype.forEach.call(root.querySelectorAll('[data-grant-revoke]'), function (button) {
            button.onclick = function () {
              // Ask for a reason first: an unsigned, unexplained revocation is not
              // an auditable decision. Cancelling the prompt changes nothing.
              var reason = window.prompt('可选：为什么撤销这条授权（取消则不动）');
              if (reason === null) return;
              button.disabled = true;
              var query = 'revoked_by=' + encodeURIComponent(operatorOf()) +
                (reason.trim() ? '&reason=' + encodeURIComponent(reason.trim()) : '');
              api('/api/approval-grants/' + encodeURIComponent(button.getAttribute('data-grant-revoke')) + '?' + query, { method: 'DELETE' })
                .then(function () { toast('授权已撤销，并记录撤销人与理由'); paint('permissions'); })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
        }]
      };
    });
  }

  function viewSubscriptions() {
    return Promise.all([api('/api/subscriptions'), settled(api('/api/subscription-drift'), { subscriptions: [] })]).then(function (results) {
      var result = results[0], items = result.subscriptions || [], drift = (results[1] && results[1].subscriptions) || [];
      var stateTone = function (item) {
        if (item.state === 'revoked') return 'muted';
        if (item.state === 'expired' || item.expired) return 'warn';
        if (item.state === 'suspended') return 'danger';
        return 'ok';
      };
      var stateLabel = function (item) {
        if (item.state === 'revoked') return '已撤销';
        if (item.state === 'suspended') return '已挂起';
        // A lapsed subscription reads as expired even before a sweep touches it.
        if (item.state === 'expired' || item.expired) return '已过期';
        return '生效中';
      };
      var rows = items.length ? items.map(function (item) {
        var risk = 'R0 → ' + esc(String(item.max_risk_level || 'R0'));
        var expiry = shortTime(item.expires_at);
        var confirmations = Number(item.confirmations || 0);
        return '<div class="row"><div class="row-main">' +
          '<span class="row-title">' + esc(item.subscription_id) + '</span>' +
          '<span class="row-sub">触发 ' + esc(JSON.stringify(item.trigger)) + ' · 允许 ' +
          esc((item.allowed_actions || []).join('、')) + ' · 风险上限 ' + risk +
          ' · 有效至 ' + esc(expiry) + ' · 触发 ' + esc(String(item.dispatches || 0)) +
          ' 次（失败 ' + esc(String(item.failures || 0)) + '）' +
          // 一次都没重新确认过的订阅最容易跑过当初批准它的那个情境。
          (confirmations ? ' · 已确认 ' + esc(String(confirmations)) + ' 次' : ' · 从未重新确认') +
          // The subscription acts while nobody is watching, so every hand that
          // granted, reconfirmed or revoked it has to be readable on the card.
          ' · 由 ' + esc(item.granted_by || '未署名') + ' 授权' +
          (item.reconfirmed_by ? ' · 最近确认 ' + esc(item.reconfirmed_by) : '') +
          (item.revoked_by ? ' · 由 ' + esc(item.revoked_by) + ' 撤销' : '') +
          '</span></div>' + pill(stateLabel(item), stateTone(item)) +
          '<div class="row-actions">' +
          '<button class="btn" type="button" data-sub-audit="' + esc(item.subscription_id) + '">历史</button>' +
          '<button class="btn" type="button" data-sub-reconfirm="' + esc(item.subscription_id) + '">重新确认</button>' +
          (item.state === 'revoked' ? '' : '<button class="btn danger" type="button" data-sub-revoke="' + esc(item.subscription_id) + '">撤销</button>') +
          '</div><div class="row-detail" data-sub-detail="' + esc(item.subscription_id) + '"></div></div>';
      }).join('') : emptyState('还没有订阅', '事件订阅会让系统在你不在场时自动开始工作，所以它必须是一条有期限、可撤销的授权记录。', 'refresh');

      var driftRows = drift.length ? '<div class="rows">' + drift.map(function (item) {
        var changed = (item.changed_fields || []).join('、');
        return '<div class="row"><div class="row-main"><span class="row-title">' + esc(item.subscription_id) + '</span>' +
          '<span class="row-sub">已触发 ' + esc(String(item.events_seen || 0)) + ' 次 · 最近 ' + esc(item.last_event_at ? shortTime(item.last_event_at) : '从未') +
          (changed ? ' · 变动字段 ' + esc(changed) : '') + (item.suspended_reason ? ' · ' + esc(item.suspended_reason) : '') + '</span></div>' +
          pill(item.state === 'active' ? '结构未漂移' : item.state === 'suspended' ? '已挂起' : '休眠', item.state === 'active' ? 'ok' : item.state === 'suspended' ? 'danger' : 'warn') + '</div>';
      }).join('') + '</div>' : emptyState('还没有登记结构指纹', '订阅登记依赖的上游结构摘要后，这里会显示它是否漂移或被休眠。', 'refresh');
      var driftCard = '<div class="card">' + head('订阅结构漂移', '上游结构以指纹比对；漂移只挂起并要求人工重新激活，绝不自动撤销', '<button class="btn" type="button" data-drift-sweep>扫描休眠</button>') +
        '<div class="card-body">' + driftRows + '</div></div>';

      return {
        html: '<div class="stack"><div class="card">' +
          // A capped list must never look like the complete set of live grants.
          head('订阅即授权', '它说「这类事件可以自动开始工作」，不说「这些工作可以跳过裁决」',
            countChip(results[0].total > items.length ? '显示 ' + items.length + ' / 共 ' + results[0].total : items.length)) +
          '<div class="card-body"><div class="rows">' + rows + '</div></div></div>' + driftCard + '</div>',
        aside: asideBlock('为什么订阅单列一页', '', '<div class="aside-note">批准一个动作是「我批准这件事做」，责任清楚、一次性；订阅是「我批准这类事以后自动做」。' +
          '后者是一张长期支票，所以它必须带范围、风险上限和期限，并且到期只能由人重新确认。</div>'),
        mounts: [function (root) {
          Array.prototype.forEach.call(root.querySelectorAll('[data-sub-audit]'), function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-sub-audit');
              var slot = root.querySelector('[data-sub-detail="' + id + '"]');
              if (!slot) return;
              api('/api/subscriptions/audit?subscription_id=' + encodeURIComponent(id)).then(function (audit) {
                var summary = audit.summary || {};
                var refusals = (audit.refusals || []).map(function (item) {
                  return esc(item.action) + '（' + esc(item.risk_level) + '）被拒：' + esc(item.reason || '');
                });
                var failures = (audit.failure_history || []).map(function (item) {
                  return esc(item.action) + ' 于 ' + esc(shortTime(item.at)) + ' 失败';
                });
                slot.innerHTML = '<pre>触发 ' + esc(String(summary.dispatches || 0)) +
                  ' 次 · 失败 ' + esc(String(summary.failures || 0)) +
                  ' 次 · 被拒 ' + esc(String(summary.refusals || 0)) +
                  ' 次 · 重新确认 ' + esc(String(summary.confirmations || 0)) + ' 次' +
                  (summary.never_reconfirmed ? '\n从未重新确认过' : '') +
                  (refusals.length ? '\n\n被拒记录：\n' + refusals.join('\n') : '') +
                  (failures.length ? '\n\n失败记录：\n' + failures.join('\n') : '') + '</pre>';
              }).catch(function (error) { slot.textContent = error.message; });
            };
          });
          Array.prototype.forEach.call(root.querySelectorAll('[data-sub-reconfirm]'), function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-sub-reconfirm');
              // 到期只能重新确认，不得自动续期：所以期限必须由人重新给出。
              var days = window.prompt('重新确认：这次有效多少天？', '30');
              if (!days) return;
              var parsed = parseInt(days, 10);
              if (!parsed || parsed < 1) { toast('请填写一个正整数天数'); return; }
              button.disabled = true;
              var now = new Date();
              api('/api/subscriptions/reconfirm', { method: 'POST', body: JSON.stringify({
                subscription_id: id, reconfirmed_at: now.toISOString(),
                expires_at: new Date(now.getTime() + parsed * 86400000).toISOString(),
                reconfirmed_by: operatorOf()
              }) })
                .then(function () { toast('已重新确认 ' + parsed + ' 天'); paint('subscriptions'); })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
          Array.prototype.forEach.call(root.querySelectorAll('[data-sub-revoke]'), function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-sub-revoke');
              var reason = window.prompt('撤销理由（会记入授权记录）：', '');
              if (reason === null) return;
              if (!reason) { toast('需要填写撤销理由'); return; }
              button.disabled = true;
              api('/api/subscriptions/revoke', { method: 'POST', body: JSON.stringify({
                subscription_id: id, revoked_by: operatorOf(),
                revoked_at: new Date().toISOString(), revocation_reason: reason
              }) })
                .then(function () { toast('已撤销'); paint('subscriptions'); })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
          var sweep = root.querySelector('[data-drift-sweep]');
          if (sweep) sweep.onclick = function () {
            sweep.disabled = true;
            api('/api/subscription-drift/sweep', { method: 'POST', body: { now: new Date().toISOString() } })
              .then(function (res) { toast('已扫描休眠：' + String((res && res.count) || 0) + ' 条'); paint('subscriptions'); })
              .catch(function (error) { sweep.disabled = false; fail(error); });
          };
        }]
      };
    });
  }

  // 文档 8 / 15.3：对象轨 + 对象页 + 凭证面板。三块，就三块。
  // 左侧永不重排（按 bucket → priority → id 稳定排序，由 object-rail 内核给出）；
  // 中央一次只放一个待裁决项；右侧默认只显示结论，展开是原始值与复算路径。
  function viewObjects() {
    var selected = state.selectedObject || null;
    var query = selected ? '?object_id=' + encodeURIComponent(selected) : '';
    return api('/api/objects' + query).then(function (rail) {
      var counts = rail.counts || {};
      var focus = rail.focus;

      var groupOf = function (bucket, label, tone) {
        var items = (rail.rail || []).filter(function (item) { return item.bucket === bucket; });
        if (!items.length) return '';
        var rows = items.map(function (item) {
          var isFocus = focus && focus.id === item.id;
          var actions = item.bucket === 'needs_you'
            ? '<button class="btn primary" type="button" data-open-object="' + esc(item.id) + '">去看</button>'
            : '<button class="btn" type="button" data-open-object="' + esc(item.id) + '">打开</button>';
          return '<div class="row' + (item.marked ? ' row-marked' : '') + (isFocus ? ' row-current' : '') + '">' +
            '<div class="row-main"><span class="row-title">' + esc(item.title) + '</span>' +
            '<span class="row-sub">' + esc(item.kind) + ' · ' + esc(item.state) +
            (item.open_adjudications ? ' · 待裁决 ' + esc(String(item.open_adjudications)) : '') +
            (item.awaiting_fields && item.awaiting_fields.length ? ' · 缺字段 ' + esc(item.awaiting_fields.join('、')) : '') +
            '</span></div>' + pill(label, tone) + '<div class="row-actions">' + actions + '</div></div>';
        }).join('');
        return '<div class="card">' + head(label, '', countChip(items.length)) + '<div class="card-body"><div class="rows">' + rows + '</div></div></div>';
      };

      var railHtml = groupOf('needs_you', '需要你', 'danger') + groupOf('in_progress', '进行中', 'muted') + groupOf('done', '已完成', 'ok');

      // 中央：交付物 + 至多一个待裁决项。东西，不是对话。
      var centre;
      if (!focus) {
        centre = '<div class="card">' + head('还没有工作对象', '') + '<div class="card-body">' +
          emptyState('还没有工作对象', '当事件孵化出对象，或你在命令面板里说明一个意图时，它会出现在这里。', 'layers') + '</div></div>';
      } else {
        var fields = Object.keys(focus.fields || {});
        var cardHtml = '';
        if (focus.adjudication) {
          var adjudication = focus.adjudication;
          // A merged card is one action, not one signature (6.4)：把 effect 数量写在卡上，
          // 让人知道一次点击背后有几件不同的事。
          var batchNote = adjudication.batch_effects > 1
            ? '<div class="aside-note">这一张卡合并了 ' + esc(String(adjudication.batch_effects)) + ' 个同类 effect。批准后每个 effect 各自留一条授权记录。</div>'
            : '';
          cardHtml = '<div class="card"><div class="card-body">' +
            '<div class="row"><div class="row-main"><span class="row-title">' + esc(adjudication.summary) + '</span>' +
            '<span class="row-sub">' + esc(adjudication.decision_kind) + ' · 优先级 ' + esc(String(adjudication.priority)) + '</span></div>' +
            pill('待裁决', 'warn') +
            '<div class="row-actions">' +
            '<button class="btn primary" type="button" data-authorize="' + esc(adjudication.id) + '" data-effect="' + esc(focus.id) + '">授权</button>' +
            '<button class="btn" type="button" data-acknowledge="' + esc(adjudication.id) + '">我看到了</button>' +
            '</div></div>' + batchNote +
            // 文档 9：控件形态由决策类型决定，由后端下发；这里只负责按 renderer 渲染。
            // 异步填入，不阻塞卡片本体——锚点先出现，生成元素随后。
            '<div data-decision-slot="' + esc(adjudication.decision_kind) + '"></div>' +
            (focus.waiting_adjudications
              ? '<div class="aside-note">还有 ' + esc(String(focus.waiting_adjudications)) + ' 项在左侧挂起，不会抢中央。</div>' : '') +
            '</div></div>';
        }
        var fieldRows = fields.length
          ? fields.map(function (name) {
              return '<div class="row"><div class="row-main"><span class="row-title">' + esc(name) + '</span>' +
                '<span class="row-sub">' + esc(String(focus.fields[name])) + '</span></div></div>';
            }).join('')
          : '<div class="aside-note">这个对象还没有补充字段。</div>';
        var pendingNote = (focus.pending_fields && focus.pending_fields.length)
          ? '<div class="aside-note">还缺：' + esc(focus.pending_fields.join('、')) + '。请在这里补齐，不要回到自由输入。</div>' : '';
        centre = '<div class="card">' + head(focus.title, focus.intention ? String(focus.intention) : '对象本身与它挂着的待裁决项', pill(focus.kind, 'muted')) +
          '<div class="card-body"><div class="rows">' + fieldRows + '</div>' + pendingNote + '</div></div>' + cardHtml;
      }

      return {
        html: '<div class="stack">' + (railHtml || emptyState('对象轨是空的', '对象会随着事件或你的意图出现。', 'layers')) + centre + '</div>',
        // 右栏：凭证。默认只有结论；原始值与复算路径按需展开。
        aside: focus ? asideBlock('凭证', '', '<div id="receipt-panel" class="aside-note">正在读取凭证…</div>') : '',
        asideMount: focus ? function (panel) { mountReceipts(panel, focus.id); } : null,
        mounts: [function (root) {
          // 文档 9：锚点先出现，生成元素随后填入。控件的形态由后端按决策类型下发；
          // 9.2 的「3 秒内扫完」由后端判定，超预算的会被标为交付物文件而不是裁决控件。
          var slot = root.querySelector('[data-decision-slot]');
          if (slot && focus.adjudication) {
            var kind = slot.getAttribute('data-decision-slot');
            api('/api/decisions?object_id=' + encodeURIComponent(focus.id) +
              '&decision_kind=' + encodeURIComponent(kind) + '&summary=' + encodeURIComponent(focus.adjudication.summary))
              .then(function (composed) {
                if (!composed.rendered) {
                  // 9.2：一眼扫不完的内容是交付物文件，不是裁决控件。
                  slot.innerHTML = '<div class="aside-note">这个决策超出「3 秒内扫完」的预算（' +
                    esc(String(composed.measurement.estimated_lines)) + ' 行），已判定为交付物文件，请打开后逐项查看。</div>';
                  return;
                }
                slot.innerHTML = renderDecisionControl(composed.control);
              })
              .catch(function (error) {
                // 未注册的决策类型：显式说明，不退化成通用表单。
                slot.innerHTML = '<div class="aside-note">' + esc(error.message) + '</div>';
              });
          }
          Array.prototype.forEach.call(root.querySelectorAll('[data-open-object]'), function (button) {
            button.onclick = function () {
              state.selectedObject = button.getAttribute('data-open-object');
              paint('objects');
            };
          });
          // 授权与「我看到了」是两个不同的动作（11.4）：前者绑定 effect 与凭证摘要，
          // 后者只是一条「我看过这张卡」的记录，不授权任何副作用。
          Array.prototype.forEach.call(root.querySelectorAll('[data-authorize]'), function (button) {
            button.onclick = function () {
              var effectId = button.getAttribute('data-effect');
              var reason = window.prompt('授权理由（会记入授权记录）：', '');
              if (reason === null) return;
              if (!reason) { toast('需要填写授权理由'); return; }
              button.disabled = true;
              api('/api/objects/authorize', { method: 'POST', body: JSON.stringify({
                effect_id: effectId, effect_kind: 'adjudication_effect', actor: operatorOf(),
                authorized_at: new Date().toISOString(), risk_level: 'R2', decision_reason: reason,
                effect: { effect_id: effectId, summary: button.getAttribute('data-authorize') }
              }) })
                .then(function () { toast('已授权'); paint('objects'); })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
          Array.prototype.forEach.call(root.querySelectorAll('[data-acknowledge]'), function (button) {
            button.onclick = function () {
              button.disabled = true;
              api('/api/objects/acknowledge', { method: 'POST', body: JSON.stringify({
                card_id: button.getAttribute('data-acknowledge'), actor: operatorOf(),
                acknowledged_at: new Date().toISOString()
              }) })
                .then(function () { toast('已记录「我看到了」，这不会授权任何副作用'); paint('objects'); })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
        }]
      };
    });
  }

  // 右栏凭证：先给结论，再给原始值与复算路径（文档 8 / 10.1）。
  function mountReceipts(panel, objectId) {
    var target = panel ? panel.querySelector('#receipt-panel') : null;
    if (!target) return;
    api('/api/objects/receipts?object_id=' + encodeURIComponent(objectId)).then(function (evidence) {
      var summary = evidence.summary || {};
      var lines = ['回执 ' + esc(String(summary.receipt_count || 0)) +
        ' · 可复算 ' + esc(String(summary.recomputable_count || 0)) +
        ' · 授权 ' + esc(String(summary.authorization_count || 0))];
      if (summary.transcribed_count) {
        // 11.5：结论的可靠性取决于谁提供了数据，所以这一条必须在默认视图里看得见。
        lines.push('其中 ' + esc(String(summary.transcribed_count)) + ' 条含人工抄录值，不能仅凭它进入 L1。');
      }
      if (!(evidence.receipts || []).length) {
        target.textContent = lines.join(' · ') + ' · 还没有回执。';
        return;
      }
      target.innerHTML = lines.map(function (line) { return '<div>' + line + '</div>'; }).join('') +
        (evidence.receipts || []).map(function (receipt) {
          var mark = receipt.l1_eligible ? pill('可支持 L1', 'ok') : pill('不可进 L1', 'warn');
          return '<div class="row"><div class="row-main"><span class="row-title">' + esc(receipt.action) + ' · ' + esc(receipt.risk_level) + '</span>' +
            '<span class="row-sub">' + esc(receipt.l1_reason || '') + '</span></div>' + mark +
            '<div class="row-actions"><button class="btn" type="button" data-receipt="' + esc(receipt.id) + '">复算路径</button></div>' +
            '<div class="row-detail" data-receipt-detail="' + esc(receipt.id) + '"></div></div>';
        }).join('');
      Array.prototype.forEach.call(target.querySelectorAll('[data-receipt]'), function (button) {
        button.onclick = function () {
          var id = button.getAttribute('data-receipt');
          var slot = target.querySelector('[data-receipt-detail="' + id + '"]');
          if (!slot) return;
          api('/api/objects/receipts?receipt_id=' + encodeURIComponent(id)).then(function (detail) {
            var steps = (detail.steps || []).map(function (step) {
              return esc(step.metric) + '：' + esc(String(step.pre)) + ' → ' + esc(String(step.post)) + '（Δ ' + esc(String(step.delta)) + '）';
            });
            var missing = (detail.uncomparable || []).map(function (item) {
              return esc(item.metric) + '（缺 ' + esc(item.missing) + '）';
            });
            slot.innerHTML = (steps.length ? '<pre>' + steps.join('\n') + '</pre>' : '<div>没有可比较的指标。</div>') +
              (missing.length ? '<div>无法比较：' + missing.join('、') + '</div>' : '');
          }).catch(function (error) { slot.textContent = error.message; });
        };
      });
    }).catch(function (error) { target.textContent = error.message; });
  }

  function viewApprovals() {
    return Promise.all([api('/api/inbox/refresh', { method: 'POST', body: {} }),
      settled(api('/api/action-gate/rules/all'), { rules: [] }),
      settled(api('/api/claims/l1-report'), {}),
      settled(api('/api/metrics/touchpoints'), {})]).then(function (results) {
      var refreshed = results[0], learned = (results[1] && results[1].rules) || [];
      var l1 = results[2] || {}, ht = results[3] || {};
      // 「待我批准」只关心面向人的卡片；面向 agent / operator 的卡片不是这一页的职责。
      var cards = (refreshed.cards || []).filter(function (card) { return card.audience === 'human' || card.audience === undefined; });
      var open = cards.filter(function (card) { return card.status === 'open'; });
      var rows = open.length ? open.map(function (card) {
        var detail = attentionDetail(card);
        var details = card.details || {};
        var canRemember = Boolean(details.workspace && card.action);
        if (canRemember) {
          card._grant = { workspace: details.workspace, action: String(card.action), effect: String(details.effect || 'local_write'),
            risk_level: String(details.risk_level || 'R2'), action_fingerprint: 'sha256:' + String(card.action) + ':' + String(details.target || details.workspace),
            policy_version: String(details.policy_version || 'default') };
        }
        var actions = '<button class="btn primary" type="button" data-attention="' + esc(card.id) + '" data-decision="acknowledge">批准</button>' +
          '<button class="btn" type="button" data-attention="' + esc(card.id) + '" data-decision="defer">稍后</button>' +
          (canRemember ? '<button class="btn" type="button" data-attention="' + esc(card.id) + '" data-decision="acknowledge" data-remember="1">批准并记住</button>' : '');
        return '<div class="row"><label class="approval-check"><input type="checkbox" data-approval-check="' + esc(card.id) + '"' +
          (state.approvalSelection[card.id] ? ' checked' : '') + ' aria-label="选择这条待批准事项"></label>' +
          '<div class="row-main"><span class="row-title">' + esc(attentionActionLabel(card.action) + ' · ' + (card.reason || card.source_kind || card.id)) + '</span>' +
          '<span class="row-sub">' + esc(card.source_kind || '') + (detail ? ' · ' + esc(detail) : '') + '</span></div>' +
          pill('优先级 ' + esc(String(card.priority)), card.priority >= 70 ? 'bad' : card.priority >= 40 ? 'warn' : 'muted') +
          '<div class="row-actions">' + actions + '</div></div>';
      }).join('') : emptyState('没有待批准的事项', '当任务需要人工决定时，会出现在这里；刷新页面不会丢失。', 'shield');

      var decided = cards.filter(function (card) { return card.status !== 'open'; });
      var learnedRows = learned.length ? learned.map(function (rule) {
        var scope = String(rule.scope_kind || '') + ':' + String(rule.scope_id || '');
        return '<div class="row"><div class="row-main"><span class="row-title">' + esc(rule.action || rule.id) + '</span>' +
          '<span class="row-sub">' + esc(scope) + ' · ' + esc(rule.status || '') +
          (rule.revoked_reason ? ' · ' + esc(rule.revoked_reason) : '') + '</span></div>' +
          (rule.status === 'active' ? '<div class="row-actions"><button class="btn" type="button" data-rule-revoke="' + esc(rule.id) + '">撤销</button></div>' : pill(esc(rule.status || ''), rule.status === 'active' ? 'ok' : 'muted')) +
          '</div>';
      }).join('') : emptyState('还没有学习规则', '连续批准同类动作后，Craft 会提议“以后不再问”；规则会显示在这里并可随时撤销。', 'refresh');
      var learnedCard = '<div class="card">' + head('学习规则', '连续批准同类动作后，Craft 会提议“以后不再问”；规则可查、可撤销', countChip(learned.length)) +
        '<div class="card-body"><div class="rows">' + learnedRows + '</div></div></div>';
      var l1Ratio = (l1.l1_ratio === null || l1.l1_ratio === undefined) ? '尚无决策' : Math.round(Number(l1.l1_ratio) * 100) + '%';
      var metricsCard = '<div class="card">' + head('指标', 'L1 占比必须与已接入确定性检查器数量一起看；HT 必须与墙上时间一起看', '') +
        '<div class="card-body"><div class="rows">' +
        '<div class="row"><span class="row-lead accent">L1</span><div class="row-main"><span class="row-title">L1 占比 ' + esc(l1Ratio) + '</span>' +
        '<span class="row-sub">L1 ' + esc(String(l1.l1_count ?? 0)) + ' · L2 ' + esc(String(l1.l2_count ?? 0)) + ' · L3 ' + esc(String(l1.l3_count ?? 0)) + ' · 决策 ' + esc(String(l1.total_decisions ?? 0)) + '</span></div>' +
        pill('检查器 ' + esc(String(l1.deterministic_checkers ?? 0)), 'muted') + '</div>' +
        '<div class="row"><span class="row-lead accent">HT</span><div class="row-main"><span class="row-title">人机接触点</span>' +
        '<span class="row-sub">已度量对象 ' + esc(String(ht.objects_measured ?? 0)) + (ht.total_touchpoints !== undefined ? ' · 接触点 ' + esc(String(ht.total_touchpoints)) : '') + '</span></div>' +
        pill(ht.ht_requires_wall_clock ? '需配墙上时间' : '—', ht.ht_requires_wall_clock ? 'warn' : 'muted') + '</div>' +
        '</div></div></div>';
      var selectedApprovalIds = Object.keys(state.approvalSelection).filter(function (id) {
        return state.approvalSelection[id] && open.some(function (card) { return card.id === id; });
      });
      var approvalBatchBar = selectedApprovalIds.length
        ? '<div class="approval-batch"><span>已选 ' + selectedApprovalIds.length + ' 项</span>' +
          '<button class="btn sm primary" type="button" data-approval-batch="acknowledge">批量批准</button>' +
          '<button class="btn sm" type="button" data-approval-batch="defer">批量稍后</button>' +
          '<button class="btn sm" type="button" data-approval-batch="clear">取消选择</button></div>'
        : '';
      return {
        html: '<div class="stack"><div class="card">' + head('待我批准', '需要人工决定才能继续的工作；决定会持久保存，刷新不会丢失', countChip(open.length)) +
          '<div class="card-body"><div class="rows">' + rows + '</div>' + approvalBatchBar + '</div></div>' +
          '<div class="card">' + head('已处理', '已经给出决定的事项', countChip(decided.length)) + '<div class="card-body">' +
          (decided.length ? '<div class="rows">' + decided.map(function (card) {
            var when = card.deferred_until ? ' · 推迟至 ' + esc(String(card.deferred_until)) : '';
            return '<div class="row"><div class="row-main"><span class="row-title">' + esc(card.reason || card.id) + '</span><span class="row-sub">' + esc(card.status) + when + (card.decided_by ? ' · ' + esc(card.decided_by) : '') + '</span></div></div>';
          }).join('') + '</div>' : emptyState('还没有已处理事项', '批准或推迟后的事项会记录在这里。', 'check')) + '</div></div>' + learnedCard + metricsCard + '</div>',
        aside: asideBlock('为什么需要批准', '', '<div class="aside-note">写入、外部操作与生成代码在本机执行前需要人工决定。Craft 不会替你批准，也不会因为界面刷新而遗忘你的决定。</div>'),
        mounts: [function (root) {
          Array.prototype.forEach.call(root.querySelectorAll('[data-approval-check]'), function (box) {
            box.onchange = function () {
              var id = box.getAttribute('data-approval-check');
              if (box.checked) state.approvalSelection[id] = true; else delete state.approvalSelection[id];
              paint('approvals');
            };
          });
          Array.prototype.forEach.call(root.querySelectorAll('[data-approval-batch]'), function (button) {
            button.onclick = function () {
              var action = button.getAttribute('data-approval-batch');
              if (action === 'clear') { state.approvalSelection = {}; paint('approvals'); return; }
              var ids = Object.keys(state.approvalSelection).filter(function (id) {
                return state.approvalSelection[id] && open.some(function (card) { return card.id === id; });
              });
              if (!ids.length) return;
              button.disabled = true;
              // 批量入口仍逐条走 /api/inbox/decide：一次决定一条授权，不合并语义。
              // 用 allSettled 而不是 Promise.all：某条失败不能把已成功的决定
              // 说成「全部失败」，也不能让界面停在过期的勾选状态。
              Promise.allSettled(ids.map(function (id) {
                var body = { item_id: id, decision: action, decided_by: operatorOf() };
                if (action === 'defer') {
                  body.deferred_until = new Date(Date.now() + 3600000).toISOString();
                  body.reason = 'batch_deferred_from_workbench';
                }
                return api('/api/inbox/decide', { method: 'POST', body: body }).then(function () {
                  delete state.approvalSelection[id];
                });
              })).then(function (outcomes) {
                var ok = outcomes.filter(function (o) { return o.status === 'fulfilled'; }).length;
                var bad = outcomes.length - ok;
                var verb = action === 'acknowledge' ? '批准' : '推迟';
                toast('已批量' + verb + ' ' + ok + ' 项' + (bad ? '，' + bad + ' 项失败需重试' : ''), bad > 0);
                paint('approvals');
              });
            };
          });
          Array.prototype.forEach.call(root.querySelectorAll('[data-attention]'), function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-attention'), decision = button.getAttribute('data-decision');
              var body = { item_id: id, decision: decision, decided_by: operatorOf() };
              if (decision === 'defer') {
                // 后端要求 deferred_until 必须晚于当前时间，默认推迟一小时。
                body.deferred_until = new Date(Date.now() + 3600000).toISOString();
                body.reason = window.prompt('推迟原因（可留空）：') || 'deferred_from_workbench';
              }
              button.disabled = true;
              var card = open.filter(function (item) { return item.id === id; })[0];
              var grant = card && button.getAttribute('data-remember') ? card._grant : null;
              var chain = api('/api/inbox/decide', { method: 'POST', body: body });
              if (grant) {
                // R3 由后端拒绝；这里先解析目录身份，再把精确指纹交给服务端记住。
                chain = chain
                  .then(function () { return api('/api/workspaces/resolve-or-create', { method: 'POST', body: { root_path: grant.workspace } }); })
                  .then(function (resolved) {
                    return api('/api/approval-grants', { method: 'POST', body: {
                      workspace_id: resolved.workspace.id, action: grant.action, action_fingerprint: grant.action_fingerprint,
                      effect: grant.effect, risk_level: grant.risk_level, policy_version: grant.policy_version,
                      granted_by: operatorOf(), expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
                    } });
                  });
              }
              chain.then(function () { toast(decision === 'acknowledge' ? (grant ? '已批准并记住 24 小时' : '已批准') : '已推迟一小时'); paint('approvals'); })
                .then(function () { delete state.approvalSelection[id]; })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
          Array.prototype.forEach.call(root.querySelectorAll('[data-rule-revoke]'), function (button) {
            button.onclick = function () {
              button.disabled = true;
              api('/api/action-gate/rules/revoke', { method: 'POST', body: {
                rule_id: button.getAttribute('data-rule-revoke'), reason: 'revoked_from_workbench'
              } }).then(function () { toast('已撤销学习规则'); paint('approvals'); })
                .catch(function (error) { button.disabled = false; fail(error); });
            };
          });
        }]
      };
    });
  }

  // 执行配置：ExecutorTemplate（一次一个）、ExpertTemplate（只读）、SupervisorProfile（硬门规则 + 只建议的模型）。
  function viewExecutors() {
    return Promise.all([
      settled(api('/api/executor-templates'), { templates: [] }),
      settled(api('/api/supervisor-profiles'), { profiles: [] }),
    ]).then(function (results) {
      var templates = results[0].templates || [];
      var profiles = results[1].profiles || [];
      var templateRows = templates.length ? '<div class="rows">' + templates.map(function (item) {
        return '<div class="row"><div class="row-main"><span class="row-title">' + esc(item.name) + ' · ' + esc(item.provider) + '</span>' +
          '<span class="row-sub">模型 ' + esc(String(item.model || '未指定')) + ' · 权限 ' + esc(String(item.permission)) +
          (Array.isArray(item.capability_ids) && item.capability_ids.length ? ' · 能力 ' + esc(item.capability_ids.join('、')) : '') +
          ' · 不携带执行授权</span></div>' + pill('模板', 'muted') + '</div>';
      }).join('') + '</div>' : emptyState('还没有执行模板', '模板绑定 provider、模型、权限、能力与预算；一个任务只选一个模板。', 'cpu');
      var profileRows = profiles.length ? '<div class="rows">' + profiles.map(function (item) {
        var rules = Array.isArray(item.deterministic_rules) ? item.deterministic_rules : [];
        return '<div class="row"><div class="row-main"><span class="row-title">' + esc(item.name) + '</span>' +
          '<span class="row-sub">硬门规则 ' + esc(String(rules.length)) + ' 条 · 监督模型 ' + esc(String(item.supervision_model || '未指定')) +
          ' · 模型只给建议，无放行权</span></div>' + pill('只建议', 'muted') + '</div>';
      }).join('') + '</div>' : emptyState('还没有监督档案', '确定性规则可以暂停或阻断；监督模型只给风险和验收建议。', 'shield');
      return {
        html: '<div class="stack">' +
          '<div class="card">' + head('执行模板', '绑定 provider / 模型 / 权限 / 能力 / 预算', '<button class="btn sm primary" type="button" id="executor-new">新建</button>') +
          '<div class="card-body"><div id="executor-form"></div>' + templateRows + '</div></div>' +
          '<div class="card">' + head('监督档案', '规则硬门，模型只建议', '<button class="btn sm primary" type="button" id="supervisor-new">新建</button>') +
          '<div class="card-body"><div id="supervisor-form"></div>' + profileRows + '</div></div>' +
          '</div>',
        aside: asideBlock('为什么模板不直接执行', '', '<div class="aside-note">模板与监督档案都是计划与建议，不是授权。执行仍走现有 Task / Approval / Evidence 链路。</div>'),
        mounts: [function (root) {
          var executorNew = root.querySelector('#executor-new');
          var supervisorNew = root.querySelector('#supervisor-new');
          if (executorNew) executorNew.onclick = function () {
            var host = root.querySelector('#executor-form');
            if (!host || host.querySelector('form')) return;
            host.innerHTML = '<form class="stack field-row">' +
              '<div class="field"><label>名称</label><input data-x="name" required></div>' +
              '<div class="field"><label>provider</label><select data-x="provider"><option value="craft">Craft</option><option value="codex">Codex</option><option value="claude">Claude</option><option value="dsh">DSH</option></select></div>' +
              '<div class="field"><label>模型</label><input data-x="model" placeholder="可留空"></div>' +
              '<div class="field"><label>权限</label><select data-x="permission"><option value="ask">审批</option><option value="read_only">只读</option><option value="auto">自动</option><option value="full">完全</option></select></div>' +
              '<div class="row-actions"><button class="btn primary" type="submit">保存模板</button></div></form>';
            var form = host.querySelector('form');
            form.onsubmit = function (event) {
              event.preventDefault();
              var body = {}; Array.prototype.forEach.call(form.querySelectorAll('[data-x]'), function (field) { if (field.value) body[field.getAttribute('data-x')] = field.value; });
              api('/api/executor-templates', { method: 'POST', body: body }).then(function () { toast('执行模板已保存'); paint('executors'); }).catch(fail);
            };
          };
          if (supervisorNew) supervisorNew.onclick = function () {
            var host = root.querySelector('#supervisor-form');
            if (!host || host.querySelector('form')) return;
            host.innerHTML = '<form class="stack field-row">' +
              '<div class="field"><label>名称</label><input data-x="name" required></div>' +
              '<div class="field"><label>监督模型</label><input data-x="supervision_model" placeholder="只给建议，可留空"></div>' +
              '<div class="field"><label>硬门规则（condition=action 每行一条，action 为 pause 或 block）</label><textarea data-x="rules" rows="3" placeholder="ci_failed=pause"></textarea></div>' +
              '<div class="row-actions"><button class="btn primary" type="submit">保存档案</button></div></form>';
            var form = host.querySelector('form');
            form.onsubmit = function (event) {
              event.preventDefault();
              var body = {}; Array.prototype.forEach.call(form.querySelectorAll('[data-x]'), function (field) { if (field.value) body[field.getAttribute('data-x')] = field.value; });
              var rules = String(body.rules || '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean).map(function (line) {
                var splitAt = line.lastIndexOf('=');
                if (splitAt < 1) throw new Error('规则格式应为 condition=action');
                var action = line.slice(splitAt + 1).trim();
                if (action !== 'pause' && action !== 'block') throw new Error('规则 action 只能是 pause 或 block');
                return { id: line.slice(0, splitAt).trim(), condition: line.slice(0, splitAt).trim(), action: action };
              });
              delete body.rules;
              body.deterministic_rules = rules;
              api('/api/supervisor-profiles', { method: 'POST', body: body }).then(function () { toast('监督档案已保存'); paint('executors'); }).catch(fail);
            };
          };
        }]
      };
    });
  }

  function viewSkills() {
    return Promise.all([api('/api/connectors?limit=100'), api('/api/workbench/resources?kind=skills&limit=100'),
      settled(api('/api/workbench/experience/proposals'), { proposals: [] }),
      settled(api('/api/workbench/experience/procedures'), { procedures: [] })]).then(function (results) {
      var assets = (results[0].assets || []).filter(function (item) { return item.asset_type === 'skill'; }), personal = results[1].items || [];
      var proposals = (results[2] && results[2].proposals) || [];
      var procedures = (results[3] && results[3].procedures) || [];
      var rows = catalogRows(assets, 'spark', function (item) { return item.name || item.logical_id || item.id; }, function (item) {
        return (item.summary || '没有说明') + ' · ' + label(EFFECT_LABELS, item.effect, item.effect || '仅查看');
      });
      // A local skill can be removed; a plugin's skill leaves with its plugin, so
      // this list only ever offers what it owns.
      var personalRows = personal.length ? '<div class="rows">' + personal.map(function (item) {
        return '<div class="row"><span class="row-lead muted">' + icon('spark') + '</span><div class="row-main">' +
          '<span class="row-title">' + esc(item.name) + '</span>' +
          '<span class="row-sub">' + esc(item.description || '本机上传 · 可在任务创建时附带') + '</span></div>' +
          '<div class="row-actions"><details class="row-confirm"><summary class="btn sm danger">删除</summary>' +
          '<div class="stack"><span class="row-sub">删除只移除这份本机上传的 SKILL.md；插件带来的技能请随插件卸载。</span>' +
          '<button class="btn sm danger" type="button" data-skill-delete="' + esc(item.id) + '">确认删除</button></div></details></div></div>';
      }).join('') + '</div>' : '';
      var proposalRows = proposals.length ? '<div class="rows">' + proposals.map(function (item) {
        var lifecycle = String(item.lifecycle || '');
        return '<div class="row"><div class="row-main"><span class="row-title">' + esc(item.name || item.id) + '</span>' +
          '<span class="row-sub">' + esc([item.procedure_kind, lifecycle, item.scenario_key].filter(Boolean).join(' · ')) + '</span></div>' +
          pill(lifecycle === 'draft' ? '待门槛' : lifecycle || '—', lifecycle === 'draft' ? 'warn' : 'muted') + '</div>';
      }).join('') + '</div>' : emptyState('还没有经验草稿', '从已验证的执行记录提炼出的 Procedure 会以草稿出现；通过 shadow/held_out/signoff/canary 门槛后才可复用。', 'refresh');
      var procedureRows = procedures.length ? '<div class="rows">' + procedures.map(function (item) {
        var lifecycle = String(item.lifecycle || '');
        var routeable = item.routeable === true || lifecycle === 'routeable';
        var rolled = lifecycle === 'rolled_back' || lifecycle === 'rejected';
        return '<div class="row"><div class="row-main"><span class="row-title">' + esc(item.title || item.id) + '</span>' +
          '<span class="row-sub">' + esc([item.scope, lifecycle, '门槛 ' + ((item.completed_gates || []).length),
            item.rollback_gate_id ? '回滚点 ' + item.rollback_gate_id : null].filter(Boolean).join(' · ')) + '</span></div>' +
          pill(routeable ? '可导出' : rolled ? '已回滚' : '未通过门槛', routeable ? 'ok' : rolled ? 'danger' : 'muted') +
          (routeable ? '<div class="row-actions"><button class="btn" type="button" data-procedure-export="' + esc(item.id) + '">导出为技能</button></div>' : '') + '</div>';
      }).join('') + '</div>' : emptyState('还没有 Procedure', '经验草稿通过 shadow/held_out/signoff/canary 门槛后，会在这里成为可导出的 Procedure。', 'spark');
      var procedureCard = '<div class="card">' + head('Procedure（经验固化）', '通过全部门槛后导出为禁用状态的 SKILL.md 草稿', countChip(procedures.length)) + '<div class="card-body">' + procedureRows + '</div></div>';
      return {
        html: '<div class="stack"><div class="card">' + head('本机技能', '上传或编辑 SKILL.md；选入任务后会作为只读指令上下文附带',
          '<div class="row-actions"><button class="btn primary" id="skill-upload" type="button">' + icon('file') + '上传 SKILL.md</button><input id="skill-file" type="file" accept="text/markdown,.md" hidden></div>') +
          '<div class="card-body">' + (personalRows || emptyState('还没有本机技能', '上传一个 SKILL.md 后可在新建任务的「能力」中选择它。', 'spark')) + '</div></div>' +
          '<div class="card">' + head('已登记技能', '来自已确认的插件或连接器', countChip(assets.length)) + '<div class="card-body">' + (rows || emptyState('还没有已登记技能', '在连接器中扫描并确认外部技能。', 'spark')) + '</div></div>' +
          '<div class="card">' + head('经验固化草稿', '经验先成为草稿；通过门槛前不会成为可复用技能', countChip(proposals.length)) + '<div class="card-body">' + proposalRows + '</div></div>' + procedureCard + '</div>',
        aside: asideBlock('技能的状态', '', '<div class="aside-note">本机技能不会自动获得工具权限；外部技能仍遵循来源审核、权限与连接器健康检查。</div>'),
        mounts: [function (root) { var upload = root.querySelector('#skill-upload'), file = root.querySelector('#skill-file'); if (upload && file) { upload.onclick = function () { file.click(); }; file.onchange = function () { readUpload(file, ['md'], function (content, name) { var title = (content.match(/^name:\s*([^\r\n]+)$/m) || [])[1] || name.replace(/\.md$/i, ''); var description = (content.match(/^description:\s*([^\r\n]+)$/m) || [])[1] || ''; api('/api/workbench/skills', { method: 'POST', body: { name: title.trim(), description: description.trim(), content: content, edited_by: operatorOf() } }).then(function () { caps.userSkills = []; toast('技能已安装'); paint('skills'); }).catch(fail); }); }; }
          Array.prototype.forEach.call(root.querySelectorAll('[data-skill-delete]'), function (button) { button.onclick = function () { button.disabled = true;
            api('/api/workbench/skills/' + encodeURIComponent(button.getAttribute('data-skill-delete')), { method: 'DELETE' })
              .then(function () { caps.userSkills = []; toast('技能已删除'); paint('skills'); })
              .catch(function (error) { button.disabled = false; fail(error); }); }; });
          Array.prototype.forEach.call(root.querySelectorAll('[data-procedure-export]'), function (button) { button.onclick = function () { button.disabled = true;
            api('/api/workbench/experience/procedures/export', { method: 'POST', body: { procedure_id: button.getAttribute('data-procedure-export') } })
              .then(function (result) { toast('已导出技能草稿：' + String((result && result.export && result.export.status) || 'draft')); paint('skills'); })
              .catch(function (error) { button.disabled = false; fail(error); }); }; }); }]
      };
    });
  }

  function viewModels() {
    return api('/api/config/models').then(function (result) {
      var models = result.models || [];
      var rows = models.length ? models.map(function (model) {
        return '<div class="row"><span class="row-lead accent">' + esc(String(model.name || model.id).charAt(0).toUpperCase()) + '</span><div class="row-main"><span class="row-title">' + esc(model.name || model.id) + '</span><span class="row-sub">' + esc(model.model || '未选择模型') + '</span></div>' + (model.configured ? pill('可用', 'ok') : pill('待填密钥', 'warn')) + '</div>';
      }).join('') : emptyState('还没有模型', '添加并配置一个模型后，就能创建并继续任务对话。', 'cpu');
      return {
        html: '<div class="stack"><div class="card">' + head('模型', '先配置模型，再在任务区选择它开始任务', '<button class="btn primary" id="model-add" type="button">' + icon('plus') + '添加模型</button>') +
          '<div class="card-body"><div class="rows">' + rows + '</div><p class="doc-p" style="margin-top:12px">密钥只从本机设置或系统环境变量读取，不会出现在任务记录中。</p></div></div></div>',
        aside: asideBlock('任务执行', '', '<div class="aside-note">任务会先以模型对话方式运行。需要读取文件、执行命令或外部操作时，Craft 会根据任务权限进行治理和记录。</div>'),
        mounts: [function (root) { var button = root.querySelector('#model-add'); if (button) button.onclick = function () { openModelSheet({ step: 1, preset: null, model: '', name: '' }); }; }]
      };
    });
  }

  function openMemoryEditor(item) {
    item = item || {};
    openInlineOn('memory', {
      title: item.id ? '修改记忆' : '添加记忆', sub: '保存会保留人工来源；修改会生成替代版本',
      html: '<div class="field"><label for="memory-content">内容</label><textarea id="memory-content" class="tall">' + esc(item.content || '') + '</textarea></div>' +
        '<div class="field-row"><div class="field"><label for="memory-kind">类型</label><select id="memory-kind">' + options([['fact', '事实'], ['decision', '决策'], ['preference', '偏好'], ['experience', '经验']], item.kind || 'fact') + '</select></div>' +
        '<div class="field"><label>范围</label><input value="' + esc(item.scope === 'task' ? '当前任务' : item.scope === 'workspace' ? '当前工作区' : '用户') + '" readonly></div></div>',
      actions: [{ label: '保存记忆', primary: true, run: function () {
        // A memory typed here is a person's statement; without a proposer the
        // record would claim it came from an agent.
        var body = { memory_id: item.id, content: val('memory-content'), kind: val('memory-kind'), proposed_by: operatorOf() };
        if (!item.id) body.scope = 'user';
        api('/api/workbench/memory', { method: 'POST', body: body })
          .then(function () { clearInline(); toast(item.id ? '记忆已更新为新版本' : '记忆已保存'); paint('memory'); }).catch(fail);
      } }]
    });
  }

  function openKnowledgePageEditor(page) {
    page = page || {};
    var load = page.id ? call('craft_wiki_page_get', { page_id: page.id }) : Promise.resolve({ body: '', page: {} });
    load.then(function (result) {
      openInlineOn('knowledge', {
        title: page.id ? '编辑知识页面' : '新建知识页面', sub: '内容保存为本机 Markdown，并保留版本',
        html: '<div class="field"><label for="wiki-title">标题</label><input id="wiki-title" value="' + esc((result.page || {}).title || page.title || '') + '"></div>' +
          '<div class="field"><label for="wiki-scope">范围</label><input id="wiki-scope" value="' + esc((result.page || {}).scope || 'global') + '"></div>' +
          '<div class="field"><label for="wiki-body">Markdown 内容</label><textarea id="wiki-body" class="tall">' + esc(result.body || '') + '</textarea></div>',
        actions: [{ label: '保存页面', primary: true, run: function () { call('craft_wiki_page_save', { page_id: page.id, title: val('wiki-title'), scope: val('wiki-scope') || 'global', body: val('wiki-body'), author: operatorOf() }).then(function () { clearInline(); toast('知识页面已保存'); paint('knowledge'); }).catch(fail); } }]
      });
    }).catch(fail);
  }

  function openKnowledgeClaimEditor() {
    openInlineOn('knowledge', {
      title: '添加知识结论', sub: '将自动附上一条人工来源证据，初始状态为待审核',
      html: '<div class="field"><label for="claim-content">结论</label><textarea id="claim-content">' + '</textarea></div><div class="field-row"><div class="field"><label for="claim-kind">类型</label><select id="claim-kind">' + options([['fact', '事实'], ['rule', '规则'], ['decision', '决策'], ['term', '术语'], ['failure_mode', '失败模式']], 'fact') + '</select></div><div class="field"><label for="claim-scope">范围</label><input id="claim-scope" value="global"></div></div>',
      actions: [{ label: '保存结论', primary: true, run: function () {
        // Attribution travels with the claim, using the same operator signature
        // as every other human decision in the workbench.
        api('/api/workbench/knowledge/claims', { method: 'POST', body: { content: val('claim-content'), kind: val('claim-kind'),
          scope: val('claim-scope') || 'global', proposed_by: operatorOf() } })
          .then(function () { clearInline(); toast('知识结论已保存，等待审核'); paint('knowledge'); }).catch(fail);
      } }]
    });
  }

  function openWorkflowEditor(workflow) {
    workflow = workflow || {};
    openInlineOn('workflows', {
        title: workflow.id ? '编辑经验' : '新建经验', sub: '保存为草稿；执行前仍须走权限与审批流程',
      html: '<div class="field"><label for="workflow-name">名称</label><input id="workflow-name" value="' + esc(workflow.name || '') + '"></div><div class="field"><label for="workflow-desc">说明</label><input id="workflow-desc" value="' + esc(workflow.description || '') + '"></div><div class="field"><label for="workflow-inputs">输入定义（JSON 数组）</label><textarea id="workflow-inputs">' + esc(JSON.stringify(workflow.inputs || [], null, 2)) + '</textarea></div><div class="field"><label for="workflow-steps">步骤（JSON 数组）</label><textarea id="workflow-steps" class="tall">' + esc(JSON.stringify(workflow.steps || [], null, 2)) + '</textarea></div>',
      actions: [{ label: '保存草稿', primary: true, run: function () { try { var inputs = JSON.parse(val('workflow-inputs') || '[]'), steps = JSON.parse(val('workflow-steps') || '[]'); api('/api/workbench/workflows', { method: 'POST', body: { workflow_id: workflow.id, name: val('workflow-name'), description: val('workflow-desc'), inputs: inputs, steps: steps } }).then(function () { clearInline(); toast('经验草稿已保存'); paint('workflows'); }).catch(fail); } catch (_) { toast('输入定义和步骤必须是有效 JSON 数组', true); } } }]
    });
  }

  function viewKnowledge() {
    return Promise.all([api('/api/knowledge'), settled(api('/api/workbench/context-storage'), { status: [] })]).then(function (results) {
      var result = results[0], claims = result.claims || [], pages = result.pages || [], bundles = result.bundles || [];
      var clip = function (value, max) { var text = String(value || ''); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
      // A long claim stays scannable but opens in place instead of truncating forever.
      var claimTitle = function (value) {
        var text = String(value || '');
        if (text.length <= 180) return '<span class="row-title">' + esc(text) + '</span>';
        return '<details class="row-details"><summary class="row-title" title="' + esc(text) + '">' + esc(clip(text, 180)) +
          '</summary><p class="row-full">' + esc(text) + '</p></details>';
      };
      var storageStatus = ((results[1] && results[1].status) || []).filter(function (entry) { return entry.kind === 'knowledge'; })[0];
      var mirrorNote = !storageStatus || storageStatus.mode !== 'mirror' ? '本地保存；可在设置里镜像到 Obsidian vault 或任意目录。'
        : '镜像到 ' + (storageStatus.path || '未设置目录') + (storageStatus.ok ? '' : '（不可写：' + (storageStatus.detail || '未知原因') + '）');
      var claimRows = claims.length ? '<div class="rows">' + claims.map(function (item) {
        var evidence = Array.isArray(item.evidence_ids) ? item.evidence_ids.length : 0;
        var status = String(item.status || '');
        var confidence = item.review && item.review.confidence ? String(item.review.confidence) : null;
        // The weight mirrors what recall ranks with: helpful receipts raise it,
        // pending corrections lower it.
        var weight = item.recall_weight === undefined ? 1 : Number(item.recall_weight);
        var sub = [item.kind, label(STATUS_LABELS, status, status), item.scope, '证据 ' + evidence,
          confidence ? '置信 ' + confidence : null, item.valid_until ? '有效至 ' + item.valid_until : null,
          // A claim is somebody's assertion before it is a fact the system uses.
          // `sub` is escaped as a whole below, so no per-field escaping here.
          '提出 ' + (item.proposed_by || '未署名'),
          // Who settled it, once settled.
          item.review && item.review.reviewer ? '审核 ' + item.review.reviewer : null,
          '权重 ' + (Number.isFinite(weight) ? weight.toFixed(2) : '—') +
          ' · 有用 ' + String(item.helpful_signals || 0) + ' / 待复核 ' + String(item.pending_corrections || 0)]
          .filter(Boolean).join(' · ');
        return '<div class="row"><span class="row-lead muted">' + icon('layers') + '</span><div class="row-main">' + claimTitle(item.content || item.id) +
          '<span class="row-sub">' + esc(sub) + '</span>' +
          '<button class="btn sm" type="button" data-knowledge-audit="' + esc(item.id) + '">召回记录</button>' +
          '<button class="btn sm" type="button" data-knowledge-trend="' + esc(item.id) + '">趋势</button>' +
          '<pre class="out" data-recall-audit-list hidden></pre><pre class="out" data-weight-trend-list hidden></pre></div>' +
          (evidence ? pill('有证据', 'ok') : pill('待证据', 'warn')) + '</div>';
      }).join('') + '</div>' : '';
      var pageRows = pages.length ? '<div class="rows">' + pages.map(function (item) { return '<div class="row"><span class="row-lead muted">' + icon('file') + '</span><div class="row-main"><span class="row-title">' + esc(item.title || item.id) + '</span><span class="row-sub">' + esc(item.revision_source || 'Markdown') + '</span></div><button class="btn sm" data-wiki-edit="' + esc(item.id) + '">编辑</button></div>'; }).join('') + '</div>' : '';
      return {
        html: '<div class="stack"><div class="grid-2"><div class="card">' + head('知识结论', '带来源与状态的可核验内容', '<button class="btn sm" id="claim-add">' + icon('plus') + '添加结论</button>') + '<div class="card-body"><div class="aside-note">' + esc(mirrorNote) + '</div>' + (claimRows || emptyState('还没有知识结论', '从任务或资料中提取后才会显示。', 'layers')) + '</div></div>' +
          '<div class="card">' + head('知识页面', '以本机 Markdown 保存、可直接编辑', '<button class="btn sm primary" id="wiki-add">' + icon('plus') + '新建页面</button>') + '<div class="card-body">' + (pageRows || emptyState('还没有知识页面', '新建页面或导入资料后会显示在这里。', 'file')) + '</div></div></div>' +
          '<div class="card">' + head('知识包', '运行任务时可绑定的已整理上下文', countChip(bundles.length)) + '<div class="card-body">' + (bundles.length ? catalogRows(bundles, 'inbox', function (item) { return item.id; }, function (item) { return (item.claim_refs || []).length + ' 条结论 · ' + (item.scope || '未设范围'); }) : emptyState('还没有知识包', '知识包需要由真实知识记录生成。', 'inbox')) + '</div></div></div>',
        aside: asideBlock('可追溯性', '', '<div class="aside-note">知识页面的修改写入新 Markdown 版本；人工新增结论会附带来源证据，仍可再审核。</div>'),
        mounts: [function (root) { var wiki = root.querySelector('#wiki-add'), claim = root.querySelector('#claim-add'); if (wiki) wiki.onclick = function () { openKnowledgePageEditor(); }; if (claim) claim.onclick = openKnowledgeClaimEditor; root.querySelectorAll('[data-wiki-edit]').forEach(function (button) { button.onclick = function () { var page = pages.filter(function (entry) { return entry.id === button.getAttribute('data-wiki-edit'); })[0]; if (page) openKnowledgePageEditor(page); }; }); bindRecallAudit(root, { api: api, attribute: 'data-knowledge-audit', member: 'knowledge' }); bindWeightTrend(root, { api: api, attribute: 'data-knowledge-trend', member: 'knowledge' }); }]
      };
    });
  }

  // ----------------------------------------------------------------- settings

  // ------------------------------------------------- right-panel "sheet"
  // Everything that needs more room than the page itself renders into the right
  // panel instead of a dialog, so the app never interrupts with a modal.
  // A sheet is transient DOM: paint() blanks the panel, so changing page (or
  // refreshing it) naturally restores the page's own context.

  var sheetClose = null;

  // 文档 5.3：L3 的唯一合法使命，是孵化一个新的工作对象。
  // 这个面板刻意只有「意图 + 类型 + 一个确认按钮」，没有对话历史、没有继续追问的输入框：
  // 连续多轮对话会把「孵化对象」退化成「聊天」，而中间区迟早会被对话流占领。
  // 对象一旦生成，这里立即收起并转入该对象的画布。
  function openHatch() {
    if (state.page !== 'objects') { go('objects'); }
    openSheet(function (panel) {
      var kinds = ['migration', 'refactor', 'investigation', 'delivery', 'incident'];
      panel.innerHTML = '<div class="sheet">' + sheetHead('孵化一个新对象', '只做一件事：把它创建出来') +
        '<div class="sheet-body">' +
        '<label class="field"><span>你想做什么</span>' +
        '<textarea id="hatch-intention" rows="3" placeholder="例如：评估把序列化库从 Fastjson 迁到 Jackson"></textarea></label>' +
        '<label class="field"><span>类型</span><select id="hatch-kind">' +
        kinds.map(function (kind) { return '<option value="' + esc(kind) + '">' + esc(kind) + '</option>'; }).join('') +
        '</select></label>' +
        '<div class="aside-note">创建后这里会立即收起。之后缺什么信息，会在对象上以「补全卡片」的方式问你要哪个字段，不会再回到自由输入。</div>' +
        '</div>' +
        '<div class="sheet-actions"><button class="btn primary" type="button" id="hatch-go">创建对象</button></div>' +
        '</div>';
      bindSheetBack(panel);
      var button = panel.querySelector('#hatch-go');
      button.onclick = function () {
        var intention = (panel.querySelector('#hatch-intention').value || '').trim();
        if (intention.length < 3) { toast('请先写下你想做什么'); return; }
        button.disabled = true;
        // 每次孵化用一个新 session id：会话被关闭后不能再孵化第二个对象，
        // 这正是「窄口」在协议层的体现。
        api('/api/objects/hatch', { method: 'POST', body: JSON.stringify({
          session_id: 'hatch_' + Date.now().toString(36),
          intention: intention,
          object_kind: panel.querySelector('#hatch-kind').value,
          hatched_at: new Date().toISOString()
        }) })
          .then(function (result) {
            // 输入区立即收起：不保留刚才的意图，也不给第二次输入的机会。
            state.selectedObject = String(result.object.id);
            toast('已创建：' + result.object.id);
            paint('objects');
          })
          .catch(function (error) { button.disabled = false; fail(error); });
      };
    });
  }

  function openSheet(render) {
    var panel = $('aside-panel');
    if (!panel) return;
    panel.innerHTML = '';
    render(panel);
  }

  // Viewing is R0: the desktop shell opens an isolated WebView with no Craft IPC
  // capability. In a regular browser this command stays visible but explains that it
  // needs the Tauri desktop shell instead of silently opening an untrusted page here.
  function openEmbeddedBrowser() {
    openSheet(function (panel) {
      panel.innerHTML = sheetHead('在应用内查看网页', '只查看页面；网页无法访问本机 Craft、浏览器驱动或桌面控制权限') +
        '<div class="sheet-body"><div class="field"><label for="embedded-url">网页地址</label><input id="embedded-url" type="url" inputmode="url" autocomplete="url" placeholder="https://example.com"></div>' +
        '<div class="aside-note">打开的是受隔离的网页窗口。填写、点击或提交仍须走已注册的浏览器适配器与审批流程。</div></div>' +
        '<div class="sheet-actions"><button class="btn primary" type="button" id="embedded-open">打开网页</button></div>';
      bindSheetBack(panel);
      var button = panel.querySelector('#embedded-open');
      button.onclick = function () {
        var url = String(panel.querySelector('#embedded-url').value || '').trim();
        if (!/^https?:\/\/\S+$/iu.test(url)) { toast('请输入完整的 http:// 或 https:// 地址'); return; }
        var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
        if (typeof invoke !== 'function') { toast('请在 Craft Tauri 桌面端中使用内嵌网页', true); return; }
        button.disabled = true;
        invoke('open_embedded_page', { url: url }).then(function () { sheetClose = null; paint(state.page); }).catch(function (error) { button.disabled = false; fail(error); });
      };
    });
  }

  function openManagedBrowser() {
    openSheet(function (panel) {
      panel.innerHTML = sheetHead('在受管浏览器中登录', '会打开独立、可见的本地 Edge 会话；登录内容和 Cookie 不会进入 Craft') +
        '<div class="sheet-body"><div class="field"><label for="managed-url">网页地址</label><input id="managed-url" type="url" inputmode="url" autocomplete="url" placeholder="https://example.com"></div>' +
        '<div class="aside-note">如遇登录、验证码或双重验证，请在打开的浏览器中自行完成。Craft 只检测“需要人工接管”状态，不读取密码、验证码或 Cookie。</div></div>' +
        '<div class="sheet-actions"><button class="btn primary" type="button" id="managed-open">打开受管浏览器</button></div>';
      bindSheetBack(panel);
      var button = panel.querySelector('#managed-open');
      button.onclick = function () {
        var url = String(panel.querySelector('#managed-url').value || '').trim();
        if (!/^https?:\/\/\S+$/iu.test(url)) { toast('请输入完整的 http:// 或 https:// 地址'); return; }
        var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
        if (typeof invoke !== 'function') { toast('请在 Craft Tauri 桌面端中使用受管浏览器', true); return; }
        button.disabled = true;
        invoke('open_managed_browser', { url: url }).then(function () { toast('已打开受管浏览器；请在其中自行完成登录'); sheetClose = null; paint(state.page); }).catch(function (error) { button.disabled = false; fail(error); });
      };
    });
  }

  function sheetHead(title, sub) {
    sheetClose = true;
    return '<div class="sheet-head">' +
      '<button class="icon-btn sheet-back" type="button" id="sheet-back" aria-label="返回">' + icon('arrow') + '</button>' +
      '<div class="sheet-head-text"><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>' +
      '</div>';
  }

  // Every sheet renders a 返回 control; re-painting the page restores the normal
  // right-panel context, because paint() blanks the panel before rendering.
  function bindSheetBack(panel) {
    var back = panel.querySelector('#sheet-back');
    if (back) back.onclick = function () { sheetClose = null; paint(state.page); };
  }

  function sheetSteps(active) {
    var labels = ['选服务商', '填密钥', '选模型'];
    return '<div class="sheet-steps">' + labels.map(function (text, index) {
      var step = index + 1;
      var state2 = step === active ? ' aria-current="step"' : (step < active ? ' class="done"' : '');
      return '<span class="sheet-step"' + state2 + '><i>' + (step < active ? icon('check') : step) + '</i>' + esc(text) + '</span>';
    }).join('') + '</div>';
  }

  // Service presets. The user picks a brand; protocol, service address, model
  // id and the key's variable name are all derived, never asked for.
  var PROVIDER_PRESETS = [
    { key: 'deepseek', label: 'DeepSeek', protocol: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1', env: 'DEEPSEEK_API_KEY', note: '中文与代码，价格便宜',
      models: ['deepseek-chat', 'deepseek-reasoner'] },
    { key: 'qwen', label: '通义千问', protocol: 'openai-compatible',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', env: 'DASHSCOPE_API_KEY', note: '阿里云百炼',
      models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
    { key: 'kimi', label: 'Kimi', protocol: 'openai-compatible',
      baseUrl: 'https://api.moonshot.cn/v1', env: 'MOONSHOT_API_KEY', note: '长文本阅读',
      models: ['moonshot-v1-32k', 'moonshot-v1-128k', 'moonshot-v1-8k'] },
    { key: 'glm', label: '智谱 GLM', protocol: 'openai-compatible',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4', env: 'ZHIPUAI_API_KEY', note: '',
      models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'] },
    { key: 'doubao', label: '豆包', protocol: 'openai-compatible',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', env: 'ARK_API_KEY', note: '火山方舟',
      models: ['doubao-pro-32k', 'doubao-lite-32k'] },
    { key: 'openai', label: 'OpenAI', protocol: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY', note: '', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] },
    { key: 'anthropic', label: 'Anthropic', protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com', env: 'ANTHROPIC_API_KEY', note: '',
      models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'] },
    { key: 'custom', label: '其它 / 自建', protocol: 'openai-compatible',
      baseUrl: '', env: 'CRAFT_API_KEY', note: '自己填服务地址', models: [] }
  ];

  function presetOf(key) {
    return PROVIDER_PRESETS.filter(function (item) { return item.key === key; })[0] || PROVIDER_PRESETS[0];
  }

  var settingsAdvanced = false;

  // settings.runtime.defaultTier speaks small/medium/large; users pick a word.
  var TIER_WORDS = [
    ['small', '快速', '省钱，适合简单任务'],
    ['medium', '标准', '日常默认，够快也够聪明'],
    ['large', '最强', '更贵，适合难题']
  ];

  function tierWord(value) {
    var hit = TIER_WORDS.filter(function (pair) { return pair[0] === value; })[0];
    return hit ? hit[1] : (value || '—');
  }

  function saveSettings() {
    var current = (state.settings && state.settings.runtime) || {};
    var stepsNode = $('set-steps');
    var tokensNode = $('set-tokens');
    // maxSteps/maxTokens only exist while 高级 is expanded — never write 0 just
    // because the field is collapsed.
    var patch = {
      theme: val('set-theme') || state.theme,
      runtime: {
        defaultTier: val('set-tier') || current.defaultTier,
        maxSteps: stepsNode ? Number(stepsNode.value) : current.maxSteps,
        maxTokens: tokensNode ? Number(tokensNode.value) : current.maxTokens
      }
    };
    var workbenchPatch = {};
    if ($('set-codex-executable')) workbenchPatch.codexExecutable = val('set-codex-executable') || null;
    if ($('set-claude-executable')) workbenchPatch.claudeExecutable = val('set-claude-executable') || null;
    if ($('set-dsh-executable')) workbenchPatch.dshExecutable = val('set-dsh-executable') || null;
    if ($('set-dsh-home')) workbenchPatch.dshHome = val('set-dsh-home') || null;
    if ($('set-dsh-entry-path')) workbenchPatch.dshEntryPath = val('set-dsh-entry-path') || null;
    if ($('set-dsh-plugin-profile')) workbenchPatch.dshPluginProfile = val('set-dsh-plugin-profile') || 'craft-plugin-host';
    if ($('set-operator')) workbenchPatch.operator = val('set-operator') || '';
    if (Object.keys(workbenchPatch).length) patch.workbench = workbenchPatch;
    state.theme = patch.theme;
    applyTheme();
    api('/api/settings', { method: 'PATCH', body: patch })
      .then(function () { toast('设置已保存'); paint('settings'); }).catch(fail);
  }

  // The evaluation runner is its own page rather than a widget under the
  // conversation: a run reads and writes separate files and its report is
  // evidence to keep, not another chat message. It rides the 高级工具 group so
  // the working rail stays short.
  function viewEvaluations() {
    return {
      html: '<div class="card"><div class="card-body stack"><h2>评测</h2>' +
        '<p>在独立副本中执行评测集，比较两次已完成运行，并在结果未知时先核对再决定。评测结论不替代发布审批。</p>' +
        '<div id="evaluation-mount" class="project-evaluation-panel"></div></div></div>',
      aside: '',
      mounts: [function (root) {
        var host = root.querySelector('#evaluation-mount');
        if (!host) return;
        pagePanels.push(mountEvaluationPanel(host, {
          api: api,
          invoke: window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core.invoke : null
        }));
      }]
    };
  }

  function viewSettings() {
    return Promise.all([
      api('/api/settings'),
      settled(api('/api/usage'), { totals: {}, daily: {}, weekly: {}, monthly: {}, yearly: {} }),
      settled(api('/api/config/models'), { models: [] }),
      settled(api('/api/workbench/context-storage'), { storage: {}, status: [] }),
      settled(api('/api/workbench/agent-sessions/providers'), { providers: [] })
    ]).then(function (results) {
      var settings = results[0], usage = results[1], models = results[2].models || [];
      var contextStorage = results[3] || { storage: {}, status: [] };
      state.settings = settings;
      var last = function (bucket) {
        var values = Object.values(bucket || {});
        return values.length ? values[values.length - 1].total_tokens : 0;
      };
      var usageTiles = [
        ['累计', (usage.totals || {}).total_tokens, 'db'],
        ['今天', last(usage.daily), 'play'],
        ['本周', last(usage.weekly), 'layers'],
        ['本月', last(usage.monthly), 'folder'],
        ['今年', last(usage.yearly), 'spark']
      ].map(function (pair) { return statTile(pair[0], pair[1] === undefined ? 0 : pair[1], pair[2]); }).join('');

      var modelRows = models.length ? models.map(function (m) {
        var monogram = String(m.name || m.id).charAt(0).toUpperCase();
        var preset = PROVIDER_PRESETS.filter(function (item) { return item.key === m.id; })[0];
        var brand = preset ? preset.label : (m.name || m.id);
        return '<div class="row model-row" data-id="' + esc(m.id) + '">' +
          '<span class="row-lead accent">' + esc(monogram) + '</span>' +
          '<div class="row-main"><span class="row-title">' + esc(m.name) + '</span>' +
          '<span class="row-sub">' + esc(brand) + ' · ' + esc(m.model) + '</span></div>' +
          (m.configured ? pill('可用', 'ok') : pill('待填密钥', 'warn')) +
          '<button class="icon-btn model-edit-btn" type="button" title="编辑">' + icon('sliders') + '</button>' +
          '<button class="icon-btn model-del-btn" type="button" title="移除">' + icon('trash') + '</button>' +
        '</div>';
      }).join('') : emptyState('还没有可用的模型', '添加一个模型，Craft 才能开始干活', 'cpu');

      var providerStatus = {};
      ((results[4] && results[4].providers) || []).forEach(function (item) { providerStatus[item.id] = item; });
      var TOOL_LABELS = { codex: 'Codex CLI', claude: 'Claude Code', dsh: 'DSH' };
      var toolRows = ['codex', 'claude', 'dsh'].map(function (id) {
        var item = providerStatus[id] || {};
        var available = item.status === 'available' || item.status === 'plugin';
        var sub = available ? ('已安装 · ' + (item.version || '版本未知'))
          : item.status === 'error' ? ('启动失败 · ' + (item.detail || '')) : '当前环境未找到';
        return '<div class="row"><div class="row-main"><span class="row-title">' + TOOL_LABELS[id] + '</span><span class="row-sub">' + esc(sub) + '</span></div>' +
          '<div class="row-actions"><button class="btn sm" type="button" data-tool-install="' + id + '">' + (available ? '重新安装' : '执行安装') + '</button>' +
          '<button class="btn sm" type="button" data-tool-redetect>重新检测</button></div></div>';
      }).join('');
      // 本机工具 stays outside 高级: 「先配工具」 is the first step of the whole
      // workbench, so the CLI paths must be reachable without expanding anything.
      var toolsBlock = '<div class="stack">' +
            '<div class="field-row">' +
              '<div class="field"><label for="set-codex-executable">Codex CLI 可执行文件</label><input id="set-codex-executable" type="text" placeholder="留空则从 PATH 查找" value="' + esc((settings.workbench && settings.workbench.codexExecutable) || '') + '">' +
                '<span class="hint">安装后填写绝对路径，下一次会话检测会优先使用它。</span></div>' +
              '<div class="field"><label for="set-claude-executable">Claude Code 可执行文件</label><input id="set-claude-executable" type="text" placeholder="留空则从 PATH 查找" value="' + esc((settings.workbench && settings.workbench.claudeExecutable) || '') + '">' +
                '<span class="hint">只保存本机路径，不复制或上传可执行文件。</span></div>' +
            '</div>' +
            '<div class="field-row">' +
              '<div class="field"><label for="set-dsh-executable">DSH 可执行文件</label><input id="set-dsh-executable" type="text" placeholder="DSH Desktop.exe 或 dsh" value="' + esc((settings.workbench && settings.workbench.dshExecutable) || '') + '">' +
                '<span class="hint">支持 DSH Desktop 打包入口，也支持独立 dsh CLI。</span></div>' +
              '<div class="field"><label for="set-dsh-home">DSH Home</label><input id="set-dsh-home" type="text" placeholder="留空使用 DSH 默认目录" value="' + esc((settings.workbench && settings.workbench.dshHome) || '') + '">' +
                '<span class="hint">Cordis 插件使用独立 profile，不修改 DSH Desktop 的 web profile。</span></div>' +
            '</div>' +
            '<div class="field-row">' +
              '<div class="field"><label for="set-dsh-entry-path">DSH CLI 入口</label><input id="set-dsh-entry-path" type="text" placeholder="通常由 DSH Desktop 自动推导" value="' + esc((settings.workbench && settings.workbench.dshEntryPath) || '') + '"></div>' +
              '<div class="field"><label for="set-dsh-plugin-profile">DSH 插件 Profile</label><input id="set-dsh-plugin-profile" type="text" value="' + esc((settings.workbench && settings.workbench.dshPluginProfile) || 'craft-plugin-host') + '">' +
                '<span class="hint">Craft Cordis bridge 的隔离 profile 名称。</span></div>' +
            '</div>' +
            '<div class="field"><label for="set-operator">人工决定署名</label><input id="set-operator" type="text" placeholder="留空则如实记为未署名" value="' + esc((settings.workbench && settings.workbench.operator) || '') + '">' +
              '<span class="hint">审批、纠错复核、订阅撤销会记录这个署名。留空不会伪造人名，而是记为未署名。</span></div>' +
          '</div>';

      var advanced = settingsAdvanced
        ? '<div class="stack">' +
            '<div class="field-row">' +
              '<div class="field"><label for="set-steps">单个任务最多执行多少步</label><input id="set-steps" type="number" value="' + esc(settings.runtime.maxSteps) + '">' +
                '<span class="hint">步数越多，能做的事越复杂，也越慢。</span></div>' +
              '<div class="field"><label for="set-tokens">单个任务最多消耗多少 Token</label><input id="set-tokens" type="number" value="' + esc(settings.runtime.maxTokens) + '">' +
                '<span class="hint">用来避免一个任务跑出意外开销。</span></div>' +
            '</div>' +
            '<div class="field-row">' +
              '<div class="field"><label>配置保存位置</label><input type="text" value="' + esc(settings.dataRoot || '—') + '" readonly></div>' +
              '<div class="field"><label>密钥保存在本机</label><input type="text" value="' + (settings.secretsStored ? '是' : '否（从环境变量读取）') + '" readonly></div>' +
            '</div>' +
            '<div class="aside-note">发送匿名使用数据以改进产品：' + (settings.privacy && settings.privacy.telemetry ? '开启' : '关闭') + '。</div>' +
          '</div>'
        : '<div class="aside-note">步数上限、Token 上限与数据位置属于高级选项，一般不用改。</div>';

      // 记忆 / 知识 / 经验 stay local and authoritative; the mirror is a plain
      // Markdown copy into any folder (an Obsidian vault is just a folder).
      var CONTEXT_KINDS = [['memory', '记忆'], ['knowledge', '知识'], ['experience', '经验']];
      var contextStatusByKind = {};
      (contextStorage.status || []).forEach(function (entry) { contextStatusByKind[entry.kind] = entry; });
      var contextStorageRows = CONTEXT_KINDS.map(function (pair) {
        var kind = pair[0], target = (contextStorage.storage || {})[kind] || { mode: 'off', path: null };
        var status = contextStatusByKind[kind] || {};
        var tone = target.mode !== 'mirror' ? pill('仅本地', 'muted') : (status.ok ? pill('可写入', 'ok') : pill('路径不可用', 'warn'));
        return '<div class="row"><span class="row-lead muted">' + icon('db') + '</span><div class="row-main">' +
          '<span class="row-title">' + esc(pair[1]) + '</span>' +
          '<span class="row-sub">' + esc(status.detail || '本地始终保存；远端是可读的 Markdown 镜像') + '</span>' +
          '<div class="field-row">' +
            '<div class="field"><label for="ctx-mode-' + kind + '">远端</label><select id="ctx-mode-' + kind + '">' + options([['off', '关闭'], ['mirror', '镜像到目录']], target.mode) + '</select></div>' +
            '<div class="field"><label for="ctx-path-' + kind + '">目录（Obsidian vault 或任意文件夹）</label><input id="ctx-path-' + kind + '" type="text" placeholder="绝对路径" value="' + esc(target.path || '') + '"></div>' +
          '</div>' +
          '<div class="row-actions"><button class="btn sm" type="button" data-ctx-save="' + kind + '">保存</button>' +
            '<button class="btn sm" type="button" data-ctx-export="' + kind + '">导出到远端</button></div>' + tone + '</div></div>';
      }).join('');

      return {
        html: '<div class="stack">' +
          '<div class="card">' + head('模型', 'Craft 用一个模型来思考和动手',
            '<button class="btn sm primary" id="models-manage" type="button">' + icon('plus') + '添加模型</button>') +
            '<div class="card-body tight"><div class="rows">' + modelRows + '</div></div></div>' +
          '<div class="card">' + head('本机工具', 'Craft 直接复用本机已装的 Codex CLI / Claude Code / DSH；这里只登记路径，不复制、不上传任何程序') +
            '<div class="card-body"><div class="rows">' + toolRows + '</div><pre class="agent-install-output" id="tool-install-output" hidden></pre>' + toolsBlock + '</div></div>' +
          '<div class="card">' + head('上下文远端存储', '记忆 / 知识 / 经验默认只存本地；可另外镜像到 Obsidian vault 或任意文件夹，两份各自独立') +
            '<div class="card-body tight"><div class="rows">' + contextStorageRows + '</div></div></div>' +
          '<div class="grid-2">' +
            '<div class="card">' + head('外观与偏好', '浅色为默认；更改会立即预览',
              '<button class="btn primary" id="settings-save" type="button">' + icon('check') + '保存设置</button>') +
              '<div class="card-body"><div class="stack">' +
                '<div class="field-row">' +
                  '<div class="field"><label for="set-theme">外观</label><select id="set-theme">' +
                    options([['light', '浅色（默认）'], ['dark', '深色'], ['system', '跟随系统']], settings.theme) + '</select></div>' +
                  '<div class="field"><label for="set-tier">默认档位</label><select id="set-tier">' +
                    options(TIER_WORDS.map(function (pair) { return [pair[0], pair[1] + ' · ' + pair[2]]; }), settings.runtime.defaultTier) + '</select></div>' +
                '</div>' +
              '</div></div></div>' +
            '<div class="card">' + head('用量', '本机统计，只算 Token 数量') +
              '<div class="card-body"><div class="metrics">' + usageTiles + '</div></div></div>' +
          '</div>' +
          '<div class="card">' + head('高级', settingsAdvanced ? '已展开' : '一般不用改',
            '<button class="btn sm" id="adv-toggle" type="button">' + (settingsAdvanced ? '收起' : '展开') + '</button>') +
            '<div class="card-body">' + advanced + '</div></div>' +
        '</div>',
        aside: asideBlock('这台机器', '', asideRows([
            ['数据目录', settings.dataRoot],
            ['界面语言', settings.locale === 'zh-CN' ? '简体中文' : settings.locale],
            ['密钥存放', settings.secretsStored ? '本机' : '系统环境变量']
          ])) +
          asideBlock('默认档位', tierWord(settings.runtime.defaultTier),
            '<div class="aside-note">' + esc((TIER_WORDS.filter(function (pair) { return pair[0] === settings.runtime.defaultTier; })[0] || [])[2] || '日常用标准即可。') + '</div>') +
          asideBlock('模型', String(models.length) + ' 个',
            models.length
              ? '<div class="aside-list">' + models.map(function (m) {
                  return '<div class="aside-row"><span class="k">' + esc(m.name) + '</span>' +
                    (m.configured ? pill('可用', 'ok') : pill('待填密钥', 'warn')) + '</div>';
                }).join('') + '</div>'
              : '<div class="aside-note">还没有添加模型。</div>'),
        mounts: [function (root) {
          root.querySelector('#settings-save').onclick = saveSettings;
          var modelsBtn = root.querySelector('#models-manage');
          if (modelsBtn) modelsBtn.onclick = function () { openModelSheet({ step: 1, preset: null, model: '', name: '' }); };
          var adv = root.querySelector('#adv-toggle');
          if (adv) adv.onclick = function () { settingsAdvanced = !settingsAdvanced; paint('settings'); };

          root.querySelectorAll('.model-edit-btn').forEach(function (btn) {
            btn.onclick = function (event) {
              event.stopPropagation();
              var id = btn.closest('.model-row').getAttribute('data-id');
              var model = models.filter(function (m) { return m.id === id; })[0];
              if (!model) return;
              var preset = PROVIDER_PRESETS.filter(function (item) { return item.key === model.id; })[0];
              openModelSheet({ step: 2, preset: preset ? preset.key : 'custom', model: model.model,
                name: model.name, editing: model });
            };
          });
          root.querySelectorAll('.model-del-btn').forEach(function (btn) {
            btn.onclick = function (event) {
              event.stopPropagation();
              var id = btn.closest('.model-row').getAttribute('data-id');
              openSheet(function (panel) {
                panel.innerHTML =
                  sheetHead('移除模型', id) +
                  '<div class="aside-block"><div class="aside-note">移除后，用这个模型的任务会暂停，直到你再添加一个模型。</div>' +
                  '<div class="sheet-actions">' +
                    '<button class="btn danger" type="button" id="del-confirm">' + icon('trash') + '确认移除</button>' +
                    '<button class="btn" type="button" id="del-cancel">取消</button>' +
                  '</div></div>';
                bindSheetBack(panel);
                panel.querySelector('#del-cancel').onclick = function () { paint('settings'); };
                panel.querySelector('#del-confirm').onclick = function () {
                  api('/api/config/models/' + encodeURIComponent(id), { method: 'DELETE' })
                    .then(function () { toast('已移除'); paint('settings'); }).catch(fail);
                };
              });
            };
          });
          var select = root.querySelector('#set-theme');
          if (select) select.onchange = function () { saveTheme(select.value); };
          var saveContextStorage = function () {
            var storage = {};
            CONTEXT_KINDS.forEach(function (pair) {
              var modeNode = root.querySelector('#ctx-mode-' + pair[0]), pathNode = root.querySelector('#ctx-path-' + pair[0]);
              storage[pair[0]] = { mode: modeNode ? modeNode.value : 'off', path: (pathNode && pathNode.value.trim()) || null };
            });
            api('/api/workbench/context-storage', { method: 'POST', body: { storage: storage } })
              .then(function () { toast('远端存储已保存'); paint('settings'); }).catch(fail);
          };
          root.querySelectorAll('[data-ctx-save]').forEach(function (node) { node.onclick = saveContextStorage; });
          root.querySelectorAll('[data-ctx-export]').forEach(function (node) {
            node.onclick = function () {
              api('/api/workbench/context-storage/export', { method: 'POST', body: { kind: node.getAttribute('data-ctx-export') } })
                .then(function (result) { toast(result.error ? '导出失败：' + result.error : '已导出 ' + (result.written || []).length + ' 条到远端'); })
                .catch(fail);
            };
          });
          var toolOutput = root.querySelector('#tool-install-output');
          root.querySelectorAll('[data-tool-redetect]').forEach(function (node) { node.onclick = function () { paint('settings'); }; });
          root.querySelectorAll('[data-tool-install]').forEach(function (node) {
            node.onclick = function () {
              var provider = node.getAttribute('data-tool-install');
              var bridge = window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core.invoke : null;
              if (!bridge) { toast('浏览器模式请复制安装命令在本机终端执行', true); return; }
              node.disabled = true;
              if (toolOutput) { toolOutput.hidden = false; toolOutput.textContent = '正在安装 ' + (TOOL_LABELS[provider] || provider) + '，可能需要几分钟…'; }
              Promise.resolve(bridge('install_cli', { provider: provider }))
                .then(function (result) {
                  if (toolOutput) toolOutput.textContent = (result.command ? '$ ' + result.command + '\n' : '') + (result.output || '(无输出)');
                  toast(result.ok ? (TOOL_LABELS[provider] || provider) + ' 安装完成' : (TOOL_LABELS[provider] || provider) + ' 安装失败（退出码 ' + result.code + '）');
                  paint('settings');
                }).catch(function (error) { toast('安装失败：' + String(error), true); node.disabled = false; });
            };
          });
        }]
      };
    });
  }

  // ------------------------------------------------------- execution setup

  // Execution mode is a pure Studio/前端 preference, kept in localStorage so
  // the choice survives sessions without needing a backend contract change.
  var EXEC_KEY = 'craft.executionMode';

  function execLoad() {
    state.mode = readMode(typeof localStorage === 'undefined' ? null : localStorage);
    try { var raw = localStorage.getItem(EXEC_KEY); if (raw) state.execution = JSON.parse(raw); } catch (_) { /* storage off */ }
    if (!state.execution || !state.execution.mode) state.execution = { mode: '', provider: null, tier: 'standard' };
    if (!state.execution.tier) state.execution.tier = 'standard';
  }

  function saveMode() {
    writeMode(typeof localStorage === 'undefined' ? null : localStorage, state.mode);
  }

  function execSave() {
    try { localStorage.setItem(EXEC_KEY, JSON.stringify(state.execution)); } catch (_) { /* storage off */ }
  }

  // The status bar only ever answers one question: is there a usable model?
  // Craft ships no vendor catalog and no local CLI runner, so a model exists
  // exactly when the user has saved one in settings.
  function renderStatusExecution() {
    var node = $('sb-mode');
    if (!node) return;
    node.textContent = state.modelCount ? '模型 已配置' : '模型 未配置';
  }

  function openExecutionSetup() {
    firstRunPending = true;
    openSheetAfterPaint('models', function () {
      openModelSheet({ isFirstRun: true });
    });
  }
  var firstRunPending = false;

  // A sheet needs the page to have finished painting first (paint() blanks the
  // panel before it renders the page's own aside), so first-run defers it.
  function openSheetAfterPaint(page, render) {
    state.pendingSheet = { page: page, run: render };
    if (state.page === page) paint(page); else go(page);
  }

  // --------------------------------------------------- model setup wizard
  // Three short questions. Everything technical (protocol, service address,
  // model id, key variable) is derived from the service picked in step 1 and
  // only shown under 高级.

  var wizardAdvanced = false;
  var modelSetup = createModelSetup(PROVIDER_PRESETS, api);

  function openModelSheet(wizard) {
    modelSetup.open(wizard);
    wizardAdvanced = false;
    openSheet(function (panel) { renderModelSheet(panel); });
  }

  function wizardRow(key, value) {
    return '<div class="aside-row"><span class="k">' + esc(key) + '</span><span class="v">' + esc(value || '—') + '</span></div>';
  }

  function renderModelSheet(panel) {
    var w = modelSetup.view();
    var preset = w.preset ? presetOf(w.preset) : null;
    if (!w.name && preset) w.name = preset.label;
    var editing = !!w.editing;

    var html = sheetHead(editing ? '编辑模型' : '添加模型', preset ? preset.label : '第 ' + w.step + ' 步 / 共 3 步');
    html += '<div class="sheet-body">';

    if (!editing) html += sheetSteps(w.step);

    if (w.step === 1) {
      html += '<div class="choose-list">' + PROVIDER_PRESETS.map(function (item) {
        return '<button class="choose" type="button" data-preset="' + esc(item.key) + '"' +
          (w.preset === item.key ? ' aria-selected="true"' : '') + '>' +
          '<span class="choose-mark">' + esc(item.label.charAt(0)) + '</span>' +
          '<span class="choose-main"><b>' + esc(item.label) + '</b>' +
          (item.note ? '<span>' + esc(item.note) + '</span>' : '') + '</span>' +
          (w.preset === item.key ? icon('check') : '') + '</button>';
      }).join('') + '</div>';
      html += '<div class="aside-note">不知道选哪个就选 DeepSeek：中文好、便宜，日常够用。</div>';
      html += '<div class="sheet-actions"><button class="btn primary" type="button" id="w-next"' +
        (w.preset ? '' : ' disabled') + '>下一步</button></div>';
    } else if (w.step === 2) {
      var suggestions = preset.models || [];
      html += '<div class="aside-note">此处只登记模型；密钥通过系统环境变量配置，不在页面中收集。</div>';
      html += '<div class="field"><label for="w-model">用哪个模型</label>' +
        '<input id="w-model" type="text" list="w-model-options" value="' + esc(w.model || suggestions[0] || '') + '" placeholder="模型名称">' +
        '<datalist id="w-model-options">' + suggestions.map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('') + '</datalist>' +
        '<span class="hint">下拉是常用选项，也可以直接填服务商文档里的模型名。</span></div>';
      html += '<div class="sheet-actions"><button class="btn" type="button" id="w-prev">上一步</button>' +
        '<button class="btn primary" type="button" id="w-next">下一步</button></div>';
    } else {
      html += '<div class="aside-list">' +
        wizardRow('服务商', preset.label) +
        wizardRow('模型', w.model) +
        wizardRow('名称', w.name) +
        '</div>';
      html += '<div class="callout ' + (w.error ? 'warn' : 'info') + '">' + icon('key') + '<span>' +
        (w.error ? esc(w.error) + '。' : '') +
        'Craft 从<b>系统环境变量</b>里读密钥，不写进配置文件。' +
        '</span></div>';
      html += '<div class="field"><label for="w-env">把 Key 设置到环境变量</label>' +
        '<input id="w-env" type="text" value="' + esc(w.env || preset.env) + '" readonly>' +
        '<span class="hint">设置后重启 Craft 即可生效，之后所有模型都通过它访问。</span></div>';
      html += '<pre class="out" id="w-env-cmd">' + esc(w.envCmd || presetEnvCommand(preset.env)) + '</pre>';
      html += '<div class="sheet-actions"><button class="btn" type="button" id="w-copy">' + icon('file') + '复制命令</button>' +
        '<button class="btn primary" type="button" id="w-save">' + icon('check') + (editing ? '保存' : '完成') + '</button></div>';
      html += '<div class="aside-note">点「完成」只登记模型，不会去连网验证。密钥生效后再跑一个任务即可确认能不能用。</div>';
    }

    html += '<button class="btn ghost sheet-adv-toggle" type="button" id="w-adv">' + (wizardAdvanced ? '收起高级选项' : '高级选项') + '</button>';
    if (wizardAdvanced) {
      html += '<div class="stack sheet-adv">' +
        '<div class="field"><label for="w-name">名称</label><input id="w-name" type="text" value="' + esc(w.name || '') + '"></div>' +
        '<div class="field"><label for="w-baseurl">服务地址</label><input id="w-baseurl" type="text" value="' + esc(w.baseUrl || (preset ? preset.baseUrl : '')) + '"></div>' +
        '<div class="field"><label for="w-protocol">接口协议</label><select id="w-protocol">' +
          options([['openai-compatible', '通用（OpenAI 兼容）'], ['anthropic', 'Anthropic']], w.protocol || (preset ? preset.protocol : 'openai-compatible')) +
        '</select></div>' +
        '<div class="field"><label for="w-envname">密钥所在的环境变量名</label><input id="w-envname" type="text" value="' + esc(w.env || (preset ? preset.env : 'CRAFT_API_KEY')) + '"></div>' +
        '</div>';
    }
    html += '</div>';

    panel.innerHTML = html;
    bindSheetBack(panel);

    var rerender = function () { renderModelSheet(panel); };
    var readAdvanced = function () {
      var node = panel.querySelector('#w-name');
      if (!node) return;
      modelSetup.change({ type: 'fields', name: node.value,
        baseUrl: (panel.querySelector('#w-baseurl') || {}).value,
        protocol: (panel.querySelector('#w-protocol') || {}).value || 'openai-compatible',
        env: (panel.querySelector('#w-envname') || {}).value });
    };

    panel.querySelectorAll('[data-preset]').forEach(function (button) {
      button.onclick = function () {
        readAdvanced();
        modelSetup.change({ type: 'select', key: button.getAttribute('data-preset') });
        rerender();
      };
    });

    var next = panel.querySelector('#w-next');
    if (next) next.onclick = function () {
      readAdvanced();
      var modelNode = panel.querySelector('#w-model');
      try { modelSetup.change({ type: 'next', model: modelNode ? modelNode.value : w.model }); }
      catch (error) { toast(error.message, true); return; }
      rerender();
    };

    var prev = panel.querySelector('#w-prev');
    if (prev) prev.onclick = function () { readAdvanced(); modelSetup.change({ type: 'back' }); rerender(); };

    var adv = panel.querySelector('#w-adv');
    if (adv) adv.onclick = function () { readAdvanced(); wizardAdvanced = !wizardAdvanced; rerender(); };

    var copy = panel.querySelector('#w-copy');
    if (copy) copy.onclick = function () {
      var text = panel.querySelector('#w-env-cmd').textContent;
      var done = function () { toast('命令已复制'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { selectAll('w-env-cmd'); });
      } else selectAll('w-env-cmd');
    };

    var save = panel.querySelector('#w-save');
    if (save) save.onclick = function () {
      readAdvanced();
      modelSetup.save().then(function (result) {
        if (!result.current) return;
        state.execution = { mode: 'provider', provider: result.provider, tier: 'standard' };
        execSave();
        renderStatusExecution();
        toast(result.editing ? '已保存' : '已添加模型「' + result.name + '」');
        // 一次性冷启动引导：配置好首个模型后写入完成标记，此后终身不再弹。
        if (firstRunPending) {
          firstRunPending = false;
          // 引导只确认「模型可用」这一件事：工作目录不在冷启动里绑定。
          // 领航员模式由 Coordinator 按意图自动识别工作目录；灵策/观象的工作区
          // 由用户在创建任务时选择，所以这里只写入完成标记，终身不再弹。
          api('/api/settings/onboarding/complete', { method: 'POST', body: {} })
            .then(function () { toast('首次引导已完成，之后不再弹出'); })
            .catch(function () { toast('引导状态写入失败，可在「首次引导」页重试', true); });
        }
        if (state.page === 'models') paint('models'); else go('models');
      }).catch(fail);
    };
  }

  function presetEnvCommand(env) {
    return '[Environment]::SetEnvironmentVariable(\'' + env + '\', \'你的Key\', \'User\')';
  }

  function selectAll(id) {
    var node = $(id);
    if (!node || !window.getSelection) return;
    try {
      var range = document.createRange();
      range.selectNodeContents(node);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      toast('已选中命令，按 Ctrl+C 复制');
    } catch (_) { /* selection unavailable */ }
  }

  // --------------------------------------------------------------------- boot

  function boot() {
    window.addEventListener('resize', () => resizeComposers(document));
    var params = new URLSearchParams(location.hash.replace(/^#/, ''));
    state.token = params.get('token') || '';
    state.selectedTask = params.get('task') || null;
    state.selectedProject = params.get('project') || null;
    state.selectedPlugin = params.get('plugin') || null;
    state.legacyNav = params.get('legacyNav') === '1';
    state.focus = params.get('focus') || null;
    execLoad();
    state.page = params.get('page') || MODES[state.mode].home;
    if (!knownPage(state.page)) state.page = MODES[state.mode].home;
    applyTheme();
    renderStatusExecution();
    // 三模式投影：先恢复上次模式，再渲染切换器并标注到根节点供 CSS 使用。
    $('app').setAttribute('data-mode', state.mode);
    paintModeSwitch();

    if (!state.token && !(window.__TAURI__ && window.__TAURI__.core)) {
      $('content').innerHTML = '<div class="callout warn">' + icon('key') +
        '<span>这个页面没有访问凭证。请从 Craft Workbench 桌面图标重新打开。</span></div>';
      $('rail-status').setAttribute('data-state', 'bad');
      $('rail-status').querySelector('.conn-text').textContent = '未授权';
      $('sb-conn').setAttribute('data-state', 'bad');
      $('sb-conn').lastChild.textContent = '未授权';
      return;
    }

    $('jump-new-task').onclick = function () { go(MODES[state.mode].home || 'home'); };
    $('settings-nav').onclick = function () { go('settings'); };
    $('nav-back').onclick = function () { history.back(); };
    $('nav-forward').onclick = function () { history.forward(); };
    $('aside-toggle').onclick = function () {
      var app = $('app'); var next = app.getAttribute('data-aside') === 'open' ? 'collapsed' : 'open';
      app.setAttribute('data-aside', next); $('aside-toggle').setAttribute('aria-pressed', String(next === 'collapsed'));
    };
    var settings = $('settings-nav');
    if (settings) settings.setAttribute('aria-current', String(state.page === 'settings'));
    document.querySelectorAll('[data-menu]').forEach(function (button) { button.onclick = function () { openTopMenu(button.getAttribute('data-menu'), button); }; });
    document.addEventListener('click', function (event) { if (!event.target.closest('[data-menu], #top-menu')) closeTopMenu(); });
    // The folder tree lives in the static rail markup, so bind once here instead
    // of re-binding on every repaint.
    // Three things live in one tree: the chevron folds a folder, the folder name
    // opens its detail page, and a row opens the task.
    $('folder-tree').onclick = function (event) {
      var chevron = event.target.closest('[data-chev]');
      if (chevron) { toggleFolder(chevron.getAttribute('data-chev')); return; }
      var more = event.target.closest('[data-more]');
      if (more) {
        var key = more.getAttribute('data-more');
        if (state.showAllFolders[key]) delete state.showAllFolders[key];
        else state.showAllFolders[key] = true;
        renderFolderTree(false);
        return;
      }
      var task = event.target.closest('[data-task]');
      if (task) { openTask(task.getAttribute('data-task')); return; }
      var folder = event.target.closest('[data-folder]');
      if (folder) openFolder(folder.getAttribute('data-folder'));
    };
    $('task-view').onclick = function () {
      state.taskView = state.taskView === 'task' ? 'folder' : 'task';
      paintFolderTree();
    };
    $('task-fold').onclick = function () {
      var groups = state.folderGroups || [];
      var anyOpen = groups.some(function (group) { return !state.collapsedFolders[group.key]; });
      state.collapsedFolders = {};
      if (anyOpen) groups.forEach(function (group) { state.collapsedFolders[group.key] = true; });
      state.showAllFolders = {};
      paintFolderTree();
    };
    $('rail-toggle').onclick = function () {
      var app = $('app');
      var next = app.getAttribute('data-rail') === 'open' ? 'collapsed' : 'open';
      app.setAttribute('data-rail', next);
      $('rail-toggle').setAttribute('aria-pressed', String(next === 'collapsed'));
    };
    // 文档 8：展开才看细节，默认收起。收起状态不丢信息——一行 live 摘要仍在。
    $('sb-toggle').onclick = function () {
      var bar = $('statusbar');
      var next = bar.getAttribute('data-open') === 'true' ? 'false' : 'true';
      bar.setAttribute('data-open', next);
      $('sb-toggle').setAttribute('aria-expanded', next);
      $('sb-detail').hidden = next !== 'true';
    };
    media.addEventListener('change', function () { if (state.theme === 'system') applyTheme(); });

    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if ($('palette-host').hidden) openPalette(); else closePalette();
        return;
      }
      if (event.key !== 'Escape') return;
      if (openMenu) { closeTopMenu(); return; }
      if (!$('palette-host').hidden) { closePalette(); return; }
      if (inlineForm) dismissInline(inlineForm.page);
    });

    api('/api/workbench/summary').then(function (info) {
      $('brand-version').textContent = 'v' + info.version;
      state.counts = info.counts || {};
      $('rail-status').setAttribute('data-state', 'ok');
      $('rail-status').querySelector('.conn-text').textContent = '已连接 · 仅本机';
      $('sb-conn').setAttribute('data-state', 'ok');
      $('sb-conn').lastChild.textContent = '已连接';
      $('sb-root').textContent = info.data_root || '—';
      $('sb-counts').textContent = '任务 ' + esc(state.counts.task || 0) + ' · 文件夹 ' + esc(state.counts.project_brain || 0) +
        ' · 能力 ' + esc(state.counts.capability_connector || 0);
      paintNav();
      // The rail chip and the status bar must agree; both read the same total.
      var listCount = $('task-list-count');
      if (listCount && state.counts.task != null) listCount.textContent = String(state.counts.task);
    }).catch(function () {
      $('rail-status').setAttribute('data-state', 'bad');
      $('rail-status').querySelector('.conn-text').textContent = '连接失败';
      $('sb-conn').setAttribute('data-state', 'bad');
      $('sb-conn').lastChild.textContent = '连接失败';
    });

    api('/api/home').then(function (home) {
      var launches = home.work_launches || [];
      $('sb-host').textContent = '任务运行 ' + (launches.length ? (launches[0].host || '—') : '自动');
      // 文档 8：「正在发生」收起时只说一句话——现在到底有没有东西在跑。
      // 展开才有细节；把过程摆在中央等于把监工合法化，所以这一行是它唯一的固定位置。
      var summary = home.summary || {};
      var activeRuns = Number(summary.active_runs || 0);
      var activeTasks = Number(summary.active_tasks || 0);
      var live = $('sb-live');
      if (activeRuns || activeTasks) {
        live.textContent = activeRuns + ' 个运行中 · ' + activeTasks + ' 个任务进行中';
        live.setAttribute('data-state', 'busy');
      } else {
        live.textContent = '空闲';
        live.setAttribute('data-state', 'idle');
      }
    }).catch(function () { /* status bar keeps the placeholder */ });

    renderFolderTree(true);

    paint(state.page);

    api('/api/settings').then(function (settings) {
      state.settings = settings;
      if (settings.theme) { state.theme = settings.theme; applyTheme(); }
      if (settings.runtime && settings.runtime.defaultTier) state.tier = settings.runtime.defaultTier;
      // 新会话默认权限以 ~/.craft_data 配置为准，而不是写死手动审批。领航/
      // 灵策共用同一份设置，避免三模式对同一用户给出不同默认行为。
      var configured = settings && settings.workbench && settings.workbench.defaultPermission;
      var permissionMap = { ask: 'human_approval', auto: 'assisted_approval', full: 'full_access' };
      if (permissionMap[configured]) state.composer.permission = permissionMap[configured];
      $('jump-new-task').onclick = function () { go('home'); };
      var sessionsNav = $('sessions-nav');
      if (sessionsNav) sessionsNav.onclick = function () { go('home'); };
      if (window.__TAURI__ && window.__TAURI__.event) {
        window.__TAURI__.event.listen('craft-entry-open', function () { go('home'); }).catch(fail);
      }
    }).catch(function () {
      $('jump-new-task').onclick = function () { go('home'); };
      var sessionsNav = $('sessions-nav');
      if (sessionsNav) sessionsNav.onclick = function () { go('home'); };
    });

    // 一次性冷启动引导：只有 onboarding.completedAt 为空且没有模型时才弹；
    // 完成后终身不再弹（标记写入 ~/.craft_data/settings.json）。
    Promise.all([api('/api/config/models'), api('/api/settings')]).then(function (results) {
      var models = (results[0] && results[0].models) || [];
      var onboarding = results[1] && results[1].workbench && results[1].workbench.onboarding;
      var completed = onboarding && onboarding.completedAt;
      // 首登只在应用默认落地页引导：Tauri 启动 fragment 只有 token（无 page），
      // 领航首屏正是这个形态。显式导航到设置/插件等页面时不打断用户操作。
      if (!models.length && !completed && !params.has('page')) openExecutionSetup();
    }).catch(function () { /* ignore, the settings page can be opened manually */ });

    // 消息插件：纯工程 0 Token 展示，按三模式分别落地播报卡片 / 待办 / Toast+侧栏。
    // 智能处理只记录意图，模型推理由 Worker 层按需执行。
    mountMessageDock({ api: api, modeOf: function () { return state.mode; }, notify: toast, fail: fail, esc: esc, icon: icon,
      composerOf: function () { return document.querySelector('.agent-compose [data-field="prompt"]'); } });
  }

  window.addEventListener('hashchange', function () {
    var params = new URLSearchParams(location.hash.replace(/^#/, ''));
    state.token = params.get('token') || state.token;
    state.page = params.get('page') || state.page;
    if (!knownPage(state.page)) state.page = 'home';
    state.selectedTask = params.get('task') || null;
    state.selectedProject = params.get('project') || null;
    state.selectedPlugin = params.get('plugin') || null;
    state.legacyNav = params.get('legacyNav') === '1';
    state.focus = params.get('focus') || null;
    state.selectedTaskTitle = state.selectedTask ? (taskTitleOf(state.selectedTask) || state.selectedTaskTitle) : '';
    paint(state.page);
  });

  boot();
})();
