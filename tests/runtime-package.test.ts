import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { resolveRuntime, prepareSidecar } from '../scripts/runtime-package.mjs';

test('installed runtime resolves without a sibling checkout and prepares the public sidecar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-package-'));
  const saved = process.env.CRAFT_RUNTIME_ROOT;
  delete process.env.CRAFT_RUNTIME_ROOT;
  try {
    await writeFile(join(root, 'package.json'), '{}');
    const directory = join(root, 'node_modules/craft');
    await mkdir(join(directory, 'dist/core'), { recursive: true });
    const manifest = { name: 'craft', version: '1.2.3', type: 'module', craftRuntime: { protocolVersion: 1 }, exports: { './package.json': './package.json', './runtime-artifact': './dist/core/runtime-artifact.js' } };
    const save = () => writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
    await save();
    await writeFile(join(directory, 'dist/core/cli.js'), '');
    await writeFile(join(directory, 'dist/core/runtime-artifact.js'), 'export async function prepareRuntimeArtifact(runtime, node, root) { return {runtime, node, root}; }');
    const runtime = await resolveRuntime({ root });
    assert.equal(runtime.version, '1.2.3');
    const sidecar = await prepareSidecar(root);
    assert.equal(sidecar.root, root); assert.equal(sidecar.runtime, runtime.directory);
    assert.equal((await resolveRuntime({ root, sourceRoot: directory })).directory, runtime.directory);
    await assert.rejects(resolveRuntime({ root, sourceRoot: 'relative' }), /absolute/);
    manifest.name = 'wrong'; await save();
    await assert.rejects(resolveRuntime({ root }), /not the Craft/);
    manifest.name = 'craft'; manifest.craftRuntime.protocolVersion = 2; await save();
    await assert.rejects(resolveRuntime({ root }), /incompatible/);
  } finally {
    if (saved === undefined) delete process.env.CRAFT_RUNTIME_ROOT; else process.env.CRAFT_RUNTIME_ROOT = saved;
    await rm(root, { recursive: true, force: true });
  }
});

