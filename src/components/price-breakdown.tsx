import { aud } from "@/lib/util";

/** Full price + mandatory fees, shown before any payment is taken (ACL drip-pricing rules). */
export function PriceBreakdown({ rows, total, gstCents, note }: { rows: Array<{ label: string; cents: number; hint?: string }>; total: number; gstCents?: number; note?: string }) {
  return (
    <dl className="space-y-2 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-4"><dt className="text-navy-900/75">{r.label}{r.hint && <span className="block text-xs text-navy-900/50">{r.hint}</span>}</dt><dd className="tabular-nums">{aud(r.cents)}</dd></div>
      ))}
      <div className="flex justify-between border-t border-navy-900/15 pt-2 text-base font-semibold"><dt>Total to pay (AUD)</dt><dd className="tabular-nums">{aud(total)}</dd></div>
      {gstCents != null && <p className="text-xs text-navy-900/55">Includes GST of {aud(gstCents)}. {note}</p>}
    </dl>
  );
}
