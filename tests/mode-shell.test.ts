import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { MODE_KEY, LEGACY_NAV_PARAM, MODE_ORDER, MODES, PILOT_SESSION_KEY, legacyNavEnabled, modeForLocation, restoreModeForLocation, modeForPage, modeNavKeys, modeRailItems, nextPageForMode, readMode, readPilotSession, writeMode, writePilotSession, shouldOfferOnboarding } from '../workbench/mode-shell.js';

test('switching modes updates the visible shell without changing the mounted page', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const body = source.split('function setMode(mode) {')[1]!.split('// ------------------------------------------------------------------- render')[0]!.replace(/}\s*$/, '');
  const state = { mode: 'pilot', page: 'projects', selectedProject: 'demo' };
  const attributes = new Map([['data-mode', 'pilot']]);
  const app = { setAttribute: (key: string, value: string) => attributes.set(key, value) };
  const shell = { querySelector: () => ({ focus() {} }) };
  const lookup = (id: string) => id === 'app' ? app : shell;
  const run = new Function('mode', 'state', '$', 'isMode', 'nextPageForMode', 'saveMode', 'paintNav', 'paintModeSwitch', 'publishControl', 'pageVisibleInMode', `let modeSwitchRevision = 0; ${body}`);
  run('workshop', state, lookup, (mode: string) => mode === 'workshop', nextPageForMode, () => {}, () => {}, () => {}, () => {}, () => {});
  assert.equal(attributes.get('data-mode'), 'workshop');
  assert.equal(state.page, 'projects'); assert.equal(state.selectedProject, 'demo');
});

test('switching to a mode that does not show the current page lands on that mode home', async () => {
  const source = await readFile(new URL('../workbench/app.js', import.meta.url), 'utf8');
  const body = source.split('function setMode(mode) {')[1]!.split('// ------------------------------------------------------------------- render')[0]!.replace(/}\s*$/, '');
  const state = { mode: 'pilot', page: 'plugins' };
  const attributes = new Map();
  const focused: string[] = [];
  const app = { setAttribute: (key: string, value: string) => attributes.set(key, value) };
  const shell = { querySelector: (selector: string) => ({ focus: () => focused.push(selector) }) };
  const lookup = (id: string) => id === 'app' ? app : shell;
  let navigated = '';
  const run = new Function('mode', 'state', '$', 'isMode', 'nextPageForMode', 'saveMode', 'paintNav', 'paintModeSwitch', 'go', 'publishControl', 'messageDock', `let modeSwitchRevision = 0; ${body}`);
  run('control', state, lookup, (mode: string) => mode === 'control', nextPageForMode, () => {}, () => {}, () => {}, (page: string) => { navigated = page; }, () => {}, null);
  assert.equal(state.mode, 'control');
  assert.equal(navigated, 'tasks', 'a page hidden by the new mode must land on its home');
  assert.equal(attributes.get('data-mode'), 'control');
  assert.deepEqual(focused, ['[data-mode="control"]']);
});

const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
};

test('onboarding does not interrupt explicit links or navigation while configuration loads', () => {
  assert.equal(shouldOfferOnboarding(0, null, '#token=x', '#token=x'), true);
  assert.equal(shouldOfferOnboarding(1, null, '#token=x', '#token=x'), false);
  assert.equal(shouldOfferOnboarding(0, 'done', '#token=x', '#token=x'), false);
  assert.equal(shouldOfferOnboarding(0, null, '#token=x', '#token=x&page=tasks'), false);
  for (const key of ['page', 'task', 'project', 'plugin', 'focus']) {
    const hash = `#token=x&${key}=id`;
    assert.equal(shouldOfferOnboarding(0, null, hash, hash), false);
  }
});

test('a skipped onboarding is not shown again after restart', () => {
  assert.equal(shouldOfferOnboarding(0, null, '#token=x', '#token=x', '2026-10-01T00:00:00Z'), false);
});

test('MODES exposes 领航员 / 控制台 / 工作台 as distinct projections', () => {
  assert.deepEqual(MODE_ORDER, ['pilot', 'control', 'workshop']);
  assert.equal(MODES.workshop.key, 'workshop');
  assert.equal(MODES.workshop.label, '工作台');
  assert.equal(MODES.workshop.nav[0], 'home');
  assert.equal(MODES.control.label, '控制台');
  assert.equal(MODES.control.nav[0], 'tasks');
  assert.equal(MODES.control.home, 'tasks');
  assert.equal(MODES.pilot.label, '领航员');
  assert.deepEqual(MODES.pilot.nav, ['pilot']);
  assert.equal(MODES.pilot.home, 'pilot');
});

