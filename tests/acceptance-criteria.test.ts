// V1.4 · incremental coverage gate for the module extracted out of app.js.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCriteria, CRITERION_WORDS } from '../workbench/acceptance-criteria.js';

test('CRITERION_WORDS maps Chinese and enum words to runtime kinds', () => {
  assert.equal(CRITERION_WORDS['文件'], 'file');
  assert.equal(CRITERION_WORDS['命令'], 'program');
  assert.equal(CRITERION_WORDS['模型'], 'model');
  assert.equal(CRITERION_WORDS['人工'], 'human');
  assert.equal(CRITERION_WORDS['业务信号'], 'business_signal');
  assert.equal(CRITERION_WORDS.file, 'file');
});

test('parseCriteria turns typed lines into criteria and file specs', () => {
  const result = parseCriteria([
    '命令：pnpm test',
    '模型：复核通过',
    '人工：确认无回归',
    '文件：dist/app.js',
    '业务信号：工单已关闭',
  ]);
  assert.deepEqual(result.criteria, [
    { id: 'criterion_1', name: 'pnpm test', method: 'program', required: true },
    { id: 'criterion_2', name: '复核通过', method: 'model', required: true },
    { id: 'criterion_3', name: '确认无回归', method: 'human', required: true },
    { id: 'criterion_4', name: '产出文件：dist/app.js', method: 'program', required: true },
    { id: 'criterion_5', name: '工单已关闭', method: 'business_signal', required: true },
  ]);
  assert.deepEqual(result.files, [
    { id: 'criterion_4', name: '产出文件：dist/app.js', method: 'program', required: true, file_path: 'dist/app.js' },
  ]);
});

test('parseCriteria accepts fullwidth colons and enum words', () => {
  const result = parseCriteria(['file: report.md', 'program：npm run build']);
  assert.equal(result.criteria[0].method, 'program');
  assert.equal(result.criteria[1].method, 'program');
  assert.equal(result.files[0].file_path, 'report.md');
});

test('parseCriteria defaults untyped or unmatched lines to human', () => {
  const result = parseCriteria(['随便写一句', '未知类型：abc', '  ', 'human: 明确人工']);
  assert.equal(result.criteria.length, 4);
  assert.ok(result.criteria.slice(0, 3).every((c) => c.method === 'human'));
  assert.equal(result.criteria[3].method, 'human');
  assert.deepEqual(result.files, []);
});

test('parseCriteria handles non-array input and nullish lines without throwing', () => {
  assert.deepEqual(parseCriteria(null), { criteria: [], files: [] });
  assert.deepEqual(parseCriteria(undefined), { criteria: [], files: [] });
  const mixed = parseCriteria([null, undefined, 123, '']);
  assert.equal(mixed.criteria.length, 4);
  assert.ok(mixed.criteria.every((c) => c.method === 'human'));
  assert.deepEqual(mixed.files, []);
});

test('parseCriteria trims typed bodies and keeps ids stable by line order', () => {
  const result = parseCriteria(['命令：  pnpm lint  ', '模型：   ok   ']);
  assert.equal(result.criteria[0].name, 'pnpm lint');
  assert.equal(result.criteria[1].name, 'ok');
  assert.deepEqual(result.criteria.map((c) => c.id), ['criterion_1', 'criterion_2']);
});
