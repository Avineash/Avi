-- Row-level security for the buyer/seller tables (Supabase deployments; no-op elsewhere). Defence in depth:
-- the app uses a privileged server connection, but if these tables are ever exposed through PostgREST/Realtime,
-- people only see their own rows and the sensitive binary columns (proof of purchase, delivery files) are never readable.
do $$
declare t text; cols text;
begin
  if to_regnamespace('auth') is null then
    raise notice 'auth schema not found — skipping resale RLS';
    return;
  end if;

  foreach t in array array['seller_profiles','resale_listings','resale_saved','resale_orders','resale_disputes','seller_ledger','seller_payouts','resale_reviews','buyer_alerts'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  execute 'create policy seller_profiles_self on public.seller_profiles for select using (user_id = auth.uid())';
  execute 'create policy resale_listings_public on public.resale_listings for select using (status in (''active'',''sold_out'') or seller_id = auth.uid())';
  execute 'create policy resale_saved_own on public.resale_saved for all using (user_id = auth.uid()) with check (user_id = auth.uid())';
  execute 'create policy resale_orders_parties on public.resale_orders for select using (buyer_id = auth.uid() or seller_id = auth.uid())';
  execute 'create policy resale_disputes_own on public.resale_disputes for select using (opened_by = auth.uid())';
  execute 'create policy seller_ledger_own on public.seller_ledger for select using (seller_id = auth.uid())';
  execute 'create policy seller_payouts_own on public.seller_payouts for select using (seller_id = auth.uid())';
  execute 'create policy resale_reviews_public on public.resale_reviews for select using (true)';
  execute 'create policy buyer_alerts_own on public.buyer_alerts for all using (buyer_id = auth.uid()) with check (buyer_id = auth.uid())';

  -- Never expose the binary columns through the API roles.
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    select string_agg(quote_ident(column_name), ', ') into cols from information_schema.columns where table_schema = 'public' and table_name = 'resale_listings' and column_name <> 'proof_content';
    execute 'revoke select on public.resale_listings from anon, authenticated';
    execute format('grant select (%s) on public.resale_listings to anon, authenticated', cols);
    select string_agg(quote_ident(column_name), ', ') into cols from information_schema.columns where table_schema = 'public' and table_name = 'resale_orders' and column_name <> 'delivery_content';
    execute 'revoke select on public.resale_orders from anon, authenticated';
    execute format('grant select (%s) on public.resale_orders to authenticated', cols);
  end if;
end $$;
