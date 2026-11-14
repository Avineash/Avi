import { z } from 'zod';
import type { AppCtx } from '../app.js';
import { HttpError, actorOf } from '../auth.js';
import { SYSTEM, type Q } from '../db.js';
import { audit } from '../audit.js';
import { encryptSecret, hashPassword } from '../crypto.js';
import { csv } from './restaurant.js';
import { slugify } from './auth.js';
import { dayStart, dayAfter } from '../payments/reconcile.js';

const Date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function adminRoutes({ app, db, cfg, svc, guard }: AppCtx) {
  const sys = <T>(fn: (q: Q) => Promise<T>) => db.tx(SYSTEM, fn);
  const read = { preHandler: guard('platform:read') };
  const write = { preHandler: guard('platform:write') };
  const tickets = { preHandler: guard('platform:tickets') };
  // platform:* permissions exist only on platform roles, which have no restaurant_id.

  /* ───────── overview & revenue ───────── */
  app.get('/api/admin/overview', read, async () => sys(async (q) => {
    const counts = await q.query(`select status, count(*)::int as n from restaurants group by status`);
    const vol = async (interval: string) => q.one(`select count(*)::int as txns, coalesce(sum(amount_cents),0)::int as gmv from payments where status = 'paid' and paid_at > now() - $1::interval`, [interval]);
    const failures = await q.one(`select count(*) filter (where status in ('failed','expired'))::int as failed, count(*)::int as total from payments where created_at > now() - interval '7 days'`);
    const rev = await q.one(`select coalesce(-sum(amount_cents) filter (where kind in ('platform_fee_accrued','platform_fee_deducted') and created_at > now() - interval '30 days'),0)::int as txn_fees from ledger_entries`);
    const subs = await q.one(`select coalesce(sum(p.monthly_fee_cents),0)::int as mrr from restaurants r join plans p on p.id = r.plan_id where r.status = 'active'`);
    const byMethod = await q.query(`select method, count(*)::int as txns, sum(amount_cents)::int as gmv from payments where status = 'paid' and paid_at > now() - interval '30 days' group by method`);
    const daily = await q.query(`select (paid_at at time zone 'Asia/Colombo')::date::text as day, count(*)::int as txns, sum(amount_cents)::int as gmv from payments
      where status = 'paid' and paid_at > now() - interval '14 days' group by 1 order by 1`);
    const open = await q.one(`select (select count(*)::int from support_tickets where status <> 'resolved') as tickets, (select count(*)::int from payments where needs_refund) as needs_refund`);
    return { restaurants: Object.fromEntries(counts.map((c: any) => [c.status, c.n])), volume: { day: await vol('1 day'), week: await vol('7 days'), month: await vol('30 days') },
      failureRate7d: failures.total ? failures.failed / failures.total : 0, failed7d: failures.failed,
      revenue: { subscriptionsMonthlyCents: subs.mrr, transactionFees30dCents: rev.txn_fees, total30dCents: subs.mrr + rev.txn_fees },
      byMethod, daily, open, sandbox: cfg.allowSandbox };
  }));

  /* ───────── restaurants ───────── */
  app.get('/api/admin/restaurants', read, async () => sys((q) => q.query(
    `select r.id, r.slug, r.name, r.status, r.city, r.email, r.phone, r.plan_id, r.created_at, r.approved_at, r.suspended_reason,
            (select count(*)::int from orders o where o.restaurant_id = r.id and o.paid_at > now() - interval '30 days') as orders30,
            (select coalesce(sum(amount_cents),0)::int from payments p where p.restaurant_id = r.id and p.status = 'paid' and p.paid_at > now() - interval '30 days') as gmv30,
            (select count(*)::int from payments p where p.restaurant_id = r.id and p.status in ('failed','expired') and p.created_at > now() - interval '30 days') as failed30,
            (select count(*)::int from dining_tables t where t.restaurant_id = r.id and t.active) as tables
       from restaurants r order by (r.status = 'pending') desc, r.created_at desc`)));

  const DEFAULT_CONFIGS = (sandbox: boolean) => sandbox ? [
    { method: 'lankaqr', provider: 'sandbox_lankaqr', fee: 60 }, { method: 'card', provider: 'sandbox_card', fee: 250 }] : [];
  async function provision(q: Q, id: string, planId: string) {
    await q.query(`update restaurants set plan_id = $2 where id = $1`, [id, planId]);
    for (const c of DEFAULT_CONFIGS(cfg.allowSandbox))
      await q.query(`insert into restaurant_payment_configs (restaurant_id, method, provider, enabled, mode, fee_bps, config)
        values ($1,$2,$3,true,'sandbox',$4,$5) on conflict (restaurant_id, method) do nothing`, [id, c.method, c.provider, c.fee, JSON.stringify({ merchantId: `SBX-${id.slice(0, 8).toUpperCase()}` })]);
  }

  app.post('/api/admin/restaurants', write, async (req) => {  // assisted onboarding by TableFlow staff
    const b = z.object({ name: z.string().trim().min(2).max(80), city: z.string().default('Colombo'), ownerName: z.string().min(2).max(80), email: z.string().email(),
      password: z.string().min(10).max(200), planId: z.string().default('starter') }).parse(req.body);
    return sys(async (q) => {
      if (await q.one(`select 1 from users where lower(email) = lower($1)`, [b.email])) throw new HttpError(409, 'email_taken');
      let slug = slugify(b.name) || 'restaurant'; if (await q.one(`select 1 from restaurants where slug = $1`, [slug])) slug += '-' + Math.random().toString(36).slice(2, 5);
      const r = await q.one(`insert into restaurants (slug, name, email, city, status, approved_at, approved_by) values ($1,$2,$3,$4,'active',now(),$5) returning id, slug`, [slug, b.name, b.email, b.city, req.auth!.userId]);
      await q.query(`insert into users (restaurant_id, email, name, role, password_hash) values ($1,$2,$3,'owner',$4)`, [r.id, b.email, b.ownerName, await hashPassword(b.password)]);
      await provision(q, r.id, b.planId);
      await audit(q, r.id, actorOf(req.auth!), 'restaurant.created_by_admin', 'restaurant', r.id); return r; }); });

  const transition = (path: string, to: string, extra = false) => app.post(`/api/admin/restaurants/:id/${path}`, write, async (req) => {
    const id = (req.params as any).id;
    const b = z.object({ planId: z.string().optional(), reason: extra ? z.string().trim().min(3).max(200) : z.string().optional() }).parse(req.body ?? {});
    return sys(async (q) => {
      const r = await q.one(`select status, plan_id from restaurants where id = $1 for update`, [id]);
      if (!r) throw new HttpError(404, 'not_found');
      if (path === 'approve' && r.status !== 'pending') throw new HttpError(409, 'bad_state', 'Only pending restaurants can be approved');
      if (path === 'reinstate' && r.status !== 'suspended') throw new HttpError(409, 'bad_state');
      await q.query(`update restaurants set status = $2, suspended_reason = $3, approved_at = case when $2 = 'active' and approved_at is null then now() else approved_at end,
                      approved_by = case when $4 then $5::uuid else approved_by end where id = $1`, [id, to, path === 'suspend' ? b.reason : null, path === 'approve', req.auth!.userId]);
      if (path === 'approve') await provision(q, id, b.planId ?? r.plan_id ?? 'starter');
      await audit(q, id, actorOf(req.auth!), `restaurant.${path}`, 'restaurant', id, { reason: b.reason }); return { ok: true, status: to }; }); });
  transition('approve', 'active'); transition('reject', 'rejected', true); transition('suspend', 'suspended', true); transition('reinstate', 'active');

  app.patch('/api/admin/restaurants/:id/plan', write, async (req) => {
    const b = z.object({ planId: z.string() }).parse(req.body);
    return sys(async (q) => { if (!(await q.one(`select 1 from plans where id = $1 and active`, [b.planId]))) throw new HttpError(404, 'plan_not_found');
      await q.query(`update restaurants set plan_id = $2 where id = $1`, [(req.params as any).id, b.planId]);
      await audit(q, (req.params as any).id, actorOf(req.auth!), 'restaurant.plan', 'restaurant', (req.params as any).id, b); return { ok: true }; }); });

  /* ───────── payment-provider configuration ───────── */
  app.get('/api/admin/providers', read, async () => svc.providers.map((p) => ({ key: p.key, method: p.method, label: p.label, sandbox: p.sandbox, capabilities: p.capabilities })));
  app.get('/api/admin/restaurants/:id/payment-configs', read, async (req) => sys(async (q) =>
    (await q.query(`select method, provider, enabled, mode, settlement_model, fee_bps, config, (secret_enc is not null) as has_credentials, live_approved_at from restaurant_payment_configs where restaurant_id = $1`, [(req.params as any).id]))
      .map((c: any) => ({ method: c.method, provider: c.provider, enabled: c.enabled, mode: c.mode, settlementModel: c.settlement_model, feeBps: c.fee_bps, config: c.config, hasCredentials: c.has_credentials, liveApprovedAt: c.live_approved_at }))));

  app.put('/api/admin/restaurants/:id/payment-configs/:method', write, async (req) => {
    const id = (req.params as any).id; const method = z.enum(['lankaqr', 'card']).parse((req.params as any).method);
    const b = z.object({ provider: z.string(), enabled: z.boolean(), settlementModel: z.enum(['direct', 'marketplace']).default('direct'), feeBps: z.number().int().min(0).max(1000).default(0),
      config: z.record(z.string(), z.any()).default({}), secrets: z.record(z.string(), z.string().max(500)).optional() }).parse(req.body);
    const p = svc.provider(b.provider);
    if (!p || p.method !== method) throw new HttpError(422, 'bad_provider', 'Provider does not exist or does not support this method');
    if (b.settlementModel === 'marketplace' && !p.capabilities.marketplaceSplit)
      throw new HttpError(422, 'marketplace_unsupported', 'This provider has no verified split-settlement arrangement. Use direct merchant settlement.');
    return sys(async (q) => {
      const cur = await q.one(`select mode from restaurant_payment_configs where restaurant_id = $1 and method = $2`, [id, method]);
      const secret = b.secrets && Object.keys(b.secrets).length ? encryptSecret(JSON.stringify(b.secrets), cfg.secretsKey) : null;
      // Changing provider or credentials always drops back to sandbox: live must be re-approved explicitly.
      const switched = !cur || b.provider !== (await q.one(`select provider from restaurant_payment_configs where restaurant_id = $1 and method = $2`, [id, method]))?.provider || !!secret;
      await q.query(`insert into restaurant_payment_configs (restaurant_id, method, provider, enabled, mode, settlement_model, fee_bps, config, secret_enc)
          values ($1,$2,$3,$4,'sandbox',$5,$6,$7,$8)
          on conflict (restaurant_id, method) do update set provider = $3, enabled = $4, settlement_model = $5, fee_bps = $6, config = $7,
            secret_enc = coalesce($8, restaurant_payment_configs.secret_enc), updated_at = now(),
            mode = case when $9 then 'sandbox' else restaurant_payment_configs.mode end,
            live_approved_at = case when $9 then null else restaurant_payment_configs.live_approved_at end`,
        [id, method, b.provider, b.enabled, b.settlementModel, b.feeBps, JSON.stringify(b.config), secret, switched]);
      await audit(q, id, actorOf(req.auth!), 'payment_config.update', 'payment_config', method, { provider: b.provider, enabled: b.enabled, settlementModel: b.settlementModel, credentialsChanged: !!secret });
      return { ok: true }; }); });

  /** The ONLY path to real money. Requires a real (non-sandbox) provider, credentials, and a completed merchant onboarding checklist. */
  app.post('/api/admin/restaurants/:id/payment-configs/:method/go-live', write, async (req) => {
    const id = (req.params as any).id; const method = z.enum(['lankaqr', 'card']).parse((req.params as any).method);
    const b = z.object({ checklist: z.object({ merchantAgreementSigned: z.literal(true), providerSandboxTestsPassed: z.literal(true), settlementAccountVerified: z.literal(true), webhookVerifiedInProviderSandbox: z.literal(true) }) }).parse(req.body);
    return sys(async (q) => {
      const c = await q.one(`select * from restaurant_payment_configs where restaurant_id = $1 and method = $2`, [id, method]);
      if (!c) throw new HttpError(404, 'not_found');
      const p = svc.provider(c.provider);
      if (!p || p.sandbox) throw new HttpError(409, 'sandbox_provider', 'Sandbox providers can never be switched to live');
      if (!c.secret_enc || !c.config?.merchantId) throw new HttpError(409, 'credentials_missing', 'Merchant ID and credentials must be configured first');
      await q.query(`update restaurant_payment_configs set mode = 'live', live_approved_at = now(), live_approved_by = $3 where restaurant_id = $1 and method = $2`, [id, method, req.auth!.userId]);
      await audit(q, id, actorOf(req.auth!), 'payment_config.go_live', 'payment_config', method, { checklist: b.checklist }); return { ok: true }; }); });

  /* ───────── plans ───────── */
  app.get('/api/admin/plans', read, async () => sys((q) => q.query(`select p.*, (select count(*)::int from restaurants r where r.plan_id = p.id) as restaurants from plans p order by monthly_fee_cents`)));
  app.put('/api/admin/plans/:id', write, async (req) => {
    const b = z.object({ name: z.string().min(2).max(40), monthlyFeeCents: z.number().int().min(0), txnFeeBps: z.number().int().min(0).max(1000), maxTables: z.number().int().min(1).max(1000), active: z.boolean().default(true) }).parse(req.body);
    return sys(async (q) => { const id = String((req.params as any).id).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
      await q.query(`insert into plans (id,name,monthly_fee_cents,txn_fee_bps,max_tables,active) values ($1,$2,$3,$4,$5,$6)
        on conflict (id) do update set name=$2, monthly_fee_cents=$3, txn_fee_bps=$4, max_tables=$5, active=$6`, [id, b.name, b.monthlyFeeCents, b.txnFeeBps, b.maxTables, b.active]);
      await audit(q, null, actorOf(req.auth!), 'plan.upsert', 'plan', id, b); return { ok: true, id }; }); });

  /* ───────── transactions & failures ───────── */
  const txnQuery = `select p.id, p.created_at, p.paid_at, p.status, p.method, p.provider, p.mode, p.amount_cents, p.gateway_fee_cents, p.refunded_cents, p.provider_ref, p.failure_code,
      p.failure_message, p.needs_refund, p.settlement_status, r.name as restaurant, r.id as restaurant_id, o.number as order_number
    from payments p join restaurants r on r.id = p.restaurant_id join orders o on o.id = p.order_id`;
  app.get('/api/admin/transactions', read, async (req) => {
    const b = z.object({ status: z.string().optional(), method: z.string().optional(), restaurant: z.string().uuid().optional(), failed: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return sys((q) => q.query(`${txnQuery} where ($1::text is null or p.status = $1) and ($2::text is null or p.method = $2) and ($3::uuid is null or p.restaurant_id = $3)
      and (not coalesce($4,false) or p.status in ('failed','expired','cancelled') or p.needs_refund) order by p.created_at desc limit $5`, [b.status ?? null, b.method ?? null, b.restaurant ?? null, b.failed ?? null, b.limit])); });
  app.get('/api/admin/webhook-events', read, async () => sys((q) => q.query(`select id, provider, event_id, event_type, signature_ok, result, received_at from payment_events order by id desc limit 100`)));

  /* ───────── support ───────── */
  app.get('/api/admin/tickets', tickets, async () => sys(async (q) => {
    const t = await q.query(`select t.*, r.name as restaurant from support_tickets t join restaurants r on r.id = t.restaurant_id order by (t.status = 'resolved'), t.updated_at desc limit 100`);
    const m = await q.query(`select ticket_id, author_name, author_role, body, created_at from ticket_messages order by created_at`);
    return t.map((x: any) => ({ ...x, messages: m.filter((y: any) => y.ticket_id === x.id) })); }));
  app.post('/api/admin/tickets/:id/messages', tickets, async (req) => {
    const b = z.object({ body: z.string().trim().min(1).max(2000), status: z.enum(['open', 'in_progress', 'resolved']).optional() }).parse(req.body);
    return sys(async (q) => { const t = await q.one(`update support_tickets set status = coalesce($2,'in_progress'), updated_at = now() where id = $1 returning id, restaurant_id`, [(req.params as any).id, b.status ?? null]);
      if (!t) throw new HttpError(404, 'not_found');
      await q.query(`insert into ticket_messages (restaurant_id, ticket_id, author_id, author_name, author_role, body) values ($1,$2,$3,$4,'platform',$5)`, [t.restaurant_id, t.id, req.auth!.userId, req.auth!.name, b.body]);
      await audit(q, t.restaurant_id, actorOf(req.auth!), 'ticket.reply', 'ticket', t.id); return { ok: true }; }); });

  /* ───────── exports ───────── */
  app.get('/api/admin/export/:kind', read, async (req, reply) => {
    const kind = z.enum(['transactions', 'revenue', 'restaurants', 'failed']).parse((req.params as any).kind);
    const b = z.object({ from: Date10.optional(), to: Date10.optional() }).parse(req.query);
    const p = [b.from ? dayStart(b.from) : null, b.to ? dayAfter(b.to) : null];
    const out = await sys(async (q) => {
      if (kind === 'revenue') {
        const rows = await q.query(`select r.name, r.plan_id, pl.monthly_fee_cents, coalesce(-sum(l.amount_cents) filter (where l.kind in ('platform_fee_accrued','platform_fee_deducted')),0)::int as txn_fees,
            coalesce(sum(l.amount_cents) filter (where l.kind = 'charge'),0)::int as gmv from restaurants r left join plans pl on pl.id = r.plan_id
            left join ledger_entries l on l.restaurant_id = r.id and ($1::timestamptz is null or l.created_at >= $1) and ($2::timestamptz is null or l.created_at < $2)
            group by r.id, pl.monthly_fee_cents order by gmv desc`, p);
        return [['restaurant', 'plan', 'monthly_fee_lkr', 'gmv_lkr', 'transaction_fees_lkr', 'direct_settlement_note'],
          ...rows.map((r: any) => [r.name, r.plan_id, ((r.monthly_fee_cents ?? 0) / 100).toFixed(2), (r.gmv / 100).toFixed(2), (r.txn_fees / 100).toFixed(2), 'invoice restaurant separately'])];
      }
      if (kind === 'restaurants') return [['name', 'slug', 'status', 'plan', 'city', 'created'], ...(await q.query(`select * from restaurants order by created_at`)).map((r: any) => [r.name, r.slug, r.status, r.plan_id, r.city, r.created_at])];
      const rows = await q.query(`${txnQuery} where ($1::timestamptz is null or p.created_at >= $1) and ($2::timestamptz is null or p.created_at < $2)
        ${kind === 'failed' ? `and (p.status in ('failed','expired','cancelled') or p.needs_refund)` : ''} order by p.created_at desc limit 20000`, p);
      return [['time', 'restaurant', 'order', 'method', 'provider', 'mode', 'status', 'amount_lkr', 'gateway_fee_lkr', 'refunded_lkr', 'provider_ref', 'settlement', 'failure'],
        ...rows.map((r: any) => [r.created_at, r.restaurant, r.order_number, r.method, r.provider, r.mode, r.status, (r.amount_cents / 100).toFixed(2), (r.gateway_fee_cents / 100).toFixed(2), (r.refunded_cents / 100).toFixed(2), r.provider_ref, r.settlement_status, r.failure_message])];
    });
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="tableflow-${kind}.csv"`).send(csv(out));
  });

  /* ───────── sandbox controls & audit ───────── */
  app.post('/api/admin/sandbox/outage', write, async (req) => {
    if (!cfg.allowSandbox) throw new HttpError(404, 'not_found');
    const b = z.object({ provider: z.enum(['sandbox_lankaqr', 'sandbox_card']), on: z.boolean() }).parse(req.body);
    await sys((q) => q.query(`insert into platform_settings (key, value) values ($1,$2) on conflict (key) do update set value = $2`, [`sandbox.outage.${b.provider}`, JSON.stringify({ on: b.on })]));
    return { ok: true }; });
  app.get('/api/admin/sandbox/outage', read, async () => sys(async (q) => Object.fromEntries((await q.query(`select key, value from platform_settings where key like 'sandbox.outage.%'`)).map((r: any) => [r.key.replace('sandbox.outage.', ''), !!r.value.on]))));
  app.post('/api/admin/sandbox/settle', write, async () => {
    if (!cfg.allowSandbox) throw new HttpError(404, 'not_found');
    return sys(async (q) => { const ref = 'STL-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const r = await q.query(`update sandbox_txns set settled_at = now(), settlement_ref = $1 where status = 'paid' and settled_at is null returning ref`, [ref]); return { settlementRef: ref, settled: r.length }; }); });
  app.get('/api/admin/audit', read, async () => sys((q) => q.query(`select a.id, a.restaurant_id, a.action, a.entity, a.meta, a.created_at, a.actor_role, u.name as actor, r.name as restaurant from audit_log a
    left join users u on u.id = a.actor_id left join restaurants r on r.id = a.restaurant_id order by a.id desc limit 200`)));
}
