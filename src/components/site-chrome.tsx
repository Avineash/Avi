import Link from "next/link";
import { Bell, Heart, Menu, User } from "lucide-react";
import { getUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { homeFor } from "@/lib/auth/rbac";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/actions/auth";
import { SANDBOX_NOTICE } from "@/lib/domain/legal";
import { isSandbox } from "@/lib/providers/payments";

export function Logo({ light }: { light?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Eleventh Hour — home">
      <span className="grid size-9 place-items-center rounded-full border border-gold-500 bg-navy-900 font-serif text-sm font-semibold text-gold-300">11</span>
      <span className={`font-serif text-xl font-semibold tracking-tight ${light ? "text-ivory" : "text-navy-900"}`}>Eleventh Hour</span>
    </Link>
  );
}

export function SandboxBanner() {
  if (process.env.NEXT_PUBLIC_SANDBOX === "false" && !isSandbox()) return null;
  return (
    <div role="note" className="bg-gold-500 px-4 py-1.5 text-center text-xs font-medium text-navy-950">
      <span className="font-semibold uppercase tracking-wider">Sandbox</span> — {SANDBOX_NOTICE}
    </div>
  );
}

const NAV = [
  { href: "/hotels", label: "Hotels" }, { href: "/restaurants", label: "Dining" }, { href: "/events", label: "Events" },
  { href: "/how-it-works", label: "How it works" }, { href: "/partners", label: "For partners" },
];

export async function SiteHeader() {
  const user = await getUser();
  let unread = 0;
  if (user) unread = Number((await (await getDb()).query<any>("select count(*)::int n from notifications where user_id = $1 and read_at is null", [user.id])).rows[0].n);
  return (
    <header className="sticky top-0 z-40 border-b border-navy-900/10 bg-ivory-100/90 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="rounded-full px-3.5 py-2 text-sm font-medium text-navy-800 hover:bg-navy-900/5">{n.label}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Link href="/account/saved" aria-label="Saved experiences" className="hidden rounded-full p-2 hover:bg-navy-900/5 sm:block"><Heart className="size-5" /></Link>
              <Link href="/account/offers" aria-label={`Offers and notifications${unread ? ` (${unread} unread)` : ""}`} className="relative rounded-full p-2 hover:bg-navy-900/5">
                <Bell className="size-5" />{unread > 0 && <span className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-gold-500 text-[10px] font-bold text-navy-950">{unread > 9 ? "9+" : unread}</span>}
              </Link>
              <Button asChild size="sm" variant="outline"><Link href={homeFor(user.role)}><User /> {user.name.split(" ")[0]}</Link></Button>
              <form action={logoutAction}><Button size="sm" variant="ghost" type="submit">Sign out</Button></form>
            </>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost"><Link href="/login">Sign in</Link></Button>
              <Button asChild size="sm"><Link href="/register">Create account</Link></Button>
            </>
          )}
          <details className="relative md:hidden">
            <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-full hover:bg-navy-900/5" aria-label="Menu"><Menu className="size-5" /></summary>
            <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-navy-900/10 bg-white p-2 shadow-card">
              {NAV.map((n) => <Link key={n.href} href={n.href} className="block rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-navy-900/5">{n.label}</Link>)}
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const col = (title: string, links: Array<[string, string]>) => (
    <div>
      <h2 className="font-sans text-xs font-semibold uppercase tracking-[0.16em] text-gold-300">{title}</h2>
      <ul className="mt-3 space-y-2 text-sm">{links.map(([h, l]) => <li key={h}><Link href={h} className="text-ivory/80 hover:text-white">{l}</Link></li>)}</ul>
    </div>
  );
  return (
    <footer className="mt-24 bg-navy-950 text-ivory">
      <div className="container-page grid gap-10 py-14 md:grid-cols-5">
        <div className="md:col-span-2">
          <Logo light />
          <p className="mt-4 max-w-sm text-sm text-ivory/70">Last-minute hotel rooms, tables and tickets from verified Melbourne venues — priced honestly, with every fee shown up front.</p>
          <p className="mt-6 text-xs text-ivory/50">Prices in AUD, GST included. Prepared for Australian operations under the Australian Consumer Law.</p>
        </div>
        {col("Explore", [["/hotels", "Hotels"], ["/restaurants", "Dining"], ["/events", "Events"], ["/search", "Search all"]])}
        {col("Company", [["/about", "About us"], ["/how-it-works", "How it works"], ["/partners", "Become a partner"], ["/contact", "Contact & support"]])}
        {col("Legal", [["/legal/terms", "Terms"], ["/legal/privacy", "Privacy"], ["/legal/cancellation", "Cancellation policy"], ["/legal/refunds", "Refund policy"]])}
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-ivory/50">© {new Date().getFullYear()} Eleventh Hour. Not a substitute for legal advice — see the compliance notes in the repository docs.</div>
    </footer>
  );
}
