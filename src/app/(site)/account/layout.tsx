import { CalendarCheck, CreditCard, Gift, Heart, History, LayoutDashboard, ListChecks, UserCog } from "lucide-react";
import { Sidebar } from "@/components/dashboard-shell";
import { requirePermission } from "@/lib/auth/session";
import { customerStats } from "@/lib/domain/analytics";
import { getDb } from "@/lib/db";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePermission("customer:account", "/account");
  const s = await customerStats(await getDb(), u.id);
  const ic = (I: typeof Heart) => <I className="size-4" aria-hidden />;
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
      <Sidebar items={items} title="My account" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
