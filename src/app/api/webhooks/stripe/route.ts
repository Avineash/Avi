import { getDb } from "@/lib/db";
import { onPaymentAuthorized, onPaymentFailed } from "@/lib/domain/booking";
import { openDispute } from "@/lib/domain/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stripe webhook — the source of truth for payment state. Signature-verified, idempotent per event id.
 * (Untested against live Stripe in this repository; exercise it with `stripe listen` + test mode before going live.)
 */
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY, whsec = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !whsec) return new Response("Stripe not configured", { status: 501 });
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });
  const Stripe = (await import("stripe")).default;
  let event: any;
  try { event = new Stripe(key).webhooks.constructEvent(body, sig, whsec); } catch { return new Response("Invalid signature", { status: 400 }); }

  const db = await getDb();
  const fresh = await db.query("insert into processed_webhooks(provider, event_id) values ('stripe', $1) on conflict do nothing returning event_id", [event.id]);
  if (!fresh.rows[0]) return Response.json({ received: true, duplicate: true });
  try {
    switch (event.type) {
      case "payment_intent.amount_capturable_updated": await onPaymentAuthorized("stripe", event.data.object.id); break; // manual-capture authorisation succeeded
      case "payment_intent.payment_failed": await onPaymentFailed("stripe", event.data.object.id, event.data.object.last_payment_error?.message ?? "Payment failed"); break;
      case "charge.dispute.created": {
        const d = event.data.object;
        const r = (await db.query<any>("select r.id from reservations r join payments p on p.order_id = r.order_id where p.provider = 'stripe' and p.provider_ref = $1 limit 1", [d.payment_intent])).rows[0];
        if (r) await openDispute({ reservationId: r.id, kind: "chargeback", amountCents: d.amount, notes: `Stripe dispute ${d.id}: ${d.reason}`, actor: { id: null, role: "system" } });
        break;
      }
      default: break;
    }
  } catch (e) {
    await db.query("delete from processed_webhooks where provider = 'stripe' and event_id = $1", [event.id]); // let Stripe retry
    console.error("[stripe webhook]", e);
    return new Response("Handler error", { status: 500 });
  }
  return Response.json({ received: true });
}
