import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', 'workbench');
const read = (name: string) => readFile(path.join(root, name), 'utf8');

test('unavailable usage renders unknown values instead of zero consumption', async () => {
  const source = await read('app.js');
  const start = source.indexOf('      var usageTiles = [');
  const end = source.indexOf('      var modelRows =', start);
  assert.ok(start >= 0 && end > start);
  const rendered = runInNewContext(source.slice(start, end) + ';({tiles: usageTiles, notice: usageNotice})', {
    usage: { unavailable: true }, usageDay: '2027-01-01', usageWeek: '2026-W53',
    periodUsage: () => 0, statTile: (_label: string, value: unknown) => String(value), esc: String,
  });
  assert.equal(rendered.tiles, '—————');
  assert.match(rendered.notice, /统计暂不可用/u);
  const ui = await read('ui.js');
  const tileStart = ui.indexOf('function statTile(');
  const tileEnd = ui.indexOf('function lead(', tileStart);
  const tile = runInNewContext(ui.slice(tileStart, tileEnd) + ';statTile("累计", "—", "db")', { icon: () => '', esc: String });
  assert.match(tile, /<b>—<\/b>/u);
});

test('usage periods select current UTC buckets across an ISO week year boundary', async () => {
  const source = await read('app.js');
  const start = source.indexOf('      var usageNow = new Date();');
  const end = source.indexOf('      var usageTiles = [', start);
  assert.ok(start >= 0 && end > start);
  const result = runInNewContext(`
    const NativeDate = Date;
    Date = class extends NativeDate { constructor(value) { super(value === undefined ? '2027-01-01T12:00:00Z' : value); } };
    ${source.slice(start, end)}
    ({day: usageDay, week: usageWeek,
      current: periodUsage({'2027-01-01': {total_tokens: 4}, '2026-12-31': {total_tokens: 99}}, usageDay),
      absent: periodUsage({'2026-12-31': {total_tokens: 99}}, usageDay),
      empty: periodUsage(undefined, usageDay)})
  `);
  assert.equal(result.day, '2027-01-01');
  assert.equal(result.week, '2026-W53');
  assert.equal(result.current, 4);
  assert.equal(result.absent, 0);
  assert.equal(result.empty, 0);
});

test('the Codex-inspired layer is linked after the base design system', async () => {
  const html = await read('index.html');
  const base = html.search(/href="\.\/app\.css(?:\?[^"]*)?"/u);
  const theme = html.search(/href="\.\/codex-theme\.css(?:\?[^"]*)?"/u);
  assert.ok(base > 0, 'base css is linked');
  assert.ok(theme > base, 'theme is linked after the base so it can override');
});

