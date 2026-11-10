// V2 · 三模式体验闭环 — draft / filter retention across mode switches.
//
// NEEDREAD §2: 切换保留任务、项目、草稿和筛选，不重跑、不增权。这里直接驱动
// workbench/app.js 里真实的 setMode 实现（与 mode-shell.test.ts 同一抽取手法），
// 在一个带草稿的完整 state 上连续切 领航员→控制台→工作台，断言草稿/筛选/
// 页面/任务均不漂移，且除模式偏好外没有任何派发副作用。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { nextPageForMode } from '../workbench/mode-shell.js';

async function loadSetMode() {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const body = source.split('function setMode(mode) {')[1].split('// ------------------------------------------------------------------- render')[0].replace(/}\s*$/, '');
  return new Function('mode', 'state', '$', 'isMode', 'nextPageForMode', 'saveMode', 'paintNav', 'paintModeSwitch', 'go',
    `let modeSwitchRevision = 0; ${body}`);
}

test('V2: mode switches keep drafts and filters; a hidden page lands on the mode home', async () => {
  const run = await loadSetMode();
  const state = {
    mode: 'pilot',
    page: 'home',
    selectedProject: 'ws-1',
    selectedProvider: 'craft',
    selectedObject: 'obj-1',
    asideOpen: { evidence: true },
    showAdvanced: true,
    composer: {
      folder: 'ws-1',
      model: 'gpt-5',
      permission: 'auto',
      lastPrompt: '请修复登录态并补一条回归测试',
      caps: ['skill-review'],
      models: [{ id: 'gpt-5', configured: true }],
    },
    pilotSessionId: 'pilot-thread-1',
  };
  const attributes = new Map([['data-mode', 'pilot']]);
  const app = { setAttribute: (key, value) => attributes.set(key, value) };
  const shell = { querySelector: () => ({ focus() {} }) };
  const lookup = (id) => (id === 'app' ? app : shell);

  const sideEffects = [];
  const saveMode = () => sideEffects.push('saveMode');
  const paintNav = () => sideEffects.push('paintNav');
  const paintModeSwitch = () => sideEffects.push('paintModeSwitch');
  const isMode = (mode) => ['pilot', 'control', 'workshop'].includes(mode);
  const navigations = [];
  const go = (page) => { navigations.push(page); state.page = page; };

  const stableState = () => JSON.stringify({
    selectedProject: state.selectedProject, selectedProvider: state.selectedProvider,
    selectedObject: state.selectedObject, asideOpen: state.asideOpen, showAdvanced: state.showAdvanced,
    composer: state.composer, pilotSessionId: state.pilotSessionId,
  });
  const snapshot = stableState();

  for (const mode of ['control', 'workshop', 'pilot']) {
    const before = state.page;
    const expectedPage = nextPageForMode(mode, before);
    navigations.length = 0;
    run(mode, state, lookup, isMode, nextPageForMode, saveMode, paintNav, paintModeSwitch, go);
    assert.equal(attributes.get('data-mode'), mode, `mode projection should be ${mode}`);
    assert.equal(state.mode, mode);
    // Only the landing page may change, and only when the new mode hides it.
    assert.equal(state.page, expectedPage, `unexpected landing page for ${mode}`);
    assert.deepEqual(navigations, expectedPage === before ? [] : [expectedPage]);
    assert.equal(stableState(), snapshot, `state drifted after switching to ${mode}`);
  }

  // Switching is a projection change only: the mode preference is saved each time,
  // and no task dispatch, re-plan or permission change is ever performed.
  assert.equal(sideEffects.filter((e) => e === 'saveMode').length, 3);
  assert.ok(!sideEffects.some((e) => /dispatch|submit|run|approve|grant/i.test(e)), 'no execution side effect on mode switch');
});

test('V2: 未知模式被拒绝，草稿与筛选保持不变', async () => {
  const run = await loadSetMode();
  const state = { mode: 'pilot', page: 'tasks', selectedProject: 'ws-1', composer: { lastPrompt: '保留我' } };
  const attributes = new Map();
  const app = { setAttribute: (key, value) => attributes.set(key, value) };
  const lookup = () => app;
  const saved = [];
  run('bogus', state, lookup, (mode) => ['pilot', 'control', 'workshop'].includes(mode),
    () => saved.push('saveMode'), () => {}, () => {});
  assert.equal(state.mode, 'pilot');
  assert.equal(state.composer.lastPrompt, '保留我');
  assert.equal(saved.length, 0);
});
