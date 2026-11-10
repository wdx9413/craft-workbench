// V1 · mock 运行时服务的真实 HTTP 冒烟（工程门可验证证据）。
// 启动真实 node:http 服务，断言 /api/workbench/* 与静态入口可用；
// 不依赖已安装 craft 包，也不写 ~/.craft_data。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { selfTest, createMockServer } from '../scripts/mock-runtime-server.mjs';

test('V1 mock runtime HTTP self-test covers task/mods/pilot/static entry', async () => {
  const checks = await selfTest();
  assert.equal(checks, 5);
});

test('settings API exposes a minimal document so the Workbench never crashes on a fresh profile', async () => {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/settings`);
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(typeof value.workbench, 'object');
    assert.equal(typeof value.locale, 'string');
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('mock runtime identifies itself and never presents its fixture root as a user data directory', async () => {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/runtime-info`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { source: 'mock', version: 'fixture', dataRoot: 'mock://fixtures' });
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('mock memory fixture contains a labeled relationship for the visual graph', async () => {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/workbench/resources?kind=memory&limit=100`);
    assert.equal(response.status, 200);
    const value = await response.json() as { items: Array<{ conflict_peers?: Array<{ id: string; content: string }> }> };
    assert.deepEqual(value.items[0]?.conflict_peers?.map(({ id, content }) => ({ id, content })), [
      { id: 'mem-2', content: '紧急发布可跳过全量回归' },
    ]);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('start:mock launches the UI and prints a reachable fixture URL', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> };
  assert.equal(manifest.scripts['start:mock'], 'node scripts/mock-runtime-server.mjs');
  const child = spawn(process.execPath, ['scripts/mock-runtime-server.mjs'], {
    env: { ...process.env, MOCK_RUNTIME_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', chunk => { stderr += chunk; });
  try {
    const started = await new Promise<{ url: string; output: string }>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`mock server did not start: ${stderr}`)), 5_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', chunk => {
        output += chunk;
        const match = /打开 (http:\/\/127\.0\.0\.1:\d+\/)\n/u.exec(output);
        if (match) { clearTimeout(timer); resolve({ url: match[1]!, output }); }
      });
    });
    assert.match(started.output, /不会连接或修改 Craft 用户数据/u);
    const info = await fetch(new URL('/api/runtime-info', started.url));
    assert.equal(info.status, 200);
    assert.deepEqual(await info.json(), { source: 'mock', version: 'fixture', dataRoot: 'mock://fixtures' });
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>(resolve => child.once('close', () => resolve()));
  }
});

test('provider discovery exposes installable CLIs so tool install can be exercised end to end', async () => {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/workbench/agent-sessions/providers`);
    assert.equal(response.status, 200);
    const value = await response.json() as { providers: Array<{ id: string; status: string; install_url?: string }> };
    const byId = Object.fromEntries(value.providers.map(provider => [provider.id, provider]));
    assert.equal(byId.craft.status, 'available');
    for (const id of ['codex', 'claude', 'dsh']) {
      assert.equal(byId[id].status, 'not_found');
      assert.ok(byId[id].install_url);
    }
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('V1 mock runtime rejects path traversal and invalid JSON body', async () => {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // URL normalization turns plain /../ into a 404 (no file outside workbench/ is served).
    const normalized = await fetch(`${base}/../package.json`);
    assert.equal(normalized.status, 404);
    // An encoded traversal that survives normalization hits the explicit 403 guard.
    const traversal = await fetch(`${base}/..%2fpackage.json`);
    assert.equal(traversal.status, 403);
    const badBody = await fetch(`${base}/api/workbench/task-board`, { method: 'POST', body: '{' });
    assert.equal(badBody.status, 400);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
