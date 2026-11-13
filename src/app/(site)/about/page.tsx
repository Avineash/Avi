import type { Metadata } from "next";
export const metadata: Metadata = { title: "About us" };
export default function About() {
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
