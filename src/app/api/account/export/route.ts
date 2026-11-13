import { getUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Privacy Act access request: everything we hold about the signed-in user, as JSON. */
export async function GET() {
  const u = await getUser();
  if (!u) return new Response("Unauthorized", { status: 401 });
  const db = await getDb();
  const q = async (sql: string) => (await db.query(sql, [u.id])).rows;
  const data = {
    exportedAt: new Date().toISOString(),
    profile: (await q("select id, email, name, phone, role, marketing_opt_in, notify_email, notify_sms, notify_push, created_at from users where id = $1"))[0],
    reservations: await q("select reference, status, price_cents, customer_fee_cents, total_cents, guests, guest_name, guest_email, special_requests, cancellation_policy, created_at, cancelled_at from reservations where customer_id = $1"),
    waitlistEntries: await q("select listing_id, max_price_cents, preferences, status, created_at from waitlist_entries where customer_id = $1"),
    refunds: await q("select f.amount_cents, f.kind, f.status, f.created_at from refunds f join reservations r on r.id = f.reservation_id where r.customer_id = $1"),
    buybackConsents: await q("select kind, terms_version, terms_snapshot, created_at from buyback_consents where customer_id = $1"),
    notifications: await q("select kind, title, body, created_at from notifications where user_id = $1"),
    favourites: await q("select listing_id, created_at from favourites where user_id = $1"),
  };
  return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="my-eleventh-hour-data.json"' } });
}
