'use client';
import { Suspense, use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { lkrFull } from '@/lib/money';
import { Spinner, SandboxBanner, cx } from '@/components/ui';

/** Simulated hosted card page. In production this page is the card provider's (e.g. PayHere), on THEIR domain:
 *  TableFlow never renders card fields and there is intentionally no free-text card input here either. */
function Card({ refId }: { refId: string }) {
  const sp = useSearchParams();
  const safe = (u: string | null) => { try { const x = new URL(u ?? '', location.origin); return x.origin === location.origin ? x.toString() : '/'; } catch { return '/'; } };  // no open redirect
  const [txn, setTxn] = useState<any>(null); const [cards, setCards] = useState<any[]>([]);
  const [card, setCard] = useState('visa_ok'); const [step, setStep] = useState<'pick' | '3ds' | 'busy'>('pick'); const [err, setErr] = useState('');
  useEffect(() => { api(`/api/sandbox/txn/${refId}`).then(setTxn).catch((e) => setErr(e.message)); api('/api/sandbox/cards').then(setCards); }, [refId]);

  async function submit(extra: object = {}) {
    setErr(''); setStep('busy');
    try {
      const r = await api<any>(`/api/sandbox/card/${refId}/complete`, { body: { card, ...extra } });
      if (r.needs3ds) { setStep('3ds'); return; }
      window.location.assign(r.status === 'paid' ? safe(sp.get('return')) : safe(sp.get('cancel')));
    } catch (e) { setErr((e as ApiError).message); setStep('pick'); }
  }
  if (err && !txn) return <div className="grid min-h-dvh place-items-center p-8 text-center">{err}</div>;
  if (!txn) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  return (
    <div className="min-h-dvh bg-[#f3f4f7] text-neutral-900" data-theme="light">
      <SandboxBanner text="SANDBOX CARD GATEWAY — simulated hosted checkout. Test cards only. No real cards are accepted." />
      <main className="mx-auto max-w-md px-5 pb-16 pt-8">
        <div className="mb-5 flex items-center justify-between"><div className="font-extrabold tracking-tight text-indigo-700">SandboxPay</div><div className="text-xs font-semibold text-neutral-500">🔒 3-D Secure</div></div>
        <div className="rounded-3xl bg-white p-6 shadow-card ring-1 ring-neutral-200">
          <div className="text-sm text-neutral-500">Pay {txn.merchant}</div><div className="text-3xl font-extrabold tabular">{lkrFull(txn.amountCents)}</div>
          {step !== '3ds' ? (<>
            <fieldset className="mt-5"><legend className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Choose a test card</legend>
              <div className="space-y-2">{cards.map((c) => <label key={c.id} className={cx('flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border-2 px-3.5 py-2', card === c.id ? 'border-indigo-600 bg-indigo-50' : 'border-neutral-200')}>
                <input type="radio" name="card" checked={card === c.id} onChange={() => setCard(c.id)} className="h-5 w-5 accent-indigo-600" /><span className="text-sm font-semibold">{c.label}</span></label>)}</div></fieldset>
            {err && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{err}</p>}
            <button disabled={step === 'busy'} onClick={() => submit()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-4 text-base font-extrabold text-white transition active:scale-[.98] disabled:opacity-50">{step === 'busy' ? <Spinner /> : `Pay ${lkrFull(txn.amountCents)}`}</button>
            <button onClick={() => { setCard('cancel'); setTimeout(() => submit(), 0); }} className="mt-3 w-full py-3 text-sm font-semibold text-neutral-500">Cancel and return to merchant</button>
          </>) : (
            <div className="mt-6 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-2xl">🏦</div>
              <h1 className="mt-3 text-xl font-extrabold">Confirm with your bank</h1><p className="mt-1 text-sm text-neutral-500">Simulated 3-D Secure challenge. In production your bank sends a one-time code or app prompt.</p>
              <div className="mt-5 grid gap-2"><button onClick={() => submit({ threeDs: 'pass' })} className="rounded-2xl bg-emerald-600 py-3.5 font-bold text-white">Authenticate successfully</button>
                <button onClick={() => submit({ threeDs: 'fail' })} className="rounded-2xl bg-neutral-100 py-3.5 font-bold">Fail authentication</button></div></div>)}
        </div>
      </main>
    </div>
  );
}
export default function Page({ params }: { params: Promise<{ ref: string }> }) { const { ref } = use(params); return <Suspense><Card refId={ref} /></Suspense>; }
