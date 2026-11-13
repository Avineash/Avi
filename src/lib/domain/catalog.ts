import type { Queryable, Tx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { audit, type Actor } from "./audit";

export interface VenueInput {
  partnerId: string; name: string; category: "hotel" | "restaurant" | "event"; address: string; suburb: string; city?: string;
  lat: number; lng: number; description?: string; imageUrl?: string; starRating?: number | null; cuisine?: string | null; amenities?: string[];
}
export async function createVenue(tx: Queryable, v: VenueInput) {
  const r = await tx.query<any>(
    `insert into venues(partner_id, name, category, address, suburb, city, lat, lng, description, image_url, star_rating, cuisine, amenities)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [v.partnerId, v.name, v.category, v.address, v.suburb, v.city ?? "Melbourne", v.lat, v.lng, v.description ?? null, v.imageUrl ?? null, v.starRating ?? null, v.cuisine ?? null, v.amenities ?? []]);
  return r.rows[0].id as string;
}

export interface ListingInput {
  partnerId: string; venueId: string; title: string; subcategory?: string; description?: string; imageUrl?: string;
  startsAt: Date; endsAt: Date; bookingDeadline: Date; originalCents: number; minCents: number; maxCents: number; priceCents: number;
  pricingMode?: "manual" | "auto"; cancellationPolicy?: string; buybackEligible?: boolean; units: number; unitPrefix?: string;
  meta?: Record<string, unknown>; maxPerBooking?: number; status?: "draft" | "published"; featured?: boolean; isDemo?: boolean;
}

export async function createListing(tx: Tx, i: ListingInput, actor: Actor | null = null) {
  const v = (await tx.query<any>("select category, partner_id from venues where id = $1", [i.venueId])).rows[0];
  if (!v || v.partner_id !== i.partnerId) throw new DomainError("FORBIDDEN", "Venue does not belong to this partner");
  if (!(i.minCents > 0 && i.minCents <= i.priceCents && i.priceCents <= i.maxCents)) throw new DomainError("INVALID", "Prices must satisfy: minimum ≤ selling price ≤ maximum");
  if (i.units < 1 || i.units > 500) throw new DomainError("INVALID", "Inventory must be between 1 and 500 units");
  if (i.endsAt <= i.startsAt) throw new DomainError("INVALID", "End must be after start");
  if (i.bookingDeadline > i.endsAt) throw new DomainError("INVALID", "Booking deadline must be before the end");
  const l = (await tx.query<any>(
    `insert into listings(venue_id, partner_id, category, title, subcategory, description, image_url, starts_at, ends_at, booking_deadline, original_price_cents,
        min_price_cents, max_price_cents, current_price_cents, pricing_mode, cancellation_policy, buyback_eligible, max_per_booking, meta, status, featured, is_demo)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22) returning id`,
    [i.venueId, i.partnerId, v.category, i.title, i.subcategory ?? null, i.description ?? null, i.imageUrl ?? null, i.startsAt, i.endsAt, i.bookingDeadline, i.originalCents,
     i.minCents, i.maxCents, i.priceCents, i.pricingMode ?? "manual", i.cancellationPolicy ?? "flexible", i.buybackEligible ?? false, i.maxPerBooking ?? 4,
     JSON.stringify(i.meta ?? {}), i.status ?? "published", i.featured ?? false, i.isDemo ?? false])).rows[0];
  await addUnits(tx, l.id, i.partnerId, i.units, i.unitPrefix ?? (v.category === "hotel" ? "Room" : v.category === "restaurant" ? "Table" : "Ticket"));
  await tx.query("insert into price_history(listing_id, price_cents, source) values ($1,$2,'create')", [l.id, i.priceCents]);
  if (actor) await audit(tx, actor, "listing.created", "listing", l.id, { title: i.title, units: i.units });
  return l.id as string;
}

export async function addUnits(tx: Queryable, listingId: string, partnerId: string, count: number, prefix: string) {
  const start = Number((await tx.query<any>("select count(*)::int n from inventory_units where listing_id = $1", [listingId])).rows[0].n);
  for (let n = 1; n <= count; n++) {
    const label = `${prefix} ${String(start + n).padStart(2, "0")}`;
    const u = (await tx.query<any>("insert into inventory_units(listing_id, partner_id, label) values ($1,$2,$3) returning id", [listingId, partnerId, label])).rows[0];
    await tx.query("insert into inventory_events(unit_id, from_status, to_status, reason) values ($1,null,'available','unit created')", [u.id]);
  }
}
