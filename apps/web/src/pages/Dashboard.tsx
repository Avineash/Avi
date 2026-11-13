import { useEffect, useState } from 'react';
import { shiftSlot, type CalendarEntry } from '@staffhub/ui';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { DashboardView } from '../DashboardView.tsx';
import { isoToday, timeAgo } from '../format.ts';
import type { Leave, Notification, RosterData, Summary } from '../types.ts';

export function Dashboard() {
  const { me } = useAuth();
  const [data, setData] = useState<{ summary: Summary; leave: Leave[]; notes: Notification[]; roster: RosterData } | null>(null);
  const today = isoToday(), month = today.slice(0, 7);

  useEffect(() => {
    Promise.all([
      api.get<Summary>('/api/dashboard'),
      api.get<{ leave: Leave[] }>(`/api/leave?from=${month}-01&to=${month}-31`),
      api.get<{ notifications: Notification[] }>('/api/notifications'),
      api.get<RosterData>('/api/roster'),
    ]).then(([summary, l, n, roster]) => setData({ summary, leave: l.leave, notes: n.notifications, roster }));
  }, [month]);

  if (!data || !me) return <p className="ds-muted" role="status">Loading…</p>;
  const names = new Map(data.roster.people.map((p) => [p.id, p.name]));
  const entries: CalendarEntry[] = data.leave.map((l) => ({ id: l.id, name: l.employeeName, start: l.startDate, end: l.endDate, status: l.status }));
  return (
    <DashboardView
      firstName={me.user.name.split(' ')[0]!}
      summary={data.summary}
      calendarMonth={month}
      calendarEntries={entries}
      today={today}
      notifications={data.notes.map((n) => ({ id: n.id, status: n.status, title: n.title, body: n.body, time: timeAgo(n.createdAt), unread: !n.read }))}
      todayShifts={data.roster.shifts.filter((s) => s.date === today).slice(0, 5).map((s) => ({ id: s.id, name: names.get(s.employeeId) ?? '', label: s.label, start: s.start, end: s.end, slot: shiftSlot(s.label) }))}
    />
  );
}
