import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const EXPECTED_BUNDLE_ID = 'dev.craft.workbench';
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function parsePlistValue(plist, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = plist.match(new RegExp(`<key>${escaped}<\\/key>\\s*<string>([^<]+)<\\/string>`));
  if (!match) throw new Error(`Info.plist 缺少 ${key}`);
  return match[1];
}

async function appDigest(bundlePath) {
  const root = await fs.realpath(bundlePath);
  const hash = createHash('sha256');
  async function visit(directory) {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const relative = path.relative(root, entryPath);
      const stat = await fs.lstat(entryPath);
      hash.update(`${relative}\0${stat.mode & 0o777}\0`);
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(entryPath);
        const resolved = path.resolve(path.dirname(entryPath), target);
        if (path.isAbsolute(target) || !inside(root, resolved)) throw new Error(`应用包包含越界符号链接：${relative}`);
        hash.update(`link\0${target}\0`);
      } else if (stat.isDirectory()) {
        hash.update('dir\0');
        await visit(entryPath);
      } else if (stat.isFile()) {
        hash.update('file\0');
        hash.update(await fs.readFile(entryPath));
      } else {
        throw new Error(`应用包包含不支持的文件类型：${relative}`);
      }
    }
  }
  await visit(root);
  return hash.digest('hex');
}

async function inspectBundle(bundlePath, expectedBundleId = EXPECTED_BUNDLE_ID) {
  if (typeof bundlePath !== 'string' || !path.isAbsolute(bundlePath) || !bundlePath.endsWith('.app')) {
    throw new Error('应用包必须是绝对路径且以 .app 结尾');
  }
  const rootStat = await fs.lstat(bundlePath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('应用包必须是真实目录，不能是符号链接');
  const plist = await fs.readFile(path.join(bundlePath, 'Contents', 'Info.plist'), 'utf8');
  const bundleId = parsePlistValue(plist, 'CFBundleIdentifier');
  const version = parsePlistValue(plist, 'CFBundleShortVersionString');
  if (bundleId !== expectedBundleId) throw new Error(`bundle identifier 不匹配：${bundleId}`);
  if (!VERSION_PATTERN.test(version)) throw new Error(`无效的应用版本：${version}`);
  return { bundle_id: bundleId, version, digest: await appDigest(bundlePath) };
}

export async function isStableAppRunning(stablePath, { platform = process.platform, run = spawnSync } = {}) {
  if (platform !== 'darwin') return false;
  const result = run('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (result.error) throw new Error(`无法检查应用是否运行：${result.error.message}`);
  if (result.status !== 0) throw new Error(`无法检查应用是否运行：${result.stderr || result.status}`);
  const executablePrefix = `${stablePath}/Contents/MacOS/`;
  return result.stdout.split('\n').some((line) => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    return Boolean(match && Number(match[1]) !== process.pid && match[2].includes(executablePrefix));
  });
}

async function copyVerified(sourcePath, stagingPath, expected, copyPath) {
  await copyPath(sourcePath, stagingPath, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false, preserveTimestamps: true });
  const staged = await inspectBundle(stagingPath);
  if (staged.version !== expected.version || staged.bundle_id !== expected.bundle_id || staged.digest !== expected.digest) {
    throw new Error('暂存应用包校验失败');
  }
}

