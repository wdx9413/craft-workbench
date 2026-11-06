/**
 * Presentation primitives: icons, escaping, enum translation, card helpers.
 * Pure render helpers with one shared vocabulary; DOM reads are lazy (only when called).
 */

var ICONS = {
  spark: '<path d="M8 2.6l1.35 3.05L12.4 7l-3.05 1.35L8 11.4 6.65 8.35 3.6 7l3.05-1.35z"/>',
  tasks: '<path d="M2.6 4.6l1.1 1.1 2-2.1"/><path d="M2.6 11.4l1.1 1.1 2-2.1"/><path d="M8.6 4.8h4.8M8.6 11.6h4.8"/>',
  folder: '<path d="M1.9 12.6V3.9h3.4l1.4 1.5h7.4v7.2z"/>',
  alert: '<path d="M8 2.6l5.5 9.6H2.5z"/><path d="M8 6.4v3"/><circle cx="8" cy="11.2" r=".85" fill="currentColor" stroke="none"/>',
  play: '<path d="M5.4 3.4l7 4.6-7 4.6z"/>',
  wallet: '<rect x="1.9" y="4" width="12.2" height="8.6" rx="1.6"/><path d="M1.9 7.1h12.2"/><circle cx="11.5" cy="10" r=".8" fill="currentColor" stroke="none"/>',
  shield: '<path d="M8 2.2l5 1.8v4.2c0 2.7-2.1 4.6-5 5.6-2.9-1-5-2.9-5-5.6V4z"/>',
  plus: '<path d="M8 3.4v9.2M3.4 8h9.2"/>',
  plug: '<path d="M5.6 2.2v2.6M10.4 2.2v2.6"/><path d="M3.6 4.8h8.8v1.9a4.4 4.4 0 0 1-8.8 0z"/><path d="M8 11.1v2.7"/>',
  cpu: '<rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.4"/><path d="M6.9 2.4v2.2M9.1 2.4v2.2M6.9 11.4v2.2M9.1 11.4v2.2M2.4 6.9h2.2M2.4 9.1h2.2M11.4 6.9h2.2M11.4 9.1h2.2"/>',
  layers: '<path d="M8 2.6l5.4 2.8L8 8.2 2.6 5.4z"/><path d="M2.6 8.9L8 11.7l5.4-2.8"/>',
  check: '<path d="M3 8.4l3.3 3.3L13 4.9"/>',
  refresh: '<path d="M13.2 8a5.2 5.2 0 1 1-1.53-3.68"/><path d="M13.4 2.6v3.4h-3.4"/>',
  inbox: '<path d="M1.9 9.4L4 3.4h8l2.1 6v3.2H1.9z"/><path d="M1.9 9.4h3.3l.7 1.6h4.2l.7-1.6h3.3"/>',
  file: '<path d="M3.4 2.4h5.2l3.9 3.9v7.3H3.4z"/><path d="M8.6 2.4v3.9h3.9"/>',
  settings: '<path d="M3 5.2h10M3 10.8h10"/><circle cx="6.2" cy="5.2" r="1.7"/><circle cx="10" cy="10.8" r="1.7"/>',
  terminal: '<rect x="2.2" y="3" width="11.6" height="10" rx="1.6"/><path d="M5 6.6l1.7 1.7L5 10M8.6 10.2h3"/>',
  arrow: '<path d="M3.2 8h9.2M9 4.6L12.4 8 9 11.4"/>',
  x: '<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/>',
  chev: '<path d="M6.4 3.8L10.6 8l-4.2 4.2"/>',
  key: '<circle cx="5.6" cy="8" r="2.6"/><path d="M8.2 8h5.4M11.2 8v2.4M13 8v2"/>',
  server: '<rect x="2.4" y="3" width="11.2" height="4.2" rx="1.3"/><rect x="2.4" y="8.8" width="11.2" height="4.2" rx="1.3"/><path d="M5 5.1h.05M5 10.9h.05"/>',
  db: '<ellipse cx="8" cy="4.4" rx="5" ry="2"/><path d="M3 4.4v7.2c0 1.1 2.24 2 5 2s5-.9 5-2V4.4"/><path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2"/>',
  dot: '<circle cx="8" cy="8" r="3.2"/>',
  sun: '<circle cx="8" cy="8" r="3.1"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.15 1.15M11.35 11.35l1.15 1.15M12.5 3.5l-1.15 1.15M4.65 11.35L3.5 12.5"/>',
  moon: '<path d="M13 9.4A5.4 5.4 0 0 1 6.6 3 5.4 5.4 0 1 0 13 9.4z"/>',
  search: '<circle cx="7.2" cy="7.2" r="4.2"/><path d="M10.4 10.4l3 3"/>',
  sliders: '<path d="M3 5.2h10M3 10.8h10"/><circle cx="6.2" cy="5.2" r="1.7"/><circle cx="10" cy="10.8" r="1.7"/>'
};

