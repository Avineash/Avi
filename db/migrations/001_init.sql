-- Eleventh Hour — core schema (PostgreSQL 15+, also runs on Supabase and PGlite).
-- Money is ALWAYS integer cents (AUD). Timestamps are timestamptz (UTC).
-- Business invariants are enforced in the database (not only in app code):
--   * one active reservation per inventory unit (partial unique index)
--   * one pending waitlist offer per unit, one open buyback per reservation
--   * refunds can never exceed captured amounts
--   * audit_logs are append-only (trigger)

-- ───────────────────────── Identity ─────────────────────────
create table users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  password_hash    text,
  name             text not null,
  phone            text,
  role             text not null default 'customer' check (role in ('customer','partner','admin')),
  status           text not null default 'active' check (status in ('active','suspended','deleted')),
  auth_provider    text not null default 'password' check (auth_provider in ('password','google','apple')),
  email_verified_at timestamptz,
  marketing_opt_in boolean not null default false,
  notify_email     boolean not null default true,
  notify_sms       boolean not null default false,
  notify_push      boolean not null default true,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table partners (
  id                 uuid primary key default gen_random_uuid(),
  owner_user_id      uuid not null references users(id),
  business_name      text not null,
  abn                text not null check (abn ~ '^[0-9]{11}$'),
  category           text not null check (category in ('hotel','restaurant','event')),
  status             text not null default 'pending' check (status in ('pending','approved','suspended','rejected')),
  gst_registered     boolean not null default true,
  contact_email      text,
  contact_phone      text,
  website            text,
  description        text,
  stripe_account_id  text,
  payouts_enabled    boolean not null default false,
  -- buyback rules, configurable per partner (used only if platform feature flag + legal gate are on)
  buyback_enabled              boolean not null default false,
  buyback_min_comp_bps         int not null default 1000 check (buyback_min_comp_bps between 0 and 10000),
  buyback_max_comp_bps         int not null default 5000 check (buyback_max_comp_bps between 0 and 10000),
  buyback_approval_threshold_cents int not null default 20000 check (buyback_approval_threshold_cents >= 0),
  buyback_min_notice_hours     int not null default 6 check (buyback_min_notice_hours >= 0),
  offer_window_minutes         int not null default 30 check (offer_window_minutes between 5 and 1440),
  waitlist_policy              text not null default 'first_come' check (waitlist_policy in ('first_come','highest_offer')),
  is_demo            boolean not null default false,
  approved_at        timestamptz,
  approved_by        uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (buyback_min_comp_bps <= buyback_max_comp_bps)
);
create index partners_owner_idx on partners(owner_user_id);
create index partners_status_idx on partners(status, category);

create table partner_verifications (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references partners(id) on delete cascade,
  doc_type     text not null check (doc_type in ('abn_certificate','business_licence','liquor_licence','insurance','id_document','other')),
  file_name    text not null,
  mime_type    text not null,
  size_bytes   int not null check (size_bytes between 1 and 5242880),
  content      bytea,
  status       text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  reviewer_id  uuid references users(id),
  reviewed_at  timestamptz,
  notes        text,
  created_at   timestamptz not null default now()
);
create index partner_verifications_partner_idx on partner_verifications(partner_id);

-- ───────────────────────── Catalogue ─────────────────────────
create table venues (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references partners(id) on delete cascade,
  name        text not null,
  category    text not null check (category in ('hotel','restaurant','event')),
  address     text not null,
  suburb      text not null,
  city        text not null default 'Melbourne',
  state       text not null default 'VIC',
  country     text not null default 'AU',
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  description text,
  image_url   text,
  star_rating smallint check (star_rating between 1 and 5),
  cuisine     text,
  amenities   text[] not null default '{}',
  status      text not null default 'active' check (status in ('active','hidden')),
  created_at  timestamptz not null default now()
);
create index venues_partner_idx on venues(partner_id);
create index venues_city_idx on venues(city, category);

