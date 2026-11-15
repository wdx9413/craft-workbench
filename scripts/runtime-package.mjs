import { createRequire } from 'node:module';
import { readFile, realpath, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const workbenchRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The runtime is always the installed npm package; no sibling source checkout is read. */
export async function resolveRuntime({ root = workbenchRoot } = {}) {
  const require = createRequire(resolve(root, 'package.json'));
  const packagePath = require.resolve('craft/package.json');
  const directory = await realpath(dirname(packagePath));
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (manifest.name !== 'craft') throw new Error('Selected package is not the Craft runtime');
  if (manifest.craftRuntime?.protocolVersion !== 1) throw new Error('Craft runtime protocol is incompatible; install a compatible runtime');
  const cli = resolve(directory, 'dist/core/cli.js');
  await access(cli);
  const runtimeRequire = createRequire(resolve(directory, 'package.json'));
  return { directory, cli, version: manifest.version, artifactModule: runtimeRequire.resolve('craft/runtime-artifact') };
}

export async function prepareSidecar(root = workbenchRoot) {
  const runtime = await resolveRuntime({ root });
  const { prepareRuntimeArtifact } = await import(pathToFileURL(runtime.artifactModule).href);
  return prepareRuntimeArtifact(runtime.directory, process.execPath, root);
}