test('readMode defaults to pilot when storage has nothing', () => {
  assert.equal(readMode({}), 'pilot');
});

test('prototype names cannot become modes through saved preferences or navigation', () => {
  const storage = memoryStorage();
  storage.setItem(MODE_KEY, 'toString');
  assert.equal(readMode(storage), 'pilot');
  writeMode(storage, '__proto__');
  assert.equal(storage.getItem(MODE_KEY), 'toString');
  assert.deepEqual(modeNavKeys('toString'), []);
  assert.equal(nextPageForMode('__proto__', 'task'), 'task');
});

test('writeMode persists and readMode restores it', () => {
  const s = memoryStorage();
  writeMode(s, 'control');
  assert.equal(readMode(s), 'control');
  writeMode(s, 'pilot');
  assert.equal(readMode(s), 'pilot');
  writeMode(s, 'workshop');
  assert.equal(readMode(s), 'workshop');
});

test('readMode ignores unknown stored mode; writeMode ignores unknown input', () => {
  const s = memoryStorage();
  s.setItem(MODE_KEY, 'nope');
  assert.equal(readMode(s), 'pilot');
  const fresh = memoryStorage();
  writeMode(fresh, 'bogus' as never);
  assert.equal(fresh.getItem(MODE_KEY), null);
});

test('readMode and writeMode tolerate storage failure', () => {
  assert.equal(readMode({ getItem: () => { throw new Error('quota'); } }), 'pilot');
  assert.doesNotThrow(() => writeMode({}, 'control'));
  const s = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.doesNotThrow(() => writeMode(s, 'control'));
});

test('Pilot thread identity survives reload without trusting arbitrary localStorage', () => {
  const s = memoryStorage();
  assert.equal(readPilotSession({}), '');
  assert.doesNotThrow(() => writePilotSession({}, 'session'));
  assert.equal(readPilotSession(s), '');
  writePilotSession(s, 'pilot_session_abc-123');
  assert.equal(readPilotSession(s), 'pilot_session_abc-123');
  s.setItem(PILOT_SESSION_KEY, '../../etc/passwd');
  assert.equal(readPilotSession(s), '');
  assert.equal(readPilotSession({ getItem: () => { throw new Error('quota'); } }), '');
  s.setItem(PILOT_SESSION_KEY, '');
  writePilotSession(s, 'valid-id');
  writePilotSession(s, '');
  assert.equal(s.getItem(PILOT_SESSION_KEY), null);
  const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('quota'); } };
  assert.doesNotThrow(() => writePilotSession(broken, 'x'));
});

test('modeNavKeys returns keys or empty array', () => {
  assert.deepEqual(modeNavKeys('workshop'), ['home', 'overview', 'plugins', 'skills', 'connectors', 'models', 'memory', 'knowledge', 'workflows', 'mods', 'filedir', 'relations', 'onboard', 'mode-confirm', 'asset-revisions', 'context-usage', 'workflow-designs', 'evaluations', 'settings']);
  assert.deepEqual(modeNavKeys('control'), ['tasks', 'approvals', 'subscriptions', 'objects', 'permissions', 'mods', 'executors', 'evolution', 'blocked', 'mode-confirm', 'settings']);
  assert.deepEqual(modeNavKeys('pilot'), ['pilot']);
  assert.deepEqual(modeNavKeys('bogus' as never), []);
});

test('the visible rail stays small and every secondary page is still routable', () => {
  for (const mode of MODE_ORDER) {
    const projection = modeRailItems(mode);
    assert.ok(projection.primary.length <= 8, mode + ' primary rail is small');
    // Every page in the visible projection must remain reachable through the
    // routable set; nothing may be silently dropped from navigation.
    for (const key of [...projection.primary, ...projection.more]) assert.ok(modeNavKeys(mode).includes(key), mode + ' keeps ' + key);
  }
  assert.deepEqual(modeRailItems('workshop').primary, ['home', 'plugins', 'skills', 'connectors', 'models', 'memory', 'knowledge', 'workflows']);
  assert.ok(modeRailItems('workshop').more.includes('evaluations'));
  assert.deepEqual(modeRailItems('control').primary, ['tasks', 'approvals', 'subscriptions', 'objects', 'permissions', 'evolution', 'blocked']);
  assert.deepEqual(modeRailItems('pilot'), { primary: ['pilot'], more: [] });
  assert.deepEqual(modeRailItems('bogus' as never), { primary: [], more: [] });
});