test('the rail supports a Codex-style icon density without losing labels', async () => {
  const css = await read('app.css');
  assert.match(css, /\[data-rail="icons"\]/u);
  assert.match(css, /\.app\[data-rail="icons"\] \.nav-label/u);
  const rail = await read('rail-nav.js');
  // Icon-only rows still expose the label to assistive tech and tooltips.
  assert.match(rail, /aria-label="' \+ esc\(item\.label\)/u);
  assert.match(rail, /title="' \+ esc\(item\.label\)/u);
});

test('the visual layer defines its typography, palette, atmosphere and motion', async () => {
  const css = await read('codex-theme.css');
  for (const token of ['--cw-display', '--cw-mono', '--cw-sans', '--cw-ember', '--cw-cyan', '--cw-paper', '--cw-signal', '--cw-warn']) {
    assert.ok(css.includes(token + ':'), token);
  }
  assert.match(css, /radial-gradient/u, 'atmospheric background');
  assert.match(css, /@keyframes cw-rise/u, 'page-load motion');
  assert.match(css, /prefers-reduced-motion|@media \(max-width/u);
  assert.match(css, /\.home-agent \.agent-configuration/u, 'Codex-style compact home');
  assert.match(css, /\.mode-btn\[aria-selected="true"\] \.mode-btn-copy/u, 'active-only mode label');
  // The instrument palette must exist in both themes, otherwise a dark theme
  // silently falls back to the light literal.
  const dark = css.slice(css.indexOf('html[data-theme="dark"]'));
  for (const token of ['--cw-signal', '--cw-warn', '--cw-halo', '--cw-grid']) {
    assert.ok(dark.includes(token + ':'), token + ' is declared for the dark theme');
  }
  assert.match(css, /@keyframes cw-pulse/u, 'the live control has its own motion');
  // No remote assets: strict same-origin CSP forbids CDN fonts.
  assert.doesNotMatch(css, /https?:\/\//u);
  assert.doesNotMatch(css, /@import/u);
});

test('app.js imports the extracted deep modules instead of duplicating them', async () => {
  const app = await read('app.js');
  assert.match(app, /from '\.\/ui\.js'/u);
  assert.match(app, /from '\.\/mode-pages\.js'/u);
  assert.doesNotMatch(app, /^  var ICONS = \{/mu);
  assert.doesNotMatch(app, /^  function viewHome\(/mu);
});

test('commands and mentions use separate surfaces, with a visible mode chip', async () => {
  const composer = await read('agent-workspace.js');
  assert.match(composer, /data-role="command-panel"/u);
  assert.match(composer, /agent-command-panel/u);
  assert.match(composer, /data-role="mode-chip"/u);
  assert.match(composer, /function renderCommandPanel/u);
  // The `+` menu must no longer masquerade as a mention token.
  assert.doesNotMatch(composer, /mentionTrigger = '\+'/u);
  const css = await read('app.css');
  assert.match(css, /\.agent-command-panel/u);
  assert.match(css, /\.agent-mode-chip/u);
});

test('the home composer renders exactly one action row and keeps its input visible', async () => {
  const composer = await read('agent-workspace.js');
  // A duplicated toolbar row would render a second send button that bypasses
  // the composer state machine.
  assert.equal((composer.match(/class="agent-compose-actions"/gu) || []).length, 1);
  const css = await read('codex-theme.css');
  // The textarea must not be visually hidden: home is where the user types.
  const labelRule = css.split('\n').find(line => line.includes('.home-agent .agent-compose > label') && line.includes('clip-path: inset'));
  assert.equal(labelRule, undefined, 'the composer label is not clipped away');
  assert.match(css, /\.home-agent \.agent-compose > label \{ position: static;/u);
});

test('tool install and lazy Craft model loading stay wired into the home composer', async () => {
  const css = await read('codex-theme.css');
  // Install/configure must be hidden only by their own `hidden` attribute; a
  // blanket display:none made a missing CLI impossible to install.
  assert.match(css, /data-action="provider-install"\]\[hidden\]/u);
  assert.match(css, /data-action="provider-configure"\]\[hidden\]/u);
  const composer = await read('agent-workspace.js');
  // A built-in Craft option plus a catalog Craft entry must not duplicate.
  assert.match(composer, /hasStaticCraft/u);
  const pages = await read('mode-pages.js');
  // The new-session form must fetch configured models when opened cold.
  assert.match(pages, /loadCraftModels/u);
});

test('every CSS custom property resolves to the design system in both themes', async () => {
  const css = (await read('app.css')) + '\n' + (await read('codex-theme.css'));
  const referenced = [...css.matchAll(/var\((--[a-z0-9-]+)/gu)].map(match => match[1]!);
  const declared = new Set([...css.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:/gmu)].map(match => match[1]!));
  const missing = [...new Set(referenced)].filter(token => !declared.has(token));
  assert.deepEqual(missing, [], 'undefined CSS variables fall back to light-mode literals in dark theme');
});

test('first-run model guidance is not disabled on the desktop shell', async () => {
  const app = await read('app.js');
  // Tauri starts with only a token fragment (no page), so excluding the native
  // shell would make the wizard unreachable. Explicit page navigation must not
  // be interrupted by the wizard.
  assert.doesNotMatch(app, /!nativeDesktop/u);
  assert.match(app, /shouldOfferOnboarding\(models\.length, completed, initialHash, location\.hash, onboarding && onboarding\.skippedAt\)/u);
  assert.match(app, /onboarding\.completedAt/u);
});

test('each mode owns its own new-task entry instead of all jumping to the workshop', async () => {
  const app = await read('app.js');
  assert.match(app, /function openNewTaskForMode\(\)/u);
  assert.match(app, /state\.mode === 'control'[\s\S]*?newSessionDrawer/u, '控制台 opens its own creation form');
  assert.match(app, /state\.mode === 'pilot' \? 'pilot' : 'home'/u, '领航员 stays on its composer');
  assert.doesNotMatch(app, /jump-new-task'\)\.onclick = function \(\) \{ go\('home'\)/u, 'no mode should hard-code the workshop');
});

test('Console distinguishes acknowledgement from authorization for each selected item', async () => {
  const app = await read('app.js');
  const css = await read('app.css');
  // Each selected attention item is acknowledged separately; this is not authorization.
  assert.match(app, /data-approval-check=/u, 'each pending card is selectable');
  assert.match(app, /data-approval-batch="acknowledge"/u, 'batch acknowledge action exists');
  assert.match(app, /data-approval-batch="defer"/u, 'batch defer action exists');
  assert.match(app, /批量标记已阅/u, 'batch acknowledge is described accurately');
  const approvalView = app.split('function viewApprovals() {')[1]!.split('function view', 1)[0]!;
  assert.doesNotMatch(approvalView, /批量批准|批准并记住|已批准/u, 'attention acknowledgement must not claim authorization');
  assert.doesNotMatch(approvalView, /\/api\/approval-grants/u, 'acknowledging attention must not create an approval grant');
  assert.match(approvalView, /标记已阅不会批准/u, 'users can tell that action still needs approval');
  assert.match(approvalView, /data-attention-task=/u, 'cards with a task provide a task link');
  assert.match(approvalView, /openTask\(.*data-attention-task/u, 'task link opens the associated task');
  // The batch handler maps the selected ids and calls the single-card decide
  // endpoint once per id (not a merged decision): assert both facts co-exist.
  assert.match(app, /Promise\.allSettled\(ids\.map\(function \(id\)[\s\S]*?\/api\/inbox\/decide/u, 'batch decides each item individually');
  // Partial failure must be reported by count and still repaint, not abort the whole batch.
  assert.match(app, /项失败需重试/u, 'partial failures are surfaced');
  // The selection must survive repaints but drop cards that are no longer open.
  assert.match(app, /state\.approvalSelection/u, 'selection is held across repaints');
  assert.match(css, /\.approval-check\b/u, 'checkbox has styling');
  assert.match(css, /\.approval-batch\b/u, 'batch bar has styling');
  assert.doesNotMatch(css, /https?:\/\//u, 'no remote assets');
});

test('mode switch retains the current mounted page and does not dispatch work', async () => {
  const app = await read('app.js');
  const switchBody = app.split('function setMode(mode) {')[1]!.split('// ------------------------------------------------------------------- render')[0]!;
  assert.match(switchBody, /state\.mode = mode/u);
  assert.match(switchBody, /paintNav\(\)/u);
  assert.match(switchBody, /selected\.focus\(\)/u);
  assert.doesNotMatch(switchBody, /location\.|paint\(|api\(|confirm\(/u);
  assert.match(app, /aria-label="' \+ esc\(m\.label\)/u);
});

test('task details show shared handoff snapshots as historical facts', async () => {
  const app = await read('app.js');
  const taskView = app.split('function viewTask(ticket) {')[1]!.split('// ------------------------------------------------------------- capabilities')[0]!;
  assert.match(taskView, /detail\.task_handoffs/u);
  assert.match(taskView, /交接快照/u);
  assert.match(taskView, /esc\(label\(STATUS_LABELS, handoff\.state_status/u);
  assert.match(taskView, /esc\(label\(handoffActors, handoff\.next_actor/u);
  assert.match(taskView, /esc\(String\(handoff\.state_version/u);
  assert.match(taskView, /历史快照/u);
  assert.match(taskView, /data-handoff-run=/u);
  assert.match(taskView, /\/api\/task-runs\/.*\/handoff/u);
  assert.match(taskView, /任务状态不会因此改变/u);
  assert.match(taskView, /待核对运行/u);
  assert.match(taskView, /esc\(handoff\.unlinked_host_run_refs\.map/u);
  assert.match(taskView, /关联已有运行/u);
  assert.match(taskView, /\/reconcile-host/u);
  assert.match(taskView, /state\.page === 'task' && state\.selectedTask === taskId/u, 'late handoff responses must not navigate away from another page');
});

test('reconcile action submits the pinned versions and reports success or drift', async () => {
  const app = await read('app.js');
  const section = app.split("root.querySelectorAll('[data-reconcile-run]')")[1]!;
  const body = section.split('button.onclick = function () {')[1]!.split('\n            };')[0]!;
  const attrs: Record<string, string> = { 'data-reconcile-run': 'run/1', 'data-reconcile-host': 'host-1', 'data-run-version': '2', 'data-launch-version': '3', 'data-host-version': '4' };
  const button = { disabled: false, getAttribute: (key: string) => attrs[key] };
  const calls: Array<{ path: string; request: unknown }> = [];
  const notices: string[] = [];
  const handler = new Function('button', 'api', 'toast', 'operatorOf', 'state', 'taskId', 'paint', body);
  handler(button, (path: string, request: unknown) => { calls.push({ path, request }); return Promise.resolve({}); }, (message: string) => notices.push(message), () => 'user', { page: 'task', selectedTask: 't' }, 't', () => {});
  await new Promise(setImmediate);
  assert.deepEqual(calls[0], { path: '/api/task-runs/run%2F1/reconcile-host', request: { method: 'POST', body: { host_run_id: 'host-1', task_run_version: 2, launch_version: 3, host_run_version: 4, actor: 'user' } } });
  assert.match(notices[0], /已关联已有运行/u);
  button.disabled = false;
  handler(button, () => Promise.reject(new Error('版本变化')), (message: string) => notices.push(message), () => 'user', { page: 'task', selectedTask: 't' }, 't', () => {});
  await new Promise(setImmediate);
  assert.equal(button.disabled, false);
  assert.match(notices.at(-1) ?? '', /重新生成交接快照.*版本变化/u);
});

test('handoff failure explains the error and restores the button without reporting success', async () => {
  const app = await read('app.js');
  const section = app.split("root.querySelectorAll('[data-handoff-run]')")[1]!;
  const body = section.split('button.onclick = function () {')[1]!.split('\n            };')[0]!;
  const notices: Array<{ message: string; bad: boolean }> = [];
  const button = { disabled: false, getAttribute: () => 'missing' };
  const api = () => Promise.reject(new Error('Unknown task_run: missing'));
  const toast = (message: string, bad = false) => notices.push({ message, bad });
  const handler = new Function('button', 'api', 'toast', 'state', 'taskId', 'paint', body);
  handler(button, api, toast, { page: 'task', selectedTask: 'task' }, 'task', () => assert.fail('failure must not repaint as success'));
  assert.equal(button.disabled, true);
  await new Promise(setImmediate);
  assert.equal(button.disabled, false);
  assert.deepEqual(notices, [{ message: '生成交接快照失败：Unknown task_run: missing', bad: true }]);
  notices.length = 0;
  handler(button, () => Promise.reject('网络中断'), toast, { page: 'task', selectedTask: 'task' }, 'task', () => assert.fail());
  await new Promise(setImmediate);
  assert.equal(button.disabled, false);
  assert.deepEqual(notices, [{ message: '生成交接快照失败：网络中断', bad: true }]);
});

test('task without runs explains the handoff empty state without an action', async () => {
  const app = await read('app.js');
  assert.match(app, /还没有可生成交接快照的运行/u);
});

test('new-session permission default comes from the persisted workbench settings', async () => {
  const app = await read('app.js');
  assert.match(app, /settings\.workbench && settings\.workbench\.defaultPermission/u, 'reads config default');
  assert.match(app, /permissionMap\[configured\]/u, 'maps ask/auto/full into task permission modes');
  assert.match(app, /state\.composer\.permission = permissionMap\[configured\]/u, 'seeds the composer');
});

test('task acceptance controls submit versioned rechecks and human evidence with recovery on errors', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  for (const kind of ['review', 'recheck']) {
    const marker = kind === 'review' ? '[data-review-plan]' : '[data-recheck-plan]';
    const next = kind === 'review' ? '[data-recheck-plan]' : '[data-retry-task-run]';
    const start = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('" + marker + "')");
    const end = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('" + next + "')", start);
    assert.ok(start > 0 && end > start);
    for (const fail of [false, true]) {
      const calls: any[] = [];
      const notices: any[] = [];
      let renders = 0;
      const attrs: Record<string, string> = { 'data-review-plan': 'plan/one', 'data-recheck-plan': 'plan/one', 'data-plan-version': '3', 'data-review-criterion': 'quality', 'data-review-result': 'failed' };
      const button: any = { disabled: false, getAttribute: (name: string) => attrs[name] };
      runInNewContext(source.slice(start, end), {
        root: { querySelectorAll: () => [button] }, window: { prompt: () => '  checked actual file  ' }, operatorOf: () => 'user:alex',
        api: async (url: string, options: unknown) => { calls.push({ url, options: JSON.parse(JSON.stringify(options)) }); if (fail) throw new Error('stale version'); },
        toast: (...args: unknown[]) => notices.push(args), state: { page: 'task' }, renderPage: () => renders++, encodeURIComponent,
      });
      button.onclick();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls[0].url, '/api/acceptance-plans/plan%2Fone/' + (kind === 'review' ? 'human-review' : 'recheck'));
      assert.equal(calls[0].options.body.plan_version, 3);
      if (kind === 'review') assert.deepEqual(calls[0].options.body, { plan_version: 3, criterion_id: 'quality', result: 'failed', reviewer: 'user:alex', summary: 'checked actual file' });
      assert.equal(renders, fail ? 0 : 1);
      assert.equal(button.disabled, !fail);
      if (fail) assert.match(notices[0][0], /stale version/);
    }
  }
});

test('task verdict presents the current acceptance round instead of an old passed outcome', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('      var verdictCard;');
  const end = source.indexOf('      var artifactRows', start);
  const rendered = runInNewContext(source.slice(start, end) + ';verdictCard', {
    detail: { acceptance_plans: [{ id: 'plan', version: 4, name: 'Current round', status: 'pending', receipts: [{ receipt: { report_path: 'probe.json', source_sha256: 'abc123', source_bytes: 42 } }], human_criteria: [{ id: 'owner', name: 'Owner review' }] }] },
    outcomes: [{ verdict: 'passed', summary: 'Old successful output' }],
    taskCard: (title: string, subtitle: string, body: string) => title + subtitle + body,
    esc: String, label: (labels: any, key: string, fallback: string) => labels[key] || fallback, STATUS_LABELS: { pending: '待验收' },
  });
  assert.match(rendered, /待验收/);
  assert.match(rendered, /data-plan-version="4"/);
  assert.match(rendered, /重新验收/);
  assert.match(rendered, /确认通过/);
  assert.match(rendered, /记录未通过/);
  assert.match(rendered, /查看本轮验收依据/);
  assert.match(rendered, /probe.json/);
  assert.match(rendered, /SHA-256 abc123 · 42 字节/);
  assert.doesNotMatch(rendered, /Old successful output/);
});

test('acceptance provenance distinguishes file receipts and historical missing evidence', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('      var verdictCard;');
  const end = source.indexOf('      var artifactRows', start);
  for (const receipt of [null, { sha256: 'filehash', size_bytes: 0 }, { sha256: 'legacyhash' }]) {
    const rendered = runInNewContext(source.slice(start, end) + ';verdictCard', {
      detail: { acceptance_plans: [{ id: 'plan', version: 2, status: 'passed', receipts: [{ receipt }] }] }, outcomes: [],
      taskCard: (_title: string, _subtitle: string, body: string) => body,
      esc: String, label: (_labels: any, key: string) => key, STATUS_LABELS: {},
    });
    if (receipt === null) assert.match(rendered, /历史回执未保留文件摘要/);
    else {
      assert.match(rendered, new RegExp('SHA-256 ' + receipt.sha256));
      assert.equal(rendered.includes('0 字节'), 'size_bytes' in receipt);
    }
  }
});


test('task view makes unconfirmed process cleanup visible', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('      var recoverableRuns =');
  const end = source.indexOf('      var activity', start);
  for (const uncertain of [false, true]) {
    const rendered = runInNewContext(source.slice(start, end) + ';cleanupCard', { hostRuns: [{ id: 'run', version: 2, cleanup_unconfirmed: uncertain }], esc: String, taskCard: (...parts: string[]) => parts.join('') });
    if (uncertain) { assert.match(rendered, /执行清理待确认/); assert.match(rendered, /恢复前须确认原执行端停止/); }
    else assert.equal(rendered, '');
  }
  for (const status of ['running', 'cancel_requested', 'interrupted', 'completed', 'failed']) {
    for (const stopped of [false, true]) {
      const rendered = runInNewContext(source.slice(start, end) + ';cleanupCard', { hostRuns: [{ id: 'orphan', version: 3, host: 'internal', status, ...(stopped ? { stopped_confirmation: { actor: 'user:owner' } } : {}) }], esc: String, taskCard: (...parts: string[]) => parts.join('') });
      if (!stopped && ['running', 'cancel_requested', 'interrupted'].includes(status)) assert.match(rendered, /data-recover-host-run="orphan"/);
      else assert.equal(rendered, '');
    }
  }
});


test('scoped cleanup recovery requires an explicit checkbox and posts the selected version and operator', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-recover-host-run]')");
  const end = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-review-plan]')", start);
  for (const scenario of ['unchecked', 'success', 'stale', 'already-recovered']) {
    const calls: any[] = [], notices: any[] = [];
    let renders = 0;
    const button: any = { disabled: false, getAttribute: (name: string) => name === 'data-recover-host-run' ? 'run/one' : '7', closest: () => ({ querySelector: () => ({ checked: scenario !== 'unchecked' }) }) };
    runInNewContext(source.slice(start, end), {
      root: { querySelectorAll: () => [button] }, encodeURIComponent, operatorOf: () => 'user:owner', state: { page: 'task' },
      api: async (url: string, options: any) => { calls.push({ url, options: JSON.parse(JSON.stringify(options)) }); if (scenario === 'stale') throw new Error('version changed'); return { count: scenario === 'already-recovered' ? 0 : 1 }; },
      toast: (...args: unknown[]) => notices.push(args), renderPage: () => renders++,
    });
    button.onclick();
    await new Promise(resolve => setImmediate(resolve));
    if (scenario === 'unchecked') { assert.equal(calls.length, 0); assert.match(notices[0][0], /请先确认/); }
    else {
      assert.deepEqual(calls[0], { url: '/api/host-runs/run%2Fone/recover', options: { method: 'POST', body: { run_version: 7, confirmed_original_runner_stopped: true, actor: 'user:owner' } } });
      assert.equal(renders, scenario === 'stale' ? 0 : 1);
      assert.equal(button.disabled, scenario !== 'stale');
      if (scenario === 'stale') assert.match(notices[0][0], /version changed/);
    }
  }
});


test('task retry keeps one attempt id and instruction when retrying an uncertain request', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-retry-task-run]')");
  const end = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-start-task-run]')", start);
  const calls: any[] = [], notices: any[] = [];
  let prompts = 0, ids = 0, renders = 0;
  const attrs: any = { 'data-retry-task-run': 'run/source', 'data-run-version': '3', 'data-launch-version': '4', 'data-host-version': '5' };
  const button: any = { disabled: false, getAttribute: (name: string) => attrs[name] };
  runInNewContext(source.slice(start, end), {
    root: { querySelectorAll: () => [button] }, window: { prompt: () => { prompts++; return '  revised instruction  '; }, crypto: { randomUUID: () => { ids++; return 'fixed-id'; } } }, operatorOf: () => 'user:owner', encodeURIComponent, state: { page: 'task' },
    api: async (url: string, options: any) => { calls.push({ url, options: JSON.parse(JSON.stringify(options)) }); if (calls.length === 1) throw new Error('network result unknown'); return {}; },
    toast: (...args: unknown[]) => notices.push(args), renderPage: () => renders++,
  });
  button.onclick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.disabled, false); assert.equal(renders, 0);
  button.onclick(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], { url: '/api/task-runs/run%2Fsource/retry', options: { method: 'POST', body: { new_task_run_id: 'retry_fixed-id', prompt: 'revised instruction', actor: 'user:owner', task_run_version: 3, launch_version: 4, host_run_version: 5 } } });
  assert.equal(prompts, 1); assert.equal(ids, 1); assert.equal(renders, 1); assert.equal(button.disabled, true);
  assert.match(notices[0][0], /相同请求重试/);
});

test('task retry controls cancel cleanly and do not submit without a supported id generator', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-retry-task-run]')");
  const end = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-start-task-run]')", start);
  for (const prompt of [null, '', '   ', 'valid']) {
    for (const crypto of [undefined, {}]) {
      let submitted = false;
      const notices: string[] = [];
      const button: any = { disabled: false };
      runInNewContext(source.slice(start, end), { root: { querySelectorAll: () => [button] }, window: { prompt: () => prompt, crypto }, toast: (message: string) => notices.push(message), api: () => { submitted = true; }, state: {}, operatorOf: () => 'user:owner' });
      button.onclick();
      assert.equal(submitted, false); assert.equal(button.disabled, false);
      if (prompt === 'valid') assert.match(notices[0], /无法生成尝试编号/);
      else assert.equal(notices.length, 0);
    }
  }
});

test('handoff retry controls link the successor and never duplicate an existing attempt', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('      var handoffRows =');
  const end = source.indexOf('      var evidenceRows', start);
  for (const scenario of ['recoverable', 'already-retried', 'unknown', 'missing-host']) {
    const rendered = runInNewContext(source.slice(start, end) + ';handoffRows', {
      handoffs: [{ task_run_id: 'source', task_run_version: 3, state_status: scenario === 'unknown' ? 'result_unknown' : 'recovery', launch_ref: { version: 4 }, host_run_ref: scenario === 'missing-host' ? null : { version: 5 } }],
      handoffRuns: [],
      taskRetries: scenario === 'already-retried' ? [{ task_run_id: 'source', new_task_run_id: 'next' }] : [],
      esc: String, label: (_labels: any, value: string, fallback: string) => value || fallback, STATUS_LABELS: {}, handoffActors: {}, handoffActions: {},
    });
    assert.equal(rendered.includes('data-retry-task-run'), scenario === 'recoverable');
    if (scenario === 'already-retried') assert.match(rendered, /新尝试 next/);
  }
});

test('model billing UI requires explicit confirmation, amount and reference, including explicit zero', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-reconcile-model-cost]')");
  const end = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-recover-host-run]')", start);
  for (const scenario of ['unchecked', 'blank', 'negative', 'infinite', 'no-reference', 'zero', 'paid', 'stale', 'background', 'overrun-unchecked', 'overrun']) {
    const calls: any[] = [], notices: any[] = [];
    let renders = 0;
    const amount = scenario === 'blank' ? ' ' : scenario === 'negative' ? '-1' : scenario === 'infinite' ? 'Infinity' : scenario === 'zero' ? '0' : scenario.startsWith('overrun') ? '0.02' : '0.000004';
    const row = { querySelector: (name: string) => name === '[data-confirm-billing]' ? { checked: scenario !== 'unchecked' } : name === '[data-confirm-overrun]' ? { checked: scenario === 'overrun' } : { value: name === '[data-billed-usd]' ? amount : scenario === 'no-reference' ? ' ' : ' simulated-invoice:001 ' } };
    const attrs: any = { 'data-reconcile-model-cost': 'dispatch/one', 'data-dispatch-version': '7', 'data-reservation-id': 'call_1', 'data-reservation-version': '3', 'data-reserved-usd': '0.000022' };
    const button: any = { disabled: false, closest: () => row, getAttribute: (name: string) => attrs[name] };
    runInNewContext(source.slice(start, end), {
      root: { querySelectorAll: () => [button] }, encodeURIComponent, operatorOf: () => 'user:owner', state: { page: scenario === 'background' ? 'home' : 'task' },
      api: async (url: string, options: any) => { calls.push({ url, options: JSON.parse(JSON.stringify(options)) }); if (scenario === 'stale') throw new Error('billing version changed'); return {}; },
      toast: (...args: unknown[]) => notices.push(args), renderPage: () => renders++,
    });
    button.onclick(); await new Promise(resolve => setImmediate(resolve));
    const valid = ['zero', 'paid', 'stale', 'background', 'overrun'].includes(scenario);
    assert.equal(calls.length, valid ? 1 : 0);
    if (valid) {
      assert.deepEqual(calls[0], { url: '/api/model-dispatches/dispatch%2Fone/reconcile-cost', options: { method: 'POST', body: { dispatch_version: 7, reservation_id: 'call_1', reservation_version: 3, actual_usd: scenario === 'zero' ? 0 : scenario === 'overrun' ? 0.02 : 0.000004, confirmed_overrun: scenario === 'overrun', billing_reference: 'simulated-invoice:001', confirmed_billing: true, actor: 'user:owner' } } });
      assert.equal(button.disabled, scenario !== 'stale');
      assert.equal(renders, scenario === 'paid' || scenario === 'zero' || scenario === 'overrun' ? 1 : 0);
      if (scenario === 'stale') assert.match(notices[0][0], /占额继续保留.*version changed/);
    } else { assert.equal(button.disabled, false); assert.equal(renders, 0); }
  }
});

test('billing cards keep zero holds pending and label reconciliations as operator reports', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('      var billingHolds =');
  const end = source.indexOf('      var pending =', start);
  const render = (detail: any) => runInNewContext(source.slice(start, end) + ';billingCard', { detail, esc: String, taskCard: (...parts: string[]) => parts.join('') });
  assert.equal(render({}), '');
  const pending = render({ model_cost_holds: [{ dispatch_id: 'd', dispatch_version: 2, reservation_id: 'r', reservation_version: 3, reserved_usd: 0 }] });
  assert.match(pending, /0 USD（仍待对账）/); assert.match(pending, /不会自动结算为零/); assert.match(pending, /data-dispatch-version="2"/);
  const history = render({ model_cost_reconciliations: [{ actual_usd: 0, confirmed_overrun: true, actor: 'user:owner', billing_reference: 'invoice:001', reservation_id: 'call_1', dispatch_id: 'dispatch_1' }, { actual_usd: 0.000004, actor: 'user:other' }] });
  assert.match(history, /人工报告 0 USD/); assert.match(history, /invoice:001/); assert.match(history, /历史账单引用未保留/); assert.match(history, /原模型用量记录不改写/); assert.match(history, /call_1 · 派发 dispatch_1/); assert.match(history, /历史请求编号未保留/);
});