async function readOptionalBundle(bundlePath) {
  try {
    return await inspectBundle(bundlePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function canonicalFuturePath(candidate, realPath) {
  let cursor = path.resolve(candidate);
  const suffix = [];
  while (true) {
    try {
      const real = await realPath(cursor);
      return path.join(real, ...suffix.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function readDirOrEmpty(directory, readdirPath = fs.readdir) {
  try {
    return await readdirPath(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function validateVersionDirectory(versionsPath, readdirPath) {
  const entries = await readDirOrEmpty(versionsPath, readdirPath);
  for (const entry of entries.filter((name) => name.endsWith('.app'))) {
    const bundle = await inspectBundle(path.join(versionsPath, entry));
    if (entry !== `${bundle.version}.app`) throw new Error(`受管版本目录与应用版本不匹配：${entry}`);
  }
}

async function ensureVersionDirectory(versionsPath, create = false, lstatPath = fs.lstat) {
  if (create) await fs.mkdir(versionsPath, { recursive: true });
  let info;
  try { info = await lstatPath(versionsPath); }
  catch (error) { if (!create && error?.code === 'ENOENT') return; throw error; }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('受管版本目录必须是真实目录');
}

async function validateLayout({ stablePath, versionsPath, dataRoot, realPath }) {
  if (![stablePath, versionsPath, dataRoot].every((value) => typeof value === 'string' && path.isAbsolute(value))) {
    throw new Error('应用路径、版本目录和 data_root 必须是绝对路径');
  }
  if (path.basename(stablePath) !== 'Craft Workbench.app') throw new Error('稳定应用路径必须以 Craft Workbench.app 结尾');
  if (versionsPath !== path.join(path.dirname(stablePath), '.craft-workbench-versions')) throw new Error('版本目录必须是稳定应用的同级受管目录');
  const realStable = await canonicalFuturePath(stablePath, realPath);
  const realVersions = await canonicalFuturePath(versionsPath, realPath);
  const realData = await canonicalFuturePath(dataRoot, realPath);
  if (inside(realStable, realData) || inside(realVersions, realData) || inside(realData, realStable) || inside(realData, realVersions)) {
    throw new Error('data_root 与应用或版本目录不能重叠（含符号链接目标）');
  }
}

async function status(stablePath, versionsPath, dataRoot, readdirPath, lstatPath) {
  await ensureVersionDirectory(versionsPath, false, lstatPath);
  const active = await readOptionalBundle(stablePath);
  const entries = await readDirOrEmpty(versionsPath, readdirPath);
  const candidates = [];
  for (const entry of entries.filter((name) => name.endsWith('.app'))) {
    const candidatePath = path.join(versionsPath, entry);
    const candidate = await inspectBundle(candidatePath);
    if (entry !== `${candidate.version}.app`) throw new Error(`受管版本目录与应用版本不匹配：${entry}`);
    if (!active || candidate.version !== active.version) candidates.push(candidate);
  }
  if (candidates.length > 1) throw new Error('受管目录中存在多个上一版本');
  const previous = candidates[0] ?? null;
  return {
    active_version: active?.version ?? null,
    rollback_version: previous?.version ?? null,
    bundle_id: active?.bundle_id ?? EXPECTED_BUNDLE_ID,
    app_path: stablePath,
    data_root: dataRoot,
    management: '本机固定版本管理；不提供签名、公证或自动升级',
  };
}

async function activate({ stablePath, versionsPath, dataRoot, action, bundlePath, isRunning, renamePath, copyPath, removePath, statPath, readdirPath, lstatPath }) {
  // Validate/create before inspecting or removing any managed bundle. A symlink
  // here could otherwise redirect cleanup outside the application directory.
  await ensureVersionDirectory(versionsPath, true, lstatPath);
  const active = await readOptionalBundle(stablePath);
  let sourcePath = bundlePath;
  let sourceInfo;
  if (action === 'rollback') {
    if (!active) throw new Error('当前没有已安装应用，无法回滚');
    // The manager stores exactly one validated inactive bundle; do not guess from an arbitrary folder name.
    const entries = await readDirOrEmpty(versionsPath, readdirPath);
    const candidates = entries.filter((entry) => entry.endsWith('.app'));
    if (candidates.length !== 1) throw new Error('没有唯一可用的上一版本');
    sourcePath = path.join(versionsPath, candidates[0]);
    sourceInfo = await inspectBundle(sourcePath);
    if (path.basename(sourcePath) !== `${sourceInfo.version}.app` || sourceInfo.version === active.version) throw new Error('上一版本目录与应用版本不匹配');
  } else {
    sourceInfo = await inspectBundle(sourcePath);
  }

  if (action === 'install' && active) throw new Error('应用已安装；请使用 upgrade');
  if (action === 'upgrade' && !active) throw new Error('尚未安装应用；请使用 install');
  if (active && sourceInfo.version === active.version) throw new Error('目标版本已经是当前版本');
  if (await isRunning(stablePath)) throw new Error('Craft Workbench 正在运行，已拒绝切换版本');

  if (active && action !== 'rollback') {
    const sameVersionCopy = path.join(versionsPath, `${active.version}.app`);
    const duplicate = await readOptionalBundle(sameVersionCopy);
    if (duplicate) {
      if (duplicate.digest !== active.digest) throw new Error(`同版本受管副本与当前应用内容不一致：${sameVersionCopy}`);
      await removePath(sameVersionCopy, { recursive: true });
    }
  }
  await validateVersionDirectory(versionsPath, readdirPath);
  const parentStat = await statPath(path.dirname(stablePath));
  const versionStat = await statPath(versionsPath);
  if (parentStat.dev !== versionStat.dev) throw new Error('应用与版本目录必须位于同一卷');
  const stagingPath = path.join(path.dirname(stablePath), `.craft-workbench-staging-${randomUUID()}.app`);
  const previousPath = active ? path.join(versionsPath, `${active.version}.app`) : null;
  let movedActive = false;
  let activated = false;
  let committed = false;
  let response;
  try {
    await copyVerified(sourcePath, stagingPath, sourceInfo, copyPath);
    if (!active) {
      await renamePath(stagingPath, stablePath);
      activated = true;
    } else {
      await renamePath(stablePath, previousPath);
      movedActive = true;
      await renamePath(stagingPath, stablePath);
      activated = true;
    }
    const installed = await inspectBundle(stablePath);
    if (installed.digest !== sourceInfo.digest || installed.version !== sourceInfo.version) throw new Error('切换后的应用读回校验失败');
    committed = true;
    if (action === 'rollback') {
      const duplicate = path.join(versionsPath, `${installed.version}.app`);
      const duplicateInfo = await readOptionalBundle(duplicate);
      if (duplicateInfo && duplicateInfo.digest === installed.digest) await removePath(duplicate, { recursive: true });
    }
    const retained = active ? active.version : null;
    for (const entry of await readdirPath(versionsPath)) {
      if (!entry.endsWith('.app') || entry === `${retained}.app`) continue;
      const managedPath = path.join(versionsPath, entry);
      const managed = await inspectBundle(managedPath);
      if (entry !== `${managed.version}.app`) throw new Error(`受管版本目录与应用版本不匹配：${entry}`);
      await fs.rm(managedPath, { recursive: true });
    }
    response = { ...(await status(stablePath, versionsPath, dataRoot, readdirPath)), action };
  } catch (error) {
    if (!committed && activated) {
      try {
        await renamePath(stablePath, stagingPath);
      } catch (moveError) {
        await removePath(stablePath, { recursive: true }).catch((removeError) => {
          throw new Error(`${error.message}；无法隔离失败版本：${moveError.message}；删除失败版本也失败：${removeError.message}`);
        });
      }
    }
    if (!committed && movedActive) await renamePath(previousPath, stablePath).catch((restoreError) => { throw new Error(`${error.message}；且旧版本恢复失败：${restoreError.message}`); });
    await fs.rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
  await fs.rm(stagingPath, { recursive: true, force: true });
  return response;
}

export async function manageFixedVersion({ action, bundlePath, stablePath, versionsPath, dataRoot, isRunning = isStableAppRunning, renamePath = fs.rename, copyPath = fs.cp, removePath = fs.rm, statPath = fs.stat, lstatPath = fs.lstat, realPath = fs.realpath, readdirPath = fs.readdir }) {
  await validateLayout({ stablePath, versionsPath, dataRoot, realPath });
  if (action === 'status') return status(stablePath, versionsPath, dataRoot, readdirPath, lstatPath);
  if (!['install', 'upgrade', 'rollback'].includes(action)) throw new Error(`不支持的操作：${action}`);
  if (action !== 'rollback' && typeof bundlePath !== 'string') throw new Error('install/upgrade 需要 .app 路径');
  return activate({ action, bundlePath, stablePath, versionsPath, dataRoot, isRunning, renamePath, copyPath, removePath, statPath, readdirPath, lstatPath });
}

export function defaultInstallLayout(home = os.homedir(), env = process.env) {
  const applications = path.join(home, 'Applications');
  return {
    stablePath: path.join(applications, 'Craft Workbench.app'),
    versionsPath: path.join(applications, '.craft-workbench-versions'),
    dataRoot: path.resolve(env.CRAFT_DATA_DIR || path.join(home, '.craft_data')),
  };
}
