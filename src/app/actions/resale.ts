"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionUser, clientIp, getUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { expireOrder, sandboxPay } from "@/lib/domain/booking";
import {
  becomeSeller, cancelBuyerAlert, cancelResaleOrder, confirmReceipt, createBuyerAlert, createResaleCheckout, createResaleListing, deliverResaleOrder,
  openResaleDispute, runSellerPayout, setListingStatus, submitSellerReview, updateAskPrice,
} from "@/lib/domain/resale";
import { DomainError } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";
import { melbToDate } from "@/lib/util";
import { checked, dollarsToCents, parse, run, type Result } from "./_util";

const id = z.string().uuid();
const cents = (v: unknown, label: string) => { const c = dollarsToCents(v); if (!c || c <= 0) throw new DomainError("INVALID", `Enter a valid ${label}`); return c; };
async function file(fd: FormData, name: string) {
  const f = fd.get(name);
  return f instanceof File && f.size > 0 ? { name: f.name, mime: f.type, content: Buffer.from(await f.arrayBuffer()) } : null;
}

// ── Selling ──
export async function becomeSellerAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ displayName: z.string().min(2).max(40), phone: z.string(), bio: z.string().max(400).optional(), payoutHint: z.string().max(60).optional(), next: z.string().optional() }), fd);
    await becomeSeller({ userId: u.id, displayName: d.displayName, phone: d.phone, bio: d.bio, payoutHint: d.payoutHint, acceptTerms: checked(fd, "terms") });
    redirect(d.next && d.next.startsWith("/") && !d.next.startsWith("//") ? d.next : "/sell/new");
  });
}

export async function createResaleListingAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    rateLimit(`listing:${u.id}`, 10, 60_000);
    const d = parse(z.object({
      venueId: id, title: z.string().min(3).max(120), itemDetail: z.string().max(200).optional(), description: z.string().max(2000).optional(),
      startsAt: z.string().min(10), endsAt: z.string().min(10), quantity: z.coerce.number().int().min(1).max(20),
      transferMethod: z.enum(["name_change", "ticket_transfer", "voucher_code", "reservation_name"]), transferNotes: z.string().max(600).optional(), bookingReference: z.string().min(4).max(60),
    }), fd);
    const proof = await file(fd, "proof");
    const listingId = await createResaleListing({
      sellerId: u.id, venueId: d.venueId, title: d.title, itemDetail: d.itemDetail, description: d.description, startsAt: melbToDate(d.startsAt), endsAt: melbToDate(d.endsAt),
      quantity: d.quantity, originalUnitCents: cents(fd.get("original"), "original price"), askUnitCents: cents(fd.get("ask"), "asking price"), transferMethod: d.transferMethod,
      transferNotes: d.transferNotes, bookingReference: d.bookingReference, proof: proof ? { fileName: proof.name, mime: proof.mime, content: proof.content } : null,
      declarations: { holder: checked(fd, "holder"), permitted: checked(fd, "permitted"), deliver: checked(fd, "deliver"), accurate: checked(fd, "accurate") }, ip: await clientIp(),
    });
    redirect(`/resale/${listingId}?listed=1`);
  });
}

export async function updateAskAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ listingId: id }), fd);
    await updateAskPrice(u.id, d.listingId, cents(fd.get("ask"), "price"));
    return "Price updated.";
  });
}

export async function listingStatusAction(fd: FormData) {
  const u = await actionUser("customer:account");
  const d = parse(z.object({ listingId: id, op: z.enum(["pause", "resume", "remove"]) }), fd);
  await setListingStatus(u.id, d.listingId, d.op);
  revalidatePath("/", "layout");
}

export async function deliverAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ orderId: id, notes: z.string().max(1500).optional() }), fd);
    await deliverResaleOrder({ sellerId: u.id, orderId: d.orderId, notes: d.notes, file: await file(fd, "file") });
    return "Delivered. The buyer has been notified — you're paid once they confirm (or automatically after the event).";
  });
}

export async function cancelSaleAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ orderId: id, reason: z.string().max(300).optional() }), fd);
    await cancelResaleOrder({ actorId: u.id, orderId: d.orderId, as: "seller", reason: d.reason });
    return "Sale cancelled and the buyer refunded. A strike was recorded on your account.";
  });
}

export async function withdrawAction(_: Result): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const p = await runSellerPayout(u.id);
    return `Payout of $${(Number(p.net_cents) / 100).toFixed(2)} sent.`;
  });
}

