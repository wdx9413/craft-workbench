import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");

test("模型配置页直接接收密钥值，不再引导用户设置环境变量", () => {
  assert.match(app, /id="w-apikey" type="password"/u);
  assert.match(app, /api\('\/api\/settings\/secrets', \{ method: 'PUT'/u);
  assert.match(app, /直接粘贴 API 密钥即可/u);
  assert.doesNotMatch(app, /environmentGuidance\(/u, "不再生成 export KEY=... 引导");
  assert.doesNotMatch(app, /请为 Craft 设置环境变量|从同一终端启动 Craft/u);
  assert.doesNotMatch(app, /#w-env-cmd/u, "旧的复制环境变量命令入口已移除");
  // 高级选项仍允许部署场景覆盖凭据名，但不再是主流程要求。
  assert.match(app, /凭据名（高级）/u);
});
