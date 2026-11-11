import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync(new URL("../web/ui.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");

test("设置页使用通用齿轮图标，不再复用滑块图标", () => {
  const gear = /settings:\s*'([^']+)'/u.exec(ui)?.[1] ?? "";
  const sliders = /sliders:\s*'([^']+)'/u.exec(ui)?.[1] ?? "";
  assert.match(gear, /M8 1\.9/u, "settings 应为齿轮路径");
  assert.notEqual(gear, sliders, "settings 不应与 sliders 同形");
  assert.match(app, /var SETTINGS_PAGE = \{[^}]*icon: 'settings'/u);
});
