export function themeColor(value) {
  if (typeof value !== 'string') return null;
  var hex = value.trim().match(/^#(?:([0-9a-f]{3})|([0-9a-f]{6}))$/iu);
  if (hex) {
    var digits = hex[1] ? hex[1].split('').map(function (part) { return part + part; }).join('') : hex[2];
    return [0, 2, 4].map(function (offset) { return parseInt(digits.slice(offset, offset + 2), 16); });
  }
  var rgb = value.trim().match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/iu);
  if (!rgb) return null;
  var channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return channels.every(function (channel) { return channel >= 0 && channel <= 255; }) ? channels : null;
}

export function hasThemeContrast(foreground, background) {
  var fg = themeColor(foreground), bg = themeColor(background);
  if (!fg || !bg) return false;
  function luminance(channels) {
    var linear = channels.map(function (channel) { var c = channel / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  var values = [luminance(fg), luminance(bg)].sort(function (a, b) { return b - a; });
  return (values[0] + 0.05) / (values[1] + 0.05) >= 4.5;
}
