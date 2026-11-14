import { getDb, inTx, type Queryable, type Tx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { aud, fmtDateTime } from "@/lib/util";
import { makeRef as makeRefSafe } from "@/lib/ref";
import { featureOn, getSetting } from "./settings";
import { feeBook, gstOf, quoteFee } from "./fees";
import { notify, flushNotifications } from "./notifications";
import { audit, SYSTEM, type Actor } from "./audit";
import { getProvider, providerByName } from "@/lib/providers/payments";
import { startPayment } from "./payments";
import { settleRefund } from "./booking";
import { REGISTERED_ONLY_SELL } from "./registry";

/*
 * PEER RESALE — buyers and sellers.
 *
 *  • A seller lists a booking / reservation / ticket they hold at a venue REGISTERED with the platform (approved partner).
 *  • The buyer pays the platform (escrow). The seller is credited only after delivery is confirmed (or auto-released
 *    after the event starts with no dispute). A seller who doesn't deliver in time triggers an automatic full refund + a strike.
 *  • Asking price can never exceed the venue's markup cap (hotels/restaurants: face value; events: capped, default 110%).
 */

export interface ResaleRules {
  hold_minutes: number; delivery_hours: number; cutoff_hours_before_start: number; release_after_start_hours: number;
  min_release_after_delivery_hours: number; max_open_listings: number; max_strikes: number; dispute_hours_after_start: number;
}
const DEFAULT_RULES: ResaleRules = { hold_minutes: 10, delivery_hours: 24, cutoff_hours_before_start: 2, release_after_start_hours: 24, min_release_after_delivery_hours: 12, max_open_listings: 20, max_strikes: 3, dispute_hours_after_start: 24 };
export const resaleRules = (c: Queryable) => getSetting<ResaleRules>(c, "resale.rules", DEFAULT_RULES);

export const TRANSFER_LABEL: Record<string, string> = {
  name_change: "Booking name change", ticket_transfer: "Ticket transfer", voucher_code: "Voucher / code", reservation_name: "Reservation under buyer's name",
};
export const normRef = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const maxAskFor = (originalCents: number, maxMarkupBps: number) => Math.floor((originalCents * maxMarkupBps) / 10_000);
const H = 3_600_000;

// ───────────────────────── Sellers ─────────────────────────
export async function becomeSeller(a: { userId: string; displayName: string; phone: string; bio?: string; payoutHint?: string; acceptTerms: boolean }) {
  if (!a.acceptTerms) throw new DomainError("INVALID", "Please accept the Seller Terms to continue");
  const name = a.displayName.trim();
  if (name.length < 2 || name.length > 40) throw new DomainError("INVALID", "Choose a public name between 2 and 40 characters");
  if (!/^[+\d][\d\s-]{7,18}$/.test(a.phone.trim())) throw new DomainError("INVALID", "Enter a valid mobile number — buyers and support may need to reach you about a sale");
  await inTx(async (tx) => {
    await tx.query(
      `insert into seller_profiles(user_id, display_name, bio, phone, payout_hint, terms_accepted_at) values ($1,$2,$3,$4,$5,now())
       on conflict (user_id) do update set display_name = excluded.display_name, bio = excluded.bio, phone = excluded.phone, payout_hint = excluded.payout_hint`,
      [a.userId, name, a.bio?.slice(0, 400) || null, a.phone.trim(), a.payoutHint?.slice(0, 60) || null]);
    await audit(tx, { id: a.userId, role: "customer" }, "seller.profile_saved", "seller", a.userId);
  });
}
export async function getSeller(c: Queryable, userId: string) {
  return (await c.query<any>("select * from seller_profiles where user_id = $1", [userId])).rows[0] ?? null;
}

async function applyStrike(tx: Tx, sellerId: string, reason: string) {
  const rules = await resaleRules(tx);
  const r = (await tx.query<any>("update seller_profiles set strikes = strikes + 1 where user_id = $1 returning strikes", [sellerId])).rows[0];
  if (r && r.strikes >= rules.max_strikes) {
    await tx.query("update seller_profiles set status = 'suspended' where user_id = $1", [sellerId]);
    await tx.query("update resale_listings set status = 'paused', updated_at = now() where seller_id = $1 and status = 'active'", [sellerId]);
    await notify(tx, sellerId, { kind: "seller_suspended", title: "Selling suspended", body: `Your selling privileges are suspended after ${r.strikes} failed or cancelled sales. Contact support to review.`, link: "/account/selling" });
  }
  await audit(tx, SYSTEM, "seller.strike", "seller", sellerId, { reason, strikes: r?.strikes });
}

// ───────────────────────── Listings ─────────────────────────
export interface ListingInput {
  sellerId: string; venueId: string; title: string; itemDetail?: string; description?: string; imageUrl?: string;
  startsAt: Date; endsAt: Date; quantity: number; originalUnitCents: number; askUnitCents: number;
  transferMethod: string; transferNotes?: string; bookingReference: string;
  proof?: { fileName: string; mime: string; content: Buffer } | null; declarations: Record<string, boolean>; isDemo?: boolean; ip?: string | null;
}

export async function createResaleListing(i: ListingInput) {
  return inTx(async (tx) => {
    if (!(await featureOn(tx, "features.peer_resale"))) throw new DomainError("FEATURE_DISABLED", "Resale isn't open yet — it switches on after legal review.");
    const rules = await resaleRules(tx);
    const seller = await getSeller(tx, i.sellerId);
    if (!seller) throw new DomainError("FORBIDDEN", "Set up your seller profile first");
    if (seller.status !== "active") throw new DomainError("FORBIDDEN", "Your selling privileges are suspended");

    const v = (await tx.query<any>(
      `select v.*, p.status as partner_status from venues v join partners p on p.id = v.partner_id where v.id = $1`, [i.venueId])).rows[0];
    if (!v || v.partner_status !== "approved" || v.status !== "active") throw new DomainError("NOT_ELIGIBLE", REGISTERED_ONLY_SELL);
    if (!v.resale_allowed) throw new DomainError("NOT_ELIGIBLE", `${v.name} doesn't permit resale of its bookings.`);

    if (!["name_change", "ticket_transfer", "voucher_code", "reservation_name"].includes(i.transferMethod)) throw new DomainError("INVALID", "Choose how the booking will be transferred");
    if (!(i.quantity >= 1 && i.quantity <= 20)) throw new DomainError("INVALID", "Quantity must be between 1 and 20");
    if (!(i.originalUnitCents > 0)) throw new DomainError("INVALID", "Enter what you originally paid per unit");
    if (!(i.askUnitCents > 0)) throw new DomainError("INVALID", "Enter your asking price");
    const cap = maxAskFor(i.originalUnitCents, v.max_markup_bps);
    if (i.askUnitCents > cap) {
      throw new DomainError("NOT_ELIGIBLE", v.max_markup_bps <= 10000
        ? `This venue doesn't allow resale above what you paid (${aud(i.originalUnitCents)} each). Lower your asking price.`
        : `Resale is capped at ${(v.max_markup_bps / 100).toFixed(0)}% of what you paid (${aud(cap)} each). Lower your asking price.`);
    }
    if (i.endsAt <= i.startsAt) throw new DomainError("INVALID", "The end must be after the start");
    if (i.startsAt.getTime() - Date.now() < rules.cutoff_hours_before_start * H) throw new DomainError("INVALID", `Listings must be created at least ${rules.cutoff_hours_before_start} hours before the start — there's not enough time to transfer safely.`);
    if (!i.proof) throw new DomainError("INVALID", "Upload your booking confirmation or ticket as proof of purchase");
    if (i.proof.content.length > 5 * 1024 * 1024) throw new DomainError("INVALID", "Proof file must be under 5 MB");
    if (!["application/pdf", "image/png", "image/jpeg"].includes(i.proof.mime)) throw new DomainError("INVALID", "Proof must be a PDF, PNG or JPEG");
    const ref = normRef(i.bookingReference);
    if (ref.length < 4) throw new DomainError("INVALID", "Enter the booking / confirmation reference from your confirmation");
    if (!["holder", "permitted", "deliver", "accurate"].every((k) => i.declarations[k])) throw new DomainError("INVALID", "Please confirm all four seller declarations");
    const open = Number((await tx.query<any>("select count(*)::int n from resale_listings where seller_id = $1 and status in ('active','paused','sold_out')", [i.sellerId])).rows[0].n);
    if (open >= rules.max_open_listings) throw new DomainError("NOT_ELIGIBLE", `You can have up to ${rules.max_open_listings} live listings at once`);

    let id: string;
    try {
      id = (await tx.query<any>(
        `insert into resale_listings(seller_id, venue_id, category, title, item_detail, description, image_url, starts_at, ends_at, quantity_total, quantity_available,
           original_unit_cents, ask_unit_cents, transfer_method, transfer_notes, booking_reference, booking_reference_norm, proof_file_name, proof_mime, proof_content, declarations, is_demo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21) returning id`,
        [i.sellerId, v.id, v.category, i.title.trim(), i.itemDetail ?? null, i.description ?? null, i.imageUrl ?? v.image_url, i.startsAt, i.endsAt, i.quantity, i.originalUnitCents, i.askUnitCents,
         i.transferMethod, i.transferNotes ?? null, i.bookingReference.trim(), ref, i.proof.fileName.slice(0, 120), i.proof.mime, i.proof.content, JSON.stringify(i.declarations), !!i.isDemo])).rows[0].id;
    } catch (e: any) {
      if (e?.code === "23505") throw new DomainError("CONFLICT", "This booking is already listed on Eleventh Hour.");
      throw e;
    }
    await matchAlerts(tx, id);
    await audit(tx, { id: i.sellerId, role: "customer", ip: i.ip }, "resale.listing_created", "resale_listing", id, { venue: v.name, ask: i.askUnitCents, original: i.originalUnitCents, qty: i.quantity });
    return id;
  });
}

export async function updateAskPrice(sellerId: string, listingId: string, askUnitCents: number) {
  await inTx(async (tx) => {
    const l = (await tx.query<any>("select l.*, v.max_markup_bps from resale_listings l join venues v on v.id = l.venue_id where l.id = $1 for update of l", [listingId])).rows[0];
    if (!l || l.seller_id !== sellerId) throw new DomainError("FORBIDDEN", "Not your listing");
    if (!(askUnitCents > 0) || askUnitCents > maxAskFor(l.original_unit_cents, l.max_markup_bps)) throw new DomainError("INVALID", `Price must be between $0.01 and ${aud(maxAskFor(l.original_unit_cents, l.max_markup_bps))}`);
    await tx.query("update resale_listings set ask_unit_cents = $2, updated_at = now() where id = $1", [listingId, askUnitCents]);
    await audit(tx, { id: sellerId, role: "customer" }, "resale.price_changed", "resale_listing", listingId, { from: l.ask_unit_cents, to: askUnitCents });
  });
}

export async function setListingStatus(sellerId: string, listingId: string, op: "pause" | "resume" | "remove") {
  await inTx(async (tx) => {
    const l = (await tx.query<any>("select * from resale_listings where id = $1 for update", [listingId])).rows[0];
    if (!l || l.seller_id !== sellerId) throw new DomainError("FORBIDDEN", "Not your listing");
    const open = Number((await tx.query<any>("select count(*)::int n from resale_orders where listing_id = $1 and status in ('pending_payment','paid','delivered','disputed','refunding')", [listingId])).rows[0].n);
    if (op === "remove") {
      if (open > 0) throw new DomainError("CONFLICT", "You still have sales in progress on this listing — deliver or cancel them first.");
      await tx.query("update resale_listings set status = 'removed', updated_at = now() where id = $1", [listingId]);
    } else if (op === "pause") {
      if (l.status !== "active") throw new DomainError("CONFLICT", "Only active listings can be paused");
      await tx.query("update resale_listings set status = 'paused', updated_at = now() where id = $1", [listingId]);
    } else {
      const seller = await getSeller(tx, sellerId);
      if (l.status !== "paused" || seller?.status !== "active") throw new DomainError("CONFLICT", "This listing can't be resumed");
      await tx.query("update resale_listings set status = case when quantity_available = 0 then 'sold_out' else 'active' end, updated_at = now() where id = $1", [listingId]);
    }
  });
}

// ───────────────────────── Search & detail ─────────────────────────
export interface ResaleCard {
  id: string; title: string; item_detail: string | null; category: "hotel" | "restaurant" | "event"; image_url: string | null;
  starts_at: Date; ends_at: Date; quantity_available: number; quantity_total: number; original_unit_cents: number; ask_unit_cents: number;
  buyer_fee_unit_cents: number; total_unit_cents: number; delta_pct: number; transfer_method: string; venue_id: string; venue_name: string; suburb: string; lat: number; lng: number;
  seller_id: string; seller_name: string; seller_rating: number; seller_reviews: number; seller_sales: number; saved: boolean; status: string; score?: number;
}
export interface ResaleSearch {
  q?: string; category?: "hotel" | "restaurant" | "event"; suburb?: string; date?: string; minPrice?: number; maxPrice?: number; minRating?: number;
  availability?: "available" | "soldout" | "any"; sort?: "recommended" | "soonest" | "price_asc" | "price_desc" | "savings" | "rating"; userId?: string | null; limit?: number; ids?: string[]; sellerId?: string;
}

export async function searchResale(p: ResaleSearch): Promise<ResaleCard[]> {
  const db = await getDb();
  const rules = await resaleRules(db);
  const args: unknown[] = [];
  const add = (v: unknown) => (args.push(v), `$${args.length}`);
  // Registered-partners-only is enforced here too: a listing whose partner isn't approved never appears.
  const where = ["v.status = 'active'", "pa.status = 'approved'", "v.resale_allowed", "sp.status = 'active'", `l.starts_at > now() + (${add(rules.cutoff_hours_before_start)} || ' hours')::interval`];
  if (p.ids) where.push(`l.id = any(${add(p.ids)}::uuid[])`);
  else if (p.availability === "soldout") where.push("l.status = 'sold_out'"); else where.push(p.availability === "any" ? "l.status in ('active','sold_out')" : "l.status = 'active' and l.quantity_available > 0");
  if (p.sellerId) where.push(`l.seller_id = ${add(p.sellerId)}`);
  if (p.category) where.push(`l.category = ${add(p.category)}`);
  if (p.suburb) where.push(`lower(v.suburb) = lower(${add(p.suburb)})`);
  if (p.date) where.push(`(l.starts_at at time zone 'Australia/Melbourne')::date = ${add(p.date)}::date`);
  if (p.minPrice != null) where.push(`l.ask_unit_cents >= ${add(p.minPrice)}`);
  if (p.maxPrice != null) where.push(`l.ask_unit_cents <= ${add(p.maxPrice)}`);
  if (p.q) { const t = add(`%${p.q.toLowerCase()}%`); where.push(`(lower(l.title) like ${t} or lower(v.name) like ${t} or lower(v.suburb) like ${t} or lower(coalesce(l.item_detail,'')) like ${t})`); }
  const uid = add(p.userId ?? null);
  const rows = (await db.query<any>(
    `select l.id, l.title, l.item_detail, l.category, coalesce(l.image_url, v.image_url) as image_url, l.starts_at, l.ends_at, l.quantity_available, l.quantity_total, l.original_unit_cents,
            l.ask_unit_cents, l.transfer_method, l.status, v.id as venue_id, v.name as venue_name, v.suburb, v.lat, v.lng, pa.id as partner_id,
            l.seller_id, sp.display_name as seller_name, coalesce(rv.avg,0)::float as seller_rating, coalesce(rv.n,0)::int as seller_reviews,
            (select count(*)::int from resale_orders o where o.seller_id = l.seller_id and o.status = 'completed') as seller_sales,
            exists (select 1 from resale_saved s where s.listing_id = l.id and s.user_id = ${uid}::uuid) as saved
       from resale_listings l join venues v on v.id = l.venue_id join partners pa on pa.id = v.partner_id join seller_profiles sp on sp.user_id = l.seller_id
       left join lateral (select avg(rating) avg, count(*) n from resale_reviews r where r.seller_id = l.seller_id) rv on true
      where ${where.join(" and ")} order by l.starts_at limit 300`, args)).rows;
  const fee = await feeBook(db, "customer", "peer_resale");
  let out: ResaleCard[] = rows.map((r) => {
    const f = fee(r.category, r.partner_id, r.ask_unit_cents);
    return { ...r, buyer_fee_unit_cents: f, total_unit_cents: r.ask_unit_cents + f, delta_pct: Math.round((1 - r.ask_unit_cents / r.original_unit_cents) * 100) };
  });
  if (p.minRating) out = out.filter((r) => r.seller_rating >= p.minRating! && r.seller_reviews > 0);
  const sort = p.sort ?? "recommended";
  if (sort === "price_asc") out.sort((a, b) => a.ask_unit_cents - b.ask_unit_cents);
  else if (sort === "price_desc") out.sort((a, b) => b.ask_unit_cents - a.ask_unit_cents);
  else if (sort === "soonest") out.sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
  else if (sort === "savings") out.sort((a, b) => b.delta_pct - a.delta_pct);
  else if (sort === "rating") out.sort((a, b) => b.seller_rating - a.seller_rating || b.seller_sales - a.seller_sales);
  else {
    for (const r of out) {
      const hrs = Math.max(0, (+new Date(r.starts_at) - Date.now()) / H);
      r.score = Math.max(0, r.delta_pct) / 8 + Math.max(0, 5 - hrs / 10) + r.seller_rating * 0.7 + Math.min(r.seller_sales, 10) * 0.15 + (r.quantity_available > 0 ? 2 : -2) + (r.saved ? 1 : 0);
    }
    out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }
  return p.limit ? out.slice(0, p.limit) : out;
}

export async function sellerPublic(c: Queryable, sellerId: string) {
  const s = (await c.query<any>(
    `select sp.display_name, sp.bio, sp.status, sp.created_at, coalesce(rv.avg,0)::float as rating, coalesce(rv.n,0)::int as reviews,
            (select count(*)::int from resale_orders o where o.seller_id = sp.user_id and o.status = 'completed') as sales
       from seller_profiles sp left join lateral (select avg(rating) avg, count(*) n from resale_reviews r where r.seller_id = sp.user_id) rv on true where sp.user_id = $1`, [sellerId])).rows[0];
  return s ?? null;
}

export async function getResaleDetail(id: string, userId?: string | null) {
  const db = await getDb();
  const [card] = await searchResale({ ids: [id], userId });
  const l = (await db.query<any>(
    `select l.*, v.name as venue_name, v.address, v.suburb, v.lat, v.lng, v.description as venue_description, v.amenities, v.transfer_instructions, v.max_markup_bps, v.star_rating, v.cuisine,
            pa.status as partner_status, pa.business_name, v.status as venue_status, v.resale_allowed
       from resale_listings l join venues v on v.id = l.venue_id join partners pa on pa.id = v.partner_id where l.id = $1`, [id])).rows[0];
  if (!l) return null;
  const seller = await sellerPublic(db, l.seller_id);
  const reviews = (await db.query<any>(
    `select r.rating, r.comment, r.created_at, u.name from resale_reviews r join users u on u.id = r.buyer_id where r.seller_id = $1 order by r.created_at desc limit 6`, [l.seller_id])).rows;
  const rules = await resaleRules(db);
  const fee = await feeBook(db, "customer", "peer_resale");
  const sellerFee = await feeBook(db, "seller", "peer_resale");
  const pid = (await db.query<any>("select partner_id from venues where id = $1", [l.venue_id])).rows[0].partner_id;
  const buyerFee = fee(l.category, pid, l.ask_unit_cents);
  const saved = userId ? !!(await db.query("select 1 from resale_saved where user_id = $1 and listing_id = $2", [userId, id])).rows[0] : false;
  const sellable = l.partner_status === "approved" && l.venue_status === "active" && l.resale_allowed && ["active"].includes(l.status) && l.quantity_available > 0 && new Date(l.starts_at).getTime() - Date.now() >= rules.cutoff_hours_before_start * H;
  return { ...l, card, seller, reviews, rules, buyerFeeUnitCents: buyerFee, totalUnitCents: l.ask_unit_cents + buyerFee, sellerFeeUnitCents: sellerFee(l.category, pid, l.ask_unit_cents), saved, sellable };
}

// ───────────────────────── Checkout (escrow) ─────────────────────────
const isUnique = (e: any) => e?.code === "23505";

export async function createResaleCheckout(i: { buyerId: string; listingId: string; quantity: number; idempotencyKey: string; ip?: string | null }): Promise<{ orderId: string; resaleOrderId: string }> {
  const run = () => inTx(async (tx) => {
    const ex = (await tx.query<any>("select o.id, o.customer_id, r.id as rid from orders o join resale_orders r on r.order_id = o.id where o.idempotency_key = $1", [i.idempotencyKey])).rows[0];
    if (ex) { if (ex.customer_id !== i.buyerId) throw new DomainError("FORBIDDEN", "Not your order"); return { orderId: ex.id as string, resaleOrderId: ex.rid as string, fresh: false }; }
    if (!(await featureOn(tx, "features.peer_resale"))) throw new DomainError("FEATURE_DISABLED", "Resale isn't open yet.");
    const rules = await resaleRules(tx);
    const l = (await tx.query<any>(
      `select l.*, v.status as venue_status, v.resale_allowed, v.name as venue_name, pa.status as partner_status, pa.id as partner_id, sp.status as seller_status
         from resale_listings l join venues v on v.id = l.venue_id join partners pa on pa.id = v.partner_id join seller_profiles sp on sp.user_id = l.seller_id
        where l.id = $1 for update of l`, [i.listingId])).rows[0];
    if (!l) throw new DomainError("NOT_FOUND", "Listing not found");
    if (l.seller_id === i.buyerId) throw new DomainError("FORBIDDEN", "You can't buy your own listing");
    if (l.partner_status !== "approved" || l.venue_status !== "active" || !l.resale_allowed) throw new DomainError("NOT_ELIGIBLE", REGISTERED_ONLY_SELL);
    if (l.seller_status !== "active" || l.status !== "active") throw new DomainError("EXPIRED", l.status === "sold_out" ? "Sorry — someone just bought this." : "This listing is no longer available");
    if (new Date(l.starts_at).getTime() - Date.now() < rules.cutoff_hours_before_start * H) throw new DomainError("EXPIRED", "It's too close to the start to transfer this safely.");
    if (!(i.quantity >= 1) || i.quantity > l.quantity_available) throw new DomainError("SOLD_OUT", l.quantity_available === 0 ? "Sorry — someone just bought this." : `Only ${l.quantity_available} left`);

    const subtotal = l.ask_unit_cents * i.quantity;
    const bf = await quoteFee(tx, { payer: "customer", flow: "peer_resale", category: l.category, partnerId: l.partner_id, basisCents: subtotal });
    const sf = await quoteFee(tx, { payer: "seller", flow: "peer_resale", category: l.category, partnerId: l.partner_id, basisCents: subtotal });
    await tx.query("update resale_listings set quantity_available = quantity_available - $2, status = case when quantity_available - $2 = 0 then 'sold_out' else status end, updated_at = now() where id = $1", [l.id, i.quantity]);
    const expires = new Date(Date.now() + rules.hold_minutes * 60_000);
    const order = (await tx.query<any>(
      `insert into orders(reference, customer_id, source, subtotal_cents, customer_fee_cents, total_cents, idempotency_key, expires_at)
       values ($1,$2,'resale',$3,$4,$5,$6,$7) returning id`, [makeRefSafe("EH"), i.buyerId, subtotal, bf.amount, subtotal + bf.amount, i.idempotencyKey, expires])).rows[0];
    await tx.query("insert into payments(order_id, provider, amount_cents, idempotency_key) values ($1,$2,$3,$4)", [order.id, getProvider().name, subtotal + bf.amount, `pay:${i.idempotencyKey}`]);
    const ro = (await tx.query<any>(
      `insert into resale_orders(reference, order_id, listing_id, buyer_id, seller_id, quantity, unit_price_cents, subtotal_cents, buyer_fee_cents, seller_fee_cents, total_cents)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [makeRefSafe("RO"), order.id, l.id, i.buyerId, l.seller_id, i.quantity, l.ask_unit_cents, subtotal, bf.amount, sf.amount, subtotal + bf.amount])).rows[0];
    await audit(tx, { id: i.buyerId, role: "customer", ip: i.ip }, "resale.order_created", "resale_order", ro.id, { listingId: l.id, quantity: i.quantity, total: subtotal + bf.amount });
    return { orderId: order.id as string, resaleOrderId: ro.id as string, fresh: true };
  });
  let r;
  try { r = await run(); } catch (e) { if (isUnique(e) && String((e as any).message ?? "").includes("idempotency_key")) r = await run(); else throw e; }
  await startPayment(r.orderId);
  return { orderId: r.orderId, resaleOrderId: r.resaleOrderId };
}

/** Called by booking.onPaymentAuthorized for source='resale' orders. */
export async function resaleCapturable(tx: Tx, orderId: string): Promise<boolean> {
  const ro = (await tx.query<any>("select r.status as rs, o.status as os from resale_orders r join orders o on o.id = r.order_id where o.id = $1", [orderId])).rows[0];
  return !!ro && ro.rs === "pending_payment" && ro.os === "pending_payment";
}

export async function confirmResaleOrder(tx: Tx, payment: any, order: any) {
  const ro = (await tx.query<any>("select * from resale_orders where order_id = $1 for update", [order.id])).rows[0];
  const l = (await tx.query<any>("select title, starts_at from resale_listings where id = $1", [ro.listing_id])).rows[0];
  const rules = await resaleRules(tx);
  const now = Date.now();
  const deliverBy = new Date(Math.max(now + 30 * 60_000, Math.min(now + rules.delivery_hours * H, new Date(l.starts_at).getTime() - 30 * 60_000)));
  await tx.query("update resale_orders set status = 'paid', deliver_by = $2, updated_at = now() where id = $1", [ro.id, deliverBy]);
  await tx.query("update orders set status = 'paid', paid_at = now() where id = $1", [order.id]);
  await tx.query("update payments set status = 'captured', captured_cents = amount_cents, captured_at = now() where id = $1", [payment.id]);
  await tx.query("insert into platform_fees(kind, order_id, resale_order_id, basis_cents, amount_cents, gst_cents) values ('buyer_fee',$1,$2,$3,$4,$5)", [order.id, ro.id, ro.subtotal_cents, ro.buyer_fee_cents, gstOf(ro.buyer_fee_cents)]);
  await tx.query("insert into platform_fees(kind, order_id, resale_order_id, basis_cents, amount_cents, gst_cents) values ('seller_fee',$1,$2,$3,$4,$5)", [order.id, ro.id, ro.subtotal_cents, ro.seller_fee_cents, gstOf(ro.seller_fee_cents)]);
  await tx.query("insert into seller_ledger(seller_id, resale_order_id, kind, amount_cents, note) values ($1,$2,'sale',$3,$4)", [ro.seller_id, ro.id, ro.subtotal_cents, `Sale ${ro.reference} (held in escrow)`]);
  await tx.query("insert into seller_ledger(seller_id, resale_order_id, kind, amount_cents, note) values ($1,$2,'fee',$3,$4)", [ro.seller_id, ro.id, -ro.seller_fee_cents, `Seller fee ${ro.reference}`]);
  await notify(tx, ro.seller_id, { kind: "resale_sold", title: "Sold — deliver now", body: `${ro.quantity} × ${l.title} sold for ${aud(ro.subtotal_cents)}. Transfer it to the buyer and confirm by ${fmtDateTime(deliverBy)} or the buyer is refunded automatically.`, link: `/account/sales/${ro.id}` });
  await notify(tx, ro.buyer_id, { kind: "resale_paid", title: "Payment received — held in escrow", body: `Your money is held safely until the seller delivers ${l.title} and you confirm. The seller has until ${fmtDateTime(deliverBy)}.`, link: `/account/purchases/${ro.id}` });
  await audit(tx, { id: ro.buyer_id, role: "customer" }, "resale.order_paid", "resale_order", ro.id, { total: ro.total_cents });
}

export async function expireResaleOrder(tx: Tx, order: any) {
  const ro = (await tx.query<any>("select * from resale_orders where order_id = $1 for update", [order.id])).rows[0];
  if (!ro || ro.status !== "pending_payment") return;
  await tx.query("update resale_orders set status = 'expired', updated_at = now() where id = $1", [ro.id]);
  await restoreQuantity(tx, ro);
}
async function restoreQuantity(tx: Tx, ro: any) {
  const rules = await resaleRules(tx);
  const l = (await tx.query<any>("select l.*, sp.status as seller_status from resale_listings l join seller_profiles sp on sp.user_id = l.seller_id where l.id = $1 for update of l", [ro.listing_id])).rows[0];
  const sellable = new Date(l.starts_at).getTime() - Date.now() >= rules.cutoff_hours_before_start * H && l.seller_status === "active";
  await tx.query("update resale_listings set quantity_available = least(quantity_total, quantity_available + $2), status = case when status = 'sold_out' and $3 then 'active' else status end, updated_at = now() where id = $1", [l.id, ro.quantity, sellable]);
}

// ───────────────────────── Delivery, release, cancellation ─────────────────────────
export async function deliverResaleOrder(a: { sellerId: string; orderId: string; notes?: string; file?: { name: string; mime: string; content: Buffer } | null }) {
  await inTx(async (tx) => {
    const ro = (await tx.query<any>("select r.*, l.title, l.starts_at from resale_orders r join resale_listings l on l.id = r.listing_id where r.id = $1 for update of r", [a.orderId])).rows[0];
    if (!ro || ro.seller_id !== a.sellerId) throw new DomainError("NOT_FOUND", "Sale not found");
    if (ro.status !== "paid") throw new DomainError("CONFLICT", ro.status === "delivered" ? "You've already delivered this sale" : "This sale can't be delivered in its current state");
    const notes = (a.notes ?? "").trim();
    if (notes.length < 5 && !a.file) throw new DomainError("INVALID", "Add the transfer details (or upload the transferred ticket / confirmation) so the buyer can check it");
    if (a.file) {
      if (a.file.content.length > 5 * 1024 * 1024) throw new DomainError("INVALID", "File must be under 5 MB");
      if (!["application/pdf", "image/png", "image/jpeg"].includes(a.file.mime)) throw new DomainError("INVALID", "PDF, PNG or JPEG only");
    }
    const rules = await resaleRules(tx);
    const rel = new Date(Math.max(new Date(ro.starts_at).getTime() + rules.release_after_start_hours * H, Date.now() + rules.min_release_after_delivery_hours * H));
    await tx.query(
      `update resale_orders set status = 'delivered', delivered_at = now(), delivery_notes = $2, delivery_file_name = $3, delivery_mime = $4, delivery_content = $5, auto_release_at = $6, updated_at = now() where id = $1`,
      [ro.id, notes || null, a.file?.name.slice(0, 120) ?? null, a.file?.mime ?? null, a.file?.content ?? null, rel]);
    await notify(tx, ro.buyer_id, { kind: "resale_delivered", title: "Your booking has been delivered", body: `${ro.title}: the seller has sent the transfer details. Check them and confirm — or report a problem before ${fmtDateTime(new Date(new Date(ro.starts_at).getTime() + rules.dispute_hours_after_start * H))}.`, link: `/account/purchases/${ro.id}` });
    await audit(tx, { id: a.sellerId, role: "customer" }, "resale.delivered", "resale_order", ro.id);
  });
  void flushNotifications().catch(() => {});
}

async function releaseEscrow(tx: Tx, ro: any, how: string) {
  await tx.query("update seller_ledger set released = true, released_at = now() where resale_order_id = $1 and not released", [ro.id]);
  await tx.query("update resale_orders set status = 'completed', completed_at = now(), updated_at = now() where id = $1", [ro.id]);
  await notify(tx, ro.seller_id, { kind: "resale_released", title: "Funds released", body: `${ro.reference} is complete (${how}). ${aud(ro.subtotal_cents - ro.seller_fee_cents)} is now available to withdraw.`, link: "/account/earnings" });
  await audit(tx, SYSTEM, "resale.escrow_released", "resale_order", ro.id, { how });
}

export async function confirmReceipt(buyerId: string, orderId: string) {
  await inTx(async (tx) => {
    const ro = (await tx.query<any>("select * from resale_orders where id = $1 for update", [orderId])).rows[0];
    if (!ro || ro.buyer_id !== buyerId) throw new DomainError("NOT_FOUND", "Purchase not found");
    if (ro.status !== "delivered") throw new DomainError("CONFLICT", "There's nothing to confirm yet — the seller hasn't delivered.");
    await releaseEscrow(tx, ro, "confirmed by the buyer");
  });
  void flushNotifications().catch(() => {});
}

/** Starts a full refund of the buyer inside the caller's tx (the provider call happens afterwards in finishResaleRefund). */
async function beginRefund(tx: Tx, ro: any, o: { cancelledBy?: string | null; reason: string; strike: boolean }) {
  const pay = (await tx.query<any>("select * from payments where order_id = $1 for update", [ro.order_id])).rows[0];
  if (pay.captured_cents - pay.refunded_cents < ro.total_cents) throw new DomainError("CONFLICT", "Refund exceeds the amount captured");
  await tx.query("update resale_orders set status = 'refunding', cancelled_by = $2, cancel_reason = $3, strike_applied = $4, updated_at = now() where id = $1", [ro.id, o.cancelledBy ?? null, o.reason, o.strike]);
  await tx.query("insert into refunds(payment_id, amount_cents, kind, reason, idempotency_key, requested_by) values ($1,$2,'cancellation',$3,$4,$5) on conflict (idempotency_key) do nothing", [pay.id, ro.total_cents, o.reason, `resale:${ro.id}`, o.cancelledBy ?? null]);
  if (o.strike) await applyStrike(tx, ro.seller_id, o.reason);
}

/** Idempotent: executes the refund, reverses the ledger/fees, restores stock. Safe to retry from maintenance. */
export async function finishResaleRefund(orderId: string): Promise<"done" | "waiting"> {
  const db = await getDb();
  const ro = (await db.query<any>("select * from resale_orders where id = $1", [orderId])).rows[0];
  if (!ro || ro.status !== "refunding") return "done";
  const refund = (await db.query<any>("select * from refunds where idempotency_key = $1", [`resale:${orderId}`])).rows[0];
  if (!refund) return "waiting";
  if (refund.status !== "succeeded" && !(await settleRefund(refund.id)).ok) return "waiting";
  await inTx(async (tx) => {
    const cur = (await tx.query<any>("select r.*, l.title from resale_orders r join resale_listings l on l.id = r.listing_id where r.id = $1 for update of r", [orderId])).rows[0];
    if (cur.status !== "refunding") return;
    await tx.query("insert into seller_ledger(seller_id, resale_order_id, kind, amount_cents, note) values ($1,$2,'refund',$3,$4)", [cur.seller_id, cur.id, -cur.subtotal_cents, `Refund ${cur.reference}`]);
    await tx.query("insert into seller_ledger(seller_id, resale_order_id, kind, amount_cents, note) values ($1,$2,'fee_reversal',$3,$4)", [cur.seller_id, cur.id, cur.seller_fee_cents, `Fee reversal ${cur.reference}`]);
    await tx.query("insert into platform_fees(kind, order_id, resale_order_id, basis_cents, amount_cents, gst_cents, is_reversal) values ('buyer_fee',$1,$2,$3,$4,$5,true)", [cur.order_id, cur.id, -cur.subtotal_cents, -cur.buyer_fee_cents, -gstOf(cur.buyer_fee_cents)]);
    await tx.query("insert into platform_fees(kind, order_id, resale_order_id, basis_cents, amount_cents, gst_cents, is_reversal) values ('seller_fee',$1,$2,$3,$4,$5,true)", [cur.order_id, cur.id, -cur.subtotal_cents, -cur.seller_fee_cents, -gstOf(cur.seller_fee_cents)]);
    await tx.query("update resale_orders set status = $2, updated_at = now() where id = $1", [cur.id, cur.cancelled_by ? "cancelled" : "refunded"]);
    await restoreQuantity(tx, cur);
    await notify(tx, cur.buyer_id, { kind: "resale_refunded", title: "You've been refunded in full", body: `${cur.reference}: ${aud(cur.total_cents)} (including the service fee) is on its way back to your original payment method. ${cur.cancel_reason ?? ""}`.trim(), link: `/account/purchases/${cur.id}` });
    await notify(tx, cur.seller_id, { kind: "resale_cancelled", title: "Sale cancelled", body: `${cur.reference} was cancelled and the buyer refunded.${cur.strike_applied ? " A strike was recorded on your account." : ""}`, link: `/account/sales/${cur.id}` });
    await audit(tx, SYSTEM, "resale.refunded", "resale_order", cur.id, { reason: cur.cancel_reason });
  });
  return "done";
}

export async function cancelResaleOrder(a: { actorId: string; orderId: string; as: "buyer" | "seller"; reason?: string }) {
  await inTx(async (tx) => {
    const ro = (await tx.query<any>("select * from resale_orders where id = $1 for update", [a.orderId])).rows[0];
    if (!ro || (a.as === "buyer" ? ro.buyer_id : ro.seller_id) !== a.actorId) throw new DomainError("NOT_FOUND", "Order not found");
    if (ro.status !== "paid") throw new DomainError("CONFLICT", ro.status === "delivered" ? "Once the seller has delivered, use “Report a problem” instead of cancelling." : "This order can't be cancelled now");
    await beginRefund(tx, ro, { cancelledBy: a.actorId, reason: a.reason?.slice(0, 300) || (a.as === "buyer" ? "Cancelled by the buyer before delivery" : "Cancelled by the seller"), strike: a.as === "seller" });
  });
  await finishResaleRefund(a.orderId);
  void flushNotifications().catch(() => {});
}

export async function openResaleDispute(a: { buyerId: string; orderId: string; reason: string; details?: string }) {
  await inTx(async (tx) => {
    const ro = (await tx.query<any>("select r.*, l.starts_at, l.title from resale_orders r join resale_listings l on l.id = r.listing_id where r.id = $1 for update of r", [a.orderId])).rows[0];
    if (!ro || ro.buyer_id !== a.buyerId) throw new DomainError("NOT_FOUND", "Purchase not found");
    if (ro.status !== "delivered") throw new DomainError("CONFLICT", "You can report a problem after the seller delivers (before delivery you can simply cancel).");
    const rules = await resaleRules(tx);
    if (Date.now() > new Date(ro.starts_at).getTime() + rules.dispute_hours_after_start * H) throw new DomainError("EXPIRED", "The window to report a problem has closed.");
    if (a.reason.trim().length < 5) throw new DomainError("INVALID", "Tell us what's wrong");
    await tx.query("insert into resale_disputes(resale_order_id, opened_by, reason, details) values ($1,$2,$3,$4)", [ro.id, a.buyerId, a.reason.trim(), a.details?.slice(0, 1500) ?? null]);
    await tx.query("update resale_orders set status = 'disputed', updated_at = now() where id = $1", [ro.id]);
    await notify(tx, ro.seller_id, { kind: "resale_disputed", title: "A buyer reported a problem", body: `${ro.reference}: funds are frozen while we review. We may contact you.`, link: `/account/sales/${ro.id}` });
    await audit(tx, { id: a.buyerId, role: "customer" }, "resale.dispute_opened", "resale_order", ro.id, { reason: a.reason });
  });
  void flushNotifications().catch(() => {});
}

/** Operator tool (no admin UI in this phase): see /api/ops. */
export async function resolveResaleDispute(a: { disputeId: string; outcome: "refund_buyer" | "release_seller"; note: string; actor: Actor }) {
  const roId = await inTx(async (tx) => {
    const d = (await tx.query<any>("select * from resale_disputes where id = $1 for update", [a.disputeId])).rows[0];
    if (!d || d.status !== "open") throw new DomainError("CONFLICT", "Dispute not open");
    const ro = (await tx.query<any>("select * from resale_orders where id = $1 for update", [d.resale_order_id])).rows[0];
    await tx.query("update resale_disputes set status = $2, resolution = $3, resolved_at = now() where id = $1", [d.id, a.outcome === "refund_buyer" ? "resolved_refund" : "resolved_release", a.note]);
    if (a.outcome === "refund_buyer") await beginRefund(tx, ro, { cancelledBy: null, reason: `Dispute upheld: ${a.note}`, strike: true });
    else {
      await releaseEscrow(tx, ro, "dispute resolved in the seller's favour");
      await notify(tx, ro.buyer_id, { kind: "resale_dispute_closed", title: "Your report was reviewed", body: `We couldn't uphold your report on ${ro.reference}: ${a.note}`, link: `/account/purchases/${ro.id}` });
    }
    await audit(tx, a.actor, "resale.dispute_resolved", "resale_dispute", d.id, { outcome: a.outcome });
    return ro.id as string;
  });
  if (a.outcome === "refund_buyer") await finishResaleRefund(roId);
}

export async function submitSellerReview(a: { buyerId: string; orderId: string; rating: number; comment?: string }) {
  await inTx(async (tx) => {
    const ro = (await tx.query<any>("select * from resale_orders where id = $1", [a.orderId])).rows[0];
    if (!ro || ro.buyer_id !== a.buyerId) throw new DomainError("NOT_FOUND", "Purchase not found");
    if (ro.status !== "completed") throw new DomainError("CONFLICT", "You can review a seller once the sale is complete");
    if (!(a.rating >= 1 && a.rating <= 5)) throw new DomainError("INVALID", "Rating must be 1–5");
    try { await tx.query("insert into resale_reviews(resale_order_id, seller_id, buyer_id, rating, comment) values ($1,$2,$3,$4,$5)", [ro.id, ro.seller_id, a.buyerId, Math.round(a.rating), a.comment?.slice(0, 1000) ?? null]); }
    catch (e: any) { if (isUnique(e)) throw new DomainError("CONFLICT", "You've already reviewed this sale"); throw e; }
  });
}

// ───────────────────────── Maintenance ─────────────────────────
export async function runResaleMaintenance(now = new Date()) {
  const db = await getDb();
  const rules = await resaleRules(db);
  const out = { listingsExpired: 0, undeliveredRefunded: 0, refundsResumed: 0, released: 0 };
  out.listingsExpired = (await db.query("update resale_listings set status = 'expired', updated_at = now() where status in ('active','sold_out','paused') and starts_at - ($2 || ' hours')::interval <= $1", [now, String(rules.cutoff_hours_before_start)])).rowCount;

  for (const r of (await db.query<any>("select id from resale_orders where status = 'paid' and deliver_by < $1", [now])).rows) {
    await inTx(async (tx) => {
      const ro = (await tx.query<any>("select * from resale_orders where id = $1 for update", [r.id])).rows[0];
      if (ro.status === "paid" && new Date(ro.deliver_by) < now) { await beginRefund(tx, ro, { reason: "The seller didn't deliver in time", strike: true }); out.undeliveredRefunded++; }
    });
  }
  for (const r of (await db.query<any>("select id from resale_orders where status = 'refunding'")).rows) if ((await finishResaleRefund(r.id)) === "done") out.refundsResumed++;
  for (const r of (await db.query<any>("select id from resale_orders where status = 'delivered' and auto_release_at <= $1", [now])).rows) {
    await inTx(async (tx) => {
      const ro = (await tx.query<any>("select * from resale_orders where id = $1 for update", [r.id])).rows[0];
      if (ro.status === "delivered") { await releaseEscrow(tx, ro, "no problem reported — released automatically"); out.released++; }
    });
  }
  return out;
}

// ───────────────────────── Payouts & stats ─────────────────────────
export async function sellerBalance(c: Queryable, sellerId: string) {
  const r = (await c.query<any>(
    `select coalesce(sum(amount_cents) filter (where not released),0)::bigint as escrow,
            coalesce(sum(amount_cents) filter (where released and payout_id is null),0)::bigint as available,
            coalesce(sum(amount_cents) filter (where payout_id is not null),0)::bigint as paid
       from seller_ledger where seller_id = $1`, [sellerId])).rows[0];
  return { escrow: Number(r.escrow), available: Number(r.available), paidOut: Number(r.paid) };
}

export async function runSellerPayout(sellerId: string) {
  const created = await inTx(async (tx) => {
    const rows = (await tx.query<any>("select * from seller_ledger where seller_id = $1 and released and payout_id is null for update", [sellerId])).rows;
    const net = rows.reduce((a, r) => a + Number(r.amount_cents), 0);
    if (net <= 0) return null;
    const p = (await tx.query<any>("insert into seller_payouts(seller_id, net_cents, idempotency_key) values ($1,$2,$3) returning *", [sellerId, net, `sp:${sellerId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`])).rows[0];
    await tx.query("update seller_ledger set payout_id = $2 where id = any($1::bigint[])", [rows.map((r) => r.id), p.id]);
    return p;
  });
  if (!created) throw new DomainError("CONFLICT", "Nothing is available to withdraw yet — funds release after the buyer confirms (or automatically after the event).");
  const db = await getDb();
  const sp = await getSeller(db, sellerId);
  try {
    const t = await providerByName(process.env.STRIPE_SECRET_KEY ? "stripe" : "sandbox").transferToPartner({ stripeAccountId: sp?.stripe_account_id ?? null, amountCents: Number(created.net_cents), idempotencyKey: created.idempotency_key });
    await db.query("update seller_payouts set status = 'paid', provider_ref = $2, paid_at = now() where id = $1", [created.id, t.ref]);
    return { ...created, status: "paid" as const };
  } catch (e) {
    await inTx(async (tx) => { // put the funds back so a later attempt can retry
      await tx.query("update seller_ledger set payout_id = null where payout_id = $1", [created.id]);
      await tx.query("update seller_payouts set status = 'failed' where id = $1", [created.id]);
    });
    await db.query("insert into integration_events(integration, level, message) values ('payments','error',$1)", [`seller payout ${created.id} failed: ${e}`]);
    throw new DomainError("PROVIDER", "The payout couldn't be sent. Your funds are safe — please try again shortly.");
  }
}

export async function sellerStats(c: Queryable, sellerId: string) {
  const n = async (sql: string) => Number((await c.query<any>(sql, [sellerId])).rows[0].n);
  return {
    live: await n("select count(*)::int n from resale_listings where seller_id = $1 and status in ('active','sold_out','paused')"),
    toDeliver: await n("select count(*)::int n from resale_orders where seller_id = $1 and status = 'paid'"),
    completed: await n("select count(*)::int n from resale_orders where seller_id = $1 and status = 'completed'"),
    ...(await sellerBalance(c, sellerId)),
  };
}

// ───────────────────────── Buyer alerts ─────────────────────────
export async function createBuyerAlert(a: { buyerId: string; category?: string | null; venueId?: string | null; dateFrom?: string | null; dateTo?: string | null; maxUnitCents?: number | null; quantity?: number; note?: string }) {
  return inTx(async (tx) => {
    if (a.maxUnitCents != null && a.maxUnitCents <= 0) throw new DomainError("INVALID", "Maximum price must be positive");
    if (!a.category && !a.venueId) throw new DomainError("INVALID", "Choose a category or a venue to watch");
    const n = Number((await tx.query<any>("select count(*)::int n from buyer_alerts where buyer_id = $1 and status = 'active'", [a.buyerId])).rows[0].n);
    if (n >= 20) throw new DomainError("NOT_ELIGIBLE", "You can have up to 20 active alerts");
    const id = (await tx.query<any>(
      "insert into buyer_alerts(buyer_id, category, venue_id, date_from, date_to, max_unit_cents, quantity, note) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [a.buyerId, a.category || null, a.venueId || null, a.dateFrom || null, a.dateTo || null, a.maxUnitCents ?? null, a.quantity ?? 1, a.note?.slice(0, 200) ?? null])).rows[0].id;
    // Match against what's already listed so the buyer isn't told "nothing" when something exists.
    return id as string;
  });
}

/** Notifies buyers whose alert matches a newly-listed item (maximum price compares against the all-in unit price). */
export async function matchAlerts(tx: Tx, listingId: string) {
  const l = (await tx.query<any>("select l.*, v.name as venue_name, v.partner_id from resale_listings l join venues v on v.id = l.venue_id where l.id = $1", [listingId])).rows[0];
  const fee = await feeBook(tx, "customer", "peer_resale");
  const total = l.ask_unit_cents + fee(l.category, l.partner_id, l.ask_unit_cents);
  const alerts = (await tx.query<any>(
    `select * from buyer_alerts a where a.status = 'active' and a.buyer_id <> $1 and (a.category is null or a.category = $2) and (a.venue_id is null or a.venue_id = $3)
        and (a.date_from is null or (($4::timestamptz) at time zone 'Australia/Melbourne')::date >= a.date_from)
        and (a.date_to is null or (($4::timestamptz) at time zone 'Australia/Melbourne')::date <= a.date_to)
        and (a.max_unit_cents is null or a.max_unit_cents >= $5) and a.quantity <= $6`, [l.seller_id, l.category, l.venue_id, l.starts_at, total, l.quantity_total])).rows;
  for (const a of alerts) {
    await tx.query("update buyer_alerts set status = 'matched' where id = $1", [a.id]);
    await notify(tx, a.buyer_id, { kind: "alert_match", title: "Something you wanted just came up", body: `${l.title} at ${l.venue_name} — ${aud(total)} each all-in, ${fmtDateTime(l.starts_at)}.`, link: `/resale/${l.id}` });
  }
  return alerts.length;
}

export async function cancelBuyerAlert(buyerId: string, alertId: string) {
  const r = await (await getDb()).query("update buyer_alerts set status = 'cancelled' where id = $1 and buyer_id = $2 and status = 'active' returning id", [alertId, buyerId]);
  if (!r.rows[0]) throw new DomainError("NOT_FOUND", "Alert not found");
}
