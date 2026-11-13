import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Select, Table, TD, TH } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { describeRule } from "@/lib/domain/fees";
import { aud, fmtDate } from "@/lib/util";
import { deactivateFeeRuleAction, saveFeeRuleAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "Commission settings" };

export default async function Commissions() {
  await requirePermission("admin:config", "/admin/commissions");
  const db = await getDb();
  const rules = (await db.query<any>("select f.*, p.business_name from fee_rules f left join partners p on p.id = f.partner_id where f.active order by f.payer, f.applies_to, case f.scope when 'partner' then 1 when 'category' then 2 else 3 end, f.category")).rows;
  const partners = (await db.query<any>("select id, business_name from partners order by business_name")).rows;
  return (
    <>
      <PageHeader title="Commission settings" eyebrow="Configurable — nothing is hard-coded" />
      <p className="mb-6 max-w-3xl text-sm text-navy-900/75">The most specific active rule wins: <strong>partner → category → global</strong>. Saving a rule replaces the previous one for that exact scope (kept in the audit log) and applies to future bookings only; past bookings keep the fees they were charged. Amounts are GST-inclusive.</p>
      <div className="card mb-8 p-2"><Table><thead><tr><TH>Payer</TH><TH>Applies to</TH><TH>Scope</TH><TH>Rule</TH><TH>Min / max</TH><TH>Since</TH><TH><span className="sr-only">Actions</span></TH></tr></thead><tbody>
        {rules.map((r) => <tr key={r.id}><TD className="capitalize">{r.payer}</TD><TD className="capitalize">{r.applies_to}</TD><TD>{r.scope === "global" ? <Badge>global</Badge> : r.scope === "category" ? <Badge tone="gold" className="capitalize">{r.category}</Badge> : <Badge tone="navy">{r.business_name}</Badge>}</TD><TD className="font-medium">{describeRule(r)}</TD><TD className="text-xs">{r.min_cents ? aud(r.min_cents) : "—"} / {r.max_cents != null ? aud(r.max_cents) : "—"}</TD><TD className="text-xs">{fmtDate(r.created_at)}</TD>
          <TD>{r.scope !== "global" && <form action={deactivateFeeRuleAction}><input type="hidden" name="ruleId" value={r.id} /><Button size="sm" variant="ghost">Remove</Button></form>}</TD></tr>)}</tbody></Table></div>
      <Card><CardHeader><CardTitle>Add or change a rule</CardTitle></CardHeader><CardBody>
        <ActionForm action={saveFeeRuleAction} submit="Save rule" variant="gold" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Who pays" htmlFor="payer"><Select id="payer" name="payer"><option value="partner">Partner (commission)</option><option value="customer">Customer (service fee)</option></Select></Field>
            <Field label="Applies to" htmlFor="appliesTo"><Select id="appliesTo" name="appliesTo"><option value="booking">Standard booking</option><option value="buyback">Buyback resale</option><option value="resale">Regulated event resale</option></Select></Field>
            <Field label="Scope" htmlFor="scope"><Select id="scope" name="scope"><option value="global">Global default</option><option value="category">Category</option><option value="partner">Specific partner</option></Select></Field>
            <Field label="Category (if category)" htmlFor="category"><Select id="category" name="category"><option value="">—</option><option value="hotel">Hotel</option><option value="restaurant">Restaurant</option><option value="event">Event</option></Select></Field>
          </div>
          <Field label="Partner (if specific partner)" htmlFor="partnerId"><Select id="partnerId" name="partnerId"><option value="">—</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.business_name}</option>)}</Select></Field>
          <div className="grid gap-3 sm:grid-cols-5">
            <Field label="Type" htmlFor="kind"><Select id="kind" name="kind"><option value="percentage">Percentage</option><option value="fixed">Fixed fee</option><option value="percent_plus_fixed">Percentage + fixed</option></Select></Field>
            <Field label="Rate (%)" htmlFor="ratePct"><Input id="ratePct" name="ratePct" type="number" step="0.01" min={0} max={100} defaultValue={0} /></Field>
            <Field label="Fixed ($)" htmlFor="fixed"><Input id="fixed" name="fixed" inputMode="decimal" placeholder="0.00" /></Field>
            <Field label="Minimum ($)" htmlFor="min"><Input id="min" name="min" inputMode="decimal" placeholder="0.00" /></Field>
            <Field label="Maximum ($)" htmlFor="max"><Input id="max" name="max" inputMode="decimal" placeholder="none" /></Field>
          </div>
          <Field label="Note" htmlFor="note"><Input id="note" name="note" /></Field>
        </ActionForm></CardBody></Card>
    </>
  );
}
