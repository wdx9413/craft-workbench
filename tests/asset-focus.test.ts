import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAssetFocus, assetAuditAttribute, assetControlAttribute, parseAssetFocus } from '../workbench/asset-focus.js';

test('the focus string maps each context member to its own audit control', () => {
  assert.equal(assetAuditAttribute('experience'), 'data-exp-audit');
  assert.equal(assetAuditAttribute('memory'), 'data-memory-audit');
  assert.equal(assetAuditAttribute('knowledge'), 'data-knowledge-audit');
  assert.equal(assetAuditAttribute('codebase'), '');
  assert.deepEqual(parseAssetFocus('experience:proc 1'),
    { member: 'experience', assetId: 'proc 1', view: 'audit', attribute: 'data-exp-audit' });
  for (const bad of [null, 42, '', ':id', 'memory:', 'plugin:x', 'experience:a"b', 'experience:a\\b']) {
    assert.equal(parseAssetFocus(bad as unknown), null, `${String(bad)} is not a focusable asset`);
  }
});

test('applying a focus opens that asset audit, scrolls it in, and reports a miss honestly', () => {
  const events: string[] = [];
  const button = { click: () => events.push('clicked'), closest: () => ({ scrollIntoView: () => events.push('scrolled') }) };
  const root = { querySelector: (selector: string) => selector === '[data-memory-audit="m1"]' ? button : null };
  const notified: Array<[string, unknown]> = [];
  const notify = (message: string, bad?: unknown) => { notified.push([message, bad]); };
  assert.equal(applyAssetFocus(root, 'memory:m1', notify), 'focused');
  assert.deepEqual(events, ['clicked', 'scrolled']);
  assert.deepEqual(notified, []);
  // A target outside the current list must say so instead of failing silently.
  assert.equal(applyAssetFocus(root, 'memory:absent', notify), 'missing');
  assert.equal(notified.length, 1);
  assert.equal(notified[0]![1], true);
  // Malformed input and a missing host are ignored without touching the DOM.
  assert.equal(applyAssetFocus(root, 'nonsense', notify), 'ignored');
  assert.equal(applyAssetFocus(null, 'memory:m1', notify), 'ignored');
  assert.deepEqual(events, ['clicked', 'scrolled']);
  assert.equal(notified.length, 1);
});

test('an onclick-only control is driven without a click method', () => {
  const events: string[] = [];
  const button = { onclick: () => { events.push('invoked'); }, closest: () => null };
  assert.equal(applyAssetFocus({ querySelector: () => button }, 'knowledge:k1'), 'focused');
  assert.deepEqual(events, ['invoked']);
});
test('a focus may name the view to open, and an unknown view is refused', () => {
  assert.equal(assetControlAttribute('experience', 'trend'), 'data-exp-trend');
  assert.equal(assetControlAttribute('memory', 'audit'), 'data-memory-audit');
  assert.equal(assetControlAttribute('knowledge'), 'data-knowledge-audit', 'audit is the default view');
  assert.equal(assetControlAttribute('plugin', 'trend'), '');
  assert.equal(assetControlAttribute('memory', 'settings'), '');
  assert.deepEqual(parseAssetFocus('memory:m1#trend'), { member: 'memory', assetId: 'm1', view: 'trend', attribute: 'data-memory-trend' });
  assert.equal(parseAssetFocus('memory:m1#audit').view, 'audit');
  for (const bad of ['memory:m1#nope', 'memory:m1#', 'memory:m1#trend#extra']) {
    assert.equal(parseAssetFocus(bad), null, `${bad} is not a valid focus`);
  }
});

test('applying a trend focus opens the trend control of that asset', () => {
  const opened: string[] = [];
  const trend = { click: () => opened.push('trend'), closest: () => null };
  const audit = { click: () => opened.push('audit'), closest: () => null };
  const root = { querySelector: (selector: string) => selector === '[data-exp-trend="p1"]' ? trend : audit };
  assert.equal(applyAssetFocus(root, 'experience:p1#trend'), 'focused');
  assert.deepEqual(opened, ['trend']);
  assert.equal(applyAssetFocus(root, 'experience:p1'), 'focused');
  assert.deepEqual(opened, ['trend', 'audit']);
});

