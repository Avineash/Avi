import { aud } from "@/lib/util";

/** Dependency-free SVG bar chart (single series, gold on ivory, accessible table fallback). */
export function BarChart({ data, valueLabel = (n: number) => String(n), height = 160, title }: { data: Array<{ label: string; value: number }>; valueLabel?: (n: number) => string; height?: number; title: string }) {
  if (!data.length) return <p className="text-sm text-navy-900/60">No data in this period yet.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 600, pad = 24, bw = Math.max(4, (w - pad * 2) / data.length - 4);
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${height + 28}`} role="img" aria-label={title} className="w-full">
        <line x1={pad} x2={w - pad} y1={height} y2={height} stroke="#0b1b33" strokeOpacity=".15" />
        {data.map((d, i) => {
          const h = Math.round((d.value / max) * (height - 18)), x = pad + i * ((w - pad * 2) / data.length) + 2;
          return (
            <g key={d.label}>
              <rect x={x} y={height - h} width={bw} height={h} rx={3} fill="#b89b5e"><title>{`${d.label}: ${valueLabel(d.value)}`}</title></rect>
              {(i === 0 || i === data.length - 1 || data.length <= 8) && <text x={x + bw / 2} y={height + 16} textAnchor="middle" fontSize="10" fill="#0b1b33" fillOpacity=".6">{d.label.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">{title}: {data.map((d) => `${d.label} ${valueLabel(d.value)}`).join(", ")}</figcaption>
    </figure>
  );
}
export const moneyLabel = (n: number) => aud(n, { whole: true });

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "gold" | "danger" }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-navy-900/60">{label}</p>
      <p className={`numeral mt-1 text-[1.65rem] font-medium ${tone === "danger" ? "text-danger" : "text-navy-900"}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-navy-900/60">{hint}</p>}
    </div>
  );
}
export const pct = (n: number) => `${Math.round(n * 100)}%`;
