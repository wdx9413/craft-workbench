import { emptyState, esc, pill, shortTime } from './ui.js';

const MEMBERS = { context: 'Craft Context', knowledge: 'Craft Knowledge', memory: 'Craft Memory', experience: 'Craft Experience', datasec: 'Craft DataSec' };
const HOSTS = { codex: 'Codex', claude: 'Claude Code' };
const STATUS = {
  unmatched_start: ['结束记录缺失', 'warn'],
  completed: ['已结束', 'ok'],
  failed: ['失败', 'danger'],
  skipped: ['已跳过', 'warn']
};

function itemStatus(item) {
  if (item.status === 'unmatched_start') return STATUS.unmatched_start;
  if (item.outcome === 'failed') return STATUS.failed;
  if (item.outcome === 'skipped') return STATUS.skipped;
  return STATUS.completed;
}

function timingLine(item) {
  const phases = [['总耗时', item.duration_ms], ['处理', item.handler_ms], ['存储打开', item.store_open_ms], ['运行时加载', item.runtime_import_ms]]
    .filter(([, value]) => Number.isSafeInteger(value) && value >= 0)
    .map(([label, value]) => label + ' ' + value + ' ms');
  return phases.length ? '<p class="row-sub">' + esc(phases.join(' · ')) + '</p>' : '';
}

function detailsLine(item) {
  const rows = [
    ['请求 ID', item.request_id],
    ['错误码', item.error_code],
    ['错误类型', item.error_type],
    ['数据库阶段', item.database_role && item.database_phase ? item.database_role + ' · ' + item.database_phase : null],
    ['锁等待', Number.isSafeInteger(item.waited_ms) ? item.waited_ms + ' ms' : null]
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (item.status === 'unmatched_start') rows.push(['说明', '可能仍在运行、被 Host 超时终止或异常退出；仅凭此记录不能判断具体原因。']);
  return rows.map(([label, value]) => '<div class="row"><span class="row-sub">' + esc(label) + '</span><span class="row-title">' + esc(value) + '</span></div>').join('');
}

export function renderHookDiagnostics(result) {
  const items = Array.isArray(result && result.items) ? result.items.slice(0, 100) : [];
  if (items.length === 0) return emptyState('还没有 Hook 运行记录', '点击“读取最近记录”后检查本机 Hook 的阶段、耗时和结束状态。', 'inbox');
  return '<div class="rows">' + items.map(item => {
    const status = itemStatus(item);
    const member = Object.hasOwn(MEMBERS, item.member) ? MEMBERS[item.member] : '未知能力';
    const host = Object.hasOwn(HOSTS, item.host) ? HOSTS[item.host] : 'Host 未记录';
    return '<details class="form-block"><summary>' + pill(status[0], status[1]) + ' ' + esc(member + ' · ' + host + ' · ' + item.event) + ' · ' + shortTime(item.started_at) + '</summary>' +
      '<div class="card-body tight">' + timingLine(item) + '<div class="rows">' + detailsLine(item) + '</div></div></details>';
  }).join('') + '</div>';
}

export function mountHookDiagnosticsPanel(root, { api }) {
  const button = root.querySelector('[data-hook-diagnostics-refresh]');
  const status = root.querySelector('[data-hook-diagnostics-status]');
  const list = root.querySelector('[data-hook-diagnostics-list]');
  if (!button || !status || !list) return { destroy() {} };
  let active = true;
  let busy = false;
  button.onclick = async () => {
    if (busy || !active) return;
    busy = true;
    button.disabled = true;
    status.textContent = '正在读取最近的本机记录…';
    try {
      const result = await api('/api/workbench/hook-diagnostics?limit=30');
      if (!active) return;
      list.innerHTML = renderHookDiagnostics(result);
      const count = Array.isArray(result && result.items) ? result.items.length : 0;
      status.textContent = (result && result.partial ? '部分日志未能完整读取。' : '读取完成。') + ' ' + count + ' 条记录。';
    } catch (error) {
      if (!active) return;
      status.textContent = '读取失败：' + String(error && error.message || error);
      list.innerHTML = '';
    } finally {
      busy = false;
      if (active) button.disabled = false;
    }
  };
  return { destroy() { active = false; button.onclick = null; } };
}
