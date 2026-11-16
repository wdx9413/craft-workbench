import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const report = await page.evaluate(() => {
  const pick = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return { selector, missing: true };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { selector, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      display: cs.display, visibility: cs.visibility, overflow: cs.overflow, color: cs.color, bg: cs.backgroundColor };
  };
  const overflow = [...document.querySelectorAll('*')].filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
    .slice(0, 15).map((el) => ({ tag: el.tagName, cls: el.className?.toString().slice(0, 60), scroll: el.scrollWidth, client: el.clientWidth }));
  return {
    nodes: ['.page-head', '#page-title', '#page-sub', '#content', '.home', '.home-agent', '#agent-workspace',
      '.rail-foot', '#rail-status', '.conn .dot', '.conn-text', '.titlebar', '.workspace', '.main'].map(pick),
    overflow,
    errors: window.__craftErrors || [],
  };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
