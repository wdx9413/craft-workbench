/**
 * Rich-data contract: the pages that were empty states during the page audit
 * (approvals, permissions, subscriptions, executors, plugins, memory,
 * knowledge, experience) must render their data and wire their actions once
 * the runtime actually has something to show.
 *
 * These checks run against the mock runtime over real HTTP, so a page that
 * only works with an empty list cannot pass here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from '../scripts/mock-runtime-server.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

async function withServer(run: (base: string) => Promise<void>) {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try { await run(base); } finally { await new Promise((done) => server.close(done)); }
}

test('the inbox serves an open human card plus a learnable rule', async () => {
  await withServer(async (base) => {
    const refresh = await (await fetch(`${base}/api/inbox/refresh`)).json();
    const open = (refresh.cards as Array<{ audience?: string; status?: string }>)
      .filter((card) => (card.audience === 'human' || card.audience === undefined) && card.status === 'open');
    assert.ok(open.length === 1, 'one open human card is present');
    const rules = await (await fetch(`${base}/api/action-gate/rules/all`)).json();
    assert.equal((rules.rules as Array<{ status?: string }>)[0]!.status, 'active');
  });
});

test('deciding an inbox card moves it out of the open list', async () => {
  await withServer(async (base) => {
    const decide = await fetch(`${base}/api/inbox/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'att-1', decision: 'acknowledge' }),
    });
    assert.equal(decide.status, 200);
    const refresh = await (await fetch(`${base}/api/inbox/refresh`)).json();
    const stillOpen = (refresh.cards as Array<{ id?: string; status?: string }>)
      .filter((card) => card.id === 'att-1' && card.status === 'open');
    assert.equal(stillOpen.length, 0, 'an acknowledged card is no longer open');
  });
});

test('L1 and HT metrics are reported together so the page never shows one without the other', async () => {
  await withServer(async (base) => {
    const l1 = await (await fetch(`${base}/api/claims/l1-report`)).json();
    const touchpoints = await (await fetch(`${base}/api/metrics/touchpoints`)).json();
    assert.equal(l1.l1_count + l1.l2_count + l1.l3_count, l1.total_decisions);
    assert.ok(l1.deterministic_checkers > 0, 'L1 ratio pairs with a checker count');
    assert.ok(touchpoints.objects_measured > 0 && touchpoints.total_touchpoints > 0);
    assert.equal(touchpoints.ht_requires_wall_clock, true);
  });
});

test('permissions, subscriptions and executors list data with revocable state', async () => {
  await withServer(async (base) => {
    const grants = await (await fetch(`${base}/api/approval-grants`)).json();
    assert.equal((grants.grants as Array<{ status?: string }>)[0]!.status, 'active');
    const subscriptions = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.ok((subscriptions.subscriptions as unknown[]).length === 1);
    const templates = await (await fetch(`${base}/api/executor-templates`)).json();
    assert.ok((templates.templates as unknown[]).length === 1);
    const profiles = await (await fetch(`${base}/api/supervisor-profiles`)).json();
    assert.ok((profiles.profiles as unknown[]).length === 1);
  });
});

test('context pages list memory, knowledge and experience records', async () => {
  await withServer(async (base) => {
    const memory = await (await fetch(`${base}/api/workbench/memory`)).json();
    assert.equal((memory.items as unknown[]).length, 1);
    const claims = await (await fetch(`${base}/api/workbench/knowledge/claims`)).json();
    const claim = (claims.claims as Array<{ content?: string; evidence_ids?: unknown[] }>)[0]!;
    assert.equal(claim.content, '评审通过前不得合并');
    assert.equal(claim.evidence_ids?.length, 3);
    const workflows = await (await fetch(`${base}/api/workbench/workflows`)).json();
    assert.equal((workflows.items as Array<{ status?: string }>)[0]!.status, 'candidate');
    const proposals = await (await fetch(`${base}/api/workbench/experience/proposals`)).json();
    assert.equal((proposals.items as Array<{ status?: string }>)[0]!.status, 'shadow');
  });
});

test('plugins and workspaces list installed entries the pages render', async () => {
  await withServer(async (base) => {
    const plugins = await (await fetch(`${base}/api/workbench/plugins`)).json();
    assert.equal((plugins.items as Array<{ id?: string }>)[0]!.id, 'craft-context');
    const workspaces = await (await fetch(`${base}/api/workspaces`)).json();
    assert.equal((workspaces.workspaces as Array<{ path?: string }>)[0]!.path, 'D:/documents/project/mytest');
  });
});

test('the task board still reports its seeded tasks and the summary agrees', async () => {
  await withServer(async (base) => {
    const board = await (await fetch(`${base}/api/workbench/task-board`)).json();
    assert.ok((board.order as string[]).length >= 2);
    const summary = await (await fetch(`${base}/api/workbench/summary`)).json();
    assert.equal(summary.totals.tasks, 2);
  });
});

test('an executor template never renders a literal undefined for a missing permission', async () => {
  await withServer(async (base) => {
  const templates = await (await fetch(`${base}/api/executor-templates`)).json();
  const template = (templates.templates as Array<{ permission?: string }>)[0]!;
  assert.ok(template.permission, 'the seeded template carries a permission so the page never says undefined');
  });
});

test('the executor page itself falls back instead of printing undefined', async () => {
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  assert.match(app, /item\.permission \|\| '未指定'/u);
});

test('the browser fallback for choosing a project answers a real path', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/workbench/agent-sessions/pick-project-folder`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(typeof result.path, 'string');
    assert.ok(result.path.length > 0, 'the browser-hosted workbench can proceed without an OS picker');
  });
});

test('mention suggestions return plain file paths without a literal null', async () => {
  await withServer(async (base) => {
    const files = await (await fetch(`${base}/api/workbench/agent-sessions/files?workspace=D:/repo`)).json();
    const items = files.files as Array<{ path?: string; name?: string }>;
    assert.ok(items.length > 0);
    for (const item of items) {
      assert.ok(item.path && item.path !== 'null', 'each suggestion carries a real path');
      assert.ok(item.name && item.name !== 'null', 'each suggestion carries a real name');
    }
  });
});

test('the generic agent-sessions route does not swallow the picker or files paths', async () => {
  await withServer(async (base) => {
    const pick = await (await fetch(`${base}/api/workbench/agent-sessions/pick-project-folder`, { method: 'POST' })).json();
    assert.ok('path' in pick, 'the picker route answers with a path, not an empty link list');
    const files = await (await fetch(`${base}/api/workbench/agent-sessions/files`)).json();
    assert.ok('files' in files, 'the files route answers with a file list, not an empty link list');
  });
});

test('file suggestions narrow to the composer query', async () => {
  await withServer(async (base) => {
    const all = await (await fetch(`${base}/api/workbench/agent-sessions/files?workspace=D:/repo`)).json();
    assert.ok((all.files as unknown[]).length > 1, 'an empty query lists every suggestion');
    const narrowed = await (await fetch(`${base}/api/workbench/agent-sessions/files?workspace=D:/repo&query=cli`)).json();
    const paths = (narrowed.files as Array<{ path?: string }>).map((file) => file.path);
    assert.deepEqual(paths, ['lib/client.js']);
    const none = await (await fetch(`${base}/api/workbench/agent-sessions/files?workspace=D:/repo&query=zzz`)).json();
    assert.equal((none.files as unknown[]).length, 0, 'a non-matching query yields no suggestions');
  });
});

test('the object page renders a grouped rail with a focused adjudication', async () => {
  await withServer(async (base) => {
    const rail = await (await fetch(`${base}/api/objects`)).json();
    const buckets = (rail.rail as Array<{ bucket?: string }>).map((item) => item.bucket);
    assert.deepEqual(buckets.sort(), ['done', 'in_progress', 'needs_you']);
    assert.ok(rail.focus?.adjudication, 'the focus object carries one pending adjudication');
    assert.equal(rail.focus.adjudication.batch_effects, 3);
  });
});

test('a composed decision answers with a rendered control, not an unknown form', async () => {
  await withServer(async (base) => {
    const composed = await (await fetch(`${base}/api/decisions?object_id=obj-1&decision_kind=authorize&summary=x`)).json();
    assert.equal(composed.rendered, true);
    assert.equal(composed.control.renderer, 'comparison');
    assert.ok((composed.control.options as unknown[]).length === 2);
    assert.ok(composed.measurement.estimated_lines > 0);
  });
});

test('the decision page never crashes when a composed answer omits its measurement', async () => {
  // app.js guards the "too big to scan" note with a fallback so a shape that
  // omits `measurement` renders "未知" instead of throwing.
  const app = await readFile(resolve('workbench/app.js'), 'utf8');
  assert.match(app, /\(composed\.measurement \|\| \{\}\)\.estimated_lines \?\? '未知'/u);
});

test('subscription drift distinguishes an active fingerprint from a suspended one', async () => {
  await withServer(async (base) => {
    const drift = await (await fetch(`${base}/api/subscription-drift`)).json();
    const items = drift.subscriptions as Array<{ subscription_id?: string; state?: string; changed_fields?: string[] }>;
    assert.equal(items[0]!.state, 'active');
    assert.equal(items[1]!.state, 'suspended');
    assert.ok((items[1]!.changed_fields as string[]).length > 0, 'a drifted fingerprint names the changed fields');
  });
});

test('relation health separates internal gaps from external references', async () => {
  await withServer(async (base) => {
    const status = await (await fetch(`${base}/api/workbench/codebase/status?workspace_id=ws-1`)).json();
    assert.ok((status.indexes as unknown[]).length === 1, 'the newest index is reported');
    const diagnostics = status.relation_diagnostics;
    const internal = diagnostics.unresolved_type_references + diagnostics.unresolved_heritage
      + diagnostics.unresolved_imports + diagnostics.unresolved_calls;
    assert.equal(internal, diagnostics.unresolved_relations, 'the breakdown adds up to the internal gap total');
    assert.ok(diagnostics.external_references > 0, 'external references are counted separately');
    assert.ok((diagnostics.degraded_languages as string[]).includes('ps1'));
  });
});

test('a Codex session link is available for the composer resume path', async () => {
  await withServer(async (base) => {
    const links = await (await fetch(`${base}/api/workbench/agent-sessions?task_id=t-1`)).json();
    const link = (links.links as Array<{ provider?: string; turn_state?: string }>)[0]!;
    assert.equal(link.provider, 'codex');
    assert.equal(link.turn_state, 'idle');
  });
});

test('the design page serves a draft with its remaining questions and a catalog', async () => {
  await withServer(async (base) => {
    const result = await (await fetch(`${base}/api/workbench/workflow-designs?scope=project:D:/repo`)).json();
    assert.ok((result.question_catalog as unknown[]).length === 4, 'the editor catalog covers every step');
    const draft = (result.designs as Array<{ design: { name?: string }; questions: unknown[] }>)[0]!;
    assert.equal(draft.design.name, '发布检查单');
    assert.equal(draft.questions.length, 3, 'three questions remain unanswered');
  });
});

test('saving a design returns the next question and a handoff brief', async () => {
  await withServer(async (base) => {
    const saved = await (await fetch(`${base}/api/workbench/workflow-designs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'project:D:/repo', name: '发布检查单', answers: { inputs: '变更清单', steps: '按序执行' }, design_id: 'design-1', expected_version: 1 }),
    })).json();
    assert.equal(saved.design.version, 2);
    assert.equal(saved.next_question.key, 'steps');
    assert.match(saved.markdown, /# 发布检查单/u);
  });
});

test('the evaluation history lists a run after it is created', async () => {
  await withServer(async (base) => {
    const before = await (await fetch(`${base}/api/workbench/evaluations`)).json();
    assert.equal((before.runs as unknown[]).length, 0, 'a fresh runtime has no evaluation history');
    await fetch(`${base}/api/workbench/evaluations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ suite: 'self_evolution' }),
    });
    const after = await (await fetch(`${base}/api/workbench/evaluations`)).json();
    const run = (after.runs as Array<{ id?: string; state?: string }>)[0]!;
    assert.equal(run.state, 'running');
    assert.ok(run.id);
  });
});

test('hatching answers with the created object the sheet expects', async () => {
  await withServer(async (base) => {
    const created = await (await fetch(`${base}/api/objects/hatch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'hatch_test', intention: '评估迁移序列化库', object_kind: 'migration' }),
    })).json();
    // The sheet reads result.object.id, not a bare object_id.
    assert.ok(created.object?.id, 'the hatch response carries the created object');
    assert.equal(created.object.title, '评估迁移序列化库');
    assert.equal(created.object.kind, 'migration');
    const rail = await (await fetch(`${base}/api/objects?object_id=${encodeURIComponent(created.object.id)}`)).json();
    assert.equal(rail.focus.id, created.object.id, 'the new object becomes the focused rail entry');
  });
});

test('an evaluation run settles to a completed report under the panel-derived id', async () => {
  await withServer(async (base) => {
    // The panel derives its run id from sha256(operation_id) and polls that id;
    // registering under a different id would strand the run in "结果未知".
    const { createHash } = await import('node:crypto');
    const operation = 'chain-test-op';
    const id = createHash('sha256').update(operation).digest('hex');
    const post = await fetch(`${base}/api/workbench/evaluations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: 'D:/repo', suite: 's.json', subject: 'su.json', runtime: 'r.json', operation_id: operation }),
    });
    assert.equal((await post.json()).id, id, 'the POST acknowledges the panel-derived id');
    const first = await (await fetch(`${base}/api/workbench/evaluations/${id}/events`)).json();
    assert.equal(first.evaluation.state, 'running');
    const second = await (await fetch(`${base}/api/workbench/evaluations/${id}/events`)).json();
    assert.equal(second.evaluation.state, 'completed');
    const report = await (await fetch(`${base}/api/workbench/evaluations/${id}/report`)).json();
    assert.equal(report.report.passed, 2);
    assert.equal((report.report.results as unknown[]).length, 2);
  });
});

test('a running evaluation can be cancelled to a terminal state', async () => {
  await withServer(async (base) => {
    const { createHash } = await import('node:crypto');
    const id = createHash('sha256').update('cancel-chain-op').digest('hex');
    await fetch(`${base}/api/workbench/evaluations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: 'D:/repo', operation_id: 'cancel-chain-op' }),
    });
    const cancelled = await (await fetch(`${base}/api/workbench/evaluations/${id}/cancel`, { method: 'POST', body: '{}' })).json();
    assert.equal(cancelled.evaluation.state, 'cancelled');
    // A cancelled run stays terminal: further polls must not resurrect it.
    const polled = await (await fetch(`${base}/api/workbench/evaluations/${id}/events`)).json();
    assert.equal(polled.evaluation.state, 'cancelled');
  });
});

test('the compare verdict needs two distinct completed runs', async () => {
  await withServer(async (base) => {
    // One completed run cannot form a pair.
    await fetch(`${base}/api/workbench/evaluations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: 'compare-single' }),
    });
    const lone = await (await fetch(`${base}/api/workbench/evaluations/compare`, { method: 'POST', body: '{}' })).json();
    assert.equal(lone.comparison.metrics.status, 'insufficient');
    // Two completed runs form a comparable pair.
    for (const op of ['compare-pair-1', 'compare-pair-2']) {
      const id = createHash('sha256').update(op).digest('hex');
      await fetch(`${base}/api/workbench/evaluations`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: op }),
      });
      await fetch(`${base}/api/workbench/evaluations/${id}/events`);
      await fetch(`${base}/api/workbench/evaluations/${id}/events`);
    }
    const pair = await (await fetch(`${base}/api/workbench/evaluations/compare`, { method: 'POST', body: '{}' })).json();
    assert.equal(pair.comparison.metrics.status, 'comparable');
    assert.equal(pair.comparison.metrics.measured_pairs, 2);
  });
});

test('the knowledge gate requires a retrieval run and reports eligibility', async () => {
  await withServer(async (base) => {
    const missing = await (await fetch(`${base}/api/workbench/evaluations/knowledge-assess`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseline_id: 'b', candidate_id: 'c' }),
    })).json();
    assert.equal(missing.assessment.status, 'ineligible');
    assert.ok(missing.assessment.reasons.length > 0, 'an ineligible verdict names what is missing');
    const eligible = await (await fetch(`${base}/api/workbench/evaluations/knowledge-assess`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ retrieval_run_id: 'run-42', baseline_id: 'b', candidate_id: 'c' }),
    })).json();
    assert.equal(eligible.assessment.status, 'eligible');
    assert.equal(eligible.assessment.retrieval_run_id, 'run-42');
  });
});
