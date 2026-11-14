'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Spinner } from '@/components/ui';

const DEMO = [
  { as: 'owner', label: 'Café owner', email: 'owner@ceylonbrew.lk' }, { as: 'manager', label: 'Manager', email: 'manager@ceylonbrew.lk' },
  { as: 'kitchen', label: 'Kitchen', email: 'kitchen@ceylonbrew.lk' }, { as: 'cashier', label: 'Cashier', email: 'cashier@ceylonbrew.lk' },
  { as: 'admin', label: 'Platform admin', email: 'admin@tableflow.lk' },
];

function Login() {
  const router = useRouter(); const sp = useSearchParams();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [sandbox, setSandbox] = useState(false);
  useEffect(() => { api('/api/health').then((h) => setSandbox(!!h.sandbox)).catch(() => undefined); const a = DEMO.find((d) => d.as === sp.get('as')); if (a) setEmail(a.email); }, [sp]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const u = await api<{ role: string; restaurantId: string | null }>('/api/auth/login', { body: { email, password } });
      router.push(!u.restaurantId ? '/admin' : u.role === 'kitchen' ? '/kitchen' : '/dashboard');
    } catch (ex) { setErr((ex as ApiError).message); setBusy(false); }
  }
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center px-5 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2 font-extrabold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-onbrand">T</span> TableFlow</Link>
      <h1 className="font-display text-3xl font-extrabold">Sign in</h1><p className="mt-1 text-muted">For restaurant staff and TableFlow administrators.</p>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
        <label className="block"><span className="label">Email</span><input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="block"><span className="label">Password</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <p role="alert" className="rounded-xl bg-bad/10 p-3 text-sm font-medium text-bad">{err}</p>}
        <button className="btn btn-brand w-full" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</button>
      </form>
      {sandbox && <div className="mt-5 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm"><div className="mb-2 font-bold text-warn">Demo accounts (sandbox only)</div>
        <div className="flex flex-wrap gap-2">{DEMO.map((d) => <button key={d.as} type="button" className="btn btn-line btn-sm" onClick={() => { setEmail(d.email); setPassword('TableFlow-demo-1'); }}>{d.label}</button>)}</div>
        <p className="mt-2 text-xs text-muted">Click a role to fill the credentials, then Sign in.</p></div>}
      <p className="mt-6 text-center text-sm text-muted">New café? <Link href="/register" className="font-bold text-brandtext">Register your restaurant</Link></p>
    </main>
  );
}
export default function Page() { return <Suspense><Login /></Suspense>; }
