"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/util";

/** Subscribes to server-sent events so the "N left" badge updates in real time as other customers book. */
export function LiveAvailability({ listingId, initial, className }: { listingId: string; initial: { available: number; total: number }; className?: string }) {
  const [a, setA] = useState(initial);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const es = new EventSource(`/api/listings/${listingId}/stream`);
    es.onopen = () => setLive(true);
    es.onmessage = (e) => { try { setA(JSON.parse(e.data)); } catch {} };
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [listingId]);
  const sold = a.available === 0;
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm font-medium", sold ? "text-danger" : a.available <= 2 ? "text-amber-700" : "text-success", className)} aria-live="polite">
      <span className={cn("size-2 rounded-full", live ? "animate-pulse" : "", sold ? "bg-danger" : a.available <= 2 ? "bg-amber-500" : "bg-success")} aria-hidden />
      {sold ? "Sold out" : `${a.available} of ${a.total} left`}
      {live && <span className="sr-only">(live)</span>}
    </span>
  );
}
