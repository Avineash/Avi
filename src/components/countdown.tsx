"use client";
import { useEffect, useState } from "react";

/** Live countdown to a deadline. Renders the server-computed value first to avoid hydration mismatch. */
export function Countdown({ to, className, expiredText = "Expired" }: { to: string; className?: string; expiredText?: string }) {
  const target = new Date(to).getTime();
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, target - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [target]);
  if (left === null) return <span className={className}>…</span>;
  if (left === 0) return <span className={className}>{expiredText}</span>;
  const s = Math.floor(left / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return <time dateTime={to} className={className} aria-live="off">{h > 0 ? `${h}h ` : ""}{String(m).padStart(2, "0")}m {String(sec).padStart(2, "0")}s</time>;
}
