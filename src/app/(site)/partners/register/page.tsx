import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { registerPartnerAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Partner application" };

export default function RegisterPartner() {
  return (
    <div className="container-page max-w-2xl py-12">
      <p className="eyebrow">Partner application</p><h1 className="mt-1 text-3xl font-semibold">Tell us about your business</h1>
      <p className="mt-2 text-navy-900/70">We verify every partner&apos;s ABN and documents before anything goes live.</p>
      <Card className="mt-6"><CardBody className="p-6">
        <ActionForm action={registerPartnerAction} submit="Submit application" variant="gold" size="lg" submitClassName="w-full" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Your name" htmlFor="name"><Input id="name" name="name" required /></Field><Field label="Work email" htmlFor="email"><Input id="email" name="email" type="email" required /></Field></div>
          <Field label="Password" htmlFor="password" hint="At least 10 characters, with letters and numbers."><Input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Business / legal name" htmlFor="businessName"><Input id="businessName" name="businessName" required /></Field><Field label="ABN" htmlFor="abn" hint="11 digits — validated against the ATO checksum."><Input id="abn" name="abn" inputMode="numeric" placeholder="51 824 753 556" required /></Field></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="What do you offer?" htmlFor="category"><Select id="category" name="category"><option value="hotel">Hotel / accommodation</option><option value="restaurant">Restaurant / dining</option><option value="event">Event / experience organiser</option></Select></Field><Field label="Phone" htmlFor="contactPhone"><Input id="contactPhone" name="contactPhone" type="tel" /></Field></div>
          <Field label="Website" htmlFor="website"><Input id="website" name="website" type="url" placeholder="https://" /></Field>
          <Field label="About your business" htmlFor="description"><Textarea id="description" name="description" rows={3} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="gst" defaultChecked className="size-4 accent-navy-900" />My business is registered for GST</label>
          <fieldset className="rounded-xl border border-navy-900/15 p-4"><legend className="px-1 text-sm font-medium">Verification document</legend>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Document type" htmlFor="docType"><Select id="docType" name="docType"><option value="abn_certificate">ABN registration</option><option value="business_licence">Business licence</option><option value="liquor_licence">Liquor licence</option><option value="insurance">Public liability insurance</option><option value="id_document">Director ID</option><option value="other">Other</option></Select></Field>
              <Field label="File (PDF, PNG or JPEG, max 5 MB)" htmlFor="docs"><Input id="docs" name="docs" type="file" accept="application/pdf,image/png,image/jpeg" required className="py-2" /></Field></div></fieldset>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="terms" required className="mt-1 size-4 accent-navy-900" /><span>I&apos;m authorised to bind this business and accept the Partner Agreement and commission schedule.</span></label>
        </ActionForm>
      </CardBody></Card>
    </div>
  );
}