test('the installed runtime declares fixed mandatory peers for its Claude SDK', async () => {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('craft/package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  const runtimeRequire = createRequire(packagePath);
  const sdk = JSON.parse(await readFile(join(dirname(runtimeRequire.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json'), 'utf8'));
  for (const name of Object.keys(sdk.peerDependencies)) {
    if (sdk.peerDependenciesMeta?.[name]?.optional === true) continue;
    assert.equal(typeof manifest.dependencies[name], 'string', `runtime must declare ${name}`);
    assert.match(manifest.dependencies[name], /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, `${name} must have an exact version`);
  }
});

test('the installed public runtime inventories legacy project data without changing it', async () => {
  const { CraftStore, CraftService, craftPaths } = await import('craft/runtime');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workbench-public-runtime-')));
  const store = await new CraftStore(craftPaths(join(root, 'data'))).open();
  try {
    const service = new CraftService(store);
    service.scopeAliasBind({ scope_kind: 'project', scope_id: 'legacy', alias_kind: 'path', alias: root });
    store.create('project_identity', 'legacy', { canonical_scope: { kind: 'project', id: 'legacy' }, local_path_alias: root });
    const memory = store.create('memory_ledger', 'old-memory', { scope: { kind: 'project', id: 'legacy' }, content: 'private package fixture body', status: 'active' });
    const plan = service.scopeIdentityResolveProject({ project_root: root, action: 'plan_registry_migration' });
    const applied = service.scopeIdentityResolveProject({ project_root: root, action: 'apply_registry_migration', expected_digest: plan.plan_digest, legacy_scope_id: 'legacy' });
    const migration = applied.migration as Record<string, unknown>;
    const page = service.scopeIdentityResolveProject({ project_root: root, action: 'inventory_project_data', migration_id: migration.id, limit: 1 });
    assert.deepEqual((page.records as Record<string, unknown>[]).map(row => [row.kind, row.id]), [['memory_ledger', 'old-memory']]);
    assert.equal(page.data_migrated, false); assert.equal(page.has_more, false);
    assert.equal(page.partition_content_verified, false); assert.doesNotMatch(JSON.stringify(page), /private package fixture body/);
    assert.deepEqual(store.get('memory_ledger', 'old-memory'), memory);
    assert.equal(service.scopeIdentityResolveProject({ project_root: root, action: 'restore_registry', migration_id: migration.id }).registry_restored, true);
    assert.deepEqual(store.get('memory_ledger', 'old-memory'), memory);
    assert.equal(store.list('task_message', 10).length, 0);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('the installed CLI serves recovery assets, reconciles an input and executes its pinned evaluator over HTTP', async () => {
  const { CraftStore, craftPaths } = await import('craft/runtime');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workbench-installed-recovery-')));
  const store = await new CraftStore(craftPaths(root)).open();
  try {
    store.create('task', 'task', {});
    store.create('workbench_agent_session_link', 'link', { task_id: 'task', provider: 'codex', native_session_id: 'native', turn_state: 'idle', workspace: root, permission: 'ask' });
    store.create('workbench_message_queue', 'pending', { task_id: 'task', link_id: 'link', operation_id: 'pending', state: 'unknown', sequence: 1, prompt: 'private installed fixture' });
  } finally { store.close(); }
  const require = createRequire(import.meta.url), packagePath = require.resolve('craft/package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  const cli = join(dirname(packagePath), manifest.bin.craft);
  const child = spawn(process.execPath, [cli, 'serve', '--port', '0', '--parent-stdin', '--workbench-dir', join(import.meta.dirname, '..', 'workbench')], { env: { ...process.env, CRAFT_DATA_DIR: root }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = new Promise<void>(resolve => child.once('exit', () => resolve()));
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let ownedAdapter: number | undefined;
  const ps = (pid: number, field: string) => { try { return execFileSync('ps', ['-p', String(pid), '-o', field + '='], { encoding: 'utf8', timeout: 1_000 }).trim(); } catch { return ''; } };
  try {
    const ready = new Promise<URL>((resolve, reject) => {
      let output = '';
      let errors = '';
      child.stdout.on('data', bytes => {
        output = (output + String(bytes)).slice(-64 * 1024);
        const line = /^Craft API: (.+)\r?\n/m.exec(output);
        if (line) { try { resolve(new URL(line[1])); } catch { reject(new Error('invalid CLI startup address')); } }
      });
      child.stderr.on('data', bytes => { errors = (errors + String(bytes)).slice(-8_192); });
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`CLI exited before readiness (code ${String(code)}): ${errors.trim() || 'no stderr output'}`)));
      deadline = setTimeout(() => reject(new Error('CLI startup did not become ready')), 20_000);
    });
    const address = await ready;
    clearTimeout(deadline);
    for (const path of ['/queue-recovery.js', '/workbench/queue-recovery.js']) {
      const asset = await fetch(new URL(path, address)); assert.equal(asset.status, 200);
      assert.match(await asset.text(), /export function appendQueueRecovery/);
    }
    const token = new URLSearchParams(address.hash.slice(1)).get('token'); assert.ok(token);
    const target = new URL('/api/workbench/agent-sessions/link/queue-reconcile', address);
    const headers = { authorization: 'Bearer ' + token, origin: address.origin, 'content-type': 'application/json' };
    const inspect = await fetch(target, { method: 'POST', headers, body: JSON.stringify({ task_id: 'task', item_id: 'pending', expected_version: 1, action: 'inspect' }) });
    assert.equal(inspect.status, 200); assert.equal((await inspect.json() as Record<string, unknown>).outcome, 'unknown');
    const discard = await fetch(target, { method: 'POST', headers, body: JSON.stringify({ task_id: 'task', item_id: 'pending', expected_version: 1, action: 'discard' }) });
    assert.equal(discard.status, 200); assert.equal((await discard.json() as Record<string, unknown>).outcome, 'discarded');
    const workspace = join(root, 'project'); await mkdir(workspace);
    const suite = join(root, 'suite.json'), subject = join(root, 'subject.json'), runtime = join(root, 'runtime.json');
    const code = process.platform === 'win32' ? 'process.exit(0)' : "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},3000)'],{stdio:['ignore','inherit','inherit']});child.unref();";
    // The case exits immediately, so the timeout only has to outlast a cold
    // `node -e` start. One second is not enough when the whole suite runs in
    // parallel on Windows, which surfaced as a spurious `passed 0`.
    await writeFile(suite, JSON.stringify({ schema: 'craft-eval.eval.v1', suite_id: 'installed-worker', subject_kind: 'software', partition: 'development', sanitized: true, cases: [{ id: 'one', argv: [process.execPath, '-e', code], timeout_s: 20, checks: [{ id: 'exit', kind: 'exit_code', equals: 0 }] }] }));
    await writeFile(subject, JSON.stringify({ kind: 'software', id: 'installed-worker', version: '1' }));
    await writeFile(runtime, JSON.stringify(Object.fromEntries(['environment_digest', 'budget_digest', 'host_digest', 'model_digest', 'tools_digest'].map(key => [key, 'fixed']))));
    const base = new URL('/api/workbench/evaluations', address);
    const submitted = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ operation_id: 'installed-worker', workspace, suite, subject, runtime }) });
    assert.equal(submitted.status, 202);
    const { evaluation: { id } } = await submitted.json() as { evaluation: { id: string } };
    let record: Record<string, unknown> = {};
    const completedBy = Date.now() + 8_000;
    do {
      const status = await fetch(new URL(`${base.pathname}/${id}`, address), { headers });
      assert.equal(status.status, 200);
      record = (await status.json() as { evaluation: Record<string, unknown> }).evaluation;
      if (['completed', 'failed', 'cancelled', 'unknown'].includes(String(record.state))) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < completedBy);
    assert.equal(record.state, 'completed', JSON.stringify(record));
    assert.equal(record.evaluator_version, '0.5.0');
    const report = await fetch(new URL(`${base.pathname}/${id}/report`, address), { headers });
    assert.equal(report.status, 200);
    const result = await report.json() as { report: { passed: number }; integrity: string };
    assert.equal(result.report.passed, 1); assert.equal(result.integrity, 'verified_against_controlled_run');
    if (process.platform !== 'win32') {
      const identity = join(root, 'crash-owned.json'), starts = join(root, 'crash-starts');
      const crashCode = `process.title='CRAFT_INSTALLED_EVAL_CRASH';const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(starts)},'x');fs.writeFileSync(${JSON.stringify(identity)},JSON.stringify({adapter:process.pid,guardian:process.ppid}));setInterval(()=>{},1000);`;
      await writeFile(suite, JSON.stringify({ schema: 'craft-eval.eval.v1', suite_id: 'installed-crash', subject_kind: 'software', partition: 'development', sanitized: true, cases: [{ id: 'one', argv: [process.execPath, '-e', crashCode], timeout_s: 30, checks: [{ id: 'exit', kind: 'exit_code', equals: 0 }] }] }));
      const input = { operation_id: 'installed-crash', workspace, suite, subject, runtime };
      const submittedCrash = await fetch(base, { method: 'POST', headers, body: JSON.stringify(input) }); assert.equal(submittedCrash.status, 202);
      const { evaluation: { id: crashId } } = await submittedCrash.json() as { evaluation: { id: string } };
      let owned: { adapter: number; guardian: number } | undefined;
      const startedBy = Date.now() + 5_000;
      while (Date.now() < startedBy) { try { owned = JSON.parse(await readFile(identity, 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
      assert.ok(owned); ownedAdapter = owned.adapter;
      const worker = Number(ps(owned.guardian, 'ppid'));
      assert.equal(Number(ps(worker, 'ppid')), child.pid); assert.match(ps(worker, 'command'), /craft-evaluation-worker\.js/);
      process.kill(worker, 'SIGKILL');
      const unknownBy = Date.now() + 5_000;
      do {
        const response = await fetch(new URL(`${base.pathname}/${crashId}`, address), { headers }); assert.equal(response.status, 200);
        record = (await response.json() as { evaluation: Record<string, unknown> }).evaluation;
        if (record.state === 'unknown') break;
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < unknownBy);
      assert.equal(record.state, 'unknown');
      const duplicate = await fetch(base, { method: 'POST', headers, body: JSON.stringify(input) }); assert.equal(duplicate.status, 202);
      const existing = (await duplicate.json() as { evaluation: Record<string, unknown> }).evaluation;
      assert.equal(existing.id, crashId); assert.equal(existing.state, 'unknown'); assert.equal(await readFile(starts, 'utf8'), 'x');
      const stoppedBy = Date.now() + 3_000;
      while (ps(owned.adapter, 'stat') && !ps(owned.adapter, 'stat').startsWith('Z') && Date.now() < stoppedBy) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(!ps(owned.adapter, 'stat') || ps(owned.adapter, 'stat').startsWith('Z'));
    }
  } finally {
    clearTimeout(deadline); child.kill('SIGTERM'); await exit;
    if (ownedAdapter && ps(ownedAdapter, 'command').includes('CRAFT_INSTALLED_EVAL_CRASH')) try { process.kill(-ownedAdapter, 'SIGKILL'); } catch { /* Already cleaned. */ }
    await rm(root, { recursive: true, force: true });
  }
});

test('the installed runtime imports pinned legacy assets as candidates and restores data before registration', async () => {
  const { CraftStore, CraftService, craftPaths } = await import('craft/runtime');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workbench-installed-migration-')));
  const store = await new CraftStore(craftPaths(join(root, 'data'))).open();
  try {
    const service = new CraftService(store), old = { kind: 'project', id: 'legacy' };
    service.scopeAliasBind({ scope_kind: 'project', scope_id: 'legacy', alias_kind: 'path', alias: root });
    store.create('project_identity', 'legacy', { canonical_scope: old, local_path_alias: root });
    store.create('knowledge_source', 'source', { scope: old, kind: 'custom', label: 'Synthetic installed source', locator: root, content_digest: 'descriptor', trust: 'verified', status: 'active' });
    store.create('memory_ledger', 'memory', { scope: old, kind: 'preference', source_id: 'source', content: 'Keep literal project:legacy unchanged', sensitivity: 'internal', status: 'active', confidence: 'confirmed', evidence_ids: [] });
    const registryPlan = service.scopeIdentityResolveProject({ project_root: root, action: 'plan_registry_migration' });
    const registry = service.scopeIdentityResolveProject({ project_root: root, action: 'apply_registry_migration', expected_digest: registryPlan.plan_digest, legacy_scope_id: 'legacy' });
    const args = { project_root: root, migration_id: registry.migration.id };
    const plan = service.scopeIdentityResolveProject({ ...args, action: 'plan_data_migration', record_refs: [{ kind: 'memory_ledger', id: 'memory', version: 1 }] });
    assert.equal(plan.coverage, 'selected_roots_and_typed_dependencies');
    assert.doesNotMatch(JSON.stringify(plan), /Keep literal/);
    const apply = { ...args, action: 'apply_data_migration', expected_digest: plan.plan_digest, record_refs: plan.record_refs };
    const imported = service.scopeIdentityResolveProject(apply);
    assert.equal(service.scopeIdentityResolveProject(apply).idempotent, true);
    const target = (plan.records as Array<{ source: { kind: string }; target: { kind: string; id: string } }>).find(row => row.source.kind === 'memory_ledger')!.target;
    const candidate = store.get(target.kind, target.id);
    assert.equal(candidate.status, 'candidate'); assert.equal(candidate.confidence, 'unverified');
    assert.equal(candidate.content, 'Keep literal project:legacy unchanged');
    assert.equal(store.list('memory_ledger', 10).length, 1);
    assert.equal(imported.migration.state, 'applied');
    assert.equal(service.scopeIdentityResolveProject({ ...args, action: 'restore_data_migration', expected_digest: plan.plan_digest }).migration.state, 'restored');
    assert.equal(service.scopeIdentityResolveProject({ ...args, action: 'restore_registry' }).registry_restored, true);
    assert.equal(store.get('memory_ledger', 'memory').status, 'active');
    assert.equal(store.list('task_message', 10).length, 0);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
