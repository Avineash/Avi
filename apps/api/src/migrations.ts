/**
 * Schema migrations. Real PostgreSQL (>= 13). Money is stored as integer minor units (LKR cents).
 *
 * Tenant isolation is enforced twice:
 *   1. Application code always scopes by restaurant_id (see db.ts Scope).
 *   2. PostgreSQL row-level security: every tenant table has a policy keyed on the
 *      `app.tenant_id` / `app.scope` settings that db.ts sets with SET LOCAL per transaction,
 *      and the app drops to the unprivileged `tf_app` role for the duration of the transaction.
 */
export interface Migration { name: string; sql: string }

const TENANT_TABLES = [
  'users', 'dining_tables', 'menu_categories', 'menu_items', 'option_groups', 'options',
  'orders', 'order_items', 'payments', 'refunds', 'ledger_entries', 'restaurant_payment_configs',
  'reconciliation_runs', 'feedback', 'support_tickets', 'ticket_messages', 'outbox', 'audit_log',
];

const rls = TENANT_TABLES.map((t) => `
alter table ${t} enable row level security;
alter table ${t} force row level security;
create policy tenant_isolation on ${t}
  using (current_setting('app.scope', true) = 'system'
         or restaurant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (current_setting('app.scope', true) = 'system'
         or restaurant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);`).join('\n');

