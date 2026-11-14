'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Spinner } from '@/components/ui';

export default function Register() {
  const [f, setF] = useState({ restaurantName: '', city: 'Colombo', phone: '', ownerName: '', email: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setErr(''); try { await api('/api/auth/register-restaurant', { body: { ...f, phone: f.phone || undefined } }); setDone(true); } catch (ex) { setErr((ex as ApiError).data?.issues?.map((i: any) => `${i.path}: ${i.message}`).join(', ') || (ex as ApiError).message); setBusy(false); } }
  if (done) return <main className="mx-auto grid min-h-dvh max-w-md content-center px-5 text-center"><div className="text-6xl">🎉</div><h1 className="mt-4 font-display text-3xl font-extrabold">Application received</h1>
    <p className="mt-2 text-muted">The TableFlow team will review <b>{f.restaurantName}</b>, set up your payment provider and approve your account. You can sign in once approved.</p><Link href="/login" className="btn btn-brand mt-6">Go to sign in</Link></main>;
  return (
    <main className="mx-auto max-w-md px-5 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2 font-extrabold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-onbrand">T</span> TableFlow</Link>
      <h1 className="font-display text-3xl font-extrabold">Register your café</h1><p className="mt-1 text-muted">Takes two minutes. No hardware needed — just a phone.</p>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
        <label className="block"><span className="label">Restaurant name</span><input className="input" required minLength={2} value={f.restaurantName} onChange={set('restaurantName')} /></label>
        <div className="grid grid-cols-2 gap-3"><label className="block"><span className="label">City</span><input className="input" value={f.city} onChange={set('city')} /></label><label className="block"><span className="label">Phone</span><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></label></div>
        <label className="block"><span className="label">Your name</span><input className="input" required minLength={2} value={f.ownerName} onChange={set('ownerName')} /></label>
        <label className="block"><span className="label">Email</span><input className="input" type="email" required value={f.email} onChange={set('email')} /></label>
        <label className="block"><span className="label">Password</span><input className="input" type="password" required minLength={10} value={f.password} onChange={set('password')} /><span className="mt-1 block text-xs text-muted">At least 10 characters.</span></label>
        {err && <p role="alert" className="rounded-xl bg-bad/10 p-3 text-sm font-medium text-bad">{err}</p>}
        <button className="btn btn-brand w-full" disabled={busy}>{busy ? <Spinner /> : 'Submit application'}</button>
      </form>
    </main>
  );
}
