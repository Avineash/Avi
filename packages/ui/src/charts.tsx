import { useId } from 'react';

export interface BarSeries { label: string; values: number[]; /** CSS colour, normally a --ds-* token. */ color: string; pattern?: 'solid' | 'hatch' }

/**
 * Stacked bar chart drawn with SVG. Colours come from tokens; series are also told apart by pattern, every bar
 * total is printed, and a hidden data table mirrors the numbers for assistive technology.
 */
export function BarChart({ title, categories, series, unit = 'days' }: { title: string; categories: string[]; series: BarSeries[]; unit?: string }) {
  const uid = useId().replace(/:/g, '');
  const W = 560, H = 210, L = 30, B = 26, T = 18, R = 8;
  const totals = categories.map((_, i) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0));
  const rawMax = Math.max(1, ...totals);
  const step = rawMax <= 5 ? 1 : rawMax <= 12 ? 2 : rawMax <= 30 ? 5 : 10;
  const max = Math.ceil(rawMax / step) * step;
  const plotH = H - T - B, plotW = W - L - R, bw = Math.min(46, (plotW / categories.length) * 0.56);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);

  return (
    <figure className="ds-chart">
      <figcaption className="ds-sr-only">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${categories.map((c, i) => `${c}: ${totals[i]} ${unit}`).join('; ')}.`}>
        <defs>
          {series.map((s, i) => (
            <pattern key={i} id={`${uid}-h${i}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--ds-surface)" />
              <rect width="3" height="6" fill={s.color} />
            </pattern>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--ds-border)" strokeWidth="1" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ds-text-muted)">{t}</text>
          </g>
        ))}
        {categories.map((c, i) => {
          const cx = L + (plotW / categories.length) * (i + 0.5);
          let acc = 0;
          return (
            <g key={c}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                if (!v) return null;
                const y0 = y(acc + v), h = y(acc) - y0;
                acc += v;
                return <rect key={si} x={cx - bw / 2} y={y0} width={bw} height={Math.max(h, 0)} rx="3"
                  fill={s.pattern === 'hatch' ? `url(#${uid}-h${si})` : s.color} stroke={s.color} strokeWidth={s.pattern === 'hatch' ? 1.5 : 0} />;
              })}
              {totals[i]! > 0 && <text x={cx} y={y(totals[i]!) - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ds-text)">{totals[i]}</text>}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ds-text-muted)">{c}</text>
            </g>
          );
        })}
      </svg>
      <ul className="ds-legend">
        {series.map((s, i) => (
          <li key={i}>
            <svg width="16" height="12" aria-hidden="true">
              <rect width="16" height="12" rx="2" fill={s.pattern === 'hatch' ? `url(#${uid}-h${i})` : s.color} stroke={s.color} strokeWidth="1.5" />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <table className="ds-sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Period</th>{series.map((s) => <th key={s.label}>{s.label}</th>)}</tr></thead>
        <tbody>{categories.map((c, i) => <tr key={c}><th>{c}</th>{series.map((s) => <td key={s.label}>{s.values[i] ?? 0}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  );
}
