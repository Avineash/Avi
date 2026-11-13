import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDate } from "@/lib/util";

export const metadata: Metadata = { title: "Tax invoice" };

export default async function Invoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const u = await requirePermission("customer:account", `/account/bookings/${id}/invoice`);
  const db = await getDb();
  const r = (await db.query<any>(
    `select r.*, l.title, l.starts_at, v.name as venue, p.business_name, p.abn, p.gst_registered, pay.provider, pay.captured_at, usr.name as customer_name, usr.email
       from reservations r join listings l on l.id = r.listing_id join venues v on v.id = l.venue_id join partners p on p.id = r.partner_id join payments pay on pay.order_id = r.order_id join users usr on usr.id = r.customer_id where r.id = $1`, [id])).rows[0];
  if (!r || r.customer_id !== u.id || !r.captured_at) notFound();
  const refunds = (await db.query<any>("select amount_cents, completed_at from refunds where reservation_id = $1 and status = 'succeeded'", [id])).rows;
  const feeGst = Math.round(r.customer_fee_cents / 11);
  const sandbox = r.provider === "sandbox";
  return (
    <div className="container-page max-w-3xl py-10">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <div className="relative overflow-hidden rounded-2xl border border-navy-900/15 bg-white p-8 shadow-card print:border-0 print:shadow-none">
        {sandbox && <p aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-center font-serif text-6xl font-bold uppercase leading-tight text-danger/10 -rotate-12">Sandbox<br />not a tax invoice</p>}
        <div className="flex justify-between"><div><p className="eyebrow">Tax invoice</p><h1 className="text-2xl font-semibold">{r.reference}</h1></div><div className="text-right text-sm"><p>Issued {fmtDate(r.captured_at)}</p><p>Paid in full (AUD)</p></div></div>
        <div className="mt-6 grid gap-6 text-sm sm:grid-cols-2">
          <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Supplier</p><p className="font-semibold">{r.business_name}</p><p>ABN {r.abn.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4")}</p><p>{r.gst_registered ? "Registered for GST" : "Not registered for GST — no GST charged"}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-navy-900/50">Billed to</p><p className="font-semibold">{r.customer_name}</p><p>{r.email}</p></div>
        </div>
        <table className="mt-6 w-full text-sm"><thead><tr className="border-b border-navy-900/20 text-left text-xs uppercase tracking-wide text-navy-900/60"><th className="py-2">Description</th><th className="py-2 text-right">GST</th><th className="py-2 text-right">Amount</th></tr></thead><tbody>
          <tr className="border-b border-navy-900/10"><td className="py-3">{r.title} — {r.venue}<br /><span className="text-xs text-navy-900/60">Supplied by {r.business_name} on {fmtDate(r.starts_at)}</span></td><td className="py-3 text-right">{aud(r.gst_cents)}</td><td className="py-3 text-right">{aud(r.price_cents)}</td></tr>
          <tr className="border-b border-navy-900/10"><td className="py-3">Eleventh Hour service fee<br /><span className="text-xs text-navy-900/60">Supplied by the platform operator{process.env.PLATFORM_ABN ? ` (ABN ${process.env.PLATFORM_ABN})` : " — set PLATFORM_ABN"}</span></td><td className="py-3 text-right">{aud(feeGst)}</td><td className="py-3 text-right">{aud(r.customer_fee_cents)}</td></tr>
        </tbody><tfoot><tr><td className="pt-3 font-semibold">Total (includes GST of {aud(r.gst_cents + feeGst)})</td><td /><td className="pt-3 text-right text-base font-semibold">{aud(r.total_cents)}</td></tr></tfoot></table>
        {refunds.length > 0 && <p className="mt-4 rounded-lg bg-ivory-100 p-3 text-sm">Refunded: {refunds.map((x) => aud(x.amount_cents)).join(" + ")}. An adjustment note is issued for GST purposes.</p>}
        <p className="mt-6 text-xs text-navy-900/55">All amounts in Australian dollars and GST-inclusive. Keep this invoice for your records.</p>
      </div>
    </div>
  );
}
