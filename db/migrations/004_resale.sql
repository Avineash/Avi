-- Buyer / seller marketplace (peer-to-peer resale of bookings, reservations and tickets).
-- Resale is only possible for venues belonging to a partner REGISTERED and APPROVED on the platform;
-- partners themselves have no portal in this phase — they exist as a registry.
-- Money is held in escrow: buyer pays the platform; the seller is credited only after delivery is confirmed.

-- ── Registry: each registered venue states its resale terms ──
alter table venues add column resale_allowed boolean not null default true;
alter table venues add column transfer_instructions text;
alter table venues add column max_markup_bps int not null default 10000 check (max_markup_bps between 5000 and 20000);  -- 10000 = may not exceed face value

-- ── Extend shared enums used by orders / fees ──
alter table orders drop constraint if exists orders_source_check;
alter table orders add constraint orders_source_check check (source in ('direct','waitlist','buyback','resale'));

alter table fee_rules drop constraint if exists fee_rules_payer_check;
alter table fee_rules add constraint fee_rules_payer_check check (payer in ('partner','customer','seller'));
alter table fee_rules drop constraint if exists fee_rules_applies_to_check;
alter table fee_rules add constraint fee_rules_applies_to_check check (applies_to in ('booking','buyback','resale','peer_resale'));

alter table platform_fees drop constraint if exists platform_fees_kind_check;
alter table platform_fees add constraint platform_fees_kind_check
  check (kind in ('customer_fee','commission','buyback_fee','resale_fee','payment_cost_recovery','buyer_fee','seller_fee'));
alter table platform_fees add column resale_order_id uuid;

-- ── Sellers ──
create table seller_profiles (
  user_id           uuid primary key references users(id) on delete cascade,
  display_name      text not null check (length(display_name) between 2 and 40),
  bio               text check (length(bio) <= 400),
  phone             text not null,
  payout_method     text not null default 'sandbox' check (payout_method in ('sandbox','stripe','bank')),
  stripe_account_id text,
  payout_hint       text,                              -- masked, e.g. "BSB •••• 456"
  status            text not null default 'active' check (status in ('active','suspended')),
  strikes           int not null default 0 check (strikes >= 0),
  terms_accepted_at timestamptz not null,
  created_at        timestamptz not null default now()
);

create table resale_listings (
  id                    uuid primary key default gen_random_uuid(),
  seller_id             uuid not null references users(id),
  venue_id              uuid not null references venues(id),
  category              text not null check (category in ('hotel','restaurant','event')),
  title                 text not null check (length(title) between 3 and 120),
  item_detail           text,
  description           text check (length(description) <= 2000),
  image_url             text,
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  quantity_total        int not null check (quantity_total between 1 and 20),
  quantity_available    int not null check (quantity_available >= 0),         -- DB-level oversell guard
  original_unit_cents   int not null check (original_unit_cents > 0),         -- face value the seller paid, per unit
  ask_unit_cents        int not null check (ask_unit_cents > 0),
  transfer_method       text not null check (transfer_method in ('name_change','ticket_transfer','voucher_code','reservation_name')),
  transfer_notes        text,
  booking_reference     text not null,
  booking_reference_norm text not null,
  proof_file_name       text,
  proof_mime            text,
  proof_content         bytea,
  declarations          jsonb not null default '{}'::jsonb,
  status                text not null default 'active' check (status in ('active','paused','sold_out','cancelled','expired','removed')),
  is_demo               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (quantity_available <= quantity_total),
  check (ends_at > starts_at)
);
-- The same booking can't be listed twice while a listing is live.
create unique index resale_one_live_per_booking on resale_listings(venue_id, booking_reference_norm) where status in ('active','paused','sold_out');
create index resale_search_idx on resale_listings(category, status, starts_at);
create index resale_seller_idx on resale_listings(seller_id, status);

