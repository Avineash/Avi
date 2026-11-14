import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { setSetting } from "@/lib/domain/settings";
import { registerPartner, registerVenue } from "@/lib/domain/registry";
import { becomeSeller, confirmReceipt, createBuyerAlert, createResaleCheckout, createResaleListing, deliverResaleOrder, submitSellerReview } from "@/lib/domain/resale";
import { sandboxPay } from "@/lib/domain/booking";
import { hours } from "@/lib/util";
import { abnFor, art, DEMO_PASSWORD, EVENTS, HOTELS_A, HOTELS_B, RESTAURANTS, snap } from "./seed";

const PROOF = { fileName: "booking-confirmation.pdf", mime: "application/pdf", content: Buffer.from("%PDF-1.4 demo proof of purchase (sandbox)") };
const slug = (s: string) => s.toLowerCase().replace(/\W+/g, "-");

/** Demo data for the buyer/seller marketplace. Everything goes through the real domain services; payments are sandbox. */
export async function seedResaleDemo() {
  const db = await getDb();
  const pw = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = async (email: string, name: string, phone?: string) =>
    (await db.query<any>("insert into users(email, name, role, password_hash, is_demo, email_verified_at, phone) values ($1,$2,'customer',$3,true,now(),$4) returning id", [email, name, pw, phone ?? null])).rows[0].id as string;

  await setSetting(db, "features.peer_resale", { enabled: true, legal_review_ref: "SANDBOX-DEMO — NOT A LEGAL APPROVAL" }, null);

  // ── People: two pure buyers, three sellers (one of whom also buys) ──
  const ava = await user("ava@eleventhhour.test", "Ava Thompson", "+61400000001");
  const ben = await user("ben@eleventhhour.test", "Ben Nguyen");
  const chloe = await user("chloe@eleventhhour.test", "Chloe Martin", "+61400000003");
  const dev = await user("dev@eleventhhour.test", "Dev Patel", "+61400000004");
  const maya = await user("maya@eleventhhour.test", "Maya Rossi", "+61400000005");
  for (const [id, name, phone, bio] of [[chloe, "Chloe M.", "+61400000003", "Travel a lot, plans change. Fast, friendly transfers."], [dev, "Dev P.", "+61400000004", "Season-ticket holder. I only sell what I can't use."], [maya, "Maya R.", "+61400000005", "Foodie. Reservations I can't make get passed on quickly."]] as const)
    await becomeSeller({ userId: id, displayName: name, phone, bio, acceptTerms: true });

  // ── The registry: partners have no portal in this phase; an operator registers them and their resale terms ──
  const reg = async (n: number, business: string, category: "hotel" | "restaurant" | "event") =>
    registerPartner(db, { businessName: business, abn: abnFor(n), category, contactEmail: `registry-${n}@eleventhhour.test`, isDemo: true });
  const laneway = await reg(1, "Laneway Hotels Pty Ltd", "hotel"), esplanade = await reg(2, "Esplanade Collection Pty Ltd", "hotel");
  const dining = await reg(3, "Hearth & Table Group", "restaurant"), live = await reg(4, "Southbank Live Events Pty Ltd", "event");
  const venues: Record<string, string> = {};
  for (const [pid, specs] of [[laneway, HOTELS_A], [esplanade, HOTELS_B]] as const)
    for (const h of specs) venues[h.name] = await registerVenue(db, {
      partnerId: pid, name: h.name, address: h.address, suburb: h.suburb, lat: h.lat, lng: h.lng, description: h.blurb, imageUrl: `/api/art/${slug(h.name)}?kind=hotel`, starRating: h.stars, amenities: h.amenities,
      resaleAllowed: h.name !== "Yarra Terrace Hotel", transferInstructions: "Ask the hotel to change the name on the booking (front desk or email). Keep the original confirmation number.",
    });
  for (const r of RESTAURANTS) venues[r.name] = await registerVenue(db, { partnerId: dining, name: r.name, address: r.address, suburb: r.suburb, lat: r.lat, lng: r.lng, description: r.blurb, imageUrl: `/api/art/${slug(r.name)}?kind=restaurant`, cuisine: r.cuisine, amenities: r.amenities, transferInstructions: "Call the restaurant to move the reservation to the buyer's name." });
  for (const e of EVENTS) venues[e.name] = await registerVenue(db, { partnerId: live, name: e.name, address: e.address, suburb: e.suburb, lat: e.lat, lng: e.lng, description: e.blurb, imageUrl: `/api/art/${slug(e.name)}?kind=event`, amenities: e.amenities, transferInstructions: "Use the ticketing app's transfer function to send the ticket to the buyer's email." });
  // A partner that is NOT approved: its venue exists but nothing there can be sold.
  const docklands = await reg(5, "Docklands Harbour Hotel Pty Ltd", "hotel");
  await registerVenue(db, { partnerId: docklands, name: "Docklands Harbour Hotel", address: "2 Harbour Esplanade", suburb: "Docklands", lat: -37.814, lng: 144.9462, imageUrl: art("docklands-harbour", "hotel") });
  await db.query("update partners set status = 'pending' where id = $1", [docklands]);

  // ── Listings ──
  let n = 0;
  const list = async (seller: string, venue: string, o: { title: string; detail?: string; cat: "hotel" | "restaurant" | "event"; start: Date; hrs: number; qty?: number; original: number; ask: number; method: "name_change" | "ticket_transfer" | "voucher_code" | "reservation_name"; notes?: string; desc?: string }) =>
    createResaleListing({
      sellerId: seller, venueId: venues[venue], title: o.title, itemDetail: o.detail, description: o.desc, startsAt: o.start, endsAt: new Date(o.start.getTime() + hours(o.hrs)), quantity: o.qty ?? 1,
      originalUnitCents: o.original, askUnitCents: o.ask, transferMethod: o.method, transferNotes: o.notes, bookingReference: `DEMO-${slug(venue).slice(0, 6).toUpperCase()}-${++n}${Math.random().toString(36).slice(2, 5)}`,
      proof: PROOF, declarations: { holder: true, permitted: true, deliver: true, accurate: true }, isDemo: true,
      imageUrl: `/api/art/${slug(venue + o.title)}?kind=${o.cat}`,
    });
  const hotelNote = "I'll ask the hotel to change the name and forward you the new confirmation.";
  const lId = {
    laneway: await list(chloe, "The Laneway Hotel", { title: "Deluxe King · 1 night", detail: "1 King · 28 m² · breakfast included", cat: "hotel", start: snap(30, 14), hrs: 21, original: 32000, ask: 24500, method: "name_change", notes: hotelNote, desc: "Plans changed — can't make our city weekend. Flexible rate booked direct." }),
    southbank: await list(chloe, "Southbank Riverside Suites", { title: "River View King · 2 nights", detail: "River views · late checkout", cat: "hotel", start: snap(52, 14), hrs: 45, original: 98000, ask: 79000, method: "name_change", notes: hotelNote }),
    stkilda: await list(maya, "St Kilda Esplanade Boutique", { title: "Bayview Queen · 1 night", detail: "Bay-view terrace", cat: "hotel", start: snap(8, 14), hrs: 21, original: 29000, ask: 21000, method: "name_change", notes: hotelNote }),
    fitzroy: await list(dev, "Fitzroy Press House", { title: "Printer's Loft · 1 night", cat: "hotel", start: snap(76, 14), hrs: 21, original: 34000, ask: 34000, method: "name_change", notes: "Name change by email. At face value — no fee from me." }),
    saffron: await list(maya, "Saffron & Smoke", { title: "Chef's Tasting Menu for two", detail: "7 courses · prepaid", cat: "restaurant", start: snap(26, 19, 30), hrs: 3, original: 32000, ask: 26000, method: "reservation_name", notes: "I'll call the restaurant and move it to your name." }),
    osteria: await list(maya, "Osteria Piccolo", { title: "Pasta Degustazione for two", cat: "restaurant", start: snap(10, 19), hrs: 3, original: 18000, ask: 14000, method: "reservation_name" }),
    aster: await list(chloe, "Aster Laneway Dining", { title: "Chef's Table for two", detail: "9 courses + pairing", cat: "restaurant", start: snap(54, 19), hrs: 3, original: 44000, ask: 39000, method: "reservation_name" }),
    cinema: await list(dev, "Rooftop Cinema Night", { title: "Casablanca (35mm) — 2 tickets", cat: "event", start: snap(14, 19, 30), hrs: 3, qty: 2, original: 4200, ask: 3600, method: "ticket_transfer", notes: "Transferred via the ticketing app to your email." }),
    comedy: await list(dev, "Comedy Cellar Live", { title: "Friday night showcase — 4 tickets", cat: "event", start: snap(32, 19, 30), hrs: 3, qty: 4, original: 5500, ask: 5800, method: "ticket_transfer", notes: "Priced 5% above face (within the 110% cap)." }),
    cruise: await list(maya, "Docklands Harbour Sunset Cruise", { title: "Sunset cruise — 2 tickets", cat: "event", start: snap(36, 18), hrs: 3, qty: 2, original: 8900, ask: 7500, method: "ticket_transfer" }),
    wine: await list(chloe, "Yarra Valley Sunset Wine Tour", { title: "Sunset cellar-door tour", cat: "event", start: snap(60, 16, 30), hrs: 5, original: 16500, ask: 13000, method: "voucher_code", notes: "I'll email the voucher code." }),
  };
  // More live inventory so every category page has choice
  await list(dev, "Southbank Riverside Suites", { title: "Executive Suite · 1 night", detail: "Lounge · river views", cat: "hotel", start: snap(34, 14), hrs: 21, original: 78000, ask: 64000, method: "name_change", notes: hotelNote });
  await list(maya, "The Laneway Hotel", { title: "Laneway Studio Suite · 1 night", detail: "King + sofa bed", cat: "hotel", start: snap(100, 14), hrs: 21, original: 46000, ask: 39000, method: "name_change", notes: hotelNote });
  await list(chloe, "St Kilda Esplanade Boutique", { title: "Garden Courtyard Room · 2 nights", cat: "hotel", start: snap(56, 14), hrs: 45, original: 48000, ask: 41000, method: "name_change", notes: hotelNote });
  await list(chloe, "Kōji Counter", { title: "Omakase for two", detail: "14 pieces + dessert", cat: "restaurant", start: snap(28, 19), hrs: 3, original: 56000, ask: 48000, method: "reservation_name", notes: "Counter seats — I'll move the booking to your name." });
  await list(dev, "The Bluestone Table", { title: "Shared plates feast for two", cat: "restaurant", start: snap(12, 18, 30), hrs: 3, original: 15000, ask: 11500, method: "reservation_name" });
  await list(maya, "Osteria Piccolo", { title: "Pre-theatre set menu for two", cat: "restaurant", start: snap(48, 17, 30), hrs: 2, original: 12000, ask: 9500, method: "reservation_name" });
  await list(chloe, "Hidden Laneways Food Walk", { title: "Twilight food crawl — 2 tickets", cat: "event", start: snap(40, 16), hrs: 3, qty: 2, original: 9500, ask: 8000, method: "voucher_code", notes: "I'll email the booking voucher." });
  await list(maya, "Rooftop Cinema Night", { title: "Spirited Away — 3 tickets", cat: "event", start: snap(70, 19, 30), hrs: 3, qty: 3, original: 3800, ask: 3800, method: "ticket_transfer" });
  void lId;

  // ── Real flows: purchases in every state ──
  const pay = async (buyer: string, listingId: string, qty = 1) => {
    const r = await createResaleCheckout({ buyerId: buyer, listingId, quantity: qty, idempotencyKey: `seed-resale-${n++}-${listingId}-${buyer}` });
    await sandboxPay({ orderId: r.orderId, customerId: buyer, cardNumber: "4242424242424242" });
    return r.resaleOrderId;
  };
  const dnote = "Booking name changed — new confirmation emailed. Quote the original reference at check-in.";
  // completed + reviewed → gives sellers a reputation
  const history: Array<[string, string, string, number, string]> = [
    [ben, dev, lId.cinema, 5, "Smooth transfer, tickets arrived within minutes."], [ava, maya, lId.osteria, 5, "Great communication — dinner was lovely."],
    [ben, maya, lId.stkilda, 4, "All good, slight delay but sorted."], [ava, chloe, lId.wine, 5, "Perfect. Would buy again."],
  ];
  for (const [buyer, seller, listing, rating, comment] of history) {
    const id = await pay(buyer, listing); await deliverResaleOrder({ sellerId: seller, orderId: id, notes: dnote }); await confirmReceipt(buyer, id);
    await submitSellerReview({ buyerId: buyer, orderId: id, rating, comment });
  }
  // in progress: Ava bought from Chloe (Chloe must deliver); Ben bought from Dev (delivered, Ben to confirm)
  await pay(ava, lId.laneway);
  const toConfirm = await pay(ben, lId.comedy, 2); await deliverResaleOrder({ sellerId: dev, orderId: toConfirm, notes: "Tickets transferred through the ticketing app — check your email for the new QR codes." });
  // a sold-out listing, and an alert waiting for something similar
  await pay(ava, lId.aster);
  await createBuyerAlert({ buyerId: ben, category: "restaurant", maxUnitCents: 40000, note: "A dinner for two this weekend" });
  await createBuyerAlert({ buyerId: ava, category: "hotel", maxUnitCents: 25000, quantity: 1 });
}
