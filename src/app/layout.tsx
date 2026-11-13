import type { Metadata, Viewport } from "next";
import "./globals.css";

export const dynamic = "force-dynamic"; // every page reads live inventory / session state

export const metadata: Metadata = {
  title: { default: "Eleventh Hour — last-minute hotels, dining & events in Melbourne", template: "%s · Eleventh Hour" },
  description: "Verified last-minute availability from Melbourne's hotels, restaurants and event organisers. Honest all-in pricing, free-cancellation options and a fair waitlist.",
};
export const viewport: Viewport = { themeColor: "#0b1b33", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
