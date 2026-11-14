import { z } from 'zod';
import QRCode from 'qrcode';
import { createWriteStream, createReadStream, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import type { AppCtx } from '../app.js';
import { HttpError, actorOf } from '../auth.js';
import { tenant, type Q } from '../db.js';
import { audit } from '../audit.js';
import { hashPassword, token } from '../crypto.js';
import { publish, topics, openStream } from '../events.js';
import { reconcile, dayStart, dayAfter } from '../payments/reconcile.js';

const L = z.object({ en: z.string().trim().min(1).max(120), si: z.string().trim().max(120).optional().default(''), ta: z.string().trim().max(120).optional().default('') });
const LOpt = z.object({ en: z.string().trim().max(400).optional().default(''), si: z.string().trim().max(400).optional().default(''), ta: z.string().trim().max(400).optional().default('') });
const Date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const FLOW: Record<string, string[]> = { received: ['preparing'], preparing: ['ready', 'received'], ready: ['served', 'preparing'], served: [] };
const TS: Record<string, string> = { preparing: 'preparing_at', ready: 'ready_at', served: 'served_at' };

export const csv = (rows: any[][]) => rows.map((r) => r.map((c) => {
  let s = c == null ? '' : c instanceof Date ? c.toISOString() : String(c);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                      // neutralise spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n');

export async function restaurantRoutes({ app, db, cfg, svc, guard }: AppCtx) {
  const R = (req: any) => req.auth!.restaurantId as string;
  const tx = <T>(req: any, fn: (q: Q) => Promise<T>) => db.tx(tenant(R(req)), fn);
  const pre = (...p: Parameters<typeof guard>) => ({ preHandler: guard(...p) });
  // Every /api/r/* route needs a restaurant-bound user (platform staff use /api/admin/*).
  const mustBeTenant = (req: any) => { if (!req.auth?.restaurantId) throw new HttpError(403, 'forbidden', 'Restaurant account required'); };

  /* ───────── orders & kitchen ───────── */
  const orderSelect = `select o.id, o.number, o.status, o.payment_status, o.total_cents, o.notes, o.customer_name, o.created_at, o.paid_at,
        o.preparing_at, o.ready_at, o.served_at, o.mode, o.refunded_cents, t.label as table_label,
        (select method from payments p where p.id = o.paid_payment_id) as method,
        coalesce((select json_agg(json_build_object('name', i.name, 'qty', i.qty, 'options', i.options, 'note', i.note) order by i.id)
                  from order_items i where i.order_id = o.id), '[]'::json) as items
      from orders o join dining_tables t on t.id = o.table_id`;
  const orderDto = (o: any) => ({ id: o.id, number: o.number, status: o.status, paymentStatus: o.payment_status, totalCents: o.total_cents,
    notes: o.notes, customerName: o.customer_name, table: o.table_label, createdAt: o.created_at, paidAt: o.paid_at, preparingAt: o.preparing_at,
    readyAt: o.ready_at, servedAt: o.served_at, mode: o.mode, method: o.method, refundedCents: o.refunded_cents, items: o.items });

  app.get('/api/r/orders', pre('orders:read'), async (req) => {
    mustBeTenant(req);
    const b = z.object({ view: z.enum(['active', 'pending', 'history']).default('active'), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(req.query);
    const where = b.view === 'active' ? `o.status in ('received','preparing','ready')`
      : b.view === 'pending' ? `o.status = 'pending_payment' and o.created_at > now() - interval '30 minutes'`
      : `o.status in ('served','cancelled','expired') or o.payment_status in ('refunded','partially_refunded')`;
    const rows = await tx(req, (q) => q.query(`${orderSelect} where ${where} order by o.created_at ${b.view === 'history' ? 'desc' : 'asc'} limit ${b.limit}`));
    return rows.map(orderDto);
  });

  app.post('/api/r/orders/:id/status', pre('orders:update'), async (req) => {
    mustBeTenant(req);
    const id = (req.params as any).id; const to = z.object({ status: z.enum(['received', 'preparing', 'ready', 'served']) }).parse(req.body).status;
    const res = await tx(req, async (q) => {
      const o = await q.one(`select * from orders where id = $1 for update`, [id]);
      if (!o) throw new HttpError(404, 'not_found');
      if (!['paid', 'partially_refunded'].includes(o.payment_status)) throw new HttpError(409, 'not_paid', 'Order is not paid yet');
      if (!FLOW[o.status]?.includes(to)) throw new HttpError(409, 'bad_transition', `Cannot move ${o.status} → ${to}`);
      await q.query(`update orders set status = $2 ${TS[to] ? `, ${TS[to]} = now()` : ''} where id = $1`, [id, to]);
      await audit(q, R(req), actorOf(req.auth!), 'order.status', 'order', id, { from: o.status, to });
      return { id, number: o.number, from: o.status, to };
    });
    publish(topics.restaurant(R(req)), { type: 'order.status', orderId: id, status: res.to, number: res.number });
    publish(topics.order(id), { type: 'order.updated', status: res.to });
    return { ok: true, status: res.to };
  });

  app.get('/api/r/stream', pre('orders:read'), async (req, reply) => {
    mustBeTenant(req);
    openStream(req, reply, [topics.restaurant(R(req))], { type: 'hello' });
  });

  /* ───────── tables & QR ───────── */
  app.get('/api/r/tables', pre('orders:read'), async (req) => { mustBeTenant(req);
    return (await tx(req, (q) => q.query(`select id, label, seats, token, active from dining_tables order by length(label), label`)))
      .map((t: any) => ({ ...t, url: `${cfg.publicUrl}/t/${t.token}` })); });
  app.post('/api/r/tables', pre('tables:write'), async (req) => { mustBeTenant(req);
    const b = z.object({ label: z.string().trim().min(1).max(20), seats: z.number().int().min(1).max(30).default(2) }).parse(req.body);
    return tx(req, async (q) => {
      const lim = await q.one(`select p.max_tables, (select count(*)::int from dining_tables where active) as n from restaurants r join plans p on p.id = r.plan_id where r.id = $1`, [R(req)]);
      if (lim && lim.n >= lim.max_tables) throw new HttpError(402, 'plan_limit', `Your plan allows ${lim.max_tables} tables`);
      const t = await q.one(`insert into dining_tables (restaurant_id, label, seats, token) values ($1,$2,$3,$4) returning id, label, seats, token, active`, [R(req), b.label, b.seats, token(16)]);
      await audit(q, R(req), actorOf(req.auth!), 'table.create', 'table', t.id, { label: b.label });
      return { ...t, url: `${cfg.publicUrl}/t/${t.token}` };
    }); });
  app.patch('/api/r/tables/:id', pre('tables:write'), async (req) => { mustBeTenant(req);
    const b = z.object({ label: z.string().trim().min(1).max(20).optional(), seats: z.number().int().min(1).max(30).optional(), active: z.boolean().optional() }).parse(req.body);
    return tx(req, async (q) => {
      const t = await q.one(`update dining_tables set label = coalesce($2,label), seats = coalesce($3,seats), active = coalesce($4,active) where id = $1 returning id,label,seats,active`, [(req.params as any).id, b.label ?? null, b.seats ?? null, b.active ?? null]);
      if (!t) throw new HttpError(404, 'not_found');
      await audit(q, R(req), actorOf(req.auth!), 'table.update', 'table', t.id, b); return t;
    }); });
  app.post('/api/r/tables/:id/rotate-token', pre('tables:write'), async (req) => { mustBeTenant(req);
    return tx(req, async (q) => {
      const t = await q.one(`update dining_tables set token = $2 where id = $1 returning id, token`, [(req.params as any).id, token(16)]);
      if (!t) throw new HttpError(404, 'not_found');
      await audit(q, R(req), actorOf(req.auth!), 'table.rotate_qr', 'table', t.id); return { ...t, url: `${cfg.publicUrl}/t/${t.token}` };
    }); });
  app.get('/api/r/tables/:id/qr.svg', pre('orders:read'), async (req, reply) => { mustBeTenant(req);
    const t = await tx(req, (q) => q.one(`select token from dining_tables where id = $1`, [(req.params as any).id]));
    if (!t) throw new HttpError(404, 'not_found');
    const svg = await QRCode.toString(`${cfg.publicUrl}/t/${t.token}`, { type: 'svg', margin: 2, errorCorrectionLevel: 'Q' });
    return reply.header('Content-Type', 'image/svg+xml').header('Cache-Control', 'private, max-age=60').send(svg);
  });

  /* ───────── menu ───────── */
  app.get('/api/r/menu', pre('orders:read'), async (req) => { mustBeTenant(req);
    return tx(req, async (q) => {
      const cats = await q.query(`select id, name, sort, active from menu_categories order by sort`);
      const items = await q.query(`select id, category_id, name, description, price_cents, image_url, available, tags, prep_minutes, sort from menu_items order by sort, created_at`);
      const groups = await q.query(`select id, item_id, name, min_select, max_select from option_groups order by sort`);
      const opts = await q.query(`select id, group_id, name, price_delta_cents, available from options order by sort`);
      return cats.map((c: any) => ({ ...c, items: items.filter((i: any) => i.category_id === c.id).map((i: any) => ({
        id: i.id, name: i.name, description: i.description, priceCents: i.price_cents, imageUrl: i.image_url, available: i.available, tags: i.tags, prepMinutes: i.prep_minutes,
        optionGroups: groups.filter((g: any) => g.item_id === i.id).map((g: any) => ({ id: g.id, name: g.name, min: g.min_select, max: g.max_select,
          options: opts.filter((o: any) => o.group_id === g.id).map((o: any) => ({ id: o.id, name: o.name, priceDeltaCents: o.price_delta_cents, available: o.available })) })) })) }));
    }); });
  app.post('/api/r/categories', pre('menu:write'), async (req) => { mustBeTenant(req);
    const b = z.object({ name: L }).parse(req.body);
    return tx(req, async (q) => { const c = await q.one(`insert into menu_categories (restaurant_id, name, sort) values ($1,$2,(select coalesce(max(sort),0)+1 from menu_categories)) returning *`, [R(req), JSON.stringify(b.name)]);
      await audit(q, R(req), actorOf(req.auth!), 'menu.category.create', 'category', c.id); return c; }); });
  app.patch('/api/r/categories/:id', pre('menu:write'), async (req) => { mustBeTenant(req);
    const b = z.object({ name: L.optional(), active: z.boolean().optional(), sort: z.number().int().optional() }).parse(req.body);
    return tx(req, async (q) => { const c = await q.one(`update menu_categories set name = coalesce($2,name), active = coalesce($3,active), sort = coalesce($4,sort) where id = $1 returning *`,
      [(req.params as any).id, b.name ? JSON.stringify(b.name) : null, b.active ?? null, b.sort ?? null]); if (!c) throw new HttpError(404, 'not_found'); return c; }); });
  app.delete('/api/r/categories/:id', pre('menu:write'), async (req) => { mustBeTenant(req);
    return tx(req, async (q) => {
      const used = await q.one(`select 1 from order_items oi join menu_items i on i.id = oi.item_id where i.category_id = $1 limit 1`, [(req.params as any).id]);
      if (used) throw new HttpError(409, 'in_use', 'Category has ordered items; hide it instead');
      await q.query(`delete from menu_categories where id = $1`, [(req.params as any).id]);
      await audit(q, R(req), actorOf(req.auth!), 'menu.category.delete', 'category', (req.params as any).id); return { ok: true }; }); });

  const ItemBody = z.object({
    categoryId: z.string().uuid(), name: L, description: LOpt.optional(), priceCents: z.number().int().min(0).max(10_000_000),
    imageUrl: z.string().max(300).regex(/^(\/api\/uploads\/[\w.-]+|\/food\/[\w.-]+|https:\/\/[^\s]+)$/).nullable().optional(),
    available: z.boolean().optional(), tags: z.array(z.string().max(20)).max(8).optional(), prepMinutes: z.number().int().min(1).max(120).optional(),
    optionGroups: z.array(z.object({ name: L, min: z.number().int().min(0).max(10), max: z.number().int().min(1).max(10),
      options: z.array(z.object({ name: L, priceDeltaCents: z.number().int().min(-1_000_000).max(1_000_000), available: z.boolean().default(true) })).min(1).max(20) })).max(6).optional(),
  });
  async function saveOptions(q: Q, rid: string, itemId: string, groups: NonNullable<z.infer<typeof ItemBody>['optionGroups']>) {
    await q.query(`delete from option_groups where item_id = $1`, [itemId]);
    let gi = 0;
    for (const g of groups) {
      const gr = await q.one(`insert into option_groups (restaurant_id, item_id, name, min_select, max_select, sort) values ($1,$2,$3,$4,$5,$6) returning id`, [rid, itemId, JSON.stringify(g.name), g.min, Math.max(g.max, g.min), gi++]);
      let oi = 0;
      for (const o of g.options) await q.query(`insert into options (restaurant_id, group_id, name, price_delta_cents, available, sort) values ($1,$2,$3,$4,$5,$6)`, [rid, gr.id, JSON.stringify(o.name), o.priceDeltaCents, o.available, oi++]);
    }
  }
  app.post('/api/r/items', pre('menu:write'), async (req) => { mustBeTenant(req);
    const b = ItemBody.parse(req.body);
    return tx(req, async (q) => {
      const i = await q.one(`insert into menu_items (restaurant_id, category_id, name, description, price_cents, image_url, available, tags, prep_minutes, sort)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,(select coalesce(max(sort),0)+1 from menu_items where category_id = $2)) returning id`,
        [R(req), b.categoryId, JSON.stringify(b.name), JSON.stringify(b.description ?? {}), b.priceCents, b.imageUrl ?? null, b.available ?? true, b.tags ?? [], b.prepMinutes ?? 10]);
      if (b.optionGroups) await saveOptions(q, R(req), i.id, b.optionGroups);
      await audit(q, R(req), actorOf(req.auth!), 'menu.item.create', 'item', i.id, { name: b.name.en, price: b.priceCents }); return i; }); });
  app.put('/api/r/items/:id', pre('menu:write'), async (req) => { mustBeTenant(req);
    const b = ItemBody.parse(req.body); const id = (req.params as any).id;
    return tx(req, async (q) => {
      const i = await q.one(`update menu_items set category_id=$2, name=$3, description=$4, price_cents=$5, image_url=$6, available=coalesce($7,available), tags=coalesce($8,tags), prep_minutes=coalesce($9,prep_minutes) where id=$1 returning id`,
        [id, b.categoryId, JSON.stringify(b.name), JSON.stringify(b.description ?? {}), b.priceCents, b.imageUrl ?? null, b.available ?? null, b.tags ?? null, b.prepMinutes ?? null]);
      if (!i) throw new HttpError(404, 'not_found');
      if (b.optionGroups) await saveOptions(q, R(req), id, b.optionGroups);
      await audit(q, R(req), actorOf(req.auth!), 'menu.item.update', 'item', id, { name: b.name.en, price: b.priceCents }); return { ok: true }; }); });
  app.patch('/api/r/items/:id/availability', pre('menu:write'), async (req) => { mustBeTenant(req);
    const b = z.object({ available: z.boolean() }).parse(req.body);
    return tx(req, async (q) => { const i = await q.one(`update menu_items set available = $2 where id = $1 returning id`, [(req.params as any).id, b.available]);
      if (!i) throw new HttpError(404, 'not_found'); await audit(q, R(req), actorOf(req.auth!), 'menu.item.availability', 'item', i.id, b); return { ok: true }; }); });
  app.delete('/api/r/items/:id', pre('menu:write'), async (req) => { mustBeTenant(req);
    return tx(req, async (q) => {
      const used = await q.one(`select 1 from order_items where item_id = $1 limit 1`, [(req.params as any).id]);
      if (used) { await q.query(`update menu_items set available = false where id = $1`, [(req.params as any).id]); return { ok: true, archived: true }; }
      await q.query(`delete from menu_items where id = $1`, [(req.params as any).id]);
      await audit(q, R(req), actorOf(req.auth!), 'menu.item.delete', 'item', (req.params as any).id); return { ok: true }; }); });

  // Image upload: size-limited, magic-byte checked, random filenames (never the client's name).
  app.post('/api/r/uploads', pre('menu:write'), async (req) => { mustBeTenant(req);
    const f = await req.file();
    if (!f) throw new HttpError(400, 'no_file');
    const head = await f.toBuffer();
    const kind = head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpg' : head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
      : head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
    if (!kind) throw new HttpError(415, 'bad_image', 'Only JPEG, PNG or WebP images are accepted');
    const name = `${randomBytes(12).toString('hex')}.${kind}`;
    await pipeline(async function* () { yield head; }, createWriteStream(join(resolve(cfg.uploadDir), name)));
    return { url: `/api/uploads/${name}` };
  });
  app.get('/api/uploads/:file', async (req, reply) => {
    const file = String((req.params as any).file);
    if (!/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(file)) throw new HttpError(404, 'not_found');
    const p = join(resolve(cfg.uploadDir), file);
    if (!existsSync(p)) throw new HttpError(404, 'not_found');
    const type = file.endsWith('png') ? 'image/png' : file.endsWith('webp') ? 'image/webp' : 'image/jpeg';
    return reply.header('Content-Type', type).header('Cache-Control', 'public, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff').send(createReadStream(p));
  });

  /* ───────── settings, branding, payment methods ───────── */
  const BRAND = z.object({
    logoUrl: z.string().max(300).regex(/^(\/api\/uploads\/[\w.-]+|https:\/\/[^\s]+)$/).nullable().optional(),
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    font: z.enum(['modern', 'classic', 'rounded']).optional(), theme: z.enum(['light', 'dark', 'auto']).optional(), tagline: z.string().max(80).optional(),
  });
  const settingsDto = (r: any) => ({ name: r.name, slug: r.slug, phone: r.phone, address: r.address, city: r.city, email: r.email, defaultLang: r.default_lang,
    serviceChargeBps: r.service_charge_bps, taxBps: r.tax_bps, taxLabel: r.tax_label, taxRegNo: r.tax_reg_no, branding: r.branding, status: r.status, plan: r.plan_id });
  app.get('/api/r/settings', pre('orders:read'), async (req) => { mustBeTenant(req);
    return settingsDto(await tx(req, (q) => q.one(`select * from restaurants where id = $1`, [R(req)]))); });
  app.patch('/api/r/settings', pre('settings:write'), async (req) => { mustBeTenant(req);
    const b = z.object({ name: z.string().trim().min(2).max(80), phone: z.string().max(30).nullable(), address: z.string().max(200).nullable(), city: z.string().max(60),
      defaultLang: z.enum(['en', 'si', 'ta']), serviceChargeBps: z.number().int().min(0).max(3000), taxBps: z.number().int().min(0).max(3000),
      taxLabel: z.string().max(20), taxRegNo: z.string().max(40).nullable(), branding: BRAND }).partial().parse(req.body);
    return tx(req, async (q) => {
      const cur = await q.one(`select branding from restaurants where id = $1`, [R(req)]);
      const r = await q.one(`update restaurants set name=coalesce($2,name), phone=coalesce($3,phone), address=coalesce($4,address), city=coalesce($5,city), default_lang=coalesce($6,default_lang),
        service_charge_bps=coalesce($7,service_charge_bps), tax_bps=coalesce($8,tax_bps), tax_label=coalesce($9,tax_label), tax_reg_no=coalesce($10,tax_reg_no), branding=$11 where id=$1 returning *`,
        [R(req), b.name ?? null, b.phone ?? null, b.address ?? null, b.city ?? null, b.defaultLang ?? null, b.serviceChargeBps ?? null, b.taxBps ?? null, b.taxLabel ?? null, b.taxRegNo ?? null,
         JSON.stringify({ ...cur.branding, ...(b.branding ?? {}) })]);
      await audit(q, R(req), actorOf(req.auth!), 'settings.update', 'restaurant', R(req), { ...b, branding: b.branding ? 'changed' : undefined });
      return settingsDto(r); }); });

  app.get('/api/r/payment-config', pre('payments:read'), async (req) => { mustBeTenant(req);
    const rows = await tx(req, (q) => q.query(`select method, provider, enabled, mode, settlement_model, fee_bps, live_approved_at, (secret_enc is not null) as has_credentials from restaurant_payment_configs`));
    const methods = await svc.methodsFor(R(req));
    return rows.map((r: any) => ({ method: r.method, provider: r.provider, providerLabel: svc.provider(r.provider)?.label ?? r.provider, enabled: r.enabled, mode: r.mode,
      settlementModel: r.settlement_model, feeBps: r.fee_bps, hasCredentials: r.has_credentials, liveApproved: !!r.live_approved_at,
      available: methods.find((m) => m.method === r.method)?.available ?? false, reason: methods.find((m) => m.method === r.method)?.reason }));
  });
  app.patch('/api/r/payment-config/:method', pre('settings:write'), async (req) => { mustBeTenant(req);
    const method = z.enum(['lankaqr', 'card']).parse((req.params as any).method); const b = z.object({ enabled: z.boolean() }).parse(req.body);
    return tx(req, async (q) => {
      const r = await q.one(`update restaurant_payment_configs set enabled = $3, updated_at = now() where restaurant_id = $1 and method = $2 returning method, enabled`, [R(req), method, b.enabled]);
      if (!r) throw new HttpError(404, 'not_configured', 'Ask TableFlow support to set up this payment method');
      await audit(q, R(req), actorOf(req.auth!), 'payment_config.toggle', 'payment_config', method, b); return r; }); });

  /* ───────── payments, ledger, refunds, reconciliation ───────── */
  app.get('/api/r/payments', pre('payments:read'), async (req) => { mustBeTenant(req);
    const b = z.object({ from: Date10.optional(), to: Date10.optional(), status: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const rows = await tx(req, (q) => q.query(
      `select p.*, o.number as order_number, t.label as table_label from payments p join orders o on o.id = p.order_id join dining_tables t on t.id = o.table_id
        where ($1::timestamptz is null or p.created_at >= $1) and ($2::timestamptz is null or p.created_at < $2) and ($3::text is null or p.status = $3)
        order by p.created_at desc limit $4`, [b.from ? dayStart(b.from) : null, b.to ? dayAfter(b.to) : null, b.status ?? null, b.limit]));
    return rows.map((p: any) => ({ id: p.id, orderNumber: p.order_number, table: p.table_label, method: p.method, provider: p.provider, mode: p.mode, status: p.status,
      amountCents: p.amount_cents, feeCents: p.gateway_fee_cents, refundedCents: p.refunded_cents, ref: p.provider_ref, settlement: p.settlement_status, needsRefund: p.needs_refund,
      createdAt: p.created_at, paidAt: p.paid_at, failure: p.failure_message }));
  });
  app.get('/api/r/payments/:id/refunds', pre('payments:read'), async (req) => { mustBeTenant(req);
    return tx(req, (q) => q.query(`select id, amount_cents, reason, status, error, auto, provider_ref, created_at from refunds where payment_id = $1 order by created_at`, [(req.params as any).id])); });

  app.post('/api/r/payments/:id/refund', pre('refunds:create'), async (req) => { mustBeTenant(req);
    const key = String(req.headers['idempotency-key'] ?? '');
    if (key.length < 8) throw new HttpError(400, 'idempotency_key_required', 'Idempotency-Key header required');
    const b = z.object({ amountCents: z.number().int().positive().optional(), reason: z.string().trim().min(3).max(200), manual: z.boolean().optional() }).parse(req.body);
    const r = await svc.refund({ restaurantId: R(req), paymentId: (req.params as any).id, amountCents: b.amountCents, reason: b.reason, idempotencyKey: key, actor: actorOf(req.auth!), manual: b.manual });
    return r;
  });

  app.get('/api/r/ledger', pre('payments:read'), async (req, reply) => { mustBeTenant(req);
    const b = z.object({ from: Date10.optional(), to: Date10.optional(), format: z.enum(['json', 'csv']).default('json') }).parse(req.query);
    const rows = await tx(req, (q) => q.query(
      `select l.*, o.number as order_number from ledger_entries l left join orders o on o.id = l.order_id
        where ($1::timestamptz is null or l.created_at >= $1) and ($2::timestamptz is null or l.created_at < $2) order by l.id desc limit 5000`, [b.from ? dayStart(b.from) : null, b.to ? dayAfter(b.to) : null]));
    if (b.format === 'csv') return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="tableflow-ledger.csv"')
      .send(csv([['entry', 'time', 'order', 'kind', 'amount_lkr', 'currency', 'provider_ref'], ...rows.map((r: any) => [r.id, r.created_at, r.order_number, r.kind, (r.amount_cents / 100).toFixed(2), r.currency, r.ref])]));
    return rows.map((r: any) => ({ id: r.id, createdAt: r.created_at, orderNumber: r.order_number, kind: r.kind, amountCents: r.amount_cents, ref: r.ref, meta: r.meta }));
  });

  app.post('/api/r/reconcile', pre('refunds:create'), async (req) => { mustBeTenant(req);
    const b = z.object({ provider: z.string(), from: Date10, to: Date10 }).parse(req.body);
    return reconcile(svc, { restaurantId: R(req), provider: b.provider, from: b.from, to: b.to, actor: actorOf(req.auth!) });
  });
  app.get('/api/r/reconciliations', pre('payments:read'), async (req) => { mustBeTenant(req);
    return tx(req, (q) => q.query(`select * from reconciliation_runs order by created_at desc limit 30`)); });

  /* ───────── reports ───────── */
  app.get('/api/r/reports/sales', pre('reports:read'), async (req) => { mustBeTenant(req);
    const b = z.object({ from: Date10.optional(), to: Date10.optional() }).parse(req.query);
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const to = b.to ?? today, from = b.from ?? new Date(dayStart(to).getTime() - 13 * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);
    return tx(req, async (q) => {
      const p = [dayStart(from), dayAfter(to)];
      const daily = await q.query(`select (paid_at at time zone 'Asia/Colombo')::date::text as day, count(*)::int as orders, sum(total_cents)::int as gross, sum(refunded_cents)::int as refunds
        from orders where paid_at >= $1 and paid_at < $2 and payment_status <> 'unpaid' group by 1 order by 1`, p);
      const byMethod = await q.query(`select method, count(*)::int as payments, coalesce(sum(amount_cents),0)::int as gross, coalesce(sum(gateway_fee_cents),0)::int as fees, coalesce(sum(refunded_cents),0)::int as refunds
        from payments where status = 'paid' and paid_at >= $1 and paid_at < $2 group by method`, p);
      const top = await q.query(`select i.name->>'en' as name, sum(oi.qty)::int as qty, sum(oi.line_total_cents)::int as revenue
        from order_items oi join orders o on o.id = oi.order_id join menu_items i on i.id = oi.item_id
        where o.paid_at >= $1 and o.paid_at < $2 group by 1 order by 2 desc limit 8`, p);
      const t = await q.one(`select count(*)::int as orders, coalesce(sum(total_cents),0)::int as gross, coalesce(sum(refunded_cents),0)::int as refunds,
        coalesce(avg(total_cents),0)::int as avg, coalesce(avg(extract(epoch from (ready_at - paid_at)) / 60) filter (where ready_at is not null),0)::numeric(10,1)::float as avg_prep_min
        from orders where paid_at >= $1 and paid_at < $2 and payment_status <> 'unpaid'`, p);
      const failed = await q.one(`select count(*)::int as n from payments where status in ('failed','expired','cancelled') and created_at >= $1 and created_at < $2`, p);
      const pendingRefund = await q.one(`select count(*)::int as n from payments where needs_refund`);
      const fb = await q.one(`select coalesce(avg(rating),0)::numeric(3,2)::float as avg, count(*)::int as n from feedback where created_at >= $1 and created_at < $2`, p);
      return { from, to, totals: { ...t, net: t.gross - t.refunds, failedPayments: failed.n, paymentsNeedingRefund: pendingRefund.n, avgRating: fb.avg, ratings: fb.n },
        daily, byMethod, topItems: top };
    }); });

  app.get('/api/r/feedback', pre('feedback:read'), async (req) => { mustBeTenant(req);
    return tx(req, (q) => q.query(`select f.id, f.rating, f.comment, f.created_at, o.number from feedback f join orders o on o.id = f.order_id order by f.created_at desc limit 100`)); });

  /* ───────── staff ───────── */
  app.get('/api/r/staff', pre('staff:manage'), async (req) => { mustBeTenant(req);
    return tx(req, (q) => q.query(`select id, name, email, role, active, last_login_at from users where restaurant_id = $1 order by created_at`, [R(req)])); });
  app.post('/api/r/staff', pre('staff:manage'), async (req) => { mustBeTenant(req);
    const b = z.object({ name: z.string().trim().min(2).max(80), email: z.string().email(), role: z.enum(['manager', 'kitchen', 'cashier']), password: z.string().min(10).max(200) }).parse(req.body);
    return tx(req, async (q) => {
      const u = await q.one(`insert into users (restaurant_id, email, name, role, password_hash) values ($1,$2,$3,$4,$5) returning id, name, email, role, active`, [R(req), b.email, b.name, b.role, await hashPassword(b.password)]);
      await audit(q, R(req), actorOf(req.auth!), 'staff.create', 'user', u.id, { role: b.role }); return u; }); });
  app.patch('/api/r/staff/:id', pre('staff:manage'), async (req) => { mustBeTenant(req);
    const id = (req.params as any).id;
    const b = z.object({ role: z.enum(['manager', 'kitchen', 'cashier']).optional(), active: z.boolean().optional(), password: z.string().min(10).max(200).optional() }).parse(req.body);
    if (id === req.auth!.userId) throw new HttpError(409, 'self_edit', 'You cannot change your own role or access');
    return tx(req, async (q) => {
      const t = await q.one(`select role from users where id = $1 and restaurant_id = $2`, [id, R(req)]);
      if (!t) throw new HttpError(404, 'not_found'); if (t.role === 'owner') throw new HttpError(403, 'forbidden', 'The owner account cannot be changed here');
      const u = await q.one(`update users set role = coalesce($2,role), active = coalesce($3,active), password_hash = coalesce($4,password_hash), failed_attempts = 0, locked_until = null where id = $1 returning id,name,email,role,active`,
        [id, b.role ?? null, b.active ?? null, b.password ? await hashPassword(b.password) : null]);
      await audit(q, R(req), actorOf(req.auth!), 'staff.update', 'user', id, { role: b.role, active: b.active, passwordReset: !!b.password }); return u; }); });

  /* ───────── support & audit ───────── */
  app.get('/api/r/tickets', pre('support:write'), async (req) => { mustBeTenant(req);
    return tx(req, async (q) => { const t = await q.query(`select * from support_tickets order by updated_at desc limit 50`);
      const m = await q.query(`select ticket_id, author_name, author_role, body, created_at from ticket_messages order by created_at`);
      return t.map((x: any) => ({ ...x, messages: m.filter((y: any) => y.ticket_id === x.id) })); }); });
  app.post('/api/r/tickets', pre('support:write'), async (req) => { mustBeTenant(req);
    const b = z.object({ subject: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(2000), priority: z.enum(['low', 'normal', 'high']).default('normal') }).parse(req.body);
    return tx(req, async (q) => { const t = await q.one(`insert into support_tickets (restaurant_id, created_by, subject, priority) values ($1,$2,$3,$4) returning *`, [R(req), req.auth!.userId, b.subject, b.priority]);
      await q.query(`insert into ticket_messages (restaurant_id, ticket_id, author_id, author_name, author_role, body) values ($1,$2,$3,$4,$5,$6)`, [R(req), t.id, req.auth!.userId, req.auth!.name, req.auth!.role, b.body]); return t; }); });
  app.post('/api/r/tickets/:id/messages', pre('support:write'), async (req) => { mustBeTenant(req);
    const b = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
    return tx(req, async (q) => { const t = await q.one(`update support_tickets set updated_at = now(), status = case when status = 'resolved' then 'open' else status end where id = $1 returning id`, [(req.params as any).id]);
      if (!t) throw new HttpError(404, 'not_found');
      await q.query(`insert into ticket_messages (restaurant_id, ticket_id, author_id, author_name, author_role, body) values ($1,$2,$3,$4,$5,$6)`, [R(req), t.id, req.auth!.userId, req.auth!.name, req.auth!.role, b.body]); return { ok: true }; }); });
  app.get('/api/r/audit', pre('reports:read'), async (req) => { mustBeTenant(req);
    return tx(req, (q) => q.query(`select a.id, a.action, a.entity, a.entity_id, a.meta, a.created_at, a.actor_role, u.name as actor from audit_log a left join users u on u.id = a.actor_id order by a.id desc limit 100`)); });
}
