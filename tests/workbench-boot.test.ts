import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from '../scripts/mock-runtime-server.mjs';
import { staticSurface } from '../scripts/mock-runtime-server.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// The boot gate blocks an unauthenticated browser tab only when the runtime
// actually demands a token. A reachable open runtime (mock servers, dev
// previews) must keep booting; a token-gated one must show "未授权".
async function withServer(run: (base: string) => Promise<void>) {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally {
    await new Promise((done) => server.close(done));
  }
}

test('health is served without a token so boot can distinguish reachability', async () => {
  await withServer(async (base) => {
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
  });
});

test('an open runtime answers summary without a token and boot continues', async () => {
  await withServer(async (base) => {
    const summary = await fetch(base + '/api/workbench/summary');
    assert.equal(summary.status, 200);
    assert.ok((await summary.json()).totals);
  });
});

test('a token-gated runtime answers summary with 401 and boot reports unauthorized', async () => {
  await withServer(async (base) => {
    const summary = await fetch(base + '/api/workbench/summary?requireToken=1');
    assert.equal(summary.status, 401);
    assert.deepEqual(await summary.json(), { error: 'Workbench token required' });
  });
});

test('app.js gates unauthorized on a live 401 instead of the mere absence of a token', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  assert.match(app, /api\('\/api\/workbench\/summary'\)\.then\(function \(\) \{/u);
  assert.match(app, /status === 401/u);
  assert.match(app, /CONNECTION\.unauthorized/u);
  assert.match(app, /CONNECTION\.failed/u);
  // The page must not blanket-block every browser tab before asking the runtime.
  assert.doesNotMatch(app, /if \(!state\.token && !\(window\.__TAURI__ && window\.__TAURI__\.core\)\) \{\s*\$\('content'\)\.innerHTML/u);
});

test('desktop startup failures keep the window available and show actionable real-runtime guidance', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  const shell = await readFile(resolve('desktop/src-tauri/src/lib.rs'), 'utf8');
  assert.match(shell, /Err\(error\) => \{\s*eprintln!\("Craft Workbench runtime startup failed: \{error\}"\);\s*\(None, None, Some\(startup_failure_message\(\)\)\)/u);
  assert.match(shell, /fn workbench_startup_error\(/u);
  assert.match(shell, /workbench_startup_error, entry_window_mode/u);
  assert.match(app, /runDesktopStartupGate\(window\.__TAURI__\.core\.invoke/u);
  assert.match(app, /function showRuntimeStartupFailure\(message\)/u);
  assert.match(app, /runDesktopStartupGate\(window\.__TAURI__\.core\.invoke, continueBoot, showRuntimeStartupFailure\)/u);
  assert.match(app, /不会切换到模拟数据/u);
});

test('the Workbench identifies Mock data without guessing when runtime provenance is unavailable', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  const html = await readFile(resolve('workbench/index.html'), 'utf8');
  assert.match(html, /id="runtime-source-badge"/u);
  assert.match(app, /api\('\/api\/runtime-info'\)\.then\(paintRuntimeSource\)/u);
  assert.match(app, /info\.source !== 'craft' && info\.source !== 'mock'/u);
  assert.match(app, /Mock 演示数据/u);
  assert.match(app, /Craft 真实数据/u);
});

test('a user theme choice invalidates any older plugin theme lookup', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  assert.match(app, /function rememberPluginTheme\(theme, source, workspaceId, persist, pluginId\) \{\s*\/\/ A user choice or reset supersedes any theme lookup already in flight\.\s*pluginThemeCheck \+= 1;/u);
});

test('home task submission reuses task and message ids after an uncertain response', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  assert.match(app, /submitTaskAttempt\(\{ composer: state\.composer, body: body, prompt: prompt, crypto: window\.crypto, api: api \}\)/u);
  const submission = await readFile(resolve('workbench/task-submission.js'), 'utf8');
  assert.match(submission, /body\.task_id = composer\.submission\.taskId/u);
  assert.match(submission, /body: \{ content: prompt, message_id: messageId \}/u);
  assert.match(submission, /outcome_unknown === true/u);
  assert.match(submission, /Workbench 不会重复发送/u);
});

test('static surface still resolves every app.js import after the boot change', async () => {
  const surface = await staticSurface();
  assert.ok(surface.imports.length >= 20, 'app.js keeps its extracted deep modules');
  assert.ok(surface.assets.includes('index.html'));
});
