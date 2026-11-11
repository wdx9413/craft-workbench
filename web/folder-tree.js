// Folder/task rail rendering extracted from the monolithic app.js.
// All visual helpers and view state are injected so the module is pure and
// fully testable without a DOM or the app singleton.
export const FOLDER_PREVIEW = 5;

export function taskRowHtml(task, deps) {
  const { esc, icon, selectedTask } = deps;
  const active = selectedTask === task.id;
  return '<button class="conv-item" type="button" data-task="' + esc(task.id) + '"' + (active ? ' aria-current="true"' : '') + '>' +
    '<span class="conv-icon">' + icon('tasks') + '</span>' +
    '<span class="conv-main"><span class="conv-title">' + esc(task.title || '未命名任务') + '</span>' +
    '<span class="conv-sub">' + esc(task.goal || '—') + '</span></span></button>';
}

export function taskListRows(tasks, deps) {
  const { esc, lead, statusPill } = deps;
  return (Array.isArray(tasks) ? tasks : []).map((task) =>
    '<div class="row selectable" data-task="' + esc(task.id) + '">' + lead('tasks') +
    '<div class="row-main"><span class="row-title">' + esc(task.title || '未命名任务') + '</span>' +
    '<span class="row-sub">' + esc(task.goal || '—') + '</span></div>' +
    statusPill(task.status) + '</div>',
  ).join('');
}

export function folderGroupHtml(group, deps) {
  const { esc, icon, selectedTask, collapsedFolders, showAllFolders } = deps;
  const row = (task) => taskRowHtml(task, deps);
  const collapsed = !!(collapsedFolders && collapsedFolders[group.key]);
  const all = Array.isArray(group.tasks) ? group.tasks : [];
  const expanded = !!(showAllFolders && showAllFolders[group.key] === true);
  const shown = expanded ? all : all.slice(0, FOLDER_PREVIEW);
  const rest = all.length - shown.length;
  let more = '';
  if (expanded && all.length > FOLDER_PREVIEW) {
    more = '<button class="ft-more" type="button" data-more="' + esc(group.key) + '">收起</button>';
  } else if (rest > 0) {
    more = '<button class="ft-more" type="button" data-more="' + esc(group.key) + '">还有 ' + rest + ' 个，展开</button>';
  }
  const body = all.length
    ? '<div class="conv-list ft-tasks">' + shown.map(row).join('') + '</div>' + more
    : '<div class="ft-empty">还没有任务</div>';
  return '<div class="ft-group"' + (collapsed ? ' data-collapsed="true"' : '') + '>' +
    '<button class="ft-head" type="button" data-folder="' + esc(group.key) + '" aria-expanded="' + String(!collapsed) + '">' +
    '<span class="ft-chev" data-chev="' + esc(group.key) + '">' + icon('chev') + '</span>' +
    icon(group.key ? 'folder' : 'inbox', 'ft-ic') +
    '<span class="ft-name">' + esc(group.name) + '</span>' +
    '<span class="ft-count">' + all.length + '</span>' +
    '</button>' + (collapsed ? '' : body) + '</div>';
}
