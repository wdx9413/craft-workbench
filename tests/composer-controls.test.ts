import assert from 'node:assert/strict';
import test from 'node:test';
import { bindComposerKeys, fitComposer, resizeComposers } from '../workbench/composer-controls.js';

function textarea() {
  const computed = { paddingTop: '4px', paddingBottom: '6px', borderTopWidth: '1px', borderBottomWidth: '1px', boxSizing: 'border-box' };
  const field: any = { tagName: 'TEXTAREA', style: {}, scrollHeight: 100, clientHeight: 100,
    getClientRects: () => [{}], ownerDocument: { defaultView: { getComputedStyle: () => computed } } };
  return { field, computed };
}

test('composer sizing preserves CSS constraints and handles both box models', () => {
  const { field, computed } = textarea();
  fitComposer(field);
  assert.deepEqual(field.style, { height: '102px', overflowY: 'hidden' });
  computed.boxSizing = 'content-box'; field.clientHeight = 60;
  fitComposer(field);
  assert.deepEqual(field.style, { height: '90px', overflowY: 'auto' });
  field.getClientRects = () => []; field.style = {};
  fitComposer(field); assert.deepEqual(field.style, {});
  field.tagName = 'INPUT'; fitComposer(field); assert.deepEqual(field.style, {});
  resizeComposers({ querySelectorAll: () => [] });
  field.tagName = 'TEXTAREA'; field.getClientRects = () => [{}];
  resizeComposers({ querySelectorAll: () => [field] });
  assert.equal(field.style.height, '90px');
});

test('Enter uses the existing send action exactly once and preserves newline/modifier keys', () => {
  const { field } = textarea(); let sends = 0, prevented = 0, picker = false;
  const send = { disabled: false, onclick: () => { sends++; } };
  const composing = bindComposerKeys(field, send, () => !picker);
  const key = (extra = {}) => field.onkeydown({ key: 'Enter', preventDefault: () => { prevented++; }, ...extra });
  assert.equal(composing(), false);
  key(); assert.equal(sends, 1); assert.equal(prevented, 1);
  for (const extra of [{ key: 'a' }, { shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) key(extra);
  assert.equal(sends, 1); assert.equal(prevented, 1);
  key({ repeat: true }); send.disabled = true; key();
  assert.equal(sends, 1); assert.equal(prevented, 3);
  send.disabled = false; picker = true; key();
  assert.equal(prevented, 3);
  field.onfocus(); assert.equal(field.style.height, '102px');
});

test('IME composition and legacy 229 never submit; subsequent Enter can send', () => {
  const { field } = textarea(); let sends = 0;
  const composing = bindComposerKeys(field, { disabled: false, onclick: () => { sends++; } }, () => true);
  const key = (extra = {}) => field.onkeydown({ key: 'Enter', preventDefault() {}, ...extra });
  field.oncompositionstart(); assert.equal(composing(), true); key();
  field.oncompositionend(); assert.equal(composing(), false);
  key({ isComposing: true }); key({ keyCode: 229 });
  assert.equal(sends, 0);
  key(); assert.equal(sends, 1);
  assert.equal(field.style.height, '102px');
});
