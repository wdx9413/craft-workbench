// Small read-only lookups extracted from app.js. They only read the injected
// data, never the DOM or the app singleton, so they are pure and testable.

/** Human decisions are signed by the configured operator; otherwise "unattributed". */
export function operatorOf(settings) {
  const value = settings && settings.workbench && settings.workbench.operator;
  return typeof value === 'string' && value.trim() ? value.trim() : 'unattributed';
}

/** Find a task's title by id across folder groups; '' when unknown. */
export function taskTitleOf(taskId, folderGroups) {
  const groups = Array.isArray(folderGroups) ? folderGroups : [];
  for (const group of groups) {
    const tasks = (group && group.tasks) || [];
    for (const task of tasks) {
      if (task.id === taskId) return task.title || '';
    }
  }
  return '';
}

/** Display name for a capability id, falling back to assets then user skills. */
export function capNameOf(id, caps) {
  const named = (list) => {
    for (const item of Array.isArray(list) ? list : []) {
      if (item.id === id) return item.name || id;
    }
    return null;
  };
  return named(caps && caps.assets) ?? named(caps && caps.userSkills) ?? id;
}
