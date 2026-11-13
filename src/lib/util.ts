import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const AUD0 = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

/** Format integer cents as AUD. */
export function aud(cents: number | bigint | null | undefined, opts: { whole?: boolean } = {}): string {
  const n = Number(cents ?? 0) / 100;
  return opts.whole && Number.isInteger(n) ? AUD0.format(n) : AUD.format(n);
}

export const TZ = "Australia/Melbourne";

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(d));
}
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(d));
}
export function fmtTime(d: Date | string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(d));
}
/** yyyy-mm-dd in Melbourne time */
export function melbDay(d: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
}

/** Split `total` across weights using largest-remainder so parts always sum exactly to total. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) floors[order[k].i] += 1;
  return floors;
}

export const minutes = (n: number) => n * 60_000;
export const hours = (n: number) => n * 3_600_000;

function tzOffsetMinutes(d: Date): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" }).format(d);
  const m = s.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}
/** Parse an <input type="datetime-local"> value ("2026-11-14T14:00") as Melbourne wall-clock time. */
export function melbToDate(local: string): Date {
  const [d, t] = local.split("T");
  const [y, m, da] = d.split("-").map(Number);
  const [h, mi] = (t ?? "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, da, h, mi);
  let ts = guess - tzOffsetMinutes(new Date(guess)) * 60_000;
  ts = guess - tzOffsetMinutes(new Date(ts)) * 60_000;
  return new Date(ts);
}
/** Inverse: format a Date for a datetime-local input in Melbourne time. */
export function toLocalInput(d: Date | string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
