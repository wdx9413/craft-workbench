import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasThemeContrast, themeColor } from '../workbench/plugin-theme-colors.js';

test('themeColor accepts short and full hex colors and expands short channels', () => {
  assert.deepEqual(themeColor('#abc'), [170, 187, 204]);
  assert.deepEqual(themeColor('#102030'), [16, 32, 48]);
});

test('themeColor reads RGB channels and rejects invalid inputs', () => {
  assert.deepEqual(themeColor('rgb(15, 17, 21)'), [15, 17, 21]);
  assert.deepEqual(themeColor('rgba(255,0,12,0.5)'), [255, 0, 12]);
  assert.equal(themeColor(null as unknown as string), null);
  assert.equal(themeColor('#12'), null);
  assert.equal(themeColor('red'), null);
  assert.equal(themeColor('rgb(256, 0, 0)'), null);
});

test('plugin accents must meet WCAG AA contrast with the active host inverse text', () => {
  assert.equal(hasThemeContrast('#000', '#fff'), true);
  assert.equal(hasThemeContrast('#fff', '#000'), true);
  assert.equal(hasThemeContrast('#246', '#fff'), true);
  assert.equal(hasThemeContrast('#246', 'rgb(15,17,21)'), false);
  assert.equal(hasThemeContrast('#777', 'rgb(15,17,21)'), false);
  assert.equal(hasThemeContrast('bad', '#fff'), false);
});
