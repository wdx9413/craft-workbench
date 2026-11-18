import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4317/';
const MODES = {
  pilot: ['pilot'],
  control: ['tasks', 'approvals', 'subscriptions', 'objects', 'permissions', 'mods', 'executors', 'evolution', 'blocked', 'settings'],
  workshop: ['home', 'plugins', 'skills', 'connectors', 'models', 'memory', 'knowledge', 'workflows', 'overview', 'mods',
    'notes-locations', 'relations', 'onboard', 'mode-confirm', 'asset-revisions', 'context-usage', 'workflow-designs', 'evaluations', 'settings'],
};
const shots = new URL('./shots/', import.meta.url);
await mkdir(shots, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const results = [];

for (const [mode, pages] of Object.entries(MODES)) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => { window.CRAFT_MODE_ONLY = value; }, mode);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push('PAGEERROR ' + error.message.split('\n')[0]));
  page.on('console', (message) => { if (message.type() === 'error') errors.push('CONSOLE ' + message.text().slice(0, 200)); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  for (const target of pages) {
    const before = errors.length;
    await page.evaluate((next) => {
      const hash = new URLSearchParams(location.hash.slice(1));
      hash.set('page', next);
      location.hash = hash.toString();
    }, target);
    await page.waitForTimeout(1100);
    const state = await page.evaluate(() => {
      const content = document.querySelector('#content');
      const text = (content?.innerText || '').trim();
      const app = document.querySelector('#app');
      const rail = document.querySelector('#rail')?.getBoundingClientRect();
      const main = document.querySelector('.main')?.getBoundingClientRect();
      return {
        page: app?.getAttribute('data-page'),
        mode: app?.getAttribute('data-mode'),
        length: text.length,
        head: text.slice(0, 80).replace(/\s+/g, ' '),
        callout: content?.querySelector('.callout')?.innerText?.slice(0, 200) || '',
        buttons: content ? content.querySelectorAll('button').length : 0,
        railWidth: rail ? Math.round(rail.width) : 0,
        mainX: main ? Math.round(main.x) : 0,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    results.push({ mode, target, ...state, errors: errors.slice(before) });
    if (target === (mode === 'pilot' ? 'pilot' : mode === 'control' ? 'tasks' : 'home')) {
      await page.screenshot({ path: new URL(`${mode}-${target}.png`, shots).pathname.slice(1) });
    }
  }
  await context.close();
}

await writeFile(new URL('./sweep-web.json', import.meta.url), JSON.stringify(results, null, 2));
const bad = results.filter((item) => item.length < 20 || item.errors.length || item.callout || item.mainX < 56 || item.overflowX);
console.log(`checked ${results.length}, issues ${bad.length}`);
for (const item of bad) console.log(JSON.stringify(item));
await browser.close();
