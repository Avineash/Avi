import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, Field, Input } from "@/components/ui/primitives";
import { registerAction } from "@/app/actions/auth";
import { OAuthButtons } from "@/components/oauth-buttons";

export const metadata: Metadata = { title: "Create your account" };

export default async function Register({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="container-page max-w-lg py-14">
      <h1 className="text-3xl font-semibold">Create your account</h1>
      <p className="mt-1 text-navy-900/70">Buy last-minute stays, tables and tickets — or sell the ones you can\u2019t use.</p>
      <Card className="mt-6"><CardBody className="space-y-5 p-6">
        <ActionForm action={registerAction} submit="Create account" size="lg" submitClassName="w-full" className="space-y-4">
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="Full name" htmlFor="name"><Input id="name" name="name" autoComplete="name" required /></Field>
          <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
          <Field label="Mobile (optional, for SMS offers)" htmlFor="phone"><Input id="phone" name="phone" type="tel" autoComplete="tel" /></Field>
          <Field label="Password" htmlFor="password" hint="At least 10 characters, with letters and numbers."><Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="terms" required className="mt-1 size-4 accent-navy-900" /><span>I accept the <Link href="/legal/terms" className="underline">Terms</Link> and <Link href="/legal/privacy" className="underline">Privacy Policy</Link>.</span></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="marketing" className="mt-1 size-4 accent-navy-900" /><span>Send me occasional last-minute deals (optional — you can change this any time).</span></label>
        </ActionForm>
        <OAuthButtons />
      </CardBody></Card>
      <p className="mt-4 text-sm">Already have an account? <Link className="font-semibold underline" href="/login">Sign in</Link></p>
    </div>
  );
}
