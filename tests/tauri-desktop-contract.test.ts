import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("Tauri desktop keeps the Workbench sidecar and untrusted embedded pages in separate capability scopes", async () => {
  const config = JSON.parse(await readFile(path.join(root, "desktop/src-tauri/tauri.conf.json"), "utf8"));
  const capability = JSON.parse(await readFile(path.join(root, "desktop/src-tauri/capabilities/default.json"), "utf8"));
  const rust = await readFile(path.join(root, "desktop/src-tauri/src/lib.rs"), "utf8");
  const sidecar = await readFile(path.join(root, "desktop/scripts/prepare-sidecar.mjs"), "utf8");
  assert.equal(config.app.withGlobalTauri, true);
  assert.deepEqual(config.app.windows, []);
  assert.deepEqual(capability.windows, ["main"]);
  assert.match(rust, /WebviewWindowBuilder::new\(&app, "embedded"/);
  assert.match(rust, /matches!\(parsed\.scheme\(\), "http" \| "https"\)/);
  assert.match(rust, /global_shortcut/);
  assert.match(rust, /tauri_plugin_notification/);
  assert.doesNotMatch(rust, /command\.env\("CRAFT_DATA_DIR"/);
  assert.match(rust, /recv_timeout/);
  assert.match(rust, /WebviewUrl::App\("index.html"/);
  assert.match(rust, /workbench_request/);
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const desktop = JSON.parse(await readFile(path.join(root, "desktop/package.json"), "utf8"));
  assert.equal(config.version, manifest.version);
  assert.equal(desktop.version, manifest.version);
  for (const file of ["Cargo.toml", "Cargo.lock"]) {
    const source = await readFile(path.join(root, "desktop/src-tauri", file), "utf8");
    assert.equal(source.match(/name = "craft-workbench-desktop"\r?\nversion = "([^"]+)"/u)?.[1], manifest.version);
  }
  assert.deepEqual(config.bundle.resources, { "../../dist/runtime/app/": "app/" });
  assert.match(rust, /Craft 本地运行时启动失败：/);
  assert.match(rust, /cli\.to_string_lossy\(\)\.replace\('\\\\', "\/"\)/);
  assert.match(sidecar, /prepareRuntimeArtifact\(resolve\(root, "\.\.\/craft"\), process.execPath, root\)/);
  assert.match(rust, /Craft API: /);
  assert.match(rust, /join\("\.\.\/\.\.\/\.\.\/craft"\)/);
  const artifact = JSON.parse(await readFile(path.join(root, "../craft/runtime-artifacts.json"), "utf8"));
  for (const target of ["dist/core", "dist/capability", "dist/bin"]) {
    assert.ok(artifact.runtime_copies.some((entry: { target: string }) => entry.target === target));
  }
});
