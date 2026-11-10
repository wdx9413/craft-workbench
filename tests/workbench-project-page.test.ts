import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Browser JavaScript is exercised without generated declarations.
import { createProjectPage, groupByFolder, projectRootForTask } from '../workbench/project-page.js';

test('folder union retains opaque identities, duplicate records, orphan tasks and default tasks', () => {
  const first = { project_id: 'a', name: 'A' };
  const known = { id: '1', project_id: 'a' };
  const orphan = { id: '2', project_id: '__proto__' };
  const other = { id: '3', project_id: 'constructor' };
  const defaults = [{ id: '4', project_id: '' }, { id: '5' }];
  const result = groupByFolder([first, { project_id: 'a', name: 'Duplicate' }, { project_id: 'b' }, { name: 'invalid' }], [known, orphan, other, ...defaults]);
  assert.deepEqual(result.map((group: { key: string; name: string; known: boolean }) => [group.key, group.name, group.known]), [['a', 'A', true], ['b', 'b', true], ['__proto__', '__proto__', false], ['constructor', 'constructor', false], ['', '默认', false]]);
  assert.deepEqual(result[0].tasks, [known]);
  assert.deepEqual(result[4].tasks, defaults);
  assert.deepEqual(groupByFolder([], []), []);
  assert.equal(first.name, 'A');
});

test('selected task corrections resolve only through that task folder to a real project root', () => {
  const groups = groupByFolder([{ project_id: '/repo/logical', name: 'Logical' }], [
    { id: 'workspace-task', workspace_id: 'workspace-a' },
    { id: 'project-task', project_id: '/repo/logical' },
    { id: 'unbound-task' },
  ], [{ id: 'workspace-a', root_path: '/repo/workspace-a' }, { id: 'workspace-missing' }]);
  assert.equal(projectRootForTask(groups, 'workspace-task'), '/repo/workspace-a');
  assert.equal(projectRootForTask(groups, 'project-task'), '/repo/logical');
  assert.equal(projectRootForTask(groups, 'unbound-task'), '');
  assert.equal(projectRootForTask(groups, 'missing'), '');
  assert.equal(projectRootForTask(groups, ''), '');
  assert.equal(projectRootForTask(null, 'workspace-task'), '');
  assert.equal(projectRootForTask([{ key: 'empty-group' }], 'missing'), '');
  assert.equal(projectRootForTask([{ key: 'unknown', tasks: [{ id: 'odd-task', workspace_id: 'unknown' }] }], 'odd-task'), '');
  const noRoot = groupByFolder([], [{ id: 'orphan-workspace-task', workspace_id: 'workspace-missing' }]);
  assert.equal(projectRootForTask(noRoot, 'orphan-workspace-task'), '');
});

test('project page pins one selection and queries a known encoded detail only', async () => {
  const calls: string[] = [];
  const api = async (path: string) => {
    calls.push(path);
    if (path === '/api/projects?limit=200') return { projects: [{ project_id: 'a/b', name: 'AB' }] };
    if (path === '/api/home?limit=25') return { tasks: [{ id: 't', project_id: 'orphan' }] };
    return { brain: { name: 'AB' } };
  };
  const load = createProjectPage(api, 25);
  const result = await load('a/b');
  assert.equal(result.selectedGroup.key, 'a/b');
  assert.deepEqual(result.snapshot, { brain: { name: 'AB' } });
  assert.equal(calls[2], '/api/projects/a%2Fb');
  assert.equal((await load('orphan')).snapshot, null);
  assert.equal((await load('absent')).selectedGroup, null);
  const fallback = createProjectPage(async (path: string) => {
    if (path.startsWith('/api/projects?')) throw new Error('unavailable');
    return {};
  }, 5);
  assert.deepEqual(await fallback(null), { groups: [], selectedGroup: null, snapshot: null });
  const noProjects = createProjectPage(async () => ({}), 5);
  assert.equal((await noProjects(null)).snapshot, null);
  const broken = createProjectPage(async () => { throw new Error('home unavailable'); }, 5);
  await assert.rejects(broken(null), /home unavailable/);
});

