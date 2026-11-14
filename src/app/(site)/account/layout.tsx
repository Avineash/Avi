import { BellRing, CalendarCheck, CreditCard, Gift, Heart, History, LayoutDashboard, ListChecks, Package, ShoppingBag, Store, UserCog, Wallet } from "lucide-react";
import { isFull } from "@/lib/phase";
import { sellerStats } from "@/lib/domain/resale";
import { Suspense } from "react";
import { Sidebar } from "@/components/dashboard-shell";
import { requirePermission } from "@/lib/auth/session";
import { customerStats } from "@/lib/domain/analytics";
import { getDb } from "@/lib/db";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePermission("customer:account", "/account");
  const db = await getDb();
  const ic = (I: typeof Heart) => <I className="size-4" aria-hidden />;
  if (!isFull()) {
    const st = await sellerStats(db, u.id);
    const awaiting = Number((await db.query<any>("select count(*)::int n from resale_orders where buyer_id = $1 and status = 'delivered'", [u.id])).rows[0].n);
    const market = [
      { href: "/account", label: "Overview", icon: ic(LayoutDashboard) },
      { href: "/account/purchases", label: "My purchases", icon: ic(ShoppingBag), badge: awaiting },
      { href: "/account/selling", label: "My listings", icon: ic(Store) },
      { href: "/account/sales", label: "My sales", icon: ic(Package), badge: st.toDeliver },
      { href: "/account/earnings", label: "Earnings & payouts", icon: ic(Wallet) },
      { href: "/account/wanted", label: "Alerts", icon: ic(BellRing) },
      { href: "/account/saved", label: "Saved", icon: ic(Heart) },
      { href: "/account/payments", label: "Payments & refunds", icon: ic(CreditCard) },
      { href: "/account/profile", label: "Profile & preferences", icon: ic(UserCog) },
    ];
    return (
      <div className="container-page grid gap-8 py-8 lg:grid-cols-[15rem_1fr]">
        <Suspense><Sidebar items={market} title="My account" /></Suspense>
        <div className="min-w-0">{children}</div>
      </div>
    );
  }
  const s = await customerStats(db, u.id);
  const items = [
    { href: "/account", label: "Dashboard", icon: ic(LayoutDashboard) },
    { href: "/account/bookings?tab=upcoming", label: "Upcoming bookings", icon: ic(CalendarCheck) },
    { href: "/account/bookings?tab=previous", label: "Previous bookings", icon: ic(History) },
    { href: "/account/waitlists", label: "My waitlists", icon: ic(ListChecks) },
    { href: "/account/offers", label: "Offers", icon: ic(Gift), badge: s.openOffers },
    { href: "/account/saved", label: "Saved", icon: ic(Heart) },
    { href: "/account/payments", label: "Payments & refunds", icon: ic(CreditCard) },
    { href: "/account/profile", label: "Profile & preferences", icon: ic(UserCog) },
  ];
  return (
    <div className="container-page grid gap-8 py-8 lg:grid-cols-[15rem_1fr]">
      <Suspense><Sidebar items={items} title="My account" /></Suspense>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
