// Visits every staff/admin screen, records console errors / failed requests, saves screenshots.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000', SHOTS = process.env.SHOTS ?? './shots';
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
let problems = 0;
async function session(email, pages, vp = { width: 1280, height: 800 }, scheme = 'light') {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: scheme });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { problems++; console.log('  ✘ pageerror', e.message.slice(0, 160)); });
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) { problems++; console.log('  ✘ console', m.text().slice(0, 160)); } });
  p.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) { problems++; console.log('  ✘ HTTP', r.status(), r.url().replace(BASE, '')); } });
  await p.goto(`${BASE}/login`);
  await p.getByLabel('Email').fill(email); await p.getByLabel('Password').fill('TableFlow-demo-1'); await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL(/\/(dashboard|admin|kitchen)/);
  for (const [path, name, wait] of pages) {
    await p.goto(BASE + path); await p.waitForLoadState('networkidle'); if (wait) await p.getByText(wait).first().waitFor({ timeout: 8000 }).catch(() => { problems++; console.log('  ✘ missing text', wait, 'on', path); });
    await p.waitForTimeout(350); await p.screenshot({ path: `${SHOTS}/${name}.png` }); console.log('✔', path);
  }
  return ctx;
}
await session('owner@ceylonbrew.lk', [
  ['/dashboard', 'd-overview', 'Daily sales'], ['/dashboard/orders', 'd-orders'], ['/dashboard/menu', 'd-menu', 'Chicken Kottu'], ['/dashboard/tables', 'd-tables', 'T1'], ['/dashboard/tables/print', 'd-print', 'Print QR cards'],
  ['/dashboard/payments', 'd-payments', 'Refund'], ['/dashboard/payments?tab=methods', 'd-methods'], ['/dashboard/feedback', 'd-feedback'], ['/dashboard/staff', 'd-staff', 'Nimali'], ['/dashboard/settings', 'd-settings', 'Branding'], ['/dashboard/support', 'd-support'],
]);
await session('admin@tableflow.lk', [['/admin', 'a-overview', 'Platform overview'], ['/admin/restaurants', 'a-restaurants', 'Galle Fort Bites'], ['/admin/transactions', 'a-transactions'], ['/admin/plans', 'a-plans', 'Growth'], ['/admin/support', 'a-support'], ['/admin/audit', 'a-audit']]);
await session('owner@ceylonbrew.lk', [['/dashboard', 'm-overview', 'Daily sales'], ['/dashboard/orders', 'm-orders']], { width: 390, height: 844 }, 'dark');
await browser.close();
console.log(problems ? `\n${problems} problem(s)` : '\nNo console errors or failed requests'); process.exitCode = problems ? 1 : 0;
