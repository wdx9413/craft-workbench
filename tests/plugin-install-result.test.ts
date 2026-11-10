import test from 'node:test';
import assert from 'node:assert/strict';
import { pluginInstallResult } from '../workbench/plugin-install-result.js';

test('plugin registration reports its actual usability', () => {
  assert.deepEqual(pluginInstallResult({ runtime_status: 'unsupported', unsupported_reason: 'Hook 未接入' }, '已安装'),
    { message: '已登记插件，暂不支持启用：Hook 未接入', warning: true });
  assert.deepEqual(pluginInstallResult({ runtime_status: 'unsupported' }, '已安装'),
    { message: '已登记插件，暂不支持启用：请查看详情', warning: true });
  assert.deepEqual(pluginInstallResult({ runtime_status: 'descriptor_only' }, '已安装'),
    { message: '已登记插件信息，暂不可使用，请查看详情', warning: false });
  assert.deepEqual(pluginInstallResult({ runtime_status: 'mapped_adapter' }, '已安装到 Craft'),
    { message: '已安装到 Craft', warning: false });
});
