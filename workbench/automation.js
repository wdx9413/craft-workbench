/**
 * External-control contract shared by the browser build and the Tauri shell.
 *
 * A workflow runner gets one stable description of the mounted surface, plus
 * two safe verbs: navigate to a known page and return to the home of a mode.
 * All state is read-only and projection-only; no verb submits a task, changes
 * permission or writes host configuration.
 */
export const AUTOMATION_VERSION = 1;
export const CONTROL_ENV = 'CRAFT_WORKBENCH_CONTROL';
export const CONTROL_PATH = '/workbench-control';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

function frozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (!isRecord(value)) return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozen(item)])));
}

/** Read the mounted surface without trusting fields a page might omit. */
export function snapshotSurface(input) {
  const source = isRecord(input) ? input : {};
  const controls = Array.isArray(source.controls) ? source.controls : [];
  return frozen({
    version: AUTOMATION_VERSION,
    token: false,
    surface: safeText(source.surface),
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    mode: safeText(source.mode),
    page: safeText(source.page),
    title: safeText(source.title),
    busy: source.busy === true,
    failed: source.failed === true,
    controls: controls.map(control => ({
      id: safeText(control && control.id),
      label: safeText(control && control.label),
      disabled: Boolean(control && control.disabled),
    })),
  });
}

/** Keep only explicit local-origin callers; opaque remote pages never qualify. */
export function isControlOrigin(origin) {
  return origin === 'http://127.0.0.1' || origin === 'http://localhost' || origin === 'tauri://localhost';
}

export function controlEnabled(env, origin) {
  if (!isControlOrigin(origin)) return false;
  const value = env === undefined ? '' : String(env).trim().toLowerCase();
  // The runtime default is on; only an explicit opt-out turns the surface off.
  if (value === '') return true;
  if (value === '0' || value === 'false' || value === 'no') return false;
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * Navigate by changing only the page selector. A hidden page is rejected
 * instead of silently falling back to a different surface.
 */
export function navigatePage(locationLike, page, known, visible) {
  if (typeof page !== 'string' || !page || typeof known !== 'function' || !known(page)) {
    return { ok: false, reason: 'unknown_page' };
  }
  if (typeof visible !== 'function' || !visible(page)) return { ok: false, reason: 'page_not_visible' };
  const raw = safeText(locationLike && locationLike.hash).replace(/^#/, '');
  const params = new URLSearchParams(raw);
  params.set('page', page);
  // URLSearchParams re-encodes values; the workbench token is already encoded,
  // so re-encoding it a second time breaks the hash contract. Preserve the
  // identity parameter exactly as received and rewrite the page parameter only.
  const identity = new URLSearchParams(raw).get('token');
  if (identity !== null) params.set('token', identity);
  const next = '#' + params.toString();
  const navigated = locationLike.hash !== next;
  try {
    if (navigated) locationLike.hash = next;
  } catch (_) {
    return { ok: false, reason: 'navigation_failed' };
  }
  return { ok: true, page, navigated };
}

/** Leave whatever page is open and land on the requested mode's home. */
export function navigateMode(locationLike, mode, modeHome, known, visible) {
  if (typeof modeHome !== 'function') return { ok: false, reason: 'unknown_mode' };
  const home = modeHome(mode);
  if (typeof home !== 'string' || !home) return { ok: false, reason: 'unknown_mode' };
  return navigatePage(locationLike, home, known, visible);
}
