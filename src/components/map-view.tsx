"use client";
import { useState } from "react";
import Link from "next/link";
import { aud } from "@/lib/util";
import { cn } from "@/lib/util";

export interface Pin { venueId: string; name: string; suburb: string; lat: number; lng: number; fromCents: number; category: string; listingId: string; count: number; soldOut: boolean }

// Melbourne metro viewport. Swap this component for Mapbox GL / Google Maps (token required) without touching callers.
const B = { n: -37.745, s: -37.895, w: 144.89, e: 145.04 };
const LANDMARKS = [
  { n: "CBD", lat: -37.8136, lng: 144.9631 }, { n: "Southbank", lat: -37.8250, lng: 144.9640 }, { n: "St Kilda", lat: -37.8676, lng: 144.9810 }, { n: "Fitzroy", lat: -37.7984, lng: 144.9785 },
  { n: "Carlton", lat: -37.8000, lng: 144.9669 }, { n: "Richmond", lat: -37.8230, lng: 144.9980 }, { n: "South Yarra", lat: -37.8386, lng: 144.9930 }, { n: "Brunswick", lat: -37.7667, lng: 144.9604 }, { n: "Docklands", lat: -37.8140, lng: 144.9460 },
];
const proj = (lat: number, lng: number) => ({ x: ((lng - B.w) / (B.e - B.w)) * 100, y: ((B.n - lat) / (B.n - B.s)) * 100 });

export function MapView({ pins, className, basePath = "/listings" }: { pins: Pin[]; className?: string; basePath?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const inside = pins.filter((p) => p.lat <= B.n && p.lat >= B.s && p.lng >= B.w && p.lng <= B.e);
  const outside = pins.filter((p) => !inside.includes(p));
  const sel = pins.find((p) => p.venueId === active);
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-navy-900/15 bg-navy-900", className)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" role="img" aria-label="Map of Melbourne showing venue locations">
        <defs><pattern id="g" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#c9ae74" strokeOpacity=".08" strokeWidth=".15" /></pattern></defs>
        <rect width="100" height="100" fill="#0f2442" /><rect width="100" height="100" fill="url(#g)" />
        <path d="M0 78 C 14 70, 24 80, 38 84 S 60 96, 70 100 L0 100 Z" fill="#0a1830" /> {/* Port Phillip Bay */}
        <path d="M100 52 C 86 50, 78 44, 70 46 S 56 52, 50 50 S 40 46, 34 48 S 24 54, 10 50" fill="none" stroke="#3a5f9a" strokeWidth=".9" strokeOpacity=".7" /> {/* Yarra */}
      </svg>
      {LANDMARKS.map((l) => { const p = proj(l.lat, l.lng); return <span key={l.n} className="pointer-events-none absolute -translate-x-1/2 text-[10px] font-medium uppercase tracking-widest text-ivory/35" style={{ left: `${p.x}%`, top: `${p.y + 4}%` }}>{l.n}</span>; })}
      {inside.map((p) => {
        const { x, y } = proj(p.lat, p.lng);
        return (
          <button key={p.venueId} onMouseEnter={() => setActive(p.venueId)} onFocus={() => setActive(p.venueId)} onClick={() => setActive(p.venueId)}
            className={cn("absolute z-10 -translate-x-1/2 -translate-y-full rounded-full px-2.5 py-1 text-xs font-semibold shadow-lg ring-2 transition-transform hover:scale-110 focus-visible:scale-110",
              p.soldOut ? "bg-navy-700 text-ivory/70 ring-navy-500" : "bg-gold-500 text-navy-950 ring-gold-300", active === p.venueId && "z-20 scale-110")}
            style={{ left: `${x}%`, top: `${y}%` }} aria-label={`${p.name}, from ${aud(p.fromCents, { whole: true })}`}>
            {p.soldOut ? "Sold out" : aud(p.fromCents, { whole: true })}
          </button>
        );
      })}
      {outside.length > 0 && <div className="absolute bottom-3 left-3 rounded-xl bg-navy-950/80 px-3 py-2 text-xs text-ivory">Beyond this view: {outside.map((o) => o.suburb).join(", ")}</div>}
      {sel && (
        <div className="absolute inset-x-3 bottom-3 z-30 rounded-xl bg-white p-3 shadow-xl sm:left-auto sm:w-72" role="status">
          <p className="text-xs text-navy-900/60">{sel.suburb} · {sel.count} listing{sel.count > 1 ? "s" : ""}</p>
          <p className="font-serif text-base font-semibold">{sel.name}</p>
          <p className="text-sm">{sel.soldOut ? "Sold out — join the waitlist" : <>From <strong>{aud(sel.fromCents, { whole: true })}</strong></>}</p>
          <Link href={`${basePath}/${sel.listingId}`} className="mt-1 inline-block text-sm font-semibold text-gold-700 underline">View</Link>
        </div>
      )}
    </div>
  );
}
