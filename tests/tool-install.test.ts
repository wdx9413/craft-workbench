import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelToolInstall, describeJob, installOutputText, startToolInstall, waitForJob } from '../workbench/tool-install.js';

const job = (over: Record<string, unknown> = {}) => ({
  id: 'install_1', provider: 'codex', label: 'Codex CLI', state: 'running', stage: 'install',
  command: 'npm install -g @openai/codex', output: 'installing', exit_code: null,
  detected_executable: null, error: null, started_at: '2026-11-08T00:00:00Z', finished_at: null, ...over,
});

test('install stages map to honest labels and percentages', () => {
  assert.deepEqual(describeJob(null), { label: '等待安装', percent: 0, terminal: false });
  assert.equal(describeJob(job({ stage: 'preflight' })).label, '检查环境');
  assert.equal(describeJob(job({ stage: 'verify' })).percent, 85);
  assert.equal(describeJob(job({ state: 'succeeded', stage: 'done' })).percent, 100);
  assert.equal(describeJob(job({ state: 'failed', stage: 'done' })).terminal, true);
  assert.equal(describeJob(job({ state: 'cancelled', stage: 'done' })).label, '已取消');
});

test('install output keeps the stage, error and bounded tail together', () => {
  assert.match(installOutputText(job({ error: 'npm missing' })), /\[安装中\]\nnpm missing\ninstalling/);
  assert.equal(installOutputText(null), '');
});

test('startToolInstall posts once and polls until terminal', async () => {
  const calls: Array<{ path: string; init: any }> = [];
  const updates: any[] = [];
  let polls = 0;
  const api = async (path: string, init: any = {}) => {
    calls.push({ path, init });
    if (init.method === 'POST') return { job: job() };
    polls += 1;
    return { job: job({ state: polls >= 2 ? 'succeeded' : 'running', stage: polls >= 2 ? 'done' : 'verify', detected_executable: '/bin/codex' }) };
  };
  const result = await startToolInstall({ api, provider: 'codex', interval: 1, onUpdate: value => updates.push(value) });
  assert.equal(result.state, 'succeeded');
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  assert.equal(polls, 2);
  assert.ok(updates.length >= 3);
});

test('startToolInstall rejects missing providers, missing job ids and API failure', async () => {
  await assert.rejects(() => Promise.resolve().then(() => startToolInstall({ api: async () => ({}), provider: 'codex' })), /未返回编号/);
  assert.throws(() => startToolInstall({ api: async () => ({}), provider: '' }), /缺少工具标识/);
  assert.throws(() => startToolInstall({ api: null, provider: 'codex' }), /需要本机 Craft 运行时/);
  await assert.rejects(() => startToolInstall({ api: async () => { throw new Error('offline'); }, provider: 'codex' }), /offline/);
});

test('waitForJob times out instead of polling forever', async () => {
  await assert.rejects(() => waitForJob({ api: async () => ({ job: job() }), job: job(), interval: 1, timeout: 5 }), /安装超时/);
});

test('cancelToolInstall posts to the cancel route', async () => {
  const calls: string[] = [];
  const result = await cancelToolInstall({ api: async (path: string) => { calls.push(path); return { job: job({ state: 'cancelled', stage: 'done' }) }; }, id: 'install_1' });
  assert.equal(result.state, 'cancelled');
  assert.deepEqual(calls, ['/api/workbench/tool-install/install_1/cancel']);
});
