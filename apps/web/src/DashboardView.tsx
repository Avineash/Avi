import { STATUS_KEYS, type StatusKey } from '@staffhub/theme-core';
import { BarChart, Button, Card, Field, Input, KpiTile, MonthCalendar, NotificationItem, Notice, Select, StatusBadge, type CalendarEntry } from '@staffhub/ui';
import { fmtMonthLong, fmtMonthShort, fmtRange } from './format.ts';
import type { Summary } from './types.ts';

export interface DashboardViewProps {
  firstName: string;
  summary: Summary;
  calendarMonth: string;
  calendarEntries: CalendarEntry[];
  today: string;
  notifications: Array<{ id: string; status: StatusKey | null; title: string; body: string; time: string; unread: boolean }>;
  todayShifts: Array<{ id: string; name: string; label: string; start: string; end: string; slot: number }>;
  /** Preview-only: shows buttons in every interaction state, form controls and the status key. */
  styleGuide?: boolean;
}

/** Pure presentation: all data arrives as props, so the live preview feeds it sample data and the real page feeds it API data. */
export function DashboardView({ firstName, summary, calendarMonth, calendarEntries, today, notifications, todayShifts, styleGuide }: DashboardViewProps) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <div>
        <h2 className="page-greeting">{greeting}, {firstName}</h2>
        <p className="ds-muted">Here is what is happening with your team.</p>
      </div>

      <div className="ds-grid ds-grid--kpi">
        <KpiTile icon="clock" label="Awaiting approval" value={summary.byStatus.pending} hint="Leave requests" />
        <KpiTile icon="calendar" label="On leave today" value={summary.onLeaveToday} hint="Approved absences" />
        <KpiTile icon="users" label="Team size" value={summary.headcount} hint="People you can see" />
        <KpiTile icon="bell" label="Unread" value={summary.unreadNotifications} hint="Notifications" />
      </div>

      <div className="ds-grid ds-grid--split">
        <div className="ds-stack">
          <Card title="Leave days by month">
            <BarChart
              title="Working days of leave by month"
              categories={summary.months.map((m) => fmtMonthShort(m.month))}
              series={[
                { label: 'Approved', values: summary.months.map((m) => m.approved), color: 'var(--ds-status-approved-fg)' },
                { label: 'Pending', values: summary.months.map((m) => m.pending), color: 'var(--ds-status-pending-fg)', pattern: 'hatch' },
              ]}
            />
          </Card>
          <Card title={`Leave calendar · ${fmtMonthLong(calendarMonth)}`}>
            <MonthCalendar month={calendarMonth} entries={calendarEntries} today={today} />
          </Card>
        </div>

        <div className="ds-stack">
          <Card title="Leave by status">
            <ul className="ds-list status-summary">
              {STATUS_KEYS.map((s) => (
                <li key={s} className="ds-list__row"><StatusBadge status={s} /><span className="ds-spacer" /><strong>{summary.byStatus[s]}</strong></li>
              ))}
            </ul>
          </Card>
          <Card title="Notifications" flush>
            <ul className="ds-notes">
              {notifications.slice(0, 4).map((n) => <NotificationItem key={n.id} status={n.status} title={n.title} body={n.body} time={n.time} unread={n.unread} />)}
              {!notifications.length && <li className="ds-empty"><strong>All caught up</strong></li>}
            </ul>
          </Card>
          <Card title="On shift today" flush>
            <ul className="ds-list">
              {todayShifts.map((s) => (
                <li key={s.id} className="ds-list__row">
                  <span className="ds-shift" style={{ ['--slot' as string]: `var(--ds-chart-${s.slot})` }}><strong>{s.label}</strong><span>{s.start}–{s.end}</span></span>
                  <span className="ds-list__main"><span className="ds-list__title">{s.name}</span></span>
                </li>
              ))}
              {!todayShifts.length && <li className="ds-empty"><strong>No shifts today</strong></li>}
            </ul>
          </Card>
          {summary.upcoming.length > 0 && (
            <Card title="Upcoming leave" flush>
              <ul className="ds-list">
                {summary.upcoming.slice(0, 3).map((u) => (
                  <li key={u.id} className="ds-list__row">
                    <div className="ds-list__main"><div className="ds-list__title">{u.employeeName}</div><div className="ds-list__sub">{u.type} · {fmtRange(u.startDate, u.endDate)}</div></div>
                    <StatusBadge status={u.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {styleGuide && (
        <div className="ds-grid ds-grid--split-even">
          <Card title="Buttons & interaction states">
            <div className="state-grid">
              {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
                <div className="state-row" key={v}>
                  <span className="ds-muted state-row__label">{v}</span>
                  <Button variant={v} size="sm">Default</Button>
                  <Button variant={v} size="sm" forceState="hover">Hover</Button>
                  <Button variant={v} size="sm" forceState="active">Pressed</Button>
                  <Button variant={v} size="sm" forceState="focus">Focus</Button>
                  <Button variant={v} size="sm" disabled>Disabled</Button>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Forms & feedback">
            <div className="ds-stack">
              <Field label="Leave type" htmlFor="pv-type"><Select id="pv-type" defaultValue="Annual leave"><option>Annual leave</option></Select></Field>
              <Field label="Note" hint="Visible to your manager" htmlFor="pv-note"><Input id="pv-note" placeholder="Optional" /></Field>
              <Notice tone="approved" title="Leave approved">Your request for 3 days was approved.</Notice>
              <Notice tone="pending" title="Awaiting approval">Your manager has been notified.</Notice>
              <Notice tone="rejected" title="Request rejected">Please choose different dates.</Notice>
              <Notice tone="info" title="Heads up">Rosters publish on Fridays.</Notice>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