test('slow folder detail remains tied to its original selection while another load completes', async () => {
  let resolve!: (value: unknown) => void;
  const load = createProjectPage(async (path: string) => {
    if (path.startsWith('/api/projects?')) return { projects: [{ project_id: 'old' }, { project_id: 'new' }] };
    if (path.startsWith('/api/home?')) return { tasks: [] };
    if (path.endsWith('/old')) return new Promise((done) => { resolve = done; });
    return { name: 'new snapshot' };
  }, 10);
  const old = load('old');
  await Promise.resolve(); await Promise.resolve();
  const fresh = await load('new');
  resolve({ name: 'old snapshot' });
  assert.equal((await old).selectedGroup.key, 'old');
  assert.deepEqual(fresh.snapshot, { name: 'new snapshot' });
});

test('workspace identity wins over project_id and workspace records supply the display name', () => {
  const workspaces = [{ id: 'workspace_abc', name: 'Project A', root_path: '/repo/a' }];
  const grouped = groupByFolder([], [
    { id: '1', workspace_id: 'workspace_abc', project_id: 'logical-x' },
    { id: '2', workspace_id: 'workspace_orphan' },
    { id: '3', project_id: 'logical-y' },
  ], workspaces);
  const byKey = new Map(grouped.map((group: { key: string; name: string; known: boolean }) => [group.key, group]));
  assert.equal(byKey.get('workspace_abc')!.name, 'Project A');
  assert.equal(byKey.get('workspace_abc')!.known, true);
  assert.equal((byKey.get('workspace_abc') as { root_path?: string }).root_path, '/repo/a');
  assert.deepEqual((byKey.get('workspace_abc') as { tasks: unknown[] }).tasks.map((task) => (task as { id: string }).id), ['1']);
  // An orphan workspace still groups instead of falling back to project_id.
  assert.deepEqual((byKey.get('workspace_orphan') as { tasks: unknown[] }).tasks.map((task) => (task as { id: string }).id), ['2']);
  // A task without a workspace keeps using its logical project_id.
  assert.deepEqual((byKey.get('logical-y') as { tasks: unknown[] }).tasks.map((task) => (task as { id: string }).id), ['3']);
});

test('a workspace group never fetches a Project Brain snapshot', async () => {
  const calls: string[] = [];
  const load = createProjectPage(async (path: string) => {
    calls.push(path);
    if (path.startsWith('/api/projects?')) return { projects: [] };
    if (path.startsWith('/api/home?')) return { tasks: [{ id: 't', workspace_id: 'workspace_abc' }], workspaces: [{ id: 'workspace_abc', name: 'Repo A' }] };
    throw new Error('must not fetch a brain for a workspace group: ' + path);
  }, 25);
  const result = await load('workspace_abc');
  assert.equal(result.selectedGroup.kind, 'workspace');
  assert.equal(result.snapshot, null);
});

test('workspace and project groups fall back to their own identity for a missing name', () => {
  // A workspace without a name or path still groups, under its own id.
  const grouped = groupByFolder([], [{ id: 't', workspace_id: 'workspace_nameless' }], [{ id: 'workspace_nameless' }]);
  assert.equal(grouped[0]!.name, 'workspace_nameless');
  // A project without a name groups under its id.
  const projects = groupByFolder([{ project_id: 'p' }], []);
  assert.equal(projects[0]!.name, 'p');
  // A workspace with a path but no name shows the path.
  const withPath = groupByFolder([], [], [{ id: 'workspace_path', root_path: '/repo/x' }]);
  assert.equal(withPath[0]!.name, '/repo/x');
  // A workspace record without an id cannot form a group and is ignored.
  assert.deepEqual(groupByFolder([], [], [{ name: 'no id' }]), []);
});
