/**
 * Three-mode shell (工作台 / 控制台 / 领航员).
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
export const isMode = mode => Object.hasOwn(MODES, mode);

export function shouldOfferOnboarding(modelCount, completed, initialHash, currentHash, skipped) {
  if (modelCount || completed || skipped || initialHash !== currentHash) return false;
  const params = new URLSearchParams(initialHash.replace(/^#/, ''));
  return !['page', 'task', 'project', 'plugin', 'focus'].some(key => params.has(key));
}

export const MODES = {
  workshop: {
    key: 'workshop', label: '工作台', title: '工作台', icon: 'terminal', tagline: '按项目工作',
    sub: '按项目与对话工作；插件、技能、连接器和上下文都在这里进入',
    // `nav` is the routable set (deep links and guards). `rail` + `more` are the
    // visible projection: frequent work stays in the rail, low-frequency
    // governance/observation pages live behind one disclosure.
    nav: ['home', 'overview', 'plugins', 'skills', 'connectors', 'models', 'memory', 'knowledge', 'workflows', 'mods', 'filedir', 'relations', 'onboard', 'mode-confirm', 'asset-revisions', 'context-usage', 'workflow-designs', 'evaluations', 'settings'],
    rail: ['home', 'plugins', 'skills', 'connectors', 'models', 'memory', 'knowledge', 'workflows'],
    more: ['overview', 'mods', 'filedir', 'relations', 'onboard', 'mode-confirm', 'asset-revisions', 'context-usage', 'workflow-designs', 'evaluations'],
    home: 'home'
  },
  control: {
    key: 'control', label: '控制台', title: '控制台', icon: 'layers', tagline: '看见全局',
    sub: '一个入口创建任务，在这里持续看见进度、审批、阻塞与异常',
    nav: ['tasks', 'approvals', 'subscriptions', 'objects', 'permissions', 'mods', 'executors', 'evolution', 'blocked', 'mode-confirm', 'settings'],
    rail: ['tasks', 'approvals', 'subscriptions', 'objects', 'permissions', 'evolution', 'blocked'],
    more: ['mods', 'executors', 'mode-confirm'],
    home: 'tasks'
  },
  pilot: {
    key: 'pilot', label: '领航员', title: '领航员', icon: 'spark', tagline: '只说目标',
    sub: '只说目标。领航员在内部完成拆解、路由、排队、执行与复查',
    nav: ['pilot'], rail: ['pilot'], more: [], home: 'pilot'
  }
};

/** Restore the last mode; anything unknown or missing falls back to 领航员. */
export function readMode(storage) {
  try {
    const stored = storage && typeof storage.getItem === 'function' ? storage.getItem(MODE_KEY) : null;
    return isMode(stored) ? stored : 'pilot';
  } catch (_) { return 'pilot'; }
}

export function writeMode(storage, mode) {
  if (!isMode(mode)) return;
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
  return isMode(mode) ? MODES[mode].nav.slice() : [];
}

/** Visible rail projection: frequent entries plus one disclosure of the rest. */
export function modeRailItems(mode) {
  if (!isMode(mode)) return { primary: [], more: [] };
  return { primary: MODES[mode].rail.slice(), more: MODES[mode].more.slice() };
}

/** The first mode whose projection owns a page, or an empty string. */
export function modeForPage(page) {
  // A page can appear in more than one projection (settings is reachable from
  // every mode). Prefer the richest projection — 工作台 — before the leaner ones
  // so a deep link lands where the shared surface lives by default.
  const ordered = MODE_ORDER.slice().reverse();
  return ordered.find(mode => MODES[mode].nav.indexOf(page) >= 0) || '';
}

/** Resolve a deep link without replacing the selected shell with the page owner. */
export function modeForLocation(page, requestedMode, currentMode) {
  if (isMode(requestedMode)) return requestedMode;
  // Context pages can be opened from another mode without replacing its shell.
  if (isMode(currentMode)) return currentMode;
  return modeForPage(page) || (isMode(currentMode) ? currentMode : 'pilot');
}

/** Restore the correct projection after browser back/forward or an old deep link. */
export function restoreModeForLocation(page, requestedMode, currentMode, storage) {
  const mode = modeForLocation(page, requestedMode, currentMode);
  writeMode(storage, mode);
  return mode;
}

/**
 * Where a mode switch lands: stay on the current page when the new mode shows
 * it, otherwise go to that mode's home. A task, folder or plugin document is
 * shared across modes, so it is preserved while its mode nav lacks an entry.
 * The Pilot conversation is itself a mode surface, so it is NOT shared: leaving
 * Pilot must land on the target mode's home instead of showing Pilot under a
 * Control/Workbench rail with an empty page.
 */
export function nextPageForMode(mode, currentPage) {
  const definition = isMode(mode) ? MODES[mode] : null;
  if (!definition) return currentPage;
  if (modeNavKeys(mode).indexOf(currentPage) >= 0) return currentPage;
  if (['task', 'projects', 'plugin'].indexOf(currentPage) >= 0) return currentPage;
  return definition.home;
}
