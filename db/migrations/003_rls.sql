-- Row-level security for Supabase deployments (defence in depth).
-- The application talks to Postgres with a privileged server connection and enforces authorisation in code;
-- these policies ensure that if a table is ever exposed to the browser through Supabase's PostgREST/Realtime
-- with a user JWT, people can only read their own rows and nothing can be written directly.
-- Applies only where Supabase's `auth` schema exists (no-op on plain Postgres / PGlite).
do $$
declare t record;
begin
  if to_regnamespace('auth') is null then
    raise notice 'auth schema not found — skipping RLS policies';
    return;
  end if;

  -- default deny on everything
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;

  -- own-row read access (users.id mirrors auth.users.id in Supabase deployments)
  execute 'create policy users_self on public.users for select using (id = auth.uid())';
  execute 'create policy reservations_own on public.reservations for select using (customer_id = auth.uid())';
  execute 'create policy orders_own on public.orders for select using (customer_id = auth.uid())';
  execute 'create policy waitlist_own on public.waitlist_entries for select using (customer_id = auth.uid())';
  execute 'create policy waitlist_offers_own on public.waitlist_offers for select using (customer_id = auth.uid())';
  execute 'create policy buyback_offers_own on public.buyback_offers for select using (customer_id = auth.uid() and status in (''pending_customer'',''processing'',''resale_pending'',''completed'',''completed_unsold'',''rejected'',''expired''))';
  execute 'create policy notifications_own on public.notifications for select using (user_id = auth.uid())';
  execute 'create policy favourites_own on public.favourites for all using (user_id = auth.uid()) with check (user_id = auth.uid())';
  execute 'create policy payments_own on public.payments for select using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()))';
  execute 'create policy refunds_own on public.refunds for select using (exists (select 1 from public.reservations r where r.id = reservation_id and r.customer_id = auth.uid()))';

  -- partners see their own business data
  execute 'create policy partners_own on public.partners for select using (owner_user_id = auth.uid())';
  execute 'create policy ledger_partner on public.ledger_entries for select using (exists (select 1 from public.partners p where p.id = partner_id and p.owner_user_id = auth.uid()))';
  execute 'create policy partner_reservations on public.reservations for select using (exists (select 1 from public.partners p where p.id = partner_id and p.owner_user_id = auth.uid()))';

  -- public catalogue (published, approved only)
  execute 'create policy venues_public on public.venues for select using (status = ''active'')';
  execute 'create policy listings_public on public.listings for select using (status = ''published'')';
  execute 'create policy reviews_public on public.reviews for select using (true)';
  -- No insert/update/delete policies: all writes go through the server-side domain services.
end $$;
