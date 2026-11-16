import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const pages = ctx.pages();
console.log('pages', pages.length);
const page = pages[0];
console.log('title', await page.title());
console.log('url', page.url().replace(/token=[^&]+/, 'token=***'));
const info = await page.evaluate(() => ({
  modeOnly: window.CRAFT_MODE_ONLY,
  appMode: document.querySelector('#app')?.getAttribute('data-mode'),
  page: document.querySelector('#app')?.getAttribute('data-page'),
  rail: document.querySelector('#app')?.getAttribute('data-rail'),
  aside: document.querySelector('#app')?.getAttribute('data-aside'),
  navItems: [...document.querySelectorAll('#nav [data-page]')].map((e) => e.dataset.page),
  tabs: document.querySelectorAll('#mode-switch [data-mode]').length,
  switcherHidden: document.querySelector('#mode-switch')?.hidden,
  hasControl: Boolean(window.__craftWorkbench),
  contentText: (document.querySelector('#content')?.innerText || '').slice(0, 200),
}));
console.log(JSON.stringify(info, null, 2));
await browser.close();
