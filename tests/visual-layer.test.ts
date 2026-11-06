import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', 'workbench');
const read = (name: string) => readFile(path.join(root, name), 'utf8');

test('the Codex-inspired layer is linked after the base design system', async () => {
  const html = await read('index.html');
  const base = html.search(/href="\.\/app\.css(?:\?[^"]*)?"/u);
  const theme = html.search(/href="\.\/codex-theme\.css(?:\?[^"]*)?"/u);
  assert.ok(base > 0, 'base css is linked');
  assert.ok(theme > base, 'theme is linked after the base so it can override');
});

test('the visual layer defines its typography, palette, atmosphere and motion', async () => {
  const css = await read('codex-theme.css');
  for (const token of ['--cw-display', '--cw-mono', '--cw-sans', '--cw-ember', '--cw-cyan', '--cw-paper']) {
    assert.ok(css.includes(token + ':'), token);
  }
  assert.match(css, /radial-gradient/u, 'atmospheric background');
  assert.match(css, /@keyframes cw-rise/u, 'page-load motion');
  assert.match(css, /prefers-reduced-motion|@media \(max-width/u);
  assert.match(css, /\.home-agent \.agent-configuration/u, 'Codex-style compact home');
  assert.match(css, /\.mode-btn\[aria-selected="true"\] \.mode-btn-copy/u, 'active-only mode label');
  // No remote assets: strict same-origin CSP forbids CDN fonts.
  assert.doesNotMatch(css, /https?:\/\//u);
  assert.doesNotMatch(css, /@import/u);
});

test('app.js imports the extracted deep modules instead of duplicating them', async () => {
  const app = await read('app.js');
  assert.match(app, /from '\.\/ui\.js'/u);
  assert.match(app, /from '\.\/mode-pages\.js'/u);
  assert.doesNotMatch(app, /^  var ICONS = \{/mu);
  assert.doesNotMatch(app, /^  function viewHome\(/mu);
});

test('commands and mentions use separate surfaces, with a visible mode chip', async () => {
  const composer = await read('agent-workspace.js');
  assert.match(composer, /data-role="command-panel"/u);
  assert.match(composer, /agent-command-panel/u);
  assert.match(composer, /data-role="mode-chip"/u);
  assert.match(composer, /function renderCommandPanel/u);
  // The `+` menu must no longer masquerade as a mention token.
  assert.doesNotMatch(composer, /mentionTrigger = '\+'/u);
  const css = await read('app.css');
  assert.match(css, /\.agent-command-panel/u);
  assert.match(css, /\.agent-mode-chip/u);
});

test('every CSS custom property resolves to the design system in both themes', async () => {
  const css = (await read('app.css')) + '\n' + (await read('codex-theme.css'));
  const referenced = [...css.matchAll(/var\((--[a-z0-9-]+)/gu)].map(match => match[1]!);
  const declared = new Set([...css.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:/gmu)].map(match => match[1]!));
  const missing = [...new Set(referenced)].filter(token => !declared.has(token));
  assert.deepEqual(missing, [], 'undefined CSS variables fall back to light-mode literals in dark theme');
});

test('first-run model guidance is not disabled on the desktop shell', async () => {
  const app = await read('app.js');
  // Tauri starts with only a token fragment (no page), so excluding the native
  // shell would make the wizard unreachable. Explicit page navigation must not
  // be interrupted by the wizard.
  assert.doesNotMatch(app, /!nativeDesktop/u);
  assert.match(app, /!params\.has\('page'\)/u);
  assert.match(app, /onboarding\.completedAt/u);
});

test('Console 待我批准 offers batch selection and a floating approve/defer bar', async () => {
  const app = await read('app.js');
  const css = await read('app.css');
  // Per-card checkbox + a batch bar that decides each selected item with its own
  // /inbox/decide call (one effect, one authorization; never a merged semantic).
  assert.match(app, /data-approval-check=/u, 'each pending card is selectable');
  assert.match(app, /data-approval-batch="acknowledge"/u, 'batch approve action exists');
  assert.match(app, /data-approval-batch="defer"/u, 'batch defer action exists');
  assert.match(app, /批量批准/u, 'batch bar labels the approve affordance');
  // The batch handler maps the selected ids and calls the single-card decide
  // endpoint once per id (not a merged decision): assert both facts co-exist.
  assert.match(app, /Promise\.allSettled\(ids\.map\(function \(id\)[\s\S]*?\/api\/inbox\/decide/u, 'batch decides each item individually');
  // Partial failure must be reported by count and still repaint, not abort the whole batch.
  assert.match(app, /项失败需重试/u, 'partial failures are surfaced');
  // The selection must survive repaints but drop cards that are no longer open.
  assert.match(app, /state\.approvalSelection/u, 'selection is held across repaints');
  assert.match(css, /\.approval-check\b/u, 'checkbox has styling');
  assert.match(css, /\.approval-batch\b/u, 'batch bar has styling');
  assert.doesNotMatch(css, /https?:\/\//u, 'no remote assets');
});

test('mode switch never silently skips the active-task confirmation', async () => {
  const app = await read('app.js');
  // A failed /task-active-count lookup must conservatively ask, not commit the switch.
  assert.doesNotMatch(app, /\.catch\(function \(\) \{ commitModeSwitch\(mode\); \}\)/u);
  assert.match(app, /askUnknownActiveTasks/u, 'unknown count has an explicit confirmation path');
  assert.match(app, /Number\.isFinite\(active\)/u, 'malformed count is not treated as zero');
  // Explicit permission override must never bypass the gate either.
  assert.match(app, /active > 0 && !window\.confirm/u);
});

test('new-session permission default comes from the persisted workbench settings', async () => {
  const app = await read('app.js');
  assert.match(app, /settings\.workbench && settings\.workbench\.defaultPermission/u, 'reads config default');
  assert.match(app, /permissionMap\[configured\]/u, 'maps ask/auto/full into task permission modes');
  assert.match(app, /state\.composer\.permission = permissionMap\[configured\]/u, 'seeds the composer');
});
