import { spawnSync } from 'node:child_process';

const env = { ...process.env };
env.npm_config_verify_deps_before_run = 'false';
const includes = ['web/mode-pages.js', 'web/workshop-page.js', 'web/control-page.js', 'web/pilot-page.js', 'web/session-form.js'];
const result = spawnSync('node', ['--experimental-strip-types', '--test', '--test-isolation=none',
  '--experimental-test-coverage', ...includes.flatMap((file) => ['--test-coverage-include', file]),
  'tests/mode-pages.test.ts', 'tests/three-mode-consistency.test.ts', 'tests/three-mode-journey.test.ts'],
  { encoding: 'utf8', env, maxBuffer: 1024 * 1024 * 10 });
console.log(result.stdout.split('\n').filter((line) => /mode-pages|workshop-page|control-page|pilot-page|session-form|all files|coverage/.test(line)).join('\n'));
console.log('exit', result.status);
