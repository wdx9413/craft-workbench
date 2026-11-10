// V1.4 · third incremental coverage gate: rail/folder rendering extracted
// from app.js. Every branch is driven through injected dependencies.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FOLDER_PREVIEW, taskRowHtml, taskListRows, folderGroupHtml } from '../workbench/folder-tree.js';

const esc = (value) => String(value ?? '');
const icon = (name, cls) => `<i data-icon="${name}"${cls ? ` class="${cls}"` : ''}></i>`;
const lead = (name) => `<span class="lead">${name}</span>`;
const statusPill = (status) => `<span class="pill">${status ?? 'none'}</span>`;

function deps(overrides = {}) {
  return { esc, icon, lead, statusPill, selectedTask: null, collapsedFolders: {}, showAllFolders: {}, ...overrides };
}

test('FOLDER_PREVIEW is the documented five-row cap', () => {
  assert.equal(FOLDER_PREVIEW, 5);
});

test('taskRowHtml marks the selected task and falls back for missing title/goal', () => {
  const html = taskRowHtml({ id: 't1', title: '修复登录', goal: '补回归' }, deps({ selectedTask: 't1' }));
  assert.match(html, /aria-current="true"/u);
  assert.match(html, /data-task="t1"/u);
  assert.match(html, /<i data-icon="tasks"/u);
  const fallback = taskRowHtml({ id: 't2' }, deps());
  assert.doesNotMatch(fallback, /aria-current/u);
  assert.match(fallback, /未命名任务/u);
  assert.match(fallback, /—/u);
});

test('taskListRows renders all rows with lead/status and tolerates non-array', () => {
  const html = taskListRows([
    { id: 't1', title: 'A', goal: 'g1', status: 'running' },
    { id: 't2', status: 'failed' },
  ], deps());
  assert.equal((html.match(/class="row selectable"/gu) ?? []).length, 2);
  assert.match(html, /class="lead"/u);
  assert.match(html, /class="pill"/u);
  assert.match(html, /未命名任务/u);
  assert.equal(taskListRows(null, deps()), '');
});

test('folderGroupHtml shows five rows, a remaining-count expand button and correct icon', () => {
  const tasks = Array.from({ length: 7 }, (_, index) => ({ id: `t${index}`, title: `任务${index}`, goal: '' }));
  const html = folderGroupHtml({ key: 'ws-1', name: '工作区', tasks }, deps());
  assert.match(html, /data-folder="ws-1"/u);
  assert.match(html, /class="ft-group"/u);
  assert.match(html, /class="ft-count">7/u);
  assert.match(html, /还有 2 个，展开/u);
  assert.equal((html.match(/class="conv-item"/gu) ?? []).length, 5);
  assert.match(html, /data-icon="folder" class="ft-ic"/u);
});

test('folderGroupHtml expanded state renders all rows and a collapse button', () => {
  const tasks = Array.from({ length: 7 }, (_, index) => ({ id: `t${index}`, title: `任务${index}`, goal: '' }));
  const html = folderGroupHtml({ key: 'ws-1', name: '工作区', tasks }, deps({ showAllFolders: { 'ws-1': true } }));
  assert.match(html, /收起/u);
  assert.equal((html.match(/class="conv-item"/gu) ?? []).length, 7);
  assert.doesNotMatch(html, /还有 /u);
});

test('folderGroupHtml collapsed state omits the body and marks the group', () => {
  const html = folderGroupHtml({ key: '', name: '未绑定目录', tasks: [{ id: 't1', title: 'A', goal: '' }] },
    deps({ collapsedFolders: { '': true } }));
  assert.match(html, /data-collapsed="true"/u);
  assert.doesNotMatch(html, /class="conv-item"/u);
  assert.match(html, /aria-expanded="false"/u);
  assert.match(html, /data-icon="inbox" class="ft-ic"/u);
});

test('folderGroupHtml empty group shows the empty state and no more button', () => {
  const html = folderGroupHtml({ key: 'empty', name: '空', tasks: [] }, deps());
  assert.match(html, /还没有任务/u);
  assert.doesNotMatch(html, /ft-more/u);
  assert.match(html, /class="ft-count">0/u);
});

test('folderGroupHtml tolerates nullish state and malformed group without throwing', () => {
  const bare = deps({ collapsedFolders: null, showAllFolders: null });
  const html = folderGroupHtml({ key: 'k', name: 'N', tasks: undefined }, bare);
  assert.match(html, /还没有任务/u);
  assert.doesNotThrow(() => folderGroupHtml({ key: 'k', name: 'N' }, bare));
});

test('folderGroupHtml selected task is reflected inside group rows', () => {
  const html = folderGroupHtml({ key: 'k', name: 'N', tasks: [{ id: 't1', title: 'A', goal: '' }] },
    deps({ selectedTask: 't1' }));
  assert.match(html, /aria-current="true"/u);
});
