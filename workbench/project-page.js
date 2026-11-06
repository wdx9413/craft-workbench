/**
 * Folder identities are opaque strings, never properties on a JavaScript object.
 * A task's group key is its canonical workspace_id when present, else its logical
 * project_id. Workspace records supply the display name for directory groups.
 */
export function groupByFolder(projects, tasks, workspaces = []) {
  const groups = new Map();
  for (const project of projects) {
    const key = String(project.project_id || '');
    if (key && !groups.has(key)) groups.set(key, { key, name: project.name || key, known: true, kind: 'project', tasks: [] });
  }
  for (const workspace of workspaces) {
    const key = String(workspace.id || '');
    if (key && !groups.has(key)) groups.set(key, { key, name: workspace.name || workspace.root_path || key, known: true, kind: 'workspace',
      root_path: workspace.root_path || null, tasks: [] });
  }
  for (const task of tasks) {
    const isWorkspace = Boolean(task.workspace_id);
    const key = isWorkspace ? String(task.workspace_id) : task.project_id ? String(task.project_id) : '';
    if (!groups.has(key)) groups.set(key, { key, name: key || '默认', known: false, kind: isWorkspace ? 'workspace' : 'project', tasks: [] });
    groups.get(key).tasks.push(task);
  }
  return [...groups.values()].sort((a, b) => (a.key === '') - (b.key === ''));
}

/** One immutable selection drives the list and detail requests; no global view state. */
export function createProjectPage(api, taskLimit) {
  return async function load(selected) {
    const [projectResult, taskResult] = await Promise.all([
      api('/api/projects?limit=200').catch(() => ({ projects: [] })),
      api('/api/home?limit=' + taskLimit)
    ]);
    const groups = groupByFolder(projectResult.projects || [], taskResult.tasks || [], taskResult.workspaces || []);
    const selectedGroup = groups.find((group) => group.key === selected) || null;
    // A workspace group is a directory identity, not a Project Brain: fetching
    // /api/projects/<workspace_id> would fail. Only logical projects snapshot.
    const snapshot = selectedGroup && selectedGroup.known && selectedGroup.kind !== 'workspace'
      ? await api('/api/projects/' + encodeURIComponent(selectedGroup.key)) : null;
    return { groups, selectedGroup, snapshot };
  };
}
