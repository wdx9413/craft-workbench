import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultInstallLayout, isStableAppRunning, manageFixedVersion } from '../desktop/scripts/fixed-version-manager.mjs';
import { executeFixedVersionCommand, launchMain, main as runFixedVersionCli, parseFixedVersionArgs, runIfMain } from '../desktop/scripts/fixed-version-manager-cli.mjs';

const BUNDLE_ID = 'dev.craft.workbench';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'craft-fixed-version-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const applications = path.join(root, 'Applications');
  const stablePath = path.join(applications, 'Craft Workbench.app');
  const versionsPath = path.join(applications, '.craft-workbench-versions');
  const dataRoot = path.join(root, 'data');
  await fs.mkdir(applications, { recursive: true });
  await fs.mkdir(dataRoot);
  await fs.writeFile(path.join(dataRoot, 'user-data.txt'), 'leave untouched');
  const createBundle = async (version, bundleId = BUNDLE_ID) => {
    const bundle = path.join(root, `Craft-${version}.app`);
    const contents = path.join(bundle, 'Contents');
    await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await fs.writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`);
    await fs.writeFile(path.join(contents, 'MacOS', 'Craft Workbench'), `app ${version}`);
    return bundle;
  };
  const manage = (action, bundlePath) => manageFixedVersion({ action, bundlePath, stablePath, versionsPath, dataRoot, isRunning: async () => false });
  return { root, stablePath, versionsPath, dataRoot, createBundle, manage };
}

test('installs, upgrades, rolls back fixed app versions while preserving the data root', async (t) => {
  const f = await fixture(t);
  const v1 = await f.createBundle('0.18.0');
  const installed = await f.manage('install', v1);
  assert.equal(installed.active_version, '0.18.0');
  assert.equal((await fs.lstat(f.stablePath)).isDirectory(), true);
  assert.equal((await fs.readFile(path.join(f.stablePath, 'Contents/MacOS/Craft Workbench'), 'utf8')), 'app 0.18.0');
  const v2 = await f.createBundle('0.19.0');
  const upgraded = await f.manage('upgrade', v2);
  assert.equal(upgraded.active_version, '0.19.0');
  assert.equal(upgraded.rollback_version, '0.18.0');
  const rolledBack = await f.manage('rollback');
  assert.equal(rolledBack.active_version, '0.18.0');
  assert.equal(rolledBack.rollback_version, '0.19.0');
  assert.equal(rolledBack.data_root, f.dataRoot);
  assert.equal(await fs.readFile(path.join(f.dataRoot, 'user-data.txt'), 'utf8'), 'leave untouched');
  assert.equal((await fs.lstat(f.stablePath)).isSymbolicLink(), false);
});

test('rejects a bundle with the wrong identifier and leaves stable app absent', async (t) => {
  const f = await fixture(t);
  const bad = await f.createBundle('0.19.0', 'dev.other.app');
  await assert.rejects(f.manage('install', bad), /bundle identifier/);
  await assert.rejects(fs.lstat(f.stablePath), { code: 'ENOENT' });
});

test('refuses upgrade while the stable app is running', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  await assert.rejects(manageFixedVersion({ action: 'upgrade', bundlePath: await f.createBundle('0.19.0'), stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, isRunning: async () => true }), /正在运行/);
  assert.equal((await fs.readFile(path.join(f.stablePath, 'Contents/MacOS/Craft Workbench'), 'utf8')), 'app 0.18.0');
});

test('status reports exactly the previous validated bundle after upgrade and rollback', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  await f.manage('upgrade', await f.createBundle('0.19.0'));
  assert.deepEqual(await f.manage('status'), {
    active_version: '0.19.0', rollback_version: '0.18.0', bundle_id: BUNDLE_ID,
    app_path: f.stablePath, data_root: f.dataRoot,
    management: '本机固定版本管理；不提供签名、公证或自动升级',
  });
  await f.manage('rollback');
  assert.equal((await f.manage('status')).rollback_version, '0.19.0');
});

test('restores the old stable app when staged activation rename fails', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  const update = await f.createBundle('0.19.0');
  let renameCalls = 0;
  const renamePath = async (...args) => {
    renameCalls += 1;
    if (renameCalls === 2) throw new Error('synthetic activation rename failure');
    return fs.rename(...args);
  };
  await assert.rejects(manageFixedVersion({ action: 'upgrade', bundlePath: update, stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, isRunning: async () => false, renamePath }), /synthetic activation rename failure/);
  assert.equal((await fs.readFile(path.join(f.stablePath, 'Contents/MacOS/Craft Workbench'), 'utf8')), 'app 0.18.0');
  assert.equal((await f.manage('status')).active_version, '0.18.0');
  assert.deepEqual((await fs.readdir(f.versionsPath)).filter((entry) => entry.endsWith('.app')), []);
});

test('rejects a data_root symlink whose resolved target overlaps the installed app', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  const link = path.join(f.root, 'data-alias');
  await fs.symlink(path.join(f.stablePath, 'Contents'), link, 'dir');
  await assert.rejects(manageFixedVersion({ action: 'status', stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: link }), /不能重叠/);
});

test('rejects version directory names that do not match embedded bundle versions', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  await fs.mkdir(f.versionsPath, { recursive: true });
  await fs.cp(await f.createBundle('0.19.0'), path.join(f.versionsPath, '0.20.0.app'), { recursive: true });
  await assert.rejects(f.manage('status'), /目录与应用版本不匹配/);
});

test('rejects rollback without exactly one previous version and rejects unsupported operations', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.manage('rollback'), /当前没有已安装应用/);
  await assert.rejects(f.manage('upgrade'), /install\/upgrade 需要/);
  await assert.rejects(f.manage('upgrade', await f.createBundle('0.18.0')), /尚未安装应用/);
  await f.manage('install', await f.createBundle('0.18.0'));
  await assert.rejects(f.manage('rollback'), /没有唯一可用的上一版本/);
  await assert.rejects(f.manage('remove'), /不支持的操作/);
});

test('CLI parses, dispatches, reports exit status and keeps app/data paths fixed', async (t) => {
  const f = await fixture(t);
  const layout = { stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot };
  assert.deepEqual(parseFixedVersionArgs(['status']), { action: 'status', bundlePath: undefined });
  assert.throws(() => parseFixedVersionArgs(['status', '/override']), /用法/);
  assert.throws(() => parseFixedVersionArgs(['install', '/bundle.app', '/override']), /用法/);
  assert.throws(() => parseFixedVersionArgs(['install']), /用法/);
  assert.throws(() => parseFixedVersionArgs(['rollback', '/bundle.app']), /用法/);
  assert.throws(() => parseFixedVersionArgs(['remove']), /用法/);
  await assert.rejects(executeFixedVersionCommand({ args: ['install', '/bundle.app'], platform: 'linux', layout }), /只支持 macOS/);
  const stdout = { value: '', write(text) { this.value += text; } };
  const stderr = { value: '', write(text) { this.value += text; } };
  const run = async (args) => {
    stdout.value = '';
    return runFixedVersionCli({ args, platform: 'darwin', layout, stdout, stderr });
  };
  const statusBefore = await run(['status']);
  assert.equal(statusBefore, 0);
  assert.equal(JSON.parse(stdout.value).active_version, null);
  const v1 = await f.createBundle('0.18.0');
  assert.equal(await run(['install', v1]), 0);
  const v2 = await f.createBundle('0.19.0');
  assert.equal(await run(['upgrade', v2]), 0);
  assert.equal(await run(['rollback']), 0);
  assert.equal(JSON.parse(stdout.value).active_version, '0.18.0');
  assert.equal(JSON.parse(stdout.value).data_root, f.dataRoot);
  assert.equal(await runFixedVersionCli({ args: ['remove'], layout, stdout, stderr }), 1);
  assert.match(stderr.value, /用法/);
  const moduleUrl = new URL('../desktop/scripts/fixed-version-manager-cli.mjs', import.meta.url).href;
  assert.equal(await runIfMain(moduleUrl, undefined, async () => 'ran'), null);
  assert.equal(await runIfMain(moduleUrl, new URL('../desktop/scripts/fixed-version-manager-cli.mjs', import.meta.url).pathname, async () => 'ran'), 'ran');
  let exitCode;
  assert.equal(await launchMain({ args: ['status'], platform: 'darwin', layout, stdout, stderr, setExitCode: (code) => { exitCode = code; } }), 0);
  assert.equal(exitCode, 0);
});

test('validates malformed paths, bundle metadata, symlinks, and special files', async (t) => {
  const f = await fixture(t);
  const call = (options) => manageFixedVersion({ stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, isRunning: async () => false, ...options });
  await assert.rejects(call({ action: 'install', bundlePath: 'relative.app' }), /绝对路径/);
  await assert.rejects(call({ action: 'install', bundlePath: path.join(f.root, 'wrong-name') }), /结尾/);
  await assert.rejects(call({ action: 'install', bundlePath: path.join(f.root, 'missing.app') }), { code: 'ENOENT' });
  const malformed = path.join(f.root, 'Malformed.app');
  await fs.mkdir(path.join(malformed, 'Contents'), { recursive: true });
  await fs.writeFile(path.join(malformed, 'Contents', 'Info.plist'), '<plist/>');
  await assert.rejects(call({ action: 'install', bundlePath: malformed }), /缺少 CFBundleIdentifier/);
  const invalidVersion = await f.createBundle('v1');
  await assert.rejects(call({ action: 'install', bundlePath: invalidVersion }), /无效的应用版本/);
  const linkBundle = await f.createBundle('0.20.0');
  const resources = path.join(linkBundle, 'Contents', 'Resources');
  await fs.mkdir(resources);
  await fs.symlink('../MacOS/Craft Workbench', path.join(resources, 'executable-link'));
  assert.equal((await call({ action: 'install', bundlePath: linkBundle })).active_version, '0.20.0');
  const escaped = await f.createBundle('0.21.0');
  await fs.symlink(f.dataRoot, path.join(escaped, 'Contents', 'external-link'));
  await assert.rejects(call({ action: 'upgrade', bundlePath: escaped }), /越界符号链接/);
  const fifoBundle = await f.createBundle('0.22.0');
  const fifo = path.join(fifoBundle, 'Contents', 'pipe');
  const madePipe = spawnSync('mkfifo', [fifo]);
  assert.equal(madePipe.status, 0);
  await assert.rejects(call({ action: 'upgrade', bundlePath: fifoBundle }), /不支持的文件类型/);
});

test('covers injected copy verification and same-volume failure paths', async (t) => {
  const f = await fixture(t);
  const bundle = await f.createBundle('0.18.0');
  const copyPath = async (source, destination, options) => {
    await fs.cp(source, destination, options);
    const plist = path.join(destination, 'Contents', 'Info.plist');
    await fs.writeFile(plist, (await fs.readFile(plist, 'utf8')).replace('0.18.0', '9.9.9'));
  };
  await assert.rejects(manageFixedVersion({ action: 'install', bundlePath: bundle, stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, isRunning: async () => false, copyPath }), /暂存应用包校验失败/);
  await assert.rejects(manageFixedVersion({ action: 'install', bundlePath: bundle, stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, isRunning: async () => false, statPath: async (target) => ({ dev: target === f.versionsPath ? 2 : 1 }) }), /同一卷/);
  assert.equal(await fs.stat(f.stablePath).then(() => true, () => false), false);
});

test('rejects restore failures and mismatched rollback directories without replacing the stable app', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  const v2 = await f.createBundle('0.19.0');
  let calls = 0;
  const brokenRestore = async (...args) => {
    calls += 1;
    if (calls === 2 || calls === 3) throw new Error(`rename ${calls} failed`);
    return fs.rename(...args);
  };
  await assert.rejects(manageFixedVersion({ action: 'upgrade', bundlePath: v2, stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, isRunning: async () => false, renamePath: brokenRestore }), /旧版本恢复失败/);
  assert.equal(await fs.stat(f.stablePath).then(() => true, () => false), false);
  await fs.rename(path.join(f.versionsPath, '0.18.0.app'), f.stablePath);
  const mislabeled = path.join(f.versionsPath, 'wrong.app');
  await fs.cp(v2, mislabeled, { recursive: true });
  await assert.rejects(f.manage('rollback'), /目录与应用版本不匹配/);
});

test('guards status symlinks, overlapping layouts, and install state transitions', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.manage('status')).active_version, null);
  await assert.rejects(manageFixedVersion({ action: 'status', stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.root }), /不能重叠/);
  await assert.rejects(manageFixedVersion({ action: 'status', stablePath: f.stablePath, versionsPath: path.join(f.root, 'elsewhere'), dataRoot: f.dataRoot }), /同级受管目录/);
  await f.manage('install', await f.createBundle('0.18.0'));
  await assert.rejects(f.manage('install', await f.createBundle('0.19.0')), /应用已安装/);
  await assert.rejects(f.manage('upgrade', await f.createBundle('0.18.0')), /已经是当前版本/);
  const duplicate = path.join(f.versionsPath, '0.18.0.app');
  await fs.cp(f.stablePath, duplicate, { recursive: true });
  await fs.writeFile(path.join(duplicate, 'Contents', 'MacOS', 'Craft Workbench'), 'changed');
  await assert.rejects(f.manage('upgrade', await f.createBundle('0.19.0')), /内容不一致/);
  const symlinked = path.join(f.root, 'Craft Workbench.app');
  await fs.symlink(f.stablePath, symlinked, 'dir');
  await assert.rejects(manageFixedVersion({ action: 'status', stablePath: symlinked, versionsPath: path.join(f.root, '.craft-workbench-versions'), dataRoot: f.dataRoot }), /必须是真实目录/);
  await assert.rejects(manageFixedVersion({ action: 'status', stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, readdirPath: async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); } }), /permission denied/);
  await assert.rejects(manageFixedVersion({ action: 'status', stablePath: path.join(f.root, 'bad-name.app'), versionsPath: path.join(f.root, '.craft-workbench-versions'), dataRoot: f.dataRoot }), /Craft Workbench.app/);
  await assert.rejects(manageFixedVersion({ action: 'status', stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, realPath: async () => { throw Object.assign(new Error('root traversal failed'), { code: 'ENOENT' }); } }), /root traversal failed/);
});

test('rejects a symlinked version directory before removing a duplicate active bundle', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  const outside = path.join(f.root, 'outside-versions');
  await fs.mkdir(outside);
  await fs.cp(f.stablePath, path.join(outside, '0.18.0.app'), { recursive: true });
  await fs.rm(f.versionsPath, { recursive: true, force: true });
  await fs.symlink(outside, f.versionsPath, 'dir');

  await assert.rejects(f.manage('upgrade', await f.createBundle('0.19.0')), /必须是真实目录/);
  assert.equal((await fs.lstat(path.join(outside, '0.18.0.app'))).isDirectory(), true);
  assert.equal((await fs.readFile(path.join(outside, '0.18.0.app', 'Contents', 'MacOS', 'Craft Workbench'), 'utf8')), 'app 0.18.0');
  assert.equal((await fs.readFile(path.join(f.stablePath, 'Contents', 'MacOS', 'Craft Workbench'), 'utf8')), 'app 0.18.0');
});

test('status propagates unexpected version-directory inspection errors', async (t) => {
  const f = await fixture(t);
  await assert.rejects(manageFixedVersion({
    action: 'status', stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot,
    lstatPath: async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); },
  }), /permission denied/);
});

test('rejects multiple rollback candidates, unsafe managed directories, and mismatched update slots', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  await fs.mkdir(f.versionsPath, { recursive: true });
  await fs.cp(await f.createBundle('0.17.0'), path.join(f.versionsPath, '0.17.0.app'), { recursive: true });
  await fs.cp(await f.createBundle('0.16.0'), path.join(f.versionsPath, '0.16.0.app'), { recursive: true });
  await assert.rejects(f.manage('status'), /多个上一版本/);
  await assert.rejects(f.manage('rollback'), /没有唯一可用的上一版本/);
  await fs.rm(f.versionsPath, { recursive: true });
  const alternateStore = path.join(f.root, 'alternate-store');
  await fs.mkdir(alternateStore);
  await fs.symlink(alternateStore, f.versionsPath, 'dir');
  await assert.rejects(f.manage('upgrade', await f.createBundle('0.19.0')), /必须是真实目录/);
  await fs.unlink(f.versionsPath);
  await fs.mkdir(f.versionsPath);
  await fs.cp(await f.createBundle('0.17.0'), path.join(f.versionsPath, 'wrong.app'), { recursive: true });
  await assert.rejects(f.manage('upgrade', await f.createBundle('0.19.0')), /目录与应用版本不匹配/);
  assert.equal((await fs.readFile(path.join(f.stablePath, 'Contents', 'Info.plist'), 'utf8')).includes('<string>0.18.0</string>'), true);
  await assert.rejects(manageFixedVersion({ action: 'status', stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, realPath: async () => { throw Object.assign(new Error('inaccessible path'), { code: 'EACCES' }); } }), /inaccessible path/);
  const wrongCopy = path.join(f.versionsPath, 'raced.app');
  await fs.cp(await f.createBundle('0.16.0'), wrongCopy, { recursive: true });
  let reads = 0;
  const changingReadDir = async (directory) => {
    reads += 1;
    if (reads === 1) return [];
    if (reads === 2) return ['raced.app'];
    return fs.readdir(directory);
  };
  await assert.rejects(manageFixedVersion({ action: 'upgrade', bundlePath: await f.createBundle('0.19.0'), stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, isRunning: async () => false, readdirPath: changingReadDir }), /目录与应用版本不匹配/);
});

test('compensates a failed readback after activating a corrupted staged app', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  const v2 = await f.createBundle('0.19.0');
  let calls = 0;
  const renamePath = async (from, to) => {
    calls += 1;
    if (calls === 2) {
      await fs.rename(from, to);
      await fs.writeFile(path.join(to, 'Contents', 'MacOS', 'Craft Workbench'), 'tampered after staging');
      return;
    }
    if (calls === 3) throw new Error('synthetic failed compensation move');
    return fs.rename(from, to);
  };
  await assert.rejects(manageFixedVersion({ action: 'upgrade', bundlePath: v2, stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, isRunning: async () => false, renamePath }), /切换后的应用读回校验失败/);
  assert.equal((await fs.readFile(path.join(f.stablePath, 'Contents/MacOS/Craft Workbench'), 'utf8')), 'app 0.18.0');
});

test('moves a corrupted activation aside before restoring the old stable app', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  const v2 = await f.createBundle('0.19.0');
  let calls = 0;
  const renamePath = async (from, to) => {
    calls += 1;
    await fs.rename(from, to);
    if (calls === 2) await fs.writeFile(path.join(to, 'Contents', 'MacOS', 'Craft Workbench'), 'tampered after staging');
  };
  await assert.rejects(manageFixedVersion({ action: 'upgrade', bundlePath: v2, stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, isRunning: async () => false, renamePath }), /切换后的应用读回校验失败/);
  assert.equal((await fs.readFile(path.join(f.stablePath, 'Contents', 'MacOS', 'Craft Workbench'), 'utf8')), 'app 0.18.0');
  assert.deepEqual((await fs.readdir(path.dirname(f.stablePath))).filter((name) => name.startsWith('.craft-workbench-staging-')), []);
});

test('reports when both quarantine and removal of a failed staged app are unavailable', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  const v2 = await f.createBundle('0.19.0');
  let calls = 0;
  const renamePath = async (from, to) => {
    calls += 1;
    if (calls === 2) {
      await fs.rename(from, to);
      await fs.writeFile(path.join(to, 'Contents', 'MacOS', 'Craft Workbench'), 'tampered after staging');
      return;
    }
    if (calls === 3) throw new Error('quarantine denied');
    return fs.rename(from, to);
  };
  const removePath = async () => { throw new Error('remove denied'); };
  await assert.rejects(manageFixedVersion({ action: 'upgrade', bundlePath: v2, stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, isRunning: async () => false, renamePath, removePath }), /删除失败版本也失败：remove denied/);
  assert.equal((await fs.readFile(path.join(f.versionsPath, '0.18.0.app', 'Contents', 'MacOS', 'Craft Workbench'), 'utf8')), 'app 0.18.0');
});

test('retains committed rollback when post-commit cleanup fails', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  await f.manage('upgrade', await f.createBundle('0.19.0'));
  const removePath = async () => { throw new Error('cleanup unavailable'); };
  await assert.rejects(manageFixedVersion({ action: 'rollback', stablePath: f.stablePath, versionsPath: f.versionsPath, dataRoot: f.dataRoot, isRunning: async () => false, removePath }), /cleanup unavailable/);
  assert.equal((await fs.readFile(path.join(f.stablePath, 'Contents', 'Info.plist'), 'utf8')).includes('<string>0.18.0</string>'), true);
});

test('removes an identical managed duplicate before reusing its version slot', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  await fs.mkdir(f.versionsPath, { recursive: true });
  await fs.cp(f.stablePath, path.join(f.versionsPath, '0.18.0.app'), { recursive: true });
  const updated = await f.manage('upgrade', await f.createBundle('0.19.0'));
  assert.equal(updated.active_version, '0.19.0');
  assert.equal(updated.rollback_version, '0.18.0');
});

test('prunes only validated stale app bundles while retaining the previous version', async (t) => {
  const f = await fixture(t);
  await f.manage('install', await f.createBundle('0.18.0'));
  await fs.mkdir(f.versionsPath, { recursive: true });
  await fs.cp(await f.createBundle('0.17.0'), path.join(f.versionsPath, '0.17.0.app'), { recursive: true });
  await fs.writeFile(path.join(f.versionsPath, 'operator-note.txt'), 'keep non-app files');
  const result = await f.manage('upgrade', await f.createBundle('0.19.0'));
  assert.equal(result.active_version, '0.19.0');
  assert.equal(result.rollback_version, '0.18.0');
  assert.deepEqual((await fs.readdir(f.versionsPath)).sort(), ['0.18.0.app', 'operator-note.txt']);
});

test('covers macOS running-process detection and CLI default roots without touching user data', async () => {
  const stablePath = '/tmp/Applications/Craft Workbench.app';
  assert.equal(await isStableAppRunning(stablePath, { platform: 'linux' }), false);
  const output = `${process.pid} ${stablePath}/Contents/MacOS/Craft Workbench\n42 unrelated\n`;
  assert.equal(await isStableAppRunning(stablePath, { platform: 'darwin', run: () => ({ status: 0, stdout: output }) }), false);
  assert.equal(await isStableAppRunning(stablePath, { platform: 'darwin', run: () => ({ status: 0, stdout: `42 ${stablePath}/Contents/MacOS/Craft Workbench\n` }) }), true);
  await assert.rejects(isStableAppRunning(stablePath, { platform: 'darwin', run: () => ({ error: new Error('ps missing') }) }), /ps missing/);
  await assert.rejects(isStableAppRunning(stablePath, { platform: 'darwin', run: () => ({ status: 1, stderr: 'ps denied' }) }), /ps denied/);
  await assert.rejects(isStableAppRunning(stablePath, { platform: 'darwin', run: () => ({ status: 1, stderr: '' }) }), /1/);
  assert.deepEqual(defaultInstallLayout('/tmp/person', {}), {
    stablePath: '/tmp/person/Applications/Craft Workbench.app',
    versionsPath: '/tmp/person/Applications/.craft-workbench-versions',
    dataRoot: '/tmp/person/.craft_data',
  });
  assert.equal(defaultInstallLayout('/tmp/person', { CRAFT_DATA_DIR: '/tmp/custom-data' }).dataRoot, '/tmp/custom-data');
  await assert.rejects(manageFixedVersion({ action: 'status', stablePath: 'relative.app', versionsPath: '/tmp/.craft-workbench-versions', dataRoot: '/tmp/data' }), /必须是绝对路径/);
  const originalExitCode = process.exitCode;
  await launchMain({ args: ['status'], platform: 'darwin', layout: { stablePath: '/tmp/person/Applications/Craft Workbench.app', versionsPath: '/tmp/person/Applications/.craft-workbench-versions', dataRoot: '/tmp/person/.craft_data' }, stdout: { write() {} }, stderr: { write() {} } });
  assert.equal(process.exitCode, 0);
  process.exitCode = originalExitCode;
});
