import { SandboxBanner, SiteFooter, SiteHeader } from "@/components/site-chrome";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SandboxBanner />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="min-h-[60vh]">{children}</main>
      <SiteFooter />
    </>
  );
}
