import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Browser JavaScript is tested directly without generated declarations.
import { createModelSetup, environmentGuidance } from '../workbench/model-setup.js';

test('model pricing saves explicitly and is cleared when its destination changes', async () => {
  const price = { version: 'v1', input_usd_per_million: 1, output_usd_per_million: 2 };
  const sent: any[] = [];
  const presets = [{ key: 'custom', label: 'Custom', models: ['m'], baseUrl: 'https://one.test', protocol: 'openai-compatible', env: 'PRICE_KEY' }];
  const setup = createModelSetup(presets, async (_path: string, options: any) => { sent.push(options.body); return {}; });
  setup.open({ editing: { id: 'custom', name: 'Model', model: 'm', baseUrl: 'https://one.test', protocol: 'openai-compatible', apiKeyEnv: 'PRICE_KEY', pricing: price } });
  await setup.save();
  assert.deepEqual(sent[0].pricing, price);
  setup.change({ type: 'fields', baseUrl: 'https://two.test', pricing: price });
  assert.equal(setup.view().pricing, null);
  await setup.save();
  assert.equal(sent[1].pricing, null);
  setup.change({ type: 'fields', pricing: { ...price, input_usd_per_million: -1 } });
  await assert.rejects(setup.save(), /单价/u);
  assert.equal(sent.length, 2);
});

test('credential guidance follows the chosen environment name and platform without exposing a key', () => {
  assert.deepEqual(environmentGuidance('CUSTOM_KEY', 'Win32'), { command: "$env:CUSTOM_KEY = '你的Key'", message: '请从同一终端启动 Craft；命令可能保存在终端历史中。' });
  assert.deepEqual(environmentGuidance('CUSTOM_KEY', 'MacIntel'), { command: "launchctl setenv CUSTOM_KEY '你的Key'", message: '退出并重新打开 Craft 后，请检查配置是否生效；命令可能保存在终端历史中。' });
  assert.deepEqual(environmentGuidance('CUSTOM_KEY', 'Linux x86_64'), { command: "export CUSTOM_KEY='你的Key'", message: '请从同一终端启动 Craft；命令可能保存在终端历史中。' });
  assert.deepEqual(environmentGuidance('BAD;command', 'Win32'), { command: '', message: '环境变量名格式不正确，请在高级选项中修改。' });
  assert.deepEqual(environmentGuidance('CUSTOM_KEY', 'unknown'), { command: '', message: '请为 Craft 设置环境变量 CUSTOM_KEY，然后重新启动。' });
});

test('first-run provider choice can be resumed without persisting user-entered fields', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const presets = [{ key: 'example', label: 'Example', models: ['default'], baseUrl: 'https://example.test', protocol: 'openai-compatible', env: 'CONFIG_NAME' }];
  const setup = createModelSetup(presets, async () => ({}), storage);
  setup.open({ isFirstRun: true });
  setup.change({ type: 'select', key: 'example' });
  setup.change({ type: 'fields', baseUrl: 'edited-address', env: 'EDITED_NAME' });
  assert.deepEqual([...values.values()], ['example']);
  const resumed = createModelSetup(presets, async () => ({}), storage);
  resumed.open({ isFirstRun: true });
  assert.equal(resumed.view().preset, 'example');
  assert.equal(resumed.view().step, 2);
  assert.equal(resumed.view().baseUrl, 'https://example.test');
  resumed.clearOnboardingDraft();
  assert.equal(values.size, 0);
});

test('onboarding ignores invalid or unavailable local storage', async () => {
  const unavailable = { getItem: () => { throw new Error('unavailable'); }, setItem: () => { throw new Error('unavailable'); }, removeItem: () => { throw new Error('unavailable'); } };
  const local = [{ key: 'local', label: 'Local', models: ['model'], baseUrl: 'https://example.test', protocol: 'openai-compatible', env: 'LOCAL_NAME' }];
  const setup = createModelSetup(local, async () => ({}), unavailable);
  setup.open({ isFirstRun: true });
  assert.equal(setup.view().step, 1);
  setup.change({ type: 'select', key: 'local' });
  setup.change({ type: 'next', model: 'model' });
  assert.equal((await setup.save()).current, true);
  const invalid = createModelSetup(local, async () => ({}), { getItem: () => 'other' });
  invalid.open({ isFirstRun: true });
  assert.equal(invalid.view().step, 1);
});

const presets = [
  { key: 'local', label: 'Local', baseUrl: 'http://localhost:8000/v1', protocol: 'openai-compatible', env: 'LOCAL_KEY', models: ['model'] },
  { key: 'custom', label: 'Custom', baseUrl: '', protocol: 'anthropic', env: 'CUSTOM_KEY', models: [] },
];
function fixture() {
  const calls: Array<{ path: string; init: { method: string; body: Record<string, unknown> } }> = [];
  const setup = createModelSetup(presets, async (path: string, init: { method: string; body: Record<string, unknown> }) => { calls.push({ path, init }); });
  return { setup, calls };
}

