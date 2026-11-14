'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { lkr, dateTime } from '@/lib/money';
import { PageHead, useMe, can } from '@/components/shell';
import { Empty, ErrorBox, Field, Loading, Pill, Sheet, SandboxBadge, Spinner, StatusPill, Toggle, useToast } from '@/components/ui';

export default function Restaurants() {
  const me = useMe(); const w = can(me, 'platform:write'); const toast = useToast();
  const { data, loading, error, reload } = useApi<any[]>('/api/admin/restaurants'); const { data: plans } = useApi<any[]>('/api/admin/plans');
  const [act, setAct] = useState<{ r: any; kind: 'approve' | 'reject' | 'suspend' } | null>(null); const [reason, setReason] = useState(''); const [plan, setPlan] = useState('starter'); const [cfg, setCfg] = useState<any>(null); const [nw, setNw] = useState<any>(null);
  async function doAct() { try { await api(`/api/admin/restaurants/${act!.r.id}/${act!.kind}`, { body: { planId: plan, reason } }); toast(`Restaurant ${act!.kind}d`); setAct(null); setReason(''); reload(); } catch (e) { toast((e as ApiError).message, 'bad'); } }
  return (<>
    <PageHead title="Restaurants" actions={w && <button className="btn btn-brand btn-sm" onClick={() => setNw({ name: '', city: 'Colombo', ownerName: '', email: '', password: '', planId: 'starter' })}>+ Register restaurant</button>} />
    <ErrorBox error={error} retry={reload} />{loading ? <Loading /> : !data?.length ? <Empty title="No restaurants" /> :
      <div className="card overflow-x-auto"><table className="w-full min-w-[780px] text-sm"><thead><tr className="text-left text-xs uppercase text-muted"><th className="p-3">Restaurant</th><th>Status</th><th>Plan</th><th className="text-right">Orders 30d</th><th className="text-right">Volume 30d</th><th className="text-right">Failed</th><th /></tr></thead>
        <tbody>{data.map((r) => (<tr key={r.id} className="border-t border-line"><td className="p-3"><div className="font-bold">{r.name}</div><div className="text-xs text-muted">{r.city} · {r.email} · since {dateTime(r.created_at)}</div>{r.suspended_reason && <div className="text-xs text-bad">Suspended: {r.suspended_reason}</div>}</td>
          <td><StatusPill s={r.status} /></td><td className="capitalize">{r.plan_id}</td><td className="text-right tabular">{r.orders30}</td><td className="text-right tabular">{lkr(r.gmv30)}</td><td className="text-right tabular">{r.failed30}</td>
          <td className="p-3"><div className="flex justify-end gap-2">{r.status === 'pending' && w && <><button className="btn btn-brand btn-sm" onClick={() => { setAct({ r, kind: 'approve' }); setPlan(r.plan_id ?? 'starter'); }}>Approve</button><button className="btn btn-line btn-sm" onClick={() => setAct({ r, kind: 'reject' })}>Reject</button></>}
            {r.status === 'active' && w && <button className="btn btn-line btn-sm" onClick={() => setAct({ r, kind: 'suspend' })}>Suspend</button>}{r.status === 'suspended' && w && <button className="btn btn-brand btn-sm" onClick={async () => { await api(`/api/admin/restaurants/${r.id}/reinstate`, { body: {} }); toast('Reinstated'); reload(); }}>Reinstate</button>}
            {r.status !== 'pending' && r.status !== 'rejected' && <button className="btn btn-ghost btn-sm" onClick={() => setCfg(r)}>Payments</button>}</div></td></tr>))}</tbody></table></div>}
    <Sheet open={!!act} onClose={() => setAct(null)} title={act ? `${act.kind[0].toUpperCase()}${act.kind.slice(1)} ${act.r.name}` : ''} footer={<button className={`btn w-full ${act?.kind === 'approve' ? 'btn-brand' : 'btn-danger'}`} disabled={act?.kind !== 'approve' && reason.length < 3} onClick={doAct}>Confirm {act?.kind}</button>}>
      <div className="space-y-4 p-5">{act?.kind === 'approve' ? <><Field label="Plan"><select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>{plans?.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} — {lkr(p.monthly_fee_cents)}/mo + {p.txn_fee_bps / 100}%</option>)}</select></Field>
        <p className="text-sm text-muted">Approval creates sandbox payment methods so the restaurant can test immediately. Real money requires merchant onboarding and the go-live checklist (Payments → provider).</p></> : <Field label="Reason (shown to the restaurant, kept in audit log)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}</div></Sheet>
    <Sheet open={!!nw} onClose={() => setNw(null)} title="Register a restaurant">{nw && <form className="space-y-3 p-5" onSubmit={async (e) => { e.preventDefault(); try { await api('/api/admin/restaurants', { body: nw }); setNw(null); toast('Restaurant created and approved'); reload(); } catch (ex) { toast((ex as ApiError).message, 'bad'); } }}>
      {(['name', 'city', 'ownerName', 'email'] as const).map((k) => <Field key={k} label={k === 'ownerName' ? 'Owner name' : k}><input className="input" required type={k === 'email' ? 'email' : 'text'} value={nw[k]} onChange={(e) => setNw({ ...nw, [k]: e.target.value })} /></Field>)}
      <Field label="Temporary password"><input className="input" type="password" minLength={10} required value={nw.password} onChange={(e) => setNw({ ...nw, password: e.target.value })} /></Field><Field label="Plan"><select className="input" value={nw.planId} onChange={(e) => setNw({ ...nw, planId: e.target.value })}>{plans?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><button className="btn btn-brand w-full">Create</button></form>}</Sheet>
    {cfg && <ProviderConfig r={cfg} w={w} onClose={() => setCfg(null)} />}
  </>);
}

