import type { CalendarEntry } from '@staffhub/ui';
import type { DashboardViewProps } from '../DashboardView.tsx';

/** Fictional sample data so previews look realistic and never expose real employee information. */
export function samplePreview(now = new Date()): Omit<DashboardViewProps, 'styleGuide'> {
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const d = (n: number) => `${month}-${String(n).padStart(2, '0')}`;
  const e = (id: string, name: string, a: number, b: number, status: CalendarEntry['status']): CalendarEntry => ({ id, name, start: d(a), end: d(b), status });
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  const vals = [[8, 3], [12, 5], [6, 7], [14, 2], [5, 0], [9, 4]];
  return {
    firstName: 'Alex',
    today,
    summary: {
      byStatus: { approved: 24, pending: 7, rejected: 3, cancelled: 4 },
      months: months.map((m, i) => ({ month: m, approved: vals[i]![0]!, pending: vals[i]![1]! })),
      upcoming: [
        { id: 'u1', employeeName: 'Maya Tanaka', type: 'Annual leave', startDate: d(9), endDate: d(11), status: 'pending', days: 3 },
        { id: 'u2', employeeName: 'Noah Okafor', type: 'Time off in lieu', startDate: d(17), endDate: d(18), status: 'approved', days: 2 },
      ],
      onLeaveToday: 3, headcount: 42, unreadNotifications: 2,
    },
    calendarMonth: month,
    calendarEntries: [
      e('c1', 'Noah Okafor', 4, 6, 'approved'), e('c2', 'Maya Tanaka', 9, 11, 'pending'), e('c3', 'Liam Moreau', 13, 13, 'rejected'),
      e('c4', 'Sofia Silva', 17, 19, 'approved'), e('c5', 'Omar Haddad', 20, 21, 'cancelled'), e('c6', 'Priya Kaur', 24, 26, 'pending'), e('c7', 'Hugo Dubois', 11, 12, 'approved'),
    ],
    notifications: [
      { id: 'n1', status: 'approved', title: 'Leave approved', body: 'Your annual leave request was approved by Sam Rivera.', time: '12 min ago', unread: true },
      { id: 'n2', status: 'pending', title: 'Leave request awaiting approval', body: 'Maya Tanaka requested 3 working days.', time: '2 h ago', unread: true },
      { id: 'n3', status: 'rejected', title: 'Leave rejected', body: 'Your request overlapped a blackout period.', time: '1 d ago', unread: false },
      { id: 'n4', status: null, title: 'Rosters published', body: 'Next week’s roster is ready.', time: '2 d ago', unread: false },
    ],
    todayShifts: [
      { id: 's1', name: 'Noah Okafor', label: 'Early', start: '06:00', end: '14:00', slot: 1 },
      { id: 's2', name: 'Sofia Silva', label: 'Late', start: '14:00', end: '22:00', slot: 2 },
      { id: 's3', name: 'Hugo Dubois', label: 'Night', start: '22:00', end: '06:00', slot: 3 },
    ],
  };
}
