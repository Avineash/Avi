#!/usr/bin/env node
/**
 * Browser end-to-end check of the branding flow. Not part of `npm test` because it needs a browser.
 *
 *   npm run build && npm start &         # serves the built app + demo data on :8787
 *   NODE_PATH=$(npm root -g) node scripts/e2e.cjs     # needs `playwright`; add `axe-core` for the accessibility scan
 *
 * Starts from a freshly seeded database (`npm run seed`) and mutates it (publishes themes).
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const PW = 'staffhub-demo';
const SVG = (extra = '') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48"><rect width="36" height="36" rx="8" fill="#b45309"/>${extra}</svg>`);
let axeSource = null;
try { axeSource = require('fs').readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch { /* optional */ }

(async () => {
  const browser = await chromium.launch();
  const open = async (email, w = 1440) => {
    const page = await (await browser.newContext({ viewport: { width: w, height: 1000 } })).newPage();
    await page.goto(`${BASE}/login`); await page.fill('#email', email); await page.fill('#password', PW);
    await page.click('button[type=submit]'); await page.waitForURL(`${BASE}/`); await page.waitForTimeout(500);
    return page;
  };
  const live = (p) => p.evaluate(() => ({ primary: getComputedStyle(document.documentElement).getPropertyValue('--ds-primary').trim(), logo: document.querySelector('.ds-nav__brand img')?.getAttribute('src') }));
  const preview = (p) => p.evaluate(() => getComputedStyle(document.querySelector('[data-ds-scope]')).getPropertyValue('--ds-primary').trim());
  const step = (m) => console.log('✓', m);

  const demo = await (await (await browser.newContext()).request.get(`${BASE}/api/public/demo-accounts`)).json();
  const employee = await open(demo.accounts.find((a) => a.role === 'employee' && a.companySlug === 'aurora').email, 1280);
  const before = await live(employee);
  const admin = await open('admin@aurora.example');
  const adminBefore = await live(admin);

  await admin.goto(`${BASE}/brand`); await admin.waitForSelector('.brand-screen');
  // 1. edits show in the preview, not in the live app
  await admin.click('[data-tab=colors]');
  await admin.locator('input[aria-label="Primary hex value"]').fill('#b45309');
  assert.equal(await preview(admin), '#b45309'); assert.equal((await live(admin)).primary, adminBefore.primary);
  step('colour edit reaches the preview but not the live theme');

  // 2. logo upload: hostile SVG rejected, good one previewed immediately
  await admin.click('[data-tab=identity]');
  const input = admin.locator('.uploader').filter({ hasText: /^Logo\b/ }).first().locator('input[type=file]');
  await input.setInputFiles({ name: 'evil.svg', mimeType: 'image/svg+xml', buffer: SVG('<script>alert(1)</script>') });
  await admin.waitForSelector('.uploader .ds-error');
  await input.setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: SVG('<text x="44" y="30">Sunrise</text>') });
  await admin.waitForFunction(() => /\/api\/assets\//.test(document.querySelector('[data-ds-scope] .ds-nav__brand img')?.getAttribute('src') ?? ''));
  step('hostile SVG rejected; new logo appears in the live preview');

  // 3. publish straight from unsaved edits (regression: stale revision → 409)
  await admin.click('button:has-text("Publish theme")'); await admin.fill('#note', 'e2e');
  await admin.click('.ds-modal button:has-text("Publish theme")');
  await admin.waitForFunction((p) => getComputedStyle(document.documentElement).getPropertyValue('--ds-primary').trim() !== p, adminBefore.primary);
  assert.equal((await live(admin)).primary, '#b45309');
  step('publish from an unsaved draft goes live');

  // 4. another device picks it up on focus (property overrides keep their own primary)
  await employee.evaluate(() => window.dispatchEvent(new Event('focus')));
  await employee.waitForFunction((l) => document.querySelector('.ds-nav__brand img')?.getAttribute('src') !== l, before.logo);
  const after = await live(employee);
  assert.notEqual(after.logo, before.logo);
  step(`employee on another device received the new brand (primary ${before.primary} → ${after.primary})`);

  // 5. restore the previous version
  await admin.click('[data-tab=history]');
  const v2 = admin.locator('.version').filter({ has: admin.locator('strong', { hasText: /^Version 2$/ }) });
  await v2.locator('button:has-text("Restore")').click();
  await admin.click('.ds-modal button:has-text("Restore and publish")');
  await admin.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--ds-primary').trim() !== '#b45309');
  assert.equal((await live(admin)).primary, adminBefore.primary);
  step('restoring version 2 brings the previous theme back as a new version');

  // 6. optional accessibility scan of key screens in both schemes
  if (axeSource) {
    for (const scheme of ['light', 'dark']) for (const path of ['/', '/leave', '/roster', '/brand']) {
      await admin.goto(BASE + path); await admin.waitForTimeout(600);
      await admin.evaluate((s) => { document.documentElement.dataset.scheme = s; }, scheme); await admin.waitForTimeout(600);
      await admin.evaluate(axeSource);
      const res = await admin.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'], resultTypes: ['violations'] }));
      assert.deepEqual(res.violations.map((v) => `${v.id}×${v.nodes.length}`), [], `axe ${scheme} ${path}`);
    }
    step('axe-core: no WCAG 2.x A/AA violations on dashboard, leave, roster, brand (light + dark)');
  } else console.log('- axe-core not installed: skipped accessibility scan');

  await browser.close();
  console.log('\nE2E passed');
})().catch((e) => { console.error('\nE2E FAILED:', e.message); process.exit(1); });