test('first-run defaults, metadata-only drafts, navigation and provider selection are owned by the setup Module', async () => {
  const { setup, calls } = fixture();
  assert.throws(() => setup.view(), /打开/); assert.throws(() => setup.change({ type: 'back' }), /打开/);
  await assert.rejects(setup.save(), /打开/);
  setup.open(); assert.equal(setup.view().step, 1);
  assert.throws(() => setup.change({ type: 'next' }), /选择服务商/);
  setup.change({ type: 'back' }); assert.equal(setup.view().step, 1);
  setup.open({ isFirstRun: true, pastedKey: 'private-key', apiKey: 'private-key' });
  assert.equal(setup.view().step, 1); assert.ok(!JSON.stringify(setup.view()).includes('private-key'));
  assert.throws(() => setup.change({ type: 'select', key: 'missing' }), /不存在/);
  setup.change({ type: 'select', key: 'custom' }); assert.equal(setup.view().model, '');
  setup.change({ type: 'select', key: 'local' }); assert.equal(setup.view().step, 2);
  assert.throws(() => setup.change({ type: 'next', model: '  ' }), /模型/);
  setup.change({ type: 'next', model: ' custom-model ' }); assert.equal(setup.view().step, 3);
  setup.change({ type: 'back' }); assert.equal(setup.view().step, 2);
  setup.change({ type: 'fields', name: ' My model ', baseUrl: 'http://localhost:8000/v1///', env: ' key_env ' });
  setup.change({ type: 'fields' });
  assert.equal(setup.view().baseUrl, 'http://localhost:8000/v1');
  assert.throws(() => setup.change({ type: 'javascript' }), /操作无效/);
  const view = setup.view(); view.model = 'tampered'; assert.equal(setup.view().model, 'custom-model');
  setup.change({ type: 'next', model: 'custom-model' });
  const result = await setup.save(); assert.equal(result.current, true); assert.equal(result.editing, false);
  assert.deepEqual(calls[0], { path: '/api/config/models', init: { method: 'POST', body: { id: 'local', name: 'My model',
    protocol: 'openai-compatible', baseUrl: 'http://localhost:8000/v1', model: 'custom-model', apiKeyEnv: 'key_env', supportsTools: true } } });
  setup.open({ preset: 'local' }); setup.change({ type: 'next' }); assert.equal(setup.view().step, 2);
  setup.change({ type: 'next', model: 'model' }); setup.change({ type: 'fields', name: '' });
  assert.equal((await setup.save()).name, 'Local');
});

test('editing preserves public provider metadata and cannot retain nested credentials', async () => {
  const { setup, calls } = fixture();
  setup.open({ editing: { id: 'custom-id', name: 'Edited', model: 'existing', baseUrl: 'https://service.test/v1', protocol: 'anthropic', apiKeyEnv: 'EXISTING_KEY', apiKey: 'secret' } });
  assert.equal(setup.view().step, 2); assert.equal(setup.view().preset, 'custom');
  assert.ok(!JSON.stringify(setup.view()).includes('secret'));
  setup.change({ type: 'next', model: 'existing' });
  const result = await setup.save(); assert.equal(result.editing, true);
  assert.equal(calls[0].path, '/api/config/models/custom-id'); assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.body.baseUrl, 'https://service.test/v1'); assert.equal(calls[0].init.body.apiKeyEnv, 'EXISTING_KEY');
  setup.open({ preset: 'local', step: 3, name: 'Explicit', model: 'explicit', baseUrl: 'https://override.test', protocol: 'anthropic', env: 'OVERRIDE' });
  assert.equal(setup.view().model, 'explicit');
});

test('invalid transitions and unsafe endpoints never reach the persistence Interface', async () => {
  const { setup, calls } = fixture();
  for (const input of [{ step: 4 }, { preset: 'missing' }]) assert.throws(() => setup.open(input), /无效/);
  setup.open(); await assert.rejects(setup.save(), /标识/);
  setup.open({ preset: 'local' }); await assert.rejects(setup.save(), /模型/);
  for (const patch of [
    { editing: { id: 'Bad ID' } }, { baseUrl: 'file:///tmp/secret' }, { baseUrl: 'https://name:pass@service.test/' },
    { baseUrl: 'https://:pass@service.test/' }, { baseUrl: 'https://service.test/?token=secret' }, { baseUrl: 'https://service.test/#secret' },
    { baseUrl: 'https://' }, { protocol: 'shell' }, { env: '1BAD' },
  ]) {
    setup.open({ preset: 'local', model: 'model', ...patch }); await assert.rejects(setup.save());
  }
  assert.equal(calls.length, 0);
});

