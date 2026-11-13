import { getDb } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { providerByName } from "@/lib/providers/payments";

/**
 * Create the provider-side payment intent for an order (idempotent).
 * Called *after* the order transaction commits so no external call ever runs inside a DB transaction.
 */
export async function startPayment(orderId: string) {
  const db = await getDb();
  const p = (await db.query<any>(
    `select p.*, u.email from payments p join orders o on o.id = p.order_id join users u on u.id = o.customer_id where p.order_id = $1`, [orderId])).rows[0];
  if (!p) throw new DomainError("NOT_FOUND", "Payment not found");
  if (p.provider_ref) return p;
  try {
    const r = await providerByName(p.provider).createIntent({ orderId, amountCents: p.amount_cents, currency: p.currency, idempotencyKey: p.idempotency_key, customerEmail: p.email });
    await db.query("update payments set provider_ref = $2, client_secret = $3 where id = $1 and provider_ref is null", [p.id, r.ref, r.clientSecret ?? null]);
    return { ...p, provider_ref: r.ref, client_secret: r.clientSecret ?? null };
  } catch (e) {
    await db.query("insert into integration_events(integration, level, message) values ($1,'error',$2)", [p.provider, `createIntent failed for order ${orderId}: ${String(e)}`]);
    const { expireOrder } = await import("./booking");
    await expireOrder(orderId, "payment provider error");
    throw new DomainError("PROVIDER", "We couldn't start the payment. Your hold was released — please try again.");
  }
}
