import assert from 'node:assert/strict';
import test from 'node:test';
import { renderChangeSetDetail } from '../workbench/change-set-view.js';

const esc = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

test('change set detail shows source and current versions and only enables non-conflicting patches', () => {
  const html = renderChangeSetDetail({
    change_set: { id: 'cs', version: 3, summary: 'Update report', status: 'draft' },
    state_revision: 9,
    patches: [
      { object_id: 'report', path: '/price', op: 'set', value: 20, base_version: 2, current_version: 4,
        base_value: 10, current_value: 10, classification: 'auto_apply', patch_index: 0 },
      { object_id: 'report', path: '/region', op: 'set', value: '<script>', base_version: 2, current_version: 5,
        base_value: 'US', current_value: 'EU', classification: 'conflict', patch_index: 1 },
      { object_id: 'report', path: '/notes', op: 'remove', base_version: 2, current_version: 5,
        base_value: 'human note', current_value: 'human note', classification: 'applied', patch_index: 2 },
    ]
  }, esc);

  assert.match(html, /变更集 v3/);
  assert.match(html, /基线 v2/);
  assert.match(html, /当前 v4/);
  assert.match(html, /基线 v2：10/);
  assert.match(html, /当前 v5：&quot;EU&quot;/);
  assert.match(html, /建议值：&quot;&lt;script&gt;&quot;/);
  assert.match(html, /data-patch-index="0"/);
  assert.match(html, /data-patch-index="1" disabled/);
  assert.match(html, /data-patch-index="2" disabled/);
  assert.match(html, /需要复核/);
  assert.match(html, /已接受/);
});

test('change set detail safely renders malformed and absent values', () => {
  const html = renderChangeSetDetail({
    change_set: { id: '<unsafe>', summary: null },
    state_revision: null,
    patches: [null, { object_id: 'obj', path: '/x', op: 'remove', classification: 'unknown', base_version: null, current_version: null }]
  }, esc);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.match(html, /当前工作区版本未知/);
  assert.match(html, /建议值：删除/);
  assert.match(html, /需要复核/);
  assert.match(html, /无补丁内容/);
});

test('change set detail handles missing metadata and values without an injected escaper', () => {
  const empty = renderChangeSetDetail(null);
  assert.match(empty, /变更集 · 变更集 版本未知/);
  assert.match(empty, /当前工作区版本未知/);
  assert.match(empty, /没有补丁内容/);

  const html = renderChangeSetDetail({
    change_set: {},
    patches: [
      { object_id: '', path: '', op: 'set', value: Symbol('value'), classification: 'unknown',
        patch_index: 'invalid', base_version: null, current_version: 'invalid' },
      { object_id: 'obj', path: '/invalid-index', op: 'set', value: 1, classification: 'auto_apply', patch_index: -1 }
    ]
  });
  assert.match(html, /成果 · 未知字段/);
  assert.match(html, /Symbol\(value\)/);
  assert.match(html, /data-patch-index="-1" disabled/);

  const missing = renderChangeSetDetail({ change_set: null, state_revision: undefined,
    patches: [{ op: 'set', value: undefined, patch_index: 'bad', base_version: undefined,
      current_version: undefined }] }, esc);
  assert.match(missing, /成果 · 未知字段/);
  assert.match(missing, /需要复核/);
});
