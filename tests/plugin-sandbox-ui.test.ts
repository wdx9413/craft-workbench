import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/app.css", import.meta.url), "utf8");

test("sandboxed 插件页面在无同源权限的 iframe 中渲染，不再显示占位文案", () => {
  assert.match(app, /createElement\('iframe'\)/u);
  assert.match(app, /setAttribute\('sandbox', 'allow-scripts'\)/u);
  assert.match(app, /srcdoc = sandbox\.html/u);
  assert.doesNotMatch(app, /沙箱页面（下一里程碑）/u);
  assert.match(css, /\.plugin-sandbox-frame/u);
});

test("沙箱 iframe 不授予同源与顶层导航权限", () => {
  assert.doesNotMatch(app, /allow-same-origin/u);
  assert.doesNotMatch(app, /allow-top-navigation/u);
});
