// V4 · 扩展生态与主动服务 — real HTTP integration against mock runtime.
//
// 覆盖 NEEDREAD §8/§13 的本仓可验证合同：统一扩展清单、消息批量治理
// （逐项回执、不把草稿当已发送）、主动服务三开关独立、默认不全开。
// 真实生态适配 / IMAP / 远端云电脑仍属 🔴，不由此测试冒充。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockServer } from '../scripts/mock-runtime-server.mjs';

async function withServer(run) {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await run(base); } finally { await new Promise((done) => server.close(done)); }
}
const get = async (base, path) => {
  const response = await fetch(base + path);
  assert.equal(response.status, 200);
  return response.json();
};
const post = async (base, path, body) => {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  assert.equal(response.status, 200);
  return response.json();
};

test('V4: 统一扩展清单按格式/状态/范围登记，激活不自动全局启用', async () => {
  await withServer(async (base) => {
    const list = await get(base, '/api/workbench/extensions/list');
    assert.equal(list.items.length, 2);
    assert.deepEqual(list.items.map((i) => i.format), ['skill', 'mcp']);
    assert.ok(list.items.every((i) => i.scope !== 'global'), 'binding is scoped, not auto-global');
    const activated = await post(base, '/api/workbench/extensions/activate', { id: 'ext-2' });
    assert.equal(activated.activated, 'ext-2');
    assert.equal(activated.ok, true);
  });
});

test('V4: 消息批量标记已读逐项回执，未读筛选随状态变化', async () => {
  await withServer(async (base) => {
    const before = await get(base, '/api/workbench/messages/list?unread_only=true');
    assert.equal(before.items.length, 2);
    const batch = await post(base, '/api/workbench/messages/batch', { action: 'read', ids: ['msg-1', 'msg-2'] });
    assert.equal(batch.affected, 2);
    assert.deepEqual(batch.partial_failures, []);
    const after = await get(base, '/api/workbench/messages/list?unread_only=true');
    assert.equal(after.items.length, 0);
    // 智能处理是独立动作，草稿 / 标记已读都不等于已发送或已派发
    const intent = await post(base, '/api/workbench/messages/process-intent', { id: 'msg-1' });
    assert.equal(intent.dispatched, false);
  });
});

test('V4: 主动服务提醒/准备/执行三个开关独立，默认不自动执行', async () => {
  await withServer(async (base) => {
    const defaults = await get(base, '/api/workbench/proactive/settings');
    assert.equal(defaults.reminder, true);
    assert.equal(defaults.prepare, false);
    assert.equal(defaults.execute, false, 'execution is off by default');
    // 只打开 prepare，不应连带打开 execute
    const updated = await post(base, '/api/workbench/proactive/settings', { prepare: true });
    assert.equal(updated.prepare, true);
    assert.equal(updated.execute, false, 'opening prepare must not grant execution');
    assert.equal(updated.reminder, true, 'reminder stays independently true');
    const reread = await get(base, '/api/workbench/proactive/settings');
    assert.deepEqual(reread, updated);
  });
});
