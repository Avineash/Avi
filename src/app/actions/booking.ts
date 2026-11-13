"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionUser, clientIp, getUser } from "@/lib/auth/session";
import { createCheckout, expireOrder, sandboxPay } from "@/lib/domain/booking";
import { DomainError } from "@/lib/errors";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { checked, parse, run, type Result } from "./_util";

export async function startCheckoutAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const d = parse(z.object({
      listingId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(10), guests: z.coerce.number().int().min(1).max(50),
      guestName: z.string().min(2, "Enter the guest's name"), guestEmail: z.string().email("Enter a valid email"), guestPhone: z.string().optional(),
      specialRequests: z.string().max(500).optional(), idempotencyKey: z.string().min(8).max(100),
    }), fd);
    const user = await getUser();
    if (!user) redirect(`/login?next=${encodeURIComponent(`/listings/${d.listingId}`)}`);
    const u = await actionUser("customer:book");
    rateLimit(`checkout:${u.id}`, 15, 60_000);
    if (!checked(fd, "terms")) throw new DomainError("INVALID", "Please confirm you've read the cancellation terms and total price");
    const r = await createCheckout({ ...d, customerId: u.id, buybackConsent: checked(fd, "buybackConsent"), ip: await clientIp() });
    redirect(`/checkout/${r.orderId}`);
  });
}

export async function payAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const d = parse(z.object({ orderId: z.string().uuid(), cardNumber: z.string().min(12, "Enter a card number") }), fd);
    const u = await actionUser("customer:book");
    rateLimit(`pay:${u.id}`, 10, 60_000);
    const outcome = await sandboxPay({ orderId: d.orderId, customerId: u.id, cardNumber: d.cardNumber });
    if (outcome !== "confirmed") throw new DomainError("PAYMENT_FAILED", "We couldn't complete this booking — your card was not charged. Please try again.");
    const res = (await (await getDb()).query<any>("select id from reservations where order_id = $1 order by created_at limit 1", [d.orderId])).rows[0];
    redirect(`/account/bookings/${res.id}?confirmed=1`);
  });
}

export async function abandonCheckoutAction(fd: FormData) {
  const u = await actionUser("customer:book");
  const orderId = z.string().uuid().parse(fd.get("orderId"));
  const o = (await (await getDb()).query<any>("select customer_id, (select listing_id from reservations where order_id = o.id limit 1) as listing_id from orders o where id = $1", [orderId])).rows[0];
  if (!o || o.customer_id !== u.id) throw new DomainError("FORBIDDEN", "Not your order");
  await expireOrder(orderId, "abandoned by customer");
  redirect(`/listings/${o.listing_id}`);
}
