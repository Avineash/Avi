import { Suspense } from "react";
import { BarChart3, Banknote, CalendarCheck, Handshake, LayoutDashboard, ListChecks, Package, Settings, Tags } from "lucide-react";
import { Sidebar } from "@/components/dashboard-shell";
import { SandboxBanner, SiteFooter, SiteHeader } from "@/components/site-chrome";
import { requirePermission } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePermission("partner:portal", "/partner");
  const p = u.partnerId ? (await (await getDb()).query<any>("select business_name, category, status from partners where id = $1", [u.partnerId])).rows[0] : null;
  const ic = (I: typeof Package) => <I className="size-4" aria-hidden />;
  const full = [
    { href: "/partner", label: "Dashboard", icon: ic(LayoutDashboard) }, { href: "/partner/inventory", label: "Inventory", icon: ic(Package) },
    { href: "/partner/pricing", label: "Pricing & availability", icon: ic(Tags) }, { href: "/partner/reservations", label: "Reservations", icon: ic(CalendarCheck) },
    { href: "/partner/waitlist", label: "Waitlist demand", icon: ic(ListChecks) }, { href: "/partner/buybacks", label: "Buyback requests", icon: ic(Handshake) },
    { href: "/partner/earnings", label: "Earnings & payouts", icon: ic(Banknote) }, { href: "/partner/analytics", label: "Analytics", icon: ic(BarChart3) }, { href: "/partner/settings", label: "Business settings", icon: ic(Settings) },
  ];
  const approved = p?.status === "approved";
  const items = approved ? full : [full[0], full[8]];
  return (
    <>
      <SandboxBanner /><SiteHeader />
      <main id="main" tabIndex={-1} className="container-page grid gap-8 py-8 lg:grid-cols-[15rem_1fr]">
        <div><p className="mb-1 text-sm font-semibold">{p?.business_name}</p><p className="mb-4 text-xs capitalize text-navy-900/60">{p?.category} partner portal</p><Suspense><Sidebar items={items} title="Partner portal" /></Suspense></div>
        <div className="min-w-0">
          {!approved && <div role="status" className="mb-6 rounded-2xl border border-gold-500/50 bg-gold-300/20 p-4 text-sm"><strong>Your application is {p?.status ?? "incomplete"}.</strong> {p?.status === "pending" ? "Our team is verifying your ABN and documents (usually within 2 business days). You can add venues and upload further documents in Business settings; publishing and payouts unlock on approval." : "Contact support for next steps."}</div>}
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
