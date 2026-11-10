import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTION, CONNECTION_MAX_ATTEMPTS, connectionRetryDelay, shouldRetryConnection } from '../workbench/connection-state.js';

test('connection views are explicit and never invent a success label', () => {
  assert.deepEqual(CONNECTION.ok, { state: 'ok', rail: '已连接 · 仅本机', status: '已连接' });
  assert.deepEqual(CONNECTION.failed, { state: 'bad', rail: '连接失败', status: '连接失败' });
  assert.deepEqual(CONNECTION.unauthorized, { state: 'bad', rail: '未授权', status: '未授权' });
});

test('retry delay starts at five seconds, doubles, and caps at one minute', () => {
  assert.equal(connectionRetryDelay(1), 5000);
  assert.equal(connectionRetryDelay(2), 10000);
  assert.equal(connectionRetryDelay(3), 20000);
  assert.equal(connectionRetryDelay(4), 40000);
  assert.equal(connectionRetryDelay(5), 60000);
  assert.equal(connectionRetryDelay(99), 60000);
});

test('an invalid or non-positive probe number still yields the base delay', () => {
  assert.equal(connectionRetryDelay(0), 5000);
  assert.equal(connectionRetryDelay(-3), 5000);
  assert.equal(connectionRetryDelay(Number.NaN), 5000);
  assert.equal(connectionRetryDelay(2.7), 10000);
});

test('the watchdog retries up to the budget then stops, guarding the counter type', () => {
  assert.equal(CONNECTION_MAX_ATTEMPTS, 24);
  assert.equal(shouldRetryConnection(0), true);
  assert.equal(shouldRetryConnection(CONNECTION_MAX_ATTEMPTS - 1), true);
  assert.equal(shouldRetryConnection(CONNECTION_MAX_ATTEMPTS), false);
  assert.equal(shouldRetryConnection(-1), false);
  assert.equal(shouldRetryConnection(1.5), false);
  assert.equal(shouldRetryConnection('2'), false);
});

test('an explicit budget overrides the default cap', () => {
  assert.equal(shouldRetryConnection(2, 5), true);
  assert.equal(shouldRetryConnection(2, 2), false);
});
