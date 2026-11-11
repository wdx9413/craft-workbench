// <option> rendering extracted from the monolithic app.js.
// `esc` is injected so the module stays pure and testable without a DOM.
export function renderOptions(pairs, selected, esc) {
  const escape = typeof esc === 'function' ? esc : (value) => String(value ?? '');
  return (Array.isArray(pairs) ? pairs : []).map((pair) => {
    const value = Array.isArray(pair) ? pair[0] : undefined;
    const label = Array.isArray(pair) ? pair[1] : undefined;
    return '<option value="' + escape(value) + '"' + (value === selected ? ' selected' : '') + '>' + escape(label) + '</option>';
  }).join('');
}
