import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { changePasswordAction, updateProfileAction } from "@/app/actions/account";

export const metadata: Metadata = { title: "Profile & preferences" };

export default async function Profile() {
  const u = await requirePermission("customer:account", "/account/profile");
  const p = (await (await getDb()).query<any>("select * from users where id = $1", [u.id])).rows[0];
  const cb = (name: string, label: string, on: boolean) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={on} className="size-4 accent-navy-900" />{label}</label>;
  return (
    <>
      <PageHeader title="Profile & preferences" eyebrow="Account" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Your details</CardTitle></CardHeader><CardBody>
          <ActionForm action={updateProfileAction} submit="Save changes" className="space-y-4">
            <Field label="Full name" htmlFor="name"><Input id="name" name="name" defaultValue={p.name} required /></Field>
            <Field label="Email" htmlFor="email" hint="Contact support to change your sign-in email."><Input id="email" value={p.email} disabled readOnly /></Field>
            <Field label="Mobile (for SMS offers)" htmlFor="phone"><Input id="phone" name="phone" defaultValue={p.phone ?? ""} type="tel" /></Field>
            <fieldset className="space-y-2"><legend className="text-sm font-medium">Notify me by</legend>{cb("notifyEmail", "Email", p.notify_email)}{cb("notifySms", "SMS", p.notify_sms)}{cb("notifyPush", "In-app / push", p.notify_push)}</fieldset>
            <fieldset className="space-y-2"><legend className="text-sm font-medium">Marketing</legend>{cb("marketing", "Occasional last-minute deals and news", p.marketing_opt_in)}<p className="text-xs text-navy-900/60">Booking, waitlist and refund messages are always sent — they&apos;re part of the service.</p></fieldset>
          </ActionForm></CardBody></Card>
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Change password</CardTitle></CardHeader><CardBody><ActionForm action={changePasswordAction} submit="Update password" className="space-y-4" resetOnSuccess>
            <Field label="Current password" htmlFor="current"><Input id="current" name="current" type="password" autoComplete="current-password" required /></Field>
            <Field label="New password" htmlFor="next" hint="At least 10 characters, with letters and numbers."><Input id="next" name="next" type="password" autoComplete="new-password" required minLength={10} /></Field></ActionForm></CardBody></Card>
          <Card><CardHeader><CardTitle>Your data</CardTitle></CardHeader><CardBody className="text-sm"><p>Under the Privacy Act you can access or correct the personal information we hold about you.</p><a className="mt-2 inline-block font-semibold underline" href="/api/account/export">Download my data (JSON)</a><p className="mt-2 text-navy-900/60">To delete your account, contact support — we&apos;ll remove personal data we&apos;re not legally required to keep (such as tax records).</p></CardBody></Card>
        </div>
      </div>
    </>
  );
}