test('task lifecycle controls expose pause, observation resume and cancellation without replaying execution', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('      var handoffControls =');
  const end = source.indexOf('      var handoffActors =', start);
  for (const lifecycle of ['active', 'paused', 'cancelled']) {
    const html = runInNewContext(source.slice(start, end) + ';handoffControls', { handoffRuns: [{ id: 'run', version: 5, lifecycle }], esc: String });
    assert.equal(html.includes('data-task-lifecycle="pause"'), lifecycle === 'active');
    assert.equal(html.includes('data-task-lifecycle="resume"'), lifecycle === 'paused');
    assert.equal(html.includes('data-task-lifecycle="cancel"'), lifecycle !== 'cancelled');
    assert.match(html, /data-run-version="5"/);
    assert.match(html, /生成交接快照/);
    const exhausted = runInNewContext(source.slice(start, end) + ';handoffControls', { handoffRuns: [{ id: 'run', version: 5, lifecycle, retry_policy: { retries_used: 3, max_retries: 3, exhausted: true } }], esc: String });
    assert.match(exhausted, /返工 3 \/ 3/);
    assert.match(exhausted, /补充证据并重新规划/);
  }
});

test('task lifecycle buttons submit the displayed version and recover after errors', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-task-lifecycle]')");
  const end = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-handoff-run]')", start);
  for (const scenario of ['pause', 'resume', 'cancel', 'dismiss', 'blank', 'stale', 'network', 'background']) {
    const action = scenario === 'resume' || scenario === 'cancel' ? scenario : 'pause';
    const calls: any[] = [], notices: any[] = [];
    let renders = 0;
    const attrs: any = { 'data-task-lifecycle': action, 'data-task-run': 'run/one', 'data-run-version': '5' };
    const button: any = { disabled: false, getAttribute: (name: string) => attrs[name] };
    runInNewContext(source.slice(start, end), {
      root: { querySelectorAll: () => [button] }, state: { page: scenario === 'background' ? 'home' : 'task' }, encodeURIComponent,
      prompt: () => scenario === 'dismiss' ? null : scenario === 'blank' ? '  ' : '  review scope  ', operatorOf: () => 'user:owner',
      api: async (url: string, options: any) => { calls.push({ url, options }); if (scenario === 'stale') throw new Error('version changed'); if (scenario === 'network') throw 'offline'; },
      toast: (...args: unknown[]) => notices.push(args), renderPage: () => renders++,
    });
    button.onclick(); await new Promise(resolve => setImmediate(resolve));
    const submitted = scenario !== 'dismiss' && scenario !== 'blank';
    assert.equal(calls.length, submitted ? 1 : 0);
    if (submitted) {
      assert.equal(calls[0].url, '/api/task-runs/run%2Fone/' + action);
      assert.equal(calls[0].options.body.task_run_version, 5);
      assert.equal(calls[0].options.body.reason, action === 'resume' ? undefined : 'review scope');
    }
    if (scenario === 'stale' || scenario === 'network') { assert.equal(button.disabled, false); assert.match(notices[0][0], /操作失败/); assert.equal(renders, 0); }
    else if (submitted) { assert.equal(button.disabled, true); assert.equal(renders, scenario === 'background' ? 0 : 1); }
  }
});


