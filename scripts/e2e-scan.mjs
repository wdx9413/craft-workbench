// 端到端验收脚本：用本机 Chrome 驱动 Craft Workbench 页面，
// 遍历三模式（领航员 / 控制台 / 工作台）的每一个子页面、点击每个可交互元素，
// 记录任何 JS 报错与 401 鉴权行为，并截图到 scripts/e2e-shots/。
//
// 用法：
//   node scripts/e2e-scan.mjs                 # 默认连 mock 运行时 http://127.0.0.1:4317/
//   WB_URL=http://127.0.0.1:4173/#token=xxx node scripts/e2e-scan.mjs
//   WB_NO_TOKEN=1 node scripts/e2e-scan.mjs   # 故意不带 token，验证 401 引导
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:4317/';
const BASE = (process.env.WB_URL || DEFAULT_URL).split('#')[0];
const FORCE_NO_TOKEN = process.env.WB_NO_TOKEN === '1';
const OUT = resolve('scripts/e2e-shots');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 三模式 + 每个模式的可路由页面（来自 web/mode-shell.js 的 MODES.nav）
const MODES = {
  pilot: ['pilot'],
  control: ['tasks', 'approvals', 'subscriptions', 'objects', 'permissions', 'mods', 'executors', 'evolution', 'blocked', 'mode-confirm', 'settings'],
  workshop: ['home', 'overview', 'plugins', 'skills', 'connectors', 'models', 'memory', 'knowledge', 'workflows', 'mods', 'filedir', 'relations', 'onboard', 'mode-confirm', 'asset-revisions', 'context-usage', 'workflow-designs', 'evaluations', 'settings'],
};

function buildUrl(token, mode, page) {
  const params = [];
  if (token) params.push('token=' + encodeURIComponent(token));
  if (mode) params.push('mode=' + mode);
  if (page) params.push('page=' + page);
  return BASE + '#' + params.join('&');
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const errors = [];
  const apiStatus = {};
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('response', (r) => { if (r.url().includes('/api/')) apiStatus[r.status()] = (apiStatus[r.status()] || 0) + 1; });

  // 真实运行时需要 token：从传入的 WB_URL（含 #token=...）直接解析，
  // 不再依赖页面二次重定向，避免 networkidle 不触发导致取不到 token。
  let token = '';
  if (!FORCE_NO_TOKEN) {
    const m = /token=([^&]+)/.exec(process.env.WB_URL || '');
    token = m ? decodeURIComponent(m[1]) : '';
  }

  let visited = 0;
  let clickedTotal = 0;
  for (const [mode, pages] of Object.entries(MODES)) {
    for (const p of pages) {
      // 每个页面用独立 context，避免长会话累积 DOM/网络句柄导致资源耗尽。
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const localErrors = [];
      page.on('console', (m) => { if (m.type() === 'error') localErrors.push('CONSOLE: ' + m.text()); });
      page.on('pageerror', (e) => localErrors.push('PAGEERROR: ' + e.message));
      page.on('response', (r) => { if (r.url().includes('/api/')) apiStatus[r.status()] = (apiStatus[r.status()] || 0) + 1; });
      const url = FORCE_NO_TOKEN ? buildUrl('', mode, p) : buildUrl(token, mode, p);
      // 真实运行时 app.js 体积大（~314KB ESM），DOMContentLoaded 派发较晚；
      // 用 commit 先拿到导航，再给足渲染时间，避免误报超时。
      await page.goto(String(url), { waitUntil: 'commit', timeout: 20000 }).catch((e) => localErrors.push(`GOTO[${mode}/${p}]: ` + e.message));
      await sleep(2500);
      visited++;
      const safe = `${mode}-${p}`.replace(/[^a-z0-9-]/gi, '_');
      await page.screenshot({ path: resolve(OUT, `${visited}-${safe}.png`), fullPage: true }).catch(() => {});
      // 点击本页所有可交互元素（受控数量，避免无限展开）
      const clickables = page.locator('button, a[href], [role="button"], [role="menuitem"], summary, input[type="submit"], [data-craft-action]');
      const n = Math.min(await clickables.count(), 50);
      for (let j = 0; j < n; j++) {
        const el = clickables.nth(j);
        let visible = false;
        try { visible = await el.isVisible(); } catch {}
        if (!visible) continue;
        const txt = (await el.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 24);
        await el.click({ timeout: 2500 }).catch((e) => { if (!/timeout|interrupted/i.test(e.message)) localErrors.push(`CLICK[${mode}/${p}]#${j}(${txt}): ` + e.message.split('\n')[0]); });
        clickedTotal++;
        await sleep(120);
      }
      await sleep(200);
      errors.push(...localErrors);
      await ctx.close().catch(() => {});
    }
  }

  console.log('\n===== E2E SUMMARY =====');
  console.log('modes:', Object.keys(MODES).join(', '));
  console.log('pages visited:', visited, '| elements clicked:', clickedTotal);
  console.log('API status codes seen:', JSON.stringify(apiStatus));
  console.log('JS errors:', errors.length);
  for (const e of errors) console.log('  - ' + e);

  await browser.close();
  if (errors.length > 0 && !FORCE_NO_TOKEN) process.exit(2);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
