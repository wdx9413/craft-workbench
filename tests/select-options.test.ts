// V1.4 · second incremental coverage gate for a module extracted from app.js.
// `options()` is called at 8 live sites in app.js; this module now owns the
// pure rendering contract so it can be verified without a DOM.
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderOptions } from '../workbench/select-options.js';

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

test('renderOptions marks only the matching value as selected and escapes content', () => {
  const html = renderOptions([['a', 'A'], ['b', 'B & <C>']], 'b', esc);
  assert.equal(html,
    '<option value="a">A</option><option value="b" selected>B &amp; &lt;C&gt;</option>');
});

test('renderOptions returns an empty string for empty / non-array pairs', () => {
  assert.equal(renderOptions([], 'a', esc), '');
  assert.equal(renderOptions(null, 'a', esc), '');
  assert.equal(renderOptions(undefined, 'a', esc), '');
  assert.equal(renderOptions('nope', 'a', esc), '');
});

test('renderOptions uses the injected esc, or a safe default when omitted', () => {
  const injected = renderOptions([['x', '<b>']], null, (v) => `!${v}!`);
  assert.equal(injected, '<option value="!x!">!<b>!</option>');
  const fallback = renderOptions([['x', '<b>']], null);
  assert.equal(fallback, '<option value="x"><b></option>');
  // non-function esc also falls back, exercising the nullish-coalescing branch
  const nonFunction = renderOptions([[null, undefined]], null, null);
  assert.equal(nonFunction, '<option value="" selected></option>');
});

test('renderOptions tolerates malformed pair entries without throwing', () => {
  const html = renderOptions([null, undefined, 'bad', 42, { x: 1 }, ['only']], 'only', esc);
  assert.equal((html.match(/<option/gu) ?? []).length, 6);
  assert.match(html, /<option value="only" selected><\/option>/u);
});

test('renderOptions keeps pair order; an undefined value matches undefined selected', () => {
  const html = renderOptions([[null, undefined], [undefined, null], [0, 0]], undefined, esc);
  assert.equal(html,
    '<option value=""></option><option value="" selected></option><option value="0">0</option>');
  // a concrete selected value does not spuriously match an undefined option
  const concrete = renderOptions([[undefined, 'none']], 'x', esc);
  assert.equal(concrete, '<option value="">none</option>');
});
