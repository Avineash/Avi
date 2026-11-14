'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError, newKey } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { lkr, lkrFull, dateTime } from '@/lib/money';
import { PageHead, useMe, can } from '@/components/shell';
import { Empty, ErrorBox, Loading, Pill, Sheet, SandboxBadge, Spinner, StatusPill, Toggle, useToast, cx } from '@/components/ui';

const TABS = [['payments', 'Payments'], ['ledger', 'Ledger'], ['recon', 'Reconciliation'], ['methods', 'Methods']] as const;
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

function Inner() {
  const sp = useSearchParams(); const [tab, setTab] = useState<string>(sp.get('tab') ?? 'payments');
  return (<>
    <PageHead title="Payments" sub="Every rupee traced: charges, fees, refunds, settlement and reconciliation." />
    <div className="mb-4 inline-flex rounded-full bg-sunken p-1">{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === k ? 'bg-surface shadow-card' : 'text-muted'}`}>{l}</button>)}</div>
    {tab === 'payments' && <PaymentsTab needs={sp.get('needs') === '1'} />}{tab === 'ledger' && <LedgerTab />}{tab === 'recon' && <ReconTab />}{tab === 'methods' && <MethodsTab />}
  </>);
}
export default function Page() { return <Suspense><Inner /></Suspense>; }

function PaymentsTab({ needs }: { needs: boolean }) {
  const me = useMe(); const toast = useToast();
  const [status, setStatus] = useState(''); const { data, loading, error, reload } = useApi<any[]>(`/api/r/payments?limit=200${status ? `&status=${status}` : ''}`, [status]);
  const [rf, setRf] = useState<any>(null); const [amt, setAmt] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [hist, setHist] = useState<any[]>([]); const key = useState(() => newKey())[0];
  const rows = (data ?? []).filter((p) => !needs || p.needsRefund);
  const open = async (p: any) => { setRf(p); setAmt(((p.amountCents - p.refundedCents) / 100).toFixed(2)); setReason(''); setHist(await api(`/api/r/payments/${p.id}/refunds`).catch(() => [])); };
  async function submit(manual = false) {
    setBusy(true);
    try { const r = await api<any>(`/api/r/payments/${rf.id}/refund`, { body: { amountCents: Math.round(parseFloat(amt) * 100), reason, manual }, headers: { 'idempotency-key': `${key}-${rf.id}-${amt}-${manual}` } });
      toast(r.status === 'succeeded' ? 'Refund processed' : r.status === 'unsupported' ? 'Provider cannot refund via API — use manual refund' : `Refund ${r.status}`, r.status === 'succeeded' ? 'ok' : 'bad'); if (r.status === 'succeeded') setRf(null); else setHist(await api(`/api/r/payments/${rf.id}/refunds`)); reload(); }
    catch (e) { toast((e as ApiError).message, 'bad'); } finally { setBusy(false); }
  }
  return (<>
    <div className="mb-3 flex items-center gap-2"><select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{['paid', 'pending', 'requires_action', 'failed', 'expired', 'cancelled', 'paid_duplicate'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>{needs && <Pill tone="bad">Showing payments needing refund</Pill>}</div>
    <ErrorBox error={error} retry={reload} />
    {loading ? <Loading /> : !rows.length ? <Empty icon="💳" title="No payments">Nothing matches this filter.</Empty> : (
      <div className="card overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead><tr className="text-left text-xs uppercase text-muted"><th className="p-3">When</th><th>Order</th><th>Method</th><th>Status</th><th className="text-right">Amount</th><th className="text-right">Fee</th><th className="text-right">Refunded</th><th>Settlement</th><th /></tr></thead>
        <tbody>{rows.map((p) => (<tr key={p.id} className="border-t border-line align-middle"><td className="p-3 whitespace-nowrap">{dateTime(p.createdAt)}</td><td>#{p.orderNumber} <span className="text-muted">· {p.table}</span></td>
          <td>{p.method === 'lankaqr' ? 'LankaQR' : 'Card'} {p.mode === 'sandbox' && <SandboxBadge className="ml-1" />}<div className="font-mono text-[11px] text-muted">{p.ref}</div></td>
          <td><StatusPill s={p.status} />{p.needsRefund && <div className="mt-1"><Pill tone="bad">needs refund</Pill></div>}{p.failure && <div className="mt-1 text-xs text-muted">{p.failure}</div>}</td>
          <td className="text-right tabular">{lkr(p.amountCents, { dec: true })}</td><td className="text-right tabular text-muted">{p.feeCents ? lkr(p.feeCents, { dec: true }) : '—'}</td><td className="text-right tabular">{p.refundedCents ? lkr(p.refundedCents, { dec: true }) : '—'}</td>
          <td><StatusPill s={p.settlement} /></td>
          <td className="p-3 text-right">{can(me, 'refunds:create') && ['paid', 'paid_duplicate'].includes(p.status) && p.refundedCents < p.amountCents ? <button className="btn btn-line btn-sm" onClick={() => open(p)}>Refund</button> : null}</td></tr>))}</tbody></table></div>)}
    <Sheet open={!!rf} onClose={() => setRf(null)} title={`Refund · order #${rf?.orderNumber ?? ''}`}>{rf && <div className="space-y-4 p-5">
      <div className="rounded-xl bg-sunken p-3 text-sm">Paid <b>{lkrFull(rf.amountCents)}</b> via {rf.method === 'lankaqr' ? 'LankaQR' : 'card'} · already refunded <b>{lkrFull(rf.refundedCents)}</b></div>
      <label className="block"><span className="label">Amount (Rs.)</span><input className="input" type="number" step="0.01" min="0.01" value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
      <label className="block"><span className="label">Reason (kept in audit log)</span><input className="input" minLength={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong item served" /></label>
      {hist.length > 0 && <ul className="space-y-1 text-xs">{hist.map((h) => <li key={h.id} className="flex justify-between gap-2"><span>{dateTime(h.created_at)} · {h.reason}{h.auto ? ' (auto)' : ''}</span><span><StatusPill s={h.status} /> {lkr(h.amount_cents, { dec: true })}</span></li>)}{hist.some((h) => h.error) && <li className="text-warn">{hist.find((h) => h.error)?.error}</li>}</ul>}
      <button className="btn btn-brand w-full" disabled={busy || reason.length < 3 || !(parseFloat(amt) > 0)} onClick={() => submit(false)}>{busy ? <Spinner /> : `Refund ${amt ? lkrFull(Math.round(parseFloat(amt) * 100)) : ''}`}</button>
      <button className="w-full text-sm font-semibold text-muted underline" disabled={busy || reason.length < 3} onClick={() => submit(true)}>Already refunded in the provider portal? Record as manual refund</button></div>}</Sheet>
  </>);
}