function icon(name, cls) {
  return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ICONS[name] || ICONS.dot) + '</svg>';
}

var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (c) { return ESCAPES[c]; });
}

function $(id) { return document.getElementById(id); }
function val(id) { var node = $(id); return node ? String(node.value || '').trim() : ''; }
function checked(id) { var node = $(id); return node ? node.checked === true : false; }

function lines(id) {
  var node = $(id);
  if (!node) return [];
  return String(node.value || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function pill(text, tone) {
  return '<span class="pill' + (tone ? ' ' + tone : '') + '">' + esc(text) + '</span>';
}

function shortTime(value) {
  if (!value) return '';
  var parsed = Date.parse(value);
  if (isNaN(parsed)) return esc(value);
  return new Date(parsed).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

var TONE = { completed: 'ok', passed: 'ok', approved: 'ok', active: 'info', issued: 'info', open: 'info',
  awaiting_approval: 'warn', pending: 'warn', needs_replan: 'warn', degraded: 'warn', unknown: '',
  discovered: 'warn', failed: 'danger', denied: 'danger', cancelled: 'danger', unhealthy: 'danger', revoked: 'danger', enabled: 'ok' };

// The backend speaks in short English enum values. Users should never have to
// read them, so every enum that reaches the screen is translated here.
var STATUS_LABELS = {
  completed: '已完成', passed: '通过', active: '进行中', issued: '已发出', open: '待处理',
  awaiting_approval: '等你确认', pending: '等待中', needs_replan: '需要重新规划', degraded: '已降级',
  unknown: '未知', failed: '失败', denied: '已拒绝', cancelled: '已取消', unhealthy: '异常',
  revoked: '已撤回', discovered: '待确认', approved: '可用', ready_for_adapter: '可用', enabled: '已启用',
  not_ready: '未就绪', blocked: '被阻塞'
};

var EFFECT_LABELS = {
  read_only: '仅查看', local_write: '可改本机文件', external_write: '会对外发送', destructive: '有破坏性'
};

var HEALTH_LABELS = { healthy: '正常', unhealthy: '异常', degraded: '已降级', unknown: '未知' };

var ASSET_TYPE_LABELS = {
  skill: 'Skill', mcp_server: 'MCP 服务', tool: '工具', workflow: '经验',
  adapter: '适配器', validator: '校验器', grader: '评分器', eval_suite: '评测集'
};

// Task-detail vocabulary. Same rule as above: no raw enum reaches the screen.
var STAGE_LABELS = {
  baseline: '基线确认', minimal_change: '最小改动', verification: '验证', review: '复查',
  discovery: '现状调研', plan: '方案设计', implementation: '实现', acceptance: '验收'
};

var TRACE_LABELS = {
  route_started: '开始执行', route_stage_completed: '完成一个阶段', route_completed: '执行完成',
  route_failed: '执行失败', trial_started: '开始验收', trial_completed: '验收结束',
  task_run_started: '任务开始', task_run_completed: '任务结束', checkpoint_recorded: '记录了一次进度',
  'task.created': '创建任务', 'task.message.user': '发送了一条消息', 'task.message.assistant': '模型已回复',
  'task.message.failed': '模型回复失败', 'host.output': '执行输出', 'host.finished': '执行结束'
};

var TASK_PERMISSION_LABELS = {
  human_approval: '手动审批', assisted_approval: '帮我审批', full_access: '完全访问'
};

var CONFIDENCE_LABELS = { confirmed: '已确认', high: '高', medium: '中', low: '低' };

var ARTIFACT_KIND_LABELS = {
  file: '文件', route_receipt: '执行凭证', report: '报告', patch: '代码改动',
  digest: '摘要', link: '链接', dataset: '数据集'
};

// Receipt names arrive as `review:git_diff` / `baseline:focused_test`; split the
// stage off and render both halves in Chinese.
var RECEIPT_ACTION_LABELS = {
  git_diff: '代码差异', focused_test: '定向测试', coverage: '覆盖率',
  baseline: '基线', verification: '验证', review: '复查', build: '构建'
};

function receiptName(name) {
  var parts = String(name || '').split(':');
  if (parts.length < 2) return String(name || '—');
  var stage = label(STAGE_LABELS, parts[0], parts[0]);
  var action = label(RECEIPT_ACTION_LABELS, parts[1], parts[1]);
  // `review:review` collapses to one word instead of「复查 · 复查」.
  return stage === action ? stage : stage + ' · ' + action;
}

function label(map, value, fallback) {
  if (value === undefined || value === null || value === '') return fallback === undefined ? '—' : fallback;
  return map[value] || String(value);
}

// Reverse of label(): accepts either the raw enum value or the Chinese wording
// shown in the UI, and falls back when neither matches so the backend never
// receives a value it cannot validate.
function fromLabel(map, value, fallback) {
  var raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return fallback;
  if (Object.prototype.hasOwnProperty.call(map, raw)) return raw;
  var hit = Object.keys(map).filter(function (key) { return map[key] === raw; })[0];
  return hit || fallback;
}

function statusPill(value) {
  if (!value) return pill('—');
  return pill(label(STATUS_LABELS, value, value), TONE[value] || '');
}

function effectPill(effect) {
  var tone = effect === 'destructive' ? 'danger' : (effect === 'read_only' ? 'ok' : 'warn');
  return pill(label(EFFECT_LABELS, effect, effect || '未声明'), tone);
}

function settled(promise, fallback) {
  return promise.then(function (value) { return value; }, function () { return fallback; });
}

function head(title, sub, right) {
  return '<div class="card-head"><div class="head-text"><h2>' + esc(title) + '</h2>' +
    (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (right || '') + '</div>';
}

function emptyState(title, hint, iconName) {
  return '<div class="empty">' + icon(iconName || 'inbox', 'empty-ic') +
    '<b>' + esc(title) + '</b>' + (hint ? '<span>' + esc(hint) + '</span>' : '') + '</div>';
}

function statTile(label, value, iconName, tone) {
  var empty = value === undefined || value === null || value === '';
  return '<div class="stat"><span class="stat-ic' + (tone ? ' ' + tone : '') + '">' + icon(iconName) + '</span>' +
    '<div class="stat-body"><b>' + esc(empty ? '—' : value) + '</b><span>' + esc(label) + '</span></div></div>';
}

function lead(iconName, tone) {
  return '<span class="row-lead' + (tone ? ' ' + tone : '') + '">' + icon(iconName) + '</span>';
}

function countChip(value) { return '<span class="count-chip">' + esc(value) + '</span>'; }

function asideBlock(title, right, bodyHtml) {
  return '<div class="aside-block"><div class="aside-head"><span>' + esc(title) + '</span>' +
    (right ? '<b>' + esc(right) + '</b>' : '') + '</div>' + bodyHtml + '</div>';
}

function asideRows(pairs) {
  return '<div class="aside-list">' + pairs.map(function (pair) {
    return '<div class="aside-row"><span class="k">' + esc(pair[0]) + '</span><span class="v">' + esc(pair[1]) + '</span></div>';
  }).join('') + '</div>';
}

export { icon, esc, pill, shortTime, label, fromLabel, statusPill, effectPill, settled, receiptName, head, emptyState, statTile, lead, countChip, asideBlock, asideRows, $, val, checked, lines, ICONS, TONE, STATUS_LABELS, EFFECT_LABELS, HEALTH_LABELS, ASSET_TYPE_LABELS, STAGE_LABELS, TRACE_LABELS, TASK_PERMISSION_LABELS, CONFIDENCE_LABELS, ARTIFACT_KIND_LABELS, RECEIPT_ACTION_LABELS, ESCAPES };
