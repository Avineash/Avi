'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateTime } from '@/lib/money';
import { PageHead, useMe } from '@/components/shell';
import { ErrorBox, Loading, Pill, Sheet, Spinner, Toggle, useToast } from '@/components/ui';

const ROLES = [['manager', 'Manager — menu, payments, refunds, reports'], ['cashier', 'Cashier — orders, payments (no refunds)'], ['kitchen', 'Kitchen — kitchen display only']] as const;

export default function Staff() {
  const me = useMe(); const toast = useToast(); const { data, loading, error, reload } = useApi<any[]>('/api/r/staff');
  const [f, setF] = useState<any>(null); const [busy, setBusy] = useState(false); const [reset, setReset] = useState<any>(null); const [pw, setPw] = useState('');
  async function add(e: React.FormEvent) { e.preventDefault(); setBusy(true); try { await api('/api/r/staff', { body: f }); setF(null); toast('Staff member added'); reload(); } catch (ex) { toast((ex as ApiError).data?.issues?.[0]?.message ?? (ex as ApiError).message, 'bad'); } finally { setBusy(false); } }
  const patch = async (id: string, body: object) => { try { await api(`/api/r/staff/${id}`, { method: 'PATCH', body }); reload(); } catch (ex) { toast((ex as ApiError).message, 'bad'); } };
  return (<>
    <PageHead title="Staff access" sub="Give each person only the access they need." actions={<button className="btn btn-brand btn-sm" onClick={() => setF({ name: '', email: '', role: 'kitchen', password: '' })}>+ Add staff</button>} />
    <ErrorBox error={error} retry={reload} />{loading ? <Loading /> : (
      <div className="card divide-y divide-line">{data?.map((u) => (
        <div key={u.id} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-0 flex-1"><div className="flex items-center gap-2 font-bold">{u.name} {u.id === me.id && <Pill tone="brand">you</Pill>}{!u.active && <Pill tone="bad">disabled</Pill>}</div><div className="text-sm text-muted">{u.email} · last sign-in {u.last_login_at ? dateTime(u.last_login_at) : 'never'}</div></div>
          {u.role === 'owner' ? <Pill tone="brand">owner</Pill> : <>
            <select aria-label={`Role for ${u.name}`} className="input w-36" value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}>{ROLES.map(([r]) => <option key={r} value={r}>{r}</option>)}</select>
            <button className="btn btn-ghost btn-sm" onClick={() => { setReset(u); setPw(''); }}>Reset password</button><Toggle on={u.active} onChange={(v) => patch(u.id, { active: v })} label={`${u.name} active`} /></>}</div>))}</div>)}
    <Sheet open={!!f} onClose={() => setF(null)} title="Add staff member">{f && <form className="space-y-4 p-5" onSubmit={add}>
      <label className="block"><span className="label">Name</span><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label><label className="block"><span className="label">Email</span><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <fieldset><legend className="label">Role</legend><div className="space-y-2">{ROLES.map(([r, d]) => <label key={r} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3"><input type="radio" className="mt-1 accent-[rgb(var(--brand))]" checked={f.role === r} onChange={() => setF({ ...f, role: r })} /><span><b className="capitalize">{r}</b><span className="block text-xs text-muted">{d}</span></span></label>)}</div></fieldset>
      <label className="block"><span className="label">Temporary password</span><input className="input" type="password" minLength={10} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><span className="mt-1 block text-xs text-muted">At least 10 characters. Ask them to change it after signing in.</span></label>
      <button className="btn btn-brand w-full" disabled={busy}>{busy ? <Spinner /> : 'Add'}</button></form>}</Sheet>
    <Sheet open={!!reset} onClose={() => setReset(null)} title={`Reset password · ${reset?.name ?? ''}`}><form className="space-y-4 p-5" onSubmit={async (e) => { e.preventDefault(); await patch(reset.id, { password: pw }); setReset(null); toast('Password reset'); }}><input className="input" type="password" minLength={10} required placeholder="New password (10+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} /><button className="btn btn-brand w-full">Reset</button></form></Sheet>
  </>);
}
