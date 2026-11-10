import assert from 'node:assert/strict';
import test from 'node:test';
import { runDesktopStartupGate } from '../workbench/runtime-startup.js';

test('a browser without the desktop bridge continues into its selected runtime', () => {
  let continued = 0;
  let failed = 0;
  assert.equal(runDesktopStartupGate(null, () => continued++, () => failed++), null);
  assert.equal(continued, 1);
  assert.equal(failed, 0);
});

test('a healthy desktop runtime continues only after its startup state is checked', async () => {
  const calls: string[] = [];
  const result = await runDesktopStartupGate(async (command) => { calls.push(command); return null; },
    () => calls.push('continue'), () => calls.push('failure'));
  assert.deepEqual(calls, ['workbench_startup_error', 'continue']);
  assert.equal(result, true);
});

test('a desktop startup error is shown without calling the unavailable Runtime', async () => {
  const calls: unknown[] = [];
  const result = await runDesktopStartupGate(async () => '请检查本地数据目录',
    () => calls.push('continue'), (message) => calls.push(message));
  assert.deepEqual(calls, ['请检查本地数据目录']);
  assert.equal(result, false);
});

test('an unavailable startup-state command fails closed with generic guidance', async () => {
  const calls: unknown[] = [];
  const result = await runDesktopStartupGate(async () => { throw new Error('private bridge detail'); },
    () => calls.push('continue'), (message) => calls.push(message));
  assert.deepEqual(calls, [undefined]);
  assert.equal(result, false);
});
