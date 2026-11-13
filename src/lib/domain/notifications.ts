import { getDb, type Queryable } from "@/lib/db";
import { sendEmail, sendSms } from "@/lib/providers/messaging";

export interface NotifyInput { kind: string; title: string; body: string; link?: string }

/** Writes an in-app notification inside the caller's transaction. External delivery happens in flushNotifications(). */
export async function notify(c: Queryable, userId: string, n: NotifyInput) {
  await c.query("insert into notifications(user_id, kind, title, body, link) values ($1,$2,$3,$4,$5)", [userId, n.kind, n.title, n.body, n.link ?? null]);
}

export async function notifyPartnerOwner(c: Queryable, partnerId: string, n: NotifyInput) {
  const r = await c.query<{ owner_user_id: string }>("select owner_user_id from partners where id = $1", [partnerId]);
  if (r.rows[0]) await notify(c, r.rows[0].owner_user_id, n);
}

/** Deliver pending email/SMS for notifications according to each user's preferences. Safe to call repeatedly. */
export async function flushNotifications(limit = 50): Promise<number> {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `select n.id, n.title, n.body, n.link, n.email_status, n.sms_status, u.email, u.phone, u.notify_email, u.notify_sms
       from notifications n join users u on u.id = n.user_id
      where n.email_status is null or n.sms_status is null
      order by n.created_at limit $1`, [limit]);
  for (const n of rows) {
    const base = process.env.APP_URL ?? "";
    const text = `${n.body}${n.link ? `\n\n${base}${n.link}` : ""}`;
    const email = n.email_status ?? (n.notify_email ? (await sendEmail(n.email, n.title, text)).status : "skipped");
    const sms = n.sms_status ?? (n.notify_sms && n.phone ? (await sendSms(n.phone, `${n.title}: ${n.body}`.slice(0, 300))).status : "skipped");
    await db.query("update notifications set email_status = $2, sms_status = $3 where id = $1", [n.id, email, sms]);
  }
  return rows.length;
}
