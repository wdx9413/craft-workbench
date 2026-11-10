// V1.4 · fourth incremental coverage gate: pure lookups extracted from app.js.
import assert from 'node:assert/strict';
import test from 'node:test';
import { operatorOf, taskTitleOf, capNameOf } from '../workbench/lookup.js';

test('operatorOf trims a configured operator and signs unattributed otherwise', () => {
  assert.equal(operatorOf({ workbench: { operator: '  用户A  ' } }), '用户A');
  assert.equal(operatorOf({ workbench: { operator: '   ' } }), 'unattributed');
  assert.equal(operatorOf({ workbench: {} }), 'unattributed');
  assert.equal(operatorOf({}), 'unattributed');
  assert.equal(operatorOf(null), 'unattributed');
  assert.equal(operatorOf({ workbench: { operator: 42 } }), 'unattributed');
  assert.equal(operatorOf({ workbench: null }), 'unattributed');
});

test('taskTitleOf finds a task across groups and returns "" when unknown', () => {
  const groups = [
    { key: 'a', tasks: [{ id: 't1', title: '修复登录' }] },
    { key: 'b', tasks: [{ id: 't2', title: '' }, { id: 't3' }] },
  ];
  assert.equal(taskTitleOf('t1', groups), '修复登录');
  assert.equal(taskTitleOf('t2', groups), '', 'empty title is preserved as ""');
  assert.equal(taskTitleOf('t3', groups), '', 'missing title yields ""');
  assert.equal(taskTitleOf('missing', groups), '');
  assert.equal(taskTitleOf('t1', null), '');
  assert.equal(taskTitleOf('t1', [null, { tasks: null }]), '');
});

test('capNameOf prefers assets, then user skills, then the raw id', () => {
  const caps = {
    assets: [{ id: 'a1', name: '资产甲' }, { id: 'a2' }],
    userSkills: [{ id: 's1', name: '技能乙' }],
  };
  assert.equal(capNameOf('a1', caps), '资产甲');
  assert.equal(capNameOf('a2', caps), 'a2', 'missing name falls back to the id');
  assert.equal(capNameOf('s1', caps), '技能乙');
  assert.equal(capNameOf('unknown', caps), 'unknown');
  assert.equal(capNameOf('x', null), 'x');
  assert.equal(capNameOf('x', { assets: null, userSkills: undefined }), 'x');
});

test('capNameOf prefers an asset over a user skill with the same id', () => {
  const caps = { assets: [{ id: 'dup', name: '资产版' }], userSkills: [{ id: 'dup', name: '技能版' }] };
  assert.equal(capNameOf('dup', caps), '资产版');
});
