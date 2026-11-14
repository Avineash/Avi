'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { PageHead, useMe, can } from '@/components/shell';
import { Confirm, Empty, ErrorBox, Loading, Pill, Sheet, useToast } from '@/components/ui';

export default function Tables() {
  const me = useMe(); const toast = useToast(); const w = can(me, 'tables:write');
  const { data, loading, error, reload } = useApi<any[]>('/api/r/tables');
  const [label, setLabel] = useState(''); const [seats, setSeats] = useState(2); const [qr, setQr] = useState<any>(null); const [rot, setRot] = useState<any>(null);
  async function add(e: React.FormEvent) { e.preventDefault(); try { await api('/api/r/tables', { body: { label, seats } }); setLabel(''); reload(); } catch (ex) { toast((ex as ApiError).message, 'bad'); } }
  const toggle = async (t: any) => { try { await api(`/api/r/tables/${t.id}`, { method: 'PATCH', body: { active: !t.active } }); reload(); } catch (ex) { toast((ex as ApiError).message, 'bad'); } };
  return (
    <>
      <PageHead title="Tables & QR codes" sub="Each table has its own unguessable QR link. Print and stick it on the table." actions={<Link href="/dashboard/tables/print" className="btn btn-brand btn-sm">🖨️ Print all QR cards</Link>} />
      {w && <form onSubmit={add} className="card mb-4 flex flex-wrap items-end gap-3 p-4"><label className="block"><span className="label">Table name</span><input className="input w-36" required maxLength={20} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. T11 or Patio 2" /></label>
        <label className="block"><span className="label">Seats</span><input className="input w-24" type="number" min={1} max={30} value={seats} onChange={(e) => setSeats(+e.target.value)} /></label><button className="btn btn-brand">Add table</button></form>}
      <ErrorBox error={error} retry={reload} />
      {loading ? <Loading /> : !data?.length ? <Empty icon="▦" title="No tables yet">Add your first table above.</Empty> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{data.map((t) => (
          <div key={t.id} className={`card p-4 ${t.active ? '' : 'opacity-60'}`}><div className="flex items-start justify-between"><div className="font-display text-2xl font-extrabold">{t.label}</div>{!t.active && <Pill>inactive</Pill>}</div><div className="text-xs text-muted">{t.seats} seats</div>
            <div className="mt-3 flex flex-wrap gap-2"><button className="btn btn-ghost btn-sm" onClick={() => setQr(t)}>View QR</button>
              {w && <><button className="btn btn-ghost btn-sm" onClick={() => setRot(t)} title="Invalidate the old QR and make a new one">Rotate</button><button className="btn btn-ghost btn-sm" onClick={() => toggle(t)}>{t.active ? 'Disable' : 'Enable'}</button></>}</div></div>))}</div>)}
      <Sheet open={!!qr} onClose={() => setQr(null)} title={`Table ${qr?.label ?? ''} QR`}>{qr && <div className="p-5 text-center"><img src={`/api/r/tables/${qr.id}/qr.svg`} alt={`QR code for table ${qr.label}`} className="mx-auto w-64 rounded-2xl bg-white p-3 ring-1 ring-line" />
        <p className="mt-3 break-all text-xs text-muted">{qr.url}</p><div className="mt-4 flex gap-2"><a className="btn btn-line flex-1" href={qr.url} target="_blank" rel="noreferrer">Open as customer ↗</a><a className="btn btn-brand flex-1" href={`/api/r/tables/${qr.id}/qr.svg`} download={`table-${qr.label}.svg`}>Download SVG</a></div></div>}</Sheet>
      <Confirm open={!!rot} danger title="Rotate this QR code?" confirmLabel="Rotate QR" onClose={() => setRot(null)} body={<>The printed QR on table <b>{rot?.label}</b> will stop working immediately. You will need to print and replace it. Use this if a QR was photographed or misused.</>}
        onConfirm={async () => { try { await api(`/api/r/tables/${rot.id}/rotate-token`, { body: {} }); toast('QR rotated — reprint it'); reload(); } catch (ex) { toast((ex as ApiError).message, 'bad'); } }} />
    </>
  );
}
