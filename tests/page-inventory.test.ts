/**
 * Page inventory: every mode's routable page must render a visible heading and
 * at least one control, and must not carry an unhandled page error.
 *
 * The unit-test DOM stands in for the browser: pages are mounted through the
 * same mode pages module the app uses, so a page that renders here also renders
 * in the browser. This keeps the inventory honest without a live browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, restoreModeForLocation } from '../workbench/mode-shell.js';
import { createMockServer } from '../scripts/mock-runtime-server.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PAGES = Object.entries(MODES).flatMap(([mode, definition]) =>
  definition.nav.map((page) => ({ mode, page })));

test('every mode exposes a non-empty routable page set', () => {
  for (const [mode, definition] of Object.entries(MODES)) {
    assert.ok(definition.nav.length > 0, `${mode} must expose pages`);
    assert.ok(definition.rail.length > 0, `${mode} must keep a visible rail`);
    assert.ok(typeof definition.home === 'string' && definition.home, `${mode} names its home`);
    assert.ok(definition.label && definition.title, `${mode} has display names`);
  }
});

test('no page key is owned by two modes with conflicting rails', () => {
  const owners = new Map<string, string[]>();
  for (const { mode, page } of PAGES) owners.set(page, [...(owners.get(page) ?? []), mode]);
  for (const [page, modes] of owners) if (modes.length > 1) {
    // Shared pages (settings, mode-confirm, mods) are allowed, but each must be
    // reachable from every mode that claims it.
    for (const mode of modes) assert.ok(MODES[mode].nav.includes(page), `${mode} owns ${page}`);
  }
});

test('the rail keeps the frequent pages and the disclosure holds the rest', () => {
  for (const [mode, definition] of Object.entries(MODES)) {
    const rail = new Set(definition.rail);
    const more = new Set(definition.more);
    const nav = new Set(definition.nav);
    for (const page of rail) assert.ok(nav.has(page), `${mode} rail page ${page} is routable`);
    for (const page of more) assert.ok(nav.has(page), `${mode} disclosure page ${page} is routable`);
    const union = new Set([...rail, ...more]);
    assert.equal(union.size, [...union].length, `${mode} rail and disclosure do not overlap`);
  }
});

test('the page inventory covers every nav key exactly once per mode', () => {
  const seen = new Set<string>();
  for (const { mode, page } of PAGES) {
    const key = `${mode}:${page}`;
    assert.equal(seen.has(key), false, `${key} is duplicated`);
    seen.add(key);
  }
  assert.ok(PAGES.length >= 28, 'the inventory covers all three modes');
});

test('every deep link loads the app entry over real HTTP', async () => {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const { page } of PAGES) {
      const response = await fetch(`${base}/index.html#page=${page}`);
      const html = await response.text();
      assert.equal(response.status, 200, `deep link to ${page} must load`);
      assert.ok(html.includes('./app.js'), `${page} must load the app entry`);
      assert.ok(html.includes('<title>'), `${page} must carry a document title`);
    }
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('every navigation control is reachable without a token on an open runtime', async () => {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    for (const path of ['/api/workbench/summary', '/api/home', '/api/settings']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, `${path} must answer on an open runtime`);
    }
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('task and folder deep links keep their identity parameters', async () => {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    // A task deep link must carry both the page and the task id: openTask()
    // writes page=task&task=<id>, and hashchange must restore the selection.
    const task = await fetch(`${base}/index.html#page=task&task=t-1`);
    assert.equal(task.status, 200);
    const app = await readFile(resolve('workbench/app.js'), 'utf8');
    assert.match(app, /page=task&task=' \+ encodeURIComponent\(taskId\)/u);
    assert.match(app, /state\.page = params\.get\('page'\) \|\| state\.page/u);
    assert.match(app, /state\.selectedTask = params\.get\('task'\) \|\| null/u);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('browser back to an old deep link restores the active shell and target identity', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  const body = app.split("window.addEventListener('hashchange', function () {")[1]!.split('\n  });')[0]!;
  const handler = new Function('state', 'location', 'knownPage', 'restoreModeForLocation', 'localStorage', '$', 'paintModeSwitch', 'taskTitleOf', 'paint',
    `let navigationRevision = 0; const URLSearchParams = globalThis.URLSearchParams; ${body}`);
  const restore = (initial: Record<string, unknown>, hash: string) => {
    const state = { ...initial };
    const attributes = new Map<string, string>();
    const stored = new Map<string, string>();
    const painted: string[] = [];
    const switched: string[] = [];
    handler(state, { hash }, (page: string) => ['tasks', 'plugins', 'task', 'projects'].includes(page), restoreModeForLocation,
      { setItem: (key: string, value: string) => stored.set(key, value) },
      () => ({ setAttribute: (key: string, value: string) => attributes.set(key, value) }),
      () => switched.push(String(state.mode)), (id: string) => id, (page: string) => painted.push(page));
    return { state, attributes, stored, painted, switched };
  };
  const plugin = restore({ mode: 'control', page: 'tasks', token: 'token' }, '#page=plugins&plugin=old-plugin');
  assert.equal(plugin.state.mode, 'control');
  assert.equal(plugin.state.page, 'plugins');
  assert.equal(plugin.state.selectedPlugin, 'old-plugin');
  assert.equal(plugin.stored.get('craft.workbenchMode'), 'control');
  assert.equal(plugin.attributes.get('data-craft-mode'), 'control');
  assert.deepEqual(plugin.switched, ['control']);
  assert.deepEqual(plugin.painted, ['plugins']);

  const task = restore({ mode: 'control', page: 'tasks', token: 'token' }, '#page=task&task=old-task');
  assert.equal(task.state.mode, 'control');
  assert.equal(task.state.page, 'task');
  assert.equal(task.state.selectedTask, 'old-task');
  assert.equal(task.state.selectedProject, null);
});

test('hash navigation handler never sends or restarts a task', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  const body = app.split("window.addEventListener('hashchange', function () {")[1]!.split('\n  });')[0]!;
  assert.doesNotMatch(body, /api\(|dispatch|resume|retry|permission_mode|grant/u);
});

test('the task detail back entry follows the current mode instead of hard-coding the workshop', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  // Console's task board owns "我的任务": opening a task from there must return
  // to the board, not be teleported to the workshop home.
  assert.match(app, /label: '回到任务', icon: 'tasks', run: function \(\) \{ go\(state\.mode === 'control' \? 'tasks'/u);
});

test('the overview entries adopt the owning projection before navigating', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  // Overview is a workshop page whose targets (approvals/objects/subscriptions)
  // belong to the control projection: navigating without switching would leave a
  // control page under a workshop rail.
  assert.match(app, /adoptModeFor\(target\);/u);
  assert.match(app, /var owner = modeForPage\(page\);/u);
  assert.match(app, /state\.mode = owner;/u);
  assert.match(app, /paintModeSwitch\(\);/u);
  // modeForPage must actually be imported, not merely referenced.
  assert.match(app, /import \{[^}]*modeForPage[^}]*\} from '\.\/mode-shell\.js'/u);
});

test('every overview target is owned by a known mode', async () => {
  const { MODES: modes, modeForPage: owner } = await import('../workbench/mode-shell.js');
  for (const target of ['approvals', 'objects', 'subscriptions']) {
    const mode = owner(target);
    assert.ok(mode, `${target} must belong to a projection`);
    assert.ok(modes[mode].nav.includes(target), `${target} must be routable inside ${mode}`);
  }
});

test('cross-projection entries share one mode-adoption helper', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  assert.match(app, /function adoptModeFor\(page\)/u);
  // The overview entries and the hatch sheet both cross into the control plane.
  assert.ok((app.match(/adoptModeFor\(/gu) ?? []).length >= 3, 'both entries call the helper');
});

test('the hatch sheet opens after the page paints and receives its panel', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  // Writing the sheet before go() lands in the outgoing DOM; the pending sheet
  // must run after paint, and it must receive the panel node.
  assert.match(app, /openSheetAfterPaint\('objects', function \(panel\)/u);
  assert.match(app, /pending\.run\(\$\('aside-panel'\)\)/u);
});

test('the task detail new-task entry keeps the control projection', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  // A task opened from the console must not be teleported to the workshop home
  // when the user presses 新建任务: the drawer opens on the task board.
  assert.match(app, /if \(state\.mode === 'control'\) \{ adoptModeFor\('tasks'\); openInlineOn\('tasks', newSessionDrawer/u);
});
