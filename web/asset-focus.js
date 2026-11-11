/**
 * Deep link from a task's context-usage row onto the asset's own page: open one
 * of its detail controls and bring the row into view. Kept free of app.js state
 * so both the parsing and the DOM effect can be verified in isolation.
 *
 * A focus string is `member:assetId` or `member:assetId#view`, where the view is
 * `audit` (default) or `trend`. An unknown view is rejected rather than silently
 * opening the wrong panel.
 */
const MEMBER_PREFIX = { experience: 'data-exp', memory: 'data-memory', knowledge: 'data-knowledge' };
const VIEW_SUFFIX = { audit: 'audit', trend: 'trend' };

/** The attribute for one member's detail control, or '' for an unknown member/view. */
export function assetControlAttribute(member, view) {
  var prefix = MEMBER_PREFIX[member];
  var suffix = VIEW_SUFFIX[view || 'audit'];
  return prefix && suffix ? prefix + '-' + suffix : '';
}

/** Back-compatible name kept for the audit control. */
export function assetAuditAttribute(member) { return assetControlAttribute(member, 'audit'); }

/** Returns a one-shot focus description, or null for anything malformed. */
export function parseAssetFocus(focus) {
  if (typeof focus !== 'string') return null;
  var split = focus.indexOf(':');
  if (split <= 0 || split === focus.length - 1) return null;
  var member = focus.slice(0, split), rest = focus.slice(split + 1);
  var hash = rest.indexOf('#');
  var assetId = hash < 0 ? rest : rest.slice(0, hash);
  var view = hash < 0 ? 'audit' : rest.slice(hash + 1);
  if (hash >= 0 && !VIEW_SUFFIX[view]) return null;
  if (!assetId) return null;
  var attribute = assetControlAttribute(member, view);
  if (!attribute || /["\\]/u.test(assetId)) return null;
  return { member: member, assetId: assetId, view: view, attribute: attribute };
}

/** Consumes the focus on the caller side; returns a user-facing status. */
export function applyAssetFocus(root, focus, notify) {
  var parsed = parseAssetFocus(focus);
  if (!parsed || !root || typeof root.querySelector !== 'function') return 'ignored';
  var button = root.querySelector('[' + parsed.attribute + '="' + parsed.assetId + '"]');
  if (!button) {
    if (typeof notify === 'function') notify('该资产不在当前范围的列表里，可能需要先选择范围', true);
    return 'missing';
  }
  if (typeof button.click === 'function') button.click();
  else if (typeof button.onclick === 'function') button.onclick();
  var row = button.closest ? button.closest('.row') : null;
  if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' });
  return 'focused';
}