function LedgerTab() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState(today());
  const q = `from=${from}&to=${to}`; const { data, loading, error, reload } = useApi<any[]>(`/api/r/ledger?${from ? q : `to=${to}`}`, [from, to]);
  const tone: Record<string, any> = { charge: 'ok', refund: 'bad', gateway_fee: 'muted', platform_fee_accrued: 'muted', duplicate_charge: 'bad', adjustment: 'warn' };
  return (<>
    <div className="mb-3 flex flex-wrap items-end gap-3"><label><span className="label">From</span><input type="date" className="input w-44" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label><span className="label">To</span><input type="date" className="input w-44" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <a className="btn btn-line btn-sm" href={`/api/r/ledger?format=csv&${from ? q : `to=${to}`}`}>⬇ Export CSV</a></div>
    <p className="mb-3 text-xs text-muted">Append-only. Amounts are from the restaurant&apos;s point of view. With direct settlement the platform fee is <i>accrued</i> and invoiced separately — it is not deducted from your payout.</p>
    <ErrorBox error={error} retry={reload} />{loading ? <Loading /> : !data?.length ? <Empty icon="📒" title="No ledger entries" /> : <div className="card overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left text-xs uppercase text-muted"><th className="p-3">When</th><th>Order</th><th>Entry</th><th className="text-right">Amount</th><th className="p-3">Reference</th></tr></thead>
      <tbody>{data.map((r) => <tr key={r.id} className="border-t border-line"><td className="p-3 whitespace-nowrap">{dateTime(r.createdAt)}</td><td>{r.orderNumber ? `#${r.orderNumber}` : '—'}</td><td><Pill tone={tone[r.kind] ?? 'muted'}>{r.kind.replace(/_/g, ' ')}</Pill></td><td className={cx('text-right tabular font-semibold', r.amountCents < 0 && 'text-bad')}>{r.amountCents < 0 ? '−' : ''}{lkr(Math.abs(r.amountCents), { dec: true })}</td><td className="p-3 font-mono text-xs text-muted">{r.ref}</td></tr>)}</tbody></table></div>}
  </>);
}

