import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { STATUS_KEYS, type StatusKey } from '@staffhub/theme-core';
import { Avatar, Button, Card, EmptyState, Field, Input, Modal, MonthCalendar, Notice, Select, StatusBadge, Tabs, Textarea } from '@staffhub/ui';
import { api, ApiError } from '../api.ts';
import { addMonths, fmtMonthLong, fmtRange, isoToday } from '../format.ts';
import type { Leave } from '../types.ts';

const TYPES = ['Annual leave', 'Sick leave', 'Unpaid leave', 'Parental leave', 'Time off in lieu'];

export function LeavePage() {
  const [rows, setRows] = useState<Leave[] | null>(null);
  const [filter, setFilter] = useState<StatusKey | 'all'>('all');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [month, setMonth] = useState(isoToday().slice(0, 7));
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => api.get<{ leave: Leave[] }>('/api/leave').then((r) => setRows(r.leave)), []);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: 'approved' | 'rejected' | 'cancel') {
    setErr('');
    try { await (action === 'cancel' ? api.post(`/api/leave/${id}/cancel`) : api.post(`/api/leave/${id}/decision`, { decision: action })); await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Action failed.'); }
  }

  const shown = (rows ?? []).filter((r) => filter === 'all' || r.status === filter);
  const counts = Object.fromEntries(STATUS_KEYS.map((s) => [s, (rows ?? []).filter((r) => r.status === s).length])) as Record<StatusKey, number>;

  return (
    <>
      <div className="ds-row">
        <Tabs label="Filter by status" value={filter} onChange={setFilter}
          tabs={[{ id: 'all', label: 'All' }, ...STATUS_KEYS.map((s) => ({ id: s, label: `${s[0]!.toUpperCase()}${s.slice(1)} (${counts[s]})` }))]} />
        <span className="ds-spacer" />
        <Tabs label="View" value={view} onChange={setView} tabs={[{ id: 'list', label: 'List', icon: 'menu' }, { id: 'calendar', label: 'Calendar', icon: 'calendar' }]} />
        <Button icon="plus" onClick={() => setOpen(true)}>Request leave</Button>
      </div>
      {err && <Notice tone="rejected" title={err} />}

      {rows === null ? <p className="ds-muted" role="status">Loading…</p> : view === 'list' ? (
        <Card flush>
          {shown.length === 0 ? <EmptyState title="No leave requests">Nothing matches this filter.</EmptyState> : (
            <ul className="ds-list">
              {shown.map((r) => (
                <li key={r.id} className="ds-list__row">
                  <Avatar name={r.employeeName} />
                  <div className="ds-list__main">
                    <div className="ds-list__title">{r.employeeName}</div>
                    <div className="ds-list__sub">{r.type} · {fmtRange(r.startDate, r.endDate)} · {r.days} working day{r.days === 1 ? '' : 's'}</div>
                    {r.decidedBy && r.status !== 'pending' && <div className="ds-list__sub">Decided by {r.decidedBy}</div>}
                  </div>
                  <StatusBadge status={r.status} />
                  <div className="ds-row">
                    {r.canDecide && <>
                      <Button size="sm" icon="check" onClick={() => act(r.id, 'approved')}>Approve</Button>
                      <Button size="sm" variant="danger" icon="x" onClick={() => act(r.id, 'rejected')}>Reject</Button>
                    </>}
                    {r.canCancel && <Button size="sm" variant="ghost" onClick={() => act(r.id, 'cancel')}>Cancel</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card title={fmtMonthLong(month)} actions={<div className="ds-row">
          <Button size="sm" variant="secondary" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹</Button>
          <Button size="sm" variant="secondary" onClick={() => setMonth(isoToday().slice(0, 7))}>Today</Button>
          <Button size="sm" variant="secondary" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">›</Button>
        </div>}>
          <MonthCalendar month={month} today={isoToday()} entries={shown.map((r) => ({ id: r.id, name: r.employeeName, start: r.startDate, end: r.endDate, status: r.status }))} />
          <ul className="ds-legend legend-row">{STATUS_KEYS.map((s) => <li key={s}><StatusBadge status={s} /></li>)}</ul>
        </Card>
      )}
      <RequestModal open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); void load(); }} />
    </>
  );
}

function RequestModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState(TYPES[0]!);
  const [start, setStart] = useState(isoToday());
  const [end, setEnd] = useState(isoToday());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.post('/api/leave', { type, startDate: start, endDate: end, reason }); setReason(''); onDone(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not submit.'); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Request leave"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="leave-form" disabled={busy}>Submit request</Button></>}>
      <form id="leave-form" className="ds-stack" onSubmit={submit}>
        {error && <Notice tone="rejected" title={error} />}
        <Field label="Leave type" htmlFor="lt"><Select id="lt" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <div className="ds-form-grid">
          <Field label="First day" htmlFor="ls"><Input id="ls" type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} required /></Field>
          <Field label="Last day" htmlFor="le"><Input id="le" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required /></Field>
        </div>
        <Field label="Note for your manager" hint="Optional" htmlFor="lr"><Textarea id="lr" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
