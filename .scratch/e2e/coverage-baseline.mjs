import { copyFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const backup = '.scratch/e2e/mode-pages.new.js';
copyFileSync('web/mode-pages.js', backup);
copyFileSync('.scratch/e2e/orig-mode-pages.js', 'web/mode-pages.js');

const env = { ...process.env };
env.npm_config_verify_deps_before_run = 'false';
const result = spawnSync('node', ['--experimental-strip-types', '--test', '--test-isolation=none',
  '--experimental-test-coverage', '--test-coverage-include=web/mode-pages.js', 'tests/mode-pages.test.ts',
  'tests/three-mode-consistency.test.ts', 'tests/three-mode-journey.test.ts'],
  { encoding: 'utf8', env, maxBuffer: 1024 * 1024 * 10 });

copyFileSync(backup, 'web/mode-pages.js');
console.log(result.stdout.split('\n').filter((line) => /mode-pages|all files|line coverage|branch coverage|function coverage/.test(line)).join('\n'));
console.log('exit', result.status);
