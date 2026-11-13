import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Badge, EmptyState, Input, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { suggestPrice } from "@/lib/domain/pricing";
import { aud, fmtDateTime } from "@/lib/util";
import { applySuggestionAction, setPriceAction, setPricingModeAction } from "@/app/actions/partner";

export const metadata: Metadata = { title: "Pricing & availability" };

export default async function Pricing() {
  const u = await requirePermission("partner:portal", "/partner/pricing");
  const db = await getDb();
  const ls = (await db.query<any>(
    `select l.*, a.available_units, a.total_units from listings l join listing_availability a on a.listing_id = l.id
      where l.partner_id = $1 and l.status in ('published','paused') and l.booking_deadline > now() order by l.starts_at`, [u.partnerId])).rows;
  const sug = await Promise.all(ls.map((l) => suggestPrice(db, l.id)));
  return (
    <>
      <PageHeader title="Pricing & availability" eyebrow="You're always in control" />
      <p className="mb-6 max-w-3xl text-sm text-navy-900/75">Suggestions come from transparent rules — time to start, remaining stock, waitlist demand, recent booking pace, day of week, season and special events — always clamped to <em>your</em> minimum and maximum. Apply a suggestion, switch a listing to automatic, or set any price you like inside your bounds.</p>
      {ls.length === 0 ? <EmptyState title="No open listings" /> : (
        <ul className="space-y-4">{ls.map((l, i) => { const s = sug[i]; const diff = s.suggestedCents - l.current_price_cents; return (
          <li key={l.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-serif text-lg font-semibold">{l.title}</h2><p className="text-sm text-navy-900/60">{fmtDateTime(l.starts_at)} · {l.available_units}/{l.total_units} available</p></div><div className="flex items-center gap-2"><StatusBadge status={l.status} /><Badge tone={l.pricing_mode === "auto" ? "gold" : "neutral"}>{l.pricing_mode === "auto" ? "automatic" : "manual"}</Badge></div></div>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1.2fr]">
              <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-navy-900/60">Current</dt><dd className="font-serif text-2xl font-semibold">{aud(l.current_price_cents)}</dd></div><div><dt className="text-navy-900/60">Suggested</dt><dd className="font-serif text-2xl font-semibold">{aud(s.suggestedCents)} <span className={`text-sm ${diff > 0 ? "text-success" : diff < 0 ? "text-danger" : ""}`}>{diff === 0 ? "" : `${diff > 0 ? "+" : "−"}${aud(Math.abs(diff))}`}</span></dd></div><div><dt className="text-navy-900/60">Your range</dt><dd>{aud(l.min_price_cents, { whole: true })} – {aud(l.max_price_cents, { whole: true })}</dd></div><div><dt className="text-navy-900/60">Rack rate</dt><dd>{aud(l.original_price_cents, { whole: true })}</dd></div></dl>
              <div className="text-sm"><p className="font-medium">Why this suggestion <span className="font-normal text-navy-900/50">({s.model})</span></p>{s.adjustments.length === 0 ? <p className="text-navy-900/60">No adjustments apply — rack rate.</p> : <ul className="mt-1 space-y-0.5">{s.adjustments.map((a) => <li key={a.rule} className="flex justify-between"><span className="capitalize">{a.rule.replace("_", " ")} <span className="text-navy-900/50">· {a.reason}</span></span><span className={a.multiplier >= 1 ? "text-success" : "text-danger"}>{a.multiplier >= 1 ? "+" : "−"}{Math.abs(Math.round((a.multiplier - 1) * 100))}%</span></li>)}</ul>}{s.clampedBy && <p className="mt-1 text-xs text-amber-700">Limited by your {s.clampedBy === "min" ? "minimum" : "maximum"} price.</p>}</div>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-navy-900/10 pt-4">
              <ActionForm action={applySuggestionAction} submit="Apply suggestion" size="sm" variant="gold"><input type="hidden" name="listingId" value={l.id} /></ActionForm>
              <form action={setPricingModeAction}><input type="hidden" name="listingId" value={l.id} /><input type="hidden" name="mode" value={l.pricing_mode === "auto" ? "manual" : "auto"} /><Button size="sm" variant="outline">{l.pricing_mode === "auto" ? "Switch to manual" : "Switch to automatic"}</Button></form>
              <ActionForm action={setPriceAction} submit="Set my price" size="sm" variant="outline" className="flex items-end gap-2"><input type="hidden" name="listingId" value={l.id} /><div><label htmlFor={`p-${l.id}`} className="sr-only">Price in dollars</label><Input id={`p-${l.id}`} name="price" inputMode="decimal" placeholder="$" className="h-9 w-28" /></div></ActionForm>
            </div>
          </li>); })}</ul>)}
    </>
  );
}
