"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionUser, clientIp, getUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { cancelReservation } from "@/lib/domain/booking";
import { requestRefund, submitReview } from "@/lib/domain/finance";
import { respondToBuyback } from "@/lib/domain/buyback";
import { checkPassword } from "@/lib/domain/accounts";
import { DomainError } from "@/lib/errors";
import { checked, dollarsToCents, parse, run, type Result } from "./_util";

export async function toggleSaveAction(fd: FormData) {
  const u = await getUser();
  const listingId = z.string().uuid().parse(fd.get("listingId"));
  if (!u) redirect(`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`);
  const db = await getDb();
  const del = await db.query("delete from favourites where user_id = $1 and listing_id = $2 returning 1", [u.id, listingId]);
  if (!del.rows[0]) await db.query("insert into favourites(user_id, listing_id) values ($1,$2) on conflict do nothing", [u.id, listingId]);
  revalidatePath("/", "layout");
}

export async function updateProfileAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ name: z.string().min(2), phone: z.string().max(30).optional() }), fd);
    await (await getDb()).query(
      "update users set name = $2, phone = $3, notify_email = $4, notify_sms = $5, notify_push = $6, marketing_opt_in = $7, updated_at = now() where id = $1",
      [u.id, d.name.trim(), d.phone || null, checked(fd, "notifyEmail"), checked(fd, "notifySms"), checked(fd, "notifyPush"), checked(fd, "marketing")]);
    return "Profile and preferences saved.";
  });
}

export async function changePasswordAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ current: z.string(), next: z.string() }), fd);
    const db = await getDb();
    const row = (await db.query<any>("select password_hash from users where id = $1", [u.id])).rows[0];
    if (!(await bcrypt.compare(d.current, row.password_hash ?? ""))) throw new DomainError("INVALID", "Your current password is incorrect");
    checkPassword(d.next);
    await db.query("update users set password_hash = $2, updated_at = now() where id = $1", [u.id, await bcrypt.hash(d.next, 10)]);
    return "Password updated.";
  });
}

export async function cancelBookingAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ reservationId: z.string().uuid(), reason: z.string().max(300).optional() }), fd);
    const r = await cancelReservation({ reservationId: d.reservationId, actor: { id: u.id, role: u.role, ip: await clientIp() }, mode: "policy", reason: d.reason || "Cancelled by customer", asCustomer: true });
    return r.refundCents > 0 ? `Booking cancelled. A refund of $${(r.refundCents / 100).toFixed(2)} has been issued to your original payment method.` : "Booking cancelled. Under its terms this booking isn't eligible for a refund.";
  });
}

export async function requestRefundAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ reservationId: z.string().uuid(), amount: z.string(), reason: z.string() }), fd);
    const cents = dollarsToCents(d.amount);
    if (!cents) throw new DomainError("INVALID", "Enter the refund amount you're requesting");
    await requestRefund({ customerId: u.id, reservationId: d.reservationId, amountCents: cents, reason: d.reason });
    return "Request sent. Our team will review it and reply within 2 business days. Your statutory rights under the Australian Consumer Law are not affected.";
  });
}

export async function submitReviewAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ reservationId: z.string().uuid(), rating: z.coerce.number().int().min(1).max(5), comment: z.string().max(1500).optional() }), fd);
    await submitReview({ customerId: u.id, reservationId: d.reservationId, rating: d.rating, comment: d.comment });
    return "Thanks — your verified review is live.";
  });
}

export async function respondBuybackAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    const d = parse(z.object({ offerId: z.string().uuid(), decision: z.enum(["accept", "reject"]) }), fd);
    if (d.decision === "accept" && !checked(fd, "understand")) throw new DomainError("INVALID", "Please tick the box to confirm you understand and want to accept this offer");
    await respondToBuyback({ customerId: u.id, offerId: d.offerId, decision: d.decision, ip: await clientIp() });
    return d.decision === "accept" ? "Accepted. Your refund and compensation are being processed — we'll notify you as soon as they're sent." : "No problem — your booking stays exactly as it was.";
  });
}

export async function markNotificationsReadAction() {
  const u = await actionUser("customer:account");
  await (await getDb()).query("update notifications set read_at = now() where user_id = $1 and read_at is null", [u.id]);
  revalidatePath("/", "layout");
}
