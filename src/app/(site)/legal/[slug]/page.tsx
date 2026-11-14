import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CANCELLATION_TEXT, MARKET_PAGES, PAGES } from "@/lib/legal-pages";
import { isFull } from "@/lib/phase";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: (isFull() ? PAGES : MARKET_PAGES)[slug]?.title ?? "Legal" };
}

export default async function Legal({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = (isFull() ? PAGES : MARKET_PAGES)[slug];
  if (!p) notFound();
  return (
    <div className="container-page max-w-3xl py-12">
      <p className="eyebrow">Legal</p><h1 className="mt-1 text-4xl font-semibold">{p.title}</h1>
      <p role="note" className="mt-4 rounded-xl border border-gold-500/40 bg-gold-300/20 p-4 text-sm"><strong>Draft for legal review.</strong> This text describes how the platform behaves and is not legal advice. It must be reviewed and adopted by a qualified Australian lawyer before launch.</p>
      <div className="mt-6 space-y-6">{p.sections.map((s) => <section key={s.h}><h2 className="text-xl font-semibold">{s.h}</h2>{s.p.map((t, i) => <p key={i} className="mt-2 text-navy-900/80">{t}</p>)}</section>)}</div>
      {slug === "cancellation" && isFull() && <table className="mt-8 w-full text-sm"><thead><tr className="text-left"><th className="py-2">Policy</th><th>Terms</th></tr></thead><tbody>{CANCELLATION_TEXT.map(([a, b]) => <tr key={a} className="border-t border-navy-900/10"><td className="py-2 pr-4 font-medium">{a}</td><td className="py-2">{b}</td></tr>)}</tbody></table>}
    </div>
  );
}
