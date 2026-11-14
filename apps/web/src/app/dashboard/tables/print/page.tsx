'use client';
import { useApi } from '@/lib/hooks';
import { useMe } from '@/components/shell';
import { Loading } from '@/components/ui';

/** Print-ready QR table cards (A4, 2×3). Use the browser's Print → Save as PDF. */
export default function PrintQr() {
  const me = useMe(); const { data } = useApi<any[]>('/api/r/tables'); const { data: s } = useApi<any>('/api/r/settings');
  if (!data || !s) return <Loading />;
  const primary = s.branding?.primary ?? '#0F5C4D';
  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden"><div><h1 className="font-display text-2xl font-extrabold">Print QR cards</h1><p className="text-sm text-muted">{data.filter((t) => t.active).length} active tables · A4, six per page</p></div><button className="btn btn-brand" onClick={() => window.print()}>🖨️ Print / Save PDF</button></div>
      <div className="grid grid-cols-2 gap-4 print:gap-3">{data.filter((t) => t.active).map((t) => (
        <div key={t.id} className="break-inside-avoid rounded-3xl border-2 p-5 text-center print:rounded-2xl" style={{ borderColor: primary, background: '#fff', color: '#111' }}>
          <div className="text-lg font-extrabold" style={{ color: primary }}>{me.restaurantName}</div>
          <img src={`/api/r/tables/${t.id}/qr.svg`} alt={`QR for table ${t.label}`} className="mx-auto my-2 w-44" />
          <div className="text-3xl font-black">Table {t.label}</div>
          <div className="mt-1 text-sm font-semibold">Scan. Order. Pay. Enjoy.</div>
          <div className="mt-1 text-xs text-neutral-600">ස්කෑන් කරන්න · ஸ்கேன் செய்யுங்கள் · LankaQR &amp; cards</div>
        </div>))}</div>
    </div>
  );
}
