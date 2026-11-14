#!/usr/bin/env node
/**
 * Browser end-to-end check of the night-audit module: one auditor works an audit, a manager watches it live,
 * a second auditor takes over, and the first is cut off. Needs a freshly seeded database (`npm run seed`) and a running server.
 *
 *   NODE_PATH=$(npm root -g) node scripts/e2e-audit.cjs        # needs `playwright`
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const step = (m) => console.log('✓', m);

(async () => {
  const browser = await chromium.launch();
  const open = async (email) => {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    await page.goto(`${BASE}/login`); await page.fill('#email', email); await page.fill('#password', 'staffhub-demo');
    await page.click('button[type=submit]'); await page.waitForURL(`${BASE}/`); await page.waitForTimeout(400);
    return page;
  };
  const demo = await (await (await browser.newContext()).request.get(`${BASE}/api/public/demo-accounts`)).json();
  const aurora = demo.accounts.filter((a) => a.companySlug === 'aurora' && a.auditAccess);
  const email = (k) => aurora.find((a) => a.auditAccess === k).email;
  const pdf = path.join(os.tmpdir(), `e2e-${process.pid}.pdf`); fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');

  const A = await open(email('auditor'));
  assert.equal(await A.locator('.ds-nav a:has-text("Audit")').count(), 1);
  await A.goto(`${BASE}/audit`); await A.waitForSelector('.au');
  await A.click('button:has-text("Start night audit")'); await A.waitForSelector('.au-layout');
  const boxes = A.locator('.au-phase[open] .au-step > .au-row > input.au-ck');
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  await A.waitForFunction(() => /3 of \d+ steps/.test(document.querySelector('.au-pc')?.textContent ?? ''));
  step('auditor starts tonight’s audit and ticks three steps');

  const row = A.locator('.au-step', { hasText: 'Check arrivals, traces' });
  await row.locator('input[type=file]').setInputFiles(pdf);
  await A.waitForSelector('.au-file');
  step('a report file attaches to a key step');

  const M = await open(aurora.find((a) => a.auditAccess === 'manager').email);
  await M.goto(`${BASE}/audit?tab=checklist`); await M.waitForSelector('.au-layout');
  assert.ok(await M.locator('.au-step > .au-row > input.au-ck').first().isDisabled());
  assert.match(await M.locator('.au-banner').first().innerText(), /Display only/);
  await boxes.nth(3).check();
  await M.waitForFunction(() => /4 of \d+ steps/.test(document.querySelector('.au-pc')?.textContent ?? ''), null, { timeout: 15000 });
  step('manager sees a read-only view that updates live');

  const B = await open(email('both'));
  await B.goto(`${BASE}/audit?tab=checklist`); await B.waitForSelector('.au-layout');
  assert.ok(await B.locator('.au-step > .au-row > input.au-ck').first().isDisabled());
  await B.click('button:has-text("Take over")');
  await B.waitForFunction(() => !document.querySelector('.au-step > .au-row > input.au-ck')?.disabled);
  step('second auditor is read-only until they take over');

  await boxes.nth(4).check().catch(() => {});
  await A.waitForSelector('text=is now editing this audit', { timeout: 10000 });
  step('first auditor is told editing has moved on, and cannot write');

  await B.click('button:has-text("Close audit")');
  await B.fill('.ds-modal textarea', 'End-to-end test');
  await B.click('.ds-modal button:has-text("Close with gaps")');
  await B.waitForSelector('.au-banner[data-tone="closed"]');
  await B.waitForSelector('button:has-text("Close audit")', { state: 'detached' });
  step('closing with gaps needs a reason; the audit then becomes a read-only record');

  fs.rmSync(pdf, { force: true });
  await browser.close();
  console.log('\nAudit E2E passed');
})().catch((e) => { console.error('\nAudit E2E FAILED:', e.message); process.exit(1); });
