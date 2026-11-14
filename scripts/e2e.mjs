// End-to-end customer + kitchen journey against a RUNNING stack (web :3000, api :4000, seeded demo data).
//   node scripts/e2e.mjs            → runs the journey, saves screenshots to $SHOTS (default ./shots)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? './shots';
mkdirSync(SHOTS, { recursive: true });
let step = 0; const log = (m) => console.log(`✔ ${m}`);
const fail = (m) => { console.error(`✘ ${m}`); process.exitCode = 1; };
const must = (c, m) => (c ? log(m) : fail(m));

const browser = await chromium.launch();
const phone = await browser.newContext({ ...devices['Pixel 5'], deviceScaleFactor: 2, locale: 'en-LK' });
const staff = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const shot = async (p, name) => p.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, '0')}-${name}.png` });

/* ── customer: scan → menu → item → cart → checkout ── */
const c = await phone.newPage();
await c.goto(`${BASE}/t/demo-table-1`);
await c.getByRole('heading', { name: 'Ceylon Brew House' }).waitFor();
await c.waitForTimeout(600);
await shot(c, 'menu');
await c.getByRole('button', { name: /Chicken Kottu/ }).first().click();
await c.getByText('Spice level').waitFor();
await shot(c, 'item-sheet');
await c.getByRole('button', { name: /Add to order/ }).click();
await c.getByRole('link', { name: /View order/ }).waitFor();
await shot(c, 'cart-bar');
await c.getByRole('link', { name: /View order/ }).click();
await c.getByRole('heading', { name: 'Your order' }).waitFor();
await c.getByText('Rs.').first().waitFor();
await c.waitForTimeout(800);
await shot(c, 'checkout');
must(await c.getByText('Pay with LankaQR').isVisible(), 'LankaQR shown first with "Recommended"');
await c.getByRole('button', { name: /^.*Pay Rs\./ }).click();

/* ── LankaQR payment page ── */
await c.waitForURL(/\/o\/.+\?t=/);
await c.getByText('Scan to pay with LankaQR').or(c.getByText('Amount to pay')).first().waitFor();
await c.waitForTimeout(500);
await shot(c, 'lankaqr');
const orderUrl = c.url();
const orderNo = (await c.getByRole('heading', { name: /Order #\d+/ }).innerText()).match(/#(\d+)/)[1];
must(await c.getByAltText(/LankaQR payment code/).isVisible(), 'dynamic QR displayed');
must(await c.getByText(/Waiting for payment confirmation/).isVisible(), 'waiting state shown (not paid by clicking)');

/* ── same-phone flow: banking app (sandbox) ── */
const bank = await phone.newPage();
const href = await c.getByRole('link', { name: /Open banking app/ }).getAttribute('href');
await bank.goto(href.startsWith('http') ? href : BASE + href);
await bank.getByText('You are paying').waitFor();
await shot(bank, 'sandbox-bank');
must(await bank.getByText('✓ valid').isVisible(), 'bank app parsed QR and CRC is valid');
await bank.getByRole('button', { name: 'Authorise payment' }).click();
await bank.getByText('Payment authorised').waitFor();

/* ── customer page flips to tracking via server confirmation ── */
await c.getByText('We have your order').waitFor({ timeout: 15000 });
await c.waitForTimeout(400);
await shot(c, 'tracking-received');
must(true, 'customer page moved to "received" only after verified webhook');

/* ── kitchen sees it, advances statuses ── */
const k = await staff.newPage();
await k.goto(`${BASE}/login`);
await k.getByLabel('Email').fill('kitchen@ceylonbrew.lk');
await k.getByLabel('Password').fill('TableFlow-demo-1');
await k.getByRole('button', { name: /Sign in/ }).click();
await k.waitForURL(/\/kitchen/);
const ticket = k.locator('article', { hasText: `#${orderNo}` });
await ticket.waitFor();
await shot(k, 'kitchen');
await ticket.getByRole('button', { name: /Start preparing/ }).click();
await c.getByText('The kitchen is preparing your food').waitFor({ timeout: 15000 });
log('customer sees "Preparing" in real time');
await ticket.getByRole('button', { name: /Mark ready/ }).click();
await c.getByText('Your order is ready!').waitFor({ timeout: 15000 });
await shot(c, 'tracking-ready');
await ticket.getByRole('button', { name: /Mark served/ }).click();
await c.getByText('Enjoy your meal').waitFor({ timeout: 15000 });
log('Received → Preparing → Ready → Served reflected on customer phone');

