import { Suspense } from "react";
import { AlertTriangle, BarChart3, Banknote, CreditCard, FileText, Handshake, LayoutDashboard, Percent, Settings, ShieldCheck, Users, Package } from "lucide-react";
import { Sidebar } from "@/components/dashboard-shell";
import { SandboxBanner, SiteFooter, SiteHeader } from "@/components/site-chrome";
import { requirePermission } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("admin:portal", "/admin");
  const ic = (I: typeof Package) => <I className="size-4" aria-hidden />;
  const items = [
    { href: "/admin", label: "Platform overview", icon: ic(LayoutDashboard) }, { href: "/admin/partners", label: "Partner approvals", icon: ic(ShieldCheck) }, { href: "/admin/customers", label: "Customers", icon: ic(Users) },
    { href: "/admin/listings", label: "Listings & inventory", icon: ic(Package) }, { href: "/admin/transactions", label: "Transactions", icon: ic(CreditCard) }, { href: "/admin/buybacks", label: "Buyback monitoring", icon: ic(Handshake) },
    { href: "/admin/disputes", label: "Disputes & refunds", icon: ic(AlertTriangle) }, { href: "/admin/commissions", label: "Commission settings", icon: ic(Percent) }, { href: "/admin/reports", label: "Reports & analytics", icon: ic(BarChart3) }, { href: "/admin/system", label: "System configuration", icon: ic(Settings) },
  ];
  return (
    <>
      <SandboxBanner /><SiteHeader />
      <main id="main" tabIndex={-1} className="container-page grid gap-8 py-8 lg:grid-cols-[15rem_1fr]">
        <Suspense><Sidebar items={items} title="Administration" /></Suspense>
        <div className="min-w-0">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
