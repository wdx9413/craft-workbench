import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => { window.CRAFT_MODE_ONLY = 'workshop'; });
const page = await context.newPage();
await page.goto('http://127.0.0.1:4317/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
await page.locator('#nav [data-page="plugins"]').hover();
await page.waitForTimeout(400);
await page.screenshot({ path: '.scratch/e2e/shots/hover.png' });
const info = await page.evaluate(() => {
  const tip = document.querySelector('#rail-tip');
  const rect = tip?.getBoundingClientRect();
  return { hidden: tip?.hidden, x: Math.round(rect?.x ?? -1), y: Math.round(rect?.y ?? -1), text: tip?.textContent };
});
console.log(JSON.stringify(info));
await browser.close();
