"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionPartner, actionUser, clientIp } from "@/lib/auth/session";
import { getDb, inTx } from "@/lib/db";
import { addUnits, createListing, createVenue } from "@/lib/domain/catalog";
import { proposeBuyback } from "@/lib/domain/buyback";
import { issueManualRefund } from "@/lib/domain/booking";
import { setManualPrice, suggestPrice } from "@/lib/domain/pricing";
import { partnerReleaseToWaitlist } from "@/lib/domain/waitlist";
import { transition } from "@/lib/domain/inventory";
import { audit } from "@/lib/domain/audit";
import { DomainError } from "@/lib/errors";
import { melbToDate } from "@/lib/util";
import { checked, dollarsToCents, parse, run, type Result } from "./_util";

const id = z.string().uuid();
async function ownListing(listingId: string, partnerId: string) {
  const l = (await (await getDb()).query<any>("select * from listings where id = $1", [listingId])).rows[0];
  if (!l || l.partner_id !== partnerId) throw new DomainError("FORBIDDEN", "Not your listing");
  return l;
}
const money = (v: unknown, label: string) => { const c = dollarsToCents(v); if (!c || c <= 0) throw new DomainError("INVALID", `Enter a valid ${label}`); return c; };

export async function createVenueAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionPartner();
    const d = parse(z.object({
      name: z.string().min(2), address: z.string().min(3), suburb: z.string().min(2), city: z.string().default("Melbourne"),
      lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), description: z.string().max(1500).optional(),
      imageUrl: z.string().url().optional().or(z.literal("")), starRating: z.coerce.number().int().min(1).max(5).optional().or(z.literal("")), cuisine: z.string().optional(), amenities: z.string().optional(),
    }), fd);
    const cat = (await (await getDb()).query<any>("select category from partners where id = $1", [u.partnerId])).rows[0].category;
    await createVenue(await getDb(), { partnerId: u.partnerId, category: cat, name: d.name, address: d.address, suburb: d.suburb, city: d.city, lat: d.lat, lng: d.lng, description: d.description, imageUrl: d.imageUrl || undefined, starRating: d.starRating === "" ? null : d.starRating, cuisine: d.cuisine, amenities: d.amenities?.split(",").map((s) => s.trim()).filter(Boolean) });
    return "Venue added.";
  });
}

export async function createListingAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionPartner();
    const d = parse(z.object({
      venueId: id, title: z.string().min(3), subcategory: z.string().optional(), description: z.string().max(3000).optional(), imageUrl: z.string().url().optional().or(z.literal("")),
      startsAt: z.string().min(10), endsAt: z.string().min(10), bookingDeadline: z.string().min(10), units: z.coerce.number().int().min(1).max(500), maxPerBooking: z.coerce.number().int().min(1).max(10).default(4),
      cancellationPolicy: z.enum(["flexible", "moderate", "strict", "non_refundable"]), pricingMode: z.enum(["manual", "auto"]),
    }), fd);
    const listingId = await inTx((tx) => createListing(tx, {
      partnerId: u.partnerId, venueId: d.venueId, title: d.title, subcategory: d.subcategory, description: d.description, imageUrl: d.imageUrl || undefined,
      startsAt: melbToDate(d.startsAt), endsAt: melbToDate(d.endsAt), bookingDeadline: melbToDate(d.bookingDeadline),
      originalCents: money(fd.get("original"), "original price"), minCents: money(fd.get("min"), "minimum price"), maxCents: money(fd.get("max"), "maximum price"), priceCents: money(fd.get("price"), "selling price"),
      units: d.units, maxPerBooking: d.maxPerBooking, cancellationPolicy: d.cancellationPolicy, pricingMode: d.pricingMode,
      buybackEligible: checked(fd, "buybackEligible"), status: checked(fd, "publish") ? "published" : "draft",
    }, { id: u.id, role: "partner" }));
    redirect(`/partner/inventory/${listingId}`);
  });
}

