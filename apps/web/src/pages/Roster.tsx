import { useEffect, useState } from 'react';
import { Button, Card, RosterGrid, shiftSlot } from '@staffhub/ui';
import { api } from '../api.ts';
import { addDays, fmtRange, isoToday } from '../format.ts';
import type { RosterData } from '../types.ts';

function mondayOf(s: string) { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }

export function RosterPage() {
  const [week, setWeek] = useState(mondayOf(isoToday()));
  const [data, setData] = useState<RosterData | null>(null);
  useEffect(() => { setData(null); api.get<RosterData>(`/api/roster?weekStart=${week}`).then(setData); }, [week]);
  const labels = data ? [...new Set(data.shifts.map((s) => s.label))] : [];
  return (
    <Card title={data ? `Week of ${fmtRange(data.weekStart, data.weekEnd)}` : 'Roster'}
      actions={<div className="ds-row">
        <span className="ds-muted">{data ? `${Math.round(data.totalHours)} scheduled hours` : ''}</span>
        <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">‹</Button>
        <Button size="sm" variant="secondary" onClick={() => setWeek(mondayOf(isoToday()))}>This week</Button>
        <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">›</Button>
      </div>}>
      {!data ? <p className="ds-muted" role="status">Loading…</p> : (
        <div className="ds-stack">
          <RosterGrid weekStart={data.weekStart} people={data.people} shifts={data.shifts} leave={data.leave} today={isoToday()} />
          <ul className="ds-legend legend-row">
            {labels.map((l) => <li key={l}><span className="ds-shift" style={{ ['--slot' as string]: `var(--ds-chart-${shiftSlot(l)})` }}><strong>{l}</strong></span></li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}