create table resale_saved (
  user_id uuid not null references users(id) on delete cascade,
  listing_id uuid not null references resale_listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- ── Orders in escrow ──
create table resale_orders (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,
  order_id          uuid not null unique references orders(id),
  listing_id        uuid not null references resale_listings(id),
  buyer_id          uuid not null references users(id),
  seller_id         uuid not null references users(id),
  quantity          int not null check (quantity >= 1),
  unit_price_cents  int not null check (unit_price_cents > 0),
  subtotal_cents    int not null,
  buyer_fee_cents   int not null check (buyer_fee_cents >= 0),
  seller_fee_cents  int not null check (seller_fee_cents >= 0),
  total_cents       int not null check (total_cents = subtotal_cents + buyer_fee_cents),
  status            text not null default 'pending_payment' check (status in
                    ('pending_payment','paid','delivered','completed','disputed','refunding','refunded','cancelled','expired')),
  deliver_by        timestamptz,
  delivered_at      timestamptz,
  delivery_notes    text,
  delivery_file_name text,
  delivery_mime     text,
  delivery_content  bytea,
  auto_release_at   timestamptz,
  completed_at      timestamptz,
  cancelled_by      uuid references users(id),
  cancel_reason     text,
  strike_applied    boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (buyer_id <> seller_id)
);
create index resale_orders_buyer_idx on resale_orders(buyer_id, created_at desc);
create index resale_orders_seller_idx on resale_orders(seller_id, created_at desc);
create index resale_orders_due_idx on resale_orders(status, deliver_by, auto_release_at);

create table resale_disputes (
  id              uuid primary key default gen_random_uuid(),
  resale_order_id uuid not null references resale_orders(id),
  opened_by       uuid not null references users(id),
  reason          text not null,
  details         text,
  status          text not null default 'open' check (status in ('open','resolved_refund','resolved_release')),
  resolution      text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create unique index resale_one_open_dispute on resale_disputes(resale_order_id) where status = 'open';

-- Seller-side ledger. Entries stay in escrow (released = false) until the order completes.
create table seller_payouts (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references users(id),
  net_cents       bigint not null check (net_cents > 0),
  status          text not null default 'pending' check (status in ('pending','paid','failed')),
  provider_ref    text,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);
create table seller_ledger (
  id              bigserial primary key,
  seller_id       uuid not null references users(id),
  resale_order_id uuid references resale_orders(id),
  kind            text not null check (kind in ('sale','fee','refund','fee_reversal','adjustment')),
  amount_cents    bigint not null,
  released        boolean not null default false,
  released_at     timestamptz,
  payout_id       uuid references seller_payouts(id),
  note            text,
  created_at      timestamptz not null default now()
);
create index seller_ledger_seller_idx on seller_ledger(seller_id, released);

create table resale_reviews (
  id              uuid primary key default gen_random_uuid(),
  resale_order_id uuid not null unique references resale_orders(id),
  seller_id       uuid not null references users(id),
  buyer_id        uuid not null references users(id),
  rating          smallint not null check (rating between 1 and 5),
  comment         text check (length(comment) <= 1000),
  created_at      timestamptz not null default now()
);
create index resale_reviews_seller_idx on resale_reviews(seller_id);

-- Buyers can ask to be told when something matching appears (the secondary-market "waitlist").
create table buyer_alerts (
  id              uuid primary key default gen_random_uuid(),
  buyer_id        uuid not null references users(id) on delete cascade,
  category        text check (category in ('hotel','restaurant','event')),
  venue_id        uuid references venues(id),
  date_from       date,
  date_to         date,
  max_unit_cents  int check (max_unit_cents > 0),
  quantity        int not null default 1 check (quantity between 1 and 20),
  note            text,
  status          text not null default 'active' check (status in ('active','matched','cancelled')),
  created_at      timestamptz not null default now()
);
create index buyer_alerts_active_idx on buyer_alerts(status, category);

-- ── Defaults (data, editable) ──
insert into fee_rules(payer, applies_to, scope, category, kind, rate_bps, fixed_cents, min_cents, max_cents, note) values
 ('customer','peer_resale','global',null,'percentage',500,0,200,3000,'Buyer service fee on peer resale'),
 ('seller','peer_resale','global',null,'percentage',800,0,0,null,'Seller fee on peer resale, deducted from the sale price');

insert into system_settings(key, value) values
 ('features.peer_resale', '{"enabled": false, "legal_review_ref": null}'),
 ('resale.rules', '{"hold_minutes": 10, "delivery_hours": 24, "cutoff_hours_before_start": 2, "release_after_start_hours": 24, "min_release_after_delivery_hours": 12, "max_open_listings": 20, "max_strikes": 3, "dispute_hours_after_start": 24}')
on conflict (key) do nothing;