test('task assignment card offers only current handoffs and the recorded owner controls', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('      var taskAssignment =');
  const end = source.indexOf('      var billingHolds =', start);
  for (const owner of [null, 'user:me', 'user:other']) for (const fresh of [false, true]) {
    const html = runInNewContext(source.slice(start, end) + ';assignmentCard', {
      detail: { task_assignment: owner ? { owner, status: 'active', version: 3, task_run_id: 'run' } : null }, operatorOf: () => 'user:me',
      handoffs: [{ id: 'handoff', version: 2, task_run_id: 'run', task_run_version: 4, next_actor: 'human', assignment_ref: owner ? { version: 3 } : null }], handoffRuns: [{ id: 'run', version: fresh ? 4 : 5, lifecycle: 'active' }], taskRetries: [], esc: String, taskCard: (...parts: string[]) => parts.join(''),
    });
    assert.equal(html.includes('data-task-assignment="claim"'), !owner && fresh);
    assert.equal(html.includes('data-task-assignment="transfer"'), owner === 'user:me' && fresh);
    assert.equal(html.includes('data-task-assignment="release"'), owner === 'user:me');
    assert.match(html, /不会启动执行或授予权限/);
  }
});

test('assignment buttons preserve the same request after failure and never start work', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-task-assignment]')");
  const end = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-task-lifecycle]')", start);
  for (const scenario of ['claim', 'release', 'transfer', 'dismiss', 'empty', 'recipient-empty', 'recipient-self', 'failed', 'string-error', 'background']) {
    const action = scenario.startsWith('recipient') ? 'transfer' : ['release', 'transfer'].includes(scenario) ? scenario : 'claim';
    const prompts = action === 'transfer' ? [scenario === 'recipient-empty' ? '' : scenario === 'recipient-self' ? 'user:me' : ' user:next ', ' reason '] : [scenario === 'dismiss' ? null : scenario === 'empty' ? ' ' : ' reason '];
    const calls: any[] = [], notices: any[] = [];
    let renders = 0, ids = 0;
    const attrs: any = { 'data-task-assignment': action, 'data-assignment-run': 'run/one', 'data-assignment-version': '3', 'data-assignment-handoff': 'handoff', 'data-assignment-handoff-version': '2' };
    const button: any = { disabled: false, getAttribute: (name: string) => attrs[name] };
    runInNewContext(source.slice(start, end), {
      root: { querySelectorAll: () => [button] }, operatorOf: () => 'user:me', encodeURIComponent, state: { page: scenario === 'background' ? 'home' : 'task' },
      window: { prompt: () => prompts.shift(), crypto: { randomUUID: () => { ids++; return 'fixed'; } } },
      api: async (url: string, options: any) => { calls.push({ url, options: JSON.parse(JSON.stringify(options)) }); if (scenario === 'failed') throw new Error('version changed'); if (scenario === 'string-error') throw 'offline'; },
      toast: (...args: any[]) => notices.push(args), renderPage: () => renders++,
    });
    button.onclick(); await new Promise(resolve => setImmediate(resolve));
    const submitted = !['dismiss', 'empty', 'recipient-empty', 'recipient-self'].includes(scenario);
    assert.equal(calls.length, submitted ? 1 : 0);
    if (!submitted) { assert.equal(button.disabled, false); continue; }
    assert.equal(calls[0].url, '/api/task-runs/run%2Fone/assignment');
    const body = calls[0].options.body;
    assert.equal(body.actor, 'user:me'); assert.equal(body.assignment_version, 3); assert.equal(body.request_id, 'assignment_fixed'); assert.equal(body.reason, 'reason');
    assert.equal(body.handoff_id, action === 'release' ? undefined : 'handoff');
    assert.equal(body.recipient, action === 'transfer' ? 'user:next' : undefined);
    if (scenario === 'failed' || scenario === 'string-error') {
      assert.equal(button.disabled, false); assert.equal(renders, 0); assert.match(notices[0][0], /相同请求重试/);
      button.onclick(); await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(calls[0], calls[1]); assert.equal(ids, 1);
    } else { assert.equal(button.disabled, true); assert.equal(renders, scenario === 'background' ? 0 : 1); }
  }
});

