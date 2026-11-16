import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge' });
const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });

async function open(mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => { window.CRAFT_MODE_ONLY = value; }, mode);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  await page.goto('http://127.0.0.1:4317/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  return { context, page, errors };
}

// --- settings: open from rail, switch sections, back button ---
{
  const { context, page, errors } = await open('workshop');
  await page.locator('#settings-nav').click();
  await page.waitForTimeout(900);
  const sections = await page.locator('[data-settings-section]').evaluateAll((els) => els.map((e) => e.dataset.settingsSection));
  record('settings has section list', sections.length >= 4, sections.join(','));
  const visibleBefore = await page.locator('[data-section]:not([hidden])').evaluateAll((els) => els.map((e) => e.dataset.section));
  const target = sections.find((s) => !visibleBefore.includes(s));
  if (target) {
    await page.locator(`[data-settings-section="${target}"]`).click();
    await page.waitForTimeout(400);
    const visibleAfter = await page.locator('[data-section]:not([hidden])').evaluateAll((els) => els.map((e) => e.dataset.section));
    record('settings section switch', visibleAfter.length === 1 && visibleAfter[0] === target, `${visibleBefore} -> ${visibleAfter}`);
  }
  const back = page.locator('#page-actions button', { hasText: '返回' });
  record('settings has back button', await back.count() > 0);
  if (await back.count()) {
    await back.first().click();
    await page.waitForTimeout(700);
    record('back leaves settings', (await page.locator('#app').getAttribute('data-page')) !== 'settings', await page.locator('#app').getAttribute('data-page'));
  }
  const key = page.locator('#w-apikey');
  record('api key field is a direct value input', await key.count() === 0 || (await key.getAttribute('type')) === 'password');
  record('settings no errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

// --- workshop: nav clicks, composer typing, expand rail, aside toggle ---
{
  const { context, page, errors } = await open('workshop');
  await page.locator('#nav [data-page="plugins"]').click();
  await page.waitForTimeout(900);
  record('rail click navigates', (await page.locator('#app').getAttribute('data-page')) === 'plugins', await page.locator('#app').getAttribute('data-page'));
  await page.locator('#rail-toggle').click();
  await page.waitForTimeout(300);
  record('rail toggle cycles density', (await page.locator('#app').getAttribute('data-rail')) !== 'icons', await page.locator('#app').getAttribute('data-rail'));
  // icons -> collapsed -> open: the labelled rail must be reachable again.
  await page.locator('#rail-toggle').click();
  await page.waitForTimeout(300);
  record('rail returns to labelled mode', (await page.locator('#app').getAttribute('data-rail')) === 'open', await page.locator('#app').getAttribute('data-rail'));
  await page.locator('#nav [data-page="home"]').click();
  await page.waitForTimeout(900);
  const box = page.locator('.agent-compose textarea').first();
  if (await box.count()) {
    await box.fill('整理发布清单并核对风险');
    record('composer accepts text', (await box.inputValue()).length > 0);
  } else record('composer exists', false, 'no textarea');
  await page.locator('#aside-toggle').click();
  await page.waitForTimeout(300);
  record('aside toggle opens', (await page.locator('#app').getAttribute('data-aside')) === 'open', await page.locator('#app').getAttribute('data-aside'));
  record('workshop no errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

// --- control: new task drawer, board open, settings ---
{
  const { context, page, errors } = await open('control');
  await page.locator('#jump-new-task').click();
  await page.waitForTimeout(900);
  record('new task opens a form', await page.locator('.inline-form').count() > 0);
  const close = page.locator('.inline-form [data-inline="close"]');
  if (await close.count()) { await close.click(); await page.waitForTimeout(400); }
  record('inline form closes', await page.locator('.inline-form').count() === 0);
  const row = page.locator('[data-board-open]').first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(900);
    record('task row opens task', (await page.locator('#app').getAttribute('data-page')) === 'task', await page.locator('#app').getAttribute('data-page'));
  } else record('task rows exist', false);
  record('control no errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

// --- pilot: sample fills composer, submit path reachable, settings ---
{
  const { context, page, errors } = await open('pilot');
  const sample = page.locator('[data-pilot-sample]').first();
  await sample.click();
  await page.waitForTimeout(400);
  record('pilot sample fills composer', (await page.locator('#pilot-input').inputValue()).length > 0);
  await page.locator('#settings-nav').click();
  await page.waitForTimeout(800);
  record('pilot reaches settings', (await page.locator('#app').getAttribute('data-page')) === 'settings');
  record('pilot no errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
await browser.close();
