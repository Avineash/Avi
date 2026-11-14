const p2 = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** The business date is the day after the audit date (the audit runs overnight, closing the previous day). */
export function businessDate(auditDate: string): string {
  const d = new Date(`${auditDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Before midday the audit being worked is for *yesterday*. `now` is local wall-clock time at the property. */
export function defaultAuditDate(now: Date = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < 12) d.setDate(d.getDate() - 1);
  return ymd(d);
}