export const migrations: Migration[] = [
  {
    name: '001_init',
    sql: `
create table plans (
  id text primary key,
  name text not null,
  monthly_fee_cents integer not null default 0,
  txn_fee_bps integer not null default 0,        -- platform fee on paid volume, basis points
  max_tables integer not null default 20,
  active boolean not null default true
);

create table restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'pending' check (status in ('pending','active','suspended','rejected')),
  plan_id text references plans(id),
  email text, phone text, address text, city text default 'Colombo',
  currency char(3) not null default 'LKR',
  default_lang text not null default 'en' check (default_lang in ('en','si','ta')),
  service_charge_bps integer not null default 1000 check (service_charge_bps between 0 and 3000),
  tax_bps integer not null default 0 check (tax_bps between 0 and 3000),
  tax_label text not null default 'VAT',
  tax_reg_no text,
  branding jsonb not null default '{}'::jsonb,
  order_seq integer not null default 0,
  suspended_reason text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid
);

create table users (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,   -- null => platform staff
  email text not null,
  name text not null,
  role text not null check (role in ('owner','manager','kitchen','cashier','platform_admin','platform_support')),
  password_hash text not null,
  active boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));

create table dining_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  label text not null,
  seats integer not null default 2,
  token text not null unique,            -- unguessable; this is what the QR code encodes
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, label)
);

create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name jsonb not null,                   -- {"en":"","si":"","ta":""}
  sort integer not null default 0,
  active boolean not null default true
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  category_id uuid not null references menu_categories(id) on delete cascade,
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  price_cents integer not null check (price_cents >= 0),
  image_url text,
  available boolean not null default true,
  tags text[] not null default '{}',
  prep_minutes integer not null default 10,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index menu_items_cat on menu_items (restaurant_id, category_id, sort);

create table option_groups (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  item_id uuid not null references menu_items(id) on delete cascade,
  name jsonb not null,
  min_select integer not null default 0,
  max_select integer not null default 1,
  sort integer not null default 0
);

create table options (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  group_id uuid not null references option_groups(id) on delete cascade,
  name jsonb not null,
  price_delta_cents integer not null default 0,
  available boolean not null default true,
  sort integer not null default 0
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_id uuid not null references dining_tables(id),
  number integer not null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','received','preparing','ready','served','cancelled','expired')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','paid','partially_refunded','refunded')),
  subtotal_cents integer not null,
  service_charge_cents integer not null,
  tax_cents integer not null,
  total_cents integer not null,
  refunded_cents integer not null default 0,
  currency char(3) not null default 'LKR',
  customer_name text, customer_phone text, customer_email text,
  lang text not null default 'en',
  notes text,
  tracking_token text not null,          -- capability token the customer's phone holds
  idempotency_key text,
  mode text not null default 'sandbox' check (mode in ('sandbox','live')),
  paid_payment_id uuid,
  created_at timestamptz not null default now(),
  paid_at timestamptz, preparing_at timestamptz, ready_at timestamptz, served_at timestamptz,
  unique (restaurant_id, number),
  unique (restaurant_id, idempotency_key)
);
create index orders_live on orders (restaurant_id, status, created_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  item_id uuid,
  name jsonb not null,                   -- snapshot at order time
  unit_price_cents integer not null,
  qty integer not null check (qty between 1 and 50),
  options jsonb not null default '[]'::jsonb,
  note text,
  line_total_cents integer not null
);
create index order_items_order on order_items (order_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  method text not null check (method in ('lankaqr','card')),
  provider text not null,
  mode text not null default 'sandbox' check (mode in ('sandbox','live')),
  status text not null default 'created' check (status in
    ('created','pending','requires_action','paid','paid_duplicate','failed','cancelled','expired')),
  amount_cents integer not null,
  currency char(3) not null default 'LKR',
  provider_ref text,
  provider_data jsonb not null default '{}'::jsonb,     -- QR payload / redirect URL. Never card data.
  idempotency_key text,
  expires_at timestamptz not null,
  paid_at timestamptz,
  failure_code text, failure_message text,
  gateway_fee_cents integer not null default 0,
  refunded_cents integer not null default 0,
  settlement_status text not null default 'unsettled' check (settlement_status in ('unsettled','settled','na')),
  settled_at timestamptz, settlement_ref text,
  duplicate_of uuid references payments(id),
  needs_refund boolean not null default false,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref),
  unique (restaurant_id, order_id, idempotency_key)
);
-- The database itself guarantees at most ONE primary paid payment per order.
create unique index payments_one_paid_per_order on payments (order_id) where status = 'paid';
create index payments_open on payments (status, expires_at) where status in ('created','pending','requires_action');
create index payments_rest_time on payments (restaurant_id, created_at desc);

alter table orders add constraint orders_paid_payment_fk foreign key (paid_payment_id) references payments(id);

create table payment_events (            -- inbound webhook log + dedupe (provider-level, not tenant data)
  id bigserial primary key,
  provider text not null,
  event_id text not null,
  payment_id uuid,
  event_type text,
  payload jsonb,
  signature_ok boolean not null,
  result text,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  payment_id uuid not null references payments(id),
  order_id uuid not null references orders(id),
  amount_cents integer not null check (amount_cents > 0),
  reason text,
  status text not null check (status in ('pending','succeeded','failed','unsupported')),
  provider_ref text,
  error text,
  auto boolean not null default false,
  requested_by uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (payment_id, idempotency_key)
);

-- Append-only payment ledger. Signed amounts from the restaurant's point of view.
create table ledger_entries (
  id bigserial primary key,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  payment_id uuid references payments(id),
  order_id uuid references orders(id),
  kind text not null check (kind in
    ('charge','gateway_fee','refund','refund_fee_reversal','platform_fee_accrued','platform_fee_deducted',
     'duplicate_charge','settlement','adjustment')),
  amount_cents integer not null,
  currency char(3) not null default 'LKR',
  ref text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ledger_rest_time on ledger_entries (restaurant_id, created_at desc);
create function ledger_immutable() returns trigger language plpgsql as $$
begin raise exception 'ledger_entries is append-only'; end $$;
create trigger ledger_no_update before update or delete on ledger_entries
  for each row execute function ledger_immutable();

create table restaurant_payment_configs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  method text not null check (method in ('lankaqr','card')),
  provider text not null,
  enabled boolean not null default false,
  mode text not null default 'sandbox' check (mode in ('sandbox','live')),
  settlement_model text not null default 'direct' check (settlement_model in ('direct','marketplace')),
  config jsonb not null default '{}'::jsonb,     -- non-secret (merchant id, MCC, city…)
  secret_enc text,                               -- AES-256-GCM encrypted credentials
  fee_bps integer not null default 0,            -- provider fee used for ledger estimates
  live_approved_at timestamptz,
  live_approved_by uuid,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, method)
);

create table reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  provider text not null,
  period_from date not null, period_to date not null,
  status text not null check (status in ('clean','discrepancies')),
  summary jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  order_id uuid not null unique references orders(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  created_by uuid,
  subject text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_id uuid, author_name text, author_role text,
  body text not null,
  created_at timestamptz not null default now()
);

create table outbox (                      -- receipts / notifications (simulated delivery in the prototype)
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  channel text not null, to_addr text, template text not null,
  status text not null default 'simulated',
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  restaurant_id uuid,
  actor_id uuid, actor_role text,
  action text not null, entity text, entity_id text,
  meta jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_rest_time on audit_log (restaurant_id, created_at desc);

create table platform_settings (key text primary key, value jsonb not null);

-- Provider-side simulation (stands in for the bank / gateway). NOT tenant data.
create table sandbox_txns (
  ref text primary key,
  provider text not null,
  restaurant_id uuid,
  merchant_ref text,
  amount_cents integer not null,
  status text not null default 'pending',
  fee_cents integer not null default 0,
  refunded_cents integer not null default 0,
  card_last4 text,
  qr_payload text,
  expires_at timestamptz,
  paid_at timestamptz,
  settled_at timestamptz,
  settlement_ref text,
  created_at timestamptz not null default now()
);

${rls}
alter table restaurants enable row level security;
alter table restaurants force row level security;
create policy tenant_isolation on restaurants
  using (current_setting('app.scope', true) = 'system' or id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (current_setting('app.scope', true) = 'system' or id = nullif(current_setting('app.tenant_id', true), '')::uuid);

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'tf_app') then create role tf_app nologin; end if;
end $$;
grant usage on schema public to tf_app;
grant select, insert, update, delete on all tables in schema public to tf_app;
grant usage, select on all sequences in schema public to tf_app;
revoke update, delete on audit_log from tf_app;     -- audit trail is insert/select only
revoke update, delete on ledger_entries from tf_app;
`,
  },
];
