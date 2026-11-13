import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Coins, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { describeRule } from "@/lib/domain/fees";

export const metadata: Metadata = { title: "Become a partner" };

export default async function Partners() {
  const rules = (await (await getDb()).query<any>("select * from fee_rules where active and payer = 'partner' and applies_to = 'booking' and scope in ('category','global') order by scope desc, category")).rows;
  const label: Record<string, string> = { hotel: "Hotels", restaurant: "Restaurants", event: "Events" };
  return (
    <div className="container-page py-12">
      <div className="max-w-3xl"><p className="eyebrow">For hotels, restaurants &amp; event organisers</p><h1 className="mt-1 text-4xl font-semibold sm:text-5xl">Sell what&apos;s left. Keep your brand intact.</h1>
        <p className="mt-4 text-lg text-navy-900/75">Eleventh Hour turns unsold rooms, empty tables and spare tickets into revenue, with price floors you control, transparent commissions and payouts after the stay.</p>
        <div className="mt-6 flex gap-3"><Button asChild size="lg" variant="gold"><Link href="/partners/register">Apply to partner</Link></Button><Button asChild size="lg" variant="outline"><Link href="/login">Partner sign in</Link></Button></div></div>
      <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[[ShieldCheck, "You set the floor", "Minimum and maximum prices, cancellation terms and booking deadlines are always yours. Dynamic pricing only suggests — you can override any time."], [Users, "A fair waitlist", "Sold-out demand is captured, ranked by the policy you choose, and offered to customers within your time window."], [Coins, "Optional buyback", "When demand surges you can ask opted-in guests to release a booking for a full refund plus compensation you set — customer consent, always."], [BarChart3, "Know your numbers", "Occupancy, average selling price, waitlist demand, commission and net earnings in real time."]].map(([I, t, d]: any) => <li key={t} className="card p-5"><I className="size-7 text-gold-600" /><h2 className="mt-3 text-lg font-semibold">{t}</h2><p className="mt-1 text-sm text-navy-900/75">{d}</p></li>)}
      </ul>
      <section className="mt-14 max-w-3xl"><h2 className="text-2xl font-semibold">Current standard commissions</h2><p className="mt-1 text-sm text-navy-900/70">Charged only on completed bookings. Shown here live from our fee configuration — individual agreements may differ. Prices are GST-inclusive.</p>
        <table className="mt-4 w-full text-sm"><tbody>{rules.map((r) => <tr key={r.id} className="border-b border-navy-900/10"><th scope="row" className="py-3 text-left font-medium">{r.scope === "global" ? "Default" : label[r.category]}</th><td className="py-3 text-right">{describeRule(r)}</td></tr>)}</tbody></table></section>
      <section className="mt-14 max-w-3xl"><h2 className="text-2xl font-semibold">How onboarding works</h2><ol className="mt-3 list-decimal space-y-2 pl-6 text-navy-900/80"><li>Create your account and submit your ABN plus a verification document.</li><li>Our team verifies your business — typically within 2 business days. Only approved partners can list inventory, and only inventory sold through the platform by an approved partner can be released, resold or reallocated.</li><li>Add your venue, rooms/tables/tickets, minimum prices and policies, then publish.</li><li>Connect payouts. Future versions will integrate with property-management systems and channel managers.</li></ol></section>
    </div>
  );
}
