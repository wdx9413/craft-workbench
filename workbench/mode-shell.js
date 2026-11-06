/**
 * Three-mode shell (灵策 / 观象 / 领航).
 *
 * The modes are projections of one Craft Runtime over shared Task, Approval,
 * Evidence and session state: switching never interrupts a task and never
 * changes execution facts. This module owns only the presentation contract —
 * which entries a mode shows, where the mode preference lives, and where a mode
 * switch should land — so the shell can stay thin and the rules stay testable.
 */
export const MODE_KEY = 'craft.workbenchMode';
export const PILOT_SESSION_KEY = 'craft.pilotSessionId';
export const LEGACY_NAV_PARAM = 'legacyNav';
export const MODE_ORDER = ['pilot', 'control', 'workshop'];

export const MODES = {
  workshop: {
    key: 'workshop', label: '灵策', title: '灵策', icon: 'terminal', tagline: '按项目工作',
    sub: '按项目与对话工作；插件、技能、连接器和上下文都在这里进入',
    nav: ['home', 'plugins', 'skills', 'connectors', 'models', 'memory', 'knowledge', 'workflows', 'mods', 'filedir', 'onboard', 'mode-confirm', 'settings'], home: 'home'
  },
  control: {
    key: 'control', label: '观象', title: '观象', icon: 'layers', tagline: '看见全局',
    sub: '一个入口创建任务，在这里持续看见进度、审批、阻塞与异常',
    nav: ['tasks', 'approvals', 'mods', 'evolution', 'blocked', 'mode-confirm', 'executors', 'permissions', 'settings'], home: 'tasks'
  },
  pilot: {
    key: 'pilot', label: '领航', title: '领航', icon: 'spark', tagline: '只说目标',
    sub: '只说目标。领航在内部完成拆解、路由、排队、执行与复查',
    nav: [], home: 'pilot'
  }
};

/** Restore the last mode; anything unknown or missing falls back to 领航. */
export function readMode(storage) {
  try {
    const stored = storage && typeof storage.getItem === 'function' ? storage.getItem(MODE_KEY) : null;
    return MODES[stored] ? stored : 'pilot';
  } catch (_) { return 'pilot'; }
}

export function writeMode(storage, mode) {
  if (!MODES[mode]) return;
  try { if (storage && typeof storage.setItem === 'function') storage.setItem(MODE_KEY, mode); } catch (_) { /* storage off */ }
}

/** A Pilot thread survives mode changes and app restarts; Tasks remain the store of record. */
export function readPilotSession(storage) {
  try {
    const value = storage && typeof storage.getItem === 'function' ? storage.getItem(PILOT_SESSION_KEY) : null;
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : '';
  } catch (_) { return ''; }
}

export function writePilotSession(storage, sessionId) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return;
    if (typeof sessionId === 'string' && sessionId) storage.setItem(PILOT_SESSION_KEY, sessionId);
    else if (typeof storage.removeItem === 'function') storage.removeItem(PILOT_SESSION_KEY);
  } catch (_) { /* storage off */ }
}

/** The dev fallback keeps the old complete rail reachable without a second UI. */
export function legacyNavEnabled(params) {
  try { return Boolean(params && typeof params.get === 'function' && params.get(LEGACY_NAV_PARAM) === '1'); } catch (_) { return false; }
}

/** Page keys a mode exposes; unknown modes expose nothing rather than guessing. */
export function modeNavKeys(mode) {
  return MODES[mode] ? MODES[mode].nav.slice() : [];
}

/**
 * Where a mode switch lands: stay on the current page when the new mode shows
 * it, otherwise go to that mode's home. A task, folder or plugin document is
 * shared across modes, so it is preserved while its mode nav lacks an entry.
 */
export function nextPageForMode(mode, currentPage) {
  const definition = MODES[mode];
  if (!definition) return currentPage;
  if (modeNavKeys(mode).indexOf(currentPage) >= 0) return currentPage;
  if (['task', 'projects', 'plugin', 'pilot'].indexOf(currentPage) >= 0) return currentPage;
  return definition.home;
}
