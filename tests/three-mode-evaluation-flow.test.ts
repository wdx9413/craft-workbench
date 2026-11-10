// V3 · 上下文与自进化可视 — real HTTP integration across mock runtime.
//
// 用真实 node:http mock 服务（scripts/mock-runtime-server.mjs）驱动一条完整
// 链路：观察室读共享证据 → 评测提交/事件/报告读回 → Context 审计回执，
// 并验证"报告状态不可被客户端伪造"。不依赖已安装 craft 包或真实 Host。
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
  const response = await fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  });
  assert.equal(response.status, 200);
  return response.json();
};

test('V3: 观察室 / 评测 / Context 审计 读同一 Runtime 合同且报告不可伪造', async () => {
  await withServer(async (base) => {
    // 观察室：四类共享证据都在同一服务上可读回
    const [mods, failures, outcomes, discoveries] = await Promise.all([
      get(base, '/api/workbench/mods/list'),
      get(base, '/api/workbench/pilot/failure-observations'),
      get(base, '/api/workbench/pilot/outcomes'),
      get(base, '/api/workbench/plugin-discovery/list'),
    ]);
    assert.equal(mods.items[0].name, 'no-hardcode');
    assert.equal(failures.items.length, 1);
    assert.equal(outcomes.total, 2);
    assert.ok(Array.isArray(discoveries.items));

    // 评测：提交后事件与报告都绑定同一个 run id，状态由服务端给，不靠客户端自报
    const created = await post(base, '/api/workbench/evaluations', { subject: 'candidate-v1' });
    assert.match(created.id, /^eval-/u);
    assert.equal(created.state, 'running');
    const events = await get(base, `/api/workbench/evaluations/${created.id}/events`);
    assert.equal(events.evaluation.id, created.id);
    const report = await get(base, `/api/workbench/evaluations/${created.id}/report`);
    assert.equal(report.report, null, 'running run has no report yet');

    // 客户端不能通过 POST 自选状态把自己标成 passed
    const forged = await post(base, '/api/workbench/evaluations', { state: 'passed', verdict: 'promote' });
    assert.equal(forged.state, 'running', 'server assigns state, client claim is ignored');

    // Context 审计：回执状态如实标记，不把 inconclusive 当 passed
    const audit = await post(base, '/api/workbench/context-audits', { operation_id: 'op-1' });
    assert.equal(audit.status, 'inconclusive');
    assert.equal(audit.integrity, 'verified_against_saved_report');
  });
});

test('V3: 评测列表与观察室共享同一个 mock 服务实例的状态', async () => {
  await withServer(async (base) => {
    const before = await get(base, '/api/workbench/evaluations');
    assert.equal(before.runs.length, 0);
    await post(base, '/api/workbench/evaluations', { suite: 'self_evolution' });
    await post(base, '/api/workbench/evaluations', { suite: 'codebase-retrieval' });
    const after = await get(base, '/api/workbench/evaluations');
    assert.equal(after.runs.length, 2);
    // 观察室仍可读回同一实例的共享真值（没有被评测写入破坏）
    const outcomes = await get(base, '/api/workbench/pilot/outcomes');
    assert.equal(outcomes.counts.accepted, 1);
  });
});