// ── Buying ──
export async function startResaleCheckoutAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const d = parse(z.object({ listingId: id, quantity: z.coerce.number().int().min(1).max(20), idempotencyKey: z.string().min(8).max(100) }), fd);
    if (!(await getUser())) redirect(`/login?next=${encodeURIComponent(`/resale/${d.listingId}`)}`);
    const u = await actionUser("customer:book");
    rateLimit(`checkout:${u.id}`, 15, 60_000);
    if (!checked(fd, "terms")) throw new DomainError("INVALID", "Please confirm you've read how escrow, delivery and refunds work");
    const r = await createResaleCheckout({ buyerId: u.id, listingId: d.listingId, quantity: d.quantity, idempotencyKey: d.idempotencyKey, ip: await clientIp() });
    redirect(`/pay/${r.resaleOrderId}`);
  });
}

export async function payResaleAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const d = parse(z.object({ resaleOrderId: id, cardNumber: z.string().min(12, "Enter a card number") }), fd);
    const u = await actionUser("customer:book");
    rateLimit(`pay:${u.id}`, 10, 60_000);
    const ro = (await (await getDb()).query<any>("select * from resale_orders where id = $1", [d.resaleOrderId])).rows[0];
    if (!ro || ro.buyer_id !== u.id) throw new DomainError("NOT_FOUND", "Order not found");
    const outcome = await sandboxPay({ orderId: ro.order_id, customerId: u.id, cardNumber: d.cardNumber });
    if (outcome !== "confirmed") throw new DomainError("PAYMENT_FAILED", "We couldn't complete this purchase — you weren't charged. Please try again.");
    redirect(`/account/purchases/${ro.id}?paid=1`);
  });
}

export async function abandonResaleCheckoutAction(fd: FormData) {
  const u = await actionUser("customer:book");
  const roId = id.parse(fd.get("resaleOrderId"));
  const ro = (await (await getDb()).query<any>("select * from resale_orders where id = $1", [roId])).rows[0];
  if (!ro || ro.buyer_id !== u.id) throw new DomainError("FORBIDDEN", "Not your order");
  await expireOrder(ro.order_id, "abandoned by buyer");
  redirect(`/resale/${ro.listing_id}`);
}

export async function confirmReceiptAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    await confirmReceipt(u.id, id.parse(fd.get("orderId")));
    return "Thanks for confirming — the seller has been paid.";
  });
}
export async function cancelPurchaseAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ orderId: id, reason: z.string().max(300).optional() }), fd);
    await cancelResaleOrder({ actorId: u.id, orderId: d.orderId, as: "buyer", reason: d.reason });
    return "Cancelled. You'll be refunded in full, including the service fee.";
  });
}
export async function disputeAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ orderId: id, reason: z.string().min(5).max(200), details: z.string().max(1500).optional() }), fd);
    await openResaleDispute({ buyerId: u.id, orderId: d.orderId, reason: d.reason, details: d.details });
    return "Reported. Your money stays frozen in escrow while we review — we'll be in touch.";
  });
}
export async function reviewSellerAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ orderId: id, rating: z.coerce.number().int().min(1).max(5), comment: z.string().max(1000).optional() }), fd);
    await submitSellerReview({ buyerId: u.id, orderId: d.orderId, rating: d.rating, comment: d.comment });
    return "Thanks — your review is live.";
  });
}

export async function createAlertAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ category: z.enum(["hotel", "restaurant", "event", ""]).optional(), venueId: z.string().optional(), dateFrom: z.string().optional(), dateTo: z.string().optional(), quantity: z.coerce.number().int().min(1).max(20).default(1), note: z.string().max(200).optional() }), fd);
    await createBuyerAlert({ buyerId: u.id, category: d.category || null, venueId: d.venueId || null, dateFrom: d.dateFrom || null, dateTo: d.dateTo || null, maxUnitCents: dollarsToCents(fd.get("max")), quantity: d.quantity, note: d.note });
    return "Alert saved — we'll notify you the moment a match is listed.";
  });
}
export async function cancelAlertAction(fd: FormData) {
  const u = await actionUser("customer:account");
  await cancelBuyerAlert(u.id, id.parse(fd.get("alertId")));
  revalidatePath("/", "layout");
}

export async function toggleSaveResaleAction(fd: FormData) {
  const listingId = id.parse(fd.get("listingId"));
  const u = await getUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(`/resale/${listingId}`)}`);
  const db = await getDb();
  const del = await db.query("delete from resale_saved where user_id = $1 and listing_id = $2 returning 1", [u.id, listingId]);
  if (!del.rows[0]) await db.query("insert into resale_saved(user_id, listing_id) values ($1,$2) on conflict do nothing", [u.id, listingId]);
  revalidatePath("/", "layout");
}