function ReconTab() {
  const me = useMe(); const toast = useToast(); const { data: cfgs } = useApi<any[]>('/api/r/payment-config'); const { data: runs, reload } = useApi<any[]>('/api/r/reconciliations');
  const [prov, setProv] = useState(''); const [from, setFrom] = useState(today()); const [to, setTo] = useState(today()); const [busy, setBusy] = useState(false); const [view, setView] = useState<any>(null);
  const run = async () => { setBusy(true); try { const r = await api<any>('/api/r/reconcile', { body: { provider: prov || cfgs?.[0]?.provider, from, to } }); setView(r); toast(r.status === 'clean' ? 'Reconciled — no discrepancies' : `${r.summary.discrepancies} discrepancies found`, r.status === 'clean' ? 'ok' : 'bad'); reload(); } catch (e) { toast((e as ApiError).message, 'bad'); } finally { setBusy(false); } };
  return (<>
    <p className="mb-3 text-sm text-muted">Compares our records against the provider&apos;s own transaction list. A payment the provider captured but we missed is applied automatically; anything else is flagged for you.</p>
    {can(me, 'refunds:create') && <div className="card mb-4 flex flex-wrap items-end gap-3 p-4"><label><span className="label">Provider</span><select className="input w-56" value={prov} onChange={(e) => setProv(e.target.value)}>{cfgs?.map((c) => <option key={c.provider} value={c.provider}>{c.providerLabel}</option>)}</select></label>
      <label><span className="label">From</span><input type="date" className="input w-44" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label><span className="label">To</span><input type="date" className="input w-44" value={to} onChange={(e) => setTo(e.target.value)} /></label><button className="btn btn-brand" disabled={busy} onClick={run}>{busy ? <Spinner /> : 'Run reconciliation'}</button></div>}
    {!runs?.length ? <Empty icon="🧮" title="No runs yet" /> : <div className="space-y-2">{runs.map((r) => <button key={r.id} onClick={() => setView(r)} className="card flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left"><span className="text-sm"><b>{r.provider}</b> · {String(r.period_from).slice(0, 10)} → {String(r.period_to).slice(0, 10)} <span className="text-muted">· run {dateTime(r.created_at)}</span></span><span className="flex items-center gap-2 text-xs text-muted">{r.summary.matched} matched · {r.summary.healed} healed<StatusPill s={r.status} /></span></button>)}</div>}
    <Sheet open={!!view} onClose={() => setView(null)} title="Reconciliation report" wide>{view && <div className="p-5"><div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(view.summary).map(([k, v]) => <div key={k} className="rounded-xl bg-sunken p-3"><div className="text-[11px] font-bold uppercase text-muted">{k.replace(/([A-Z])/g, ' $1')}</div><div className="text-xl font-extrabold tabular">{String(v)}</div></div>)}</div>
      {view.items.length === 0 ? <p className="text-sm text-ok">✓ Every provider transaction matches our records.</p> : <ul className="space-y-2">{view.items.map((i: any, k: number) => <li key={k} className="rounded-xl border border-line p-3 text-sm"><div className="flex items-center justify-between gap-2"><Pill tone={i.kind === 'healed' ? 'ok' : 'bad'}>{i.kind.replace(/_/g, ' ')}</Pill><span className="font-mono text-xs">{i.ref}</span></div><p className="mt-1 text-muted">{i.detail}</p></li>)}</ul>}</div>}</Sheet>
  </>);
}

function MethodsTab() {
  const me = useMe(); const toast = useToast(); const { data, loading, error, reload } = useApi<any[]>('/api/r/payment-config');
  const flip = async (m: any, enabled: boolean) => { try { await api(`/api/r/payment-config/${m.method}`, { method: 'PATCH', body: { enabled } }); reload(); } catch (e) { toast((e as ApiError).message, 'bad'); } };
  const why: Record<string, string> = { not_configured: 'Provider credentials are not configured yet', provider_outage: 'Provider is currently unreachable', live_not_approved: 'Live mode awaiting TableFlow approval', dynamic_qr_not_implemented: 'Dynamic LankaQR not yet enabled by your acquirer' };
  return (<><ErrorBox error={error} retry={reload} />{loading ? <Loading /> : <div className="grid gap-3 sm:grid-cols-2">{data?.map((m) => (
    <div key={m.method} className="card p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-lg font-extrabold">{m.method === 'lankaqr' ? 'LankaQR' : 'Credit / debit card'}</div><div className="text-sm text-muted">{m.providerLabel}</div></div>
      <Toggle on={m.enabled} disabled={!can(me, 'settings:write')} onChange={(v) => flip(m, v)} label={`${m.method} enabled`} /></div>
      <div className="mt-3 flex flex-wrap gap-2"><Pill tone={m.mode === 'live' ? 'ok' : 'warn'}>{m.mode}</Pill><Pill tone={m.available ? 'ok' : 'bad'}>{m.available ? 'available' : 'unavailable'}</Pill><Pill>{m.settlementModel} settlement</Pill></div>
      {!m.available && m.enabled && <p className="mt-2 text-xs text-warn">{why[m.reason] ?? m.reason}. Customers are offered {m.method === 'lankaqr' ? 'card' : 'LankaQR'} instead.</p>}
      <p className="mt-3 text-xs text-muted">Provider credentials, live approval and settlement model are managed by TableFlow after merchant onboarding — contact support to change them.</p></div>))}</div>}</>);
}
