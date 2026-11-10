import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTOMATION_VERSION, CONTROL_ENV, CONTROL_PATH, controlEnabled, isControlOrigin,
  navigateMode, navigatePage, snapshotSurface,
} from '../workbench/automation.js';

class TestLocation {
  hash: string;
  fail = false;
  constructor(hash: string) { this.hash = hash; }
  set next(value: string) { this.hash = value; }
}

test('the external-control contract is versioned and names its environment switch', () => {
  assert.equal(AUTOMATION_VERSION, 1);
  assert.equal(CONTROL_ENV, 'CRAFT_WORKBENCH_CONTROL');
  assert.equal(CONTROL_PATH, '/workbench-control');
});

test('a snapshot exposes projection state and never a token or host binding', () => {
  const state = { token: 'secret-value', surface: 'desktop', revision: 7, mode: 'pilot', page: 'pilot', title: '领航员', busy: false, failed: false,
    controls: [{ id: 'send', label: '发送', disabled: false }, { id: 'more', label: '更多', disabled: true }],
    api: () => { throw new Error('not callable'); } };
  const surface = snapshotSurface(state);
  assert.equal(surface.version, 1);
  assert.equal(surface.mode, 'pilot');
  assert.equal(surface.page, 'pilot');
  assert.equal(surface.title, '领航员');
  assert.equal(surface.token, false);
  assert.equal(surface.surface, 'desktop');
  assert.equal(surface.revision, 7);
  assert.equal(surface.api, undefined);
  assert.deepEqual(surface.controls, [
    { id: 'send', label: '发送', disabled: false },
    { id: 'more', label: '更多', disabled: true },
  ]);
  assert.ok(Object.isFrozen(surface));
  assert.ok(Object.isFrozen(surface.controls));
  assert.ok(Object.isFrozen(surface.controls[0]));
});

test('a malformed snapshot is honest instead of throwing or inventing state', () => {
  for (const value of [null, [], 'page', 3]) {
    const surface = snapshotSurface(value);
    assert.deepEqual(surface, { version: 1, token: false, surface: '', revision: 0, mode: '', page: '', title: '', busy: false, failed: false, controls: [] });
  }
  const surface = snapshotSurface({ controls: [null, { id: 4, label: 8 }, { disabled: 'yes' }] });
  assert.deepEqual(surface.controls, [
    { id: '', label: '', disabled: false },
    { id: '', label: '', disabled: false },
    { id: '', label: '', disabled: true },
  ]);
  assert.equal(snapshotSurface({ busy: 1, failed: 'true' }).busy, false);
  assert.equal(snapshotSurface({ busy: true, failed: true }).failed, true);
  assert.equal(snapshotSurface({ revision: -1 }).revision, 0);
  assert.equal(snapshotSurface({ revision: 2.5 }).revision, 0);
});

test('only local Workbench origins may be controlled', () => {
  assert.equal(isControlOrigin('http://127.0.0.1'), true);
  assert.equal(isControlOrigin('http://localhost'), true);
  assert.equal(isControlOrigin('tauri://localhost'), true);
  assert.equal(isControlOrigin('https://localhost'), false);
  assert.equal(isControlOrigin('http://127.0.0.1:4317'), false);
  assert.equal(isControlOrigin('https://evil.example'), false);
  assert.equal(isControlOrigin(undefined), false);
});

test('the control assertion defaults to local-on and is ignored from a remote origin', () => {
  assert.equal(controlEnabled('1', 'http://localhost'), true);
  assert.equal(controlEnabled('TRUE', 'tauri://localhost'), true);
  assert.equal(controlEnabled(' yes ', 'http://127.0.0.1'), true);
  assert.equal(controlEnabled(undefined, 'http://localhost'), true);
  assert.equal(controlEnabled('', 'tauri://localhost'), true);
  assert.equal(controlEnabled('0', 'http://localhost'), false);
  assert.equal(controlEnabled('false', 'tauri://localhost'), false);
  assert.equal(controlEnabled('no', 'http://127.0.0.1'), false);
  assert.equal(controlEnabled('0', 'http://localhost'), false);
  assert.equal(controlEnabled('1', 'https://evil.example'), false);
});

test('page navigation changes only the page selector and preserves identity', () => {
  const location = new TestLocation('#token=abc&page=settings&task=task%2F1');
  const known = (page: string) => page === 'plugins';
  const visible = () => true;
  assert.deepEqual(navigatePage(location, 'plugins', known, visible), { ok: true, page: 'plugins', navigated: true });
  assert.equal(location.hash, '#token=abc&page=plugins&task=task%2F1');
  const again = navigatePage(location, 'plugins', known, visible);
  assert.deepEqual(again, { ok: true, page: 'plugins', navigated: false });
  assert.equal(location.hash, '#token=abc&page=plugins&task=task%2F1');
});

test('page navigation rejects unknown, hidden or non-string targets', () => {
  const location = new TestLocation('#token=abc&page=pilot');
  const known = (page: string) => page === 'plugins';
  const visible = (page: string) => page !== 'plugins';
  assert.deepEqual(navigatePage(location, 'unknown', known, visible), { ok: false, reason: 'unknown_page' });
  assert.deepEqual(navigatePage(location, 'plugins', known, visible), { ok: false, reason: 'page_not_visible' });
  for (const value of ['', null, 3]) {
    assert.deepEqual(navigatePage(location, value, known, () => true), { ok: false, reason: 'unknown_page' });
  }
  assert.equal(location.hash, '#token=abc&page=pilot');
  assert.deepEqual(navigatePage(location, 'plugins', null, () => true), { ok: false, reason: 'unknown_page' });
  assert.deepEqual(navigatePage(location, 'plugins', known, null), { ok: false, reason: 'page_not_visible' });
  const broken = new TestLocation('#token=abc');
  Object.defineProperty(broken, 'hash', { get: () => '', set: () => { throw new Error('locked'); } });
  assert.deepEqual(navigatePage(broken, 'plugins', known, () => true), { ok: false, reason: 'navigation_failed' });
});

test('page navigation tolerates a missing location hash', () => {
  const location = { hash: undefined };
  assert.equal(navigatePage(location, 'plugins', page => page === 'plugins', () => true).navigated, true);
  assert.equal(location.hash, '#page=plugins');
});

test('mode navigation lands on that mode home and rejects unknown modes', () => {
  const location = new TestLocation('#token=abc&page=settings&task=task%2F1');
  const known = (page: string) => ['pilot', 'tasks'].includes(page);
  const visible = () => true;
  const home = (mode: string) => mode === 'pilot' ? 'pilot' : mode === 'control' ? 'tasks' : '';
  assert.deepEqual(navigateMode(location, 'control', home, known, visible), { ok: true, page: 'tasks', navigated: true });
  assert.equal(location.hash, '#token=abc&page=tasks&task=task%2F1');
  assert.deepEqual(navigateMode(location, 'workshop', home, known, visible), { ok: false, reason: 'unknown_mode' });
  assert.deepEqual(navigateMode(location, 'control', null, known, visible), { ok: false, reason: 'unknown_mode' });
  assert.deepEqual(navigateMode(location, 'control', () => '', known, visible), { ok: false, reason: 'unknown_mode' });
});
