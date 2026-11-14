import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { aud, fmtDate } from "@/lib/util";

export const metadata: Metadata = { title: "Receipt" };

export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const u = await requirePermission("customer:account", `/account/purchases/${id}/receipt`);
  const r = (await (await getDb()).query<any>(
    `select r.*, l.title, l.starts_at, v.name as venue, sp.display_name as seller, pay.provider, pay.captured_at, usr.name, usr.email from resale_orders r join resale_listings l on l.id = r.listing_id
       join venues v on v.id = l.venue_id join seller_profiles sp on sp.user_id = r.seller_id join payments pay on pay.order_id = r.order_id join users usr on usr.id = r.buyer_id where r.id = $1`, [id])).rows[0];
  if (!r || r.buyer_id !== u.id || !r.captured_at) notFound();
  const feeGst = Math.round(r.buyer_fee_cents / 11);
  return (
    <div className="container-page max-w-3xl py-10">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <div className="relative overflow-hidden rounded-2xl border border-navy-900/15 bg-white p-8 shadow-card print:border-0 print:shadow-none">
        {r.provider === "sandbox" && <p aria-hidden className="pointer-events-none absolute inset-0 grid -rotate-12 place-items-center text-center font-serif text-6xl font-bold uppercase leading-tight text-danger/10">Sandbox<br />not a tax invoice</p>}
        <div className="flex justify-between"><div><p className="eyebrow">Receipt &amp; tax invoice (service fee)</p><h1 className="text-2xl">{r.reference}</h1></div><div className="text-right text-sm"><p>Paid {fmtDate(r.captured_at)}</p><p>AUD</p></div></div>
        <div className="mt-6 grid gap-6 text-sm sm:grid-cols-2"><div><p className="text-xs uppercase tracking-wide text-navy-900/50">Billed to</p><p className="font-semibold">{r.name}</p><p>{r.email}</p></div><div><p className="text-xs uppercase tracking-wide text-navy-900/50">Item sold by</p><p className="font-semibold">{r.seller} <span className="font-normal text-navy-900/60">(private seller)</span></p><p className="text-navy-900/60">Peer-to-peer sale — no GST charged on the item</p></div></div>
        <table className="mt-6 w-full text-sm"><thead><tr className="border-b border-navy-900/20 text-left text-xs uppercase tracking-wide text-navy-900/60"><th className="py-2">Description</th><th className="py-2 text-right">GST</th><th className="py-2 text-right">Amount</th></tr></thead><tbody>
          <tr className="border-b border-navy-900/10"><td className="py-3">{r.quantity} × {r.title} — {r.venue}<br /><span className="text-xs text-navy-900/60">{fmtDate(r.starts_at)} · private sale, held in escrow until delivery confirmed</span></td><td className="py-3 text-right">—</td><td className="py-3 text-right">{aud(r.subtotal_cents)}</td></tr>
          <tr className="border-b border-navy-900/10"><td className="py-3">Eleventh Hour buyer protection &amp; service fee<br /><span className="text-xs text-navy-900/60">Supplied by the platform operator{process.env.PLATFORM_ABN ? ` (ABN ${process.env.PLATFORM_ABN})` : " — set PLATFORM_ABN"}</span></td><td className="py-3 text-right">{aud(feeGst)}</td><td className="py-3 text-right">{aud(r.buyer_fee_cents)}</td></tr>
        </tbody><tfoot><tr><td className="pt-3 font-semibold">Total (includes GST of {aud(feeGst)} on the fee)</td><td /><td className="pt-3 text-right text-base font-semibold">{aud(r.total_cents)}</td></tr></tfoot></table>
        <p className="mt-6 text-xs text-navy-900/55">Keep this for your records. Amounts in Australian dollars.</p>
      </div>
    </div>
  );
}
