"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/util";

export interface NavItem { href: string; label: string; icon?: React.ReactNode; badge?: number }

/** Sidebar on desktop, horizontally-scrolling tab strip on mobile. */
export function Sidebar({ items, title }: { items: NavItem[]; title: string }) {
  const path = usePathname(); const sp = useSearchParams();
  const full = path + (sp.toString() ? `?${sp.toString()}` : "");
  const roots = new Set(["/account", "/partner", "/admin"]);
  const active = (href: string) => {
    if (href.includes("?")) return full === href || (full.startsWith(href.split("?")[0]) && !sp.get("tab") && href.endsWith("upcoming"));
    return roots.has(href) ? path === href : path === href || path.startsWith(href + "/");
  };
  return (
    <nav aria-label={title} className="lg:sticky lg:top-24 lg:self-start">
      <p className="eyebrow mb-3 hidden lg:block">{title}</p>
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {items.map((i) => (
          <li key={i.href} className="shrink-0">
            <Link href={i.href} aria-current={active(i.href) ? "page" : undefined}
              className={cn("flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-medium", active(i.href) ? "bg-navy-900 text-ivory" : "text-navy-800 hover:bg-navy-900/5")}>
              {i.icon}<span>{i.label}</span>{!!i.badge && <span className="ml-auto rounded-full bg-gold-500 px-1.5 text-[11px] font-bold text-navy-950">{i.badge}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
