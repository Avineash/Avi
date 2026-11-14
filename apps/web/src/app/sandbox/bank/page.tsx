'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { lkrFull } from '@/lib/money';
import { Spinner, SandboxBanner, cx } from '@/components/ui';

function Bank() {
  const ref = useSearchParams().get('ref') ?? '';
  const [txn, setTxn] = useState<any>(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ status: string; webhook: any } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/api/sandbox/txn/${ref}`).then(setTxn).catch((e) => setErr(e.message)); }, [ref]);

  async function authorise(outcome: string, dropWebhook = false) {
    setBusy(true);
    try { setDone(await api(`/api/sandbox/lankaqr/${ref}/authorise`, { body: { outcome, dropWebhook } })); }
    catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }
  if (err && !txn) return <div className="grid min-h-dvh place-items-center p-8 text-center">{err}</div>;
  if (!txn) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  const q = txn.qr;
  return (
    <div className="min-h-dvh bg-[#10131a] text-white" data-theme="dark">
      <SandboxBanner text="SANDBOX BANK APP — simulated. Not a real bank. No money moves." />
      <main className="mx-auto max-w-md px-5 pb-16 pt-8">
        <div className="mb-6 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500 font-black">B</div><div><div className="font-bold">Sandbox Bank</div><div className="text-xs text-white/60">Scan QR · LankaQR</div></div></div>
        {!done ? (<>
          <div className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
            <div className="text-xs font-bold uppercase tracking-wider text-white/50">You are paying</div>
            <div className="mt-1 text-xl font-bold">{q?.merchantName ?? txn.merchant}</div>
            <div className="text-sm text-white/60">{q?.city} · Table {q?.terminal}</div>
            <div className="mt-4 text-4xl font-extrabold tabular">{lkrFull(txn.amountCents)}</div>
            <dl className="mt-5 space-y-2 border-t border-white/10 pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-white/50">Reference</dt><dd className="font-mono">{q?.billNumber}</dd></div>
              <div className="flex justify-between"><dt className="text-white/50">Currency</dt><dd>{q?.currency === '144' ? 'LKR (144)' : q?.currency}</dd></div>
              <div className="flex justify-between"><dt className="text-white/50">QR integrity (CRC-16)</dt><dd className={q?.crcOk ? 'text-emerald-400' : 'text-red-400'}>{q?.crcOk ? '✓ valid' : '✗ invalid'}</dd></div>
              <div className="flex justify-between"><dt className="text-white/50">Network</dt><dd className="font-mono text-xs">{q?.network}</dd></div>
            </dl>
          </div>
          {txn.status !== 'pending' && <p className="mt-4 rounded-xl bg-amber-500/15 p-3 text-center text-sm text-amber-300">This request is already {txn.status}.</p>}
          {err && <p role="alert" className="mt-4 rounded-xl bg-red-500/15 p-3 text-center text-sm text-red-300">{err}</p>}
          <button disabled={busy || txn.status !== 'pending' || !q?.crcOk} onClick={() => authorise('success')} className="mt-5 w-full rounded-2xl bg-emerald-500 py-4 text-lg font-extrabold text-emerald-950 transition active:scale-[.98] disabled:opacity-40">{busy ? '…' : 'Authorise payment'}</button>
          <details className="mt-6 rounded-2xl bg-white/5 p-4 text-sm ring-1 ring-white/10"><summary className="cursor-pointer font-bold text-white/80">Sandbox scenarios</summary>
            <div className="mt-3 grid gap-2">
              <button disabled={busy || txn.status !== 'pending'} onClick={() => authorise('insufficient_funds')} className="rounded-xl bg-white/10 px-4 py-3 text-left font-semibold">Decline — insufficient funds</button>
              <button disabled={busy || txn.status !== 'pending'} onClick={() => authorise('success', true)} className="rounded-xl bg-white/10 px-4 py-3 text-left font-semibold">Authorise but <u>lose the webhook</u><span className="block text-xs font-normal text-white/50">TableFlow must recover via status enquiry</span></button>
            </div></details>
        </>) : (
          <div className="rounded-3xl bg-white/5 p-8 text-center ring-1 ring-white/10">
            <div className={cx('mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl', done.status === 'paid' ? 'bg-emerald-500 text-emerald-950' : 'bg-red-500')}>{done.status === 'paid' ? '✓' : '✗'}</div>
            <h1 className="mt-4 text-2xl font-extrabold">{done.status === 'paid' ? 'Payment authorised' : 'Payment declined'}</h1>
            <p className="mt-1 text-sm text-white/60">Webhook to merchant: {String(done.webhook)}</p>
            <p className="mt-5 text-sm text-white/70">Switch back to the restaurant page — it updates automatically.</p>
          </div>)}
      </main>
    </div>
  );
}
export default function Page() { return <Suspense><Bank /></Suspense>; }