-- A listing is one sellable offering at one point in time (a room category for a check-in date,
-- a dining slot, an event session). Its sellable stock is its inventory_units.
create table listings (
  id                   uuid primary key default gen_random_uuid(),
  venue_id             uuid not null references venues(id) on delete cascade,
  partner_id           uuid not null references partners(id) on delete cascade,
  category             text not null check (category in ('hotel','restaurant','event')),
  title                text not null,
  subcategory          text,
  description          text,
  image_url            text,
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  booking_deadline     timestamptz not null,
  original_price_cents int not null check (original_price_cents > 0),   -- rack rate / face value
  min_price_cents      int not null check (min_price_cents > 0),
  max_price_cents      int not null,
  current_price_cents  int not null,
  pricing_mode         text not null default 'manual' check (pricing_mode in ('manual','auto')),
  cancellation_policy  text not null default 'flexible' check (cancellation_policy in ('flexible','moderate','strict','non_refundable')),
  buyback_eligible     boolean not null default false,
  max_per_booking      int not null default 4 check (max_per_booking between 1 and 10),
  meta                 jsonb not null default '{}'::jsonb,
  status               text not null default 'draft' check (status in ('draft','published','paused','closed')),
  featured             boolean not null default false,
  is_demo              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (ends_at > starts_at),
  check (booking_deadline <= ends_at),
  check (min_price_cents <= max_price_cents),
  check (current_price_cents between min_price_cents and max_price_cents)
);
create index listings_search_idx on listings(category, status, starts_at);
create index listings_partner_idx on listings(partner_id, status);

create table inventory_units (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid not null references listings(id) on delete cascade,
  partner_id       uuid not null references partners(id),
  label            text not null,
  status           text not null default 'available' check (status in
                   ('available','held','booked','waitlisted','buyback_requested','buyback_pending','released','cancelled','completed')),
  allocation_type  text not null default 'partner_allocated' check (allocation_type in ('partner_allocated','consigned','platform_allocated')),
  price_override_cents int check (price_override_cents > 0),
  held_by          uuid references users(id),
  reserved_until   timestamptz,
  restrictions     jsonb not null default '{}'::jsonb,
  version          int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (listing_id, label),
  check (status <> 'held' or (reserved_until is not null and held_by is not null))
);
create index inventory_listing_status_idx on inventory_units(listing_id, status);
create index inventory_expiring_holds_idx on inventory_units(reserved_until) where status = 'held';

-- Transaction history for every status change.
create table inventory_events (
  id             bigserial primary key,
  unit_id        uuid not null references inventory_units(id) on delete cascade,
  from_status    text,
  to_status      text not null,
  actor_user_id  uuid,
  reason         text,
  ref_type       text,
  ref_id         uuid,
  created_at     timestamptz not null default now()
);
create index inventory_events_unit_idx on inventory_events(unit_id, id);

create view listing_availability as
select l.id as listing_id,
       count(u.*)::int                                              as total_units,
       count(*) filter (where u.status = 'available')::int          as available_units,
       count(*) filter (where u.status = 'held')::int               as held_units,
       count(*) filter (where u.status in ('booked','buyback_requested','buyback_pending','completed'))::int as booked_units,
       count(*) filter (where u.status = 'waitlisted')::int         as offered_units
from listings l left join inventory_units u on u.listing_id = l.id
group by l.id;

create table pricing_rules (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('global','partner','listing')),
  partner_id  uuid references partners(id) on delete cascade,
  listing_id  uuid references listings(id) on delete cascade,
  rule_type   text not null check (rule_type in ('time_decay','scarcity','demand','velocity','day_of_week','seasonal')),
  params      jsonb not null,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  check ((scope = 'global' and partner_id is null and listing_id is null)
      or (scope = 'partner' and partner_id is not null and listing_id is null)
      or (scope = 'listing' and listing_id is not null))
);

create table special_events (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  city           text not null default 'Melbourne',
  starts_on      date not null,
  ends_on        date not null,
  multiplier_bps int not null check (multiplier_bps between 5000 and 20000),
  check (ends_on >= starts_on)
);

