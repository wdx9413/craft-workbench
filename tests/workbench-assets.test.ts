import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { craftPaths, CraftService, CraftStore, WorkbenchWebApp, workbenchBridge } from "craft/runtime";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "craft-workbench-"));
  const store = await new CraftStore(craftPaths(root)).open();
  return { root, store, service: new CraftService(store) };
}

test("Craft Workbench serves the explicitly mounted presentation project", async () => {
  const f = await fixture();
  const repoRoot = path.resolve(import.meta.dirname, "..");

  const app = new WorkbenchWebApp(f.service, "studio-token", "http://127.0.0.1:4173", { workbenchDir: path.join(repoRoot, "workbench") });
  const index = app.handle({ method: "GET", path: "/workbench" });
  assert.equal(index.status, 200); assert.match(index.contentType, /text\/html/); assert.match(index.body, /Craft Workbench/);
  assert.equal(app.handle({ method: "GET", path: "/workbench/" }).status, 200);
  assert.deepEqual(app.handle({ method: "GET", path: "/" }), index);
  for (const name of ["latest-request.js", "project-page.js", "runtime-client.js", "agent-workspace.js", "composer-controls.js", "evaluation-panel.js", "project-shell.js", "resource-pages.js", "model-setup.js", "craft-logo.svg"]) {
    const rootAsset = app.handle({ method: "GET", path: `/${name}` });
    assert.equal(rootAsset.status, 200);
    assert.deepEqual(rootAsset, app.handle({ method: "GET", path: `/workbench/${name}` }));
    assert.equal(rootAsset.body, await readFile(path.join(repoRoot, "workbench", name), "utf8"));
  }
  assert.match(app.handle({ method: "GET", path: "/workbench/app.css" }).body, /--bg-rail/);
  assert.match(app.handle({ method: "GET", path: "/workbench/app.js" }).body, /workbench\/call/);
  // v0.12.34: the approval surface must actually be served and wired, not merely
  // described. The runtime's headline guarantee is an approval gate, so a Studio
  // without a place to approve is the inconsistency this release removes.
  const workbenchScript = app.handle({ method: "GET", path: "/workbench/app.js" }).body;
  assert.match(workbenchScript, /role="status" aria-live="polite" data-hook-diagnostics-status/u);
  // The desktop must land on the full workbench. Replacing it with the
  // conversation shell on boot hid the rail, settings and every capability page.
  assert.doesNotMatch(workbenchScript, /if \(nativeDesktop \|\| !params\.has\('page'\)\) projectShell\.show\(\)/u);
  assert.match(workbenchScript, /sessionsNav\.onclick/u);
  assert.match(index.body, /id="sessions-nav"/u);
  assert.match(index.body, /工作会话/u);
  // 三模式投影：标题栏中央必须存在模式切换挂载点，供 app.js 渲染工坊/控制台/领航。
  assert.match(index.body, /id="mode-switch"/u);
  const shellScript = app.handle({ method: "GET", path: "/workbench/project-shell.js" }).body;
  for (const page of ["home", "plugins", "models", "memory", "knowledge", "workflows", "settings"]) {
    assert.match(shellScript, new RegExp(`data-page="${page}"`, "u"));
  }
  assert.match(workbenchScript, /\/api\/inbox\/refresh/);
  assert.match(workbenchScript, /\/api\/inbox\/decide/);
  assert.match(workbenchScript, /待我批准/);
  assert.match(workbenchScript, /viewApprovals/);
  // The nav entry and the view must agree, or the page is unreachable.
  assert.match(workbenchScript, /key: 'approvals'[\s\S]*?view: viewApprovals/);
  // Decisions must be persistence-backed: a deferred card needs a future instant.
  assert.match(workbenchScript, /deferred_until/);
  // A human decision must be attributable: no hard-coded stand-in identities,
  // and the approval / subscription surfaces must actually render the signer.
  assert.doesNotMatch(workbenchScript, /'workbench-user'|'studio-user'/u,
    "a fake identity must never be written into a decision record");
  assert.match(workbenchScript, /function operatorOf\(\)/u);
  assert.match(workbenchScript, /granted_by: operatorOf\(\)/u);
  assert.match(workbenchScript, /esc\(item\.granted_by \|\| '未署名'\)/u);
  assert.match(workbenchScript, /esc\(item\.revoked_by\)/u);
  assert.match(workbenchScript, /signed|签名|署名/u);
  assert.equal(app.handle({ method: "GET", path: "/workbench/missing.css" }).status, 404);
  assert.equal(new WorkbenchWebApp(f.service, "studio-token", "http://127.0.0.1:4173", { workbenchDir: null })
    .handle({ method: "GET", path: "/workbench" }).status, 404);
  assert.equal(workbenchBridge(f.service), workbenchBridge(f.service));
  f.store.close();
});
