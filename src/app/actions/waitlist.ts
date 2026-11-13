"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionUser } from "@/lib/auth/session";
import { acceptOffer, declineOffer, joinWaitlist, leaveWaitlist } from "@/lib/domain/waitlist";
import { rateLimit } from "@/lib/ratelimit";
import { checked, dollarsToCents, parse, run, type Result } from "./_util";

export async function joinWaitlistAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const d = parse(z.object({ listingId: z.string().uuid(), maxPrice: z.string().optional(), guests: z.coerce.number().int().min(1).max(20).default(1), timePref: z.string().max(200).optional(), note: z.string().max(300).optional() }), fd);
    const u = await actionUser("customer:book");
    rateLimit(`wl:${u.id}`, 20, 60_000);
    await joinWaitlist({
      customerId: u.id, listingId: d.listingId, maxPriceCents: dollarsToCents(d.maxPrice),
      preferences: { guests: d.guests, time: d.timePref || null, note: d.note || null },
      notify: { email: checked(fd, "notifyEmail"), sms: checked(fd, "notifySms"), push: checked(fd, "notifyPush") },
    });
    redirect("/account/waitlists?joined=1");
  });
}

export async function leaveWaitlistAction(fd: FormData) {
  const u = await actionUser("customer:account");
  await leaveWaitlist(u.id, z.string().uuid().parse(fd.get("entryId")));
}

export async function acceptWaitlistOfferAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:book");
    const r = await acceptOffer(u.id, z.string().uuid().parse(fd.get("offerId")));
    redirect(`/checkout/${r.orderId}`);
  });
}
export async function declineWaitlistOfferAction(_: Result, fd: FormData): Promise<Result> {
  return run(async () => {
    const u = await actionUser("customer:account");
    await declineOffer(u.id, z.string().uuid().parse(fd.get("offerId")));
    return "Offer declined — it will go to the next person.";
  });
}