test('single-flight saves isolate late success and failure from another opened wizard', async () => {
  let resolveFirst!: () => void, rejectSecond!: (error: Error) => void;
  let resolveThird!: () => void;
  let count = 0;
  const setup = createModelSetup(presets, () => {
    count++;
    if (count === 1) return new Promise<void>((resolve) => { resolveFirst = resolve; });
    if (count === 2) return new Promise<void>((_resolve, reject) => { rejectSecond = reject; });
    return new Promise<void>((resolve) => { resolveThird = resolve; });
  });
  const open = () => setup.open({ preset: 'local', model: 'model' });
  open(); const first = setup.save(); await assert.rejects(setup.save(), /正在保存/); assert.equal(count, 1);
  setup.change({ type: 'fields', name: 'Updated while saving' });
  await assert.rejects(setup.save(), /正在保存/);
  open(); const second = setup.save(); resolveFirst(); assert.equal((await first).current, false);
  await assert.rejects(setup.save(), /正在保存/);
  open(); const third = setup.save(); rejectSecond(new Error('late secret failure'));
  assert.deepEqual(await second, { current: false, status: 'failed' }); resolveThird(); assert.equal((await third).current, true);
  const failure = createModelSetup(presets, async () => { throw new Error('persist refused'); });
  failure.open({ preset: 'local', model: 'model' }); await assert.rejects(failure.save(), /persist refused/);
  await assert.rejects(failure.save(), /persist refused/);
});

test('editing the same wizard during persistence invalidates its old UI result without issuing a second write', async () => {
  let release!: () => void;
  let calls = 0;
  const setup = createModelSetup(presets, () => {
    calls++;
    return calls === 1 ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
  });
  setup.open({ preset: 'local', model: 'model' });
  const request = setup.save();
  setup.change({ type: 'fields', name: 'new draft' });
  await assert.rejects(setup.save(), /正在保存/);
  assert.equal(calls, 1);
  release(); assert.equal((await request).current, false);
  const latest = await setup.save(); assert.equal(latest.current, true); assert.equal(latest.name, 'new draft');
});

test('model discovery uses the current endpoint and drops stale results after provider details change', async () => {
  let resolveDiscovery!: (value: { status: string; message: string; models: string[] }) => void;
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const setup = createModelSetup(presets, (path: string, options: { body: Record<string, unknown> }) => {
    calls.push({ path, body: options.body });
    return new Promise(resolve => { resolveDiscovery = resolve; });
  });
  setup.open({ preset: 'custom' });
  setup.change({ type: 'fields', baseUrl: 'https://gateway.example/v1', protocol: 'openai-compatible', env: 'GATEWAY_KEY' });
  const stale = setup.discover();
  assert.deepEqual(calls[0], { path: '/api/config/models/discover', body: {
    baseUrl: 'https://gateway.example/v1', protocol: 'openai-compatible', apiKeyEnv: 'GATEWAY_KEY',
  } });
  setup.change({ type: 'fields', baseUrl: 'https://other.example/v1' });
  resolveDiscovery({ status: 'ok', message: 'found', models: ['model-a'] });
  assert.deepEqual(await stale, { current: false });
  assert.deepEqual(setup.view().discoveredModels, []);
  assert.equal(setup.view().discovery, null);
});

test('model discovery exposes credential and connection outcomes without saving credentials', async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const setup = createModelSetup(presets, async (path: string, options: { body: Record<string, unknown> }) => {
    calls.push({ path, body: options.body });
    return path === '/api/config/models/discover' ? { status: 'credential_missing', message: '未找到 LOCAL_KEY', models: [] } : {};
  });
  setup.open({ preset: 'local' });
  const missing = await setup.discover();
  assert.equal(missing.status, 'credential_missing');
  assert.match(setup.view().discovery.message, /LOCAL_KEY/u);
  assert.equal(calls[0].path, '/api/config/models/discover');
  const network = createModelSetup(presets, async () => { throw new Error('private transport detail'); });
  network.open({ preset: 'local' });
  assert.equal((await network.discover()).status, 'network_error');
  assert.doesNotMatch(JSON.stringify(network.view()), /private transport detail/u);
});

test('model discovery tolerates missing model arrays and ignores a late failed request', async () => {
  const fallback = createModelSetup(presets, async () => ({ status: 'invalid_response', message: 'manual entry', models: null }));
  fallback.open({ preset: 'local' });
  assert.deepEqual(await fallback.discover(), { current: true, status: 'invalid_response', models: [] });
  let rejectRequest!: (error: Error) => void;
  const pendingSetup = createModelSetup(presets, () => new Promise((_resolve, reject) => { rejectRequest = reject; }));
  pendingSetup.open({ preset: 'local' });
  const pending = pendingSetup.discover();
  pendingSetup.change({ type: 'fields', baseUrl: 'https://changed.example/v1' });
  rejectRequest(new Error('late failure'));
  assert.deepEqual(await pending, { current: false });
});
