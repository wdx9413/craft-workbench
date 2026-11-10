import assert from 'node:assert/strict';
import test from 'node:test';
import { renderTaskArtifactRows } from '../workbench/task-artifact-view.js';

const ui = {
  lead: (icon, tone) => `<i>${icon}:${tone}</i>`,
  esc: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  label: (_map, value) => value,
  emptyState: (title, hint, icon) => `${title}|${hint}|${icon}`,
};

test('empty artifact list keeps the task page empty state', () => {
  assert.match(renderTaskArtifactRows([], ui), /还没有产物/u);
  assert.match(renderTaskArtifactRows(null, ui), /还没有产物/u);
});

test('reopened artifacts show current version and digest with escaped paths', () => {
  const html = renderTaskArtifactRows([{ id: 'report', kind: 'report', name: '竞品报告', uri: 'file:///tmp/<report>.md', version: 3, digest: 'sha256:abc123' }], ui);
  assert.match(html, /版本 v3/u);
  assert.match(html, /摘要 sha256:abc123/u);
  assert.match(html, /file:\/\/\/tmp\/&lt;report&gt;.md/u);
});

test('legacy artifact without a digest or version does not claim either', () => {
  const html = renderTaskArtifactRows([
    { id: 'legacy', kind: 'report', name: 'Old report', uri: 'craft://legacy' },
    { id: 'legacy-receipt', kind: 'route_receipt', name: 'Old receipt' },
  ], ui);
  assert.doesNotMatch(html, /版本 v/u);
  assert.doesNotMatch(html, /摘要 sha256/u);
  assert.match(html, /craft:\/\/legacy/u);
});

test('version-only, digest-only and route receipts keep the available identity fields', () => {
  const receiptUi = { ...ui, receiptName: name => `收据 ${name}` };
  const html = renderTaskArtifactRows([
    { id: 'version-only', kind: 'report', name: 'Versioned', version: 2 },
    { id: 'digest-only', kind: 'file', name: 'Digested', digest: 'sha256:only' },
    { id: 'id-fallback', kind: 'file', name: '', uri: 'craft://id-fallback' },
    { id: 'receipt', kind: 'route_receipt', name: 'receipt-v1', version: 1 },
  ], receiptUi);
  assert.match(html, /版本 v2/u);
  assert.match(html, /摘要 sha256:only/u);
  assert.match(html, /收据 receipt-v1/u);
  assert.doesNotMatch(html, /undefined/u);
});
