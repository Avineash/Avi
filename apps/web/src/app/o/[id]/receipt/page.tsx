'use client';
import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n, tr } from '@/lib/i18n';
import { lkrFull, dateTime } from '@/lib/money';
import { BrandShell } from '@/components/customer';
import { Spinner } from '@/components/ui';

export default function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const tk = useSearchParams().get('t') ?? '';
  const [o, setO] = useState<any>(null); const [err, setErr] = useState('');
  const { t, lang } = useI18n();
  useEffect(() => { api(`/api/public/orders/${id}?t=${tk}`).then(setO).catch((e) => setErr(e.message)); }, [id, tk]);
  if (err) return <div className="p-10 text-center">{err}</div>;
  if (!o) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  const r = o.restaurant;
  return (
    <BrandShell branding={r.branding} sandbox={o.sandbox}>
      <main className="px-5 pb-12 pt-16 print:pt-2">
        <article className="card mx-auto p-6 print:border-0 print:shadow-none" aria-label={t('receipt')}>
          <header className="text-center"><h1 className="font-display text-2xl font-extrabold">{r.name}</h1>
            <p className="text-sm text-muted">{[r.address, r.city].filter(Boolean).join(', ')}{r.phone ? ` · ${r.phone}` : ''}</p>
            {r.taxRegNo && <p className="text-xs text-muted">Tax reg. {r.taxRegNo}</p>}</header>
          <div className="my-4 flex justify-between border-y border-dashed border-line py-3 text-sm"><span>{t('receipt')} #{o.number}</span><span>{dateTime(o.paidAt ?? o.createdAt)}</span></div>
          <div className="text-xs text-muted">{t('table')} {o.table}</div>
          <ul className="my-3 space-y-2 text-[15px]">{o.items.map((i: any, k: number) => (<li key={k} className="flex justify-between gap-3"><span>{i.qty} × {tr(i.name, lang)}{i.options?.length > 0 && <span className="block text-xs text-muted">{i.options.map((x: any) => tr(x.name, lang)).join(', ')}</span>}</span><span className="tabular">{lkrFull(i.lineTotalCents)}</span></li>))}</ul>
          <dl className="space-y-1 border-t border-dashed border-line pt-3 text-sm">
            <div className="flex justify-between"><dt>{t('subtotal')}</dt><dd className="tabular">{lkrFull(o.totals.subtotal)}</dd></div>
            {o.totals.service > 0 && <div className="flex justify-between"><dt>{t('serviceCharge')} ({o.rates.serviceBps / 100}%)</dt><dd className="tabular">{lkrFull(o.totals.service)}</dd></div>}
            {o.totals.tax > 0 && <div className="flex justify-between"><dt>{o.rates.taxLabel} ({o.rates.taxBps / 100}%)</dt><dd className="tabular">{lkrFull(o.totals.tax)}</dd></div>}
            <div className="flex justify-between pt-2 text-lg font-extrabold"><dt>{t('total')}</dt><dd className="tabular">{lkrFull(o.totals.total)}</dd></div>
            {o.totals.refunded > 0 && <div className="flex justify-between text-bad"><dt>Refunded</dt><dd className="tabular">−{lkrFull(o.totals.refunded)}</dd></div>}
          </dl>
          {o.payment && <div className="mt-4 rounded-xl bg-sunken p-3 text-sm"><div className="flex justify-between"><span className="text-muted">{t('paymentMethod')}</span><b>{o.payment.method === 'lankaqr' ? 'LankaQR' : 'Credit/Debit card'}</b></div>
            <div className="flex justify-between"><span className="text-muted">{t('reference')}</span><span className="font-mono text-xs">{o.payment.reference}</span></div>
            <div className="flex justify-between"><span className="text-muted">Status</span><b>{o.paymentStatus.replace('_', ' ')}</b></div></div>}
          {o.sandbox && <p className="mt-4 rounded-xl bg-warn/10 p-3 text-center text-xs font-bold text-warn">SANDBOX RECEIPT — simulated payment. Not a tax invoice. No money moved.</p>}
          <p className="mt-5 text-center text-xs text-muted">Thank you! · Powered by TableFlow</p>
        </article>
        <div className="mx-auto mt-5 flex max-w-sm gap-3 print:hidden"><button className="btn btn-brand flex-1" onClick={() => window.print()}>🖨️ {t('printReceipt')}</button>
          <a className="btn btn-line" href={`/o/${id}?t=${tk}`}>←</a></div>
      </main>
    </BrandShell>
  );
}