export async function updateListingAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionPartner();
    const d = parse(z.object({ listingId: id, title: z.string().min(3), description: z.string().max(3000).optional(), imageUrl: z.string().url().optional().or(z.literal("")), cancellationPolicy: z.enum(["flexible", "moderate", "strict", "non_refundable"]), bookingDeadline: z.string().min(10) }), fd);
    const l = await ownListing(d.listingId, u.partnerId);
    const min = money(fd.get("min"), "minimum price"), max = money(fd.get("max"), "maximum price");
    if (min > max) throw new DomainError("INVALID", "Minimum must not exceed maximum");
    const cur = Math.min(max, Math.max(min, l.current_price_cents));
    await (await getDb()).query(
      `update listings set title = $2, description = $3, image_url = $4, cancellation_policy = $5, booking_deadline = $6, min_price_cents = $7, max_price_cents = $8, current_price_cents = $9, buyback_eligible = $10, updated_at = now() where id = $1`,
      [l.id, d.title, d.description || null, d.imageUrl || null, d.cancellationPolicy, melbToDate(d.bookingDeadline), min, max, cur, checked(fd, "buybackEligible")]);
    await audit(await getDb(), { id: u.id, role: "partner" }, "listing.updated", "listing", l.id);
    return "Listing updated.";
  });
}

export async function listingStatusAction(fd: FormData) {
  const u = await actionPartner();
  const d = parse(z.object({ listingId: id, status: z.enum(["published", "paused", "draft", "closed"]) }), fd);
  await ownListing(d.listingId, u.partnerId);
  await (await getDb()).query("update listings set status = $2, updated_at = now() where id = $1", [d.listingId, d.status]);
}

export async function addUnitsAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionPartner();
    const d = parse(z.object({ listingId: id, count: z.coerce.number().int().min(1).max(100) }), fd);
    const l = await ownListing(d.listingId, u.partnerId);
    await addUnits(await getDb(), l.id, u.partnerId, d.count, l.category === "hotel" ? "Room" : l.category === "restaurant" ? "Table" : "Ticket");
    await audit(await getDb(), { id: u.id, role: "partner" }, "inventory.added", "listing", l.id, { count: d.count });
    return `${d.count} unit(s) added.`;
  });
}

export async function setPriceAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionPartner();
    const d = parse(z.object({ listingId: id }), fd);
    await ownListing(d.listingId, u.partnerId);
    await setManualPrice(await getDb(), d.listingId, money(fd.get("price"), "price"));
    await audit(await getDb(), { id: u.id, role: "partner" }, "price.override", "listing", d.listingId);
    return "Price set — automatic pricing is off for this listing.";
  });
}

export async function applySuggestionAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionPartner();
    const d = parse(z.object({ listingId: id }), fd);
    await ownListing(d.listingId, u.partnerId);
    const db = await getDb();
    const s = await suggestPrice(db, d.listingId);
    await db.query("update listings set current_price_cents = $2, updated_at = now() where id = $1", [d.listingId, s.suggestedCents]);
    await db.query("insert into price_history(listing_id, price_cents, source, detail) values ($1,$2,'partner',$3::jsonb)", [d.listingId, s.suggestedCents, JSON.stringify({ applied: "suggestion", adjustments: s.adjustments })]);
    return "Suggested price applied.";
  });
}

export async function setPricingModeAction(fd: FormData) {
  const u = await actionPartner();
  const d = parse(z.object({ listingId: id, mode: z.enum(["auto", "manual"]) }), fd);
  await ownListing(d.listingId, u.partnerId);
  await (await getDb()).query("update listings set pricing_mode = $2, updated_at = now() where id = $1", [d.listingId, d.mode]);
}

export async function releaseToWaitlistAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionPartner();
    const d = parse(z.object({ unitId: id }), fd);
    const offer = await partnerReleaseToWaitlist({ partnerId: u.partnerId, unitId: d.unitId, actor: { id: u.id, role: "partner" }, priceCents: dollarsToCents(fd.get("price")) ?? undefined });
    return offer ? "Offered to the next person on the waitlist." : "Nobody on the waitlist could meet that price — the unit is back on sale.";
  });
}

export async function relistUnitAction(fd: FormData) {
  const u = await actionPartner();
  const unitId = id.parse(fd.get("unitId"));
  await inTx(async (tx) => {
    const unit = (await tx.query<any>("select * from inventory_units where id = $1", [unitId])).rows[0];
    if (!unit || unit.partner_id !== u.partnerId) throw new DomainError("FORBIDDEN", "Not your inventory");
    if (unit.status === "cancelled") await transition(tx, unitId, "released", { actor: u.id, reason: "relisted by partner" });
    await transition(tx, unitId, "available", { actor: u.id, reason: "relisted by partner" });
  });
}

