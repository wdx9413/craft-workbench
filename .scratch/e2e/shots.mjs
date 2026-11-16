import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const out = new URL('./shots/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(1200);
await page.screenshot({ path: new URL('workshop-home.png', out).pathname.slice(1) });
console.log('saved workshop-home');
await browser.close();
