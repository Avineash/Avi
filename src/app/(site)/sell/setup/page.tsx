import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, Field, Input, Textarea } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getSeller } from "@/lib/domain/resale";
import { becomeSellerAction } from "@/app/actions/resale";

export const metadata: Metadata = { title: "Seller profile" };

export default async function Setup({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const user = await requireUser("/sell/setup");
  const s = await getSeller(await getDb(), user.id);
  return (
    <div className="container-page max-w-2xl py-12">
      <p className="eyebrow">Seller profile</p><h1 className="h-section mt-2">{s ? "Your seller profile" : "Become a seller"}</h1>
      <p className="mt-3 text-navy-900/70">Buyers see your public name and rating. Your mobile number stays private — we use it only for urgent issues with a sale.</p>
      <Card className="mt-8"><CardBody className="p-7">
        <ActionForm action={becomeSellerAction} submit={s ? "Save profile" : "Save and continue"} variant="gold" size="lg" className="space-y-5">
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="Public name" htmlFor="displayName" hint="Shown on your listings, e.g. “Sam T.” — avoid your full name if you prefer."><Input id="displayName" name="displayName" defaultValue={s?.display_name ?? user.name.split(" ")[0]} required maxLength={40} /></Field>
          <Field label="Mobile" htmlFor="phone"><Input id="phone" name="phone" type="tel" defaultValue={s?.phone ?? ""} placeholder="+61 4xx xxx xxx" required autoComplete="tel" /></Field>
          <Field label="About you (optional)" htmlFor="bio"><Textarea id="bio" name="bio" rows={2} maxLength={400} defaultValue={s?.bio ?? ""} /></Field>
          <Field label="Payout details (optional)" htmlFor="payoutHint" hint="Only a masked hint is stored here, e.g. “CommBank •••• 456”. Real payouts go through Stripe once connected; in the sandbox payouts are simulated."><Input id="payoutHint" name="payoutHint" defaultValue={s?.payout_hint ?? ""} maxLength={60} /></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="terms" required defaultChecked={!!s} className="mt-1 size-4 accent-navy-900" /><span>I accept the <Link href="/legal/terms" className="underline">Seller Terms</Link>: I only list bookings I hold and am permitted to transfer, I deliver on time, and failed deliveries are refunded and recorded as strikes.</span></label>
        </ActionForm>
      </CardBody></Card>
    </div>
  );
}
