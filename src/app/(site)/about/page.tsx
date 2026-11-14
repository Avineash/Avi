import type { Metadata } from "next";
export const metadata: Metadata = { title: "About us" };
import { isFull } from "@/lib/phase";

function MarketAbout() {
  return (
    <div className="container-page max-w-3xl py-12">
      <p className="eyebrow">About us</p><h1 className="h-section mt-3">Plans change. <em>Good bookings shouldn&apos;t go to waste.</em></h1>
      <div className="mt-6 space-y-4 text-lg text-navy-900/80">
        <p>Every week, Melburnians are stuck with a hotel night, a dinner reservation or event tickets they can no longer use — while someone else would love them. Eleventh Hour connects the two.</p>
        <p>Because strangers need a reason to trust each other, we hold payments in escrow, refund automatically when a seller doesn&apos;t deliver, only allow resale at registered venues, and cap prices so nobody is gouged.</p>
        <p>We&apos;re starting in Melbourne with a deliberately small product: buyers and sellers. Venue partners, and more, are coming later.</p>
      </div>
    </div>
  );
}

export default function About() {
  if (!isFull()) return <MarketAbout />;
  return (
    <div className="container-page max-w-3xl py-12">
      <p className="eyebrow">About us</p><h1 className="mt-1 text-4xl font-semibold">Hospitality has a perishable inventory problem.</h1>
      <div className="mt-6 space-y-4 text-lg text-navy-900/80">
        <p>An empty hotel room at midnight, a vacant table at 8pm and an unsold ticket at curtain-up all earn nothing — and can never be sold again. Meanwhile, plenty of people would love a spontaneous night out at a fair price.</p>
        <p>Eleventh Hour connects the two, starting in Melbourne. We combine the simplicity of Airbnb, the booking experience of Booking.com and the urgency of HotelTonight — with a premium, trustworthy feel and a waitlist that treats everyone fairly.</p>
        <p>We&apos;re building for Australia first: GST-inclusive pricing, Australian Consumer Law-aware terms, verified ABNs and AUD payments. Then Australia-wide, then the world.</p>
      </div>
    </div>
  );
}
