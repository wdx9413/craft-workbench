import { spawn } from 'node:child_process';
import { resolveRuntime, workbenchRoot } from './runtime-package.mjs';

const mode = process.argv[2] ?? 'serve';
if (!['serve', 'gui', 'check'].includes(mode)) throw new Error('Expected serve, gui or check');
const runtime = await resolveRuntime();
if (mode === 'check') {
  console.log(`Craft runtime ${runtime.version}: protocol 1`);
} else {
  const child = spawn(process.execPath, [runtime.cli, mode, '--workbench-dir', `${workbenchRoot}/workbench`, ...process.argv.slice(3)], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
