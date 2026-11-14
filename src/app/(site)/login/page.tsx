import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, Field, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/rbac";
import { loginAction } from "@/app/actions/auth";
import { OAuthButtons } from "@/components/oauth-buttons";
import { isFull } from "@/lib/phase";

export const metadata: Metadata = { title: "Sign in" };
const DEMO_FULL = [["Customer (the $180 room)", "ava@eleventhhour.test"], ["Customer (waitlisted at $300)", "ben@eleventhhour.test"], ["Hotel partner", "hotel@eleventhhour.test"], ["Restaurant partner", "restaurant@eleventhhour.test"], ["Events partner", "events@eleventhhour.test"], ["Administrator", "admin@eleventhhour.test"]];

const DEMO_MARKET = [["Buyer — has a purchase awaiting delivery", "ava@eleventhhour.test"], ["Buyer — has one to confirm", "ben@eleventhhour.test"], ["Seller — has sales to deliver", "chloe@eleventhhour.test"], ["Seller — has funds in escrow", "dev@eleventhhour.test"], ["Seller — 5-star reviews", "maya@eleventhhour.test"]];

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const u = await getUser();
  if (u) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : homeFor(u.role));
  return (
    <div className="container-page grid max-w-5xl gap-8 py-14 md:grid-cols-2">
      <div>
        <h1 className="text-3xl font-semibold">Welcome back</h1>
        <Card className="mt-6"><CardBody className="space-y-5 p-6">
          <ActionForm action={loginAction} submit="Sign in" size="lg" submitClassName="w-full" className="space-y-4">
            <input type="hidden" name="next" value={next ?? ""} />
            <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
            <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
          </ActionForm>
          <div className="relative text-center text-xs text-navy-900/50"><span className="bg-white px-2">or</span></div>
          <OAuthButtons />
        </CardBody></Card>
        <p className="mt-4 text-sm">New here? <Link className="font-semibold underline" href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>{isFull() && <> · Hotel, restaurant or event business? <Link className="font-semibold underline" href="/partners/register">Apply as a partner</Link></>}</p>
      </div>
      {process.env.NEXT_PUBLIC_SANDBOX !== "false" && (
        <Card className="h-fit border-gold-500/40 bg-gold-300/10 p-6">
          <p className="eyebrow">Sandbox demo accounts</p>
          <p className="mt-1 text-sm text-navy-900/70">Seeded demo data. Password for all: <code className="rounded bg-white px-1.5 py-0.5 font-mono">Password123!</code></p>
          <ul className="mt-4 space-y-2 text-sm">{(isFull() ? DEMO_FULL : DEMO_MARKET).map(([r, e]) => <li key={e} className="flex justify-between gap-3 border-b border-navy-900/10 pb-2"><span>{r}</span><code className="font-mono text-xs">{e}</code></li>)}</ul>
        </Card>
      )}
    </div>
  );
}