export async function withdrawUnitAction(fd: FormData) {
  const u = await actionPartner();
  const unitId = id.parse(fd.get("unitId"));
  await inTx(async (tx) => {
    const unit = (await tx.query<any>("select * from inventory_units where id = $1", [unitId])).rows[0];
    if (!unit || unit.partner_id !== u.partnerId) throw new DomainError("FORBIDDEN", "Not your inventory");
    await transition(tx, unitId, "cancelled", { actor: u.id, reason: "withdrawn by partner", expectFrom: ["available"] });
  });
}

export async function updateBuybackRulesAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("partner:buyback");
    if (!u.partnerId) throw new DomainError("FORBIDDEN", "No partner profile");
    const d = parse(z.object({
      minComp: z.coerce.number().min(0).max(100), maxComp: z.coerce.number().min(0).max(100), minNotice: z.coerce.number().int().min(0).max(720),
      offerWindow: z.coerce.number().int().min(5).max(1440), policy: z.enum(["first_come", "highest_offer"]),
    }), fd);
    if (d.minComp > d.maxComp) throw new DomainError("INVALID", "Minimum compensation can't exceed the maximum");
    await (await getDb()).query(
      `update partners set buyback_enabled = $2, buyback_min_comp_bps = $3, buyback_max_comp_bps = $4, buyback_approval_threshold_cents = $5, buyback_min_notice_hours = $6, offer_window_minutes = $7, waitlist_policy = $8, updated_at = now() where id = $1`,
      [u.partnerId, checked(fd, "enabled"), Math.round(d.minComp * 100), Math.round(d.maxComp * 100), money(fd.get("threshold"), "approval threshold"), d.minNotice, d.offerWindow, d.policy]);
    await audit(await getDb(), { id: u.id, role: "partner" }, "partner.buyback_rules", "partner", u.partnerId);
    return "Buyback and waitlist rules saved.";
  });
}

export async function proposeBuybackAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("partner:buyback");
    if (!u.partnerId || u.partnerStatus !== "approved") throw new DomainError("FORBIDDEN", "Partner account not approved");
    const d = parse(z.object({ reservationId: id, note: z.string().max(400).optional() }), fd);
    const r = await proposeBuyback({ partnerId: u.partnerId, actor: { id: u.id, role: "partner", ip: await clientIp() }, reservationId: d.reservationId, compensationCents: money(fd.get("compensation"), "compensation"), resalePriceCents: money(fd.get("resalePrice"), "resale price"), note: d.note });
    return r.status === "pending_admin" ? "Proposal submitted — it needs administrator approval before the customer sees it." : "Offer sent to the customer. Their booking is unchanged unless they accept.";
  });
}

export async function partnerRefundAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionPartner();
    const d = parse(z.object({ reservationId: id, reason: z.string().min(5), key: z.string().min(8) }), fd);
    await issueManualRefund({ reservationId: d.reservationId, amountCents: money(fd.get("amount"), "amount"), reason: d.reason, actor: { id: u.id, role: "partner" }, partnerId: u.partnerId, idempotencyKey: d.key });
    return "Refund issued to the customer.";
  });
}

export async function uploadDocAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("partner:portal");
    if (!u.partnerId) throw new DomainError("FORBIDDEN", "No partner profile");
    const f = fd.get("doc");
    const type = z.enum(["abn_certificate", "business_licence", "liquor_licence", "insurance", "id_document", "other"]).parse(fd.get("docType"));
    if (!(f instanceof File) || f.size === 0) throw new DomainError("INVALID", "Choose a file");
    if (f.size > 5 * 1024 * 1024) throw new DomainError("INVALID", "Files must be under 5 MB");
    if (!["application/pdf", "image/png", "image/jpeg"].includes(f.type)) throw new DomainError("INVALID", "PDF, PNG or JPEG only");
    await (await getDb()).query("insert into partner_verifications(partner_id, doc_type, file_name, mime_type, size_bytes, content) values ($1,$2,$3,$4,$5,$6)", [u.partnerId, type, f.name.slice(0, 120), f.type, f.size, Buffer.from(await f.arrayBuffer())]);
    return "Document uploaded for review.";
  });
}
