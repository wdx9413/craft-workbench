// V1.3 / V1.4 · 静态交付面真实 HTTP 核对。
// 从 app.js 解析全部相对 ESM import 与 index.html 的本地资源引用，
// 逐个经 mock 服务的真实 HTTP 端口读回，验证整条启动链可达且类型正确。
// 不替代 Tauri 窗口人工冒烟，但把"静态交付面"从文本断言提升为运行证据。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockServer, staticSurface } from '../scripts/mock-runtime-server.mjs';

const expectedType = (file) => file.endsWith('.js')
  ? 'application/javascript; charset=utf-8'
  : file.endsWith('.css') ? 'text/css; charset=utf-8'
    : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';

test('static surface lists the entry, every app.js import and linked assets', async () => {
  const surface = await staticSurface();
  assert.ok(surface.assets.includes('index.html'));
  assert.ok(surface.assets.includes('app.js'));
  assert.ok(surface.imports.length >= 20, 'app.js keeps its extracted deep modules');
  assert.ok(surface.imports.includes('folder-tree.js'));
  assert.ok(surface.imports.includes('select-options.js'));
  assert.ok(surface.links.includes('app.css'));
  assert.ok(surface.links.includes('codex-theme.css'));
});

test('every static asset is served over real HTTP with the right content type', async () => {
  const surface = await staticSurface();
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const asset of surface.assets) {
      const response = await fetch(`${base}/${asset}`);
      assert.equal(response.status, 200, `${asset} must be reachable`);
      assert.equal(response.headers.get('content-type'), expectedType(asset), `${asset} content-type`);
      const body = await response.text();
      assert.ok(body.length > 0, `${asset} must not be empty`);
    }
    // the HTML entry really points at the served module entry
    const index = await (await fetch(`${base}/index.html`)).text();
    assert.match(index, /<script type="module" src="\.\/app\.js">/u);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('static delivery still refuses traversal while serving the full chain', async () => {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const traversal = await fetch(`${base}/..%2fpackage.json`);
    assert.equal(traversal.status, 403);
    const missing = await fetch(`${base}/definitely-not-an-asset.js`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