test('deep links preserve the active mode unless the URL names a mode', () => {
  assert.equal(modeForPage('pilot'), 'pilot');
  assert.equal(modeForPage('tasks'), 'control');
  assert.equal(modeForPage('plugins'), 'workshop');
  assert.equal(modeForPage('settings'), 'workshop');
  assert.equal(modeForPage('approvals'), 'control');
  assert.equal(modeForPage('relations'), 'workshop');
  assert.equal(modeForPage('unknown'), '');
  assert.equal(modeForPage(''), '');
  assert.equal(modeForLocation('plugins', '', 'pilot'), 'pilot');
  assert.equal(modeForLocation('plugins', '', 'workshop'), 'workshop', 'current mode wins when it already shows the page');
  assert.equal(modeForLocation('tasks', '', 'workshop'), 'workshop');
  assert.equal(modeForLocation('plugins', 'control', 'workshop'), 'control', 'an explicit mode overrides the page owner');
  assert.equal(modeForLocation('unknown', null, 'control'), 'control');
  assert.equal(modeForLocation('unknown', null, 'bogus' as never), 'pilot');
});

test('back and old contextual links restore the active projection', () => {
  const storage = memoryStorage();
  writeMode(storage, 'control');
  assert.equal(restoreModeForLocation('plugins', null, 'control', storage), 'control');
  assert.equal(readMode(storage), 'control');
  // Shared task detail links retain the active projection and task route.
  assert.equal(restoreModeForLocation('task', null, 'control', storage), 'control');
  // An explicit legacy mode remains authoritative.
  assert.equal(restoreModeForLocation('tasks', 'workshop', 'control', storage), 'workshop');
  assert.equal(readMode(storage), 'workshop');
});

test('nextPageForMode keeps current page when it is in the mode nav', () => {
  assert.equal(nextPageForMode('workshop', 'plugins'), 'plugins');
  assert.equal(nextPageForMode('workshop', 'settings'), 'settings');
  assert.equal(nextPageForMode('control', 'approvals'), 'approvals');
  assert.equal(nextPageForMode('pilot', 'pilot'), 'pilot');
});

test('nextPageForMode lands on mode home when current page is not in the mode nav', () => {
  assert.equal(nextPageForMode('workshop', 'approvals'), 'home');
  assert.equal(nextPageForMode('control', 'home'), 'tasks');
  assert.equal(nextPageForMode('pilot', 'plugins'), 'pilot');
});

test('nextPageForMode keeps shared task, folder and plugin documents across modes', () => {
  for (const m of ['workshop', 'control', 'pilot']) assert.equal(nextPageForMode(m, 'task'), 'task');
  assert.equal(nextPageForMode('workshop', 'projects'), 'projects');
  assert.equal(nextPageForMode('workshop', 'plugin'), 'plugin');
  // Pilot is a mode surface, not a shared document: leaving it must not leave
  // Control sitting on an empty Pilot page.
  assert.equal(nextPageForMode('control', 'pilot'), 'tasks');
  assert.equal(nextPageForMode('workshop', 'pilot'), 'home');
});

test('nextPageForMode falls back home for pages outside every mode nav', () => {
  assert.equal(nextPageForMode('control', 'memory'), 'tasks');
  assert.equal(nextPageForMode('workshop', 'objects'), 'home');
});

test('nextPageForMode returns currentPage unchanged for unknown mode', () => {
  assert.equal(nextPageForMode('bogus' as never, 'anything'), 'anything');
});

test('legacyNavEnabled reads the dev flag only when params carry it', () => {
  assert.equal(legacyNavEnabled(null), false);
  assert.equal(legacyNavEnabled({ get: () => null }), false);
  assert.equal(legacyNavEnabled({ get: (k: string) => (k === LEGACY_NAV_PARAM ? '1' : null) }), true);
  assert.equal(legacyNavEnabled({ get: () => { throw new Error('bad'); } }), false);
});