test('frozen review UI distinguishes producer, independent reviewer and historical findings', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('      var workReviews ='), end = source.indexOf('      var pending =', start);
  for (const scenario of ['reviewer', 'producer', 'owner', 'reported', 'empty']) {
    const report = scenario === 'reported' ? { result: 'failed', summary: 'Frozen report', findings: [{ severity: 'blocker', path: 'result.txt', message: 'Fix bytes' }, { severity: 'suggestion', path: 'result.txt', message: 'Improve wording' }] } : null;
    const html = runInNewContext(source.slice(start, end) + ';workReviewCard', { detail: { work_reviews: scenario === 'empty' ? [] : [{ id: 'candidate', version: 1, actor: 'worker', plan_version: 4, files: [{ path: 'result.txt', sha256: 'digest' }], report }] }, operatorOf: () => scenario === 'producer' ? 'worker' : 'reviewer', assignmentActive: scenario === 'owner', taskAssignment: { owner: 'reviewer' }, esc: String, taskCard: (...parts: string[]) => parts.join('') });
    assert.equal(html.includes('data-report-review='), scenario === 'reviewer');
    if (scenario === 'reported') { assert.match(html, /阻塞缺陷/); assert.match(html, /建议/); }
    if (scenario !== 'empty') assert.match(html, /下载冻结内容/); else assert.equal(html, '');
  }
});

