'use client';
import { useState } from 'react';
import { cx } from './ui';

export interface Series { key: string; name: string; color: string }
export interface Bar { label: string; sub?: string; values: Record<string, number> }

/** Stacked/single bar chart. Thin marks with 4px rounded data-ends, 2px surface gap between stacked segments,
 *  recessive grid, hover tooltip, legend for ≥2 series, and a table view so colour is never the only channel. */
export function BarChart({ bars, series, format, axis, height = 220, yLabel }: { bars: Bar[]; series: Series[]; format: (n: number) => string; axis?: (n: number) => string; height?: number; yLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const totals = bars.map((b) => series.reduce((s, x) => s + (b.values[x.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })();
  const W = 640, H = height, L = 8, R = 8, T = 24, B = 26, iw = W - L - R, ih = H - T - B;
  const bw = Math.min(28, (iw / Math.max(1, bars.length)) * 0.55), step = iw / Math.max(1, bars.length);
  const ticks = [0, 0.5, 1].map((f) => f * nice); const ax = axis ?? format;
  const every = Math.ceil(bars.length / 8);

  if (table) return (
    <div><div className="mb-2 flex justify-end"><button className="btn btn-ghost btn-sm" onClick={() => setTable(false)}>Show chart</button></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-muted"><th className="py-2">{yLabel ?? 'Period'}</th>{series.map((s) => <th key={s.key} className="py-2 text-right">{s.name}</th>)}{series.length > 1 && <th className="py-2 text-right">Total</th>}</tr></thead>
        <tbody>{bars.map((b, i) => <tr key={i} className="border-t border-line"><td className="py-2">{b.label}</td>{series.map((s) => <td key={s.key} className="py-2 text-right tabular">{format(b.values[s.key] ?? 0)}</td>)}{series.length > 1 && <td className="py-2 text-right font-semibold tabular">{format(totals[i])}</td>}</tr>)}</tbody></table></div></div>
  );
  const h = hover !== null ? bars[hover] : null;
  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {series.length > 1 ? <ul className="flex flex-wrap gap-4 text-sm" aria-label="Legend">{series.map((s) => <li key={s.key} className="flex items-center gap-2"><span className="h-3 w-3 rounded-[3px]" style={{ background: s.color }} />{s.name}</li>)}</ul> : <span />}
        <button className="btn btn-ghost btn-sm" onClick={() => setTable(true)}>View as table</button></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Bar chart, ${bars.length} periods. Highest ${format(max)}.`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => { const y = T + ih - (t / nice) * ih; return <g key={i}><line x1={L} x2={W - R} y1={y} y2={y} stroke="rgb(var(--grid))" strokeWidth="1" />{i > 0 && <text x={L} y={y - 5} fontSize="11" fill="rgb(var(--muted))" stroke="rgb(var(--surface))" strokeWidth="4" paintOrder="stroke" strokeLinejoin="round">{ax(t)}</text>}</g>; })}
        {bars.map((b, i) => {
          const cx0 = L + step * i + step / 2; let y = T + ih; const segs = series.filter((s) => (b.values[s.key] ?? 0) > 0);
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <rect x={L + step * i} y={T} width={step} height={ih + B} fill="transparent" />{/* generous hit target */}
              {segs.map((s, k) => { const hgt = ((b.values[s.key] ?? 0) / nice) * ih; y -= hgt; const top = k === segs.length - 1;
                return <path key={s.key} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} d={roundTop(cx0 - bw / 2, y, bw, Math.max(0, hgt - (k > 0 ? 2 : 0)) , top ? 4 : 0, k > 0 ? 2 : 0)} />; })}
              {i % every === 0 && <text x={cx0} y={H - 8} fontSize="11" textAnchor="middle" fill="rgb(var(--muted))">{b.label}</text>}
            </g>);
        })}
      </svg>
      {h && hover !== null && (
        <div role="status" className="pointer-events-none absolute top-8 z-10 min-w-[150px] rounded-xl border border-line bg-surface p-3 text-sm shadow-pop" style={{ left: `${Math.min(70, Math.max(0, ((hover + 0.5) / bars.length) * 100 - 12))}%` }}>
          <div className="mb-1 font-bold">{h.sub ?? h.label}</div>
          {series.map((s) => <div key={s.key} className="flex items-center justify-between gap-4"><span className="flex items-center gap-2 text-muted"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span><b className="tabular">{format(h.values[s.key] ?? 0)}</b></div>)}
          {series.length > 1 && <div className="mt-1 flex justify-between border-t border-line pt-1"><span className="text-muted">Total</span><b className="tabular">{format(totals[hover])}</b></div>}
        </div>)}
    </div>
  );
}
// rectangle with rounded top corners (data-end), square baseline
function roundTop(x: number, y: number, w: number, h: number, r: number, gap: number) {
  const yy = y + gap; const rr = Math.min(r, w / 2, h);
  return `M${x},${yy + h} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + w - rr} Q${x + w},${yy} ${x + w},${yy + rr} V${yy + h} Z`;
}

/** Share bar for two payment methods: one horizontal stacked bar, direct labels, 2px gap. */
export function ShareBar({ parts, format }: { parts: { name: string; color: string; value: number; count: number }[]; format: (n: number) => string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="text-sm text-muted">No payments in this period.</p>;
  return (
    <div>
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label={parts.map((p) => `${p.name} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => <div key={p.name} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.name}: ${format(p.value)}`} />)}</div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">{parts.map((p) => <li key={p.name} className="flex items-center gap-3 rounded-xl bg-sunken p-3"><span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: p.color }} />
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{p.name}</span><span className="block text-xs text-muted">{p.count} payments</span></span>
        <span className="text-right"><b className="block tabular">{format(p.value)}</b><span className="text-xs text-muted tabular">{Math.round((p.value / total) * 100)}%</span></span></li>)}</ul>
    </div>
  );
}

export const Stat = ({ label, value, sub, tone, href }: { label: string; value: string; sub?: string; tone?: 'bad' | 'warn'; href?: string }) => {
  const body = <><div className="text-xs font-bold uppercase tracking-wide text-muted">{label}</div><div className={cx('mt-1 whitespace-nowrap font-display text-xl font-extrabold tabular sm:text-2xl lg:text-3xl', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn')}>{value}</div>{sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}</>;
  return href ? <a href={href} className="card block p-4 transition hover:-translate-y-0.5">{body}</a> : <div className="card p-4">{body}</div>;
};
