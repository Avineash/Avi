import { loadConfig } from './config.js';
import { openDb, SYSTEM, type Db, type Q } from './db.js';
import { hashPassword } from './crypto.js';
import { computeTotals } from './pricing.js';
import { fileURLToPath } from 'node:url';

export const DEMO_PASSWORD = 'TableFlow-demo-1';
export const DEMO_TOKEN = 'demo-table-1';

export async function ensureBasePlans(db: Db) {
  await db.tx(SYSTEM, async (q) => {
    // Illustrative pricing only — set real plans in the admin console.
    for (const p of [['starter', 'Starter', 490000, 50, 12], ['growth', 'Growth', 990000, 30, 40], ['pro', 'Pro', 1990000, 20, 150]])
      await q.query(`insert into plans (id,name,monthly_fee_cents,txn_fee_bps,max_tables) values ($1,$2,$3,$4,$5) on conflict (id) do nothing`, p);
  });
}

const T = (en: string, si = '', ta = '') => ({ en, si, ta });
type Opt = [ReturnType<typeof T>, number];
type Grp = { name: ReturnType<typeof T>; min: number; max: number; opts: Opt[] };
interface Item { slug: string; name: ReturnType<typeof T>; desc: string; price: number; tags?: string[]; prep?: number; groups?: Grp[] }

const spice: Grp = { name: T('Spice level', 'සැර මට්ටම', 'காரம்'), min: 1, max: 1,
  opts: [[T('Mild', 'මෘදු', 'மிதம்'), 0], [T('Medium', 'මධ්‍යම', 'நடுத்தரம்'), 0], [T('Hot', 'සැරයි', 'அதிக காரம்'), 0]] };
const sugar: Grp = { name: T('Sugar', 'සීනි', 'சர்க்கரை'), min: 1, max: 1,
  opts: [[T('Regular', 'සාමාන්‍ය', 'வழக்கம்'), 0], [T('Less sugar', 'සීනි අඩු', 'குறைந்த சர்க்கரை'), 0], [T('No sugar', 'සීනි නැත', 'சர்க்கரை இல்லை'), 0]] };

