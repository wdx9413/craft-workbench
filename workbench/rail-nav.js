/* Rail navigation: the everyday working surfaces, and the few 高级 observation
   pages that stay routable but sit behind one disclosure. Kept DOM-free so the
   split, the disclosure rule and the markup can be asserted without a browser. */

/** Partition rail entries into everyday items and one trailing advanced group. */
export function splitRail(items, advancedGroup) {
  const everyday = [];
  const advanced = [];
  for (const item of items) (item.group === advancedGroup ? advanced : everyday).push(item);
  return { everyday, advanced };
}

/** The disclosure opens on request, or whenever the current page lives inside it. */
export function advancedRailOpen(advanced, current, showAdvanced) {
  return Boolean(showAdvanced) || advanced.some(item => item.key === current);
}

/** Render the rail inner HTML. `esc` and `icon` are the caller's own helpers. */
export function railNavHtml(options) {
  const { everyday, advanced, current, showAdvanced, counts, countKeys, esc, icon } = options;
  const entry = item => {
    const count = counts[countKeys[item.key]];
    return '<button class="nav-item" type="button" data-page="' + item.key + '"' + (item.key === current ? ' aria-current="true"' : '') + '>' +
      icon(item.icon) + '<span class="nav-label">' + esc(item.label) + '</span>' +
      (count ? '<span class="nav-count">' + esc(count) + '</span>' : '') + '</button>';
  };
  let group = null;
  let html = '';
  for (const item of everyday) {
    if (item.group && item.group !== group) { group = item.group; html += '<div class="nav-group">' + esc(group) + '</div>'; }
    html += entry(item);
  }
  if (advanced.length) {
    const open = advancedRailOpen(advanced, current, showAdvanced);
    html += '<button class="nav-more" type="button" data-nav-more aria-expanded="' + open + '">' +
      icon('chev') + '<span class="nav-label">高级工具</span></button>';
    if (open) html += advanced.map(entry).join('');
  }
  return html;
}
