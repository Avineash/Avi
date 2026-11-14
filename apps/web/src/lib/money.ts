export const lkr = (cents: number | null | undefined, opts: { dec?: boolean } = {}) => {
  const v = (cents ?? 0) / 100;
  const dec = opts.dec ?? (v % 1 !== 0);
  return 'Rs. ' + v.toLocaleString('en-LK', { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: 2 });
};
export const lkrFull = (cents: number) => 'Rs. ' + (cents / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const time = (d: string | Date | null | undefined) => d ? new Date(d).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' }) : '—';
export const dateTime = (d: string | Date | null | undefined) => d ? new Date(d).toLocaleString('en-LK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' }) : '—';
export const ago = (d: string | Date) => { const m = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000)); return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
