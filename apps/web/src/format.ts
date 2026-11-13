const d = (s: string) => new Date(`${s}T00:00:00Z`);
export const fmtDay = (s: string) => d(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const fmtRange = (a: string, b: string) => (a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`);
export const fmtMonthShort = (m: string) => d(`${m}-01`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
export const fmtMonthLong = (m: string) => d(`${m}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const isoToday = () => new Date().toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => new Date(d(s).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const addMonths = (m: string, n: number) => { const x = d(`${m}-01`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 7); };
export const timeAgo = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};
export const ROLE_LABEL = { employee: 'Employee', manager: 'Manager', property_admin: 'Property administrator', company_admin: 'Company administrator' } as const;
