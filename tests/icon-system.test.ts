import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const logo = readFileSync(new URL("../web/craft-logo.svg", import.meta.url), "utf8");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const ui = readFileSync(new URL("../web/ui.js", import.meta.url), "utf8");

test("品牌符号是纯 SVG 线性图标，不再内嵌位图或字母", () => {
  assert.match(logo, /<svg[^>]+viewBox="0 0 16 16"/u);
  assert.match(logo, /stroke="currentColor"/u);
  assert.doesNotMatch(logo, /base64|<image|data:image/u);
  assert.doesNotMatch(logo, /<text|>[A-Za-z]<\/text>|aria-label="[A-Za-z]"|M11\.4 3\.4a5\.2/u);
  assert.match(logo, /有界回路|受治理/u);
});

test("左侧图标栏不再渲染 C 字母标记", () => {
  assert.doesNotMatch(html, /rail-brand|class="mark"|M11\.4 3\.4a5\.2/u);
  assert.match(html, /<title>Craft Workbench<\/title>/u);
});

test("图标体系统一为 16x16 描边且设置图标与滑块区分", () => {
  assert.match(ui, /var ICONS = \{/u);
  assert.match(ui, /viewBox="0 0 16 16"/u);
  const gear = /settings:\s*'([^']+)'/u.exec(ui)?.[1] ?? "";
  const sliders = /sliders:\s*'([^']+)'/u.exec(ui)?.[1] ?? "";
  assert.match(gear, /M8 1\.9/u);
  assert.notEqual(gear, sliders);
});
