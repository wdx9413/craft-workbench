import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { defaultInstallLayout, manageFixedVersion } from './fixed-version-manager.mjs';

export const FIXED_VERSION_USAGE = '用法：pnpm --dir desktop run version-manager -- <status|install|upgrade|rollback> [绝对路径/Craft Workbench.app]';

export function parseFixedVersionArgs(args) {
  const [action, bundlePath, ...extra] = args;
  if (!['status', 'install', 'upgrade', 'rollback'].includes(action) || extra.length > 0) throw new Error(FIXED_VERSION_USAGE);
  if ((action === 'install' || action === 'upgrade') && typeof bundlePath !== 'string') throw new Error(FIXED_VERSION_USAGE);
  if ((action === 'status' || action === 'rollback') && bundlePath !== undefined) throw new Error(FIXED_VERSION_USAGE);
  return { action, bundlePath };
}

export async function executeFixedVersionCommand({ args, platform = process.platform, layout = defaultInstallLayout(), manager = manageFixedVersion }) {
  const parsed = parseFixedVersionArgs(args);
  if (parsed.action !== 'status' && platform !== 'darwin') throw new Error('固定版本安装、升级和回滚目前只支持 macOS');
  return manager({ ...layout, ...parsed });
}

export async function main({ args = process.argv.slice(2), platform = process.platform, layout = defaultInstallLayout(), manager = manageFixedVersion, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const result = await executeFixedVersionCommand({ args, platform, layout, manager });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

export async function launchMain({ setExitCode = (code) => { process.exitCode = code; }, ...parameters } = {}) {
  const code = await main(parameters);
  setExitCode(code);
  return code;
}

export async function runIfMain(moduleUrl, entryPath, runMain) {
  if (!entryPath || pathToFileURL(path.resolve(entryPath)).href !== moduleUrl) return null;
  return runMain();
}

await runIfMain(import.meta.url, process.argv[1], launchMain);
