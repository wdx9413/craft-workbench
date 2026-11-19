// @ts-nocheck
/**
 * app.js is the browser entry: one IIFE that renders the shell from the real
 * index.html and drives the Runtime over fetch. These tests boot that entry
 * against the project's own mock Runtime and exercise the user-visible
 * bindings — menus, palette, theme, rail, status bar, every mode page and the
 * hash router — instead of asserting on source text.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockServer } from '../scripts/mock-runtime-server.mjs';
import { installAppGlobals, settle } from './helpers/app-harness.mjs';
import { MODES } from '../web/mode-shell.js';

const root = new URL('..', import.meta.url);

async function withRuntime(run) {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    await new Promise((done) => server.close(done));
  }
}

let booted = false;

async function boot(base, hash = '#mode=control&page=tasks') {
  const env = installAppGlobals({ htmlPath: new URL('web/index.html', root), hash, base });
  if (!booted) {
    booted = true;
    await import(new URL('web/app.js', root).href);
  }
  await settle(20);
  return env;
}

test('the real app entry boots, routes every mode page and binds the shell', async () => {
  await withRuntime(async (base) => {
    const env = await boot(base);
    const doc = env.doc;
    try {
      assert.equal(doc.getElementById('app').getAttribute('data-mode'), 'control');

      // Menus open from their own buttons and close on an outside click.
      const fileMenu = doc.querySelector('[data-menu="file"]');
      fileMenu.click();
      assert.ok(doc.getElementById('top-menu'));
      doc.dispatchEvent({ type: 'click', target: doc.getElementById('app') });
      assert.equal(doc.getElementById('top-menu'), null);

      // Rail density cycles labels -> icons -> hidden -> labels.
      const rail = doc.getElementById('rail-toggle');
      rail.click();
      assert.equal(doc.getElementById('app').getAttribute('data-rail'), 'collapsed');
      rail.click();
      assert.equal(doc.getElementById('app').getAttribute('data-rail'), 'open');
      rail.click();
      assert.equal(doc.getElementById('app').getAttribute('data-rail'), 'icons');

      // Ctrl+K opens the palette; typing filters it; Escape closes it.
      doc.dispatchEvent({ type: 'keydown', key: 'k', ctrlKey: true, preventDefault() {} });
      assert.equal(doc.getElementById('palette-host').hidden, false);
      const input = doc.getElementById('palette-input');
      input.value = '设置';
      input.oninput();
      assert.match(doc.getElementById('palette-list').innerHTML, /设置/u);
      doc.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
      assert.equal(doc.getElementById('palette-host').hidden, true);

      // The status bar expands to its detail line.
      doc.getElementById('sb-toggle').click();
      assert.equal(doc.getElementById('statusbar').getAttribute('data-open'), 'true');

      // The summary probe drives both connection indicators.
      assert.equal(doc.getElementById('rail-status').getAttribute('data-state'), 'ok');
      assert.match(doc.getElementById('sb-counts').textContent, /^任务 \d+ · 文件夹 \d+ · 能力 \d+$/u);

      // Every routable page of every mode renders through the real router.
      const control = env.win.__craftWorkbench;
      assert.equal(typeof control, 'object');
      for (const [mode, definition] of Object.entries(MODES)) {
        const switched = control.mode(mode);
        assert.equal(switched.ok, true);
        assert.equal(switched.mode, mode);
        await settle(6);
        for (const page of definition.nav) {
          const result = control.navigate(page);
          assert.equal(result.ok, true, `${mode}/${page} navigates`);
          await settle(6);
          assert.equal(control.snapshot().page, page, `${mode}/${page} is the active page`);
          assert.ok(doc.getElementById('content').textContent.length > 0, `${mode}/${page} renders`);
        }
      }

      // A hash change is a navigation, never a task dispatch.
      globalThis.location.hash = '#page=settings';
      await settle(8);
      assert.equal(control.snapshot().page, 'settings');

      // Settings drives the real theme writer.
      const themeSelect = doc.getElementById('set-theme');
      assert.ok(themeSelect);
      themeSelect.value = 'dark';
      themeSelect.onchange();
      await settle(10);
      assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');

      // Walk every page's controls. A control may need a DOM feature the stub
      // does not model; that is allowed, but it must not leave the shell in a
      // failed state.
      for (const [mode, definition] of Object.entries(MODES)) {
        control.mode(mode);
        await settle(4);
        for (const page of definition.nav) {
          control.navigate(page);
          await settle(6);
          for (const region of [doc.getElementById('page-actions'), doc.getElementById('aside-panel'), doc.getElementById('content')]) {
            if (!region) continue;
            for (const button of region.querySelectorAll('button').slice(0, 24)) {
              if (button.disabled) continue;
              try { button.click(); } catch { /* stub may omit a node */ }
              await settle(2);
              const sheet = doc.getElementById('sheet-host');
              if (sheet && !sheet.hidden) {
                const back = sheet.querySelector('[data-sheet-back], #sheet-close');
                if (back) back.click();
              }
              doc.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
              await settle(2);
              assert.doesNotMatch(doc.getElementById('content').textContent, /页面运行出错/u,
                `${mode}/${page} control crashed`);
            }
          }
          control.mode(mode);
          control.navigate(page);
          await settle(4);
        }
      }
      assert.equal(control.snapshot().failed, false);
    } finally {
      env.restore();
    }
  });
});