create table price_history (
  id          bigserial primary key,
  listing_id  uuid not null references listings(id) on delete cascade,
  price_cents int not null,
  source      text not null,   -- 'partner' | 'auto' | 'create'
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index price_history_listing_idx on price_history(listing_id, id);

-- ───────────────────────── Orders, payments, reservations ─────────────────────────
create table orders (
  id                 uuid primary key default gen_random_uuid(),
  reference          text not null unique,
  customer_id        uuid not null references users(id),
  status             text not null default 'pending_payment' check (status in ('pending_payment','paid','expired','cancelled','failed')),
  source             text not null default 'direct' check (source in ('direct','waitlist','buyback')),
  subtotal_cents     int not null check (subtotal_cents >= 0),
  customer_fee_cents int not null check (customer_fee_cents >= 0),
  total_cents        int not null check (total_cents = subtotal_cents + customer_fee_cents),
  currency           text not null default 'aud',
  idempotency_key    text not null unique,
  expires_at         timestamptz not null,
  paid_at            timestamptz,
  created_at         timestamptz not null default now()
);
create index orders_customer_idx on orders(customer_id, created_at desc);
create index orders_pending_idx on orders(expires_at) where status = 'pending_payment';

create table reservations (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,
  order_id            uuid not null references orders(id),
  customer_id         uuid not null references users(id),
  listing_id          uuid not null references listings(id),
  unit_id             uuid not null references inventory_units(id),
  partner_id          uuid not null references partners(id),
  status              text not null default 'pending_payment' check (status in ('pending_payment','confirmed','cancelled','completed','expired')),
  price_cents         int not null check (price_cents > 0),
  customer_fee_cents  int not null check (customer_fee_cents >= 0),
  total_cents         int not null,
  gst_cents           int not null default 0,
  guests              int not null default 1 check (guests between 1 and 50),
  guest_name          text,
  guest_email         text,
  guest_phone         text,
  special_requests    text,
  cancellation_policy text not null,
  buyback_consent     boolean not null default false,
  cancelled_at        timestamptz,
  cancel_reason       text,
  cancelled_by        uuid references users(id),
  created_at          timestamptz not null default now(),
  check (total_cents = price_cents + customer_fee_cents)
);
-- THE double-booking guard: a unit can have at most one live reservation.
create unique index reservations_one_live_per_unit on reservations(unit_id) where status in ('pending_payment','confirmed');
create index reservations_customer_idx on reservations(customer_id, created_at desc);
create index reservations_partner_idx on reservations(partner_id, status);
create index reservations_listing_idx on reservations(listing_id, status);

create table payments (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id),
  provider         text not null check (provider in ('sandbox','stripe')),
  provider_ref     text,
  status           text not null default 'requires_payment' check (status in
                   ('requires_payment','authorized','captured','failed','cancelled','partially_refunded','refunded')),
  amount_cents     int not null check (amount_cents > 0),
  captured_cents   int not null default 0,
  refunded_cents   int not null default 0,
  currency         text not null default 'aud',
  idempotency_key  text not null unique,
  client_secret    text,
  failure_reason   text,
  authorized_at    timestamptz,
  captured_at      timestamptz,
  created_at       timestamptz not null default now(),
  check (refunded_cents <= captured_cents),
  check (captured_cents <= amount_cents)
);
create index payments_order_idx on payments(order_id);
create unique index payments_provider_ref_key on payments(provider, provider_ref) where provider_ref is not null;

