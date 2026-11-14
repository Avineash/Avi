import bcrypt from "bcryptjs";
import { getDb, inTx } from "@/lib/db";
import { createListing, createVenue } from "@/lib/domain/catalog";
import { setSetting } from "@/lib/domain/settings";
import { isValidAbn } from "@/lib/domain/partners";
import { createCheckout, sandboxPay, completePastReservations } from "@/lib/domain/booking";
import { joinWaitlist } from "@/lib/domain/waitlist";
import { submitReview } from "@/lib/domain/finance";
import { repriceAuto } from "@/lib/domain/pricing";
import { hours, melbDay, melbToDate } from "@/lib/util";

export const DEMO_PASSWORD = "Password123!";

export function abnFor(n: number): string {
  for (let prefix = 10 + (n % 80); prefix < 100; prefix++) {
    const body = String(100_000_000 + n * 7919).slice(0, 9);
    const abn = `${prefix}${body}`;
    if (isValidAbn(abn)) return abn;
  }
  return "51824753556";
}
/** Next Melbourne wall-clock hh:mm at or after now + offsetH (so listings look like real check-ins / seatings / sessions). */
export function snap(offsetH: number, hh: number, mm = 0): Date {
  const base = new Date(Date.now() + hours(offsetH));
  const at = (d: Date) => melbToDate(`${melbDay(d)}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  let d = at(base);
  if (d.getTime() < base.getTime()) d = at(new Date(base.getTime() + hours(24)));
  return d;
}
const nextDay = (d: Date, hh: number) => melbToDate(`${melbDay(new Date(d.getTime() + hours(24)))}T${String(hh).padStart(2, "0")}:00`);
export const art = (slug: string, kind: string) => `/api/art/${slug}?kind=${kind}`;
const pick = <T,>(a: T[], i: number) => a[i % a.length];

export interface HotelSpec { name: string; suburb: string; address: string; lat: number; lng: number; stars: number; blurb: string; amenities: string[]; rooms: Array<{ name: string; orig: number; beds: string; sqm: number; sleeps: number }> }
export interface RestSpec { name: string; suburb: string; address: string; lat: number; lng: number; cuisine: string; blurb: string; amenities: string[]; offers: Array<{ name: string; orig: number; menu: string }> }
export interface EventSpec { name: string; suburb: string; address: string; lat: number; lng: number; blurb: string; amenities: string[]; sessions: Array<{ name: string; orig: number; hours: number; kind: string }>; policy: string }

export const HOTELS_A: HotelSpec[] = [
  { name: "The Laneway Hotel", suburb: "Melbourne CBD", address: "112 Flinders Lane", lat: -37.8167, lng: 144.9667, stars: 4, blurb: "A design-led hotel above the laneway cafés, with a candle-lit rooftop bar and the city's best breakfast just downstairs.", amenities: ["Rooftop bar", "Fitness studio", "Free Wi-Fi", "24h concierge", "Pet friendly"],
    rooms: [{ name: "Deluxe King", orig: 32000, beds: "1 King", sqm: 28, sleeps: 2 }, { name: "Laneway Studio Suite", orig: 46000, beds: "1 King + sofa bed", sqm: 42, sleeps: 3 }] },
  { name: "Southbank Riverside Suites", suburb: "Southbank", address: "8 Southgate Avenue", lat: -37.8226, lng: 144.9644, stars: 5, blurb: "Floor-to-ceiling views of the Yarra and the skyline, steps from the NGV, Arts Centre and Crown Promenade.", amenities: ["Infinity pool", "Spa", "River views", "Kitchenette", "Valet parking"],
    rooms: [{ name: "River View King", orig: 52000, beds: "1 King", sqm: 36, sleeps: 2 }, { name: "Executive Suite", orig: 78000, beds: "1 King + lounge", sqm: 64, sleeps: 4 }] },
];
export const HOTELS_B: HotelSpec[] = [
  { name: "St Kilda Esplanade Boutique", suburb: "St Kilda", address: "54 The Esplanade", lat: -37.8676, lng: 144.9747, stars: 4, blurb: "Salt-air mornings, a bay-view terrace and the St Kilda foreshore on your doorstep.", amenities: ["Bay views", "Terrace bar", "Bike hire", "Free Wi-Fi"],
    rooms: [{ name: "Bayview Queen", orig: 29000, beds: "1 Queen", sqm: 24, sleeps: 2 }, { name: "Garden Courtyard Room", orig: 24000, beds: "1 Queen", sqm: 22, sleeps: 2 }] },
  { name: "Fitzroy Press House", suburb: "Fitzroy", address: "27 Brunswick Street", lat: -37.7993, lng: 144.9788, stars: 4, blurb: "A restored printing house turned boutique stay, surrounded by Fitzroy's galleries, bars and vintage shops.", amenities: ["Lobby café", "Free Wi-Fi", "Record players in rooms", "Bike hire"],
    rooms: [{ name: "Printer's Loft", orig: 34000, beds: "1 King", sqm: 32, sleeps: 2 }, { name: "Studio King", orig: 26000, beds: "1 King", sqm: 25, sleeps: 2 }] },
  { name: "Yarra Terrace Hotel", suburb: "South Yarra", address: "300 Toorak Road", lat: -37.8386, lng: 144.993, stars: 4, blurb: "Quietly luxurious rooms between the Botanic Gardens and Chapel Street's boutiques.", amenities: ["Heated pool", "Gym", "Free Wi-Fi", "Room service"],
    rooms: [{ name: "Garden King", orig: 31000, beds: "1 King", sqm: 30, sleeps: 2 }, { name: "Twin Deluxe", orig: 28000, beds: "2 Singles", sqm: 28, sleeps: 2 }] },
];
export const RESTAURANTS: RestSpec[] = [
  { name: "Saffron & Smoke", suburb: "Fitzroy", address: "91 Gertrude Street", lat: -37.7989, lng: 144.9782, cuisine: "Modern Indian", blurb: "Wood-fire cooking, hand-ground spices and a tasting menu that rewards the curious.", amenities: ["Wine pairing", "Vegetarian friendly", "Chef's counter"], offers: [{ name: "Chef's Tasting Menu for two", orig: 32000, menu: "7 courses" }, { name: "Sunday Feast for two", orig: 24000, menu: "Shared banquet" }] },
  { name: "Osteria Piccolo", suburb: "Carlton", address: "212 Lygon Street", lat: -37.7995, lng: 144.9667, cuisine: "Italian", blurb: "Hand-rolled pasta and Piedmontese wines in a candle-lit Lygon Street room.", amenities: ["Wine list", "Pre-theatre menu", "Private dining"], offers: [{ name: "Pasta Degustazione for two", orig: 18000, menu: "5 courses" }, { name: "Pre-theatre Set Menu for two", orig: 12000, menu: "3 courses" }] },
  { name: "Aster Laneway Dining", suburb: "Melbourne CBD", address: "15 Centre Place", lat: -37.8139, lng: 144.969, cuisine: "Contemporary Australian", blurb: "Native ingredients, a vertical wine cellar and a six-seat chef's bar hidden in the lanes.", amenities: ["Chef's bar", "Native ingredients", "Sommelier"], offers: [{ name: "Chef's Table Experience for two", orig: 44000, menu: "9 courses + pairing" }, { name: "Laneway Lunch for two", orig: 14000, menu: "3 courses" }] },
  { name: "Kōji Counter", suburb: "Richmond", address: "6 Bridge Road", lat: -37.824, lng: 144.9985, cuisine: "Japanese omakase", blurb: "Twelve seats, one chef and the freshest seasonal fish in Melbourne.", amenities: ["Omakase", "Sake pairing", "Counter seating"], offers: [{ name: "Omakase for two", orig: 56000, menu: "14 pieces + dessert" }] },
  { name: "The Bluestone Table", suburb: "Brunswick", address: "340 Sydney Road", lat: -37.7660, lng: 144.9611, cuisine: "Wine bar & shared plates", blurb: "A converted bluestone warehouse with long communal tables and a list of 200 local wines.", amenities: ["Natural wine", "Communal tables", "Live jazz Thursdays"], offers: [{ name: "Shared Plates Feast for two", orig: 15000, menu: "6 plates + dessert" }] },
];
export const EVENTS: EventSpec[] = [
  { name: "Rooftop Cinema Night", suburb: "Melbourne CBD", address: "252 Swanston Street (rooftop)", lat: -37.815, lng: 144.966, blurb: "Classic films under the stars with the city skyline as your backdrop. Blankets and headphones provided.", amenities: ["Bar & street food", "Blankets provided", "Silent-disco headphones"], policy: "flexible", sessions: [{ name: "Casablanca (35mm)", orig: 4200, hours: 8, kind: "Film screening" }, { name: "Spirited Away", orig: 3800, hours: 56, kind: "Film screening" }] },
  { name: "Yarra Valley Sunset Wine Tour", suburb: "Healesville", address: "Depart Federation Square", lat: -37.656, lng: 145.519, blurb: "A small-group afternoon through three cellar doors with a private driver and a cheese board at sunset.", amenities: ["Return transfer from the city", "Three cellar doors", "Cheese board"], policy: "moderate", sessions: [{ name: "Sunset cellar-door tour", orig: 16500, hours: 30, kind: "Tour" }] },
  { name: "Comedy Cellar Live", suburb: "Fitzroy", address: "45 Johnston Street", lat: -37.801, lng: 144.978, blurb: "Four of the country's sharpest stand-ups in a basement bar built for belly laughs.", amenities: ["Bar", "Late licence", "General admission"], policy: "non_refundable", sessions: [{ name: "Friday night showcase", orig: 5500, hours: 20, kind: "Live comedy" }, { name: "Saturday late show", orig: 6000, hours: 44, kind: "Live comedy" }] },
  { name: "Hidden Laneways Food Walk", suburb: "Melbourne CBD", address: "Meet at Degraves Street", lat: -37.8136, lng: 144.9631, blurb: "Eight tastings, five laneways and a local guide who knows which doors to knock on.", amenities: ["Eight tastings", "Local guide", "Dietary options"], policy: "flexible", sessions: [{ name: "Twilight food crawl", orig: 9500, hours: 12, kind: "Food tour" }] },
  { name: "Docklands Harbour Sunset Cruise", suburb: "Docklands", address: "Victoria Harbour Promenade", lat: -37.8143, lng: 144.946, blurb: "Two hours on the water with canapés, local sparkling and the city lighting up behind you.", amenities: ["Canapés", "Sparkling on arrival", "Covered deck"], policy: "moderate", sessions: [{ name: "Sunset cruise", orig: 8900, hours: 36, kind: "Cruise" }] },
];

export async function seedDemo() {
  const db = await getDb();
  const pw = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = async (email: string, name: string, role: "customer" | "partner" | "admin", extra: { phone?: string } = {}) =>
    (await db.query<any>("insert into users(email, name, role, password_hash, is_demo, email_verified_at, phone) values ($1,$2,$3,$4,true,now(),$5) returning id", [email, name, role, pw, extra.phone ?? null])).rows[0].id as string;

  // ── Platform configuration for the sandbox demo ──
  const admin = await user("admin@eleventhhour.test", "Morgan Admin", "admin");
  await setSetting(db, "features.buyback", { enabled: true, legal_review_ref: "SANDBOX-DEMO — NOT A LEGAL APPROVAL", approved_by: admin, approved_at: new Date().toISOString() }, admin);
  await setSetting(db, "features.event_resale", { enabled: true, legal_review_ref: "SANDBOX-DEMO — NOT A LEGAL APPROVAL", cap_bps: 11000 }, admin);

  // ── People ──
  const ava = await user("ava@eleventhhour.test", "Ava Thompson", "customer", { phone: "+61400000001" });
  const ben = await user("ben@eleventhhour.test", "Ben Nguyen", "customer");
  const chloe = await user("chloe@eleventhhour.test", "Chloe Martin", "customer");
  const dev = await user("dev@eleventhhour.test", "Dev Patel", "customer");
  const customers = [ava, ben, chloe, dev];

  const mkPartner = async (n: number, email: string, owner: string, business: string, category: string, o: { status?: string; buyback?: boolean; policy?: string; gst?: boolean; docs?: boolean } = {}) => {
    const uid = await user(email, owner, "partner");
    const p = (await db.query<any>(
      `insert into partners(owner_user_id, business_name, abn, category, status, gst_registered, contact_email, buyback_enabled, waitlist_policy, is_demo, approved_at, approved_by, payouts_enabled, description)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,true,$12) returning id`,
      [uid, business, abnFor(n), category, o.status ?? "approved", o.gst ?? true, email, o.buyback ?? false, o.policy ?? "first_come", (o.status ?? "approved") === "approved" ? new Date() : null, (o.status ?? "approved") === "approved" ? admin : null,
       `${business} — sample partner for the sandbox demo.`])).rows[0].id as string;
    if (o.docs !== false) {
      await db.query("insert into partner_verifications(partner_id, doc_type, file_name, mime_type, size_bytes, status, reviewer_id, reviewed_at) values ($1,'abn_certificate','abn-certificate.pdf','application/pdf',48211,$2,$3,$4)",
        [p, (o.status ?? "approved") === "approved" ? "approved" : "submitted", (o.status ?? "approved") === "approved" ? admin : null, (o.status ?? "approved") === "approved" ? new Date() : null]);
    }
    return { userId: uid, partnerId: p };
  };

  const laneway = await mkPartner(1, "hotel@eleventhhour.test", "Priya Sharma", "Laneway Hotels Pty Ltd", "hotel", { buyback: true });
  const esplanade = await mkPartner(2, "esplanade@eleventhhour.test", "Tom Rossi", "Esplanade Collection Pty Ltd", "hotel", { buyback: false });
  const dining = await mkPartner(3, "restaurant@eleventhhour.test", "Elena Costa", "Hearth & Table Group", "restaurant", { policy: "highest_offer" });
  const events = await mkPartner(4, "events@eleventhhour.test", "Jack Wilson", "Southbank Live Events Pty Ltd", "event", { buyback: true });
  const harbour = await mkPartner(5, "harbour@eleventhhour.test", "Sam Lee", "Docklands Harbour Hotel Pty Ltd", "hotel", { status: "pending" });
  await createVenue(db, { partnerId: harbour.partnerId, name: "Docklands Harbour Hotel", category: "hotel", address: "2 Harbour Esplanade", suburb: "Docklands", lat: -37.814, lng: 144.9462, description: "Awaiting verification.", imageUrl: art("docklands-harbour", "hotel"), starRating: 4 });

  // ── Catalogue ──
  const listings: Record<string, string> = {};
  const mkHotelListings = async (pt: { partnerId: string }, specs: HotelSpec[], buyback: boolean, startIdx: number) => {
    let idx = startIdx;
    for (const h of specs) {
      const venueId = await createVenue(db, { partnerId: pt.partnerId, name: h.name, category: "hotel", address: h.address, suburb: h.suburb, lat: h.lat, lng: h.lng, description: h.blurb, imageUrl: art(h.name.toLowerCase().replace(/\W+/g, "-"), "hotel"), starRating: h.stars, amenities: h.amenities });
      for (const room of h.rooms) {
        for (const [k, off] of [5, 29, 53].entries()) {
          const orig = room.orig, disc = [0.62, 0.72, 0.8][k] + (idx % 3) * 0.02;
          const price = Math.round((orig * disc) / 100) * 100;
          const key = `${h.name}|${room.name}|${k}`;
          const checkIn = snap(off, 14);
          listings[key] = await inTx((tx) => createListing(tx, {
            partnerId: pt.partnerId, venueId, title: room.name, subcategory: `${room.beds} · ${room.sqm} m² · sleeps ${room.sleeps}`,
            description: `${room.name} at ${h.name}. ${h.blurb} One night, check-in from 2pm, check-out 11am.`,
            imageUrl: art(`${h.name}-${room.name}`.toLowerCase().replace(/\W+/g, "-"), "hotel"),
            startsAt: checkIn, endsAt: nextDay(checkIn, 11), bookingDeadline: new Date(checkIn.getTime() + hours(8)),
            originalCents: orig, minCents: Math.round(orig * 0.5 / 100) * 100, maxCents: Math.round(orig * 1.2 / 100) * 100, priceCents: price,
            pricingMode: idx % 2 === 0 ? "auto" : "manual", cancellationPolicy: k === 0 ? "moderate" : "flexible", buybackEligible: buyback,
            units: 2 + ((idx + k) % 3), maxPerBooking: 2, meta: { beds: room.beds, sqm: room.sqm, sleeps: room.sleeps, checkIn: "14:00", checkOut: "11:00" },
            featured: idx === 1 && k === 0, isDemo: true,
          }));
          idx++;
        }
      }
    }
  };
  await mkHotelListings(laneway, HOTELS_A, true, 0);
  await mkHotelListings(esplanade, HOTELS_B, false, 3);

  for (const [i, r] of RESTAURANTS.entries()) {
    const venueId = await createVenue(db, { partnerId: dining.partnerId, name: r.name, category: "restaurant", address: r.address, suburb: r.suburb, lat: r.lat, lng: r.lng, description: r.blurb, imageUrl: art(r.name.toLowerCase().replace(/\W+/g, "-"), "restaurant"), cuisine: r.cuisine, amenities: r.amenities });
    for (const [j, o] of r.offers.entries()) {
      for (const [k, off] of [4, 27, 51].entries()) {
        const price = Math.round((o.orig * [0.72, 0.78, 0.85][k]) / 100) * 100;
        const seating = snap(off, j === 0 ? 19 : 18, j === 0 ? 30 : 0);
        listings[`${r.name}|${o.name}|${k}`] = await inTx((tx) => createListing(tx, {
          partnerId: dining.partnerId, venueId, title: o.name, subcategory: `${r.cuisine} · ${o.menu}`,
          description: `${o.name} at ${r.name}: ${o.menu}. Prepaid, so your table is guaranteed. ${r.blurb}`,
          imageUrl: art(`${r.name}-${o.name}`.toLowerCase().replace(/\W+/g, "-"), "restaurant"),
          startsAt: seating, endsAt: new Date(seating.getTime() + hours(3)), bookingDeadline: new Date(seating.getTime() - hours(1)),
          originalCents: o.orig, minCents: Math.round(o.orig * 0.5 / 100) * 100, maxCents: Math.round(o.orig * 1.15 / 100) * 100, priceCents: price,
          pricingMode: (i + j + k) % 2 === 0 ? "auto" : "manual", cancellationPolicy: "moderate", buybackEligible: false,
          units: k === 0 && j === 0 ? 2 : 3 + ((i + k) % 4), maxPerBooking: 2, unitPrefix: "Table", meta: { partySize: 2, menu: o.menu, cuisine: r.cuisine, deposit: "Prepaid in full" }, featured: i === 0 && k === 0, isDemo: true,
        }));
      }
    }
  }

  for (const [i, e] of EVENTS.entries()) {
    const venueId = await createVenue(db, { partnerId: events.partnerId, name: e.name, category: "event", address: e.address, suburb: e.suburb, city: "Melbourne", lat: e.lat, lng: e.lng, description: e.blurb, imageUrl: art(e.name.toLowerCase().replace(/\W+/g, "-"), "event"), amenities: e.amenities });
    for (const [j, s] of e.sessions.entries()) {
      const price = Math.round((s.orig * (0.7 + 0.05 * ((i + j) % 4))) / 100) * 100;
      const session = snap(s.hours, e.name.includes("Wine") || e.name.includes("Food") ? 16 : 19, 30);
      listings[`${e.name}|${s.name}`] = await inTx((tx) => createListing(tx, {
        partnerId: events.partnerId, venueId, title: `${e.name} — ${s.name}`, subcategory: s.kind,
        description: e.blurb, imageUrl: art(`${e.name}-${s.name}`.toLowerCase().replace(/\W+/g, "-"), "event"),
        startsAt: session, endsAt: new Date(session.getTime() + hours(3)), bookingDeadline: new Date(session.getTime() - hours(1)),
        originalCents: s.orig, minCents: Math.round(s.orig * 0.5 / 100) * 100, maxCents: Math.round(s.orig * 1.1 / 100) * 100, priceCents: price,
        pricingMode: i % 2 === 0 ? "auto" : "manual", cancellationPolicy: e.policy, buybackEligible: i === 0,
        units: i === 0 ? 6 : 14 + i * 3, maxPerBooking: 6, unitPrefix: "Ticket", meta: { ageRestriction: "18+", category: s.kind, faceValueCents: s.orig, ticketType: "General admission" }, featured: i === 1, isDemo: true,
      }));
    }
  }

  // ── History: completed stays/dinners/events so reviews, ratings and analytics have real substance ──
  const hist = Object.entries(listings).filter(([k]) => k.endsWith("|2")).slice(0, 14);
  for (const [n, [, id]] of hist.entries()) {
    const c = customers[n % customers.length];
    const { orderId } = await createCheckout({ customerId: c, listingId: id, quantity: 1, guests: 2, guestName: "Demo guest", guestEmail: "guest@eleventhhour.test", buybackConsent: false, idempotencyKey: `seed-hist-${n}` });
    await sandboxPay({ orderId, customerId: c, cardNumber: "4242424242424242" });
    const daysAgo = 2 + ((n * 5) % 26);
    await db.query(`update listings set starts_at = now() - ($2 || ' days')::interval, ends_at = now() - ($2 || ' days')::interval + interval '21 hours', booking_deadline = now() - ($2 || ' days')::interval - interval '1 hour' where id = $1`, [id, String(daysAgo)]);
    const back = "now() - ($2 || ' days')::interval - interval '2 days'";
    const d = String(daysAgo);
    await db.query(`update orders set created_at = ${back} where id = $1`, [orderId, d]);
    await db.query(`update reservations set created_at = ${back} where order_id = $1`, [orderId, d]);
    await db.query(`update payments set created_at = ${back} where order_id = $1`, [orderId, d]);
    await db.query(`update platform_fees set created_at = ${back} where order_id = $1`, [orderId, d]);
    await db.query(`update ledger_entries set created_at = ${back} where reservation_id in (select id from reservations where order_id = $1)`, [orderId, d]);
    await inTx((tx) => completePastReservations(tx));
    const r = (await db.query<any>("select id from reservations where order_id = $1", [orderId])).rows[0];
    await submitReview({ customerId: c, reservationId: r.id, rating: pick([5, 5, 4, 5, 4, 3, 5], n), comment: pick(["Wonderful — felt like a steal for the quality.", "Smooth booking, lovely staff. Would book again.", "Great value for a last-minute find.", "Beautiful room and quick check-in.", "Excellent, exactly as described."], n) });
  }

  // ── Live activity ──
  const book = async (c: string, key: string, listing: string, o: { qty?: number; consent?: boolean } = {}) => {
    const { orderId } = await createCheckout({ customerId: c, listingId: listing, quantity: o.qty ?? 1, guests: 2, guestName: "Demo guest", guestEmail: "guest@eleventhhour.test", buybackConsent: o.consent ?? false, idempotencyKey: `seed-${key}` });
    await sandboxPay({ orderId, customerId: c, cardNumber: "4242424242424242" });
    return orderId;
  };
  const soldOut = async (listing: string, byCustomers: string[]) => {
    const total = Number((await db.query<any>("select count(*)::int n from inventory_units where listing_id = $1", [listing])).rows[0].n);
    for (let i = 0; i < total; i++) await book(byCustomers[i % byCustomers.length], `so-${listing}-${i}`, listing);
  };

  // THE worked example from the brief: one room at AUD 180, Ava books it (opted in to buyback offers), Ben waitlists with a $300 maximum.
  const exampleKey = "The Laneway Hotel|Deluxe King|1"; // tomorrow's check-in: well inside the buyback notice window
  const exId = listings[exampleKey];
  await db.query("update listings set current_price_cents = 18000, pricing_mode = 'manual', max_price_cents = 40000, original_price_cents = 32000, min_price_cents = 12000, cancellation_policy = 'moderate', title = 'Deluxe King', featured = true where id = $1", [exId]);
  await db.query("delete from inventory_units where listing_id = $1 and label <> 'Room 01'", [exId]);
  await book(ava, "example-ava", exId, { consent: true });
  await joinWaitlist({ customerId: ben, listingId: exId, maxPriceCents: 30000, preferences: { guests: 2, note: "Anniversary — happy to pay more for this room" } });

  // A sold-out dinner with a competitive waitlist (restaurant uses the highest-offer policy)
  const dinner = listings["Saffron & Smoke|Chef's Tasting Menu for two|0"];
  await soldOut(dinner, [chloe, dev]);
  await joinWaitlist({ customerId: ava, listingId: dinner, maxPriceCents: 26000 });
  await joinWaitlist({ customerId: ben, listingId: dinner, maxPriceCents: 34000, preferences: { guests: 2 } });

  // A sold-out event
  const cinema = listings["Rooftop Cinema Night|Casablanca (35mm)"];
  await soldOut(cinema, [ava, ben, chloe, dev]);
  await joinWaitlist({ customerId: dev, listingId: cinema, maxPriceCents: 6000 });

  // Some normal upcoming bookings for customer dashboards
  await book(ava, "ava-2", listings["Osteria Piccolo|Pasta Degustazione for two|1"]);
  await book(ava, "ava-3", listings["Docklands Harbour Sunset Cruise|Sunset cruise"], { qty: 2 });
  await book(chloe, "chloe-1", listings["Southbank Riverside Suites|River View King|1"]);
  await db.query("insert into favourites(user_id, listing_id) values ($1,$2),($1,$3)", [ava, listings["Aster Laneway Dining|Chef's Table Experience for two|1"], listings["St Kilda Esplanade Boutique|Bayview Queen|1"]]);

  // Promotions (featured placements)
  await db.query("insert into promotions(listing_id, label, ends_at, created_by) values ($1,'Tonight only',now() + interval '2 days',$2),($3,'Weekend pick',now() + interval '4 days',$2)", [exId, admin, listings["Yarra Valley Sunset Wine Tour|Sunset cellar-door tour"]]);

  await inTx((tx) => repriceAuto(tx));
}
