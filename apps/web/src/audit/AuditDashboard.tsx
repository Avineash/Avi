import { Button, Card, EmptyState, Icon } from '@staffhub/ui';
import { AuditPill, longDate, shortDate } from './Pill.tsx';
import type { AuditView, OverviewRow, RunSummary } from './types.ts';

export function AuditDashboard({ view, runs, overview, date, canWork, canStart, onStart, onOpen, onPickDate, onTool, showOverview }: {
  view: AuditView | null; runs: RunSummary[]; overview: OverviewRow[]; date: string; canWork: boolean; canStart: boolean;
  onStart: () => void; onOpen: () => void; onPickDate: (d: string) => void; onTool: (t: string) => void; showOverview: boolean;
}) {
  const exists = view?.exists === true;
  const run = exists ? view.run : null;
  const progress = exists ? view.progress : null;
  const kind = !run ? 'not_started' : run.status === 'open' ? 'open' : run.closeNote ? 'incomplete' : 'closed';
  const holder = exists && view.lock.heldBy && !view.lock.heldByMe ? view.lock.heldBy : null;

  return (
    <div className="au-dash">
      <Card className="au-c8 au-hero">
        <div className="au-kick">Audit date</div>
        <h2>{longDate(date)}</h2>
        <p>
          Business date {view ? longDate(view.exists ? view.run.businessDate : view.businessDate) : '…'}.{' '}
          {!run && 'This audit has not been started.'}
          {run?.status === 'open' && (holder ? `${holder} is working on it now.` : 'In progress.')}
          {run?.status === 'closed' && `Closed${run.closedBy ? ` by ${run.closedBy}` : ''}.`}
        </p>
        <div className="ds-row">
          {!run && canWork && canStart && <Button variant="primary" icon="moon" onClick={onStart}>Start night audit</Button>}
          {run && <Button variant="primary" icon="check-circle" onClick={onOpen}>{run.status === 'open' && canWork && !holder ? 'Continue night audit' : 'View checklist'}</Button>}
          {!run && !(canWork && canStart) && <Button variant="primary" onClick={onOpen}>View checklist</Button>}
          <AuditPill kind={kind} />
        </div>
      </Card>

      <Card className="au-c4" title="Progress">
        {progress ? (
          <>
            <div className="au-pc"><b>{progress.percent}%</b><span className="ds-muted">{progress.done} of {progress.total}</span></div>
            <div className="au-bar-track" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Audit progress"><div className="au-bar-fill" style={{ width: `${progress.percent}%` }} /></div>
            {progress.next && <p className="ds-muted">Next: {progress.next.step.text}</p>}
          </>
        ) : <p className="ds-muted">Nothing recorded yet.</p>}
      </Card>

      {showOverview && (
        <Card className="au-c12" title={`All properties · ${shortDate(date)}`} flush>
          <div className="au-scroll">
            <table className="au-tbl">
              <thead><tr><th>Property</th><th>Status</th><th>Progress</th><th>Night auditor</th></tr></thead>
              <tbody>
                {overview.map((o) => (
                  <tr key={o.propertyId}>
                    <td><strong>{o.propertyName}</strong></td>
                    <td><AuditPill kind={o.status} />{o.heldBy && <span className="ds-hint"> · {o.heldBy} editing</span>}</td>
                    <td><div className="ds-row"><div className="au-bar-track" style={{ width: 110 }}><div className="au-bar-fill" style={{ width: `${o.percent}%` }} /></div><span>{o.percent}%</span></div></td>
                    <td>{o.nightAuditor || <span className="ds-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="au-c8" title="Recent audits" flush>
        {runs.length === 0 ? <EmptyState title="No audits yet">Start tonight’s audit to see it here.</EmptyState> : (
          <ul className="ds-list">
            {runs.slice(0, 8).map((r) => (
              <li key={r.id} className="ds-list__row">
                <div className="ds-list__main">
                  <div className="ds-list__title">{shortDate(r.auditDate)}</div>
                  <div className="ds-list__sub">{r.nightAuditor || 'No auditor recorded'} · {r.done}/{r.total} steps{r.closeNote ? ` · “${r.closeNote}”` : ''}</div>
                </div>
                <AuditPill kind={r.status === 'open' ? 'open' : r.closeNote ? 'incomplete' : 'closed'} />
                <Button size="sm" variant="ghost" onClick={() => onPickDate(r.auditDate)}>Open</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="au-c4" title="Tools">
        <div className="ds-stack">
          <Button variant="secondary" icon="roster" onClick={() => onTool('ccrec')}>Card reconciliation</Button>
          <p className="ds-hint"><Icon name="info" size={13} /> Daily operations forecast, company breakfast and VCC listing are not built yet.</p>
        </div>
      </Card>
    </div>
  );
}