function ProviderConfig({ r, w, onClose }: { r: any; w: boolean; onClose: () => void }) {
  const toast = useToast(); const { data, reload } = useApi<any[]>(`/api/admin/restaurants/${r.id}/payment-configs`); const { data: provs } = useApi<any[]>('/api/admin/providers');
  const [edit, setEdit] = useState<any>(null); const [live, setLive] = useState<any>(null); const [busy, setBusy] = useState(false);
  const methods = ['lankaqr', 'card'] as const;
  const open = (m: string) => { const c = data?.find((x) => x.method === m); setEdit({ method: m, provider: c?.provider ?? provs?.find((p) => p.method === m)?.key, enabled: c?.enabled ?? true, settlementModel: c?.settlementModel ?? 'direct', feeBps: c?.feeBps ?? 0, merchantId: c?.config?.merchantId ?? '', secret: '', mcc: c?.config?.mcc ?? '5812' }); };
  async function save() {
    setBusy(true);
    try { const p = provs?.find((x) => x.key === edit.provider); const secrets: Record<string, string> = {}; if (edit.secret) secrets[edit.provider === 'payhere' ? 'merchantSecret' : 'apiKey'] = edit.secret;
      await api(`/api/admin/restaurants/${r.id}/payment-configs/${edit.method}`, { method: 'PUT', body: { provider: edit.provider, enabled: edit.enabled, settlementModel: edit.settlementModel, feeBps: edit.feeBps, config: { merchantId: edit.merchantId || undefined, mcc: edit.mcc }, secrets: Object.keys(secrets).length ? secrets : undefined } });
      toast(`Saved. ${p?.sandbox ? '' : 'Mode reset to sandbox until you complete go-live.'}`); setEdit(null); reload(); } catch (e) { toast((e as ApiError).data?.message ?? (e as ApiError).message, 'bad'); } finally { setBusy(false); }
  }
  const [cl, setCl] = useState({ merchantAgreementSigned: false, providerSandboxTestsPassed: false, settlementAccountVerified: false, webhookVerifiedInProviderSandbox: false });
  return (
    <Sheet open onClose={onClose} wide title={`Payments · ${r.name}`}><div className="space-y-4 p-5">
      <div className="rounded-xl border border-line bg-sunken p-3 text-xs text-muted"><b>Direct merchant settlement</b> is the default: the customer&apos;s payment settles to the restaurant&apos;s own acquiring account and TableFlow invoices fees separately. Marketplace (split) settlement is offered only for providers whose split-settlement capability has been verified.</div>
      {methods.map((m) => { const c = data?.find((x) => x.method === m); return (
        <div key={m} className="card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-extrabold">{m === 'lankaqr' ? 'LankaQR' : 'Credit / debit card'}</div><div className="text-sm text-muted">{c ? provs?.find((p) => p.key === c.provider)?.label ?? c.provider : 'Not configured'}</div></div>
          <div className="flex items-center gap-2">{c && <><Pill tone={c.enabled ? 'ok' : 'muted'}>{c.enabled ? 'enabled' : 'off'}</Pill><Pill tone={c.mode === 'live' ? 'ok' : 'warn'}>{c.mode}</Pill>{c.hasCredentials && <Pill>🔐 credentials stored</Pill>}</>}
            {w && <button className="btn btn-line btn-sm" onClick={() => open(m)}>Configure</button>}{w && c && c.mode !== 'live' && !provs?.find((p) => p.key === c.provider)?.sandbox && <button className="btn btn-brand btn-sm" onClick={() => setLive(c)}>Go live…</button>}</div></div>
          {c?.liveApprovedAt && <p className="mt-2 text-xs text-ok">Live approved {dateTime(c.liveApprovedAt)}</p>}</div>); })}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={`Configure ${edit?.method === 'lankaqr' ? 'LankaQR' : 'card'} provider`} footer={<button className="btn btn-brand w-full" disabled={busy} onClick={save}>{busy ? <Spinner /> : 'Save'}</button>}>{edit && <div className="space-y-4 p-5">
        <Field label="Provider"><select className="input" value={edit.provider} onChange={(e) => setEdit({ ...edit, provider: e.target.value })}>{provs?.filter((p) => p.method === edit.method).map((p) => <option key={p.key} value={p.key}>{p.label}{p.sandbox ? ' — SANDBOX' : ''}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Merchant ID"><input className="input" value={edit.merchantId} onChange={(e) => setEdit({ ...edit, merchantId: e.target.value })} /></Field><Field label="Provider fee (bps)" hint="For ledger estimates"><input className="input" type="number" min={0} max={1000} value={edit.feeBps} onChange={(e) => setEdit({ ...edit, feeBps: +e.target.value })} /></Field></div>
        <Field label="Credential (secret / API key)" hint="Encrypted at rest (AES-256-GCM). Write-only: it is never shown again."><input className="input" type="password" autoComplete="off" value={edit.secret} onChange={(e) => setEdit({ ...edit, secret: e.target.value })} placeholder={data?.find((x) => x.method === edit.method)?.hasCredentials ? '•••••••• (leave blank to keep)' : ''} /></Field>
        <Field label="Settlement model"><select className="input" value={edit.settlementModel} onChange={(e) => setEdit({ ...edit, settlementModel: e.target.value })}><option value="direct">Direct to merchant (default)</option><option value="marketplace" disabled={!provs?.find((p) => p.key === edit.provider)?.capabilities.marketplaceSplit}>Marketplace / split {provs?.find((p) => p.key === edit.provider)?.capabilities.marketplaceSplit ? '' : '(unsupported by this provider)'}</option></select></Field>
        <label className="flex items-center justify-between rounded-xl bg-sunken p-3 text-sm font-semibold">Enabled for customers<Toggle on={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} label="enabled" /></label></div>}</Sheet>
      <Sheet open={!!live} onClose={() => setLive(null)} title="Go live — real money" footer={<button className="btn btn-danger w-full" disabled={!Object.values(cl).every(Boolean)} onClick={async () => { try { await api(`/api/admin/restaurants/${r.id}/payment-configs/${live.method}/go-live`, { body: { checklist: cl } }); toast('Live mode approved'); setLive(null); reload(); } catch (e) { toast((e as ApiError).message, 'bad'); } }}>Enable live payments</button>}>
        <div className="space-y-3 p-5"><p className="rounded-xl bg-bad/10 p-3 text-sm font-semibold text-bad">After this, customers of {r.name} will be charged real money. Complete merchant onboarding first.</p>
          {([['merchantAgreementSigned', 'Merchant agreement signed with the acquiring bank / provider'], ['providerSandboxTestsPassed', 'Provider sandbox test cases passed (success, decline, 3DS, refund, expiry)'], ['settlementAccountVerified', 'Settlement bank account verified in the restaurant’s name'], ['webhookVerifiedInProviderSandbox', 'Webhook signature verified end-to-end in the provider sandbox']] as const).map(([k, l]) =>
            <label key={k} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" checked={cl[k]} onChange={(e) => setCl({ ...cl, [k]: e.target.checked })} />{l}</label>)}</div></Sheet>
    </div></Sheet>
  );
}
export { SandboxBadge };
