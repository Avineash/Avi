import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, CardHeader, CardTitle, Field, Input, Textarea } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/session";
import { getListingDetail } from "@/lib/domain/search";
import { WAITLIST_POLICY_TEXT } from "@/lib/domain/waitlist";
import { aud, fmtDateTime } from "@/lib/util";
import { joinWaitlistAction } from "@/app/actions/waitlist";

export const metadata: Metadata = { title: "Join the waitlist" };

export default async function WaitlistPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(listingId)) notFound();
  const user = await requireUser(`/waitlist/${listingId}`);
  const l = await getListingDetail(listingId, user.id);
  if (!l) notFound();
  return (
    <div className="container-page max-w-3xl py-10">
      <p className="eyebrow">Waitlist registration</p>
      <h1 className="mt-1 text-3xl font-semibold">{l.title}</h1>
      <p className="text-navy-900/70">{l.venue_name} · {fmtDateTime(l.starts_at)}</p>
      {l.available_units > 0 ? <Card className="mt-6 p-6"><p>There&apos;s still availability — <Link className="underline" href={`/listings/${l.id}`}>book it now</Link>.</p></Card>
      : l.waitlistEntry ? <Card className="mt-6 p-6"><p className="font-semibold text-success">You&apos;re already on this waitlist.</p><Link href="/account/waitlists" className="underline">Manage my waitlists</Link></Card> : (
        <Card className="mt-6">
          <CardHeader><CardTitle>Tell us what you&apos;d like</CardTitle></CardHeader>
          <CardBody>
            <ActionForm action={joinWaitlistAction} submit="Join the waitlist" variant="gold" size="lg" className="space-y-5">
              <input type="hidden" name="listingId" value={l.id} />
              <Field label="Your maximum price (optional)" htmlFor="maxPrice" hint={<>Current price is {aud(l.current_price_cents)} plus a {aud(l.customerFeeCents)} service fee. Leave blank to accept the listed price. <strong>You will never be charged more than the offer price shown to you.</strong></>}>
                <div className="relative"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-900/50">$</span><Input id="maxPrice" name="maxPrice" inputMode="decimal" placeholder={String(Math.round(l.current_price_cents / 100))} className="pl-7" /></div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Guests" htmlFor="guests"><Input id="guests" name="guests" type="number" min={1} max={20} defaultValue={2} /></Field>
                <Field label="Preferred time / flexibility" htmlFor="timePref"><Input id="timePref" name="timePref" placeholder="e.g. any time after 7pm" /></Field>
              </div>
              <Field label="Note for the venue (optional)" htmlFor="note"><Textarea id="note" name="note" rows={2} maxLength={300} /></Field>
              <fieldset className="space-y-2"><legend className="text-sm font-medium">Notify me by</legend>
                {[["notifyEmail", "Email", true], ["notifyPush", "Push notification (in-app)", true], ["notifySms", "SMS (requires a mobile number in your profile)", false]].map(([n, label, d]) => (
                  <label key={String(n)} className="flex items-center gap-2 text-sm"><input type="checkbox" name={String(n)} defaultChecked={Boolean(d)} className="size-4 accent-navy-900" />{label}</label>))}
              </fieldset>
              <div className="rounded-xl bg-ivory-100 p-4 text-sm"><p className="font-semibold">How priority works</p><p className="mt-1 text-navy-900/80">{WAITLIST_POLICY_TEXT[l.waitlist_policy]}</p><p className="mt-2 text-navy-900/70">If a place opens you&apos;ll have {l.offer_window_minutes} minutes to accept and pay. Declining or missing an offer doesn&apos;t affect your account.</p></div>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