test('freeze buttons preserve exact source versions and one candidate id across network retries', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-freeze-review]')"), end = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-download-review]')", start);
  for (const scenario of ['success', 'failure', 'no-paths', 'no-criterion', 'risk-default']) {
    const calls: any[] = []; let renders = 0, prompts = 0;
    const attrs: any = { 'data-freeze-review': 'run/one', 'data-default-review-criterion': scenario === 'risk-default' ? 'risk_independent_review' : '', 'data-run-version': '2', 'data-launch-version': '3', 'data-host-version': '4', 'data-plan-version': '5' };
    const button: any = { disabled: false, getAttribute: (name: string) => attrs[name] };
    runInNewContext(source.slice(start, end), { root: { querySelectorAll: () => [button] }, operatorOf: () => 'worker', encodeURIComponent, state: { page: 'task' }, renderPage: () => renders++, toast: () => {}, window: { prompt: () => ++prompts === 1 ? scenario === 'no-paths' ? null : ' result.txt\n extra.bin ' : scenario === 'no-criterion' ? ' ' : ' review ', crypto: { randomUUID: () => 'fixed' } }, api: async (url: string, options: any) => { calls.push({ url, options: JSON.parse(JSON.stringify(options)) }); if (scenario === 'failure') throw new Error('offline'); } });
    button.onclick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, scenario.startsWith('no-') ? 0 : 1);
    if (calls.length) { assert.equal(calls[0].url, '/api/task-runs/run%2Fone/freeze-review'); assert.deepEqual(calls[0].options.body, { candidate_id: 'review_fixed', actor: 'worker', relative_paths: ['result.txt', 'extra.bin'], criterion_id: scenario === 'risk-default' ? 'risk_independent_review' : 'review', task_run_version: 2, launch_version: 3, host_run_version: 4, plan_version: 5 }); }
    if (scenario === 'failure') { assert.equal(button.disabled, false); button.onclick(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls[0], calls[1]); assert.equal(prompts, 2); }
    assert.equal(renders, scenario === 'success' || scenario === 'risk-default' ? 1 : 0);
    if (scenario === 'risk-default') assert.equal(prompts, 1);
  }
});

