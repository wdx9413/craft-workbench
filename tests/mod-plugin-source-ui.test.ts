import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mods = readFileSync(new URL("../web/mod-pages.js", import.meta.url), "utf8");

test("插件声明的 Mod 在列表里显示来源，便于与自进化规则区分", () => {
  assert.match(mods, /m\.pluginId/u);
  assert.match(mods, /来自插件/u);
  assert.match(mods, /需插件在该工作区启用才注入/u);
  assert.match(mods, /自进化/u, "自进化来源标记仍在");
});
