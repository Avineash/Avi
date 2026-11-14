import Link from "next/link";
import { ArrowUpRight, Bell, Heart, Menu, User } from "lucide-react";
import { getUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { homeFor } from "@/lib/auth/rbac";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/actions/auth";
import { SANDBOX_NOTICE } from "@/lib/domain/legal";
import { isSandbox } from "@/lib/providers/payments";
import { isFull } from "@/lib/phase";

export function Logo({ light }: { light?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Eleventh Hour — home">
      <span className="gold-gradient grid size-9 shrink-0 place-items-center rounded-full font-serif text-[13px] font-semibold text-navy-950 shadow-[inset_0_1px_0_rgba(255,255,255,.5)]">11</span>
      <span className={`whitespace-nowrap font-serif text-[1.15rem] font-medium tracking-tight ${light ? "text-ivory" : "text-navy-900"}`}>Eleventh Hour</span>
    </Link>
  );
}

export function SandboxBanner() {
  if (process.env.NEXT_PUBLIC_SANDBOX === "false" && !isSandbox()) return null;
  return (
    <div role="note" className="bg-navy-950 px-4 py-1.5 text-center text-[11px] font-medium text-gold-300"><span aria-hidden className="mr-2 inline-block size-1.5 animate-pulse rounded-full bg-gold-400 align-middle" />
      <span className="font-semibold uppercase tracking-[0.18em]">Sandbox</span> <span className="text-ivory/70">— {SANDBOX_NOTICE}</span>
    </div>
  );
}

const NAV_FULL = [
  { href: "/hotels", label: "Hotels" }, { href: "/restaurants", label: "Dining" }, { href: "/events", label: "Events" },
  { href: "/how-it-works", label: "How it works" }, { href: "/partners", label: "For partners" },
];
const NAV_MARKET = [
  { href: "/hotels", label: "Hotels" }, { href: "/restaurants", label: "Dining" }, { href: "/events", label: "Events" },
  { href: "/sell", label: "Sell" }, { href: "/how-it-works", label: "How it works" },
];

export async function SiteHeader() {
  const NAV = isFull() ? NAV_FULL : NAV_MARKET;
  const user = await getUser();
  let unread = 0;
  if (user) unread = Number((await (await getDb()).query<any>("select count(*)::int n from notifications where user_id = $1 and read_at is null", [user.id])).rows[0].n);
  return (
    <header className="sticky top-3 z-50 px-3 pt-3 sm:px-6">
      <div className="glass-light mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 rounded-full py-2 pl-4 pr-2 shadow-[0_10px_40px_-14px_rgba(11,27,51,.35)]">
        <Logo />
        <nav aria-label="Main" className="hidden items-center md:flex">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="rounded-full px-3.5 py-2 text-sm font-medium text-navy-800 transition-colors hover:bg-navy-900/[.06]">{n.label}</Link>)}
        </nav>
        <div className="flex items-center gap-1.5">
          {user ? (
            <>
              <Link href="/account/saved" aria-label="Saved listings" className="hidden rounded-full p-2 hover:bg-navy-900/5 sm:block"><Heart className="size-[18px]" /></Link>
              <Link href={isFull() ? "/account/offers" : "/account/notifications"} aria-label={`Offers and notifications${unread ? ` (${unread} unread)` : ""}`} className="relative rounded-full p-2 hover:bg-navy-900/5">
                <Bell className="size-[18px]" />{unread > 0 && <span className="absolute right-0 top-0 grid size-4 place-items-center rounded-full bg-gold-500 text-[10px] font-bold text-navy-950">{unread > 9 ? "9+" : unread}</span>}
              </Link>
              {!isFull() && <Button asChild size="sm" variant="gold" className="hidden sm:inline-flex"><Link href="/sell/new">Sell</Link></Button>}
              <Button asChild size="sm" variant="default"><Link href={homeFor(user.role)}><User /> {user.name.split(" ")[0]}</Link></Button>
              <form action={logoutAction} className="hidden sm:block"><Button size="sm" variant="ghost" type="submit">Sign out</Button></form>
            </>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex"><Link href="/login">Sign in</Link></Button>
              <Button asChild size="sm" variant="default"><Link href="/register">Get started <ArrowUpRight className="arrow" /></Link></Button>
            </>
          )}
          <details className="relative md:hidden">
            <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-full hover:bg-navy-900/5" aria-label="Menu"><Menu className="size-5" /></summary>
            <div className="absolute right-0 mt-3 w-60 rounded-3xl border border-navy-900/10 bg-white p-2 shadow-float">
              {NAV.map((n) => <Link key={n.href} href={n.href} className="block rounded-2xl px-4 py-3 text-sm font-medium hover:bg-navy-900/5">{n.label}</Link>)}
              {!user && <Link href="/login" className="block rounded-2xl px-4 py-3 text-sm font-medium hover:bg-navy-900/5">Sign in</Link>}
              {user && <form action={logoutAction}><button className="block w-full rounded-2xl px-4 py-3 text-left text-sm font-medium hover:bg-navy-900/5">Sign out</button></form>}
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
      <h2 className="eyebrow-dark font-sans">{title}</h2>
      <ul className="mt-4 space-y-2.5 text-sm">{links.map(([h, l]) => <li key={h}><Link href={h} className="text-ivory/75 transition-colors hover:text-gold-300">{l}</Link></li>)}</ul>
    </div>
  );
  return (
    <footer className="relative mt-28 overflow-hidden bg-navy-950 text-ivory grain">
      <div aria-hidden className="pointer-events-none absolute -left-40 top-0 size-[32rem] rounded-full bg-gold-500/10 blur-3xl" />
      <div className="container-page relative grid gap-12 pb-10 pt-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo light />
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-ivory/70">Buy and sell last-minute hotel stays, restaurant tables and event tickets — protected by escrow, priced honestly, with every fee shown up front.</p>
          <p className="mt-6 max-w-sm text-xs leading-relaxed text-ivory/45">Resale is only possible for venues registered with Eleventh Hour. Prices in AUD; platform fees include GST.</p>
        </div>
        {col("Buy", [["/hotels", "Hotels"], ["/restaurants", "Dining"], ["/events", "Events"], ["/search", "Search all"]])}
        {col(isFull() ? "Company" : "Sell & help", isFull() ? [["/about", "About us"], ["/how-it-works", "How it works"], ["/partners", "Become a partner"], ["/contact", "Contact & support"]] : [["/sell", "Sell a booking"], ["/how-it-works", "How it works"], ["/about", "About us"], ["/contact", "Contact & support"]])}
        {col("Legal", [["/legal/terms", "Terms"], ["/legal/privacy", "Privacy"], ["/legal/cancellation", "Cancellation policy"], ["/legal/refunds", "Refund policy"]])}
      </div>
      <p aria-hidden className="select-none whitespace-nowrap px-4 text-center font-serif leading-[.8] tracking-[-0.05em] text-transparent [-webkit-text-stroke:1px_rgba(224,203,151,.28)]" style={{ fontSize: "clamp(3.5rem, 15.5vw, 15rem)" }}>Eleventh Hour</p>
      <div className="relative border-t border-white/10 py-5 text-center text-xs text-ivory/45">© {new Date().getFullYear()} Eleventh Hour · Not a substitute for legal advice — see the compliance notes in the repository docs.</div>
    </footer>
  );
}
