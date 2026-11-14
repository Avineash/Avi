import Link from 'next/link';

const Card = ({ href, title, sub, emoji }: { href: string; title: string; sub: string; emoji: string }) => (
  <Link href={href} className="card group flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-pop">
    <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand/10 text-2xl">{emoji}</span>
    <span className="flex-1"><span className="block font-bold">{title}</span><span className="block text-sm text-muted">{sub}</span></span>
    <span className="text-muted transition group-hover:translate-x-1" aria-hidden>→</span>
  </Link>
);

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-5 pb-16 pt-14">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-brandtext"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-onbrand">T</span> TableFlow</div>
      <h1 className="font-display text-4xl font-extrabold leading-tight sm:text-5xl">Scan. Order. Pay. Enjoy.</h1>
      <p className="mt-4 max-w-xl text-lg text-muted">QR table ordering and LankaQR payments for Sri Lankan cafés — no app to install, in Sinhala, Tamil and English.</p>
      <div role="note" className="mt-6 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn"><b>Prototype — sandbox payments only.</b> Every payment in this build is simulated. No real money moves and nothing here is a live bank or gateway transaction.</div>

      <h2 className="mb-3 mt-10 text-sm font-bold uppercase tracking-wide text-muted">Try it as a customer</h2>
      <div className="grid gap-3"><Card href="/t/demo-table-1" emoji="📱" title="Scan table T1 (demo)" sub="Ceylon Brew House · order, pay with sandbox LankaQR or card, track" /></div>

      <h2 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-muted">Run the restaurant</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card href="/login?as=owner" emoji="🧾" title="Café dashboard" sub="Orders, menu, tables, payments" />
        <Card href="/login?as=kitchen" emoji="🔔" title="Kitchen display" sub="Live tickets with sound" />
        <Card href="/login?as=admin" emoji="🛰️" title="Platform admin" sub="Approvals, providers, revenue" />
        <Card href="/register" emoji="🏪" title="Register a restaurant" sub="Apply to join TableFlow" />
      </div>
    </main>
  );
}
