import { getDb, type Queryable } from "@/lib/db";
import { melbDay } from "@/lib/util";
import { computeFee, type FeeRule } from "./fees";

export interface SearchParams {
  q?: string; category?: "hotel" | "restaurant" | "event"; city?: string; suburb?: string; date?: string;
  minPrice?: number; maxPrice?: number; minRating?: number; availability?: "available" | "soldout" | "any";
  sort?: "recommended" | "price_asc" | "price_desc" | "soonest" | "rating" | "discount";
  userId?: string | null; limit?: number; ids?: string[];
}
export interface ListingCard {
  id: string; title: string; subcategory: string | null; category: "hotel" | "restaurant" | "event"; image_url: string | null;
  starts_at: Date; ends_at: Date; booking_deadline: Date; original_price_cents: number; current_price_cents: number; total_price_cents: number;
  discount_pct: number; cancellation_policy: string; featured: boolean; buyback_eligible: boolean; promo_label: string | null;
  venue_id: string; venue_name: string; suburb: string; city: string; lat: number; lng: number; star_rating: number | null;
  total_units: number; available_units: number; waitlist_count: number; rating: number; review_count: number; saved: boolean; score?: number;
}

/** Customer-fee rule book, loaded once per request so cards can show the all-in price without N queries. */
export async function customerFeeBook(c: Queryable) {
  const rules = (await c.query<FeeRule & { active: boolean }>("select * from fee_rules where active and payer = 'customer' and applies_to = 'booking'")).rows;
  return (category: string, partnerId: string, basis: number) => {
    const r = rules.find((x) => x.scope === "partner" && x.partner_id === partnerId) ?? rules.find((x) => x.scope === "category" && x.category === category) ?? rules.find((x) => x.scope === "global");
    return r ? computeFee(r, basis) : 0;
  };
}

export async function searchListings(p: SearchParams): Promise<ListingCard[]> {
  const db = await getDb();
  const args: unknown[] = [];
  const add = (v: unknown) => (args.push(v), `$${args.length}`);
  const where: string[] = ["l.status = 'published'", "l.booking_deadline > now()", "v.status = 'active'", "pa.status = 'approved'"];
  if (p.ids) where.push(`l.id = any(${add(p.ids)}::uuid[])`);
  if (p.category) where.push(`l.category = ${add(p.category)}`);
  if (p.city) where.push(`lower(v.city) = lower(${add(p.city)})`);
  if (p.suburb) where.push(`lower(v.suburb) = lower(${add(p.suburb)})`);
  if (p.date) where.push(`(l.starts_at at time zone 'Australia/Melbourne')::date = ${add(p.date)}::date`);
  if (p.minPrice != null) where.push(`l.current_price_cents >= ${add(p.minPrice)}`);
  if (p.maxPrice != null) where.push(`l.current_price_cents <= ${add(p.maxPrice)}`);
  if (p.q) { const t = add(`%${p.q.toLowerCase()}%`); where.push(`(lower(l.title) like ${t} or lower(v.name) like ${t} or lower(v.suburb) like ${t} or lower(coalesce(l.subcategory,'')) like ${t} or lower(coalesce(v.cuisine,'')) like ${t})`); }
  if (p.availability === "available") where.push("a.available_units > 0");
  if (p.availability === "soldout") where.push("a.available_units = 0");
  const uid = add(p.userId ?? null);
  const sql = `
    select l.id, l.title, l.subcategory, l.category, coalesce(l.image_url, v.image_url) as image_url, l.starts_at, l.ends_at, l.booking_deadline,
           l.original_price_cents, l.current_price_cents, l.cancellation_policy, l.featured, l.buyback_eligible, l.partner_id,
           v.id as venue_id, v.name as venue_name, v.suburb, v.city, v.lat, v.lng, v.star_rating,
           a.total_units, a.available_units,
           (select count(*)::int from waitlist_entries w where w.listing_id = l.id and w.status in ('active','offered')) as waitlist_count,
           coalesce(rv.avg, 0)::float as rating, coalesce(rv.n, 0)::int as review_count,
           exists (select 1 from favourites f where f.listing_id = l.id and f.user_id = ${uid}::uuid) as saved,
           (select label from promotions pr where pr.listing_id = l.id and pr.active and now() between pr.starts_at and pr.ends_at limit 1) as promo_label
      from listings l join venues v on v.id = l.venue_id join partners pa on pa.id = l.partner_id join listing_availability a on a.listing_id = l.id
      left join lateral (select avg(rating) as avg, count(*) as n from reviews r where r.venue_id = v.id) rv on true
     where ${where.join(" and ")}
     order by l.starts_at limit 300`;
  const rows = (await db.query<any>(sql, args)).rows;
  const fee = await customerFeeBook(db);
  let out: ListingCard[] = rows.map((r) => ({
    ...r,
    total_price_cents: r.current_price_cents + fee(r.category, r.partner_id, r.current_price_cents),
    discount_pct: Math.max(0, Math.round((1 - r.current_price_cents / r.original_price_cents) * 100)),
  }));
  if (p.minRating) out = out.filter((r) => r.rating >= p.minRating! && r.review_count > 0);

  const sort = p.sort ?? "recommended";
  if (sort === "price_asc") out.sort((a, b) => a.current_price_cents - b.current_price_cents);
  else if (sort === "price_desc") out.sort((a, b) => b.current_price_cents - a.current_price_cents);
  else if (sort === "soonest") out.sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
  else if (sort === "rating") out.sort((a, b) => b.rating - a.rating || b.review_count - a.review_count);
  else if (sort === "discount") out.sort((a, b) => b.discount_pct - a.discount_pct);
  else {
    const taste = p.userId ? await tasteProfile(db, p.userId) : null;
    for (const r of out) {
      const hrs = Math.max(0, (+new Date(r.starts_at) - Date.now()) / 3_600_000);
      let s = (r.featured ? 3 : 0) + r.discount_pct / 10 + Math.max(0, 4 - hrs / 12) + r.rating * 0.6 + (r.available_units > 0 ? 1.5 : -1);
      if (taste) s += (taste.categories[r.category] ?? 0) * 1.2 + (taste.suburbs[r.suburb] ?? 0) * 0.8 + (r.saved ? 1 : 0);
      r.score = s;
    }
    out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }
  return p.limit ? out.slice(0, p.limit) : out;
}

