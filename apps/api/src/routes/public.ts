import { z } from 'zod';
import type { AppCtx } from '../app.js';
import { HttpError } from '../auth.js';
import { SYSTEM, tenant, type Q } from '../db.js';
import { LineIn, computeTotals, priceLines } from '../pricing.js';
import { token } from '../crypto.js';
import { openStream, topics } from '../events.js';

const Customer = z.object({
  name: z.string().trim().max(60).optional(),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/).optional().or(z.literal('').transform(() => undefined)),
  email: z.string().trim().email().max(120).optional().or(z.literal('').transform(() => undefined)),
}).default({});

export async function publicRoutes({ app, db, svc, cfg }: AppCtx) {
  const resolveTable = (tok: string) => db.tx(SYSTEM, async (q) => {
    const r = await q.one(
      `select t.id as table_id, t.label, r.* from dining_tables t join restaurants r on r.id = t.restaurant_id
        where t.token = $1 and t.active and r.status = 'active'`, [tok]);
    if (!r) throw new HttpError(404, 'table_not_found', 'This QR code is not active');
    return r;
  });
  const orderAccess = async (id: string, t: unknown) => {
    if (typeof t !== 'string' || !z.string().uuid().safeParse(id).success) throw new HttpError(404, 'not_found');
    const o = await db.tx(SYSTEM, (q) => q.one(`select id, restaurant_id from orders where id = $1 and tracking_token = $2`, [id, t]));
    if (!o) throw new HttpError(404, 'not_found', 'Order not found');
    return o as { id: string; restaurant_id: string };
  };

  const restaurantView = (r: any) => ({
    name: r.name, slug: r.slug, branding: r.branding, languages: ['en', 'si', 'ta'], defaultLang: r.default_lang,
    currency: r.currency, serviceChargeBps: r.service_charge_bps, taxBps: r.tax_bps, taxLabel: r.tax_label,
  });

  app.get('/api/public/t/:token', async (req, reply) => {
    const r = await resolveTable((req.params as any).token);
    const menu = await db.tx(tenant(r.id), async (q) => {
      const cats = await q.query(`select id, name, sort from menu_categories where active order by sort, name->>'en'`);
      const items = await q.query(`select id, category_id, name, description, price_cents, image_url, available, tags, prep_minutes
                                     from menu_items order by sort, created_at`);
      const groups = await q.query(`select id, item_id, name, min_select, max_select from option_groups order by sort`);
      const opts = await q.query(`select id, group_id, name, price_delta_cents, available from options order by sort`);
      return cats.map((c: any) => ({
        id: c.id, name: c.name,
        items: items.filter((i: any) => i.category_id === c.id).map((i: any) => ({
          id: i.id, name: i.name, description: i.description, priceCents: i.price_cents, imageUrl: i.image_url,
          available: i.available, tags: i.tags, prepMinutes: i.prep_minutes,
          optionGroups: groups.filter((g: any) => g.item_id === i.id).map((g: any) => ({
            id: g.id, name: g.name, min: g.min_select, max: g.max_select,
            options: opts.filter((o: any) => o.group_id === g.id).map((o: any) => ({ id: o.id, name: o.name, priceDeltaCents: o.price_delta_cents, available: o.available })),
          })),
        })),
      })).filter((c: any) => c.items.length);
    });
    reply.header('Cache-Control', 'no-store');
    return { restaurant: restaurantView(r), table: { id: r.table_id, label: r.label }, menu, sandbox: cfg.allowSandbox };
  });

  const QuoteBody = z.object({ items: z.array(LineIn).min(1).max(40) });
  app.post('/api/public/t/:token/quote', async (req) => {
    const r = await resolveTable((req.params as any).token);
    const b = QuoteBody.parse(req.body);
    return db.tx(tenant(r.id), async (q) => {
      const lines = await priceLines(q, b.items);
      const t = computeTotals(lines.reduce((s, l) => s + l.lineTotalCents, 0), r.service_charge_bps, r.tax_bps);
      return { lines: lines.map((l) => ({ itemId: l.itemId, unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents })), ...t, currency: r.currency };
    });
  });

  app.post('/api/public/t/:token/orders', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req) => {
    const r = await resolveTable((req.params as any).token);
    const key = String(req.headers['idempotency-key'] ?? '');
    if (key.length < 8 || key.length > 80) throw new HttpError(400, 'idempotency_key_required', 'Idempotency-Key header required');
    const b = z.object({ items: z.array(LineIn).min(1).max(40), customer: Customer, lang: z.enum(['en', 'si', 'ta']).default('en'), notes: z.string().max(300).optional() }).parse(req.body);
    return db.tx(tenant(r.id), async (q) => {
      const existing = await q.one(`select id, number, tracking_token, total_cents from orders where idempotency_key = $1`, [key]);
      if (existing) return { orderId: existing.id, number: existing.number, trackingToken: existing.tracking_token, totalCents: existing.total_cents, replay: true };
      const spam = await q.one(`select count(*)::int as n from orders where table_id = $1 and status = 'pending_payment' and created_at > now() - interval '10 minutes'`, [r.table_id]);
      if (spam.n >= 8) throw new HttpError(429, 'too_many_open_orders', 'Please complete or wait for your existing orders');
      const lines = await priceLines(q, b.items);
      const t = computeTotals(lines.reduce((s, l) => s + l.lineTotalCents, 0), r.service_charge_bps, r.tax_bps);
      const seq = (await q.one(`update restaurants set order_seq = order_seq + 1 where id = $1 returning order_seq`, [r.id])).order_seq;
      const live = await q.one(`select 1 from restaurant_payment_configs where enabled and mode = 'live'`);
      const o = await q.one(
        `insert into orders (restaurant_id, table_id, number, subtotal_cents, service_charge_cents, tax_cents, total_cents, currency,
           customer_name, customer_phone, customer_email, lang, notes, tracking_token, idempotency_key, mode)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id, number, tracking_token, total_cents`,
        [r.id, r.table_id, seq, t.subtotal, t.service, t.tax, t.total, r.currency, b.customer.name ?? null, b.customer.phone ?? null,
         b.customer.email ?? null, b.lang, b.notes ?? null, token(24), key, live ? 'live' : 'sandbox']);
      for (const l of lines)
        await q.query(`insert into order_items (restaurant_id, order_id, item_id, name, unit_price_cents, qty, options, note, line_total_cents)
                       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [r.id, o.id, l.itemId, JSON.stringify(l.name), l.unitPriceCents, l.qty, JSON.stringify(l.options), l.note ?? null, l.lineTotalCents]);
      return { orderId: o.id, number: o.number, trackingToken: o.tracking_token, totalCents: o.total_cents, replay: false };
    });
  });

  /** Order + payment view for the customer's phone (also the receipt data). */
  async function orderView(restaurantId: string, id: string) {
    return db.tx(tenant(restaurantId), async (q: Q) => {
      const o = await q.one(
        `select o.*, t.label as table_label, r.name as rname, r.slug, r.branding, r.address, r.phone as rphone, r.tax_label, r.tax_reg_no, r.city,
                r.service_charge_bps, r.tax_bps
           from orders o join dining_tables t on t.id = o.table_id join restaurants r on r.id = o.restaurant_id where o.id = $1`, [id]);
      const items = await q.query(`select name, qty, unit_price_cents, options, note, line_total_cents from order_items where order_id = $1 order by id`, [id]);
      const pay = await q.one(`select * from payments where order_id = $1 order by (status = 'paid') desc, created_at desc limit 1`, [id]);
      const fb = await q.one(`select rating from feedback where order_id = $1`, [id]);
      const prep = await q.one(`select coalesce(max(i.prep_minutes), 10) as m from order_items oi join menu_items i on i.id = oi.item_id where oi.order_id = $1`, [id]);
      return {
        id: o.id, number: o.number, status: o.status, paymentStatus: o.payment_status, lang: o.lang, mode: o.mode, sandbox: o.mode === 'sandbox',
        table: o.table_label, createdAt: o.created_at, paidAt: o.paid_at, preparingAt: o.preparing_at, readyAt: o.ready_at, servedAt: o.served_at,
        etaMinutes: prep.m,
        totals: { subtotal: o.subtotal_cents, service: o.service_charge_cents, tax: o.tax_cents, total: o.total_cents, refunded: o.refunded_cents, currency: o.currency },
        rates: { serviceBps: o.service_charge_bps, taxBps: o.tax_bps, taxLabel: o.tax_label },
        items: items.map((i: any) => ({ name: i.name, qty: i.qty, unitPriceCents: i.unit_price_cents, options: i.options, note: i.note, lineTotalCents: i.line_total_cents })),
        restaurant: { name: o.rname, slug: o.slug, branding: o.branding, address: o.address, phone: o.rphone, city: o.city, taxRegNo: o.tax_reg_no },
        payment: pay ? { id: pay.id, method: pay.method, status: pay.status, reference: pay.provider_ref, paidAt: pay.paid_at } : null,
        feedbackGiven: fb?.rating ?? null,
      };
    });
  }

  app.get('/api/public/orders/:id', async (req, reply) => {
    const { id } = req.params as any; const a = await orderAccess(id, (req.query as any).t);
    reply.header('Cache-Control', 'no-store');
    return orderView(a.restaurant_id, id);
  });

  app.get('/api/public/orders/:id/methods', async (req) => {
    const { id } = req.params as any; const a = await orderAccess(id, (req.query as any).t);
    return { methods: await svc.methodsFor(a.restaurant_id) };
  });

  app.post('/api/public/orders/:id/payments', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = req.params as any; const a = await orderAccess(id, (req.query as any).t);
    const b = z.object({ method: z.enum(['lankaqr', 'card']) }).parse(req.body);
    const key = req.headers['idempotency-key'];
    return svc.createPayment({ restaurantId: a.restaurant_id, orderId: id, method: b.method, idempotencyKey: typeof key === 'string' ? key : undefined });
  });

  app.get('/api/public/payments/:pid', async (req, reply) => {
    const { pid } = req.params as any; const t = (req.query as any).t;
    if (!z.string().uuid().safeParse(pid).success) throw new HttpError(404, 'not_found');
    const link = await db.tx(SYSTEM, (q) => q.one(
      `select p.restaurant_id, p.order_id, p.last_checked_at from payments p join orders o on o.id = p.order_id
        where p.id = $1 and o.tracking_token = $2`, [pid, String(t ?? '')]));
    if (!link) throw new HttpError(404, 'not_found');
    // Server-side enquiry, throttled: covers a lost/late webhook without hammering the provider.
    const stale = !link.last_checked_at || Date.now() - new Date(link.last_checked_at).getTime() > 2500;
    const p = stale ? await svc.refresh(link.restaurant_id, pid)
      : await db.tx(tenant(link.restaurant_id), (q) => q.one(`select * from payments where id = $1`, [pid]));
    reply.header('Cache-Control', 'no-store');
    return svc.view(p);
  });

  app.post('/api/public/orders/:id/feedback', async (req) => {
    const { id } = req.params as any; const a = await orderAccess(id, (req.query as any).t);
    const b = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional() }).parse(req.body);
    await db.tx(tenant(a.restaurant_id), async (q) => {
      const o = await q.one(`select status from orders where id = $1`, [id]);
      if (!['ready', 'served'].includes(o.status)) throw new HttpError(409, 'too_early', 'You can leave feedback once your order is ready');
      await q.query(`insert into feedback (restaurant_id, order_id, rating, comment) values ($1,$2,$3,$4) on conflict (order_id) do nothing`, [a.restaurant_id, id, b.rating, b.comment ?? null]);
    });
    return { ok: true };
  });

  app.get('/api/public/orders/:id/stream', async (req, reply) => {
    const { id } = req.params as any; await orderAccess(id, (req.query as any).t);
    openStream(req, reply, [topics.order(id)], { type: 'hello' });
  });
}