create table refunds (
  id               uuid primary key default gen_random_uuid(),
  payment_id       uuid not null references payments(id),
  reservation_id   uuid references reservations(id),
  amount_cents     int not null check (amount_cents > 0),
  kind             text not null check (kind in ('cancellation','partial','buyback','goodwill','chargeback','void')),
  reason           text,
  status           text not null default 'pending' check (status in ('pending','succeeded','failed')),
  provider_ref     text,
  idempotency_key  text not null unique,
  requested_by     uuid references users(id),
  approved_by      uuid references users(id),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index refunds_payment_idx on refunds(payment_id);
create index refunds_pending_idx on refunds(created_at) where status = 'pending';

create table refund_requests (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid not null references reservations(id),
  requested_by    uuid not null references users(id),
  amount_cents    int not null check (amount_cents > 0),
  reason          text not null,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by      uuid references users(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now()
);

-- ───────────────────────── Fees, ledger, payouts ─────────────────────────
-- No commission is hard-coded: every fee is resolved from this table (partner > category > global).
create table fee_rules (
  id          uuid primary key default gen_random_uuid(),
  payer       text not null check (payer in ('partner','customer')),
  applies_to  text not null check (applies_to in ('booking','buyback','resale')),
  scope       text not null check (scope in ('global','category','partner')),
  category    text check (category in ('hotel','restaurant','event')),
  partner_id  uuid references partners(id) on delete cascade,
  kind        text not null check (kind in ('percentage','fixed','percent_plus_fixed')),
  rate_bps    int not null default 0 check (rate_bps between 0 and 10000),
  fixed_cents int not null default 0 check (fixed_cents >= 0),
  min_cents   int not null default 0 check (min_cents >= 0),
  max_cents   int check (max_cents is null or max_cents >= min_cents),
  active      boolean not null default true,
  note        text,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  check ((scope = 'global' and category is null and partner_id is null)
      or (scope = 'category' and category is not null and partner_id is null)
      or (scope = 'partner' and partner_id is not null))
);
create unique index fee_rules_one_active on fee_rules(payer, applies_to, scope, coalesce(category,''), coalesce(partner_id::text,'')) where active;

-- Immutable fee records. Reversals are negative rows (is_reversal).
create table platform_fees (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('customer_fee','commission','buyback_fee','resale_fee','payment_cost_recovery')),
  order_id        uuid references orders(id),
  reservation_id  uuid references reservations(id),
  buyback_offer_id uuid,
  partner_id      uuid references partners(id),
  basis_cents     int not null default 0,
  rate_bps        int not null default 0,
  fixed_cents     int not null default 0,
  amount_cents    int not null,           -- GST-inclusive; negative for reversals
  gst_cents       int not null default 0, -- GST component of amount_cents
  is_reversal     boolean not null default false,
  rule_id         uuid references fee_rules(id),
  created_at      timestamptz not null default now()
);
create index platform_fees_partner_idx on platform_fees(partner_id, created_at);
create index platform_fees_reservation_idx on platform_fees(reservation_id);

create table partner_payouts (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references partners(id),
  gross_cents     bigint not null,
  fees_cents      bigint not null,
  adjustments_cents bigint not null default 0,
  net_cents       bigint not null check (net_cents > 0),
  entries_count   int not null,
  status          text not null default 'pending' check (status in ('pending','paid','failed')),
  provider_ref    text,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);

-- Partner-side money ledger. Amounts are signed from the partner's perspective.
create table ledger_entries (
  id               bigserial primary key,
  partner_id       uuid not null references partners(id),
  reservation_id   uuid references reservations(id),
  buyback_offer_id uuid,
  kind             text not null check (kind in ('sale','commission','refund','commission_reversal','compensation','payment_cost','chargeback','adjustment')),
  amount_cents     bigint not null,
  payout_id        uuid references partner_payouts(id),
  note             text,
  created_at       timestamptz not null default now()
);
create index ledger_partner_unpaid_idx on ledger_entries(partner_id) where payout_id is null;
create index ledger_reservation_idx on ledger_entries(reservation_id);

-- ───────────────────────── Waitlist & buyback ─────────────────────────
create table waitlist_entries (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references users(id),
  listing_id       uuid not null references listings(id) on delete cascade,
  quantity         int not null default 1 check (quantity = 1),   -- one unit per entry keeps allocation unambiguous
  max_price_cents  int check (max_price_cents > 0),
  preferences      jsonb not null default '{}'::jsonb,            -- preferred date/time windows, notes
  notify_email     boolean not null default true,
  notify_sms       boolean not null default false,
  notify_push      boolean not null default true,
  status           text not null default 'active' check (status in ('active','offered','fulfilled','cancelled','expired')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index waitlist_one_open_per_customer on waitlist_entries(customer_id, listing_id) where status in ('active','offered');
create index waitlist_listing_idx on waitlist_entries(listing_id, status, created_at);

create table buyback_offers (
  id                       uuid primary key default gen_random_uuid(),
  reservation_id           uuid not null references reservations(id),
  listing_id               uuid not null references listings(id),
  partner_id               uuid not null references partners(id),
  customer_id              uuid not null references users(id),            -- customer A (current holder)
  waitlist_entry_id        uuid not null references waitlist_entries(id),  -- customer B's entry
  initiated_by             uuid not null references users(id),
  status                   text not null default 'pending_customer' check (status in
                           ('pending_admin','pending_customer','processing','resale_pending','completed','completed_unsold',
                            'rejected','expired','cancelled','failed')),
  original_amount_cents    int not null,   -- what customer A paid in total (refunded in full on acceptance)
  compensation_cents       int not null check (compensation_cents >= 0),
  payment_cost_cents       int not null default 0,
  resale_price_cents       int not null check (resale_price_cents > 0),
  resale_customer_fee_cents int not null default 0,
  platform_fee_cents       int not null default 0,
  partner_net_cents        int not null,   -- partner net if buyback completes
  partner_keep_net_cents   int not null,   -- partner net if A's booking is kept
  net_benefit_cents        int not null,   -- partner_net - partner_keep_net
  calc                     jsonb not null default '{}'::jsonb,
  requires_admin_approval  boolean not null default false,
  admin_approved_by        uuid references users(id),
  admin_approved_at        timestamptz,
  note_to_customer         text,
  expires_at               timestamptz not null,
  responded_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index buyback_one_open_per_reservation on buyback_offers(reservation_id)
  where status in ('pending_admin','pending_customer','processing','resale_pending');
create index buyback_partner_idx on buyback_offers(partner_id, status);
create index buyback_customer_idx on buyback_offers(customer_id, status);

alter table platform_fees add constraint platform_fees_buyback_fk foreign key (buyback_offer_id) references buyback_offers(id);
alter table ledger_entries add constraint ledger_buyback_fk foreign key (buyback_offer_id) references buyback_offers(id);

create table buyback_consents (
  id               uuid primary key default gen_random_uuid(),
  reservation_id   uuid not null references reservations(id),
  customer_id      uuid not null references users(id),
  kind             text not null check (kind in ('checkout_opt_in','offer_acceptance','offer_rejection')),
  buyback_offer_id uuid references buyback_offers(id),
  terms_version    text not null,
  terms_snapshot   text not null,
  ip               text,
  created_at       timestamptz not null default now()
);
create index buyback_consents_res_idx on buyback_consents(reservation_id);

create table waitlist_offers (
  id               uuid primary key default gen_random_uuid(),
  entry_id         uuid not null references waitlist_entries(id),
  listing_id       uuid not null references listings(id),
  unit_id          uuid not null references inventory_units(id),
  customer_id      uuid not null references users(id),
  price_cents      int not null check (price_cents > 0),
  source           text not null check (source in ('release','buyback')),
  buyback_offer_id uuid references buyback_offers(id),
  status           text not null default 'pending' check (status in ('pending','accepted','declined','expired','cancelled')),
  expires_at       timestamptz not null,
  responded_at     timestamptz,
  created_at       timestamptz not null default now()
);
create unique index waitlist_offer_one_pending_per_unit on waitlist_offers(unit_id) where status = 'pending';
create index waitlist_offers_customer_idx on waitlist_offers(customer_id, status);
create index waitlist_offers_expiry_idx on waitlist_offers(expires_at) where status = 'pending';

alter table orders add column waitlist_offer_id uuid references waitlist_offers(id);

create table compensation_payments (
  id               uuid primary key default gen_random_uuid(),
  buyback_offer_id uuid not null references buyback_offers(id),
  customer_id      uuid not null references users(id),
  amount_cents     int not null check (amount_cents > 0),
  status           text not null default 'pending' check (status in ('pending','paid','failed')),
  provider_ref     text,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now(),
  paid_at          timestamptz
);

-- ───────────────────────── Engagement, trust, ops ─────────────────────────
create table favourites (
  user_id     uuid not null references users(id) on delete cascade,
  listing_id  uuid not null references listings(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create table reviews (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid not null unique references reservations(id),   -- one verified review per completed stay
  venue_id        uuid not null references venues(id),
  customer_id     uuid not null references users(id),
  rating          smallint not null check (rating between 1 and 5),
  comment         text,
  created_at      timestamptz not null default now()
);
create index reviews_venue_idx on reviews(venue_id);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text not null,
  link        text,
  read_at     timestamptz,
  email_status text,   -- null | 'sent' | 'skipped' | 'failed'
  sms_status   text,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, created_at desc);

create table disputes (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid not null references reservations(id),
  payment_id      uuid references payments(id),
  kind            text not null check (kind in ('dispute','chargeback','fraud')),
  status          text not null default 'open' check (status in ('open','investigating','won','lost','closed')),
  amount_cents    int not null check (amount_cents > 0),
  opened_by       uuid references users(id),
  notes           text,
  resolution      text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create table audit_logs (
  id          bigserial primary key,
  actor_id    uuid,
  actor_role  text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  meta        jsonb not null default '{}'::jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs(entity, entity_id);
create index audit_logs_created_idx on audit_logs(created_at desc);

create function audit_logs_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_logs is append-only'; end $$;
create trigger audit_logs_no_update before update or delete on audit_logs
  for each row execute function audit_logs_immutable();

create table system_settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now()
);

create table promotions (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  label       text not null,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  active      boolean not null default true,
  created_by  uuid references users(id)
);

create table integration_events (
  id          bigserial primary key,
  integration text not null,      -- 'stripe' | 'email' | 'sms' | 'pms' | ...
  level       text not null check (level in ('info','warn','error')),
  message     text not null,
  created_at  timestamptz not null default now()
);
create index integration_events_idx on integration_events(integration, id desc);

create table processed_webhooks (
  provider   text not null,
  event_id   text not null,
  created_at timestamptz not null default now(),
  primary key (provider, event_id)
);
