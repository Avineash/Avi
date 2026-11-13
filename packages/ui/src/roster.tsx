import type { StatusKey } from '@staffhub/theme-core';
import { StatusBadge } from './components.tsx';

export interface RosterPerson { id: string; name: string; department: string }
export interface RosterShift { id: string; employeeId: string; date: string; start: string; end: string; label: string }
export interface RosterLeave { employeeId: string; startDate: string; endDate: string; status: StatusKey | string }

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const LABEL_SLOT: Record<string, number> = { Early: 1, Breakfast: 1, Late: 2, Dinner: 2, Night: 3, Day: 4 };
/** Shift types map to chart tokens, so the roster re-colours with the theme. Labels carry the meaning, colour only groups. */
export const shiftSlot = (label: string) => LABEL_SLOT[label] ?? 5;

/** Weekly roster. Leave replaces the shift cell and shows the same accessible status badge used everywhere else. */
export function RosterGrid({ weekStart, people, shifts, leave, today }: { weekStart: string; people: RosterPerson[]; shifts: RosterShift[]; leave: RosterLeave[]; today?: string }) {
  const start = new Date(`${weekStart}T00:00:00Z`).getTime();
  const days = Array.from({ length: 7 }, (_, i) => iso(start + i * DAY));
  const byPerson = new Map<string, Map<string, RosterShift>>();
  for (const s of shifts) { if (!byPerson.has(s.employeeId)) byPerson.set(s.employeeId, new Map()); byPerson.get(s.employeeId)!.set(s.date, s); }
  const groups = [...new Set(people.map((p) => p.department))];
  const leaveFor = (id: string, date: string) => leave.find((l) => l.employeeId === id && l.startDate <= date && l.endDate >= date);

  return (
    <div className="ds-roster-wrap">
      <table className="ds-roster">
        <thead>
          <tr>
            <th scope="col" className="ds-roster__who">Team member</th>
            {days.map((d) => (
              <th scope="col" key={d} className={d === today ? 'is-today' : undefined}>
                <span>{new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                <span className="ds-roster__date">{Number(d.slice(8))}</span>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g}>
            {groups.length > 1 && <tr className="ds-roster__group"><th colSpan={8} scope="colgroup">{g}</th></tr>}
            {people.filter((p) => p.department === g).map((p) => (
              <tr key={p.id}>
                <th scope="row" className="ds-roster__who">{p.name}</th>
                {days.map((d) => {
                  const lv = leaveFor(p.id, d), sh = byPerson.get(p.id)?.get(d);
                  return (
                    <td key={d} className={d === today ? 'is-today' : undefined}>
                      {lv ? <StatusBadge status={lv.status as StatusKey} compact={false} />
                        : sh ? <span className="ds-shift" style={{ ['--slot' as string]: `var(--ds-chart-${shiftSlot(sh.label)})` }}><strong>{sh.label}</strong><span>{sh.start}–{sh.end}</span></span>
                        : <span className="ds-roster__off" aria-label="Day off">–</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
