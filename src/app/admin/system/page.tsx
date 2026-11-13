import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Table, TD, TH } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/domain/settings";
import { LEGAL_REVIEW_NOTICE } from "@/lib/domain/legal";
import { isSandbox } from "@/lib/providers/payments";
import { fmtDateTime } from "@/lib/util";
import { featureGateAction, runMaintenanceAction, systemSettingsAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "System configuration" };

const GATES = [
  { key: "features.buyback", title: "Customer buyback", desc: "Lets partners send opted-in customers an optional offer to release a confirmed booking for a full refund plus compensation." },
  { key: "features.auto_reallocation", title: "Automated reallocation", desc: "Reserved for future automated reallocation features. Nothing in this release uses it; keep it off until reviewed." },
  { key: "features.event_resale", title: "Regulated event ticket resale", desc: "Allows ticket buyback/resale for events, capped at a multiple of face value under state ticket-scalping laws." },
] as const;

export default async function System() {
  await requirePermission("admin:config", "/admin/system");
  const db = await getDb();
  const gates = await Promise.all(GATES.map(async (g) => ({ ...g, v: await getSetting<any>(db, g.key, { enabled: false, legal_review_ref: null }) })));
  const hold = await getSetting<any>(db, "booking.hold_minutes", { minutes: 10 }), proc = await getSetting<any>(db, "payments.processing", { bps: 175, fixed_cents: 30 });
  const terms = await getSetting<any>(db, "legal.terms_version", { version: "" }), lim = await getSetting<any>(db, "buyback.limits", { max_offers_per_reservation: 2, customer_response_hours: 24 }), pb = await getSetting<any>(db, "pricing.bounds", { min_multiplier: 0.6, max_multiplier: 1.5 });
  const audit = (await db.query<any>("select a.*, u.email from audit_logs a left join users u on u.id = a.actor_id order by a.id desc limit 40")).rows;
  const ie = (await db.query<any>("select * from integration_events order by id desc limit 10")).rows;
  const integrations = [
    ["Payments", isSandbox() ? "Sandbox provider (no real money)" : "Stripe Connect", isSandbox() ? "warn" : "success"],
    ["Stripe webhook", process.env.STRIPE_WEBHOOK_SECRET ? "Configured" : "Not configured", process.env.STRIPE_WEBHOOK_SECRET ? "success" : "neutral"],
    ["Email (Resend)", process.env.RESEND_API_KEY ? "Configured" : "Not configured — in-app only", process.env.RESEND_API_KEY ? "success" : "warn"],
    ["SMS (Twilio)", process.env.TWILIO_ACCOUNT_SID ? "Configured" : "Not configured", process.env.TWILIO_ACCOUNT_SID ? "success" : "neutral"],
    ["Database", db.kind === "pg" ? "PostgreSQL" : "Embedded PGlite (in-memory demo)", db.kind === "pg" ? "success" : "warn"],
    ["Background jobs", process.env.CRON_SECRET ? "Cron endpoint secured" : "CRON_SECRET not set", "neutral"],
    ["Maps", "Built-in SVG map (swap for Mapbox / Google Maps with an API key)", "neutral"],
    ["PMS / channel manager", "Planned — connector interface not built yet", "neutral"],
  ] as const;
  return (
    <>
      <PageHeader title="System configuration" eyebrow="Settings · legal gates · integrations · audit" />
      <p className="mb-6 rounded-xl border border-gold-500/40 bg-gold-300/15 p-4 text-sm">{LEGAL_REVIEW_NOTICE}</p>
      <section aria-labelledby="gates" className="grid gap-4 lg:grid-cols-3"><h2 id="gates" className="sr-only">Legal feature gates</h2>
        {gates.map((g) => (
          <Card key={g.key} className="p-5"><div className="flex items-start justify-between gap-2"><h3 className="font-serif text-lg font-semibold">{g.title}</h3><Badge tone={g.v.enabled && g.v.legal_review_ref ? "success" : "danger"}>{g.v.enabled && g.v.legal_review_ref ? "ON" : "OFF"}</Badge></div><p className="mt-1 text-sm text-navy-900/70">{g.desc}</p>
            {g.v.legal_review_ref && <p className="mt-2 text-xs">Legal review ref: <strong>{g.v.legal_review_ref}</strong>{g.v.approved_at ? ` · ${fmtDateTime(g.v.approved_at)}` : ""}</p>}
            <ActionForm action={featureGateAction} submit="Update" size="sm" variant="outline" className="mt-3 space-y-3"><input type="hidden" name="key" value={g.key} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={!!g.v.enabled} className="size-4 accent-navy-900" />Enabled</label>
              <Field label="Legal review reference" htmlFor={`ref-${g.key}`}><Input id={`ref-${g.key}`} name="ref" defaultValue={g.v.legal_review_ref ?? ""} placeholder="e.g. Matter 2026-114, memo 14 Nov" /></Field>
              {g.key === "features.event_resale" && <Field label="Resale cap (% of face value)" htmlFor="capPct"><Input id="capPct" name="capPct" type="number" defaultValue={(g.v.cap_bps ?? 11000) / 100} min={100} max={200} /></Field>}</ActionForm></Card>))}
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Platform settings</CardTitle></CardHeader><CardBody>
          <ActionForm action={systemSettingsAction} submit="Save settings" className="space-y-3"><div className="grid gap-3 sm:grid-cols-2">
            <Field label="Checkout hold (minutes)" htmlFor="holdMinutes"><Input id="holdMinutes" name="holdMinutes" type="number" defaultValue={hold.minutes} /></Field>
            <Field label="Terms version" htmlFor="termsVersion" hint="Stored with every consent."><Input id="termsVersion" name="termsVersion" defaultValue={terms.version} /></Field>
            <Field label="Processing fee (bps)" htmlFor="procBps" hint="Non-refundable cost used in buyback maths."><Input id="procBps" name="procBps" type="number" step="0.01" defaultValue={proc.bps} /></Field>
            <Field label="Processing fixed ($)" htmlFor="procFixed"><Input id="procFixed" name="procFixed" defaultValue={(proc.fixed_cents / 100).toFixed(2)} /></Field>
            <Field label="Max buyback offers / booking" htmlFor="maxOffers"><Input id="maxOffers" name="maxOffers" type="number" defaultValue={lim.max_offers_per_reservation} /></Field>
            <Field label="Customer response window (hours)" htmlFor="responseHours"><Input id="responseHours" name="responseHours" type="number" defaultValue={lim.customer_response_hours} /></Field>
            <Field label="Pricing: min multiplier" htmlFor="minMult"><Input id="minMult" name="minMult" type="number" step="0.01" defaultValue={pb.min_multiplier} /></Field>
            <Field label="Pricing: max multiplier" htmlFor="maxMult"><Input id="maxMult" name="maxMult" type="number" step="0.01" defaultValue={pb.max_multiplier} /></Field></div></ActionForm></CardBody></Card>
        <Card><CardHeader><CardTitle>Integrations & jobs</CardTitle></CardHeader><CardBody>
          <ul className="divide-y divide-navy-900/10 text-sm">{integrations.map(([n, d, t]) => <li key={n} className="flex items-center justify-between gap-3 py-2"><span className="font-medium">{n}</span><Badge tone={t as any}>{d}</Badge></li>)}</ul>
          <ActionForm action={runMaintenanceAction} submit="Run background jobs now" size="sm" variant="outline" className="mt-4" /><p className="mt-2 text-xs text-navy-900/60">Expires holds & offers, reconciles refunds/compensation, completes finished stays, re-prices auto listings, flushes notifications.</p>
          {ie.length > 0 && <><h3 className="mt-4 text-sm font-semibold">Recent integration events</h3><ul className="mt-1 space-y-1 text-xs">{ie.map((e) => <li key={e.id}><Badge tone={e.level === "error" ? "danger" : "neutral"}>{e.integration}</Badge> {e.message} <span className="text-navy-900/50">{fmtDateTime(e.created_at)}</span></li>)}</ul></>}
        </CardBody></Card>
      </div>

      <Card className="mt-8"><CardHeader><CardTitle>Audit log</CardTitle><p className="text-sm text-navy-900/60">Append-only — a database trigger rejects edits and deletes.</p></CardHeader><CardBody><Table><thead><tr><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Entity</TH><TH>Detail</TH></tr></thead><tbody>{audit.map((a) => <tr key={a.id}><TD className="whitespace-nowrap text-xs">{fmtDateTime(a.created_at)}</TD><TD className="text-xs">{a.email ?? a.actor_role ?? "system"}</TD><TD className="font-mono text-xs">{a.action}</TD><TD className="text-xs">{a.entity}</TD><TD className="max-w-xs truncate text-xs text-navy-900/60">{JSON.stringify(a.meta)}</TD></tr>)}</tbody></Table></CardBody></Card>
    </>
  );
}