test('review reports classify findings and never allow a passing verdict with blockers', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-report-review]')"), end = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-task-assignment]')", start);
  for (const scenario of ['passed', 'failed', 'blocked', 'pass-blocker', 'fail-empty', 'no-summary', 'network']) {
    const calls: any[] = [], notices: any[] = []; let renders = 0;
    const result = scenario === 'pass-blocker' ? 'passed' : scenario === 'fail-empty' ? 'failed' : ['failed', 'blocked'].includes(scenario) ? scenario : 'passed';
    const file = { getAttribute: () => 'result.txt', querySelector: (name: string) => ({ value: name === '[data-review-blockers]' && ['failed', 'pass-blocker'].includes(scenario) ? ' blocker ' : name === '[data-review-suggestions]' ? ' suggestion ' : '' }) };
    const attrs: any = { 'data-report-review': 'candidate/one', 'data-candidate-version': '1', 'data-review-result': result };
    const button: any = { disabled: false, getAttribute: (name: string) => attrs[name], closest: () => ({ querySelectorAll: () => [file] }) };
    runInNewContext(source.slice(start, end), { root: { querySelectorAll: () => [button] }, operatorOf: () => 'reviewer', encodeURIComponent, state: { page: 'task' }, renderPage: () => renders++, toast: (...args: any[]) => notices.push(args), window: { prompt: () => scenario === 'no-summary' ? null : ' review basis ' }, api: async (url: string, options: any) => { calls.push({ url, options: JSON.parse(JSON.stringify(options)) }); if (scenario === 'network') throw 'offline'; } });
    button.onclick(); await new Promise(resolve => setImmediate(resolve));
    const submitted = !['pass-blocker', 'fail-empty', 'no-summary'].includes(scenario);
    assert.equal(calls.length, submitted ? 1 : 0);
    if (submitted) { assert.equal(calls[0].url, '/api/work-reviews/candidate%2Fone/report'); assert.equal(calls[0].options.body.reviewer, 'reviewer'); assert.equal(calls[0].options.body.result, result); assert.equal(calls[0].options.body.findings.at(-1).severity, 'suggestion'); }
    if (scenario === 'network') { assert.equal(button.disabled, false); button.onclick(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls[0], calls[1]); }
    assert.equal(renders, submitted && scenario !== 'network' ? 1 : 0);
  }
});

