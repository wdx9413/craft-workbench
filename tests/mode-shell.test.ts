import assert from 'node:assert/strict';
import test from 'node:test';
import { MODE_KEY, LEGACY_NAV_PARAM, MODE_ORDER, MODES, PILOT_SESSION_KEY, legacyNavEnabled, modeNavKeys, nextPageForMode, readMode, readPilotSession, writeMode, writePilotSession } from '../workbench/mode-shell.js';

const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
};

test('MODES exposes 领航 / 观象 / 灵策 as distinct projections', () => {
  assert.deepEqual(MODE_ORDER, ['pilot', 'control', 'workshop']);
  assert.equal(MODES.workshop.key, 'workshop');
  assert.equal(MODES.workshop.label, '灵策');
  assert.equal(MODES.workshop.nav[0], 'home');
  assert.equal(MODES.control.label, '观象');
  assert.equal(MODES.control.nav[0], 'tasks');
  assert.equal(MODES.control.home, 'tasks');
  assert.equal(MODES.pilot.label, '领航');
  assert.deepEqual(MODES.pilot.nav, []);
  assert.equal(MODES.pilot.home, 'pilot');
});

test('readMode defaults to pilot when storage has nothing', () => {
  assert.equal(readMode({}), 'pilot');
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
  const s = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.doesNotThrow(() => writeMode(s, 'control'));
});

test('Pilot thread identity survives reload without trusting arbitrary localStorage', () => {
  const s = memoryStorage();
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
  assert.deepEqual(modeNavKeys('workshop'), ['home', 'plugins', 'skills', 'connectors', 'models', 'memory', 'knowledge', 'workflows', 'mods', 'filedir', 'onboard', 'mode-confirm', 'settings']);
  assert.deepEqual(modeNavKeys('control'), ['tasks', 'approvals', 'mods', 'evolution', 'blocked', 'mode-confirm', 'executors', 'permissions', 'settings']);
  assert.deepEqual(modeNavKeys('pilot'), []);
  assert.deepEqual(modeNavKeys('bogus' as never), []);
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

test('nextPageForMode keeps task, folder, project and pilot document pages across modes', () => {
  for (const m of ['workshop', 'control', 'pilot']) assert.equal(nextPageForMode(m, 'task'), 'task');
  assert.equal(nextPageForMode('workshop', 'projects'), 'projects');
  assert.equal(nextPageForMode('workshop', 'plugin'), 'plugin');
  assert.equal(nextPageForMode('control', 'pilot'), 'pilot');
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
