import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';

const MODES = {
  pilot: ['pilot'],
  control: ['tasks', 'approvals', 'subscriptions', 'objects', 'permissions', 'mods', 'executors', 'evolution', 'blocked', 'settings'],
  workshop: ['home', 'plugins', 'skills', 'connectors', 'models', 'memory', 'knowledge', 'workflows', 'overview', 'mods',
    'notes-locations', 'relations', 'onboard', 'mode-confirm', 'asset-revisions', 'context-usage', 'workflow-designs', 'evaluations', 'settings'],
};

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const base = browser.contexts()[0].pages()[0];
const url = base.url();
const results = [];

for (const [mode, pages] of Object.entries(MODES)) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => { window.CRAFT_MODE_ONLY = value; }, mode);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push('PAGEERROR ' + error.message.split('\n')[0]));
  page.on('console', (message) => { if (message.type() === 'error') errors.push('CONSOLE ' + message.text().slice(0, 200)); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__craftWorkbench || document.querySelector('#content')?.innerText.length > 0, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  for (const target of pages) {
    const before = errors.length;
    await page.evaluate((next) => {
      const hash = new URLSearchParams(location.hash.slice(1));
      hash.set('page', next);
      location.hash = hash.toString();
    }, target);
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => {
      const content = document.querySelector('#content');
      const text = (content?.innerText || '').trim();
      return {
        page: document.querySelector('#app')?.getAttribute('data-page'),
        mode: document.querySelector('#app')?.getAttribute('data-mode'),
        length: text.length,
        head: text.slice(0, 90).replace(/\s+/g, ' '),
        callout: content?.querySelector('.callout')?.innerText?.slice(0, 160) || '',
        buttons: content ? content.querySelectorAll('button').length : 0,
        links: content ? content.querySelectorAll('a').length : 0,
      };
    });
    results.push({ mode, target, ...state, errors: errors.slice(before) });
  }
  await context.close();
}

await writeFile(new URL('./sweep.json', import.meta.url), JSON.stringify(results, null, 2));
const bad = results.filter((item) => item.length < 20 || item.errors.length || item.callout);
console.log(`checked ${results.length}, issues ${bad.length}`);
for (const item of bad) console.log(JSON.stringify(item));
await browser.close();
