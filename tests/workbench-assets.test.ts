import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { craftPaths } from "../../craft/core/infrastructure/paths.ts";
import { CraftService, VERSION } from "../../craft/core/service.ts";
import { CraftStore } from "../../craft/core/infrastructure/store.ts";
import { WorkbenchWebApp, workbenchBridge } from "../../craft/core/workbench-server.ts";

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
  for (const name of ["latest-request.js", "project-page.js", "runtime-client.js", "resource-pages.js", "model-setup.js", "entry-shell.js", "entry-session.js", "entry-view.js", "entry.css"]) {
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
  assert.match(workbenchScript, /\/api\/inbox\/refresh/);
  assert.match(workbenchScript, /\/api\/inbox\/decide/);
  assert.match(workbenchScript, /待我批准/);
  assert.match(workbenchScript, /viewApprovals/);
  // The nav entry and the view must agree, or the page is unreachable.
  assert.match(workbenchScript, /key: 'approvals'[\s\S]*?view: viewApprovals/);
  // Decisions must be persistence-backed: a deferred card needs a future instant.
  assert.match(workbenchScript, /deferred_until/);
  assert.equal(app.handle({ method: "GET", path: "/workbench/missing.css" }).status, 404);
  assert.equal(new WorkbenchWebApp(f.service, "studio-token", "http://127.0.0.1:4173", { workbenchDir: null })
    .handle({ method: "GET", path: "/workbench" }).status, 404);
  assert.equal(workbenchBridge(f.service), workbenchBridge(f.service));
  f.store.close();
});