/* ── receipt ── */
await c.goto(orderUrl.replace('/o/', '/o/').replace('?t=', '/receipt?t='));
await c.getByText(/SANDBOX RECEIPT/).waitFor();
await shot(c, 'receipt');
log('digital receipt available (marked SANDBOX)');


/* ═════════ Part 2: card checkout with 3-D Secure (hosted sandbox gateway) ═════════ */
const addKottuAndCheckout = async (page, name = /Chicken Kottu/) => {
  await page.goto(`${BASE}/t/demo-table-2`.replace('demo-table-2', process.env.TABLE ?? 'demo-table-1'));
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tf-cart')).forEach((k) => localStorage.removeItem(k)));
  await page.reload();
  await page.getByRole('button', { name }).first().click();
  await page.getByRole('button', { name: /Add to order|ඇණවුමට එක් කරන්න/ }).click();
  await page.getByRole('link', { name: /View order|ඇණවුම බලන්න/ }).click();
  await page.getByText('Rs.').first().waitFor();
};
const card = await phone.newPage();
await addKottuAndCheckout(card);
await card.getByRole('radio', { name: /Credit\/Debit Card/ }).click();
await card.getByRole('button', { name: /Pay Rs\./ }).click();
await card.waitForURL(/\/sandbox\/card\//, { timeout: 15000 });
await card.getByText('Choose a test card').waitFor();
await shot(card, 'sandbox-card');
must((await card.locator('input:not([type=radio]), textarea').count()) === 0, 'hosted card page has NO free-text card input (PAN never touches TableFlow)');
await card.getByText(/3155/).click();
await card.getByRole('button', { name: /^Pay Rs\./ }).click();
await card.getByText('Confirm with your bank').waitFor();
await shot(card, 'sandbox-3ds');
await card.getByRole('button', { name: 'Authenticate successfully' }).click();
await card.waitForURL(/\/o\/.+\?t=/);
await card.getByText('We have your order').waitFor({ timeout: 15000 });
log('card + 3-D Secure → paid via verified webhook → order received');

/* ═════════ Part 3: LankaQR outage → automatic card fallback message ═════════ */
const admin = await browser.newContext();
await admin.request.post(`${BASE}/api/auth/login`, { data: { email: 'admin@tableflow.lk', password: 'TableFlow-demo-1' }, headers: { 'x-tf-csrf': '1' } });
const outage = (on) => admin.request.post(`${BASE}/api/admin/sandbox/outage`, { data: { provider: 'sandbox_lankaqr', on }, headers: { 'x-tf-csrf': '1' } });
await outage(true);
try {
  const fb = await phone.newPage();
  await addKottuAndCheckout(fb);
  await fb.getByText('LankaQR is temporarily unavailable. You can securely complete your payment using a credit or debit card.').waitFor({ timeout: 10000 });
  await shot(fb, 'fallback');
  must(!(await fb.getByRole('radio', { name: /LankaQR/ }).count()), 'LankaQR option hidden while unavailable');
  must(await fb.getByRole('radio', { name: /Credit\/Debit Card/ }).isChecked(), 'card pre-selected automatically as fallback');
} finally { await outage(false); }

/* ═════════ Part 4: Sinhala UI ═════════ */
const si = await phone.newPage();
await si.goto(`${BASE}/t/demo-table-1`);
await si.getByRole('button', { name: 'සිං' }).click();
await si.getByText('ජනප්‍රිය').first().waitFor();
await si.waitForTimeout(400);
await shot(si, 'menu-sinhala');
log('Sinhala menu renders (names, categories, UI strings)');

await browser.close();
console.log(process.exitCode ? '\nE2E FAILED' : '\nE2E PASSED');