const MENU: { cat: ReturnType<typeof T>; items: Item[] }[] = [
  { cat: T('Rice & Kottu', 'බත් සහ කොත්තු', 'சோறு & கொத்து'), items: [
    { slug: 'chicken-kottu', name: T('Chicken Kottu', 'කුකුල් මස් කොත්තු', 'கோழி கொத்து'), desc: 'Chopped godamba roti stir-fried with chicken, egg, leeks and curry sauce.', price: 145000, tags: ['popular'], prep: 15,
      groups: [spice, { name: T('Extras', 'අමතර', 'கூடுதல்'), min: 0, max: 3, opts: [[T('Extra egg', 'අමතර බිත්තරයක්', 'கூடுதல் முட்டை'), 15000], [T('Cheese', 'චීස්', 'சீஸ்'), 30000], [T('Curry gravy', 'කරි ග්‍රේවි', 'கறி கிரேவி'), 10000]] }] },
    { slug: 'veg-kottu', name: T('Vegetable Kottu', 'එළවළු කොත්තු', 'காய்கறி கொத்து'), desc: 'Vegetable kottu with carrot, cabbage and fresh herbs.', price: 110000, tags: ['vegetarian'], prep: 12, groups: [spice] },
    { slug: 'cheese-kottu', name: T('Cheese Kottu', 'චීස් කොත්තු', 'சீஸ் கொத்து'), desc: 'The Colombo favourite: kottu smothered in melted cheese.', price: 165000, prep: 15, groups: [spice] },
    { slug: 'rice-curry', name: T('Rice & Curry (Chicken)', 'බත් සහ කරි', 'சோறும் கறியும்'), desc: 'Steamed red rice with chicken curry, dhal, pol sambol and three vegetable curries.', price: 130000, tags: ['popular'], prep: 12 },
    { slug: 'lamprais', name: T('Lamprais', 'ලම්ප්‍රයිස්', 'லம்ப்ரைஸ்'), desc: 'Dutch-Burgher classic baked in a banana leaf: rice, meat curry, blachan, ash plantain.', price: 175000, prep: 20 },
  ] },
  { cat: T('Hoppers & Short Eats', 'ආප්ප සහ කෙටි ආහාර', 'அப்பம் & சிற்றுண்டி'), items: [
    { slug: 'egg-hopper', name: T('Egg Hopper', 'බිත්තර ආප්ප', 'முட்டை அப்பம்'), desc: 'Crisp-edged bowl hopper with a soft egg. Served with lunu miris.', price: 25000, tags: ['popular'], prep: 8 },
    { slug: 'plain-hopper', name: T('Plain Hopper', 'සාමාන්‍ය ආප්ප', 'சாதா அப்பம்'), desc: 'Fermented rice-flour and coconut milk hopper.', price: 12000, tags: ['vegetarian'], prep: 6 },
    { slug: 'string-hoppers', name: T('String Hoppers (6)', 'ඉඳිආප්ප (6)', 'இடியாப்பம் (6)'), desc: 'Steamed rice-flour noodle nests with dhal and sambol.', price: 65000, tags: ['vegetarian'], prep: 10 },
    { slug: 'fish-cutlet', name: T('Fish Cutlet', 'මාළු කට්ලට්', 'மீன் கட்லெட்'), desc: 'Crumbed tuna and potato croquette.', price: 18000, prep: 5 },
    { slug: 'isso-wade', name: T('Isso Wade', 'ඉස්සෝ වඩේ', 'இறால் வடை'), desc: 'Crunchy dhal fritter topped with a whole prawn.', price: 45000, prep: 8 },
  ] },
  { cat: T('Café', 'කැෆේ', 'கஃபே'), items: [
    { slug: 'club-sandwich', name: T('Club Sandwich', 'ක්ලබ් සැන්ඩ්විච්', 'கிளப் சாண்ட்விச்'), desc: 'Triple-decker with chicken, egg, tomato and lettuce. With fries.', price: 135000, prep: 10 },
    { slug: 'avocado-toast', name: T('Avocado Toast', 'අලිගැටපේර ටෝස්ට්', 'அவகாடோ டோஸ்ட்'), desc: 'Sourdough, smashed avocado, lime, chilli flakes.', price: 125000, tags: ['vegetarian'], prep: 8 },
  ] },
  { cat: T('Drinks', 'බීම', 'பானங்கள்'), items: [
    { slug: 'milk-tea', name: T('Ceylon Milk Tea', 'කිරි තේ', 'பால் தேநீர்'), desc: 'Strong Ceylon tea with fresh milk.', price: 35000, tags: ['popular'], prep: 4, groups: [sugar] },
    { slug: 'iced-coffee', name: T('Iced Coffee', 'අයිස් කෝපි', 'ஐஸ் காபி'), desc: 'Cold-brewed coffee over ice with milk.', price: 65000, prep: 4, groups: [sugar] },
    { slug: 'king-coconut', name: T('King Coconut', 'තැඹිලි', 'செவ்விளநீர்'), desc: 'Chilled, straight from the tree.', price: 45000, tags: ['vegan'], prep: 2 },
    { slug: 'wood-apple', name: T('Wood Apple Juice', 'දිවුල් බීම', 'விளாம்பழ பானம்'), desc: 'Tangy, creamy wood-apple (divul) juice.', price: 50000, prep: 4 },
    { slug: 'lime-soda', name: T('Fresh Lime Soda', 'දෙහි සෝඩා', 'எலுமிச்சை சோடா'), desc: 'Fresh lime, soda, salt or sweet.', price: 40000, prep: 3 },
  ] },
  { cat: T('Desserts', 'අතුරුපස', 'இனிப்பு'), items: [
    { slug: 'watalappan', name: T('Watalappan', 'වටලප්පන්', 'வட்டலப்பம்'), desc: 'Coconut custard with jaggery, cardamom and cashew.', price: 55000, tags: ['popular'], prep: 3 },
    { slug: 'biscuit-pudding', name: T('Biscuit Pudding', 'බිස්කට් පුඩිං', 'பிஸ்கட் புடிங்'), desc: 'Layered chocolate biscuit pudding.', price: 60000, prep: 3 },
  ] },
];

/** deterministic PRNG so demo data is reproducible */
function rng(seed: number) { return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; }

