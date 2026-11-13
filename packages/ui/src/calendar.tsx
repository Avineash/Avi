import type { StatusKey } from '@staffhub/theme-core';
import { StatusBadge } from './components.tsx';

export interface CalendarEntry { id: string; name: string; start: string; end: string; status: StatusKey }

const DAY = 86_400_000;
const utc = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const short = (n: string) => { const [f, ...r] = n.split(' '); return r.length ? `${f} ${r[r.length - 1]![0]}.` : f; };

/** Month grid of leave. Each entry shows its status icon + label (visually compact), never colour alone. */
export function MonthCalendar({ month, entries, today, maxPerDay = 3 }: { month: string; entries: CalendarEntry[]; today?: string; maxPerDay?: number }) {
  const first = utc(`${month}-01`);
  const start = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY;
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const weeks = Math.ceil((((new Date(first).getUTCDay() + 6) % 7) + daysInMonth) / 7);
  const order: Record<StatusKey, number> = { pending: 0, approved: 1, rejected: 2, cancelled: 3 };
  const shown = entries;

  return (
    <div className="ds-cal" role="grid" aria-label={new Date(first).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}>
      <div className="ds-cal__head" role="row">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} role="columnheader">{d}</div>)}</div>
      {Array.from({ length: weeks }, (_, w) => (
        <div className="ds-cal__week" role="row" key={w}>
          {Array.from({ length: 7 }, (_, d) => {
            const t = start + (w * 7 + d) * DAY, date = iso(t), inMonth = date.startsWith(month);
            const here = shown.filter((e) => e.start <= date && e.end >= date).sort((a, b) => order[a.status] - order[b.status]);
            return (
              <div key={d} role="gridcell" className={`ds-cal__day${inMonth ? '' : ' is-out'}${date === today ? ' is-today' : ''}${d > 4 ? ' is-weekend' : ''}`}>
                <span className="ds-cal__num">{Number(date.slice(8))}</span>
                {inMonth && here.slice(0, maxPerDay).map((e) => (
                  <span key={e.id} className="ds-cal__chip" data-status={e.status} title={`${e.name} — ${e.status}`}>
                    <StatusBadge status={e.status} compact /><span className="ds-cal__name">{short(e.name)}</span>
                  </span>
                ))}
                {inMonth && here.length > maxPerDay && <span className="ds-cal__more">+{here.length - maxPerDay} more</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
