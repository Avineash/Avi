/**
 * Email / SMS delivery adapters. In-app notifications are always written to the DB;
 * these adapters add external channels when credentials are configured. Without them the
 * message is logged (status "skipped") — nothing is silently pretended to be sent.
 */
export interface DeliveryResult { status: "sent" | "skipped" | "failed"; detail?: string }

export async function sendEmail(to: string, subject: string, text: string): Promise<DeliveryResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { status: "skipped", detail: "RESEND_API_KEY not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Eleventh Hour <hello@example.com>", to, subject, text }),
    });
    return res.ok ? { status: "sent" } : { status: "failed", detail: `HTTP ${res.status}` };
  } catch (e) {
    return { status: "failed", detail: String(e) };
  }
}

export async function sendSms(to: string, body: string): Promise<DeliveryResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return { status: "skipped", detail: "Twilio not configured" };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    return res.ok ? { status: "sent" } : { status: "failed", detail: `HTTP ${res.status}` };
  } catch (e) {
    return { status: "failed", detail: String(e) };
  }
}