async function insertMenu(q: Q, rid: string, menu = MENU, withImages = true) {
  const items: { id: string; price: number; name: any; prep: number }[] = [];
  let ci = 0;
  for (const c of menu) {
    const cat = await q.one(`insert into menu_categories (restaurant_id, name, sort) values ($1,$2,$3) returning id`, [rid, JSON.stringify(c.cat), ci++]);
    let ii = 0;
    for (const it of c.items) {
      const r = await q.one(`insert into menu_items (restaurant_id, category_id, name, description, price_cents, image_url, tags, prep_minutes, sort) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [rid, cat.id, JSON.stringify(it.name), JSON.stringify({ en: it.desc }), it.price, withImages ? `/food/${it.slug}.svg` : null, it.tags ?? [], it.prep ?? 10, ii++]);
      items.push({ id: r.id, price: it.price, name: it.name, prep: it.prep ?? 10 });
      let gi = 0;
      for (const g of it.groups ?? []) {
        const gr = await q.one(`insert into option_groups (restaurant_id, item_id, name, min_select, max_select, sort) values ($1,$2,$3,$4,$5,$6) returning id`, [rid, r.id, JSON.stringify(g.name), g.min, g.max, gi++]);
        let oi = 0;
        for (const [n, d] of g.opts) await q.query(`insert into options (restaurant_id, group_id, name, price_delta_cents, sort) values ($1,$2,$3,$4,$5)`, [rid, gr.id, JSON.stringify(n), d, oi++]);
      }
    }
  }
  return items;
}

async function createRestaurant(q: Q, o: { slug: string; name: string; city: string; status: string; plan: string; branding?: object; tax?: number; ownerEmail: string; ownerName: string; hash: string }) {
  const r = await q.one(`insert into restaurants (slug, name, city, email, status, plan_id, service_charge_bps, tax_bps, tax_label, tax_reg_no, branding, approved_at, address, phone)
    values ($1,$2,$3,$4,$5,$6,1000,$7,'VAT',$8,$9, case when $5 = 'active' then now() end, $10, '+94 11 234 5678') returning id`,
    [o.slug, o.name, o.city, o.ownerEmail, o.status, o.plan, o.tax ?? 0, o.tax ? 'VAT-DEMO-000000' : null, JSON.stringify(o.branding ?? {}), '12 Galle Road, Colombo 03']);
  await q.query(`insert into users (restaurant_id, email, name, role, password_hash) values ($1,$2,$3,'owner',$4)`, [r.id, o.ownerEmail, o.ownerName, o.hash]);
  return r.id as string;
}
async function sandboxConfigs(q: Q, rid: string) {
  for (const [m, p, fee] of [['lankaqr', 'sandbox_lankaqr', 60], ['card', 'sandbox_card', 250]] as const)
    await q.query(`insert into restaurant_payment_configs (restaurant_id, method, provider, enabled, mode, fee_bps, config) values ($1,$2,$3,true,'sandbox',$4,$5)`, [rid, m, p, fee, JSON.stringify({ merchantId: `SBX-${rid.slice(0, 8).toUpperCase()}` })]);
}

export async function seedDemo(db: Db, opts: { history?: boolean } = {}) {
  await ensureBasePlans(db);
  const exists = await db.tx(SYSTEM, (q) => q.one(`select 1 from restaurants where slug = 'ceylon-brew'`));
  if (exists) return { created: false };
  const hash = await hashPassword(DEMO_PASSWORD);
  await db.tx(SYSTEM, async (q) => {
    await q.query(`insert into users (email, name, role, password_hash) values ('admin@tableflow.lk','Platform Admin','platform_admin',$1), ('support@tableflow.lk','Platform Support','platform_support',$1)`, [hash]);

    const rid = await createRestaurant(q, { slug: 'ceylon-brew', name: 'Ceylon Brew House', city: 'Colombo', status: 'active', plan: 'growth', tax: 1800, ownerEmail: 'owner@ceylonbrew.lk', ownerName: 'Nimali Perera', hash,
      branding: { primary: '#0F5C4D', secondary: '#E9A23B', font: 'modern', theme: 'auto', tagline: 'Colombo’s home for kottu & Ceylon tea' } });
    for (const [e, n, role] of [['manager@ceylonbrew.lk', 'Kasun Silva', 'manager'], ['kitchen@ceylonbrew.lk', 'Chef Ravi', 'kitchen'], ['cashier@ceylonbrew.lk', 'Dilini Fernando', 'cashier']])
      await q.query(`insert into users (restaurant_id, email, name, role, password_hash) values ($1,$2,$3,$4,$5)`, [rid, e, n, role, hash]);
    await sandboxConfigs(q, rid);
    for (let i = 1; i <= 10; i++)
      await q.query(`insert into dining_tables (restaurant_id, label, seats, token) values ($1,$2,$3,$4)`, [rid, `T${i}`, i % 3 === 0 ? 4 : 2, i === 1 ? DEMO_TOKEN : `demo-table-${i}-${Math.random().toString(36).slice(2, 10)}`]);
    const items = await insertMenu(q, rid);

    // A second tenant (proves isolation) and a pending application (admin approval queue).
    const r2 = await createRestaurant(q, { slug: 'kandy-lake-cafe', name: 'Kandy Lake Café', city: 'Kandy', status: 'active', plan: 'starter', ownerEmail: 'owner@kandylake.lk', ownerName: 'Suresh Bandara', hash,
      branding: { primary: '#7A1F3D', secondary: '#F2C14E', font: 'classic', theme: 'light' } });
    await sandboxConfigs(q, r2);
    await q.query(`insert into dining_tables (restaurant_id, label, seats, token) values ($1,'T1',2,'kandy-table-1')`, [r2]);
    await insertMenu(q, r2, [{ cat: MENU[3].cat, items: MENU[3].items.slice(0, 3) }, { cat: MENU[1].cat, items: MENU[1].items.slice(0, 2) }]);
    await createRestaurant(q, { slug: 'galle-fort-bites', name: 'Galle Fort Bites', city: 'Galle', status: 'pending', plan: 'starter', ownerEmail: 'owner@gallefortbites.lk', ownerName: 'Ayesha Rahman', hash });

    if (opts.history !== false) await history(q, rid, items);
  });
  return { created: true };
}

async function history(q: Q, rid: string, items: { id: string; price: number; name: any; prep: number }[]) {
  const rand = rng(42);
  const tables = await q.query(`select id from dining_tables where restaurant_id = $1`, [rid]);
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  let seq = 0;
  for (let d = 14; d >= 0; d--) {
    const n = Math.round((d === 0 ? 6 : 12 + rand() * 14) * (new Date(Date.now() - d * 864e5).getDay() % 6 === 0 ? 1.4 : 1));
    for (let k = 0; k < n; k++) {
      const at = new Date(Date.now() - d * 864e5); at.setHours(8 + Math.floor(rand() * 13), Math.floor(rand() * 60), 0, 0);
      if (at > new Date()) continue;
      const lines = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => { const it = pick(items); return { it, qty: 1 + Math.floor(rand() * 2) }; });
      const sub = lines.reduce((s, l) => s + l.it.price * l.qty, 0), t = computeTotals(sub, 1000, 1800);
      const method = rand() < 0.62 ? 'lankaqr' : 'card', roll = rand();
      const fee = Math.round(t.total * (method === 'lankaqr' ? 60 : 250) / 10000), platform = Math.round(t.total * 30 / 10000);
      const failed = roll < 0.07, refunded = !failed && roll > 0.97;
      seq++;
      const ref = (method === 'lankaqr' ? 'SBQ' : 'SBC') + (100000 + seq * 7919).toString(16).toUpperCase().padStart(12, '0');
      const o = await q.one(`insert into orders (restaurant_id, table_id, number, status, payment_status, subtotal_cents, service_charge_cents, tax_cents, total_cents, refunded_cents, tracking_token, mode, created_at, paid_at, preparing_at, ready_at, served_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'sandbox',$12,$13,$14,$15,$16) returning id`,
        [rid, pick(tables).id, 1000 + seq, failed ? 'expired' : 'served', failed ? 'unpaid' : refunded ? 'refunded' : 'paid', t.subtotal, t.service, t.tax, t.total, refunded ? t.total : 0, `hist-${seq}-${Math.random().toString(36).slice(2)}`,
         at, failed ? null : new Date(+at + 60e3), failed ? null : new Date(+at + 2 * 60e3), failed ? null : new Date(+at + (8 + rand() * 14) * 60e3), failed ? null : new Date(+at + 30 * 60e3)]);
      for (const l of lines) await q.query(`insert into order_items (restaurant_id, order_id, item_id, name, unit_price_cents, qty, line_total_cents) values ($1,$2,$3,$4,$5,$6,$7)`, [rid, o.id, l.it.id, JSON.stringify(l.it.name), l.it.price, l.qty, l.it.price * l.qty]);
      const settled = d > 2 && !failed;
      const p = await q.one(`insert into payments (restaurant_id, order_id, method, provider, mode, status, amount_cents, provider_ref, expires_at, paid_at, gateway_fee_cents, refunded_cents, settlement_status, settled_at, settlement_ref, failure_code, failure_message, created_at)
        values ($1,$2,$3,$4,'sandbox',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
        [rid, o.id, method, method === 'lankaqr' ? 'sandbox_lankaqr' : 'sandbox_card', failed ? 'failed' : 'paid', t.total, ref, new Date(+at + 15 * 60e3), failed ? null : new Date(+at + 60e3), failed ? 0 : fee, refunded ? t.total : 0,
         settled ? 'settled' : 'unsettled', settled ? new Date(+at + 864e5) : null, settled ? `STL-DEMO-${d}` : null, failed ? 'card_declined' : null, failed ? 'Payment was declined' : null, at]);
      await q.query(`insert into sandbox_txns (ref, provider, restaurant_id, merchant_ref, amount_cents, status, fee_cents, refunded_cents, paid_at, settled_at, settlement_ref, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [ref, method === 'lankaqr' ? 'sandbox_lankaqr' : 'sandbox_card', rid, p.id, t.total, failed ? 'failed' : 'paid', failed ? 0 : fee, refunded ? t.total : 0, failed ? null : new Date(+at + 60e3), settled ? new Date(+at + 864e5) : null, settled ? `STL-DEMO-${d}` : null, at]);
      if (failed) continue;
      await q.query(`update orders set paid_payment_id = $2 where id = $1`, [o.id, p.id]);
      const led = async (kind: string, amt: number) => q.query(`insert into ledger_entries (restaurant_id, payment_id, order_id, kind, amount_cents, ref, created_at) values ($1,$2,$3,$4,$5,$6,$7)`, [rid, p.id, o.id, kind, amt, ref, new Date(+at + 60e3)]);
      await led('charge', t.total); await led('gateway_fee', -fee); await led('platform_fee_accrued', -platform);
      if (refunded) { await q.query(`insert into refunds (restaurant_id, payment_id, order_id, amount_cents, reason, status, provider_ref, idempotency_key) values ($1,$2,$3,$4,'Order sent back — wrong item','succeeded','RF-'||$5,$6)`, [rid, p.id, o.id, t.total, ref, `seed-${seq}`]); await led('refund', -t.total); }
      if (rand() < 0.15) await q.query(`insert into feedback (restaurant_id, order_id, rating, comment, created_at) values ($1,$2,$3,$4,$5)`, [rid, o.id, 3 + Math.floor(rand() * 3), pick(['Great kottu!', 'Quick and easy to order.', 'Loved the QR payment.', 'Tea was perfect.', 'Hoppers were cold, otherwise good.']), new Date(+at + 40 * 60e3)]);
    }
  }
  await q.query(`update restaurants set order_seq = $2 where id = $1`, [rid, 1000 + seq]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  if (cfg.env === 'production') { console.error('Refusing to seed demo data in production'); process.exit(1); }
  const db = await openDb(cfg);
  const r = await seedDemo(db);
  console.log(r.created ? 'Demo data created.' : 'Demo data already present.');
  console.log(`\n  Demo logins (password: ${DEMO_PASSWORD})\n   owner     owner@ceylonbrew.lk\n   manager   manager@ceylonbrew.lk\n   kitchen   kitchen@ceylonbrew.lk\n   cashier   cashier@ceylonbrew.lk\n   platform  admin@tableflow.lk\n   customer  /t/${DEMO_TOKEN}\n`);
  await db.close();
}