test('frozen downloads use returned immutable bytes and surface integrity failures', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-download-review]')"), end = source.indexOf("          Array.prototype.forEach.call(root.querySelectorAll('[data-report-review]')", start);
  for (const failed of [false, true]) {
    let clicked = false; const notices: any[] = [], link: any = { click: () => { clicked = true; } };
    const button: any = { getAttribute: (name: string) => name === 'data-review-path' ? 'dir/result.txt' : 'candidate' };
    runInNewContext(source.slice(start, end), { root: { querySelectorAll: () => [button] }, encodeURIComponent, document: { createElement: () => link }, toast: (...args: any[]) => notices.push(args), api: async (url: string) => { assert.equal(url, '/api/work-reviews/candidate?relative_path=dir%2Fresult.txt'); if (failed) throw new Error('integrity'); return { file: { content_base64: 'cmVhZHk=' } }; } });
    button.onclick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(clicked, !failed); if (!failed) { assert.equal(link.download, 'result.txt'); assert.equal(link.href, 'data:application/octet-stream;base64,cmVhZHk='); } else assert.match(notices[0][0], /integrity/);
  }
});

test('frozen review criteria hide direct human pass buttons', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('      var verdictCard;'), end = source.indexOf('      var artifactRows', start);
  const html = runInNewContext(source.slice(start, end) + ';verdictCard', { detail: { acceptance_plans: [{ id: 'plan', version: 4, status: 'pending', human_criteria: [{ id: 'review', name: 'Independent review', frozen_review_required: true }] }] }, outcomes: [], taskCard: (...parts: string[]) => parts.join(''), esc: String, label: (_labels: any, key: string) => key, STATUS_LABELS: {} });
  assert.match(html, /须通过冻结候选的独立审查/);
  assert.doesNotMatch(html, /data-review-plan=/);
  assert.match(html, /data-recheck-plan=/);
});

test('task controls show cumulative spend, unknown exposure and the fixed total deadline', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('      var handoffControls ='), end = source.indexOf('      var handoffActors =', start);
  for (const monetary of [false, true]) {
    const html = runInNewContext(source.slice(start, end) + ';handoffControls', { handoffRuns: [{ id: 'run', version: 1, lifecycle: 'active', attempt_budget: { total_budget_usd: monetary ? 1 : null, spent_usd: 0.8, reserved_usd: 0.2, remaining_usd: 0, unknown_reservations: monetary ? 1 : 0, deadline_at: '2030-01-01T00:00:00.000Z', exhausted: true } }], esc: String });
    assert.match(html, /2030-01-01T00:00:00.000Z/);
    assert.match(html, /已耗尽，停止新派发/);
    if (monetary) { assert.match(html, /0.8 已用/); assert.match(html, /0.2 占额/); assert.match(html, /未知费用须对账/); }
    else assert.match(html, /未设美元总额/);
  }
});
