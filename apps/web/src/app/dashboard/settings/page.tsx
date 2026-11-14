'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { brandVars } from '@/lib/theme';
import { lkr } from '@/lib/money';
import { PageHead, useMe, can } from '@/components/shell';
import { Field, Loading, Spinner, useToast } from '@/components/ui';

const FONTS = [['modern', 'Modern sans'], ['classic', 'Classic serif headings'], ['rounded', 'Friendly rounded']] as const;
const PRESETS = [['#0F5C4D', '#E9A23B', 'Ceylon green'], ['#7A1F3D', '#F2C14E', 'Mulberry'], ['#1D4ED8', '#F59E0B', 'Ocean'], ['#C2410C', '#16A34A', 'Spice'], ['#111827', '#F43F5E', 'Charcoal']] as const;

export default function Settings() {
  const me = useMe(); const toast = useToast(); const w = can(me, 'settings:write');
  const { data, loading, reload } = useApi<any>('/api/r/settings'); const [f, setF] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF({ ...data, branding: { primary: '#0F5C4D', secondary: '#E9A23B', font: 'modern', theme: 'auto', tagline: '', ...data.branding } }); }, [data]);
  const [pw, setPw] = useState({ current: '', next: '' });
  if (loading || !f) return <Loading />;
  const b = f.branding; const set = (k: string, v: any) => setF({ ...f, [k]: v }); const setB = (k: string, v: any) => setF({ ...f, branding: { ...b, [k]: v } });
  const vars = brandVars(b, false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api('/api/r/settings', { method: 'PATCH', body: { name: f.name, phone: f.phone, address: f.address, city: f.city, defaultLang: f.defaultLang, serviceChargeBps: f.serviceChargeBps, taxBps: f.taxBps, taxLabel: f.taxLabel, taxRegNo: f.taxRegNo, branding: { ...b, logoUrl: b.logoUrl ?? null } } }); toast('Settings saved'); reload(); }
    catch (ex) { toast((ex as ApiError).data?.issues?.[0]?.message ?? (ex as ApiError).message, 'bad'); } finally { setBusy(false); }
  }
  async function logo(file: File) { const fd = new FormData(); fd.append('file', file); const r = await fetch('/api/r/uploads', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'x-tf-csrf': '1' } }); const j = await r.json(); if (r.ok) setB('logoUrl', j.url); else toast(j.message, 'bad'); }
  const sample = 145000, svc = Math.round(sample * f.serviceChargeBps / 10000), tax = Math.round((sample + svc) * f.taxBps / 10000);
  return (
    <form onSubmit={save}>
      <PageHead title="Settings & branding" sub={w ? undefined : 'Only the owner can change settings.'} actions={w && <button className="btn btn-brand" disabled={busy}>{busy ? <Spinner /> : 'Save changes'}</button>} />
      <fieldset disabled={!w} className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <section className="card space-y-4 p-5"><h2 className="font-extrabold">Restaurant</h2>
            <Field label="Name"><input className="input" required value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Phone"><input className="input" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field><Field label="City"><input className="input" value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field></div>
            <Field label="Address"><input className="input" value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="Default language for new customers"><select className="input" value={f.defaultLang} onChange={(e) => set('defaultLang', e.target.value)}><option value="en">English</option><option value="si">සිංහල</option><option value="ta">தமிழ்</option></select></Field></section>
          <section className="card space-y-4 p-5"><h2 className="font-extrabold">Service charge & tax</h2>
            <div className="grid gap-3 sm:grid-cols-3"><Field label="Service charge %"><input className="input" type="number" step="0.5" min={0} max={30} value={f.serviceChargeBps / 100} onChange={(e) => set('serviceChargeBps', Math.round(+e.target.value * 100))} /></Field>
              <Field label="Tax %"><input className="input" type="number" step="0.5" min={0} max={30} value={f.taxBps / 100} onChange={(e) => set('taxBps', Math.round(+e.target.value * 100))} /></Field><Field label="Tax label"><input className="input" maxLength={20} value={f.taxLabel} onChange={(e) => set('taxLabel', e.target.value)} /></Field></div>
            <Field label="Tax registration no. (printed on receipts)"><input className="input" value={f.taxRegNo ?? ''} onChange={(e) => set('taxRegNo', e.target.value)} /></Field>
            <p className="rounded-xl bg-sunken p-3 text-xs text-muted">Example on Rs. 1,450 → service {lkr(svc, { dec: true })} (on subtotal) + {f.taxLabel} {lkr(tax, { dec: true })} (on subtotal + service) = <b className="text-ink">{lkr(sample + svc + tax, { dec: true })}</b>. Confirm rates with your accountant; set Tax to 0 if you are not VAT-registered.</p></section>
          <section className="card space-y-4 p-5"><h2 className="font-extrabold">Branding</h2>
            <div className="flex items-center gap-4">{b.logoUrl ? <img src={b.logoUrl} alt="Logo" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-line" /> : <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand text-2xl font-black text-onbrand" style={vars as React.CSSProperties}>{f.name[0]}</div>}
              <div><label className="btn btn-line btn-sm cursor-pointer">Upload logo<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && logo(e.target.files[0])} /></label>{b.logoUrl && <button type="button" className="ml-3 text-xs font-bold text-bad" onClick={() => setB('logoUrl', null)}>Remove</button>}</div></div>
            <Field label="Tagline"><input className="input" maxLength={80} value={b.tagline ?? ''} onChange={(e) => setB('tagline', e.target.value)} /></Field>
            <div><span className="label">Colour presets</span><div className="flex flex-wrap gap-2">{PRESETS.map(([p, s, n]) => <button type="button" key={n} title={n} aria-label={n} onClick={() => setF({ ...f, branding: { ...b, primary: p, secondary: s } })} className="flex h-10 w-16 overflow-hidden rounded-xl ring-2 ring-line"><span className="flex-1" style={{ background: p }} /><span className="flex-1" style={{ background: s }} /></button>)}</div></div>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Primary colour"><div className="flex gap-2"><input type="color" aria-label="Primary colour" className="h-12 w-14 rounded-lg" value={b.primary} onChange={(e) => setB('primary', e.target.value)} /><input className="input font-mono" value={b.primary} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && setB('primary', e.target.value)} /></div></Field>
              <Field label="Secondary colour"><div className="flex gap-2"><input type="color" aria-label="Secondary colour" className="h-12 w-14 rounded-lg" value={b.secondary} onChange={(e) => setB('secondary', e.target.value)} /><input className="input font-mono" value={b.secondary} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && setB('secondary', e.target.value)} /></div></Field></div>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Typography"><select className="input" value={b.font} onChange={(e) => setB('font', e.target.value)}>{FONTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Default theme"><select className="input" value={b.theme} onChange={(e) => setB('theme', e.target.value)}><option value="auto">Follow phone setting</option><option value="light">Light</option><option value="dark">Dark</option></select></Field></div>
            <p className="text-xs text-muted">Text colours are automatically adjusted to stay readable (WCAG AA) whatever colour you pick. Customers can still switch light/dark.</p></section>
        </div>
        <aside className="lg:sticky lg:top-20 lg:self-start"><div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Customer preview</div>
          <div style={vars as React.CSSProperties} data-font={b.font} className="overflow-hidden rounded-[2rem] border-[6px] border-ink/90 bg-bg shadow-pop">
            <div className="px-4 pb-4 pt-6" style={{ background: 'linear-gradient(160deg, rgb(var(--brand)), rgb(var(--brand) / .82) 60%, rgb(var(--brand2) / .9) 160%)' }}><div className="flex items-center gap-3">{b.logoUrl ? <img src={b.logoUrl} alt="" className="h-11 w-11 rounded-xl bg-white object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/90 text-lg font-black text-brand">{f.name[0]}</div>}<div className="text-onbrand"><div className="font-display text-lg font-extrabold leading-tight">{f.name}</div><div className="text-xs opacity-90">{b.tagline}</div></div></div></div>
            <div className="space-y-3 p-4"><div className="flex gap-2"><span className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-onbrand">Mains</span><span className="rounded-full bg-sunken px-3 py-1.5 text-xs font-bold">Drinks</span></div>
              <div className="card flex items-center gap-3 p-3"><div className="h-14 w-14 rounded-xl" style={{ background: 'linear-gradient(135deg, rgb(var(--brand2)), rgb(var(--brand)))' }} /><div className="flex-1"><div className="font-bold">Chicken Kottu</div><div className="text-sm font-semibold text-brandtext">Rs. 1,450</div></div><span className="grid h-8 w-8 place-items-center rounded-full bg-brand font-bold text-onbrand">+</span></div>
              <div className="btn btn-brand w-full">Pay Rs. 1,882.10</div></div></div></aside>
      </fieldset>
      <section className="card mt-5 max-w-xl space-y-3 p-5"><h2 className="font-extrabold">Change my password</h2>
        <input className="input" type="password" autoComplete="current-password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /><input className="input" type="password" autoComplete="new-password" placeholder="New password (10+ characters)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        <button type="button" className="btn btn-line" disabled={pw.next.length < 10} onClick={async () => { try { await api('/api/auth/change-password', { body: pw }); setPw({ current: '', next: '' }); toast('Password changed'); } catch (e) { toast((e as ApiError).message, 'bad'); } }}>Update password</button></section>
    </form>
  );
}