/** Light-weight personalisation: what the customer has booked / saved before. */
async function tasteProfile(c: Queryable, userId: string) {
  const rows = (await c.query<any>(
    `select category, suburb, sum(w)::int as w from (
        select l.category, v.suburb, 2 as w from reservations r join listings l on l.id = r.listing_id join venues v on v.id = l.venue_id where r.customer_id = $1 and r.status in ('confirmed','completed')
        union all
        select l.category, v.suburb, 1 as w from favourites f join listings l on l.id = f.listing_id join venues v on v.id = l.venue_id where f.user_id = $1) x group by category, suburb`, [userId])).rows;
  const categories: Record<string, number> = {}, suburbs: Record<string, number> = {};
  for (const r of rows) { categories[r.category] = (categories[r.category] ?? 0) + r.w; suburbs[r.suburb] = (suburbs[r.suburb] ?? 0) + r.w; }
  const norm = (m: Record<string, number>) => { const mx = Math.max(1, ...Object.values(m)); for (const k in m) m[k] = m[k] / mx; return m; };
  return { categories: norm(categories), suburbs: norm(suburbs) };
}

export async function getListingDetail(id: string, userId?: string | null) {
  const db = await getDb();
  const [card] = await searchListings({ ids: [id], userId, sort: "soonest" });
  const base = (await db.query<any>(
    `select l.*, v.name as venue_name, v.address, v.suburb, v.city, v.lat, v.lng, v.description as venue_description, v.amenities, v.star_rating, v.cuisine, v.image_url as venue_image,
            p.business_name, p.waitlist_policy, p.offer_window_minutes, p.buyback_enabled, p.id as pid, p.status as partner_status, a.total_units, a.available_units
       from listings l join venues v on v.id = l.venue_id join partners p on p.id = l.partner_id join listing_availability a on a.listing_id = l.id where l.id = $1`, [id])).rows[0];
  if (!base) return null;
  const reviews = (await db.query<any>(
    `select r.rating, r.comment, r.created_at, u.name from reviews r join users u on u.id = r.customer_id where r.venue_id = $1 order by r.created_at desc limit 10`, [base.venue_id])).rows;
  const fee = await customerFeeBook(db);
  const customerFee = fee(base.category, base.partner_id, base.current_price_cents);
  const saved = userId ? !!(await db.query("select 1 from favourites where user_id = $1 and listing_id = $2", [userId, id])).rows[0] : false;
  const wl = userId ? (await db.query<any>("select id, status, max_price_cents from waitlist_entries where customer_id = $1 and listing_id = $2 and status in ('active','offered')", [userId, id])).rows[0] ?? null : null;
  return { ...base, card, reviews, customerFeeCents: customerFee, totalCents: base.current_price_cents + customerFee, saved, waitlistEntry: wl, day: melbDay(base.starts_at) };
}
