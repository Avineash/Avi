import { useEffect, useMemo, useRef, useState } from 'react';
import { isPhase, simplifiedSteps, type AuditStep, type StepState } from '@staffhub/audit-core';
import { Button, Icon, Input, Modal, Notice, Textarea } from '@staffhub/ui';
import { api } from '../api.ts';
import { AuditPill, clock, longDate } from './Pill.tsx';
import type { AuditApi } from './useAudit.ts';
import type { RunView } from './types.ts';

const BLANK: StepState = { done: false, initials: '', note: '', subs: [] };

function StepRow({ step, state, next, canWrite, files, a, view, onTool }: {
  step: AuditStep; state: StepState; next: boolean; canWrite: boolean; files: AuditApi['files']; a: AuditApi; view: RunView; onTool: (t: string) => void;
}) {
  const [showNote, setShowNote] = useState(!!state.note);
  const [note, setNote] = useState(state.note);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setNote(state.note); }, [state.note]);
  const link = step.tool ? view.template.links?.[step.tool] : undefined;
  const mine = files.filter((f) => f.stepId === step.id);

  const edit = (v: string) => { setNote(v); clearTimeout(timer.current); timer.current = setTimeout(() => void a.setStep(step.id, { note: v }), 700); };
  return (
    <div id={`step-${step.id}`} className={`au-step${state.done ? ' is-done' : ''}${next ? ' is-next' : ''}`}>
      <div className="au-row">
        <input type="checkbox" className="au-ck" checked={state.done} disabled={!canWrite} aria-label={`Mark done: ${step.text}`}
          onChange={(e) => void a.setStep(step.id, { done: e.target.checked, ...(e.target.checked && step.subs ? { subs: step.subs.map((_, i) => i) } : {}) })} />
        <div className="au-stitle">{step.text}{next && <span className="ds-sr-only"> (next step)</span>}</div>
        {step.due && <span className="au-tag au-tag--due"><Icon name="clock" size={12} /> {step.due}</span>}
        {state.done ? (
          <>
            <input className="ds-input au-ini" value={state.initials} maxLength={4} disabled={!canWrite} aria-label="Initials"
              onChange={(e) => void a.setStep(step.id, { initials: e.target.value.replace(/[^A-Za-z]/g, '') })} />
            <span className="au-stamp"><Icon name="check" size={13} />Done {clock(state.doneAt)}</span>
          </>
        ) : null}
      </div>
      {step.subs && (
        <div className="au-subs">
          {step.subs.map((s, i) => {
            const on = state.subs.includes(i);
            return (
              <label key={i} className={on ? 'is-on' : ''}>
                <input type="checkbox" className="au-ck sm" checked={on} disabled={!canWrite}
                  onChange={(e) => void a.setStep(step.id, { subs: e.target.checked ? [...state.subs, i] : state.subs.filter((x) => x !== i) })} />
                <span>{s}</span>
              </label>
            );
          })}
        </div>
      )}
      {step.warn && !state.done && <div className="au-warn"><Notice tone="rejected" icon="alert">{step.warn}</Notice></div>}
      {(step.tool || step.key || mine.length > 0 || showNote || canWrite) && (
        <div className="au-acts">
          {step.tool === 'ccrec' && <Button size="sm" variant="secondary" icon="roster" onClick={() => onTool('ccrec')}>Open card reconciliation</Button>}
          {link && <a className="ds-btn ds-btn--secondary ds-btn--sm" href={link.url} target="_blank" rel="noopener noreferrer"><Icon name="link" size={15} />{link.label}</a>}
          {canWrite && step.key && (
            <>
              <input ref={fileInput} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void a.upload(step.id, f); e.target.value = ''; }} />
              <Button size="sm" variant="secondary" icon="upload" onClick={() => fileInput.current?.click()}>Attach report</Button>
            </>
          )}
          <Button size="sm" variant="ghost" aria-expanded={showNote} onClick={() => setShowNote(!showNote)}>{state.note ? 'Note ●' : 'Add note'}</Button>
        </div>
      )}
      {mine.length > 0 && (
        <div className="au-files au-acts">
          {mine.map((f) => (
            <span key={f.id} className="au-file">
              <a href={`/api/audit/files/${f.id}`} download>{f.name}</a>
              <span className="ds-hint">{Math.max(1, Math.round(f.size / 1024))} KB</span>
              {canWrite && <button type="button" aria-label={`Remove ${f.name}`} onClick={() => void a.removeFile(f.id)}>×</button>}
            </span>
          ))}
        </div>
      )}
      {showNote && <div className="au-note"><Textarea value={note} maxLength={1000} disabled={!canWrite} placeholder="Notes for this step" aria-label={`Note for ${step.text}`} onChange={(e) => edit(e.target.value)} /></div>}
    </div>
  );
}

export function Checklist({ a, view, canWrite, onTool }: { a: AuditApi; view: RunView; canWrite: boolean; onTool: (t: string) => void }) {
  const { template, states, progress } = view;
  const [simple, setSimple] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [folders, setFolders] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('');
  const [closeErr, setCloseErr] = useState('');
  const [names, setNames] = useState({ a: view.run.nightAuditor, m: view.run.nightManager });
  useEffect(() => setNames({ a: view.run.nightAuditor, m: view.run.nightManager }), [view.run.nightAuditor, view.run.nightManager]);

  const keyIds = useMemo(() => new Set(simplifiedSteps(template).map((s) => s.step.id)), [template]);
  const nextId = progress.next?.step.id;
  const jump = (id: string, phaseId: string) => { setOpen((o) => ({ ...o, [phaseId]: true })); setTimeout(() => document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); };
  const incomplete = progress.total - progress.done;

  async function showSummary() { setSummary((await api.get<{ text: string }>(`/api/audit/run/${view.run.id}/summary`)).text); }
  async function confirmClose() {
    setCloseErr('');
    const r = await a.close(incomplete ? { acknowledgeIncomplete: true, reason } : {});
    if (r.ok) setClosing(false); else setCloseErr(r.error);
  }

  return (
    <div className="au-layout">
      <aside className="au-side">
        <div>
          <div className="au-kick">Audit date</div>
          <h2 className="au-date">{longDate(view.run.auditDate)}</h2>
          <div className="ds-muted">Business date {longDate(view.run.businessDate)}</div>
        </div>
        <div>
          <div className="au-pc"><b>{progress.percent}%</b><span className="ds-muted">{progress.done} of {progress.total} steps</span></div>
          <div className="au-track" role="group" aria-label="Steps in order">
            {template.phases.map((p) => isPhase(p)
              ? (
                <button key={p.id} type="button" className="au-tg" aria-label={`${p.name}: ${progress.phases.find((x) => x.id === p.id)?.done} of ${p.steps.length} done. Go to this phase`}
                  onClick={() => jump((p.steps.find((s) => !states[s.id]?.done) ?? p.steps[0]!).id, p.id)}>
                  {p.steps.map((s) => <span key={s.id} aria-hidden="true" className={`au-cell${states[s.id]?.done ? ' is-done' : ''}${s.id === nextId ? ' is-next' : ''}`} />)}
                </button>
              )
              : <span key={p.id} className="au-roll-mark" title="System roll" aria-hidden="true" />)}
          </div>
        </div>
        {progress.next
          ? <button type="button" className="au-next" onClick={() => jump(progress.next!.step.id, progress.next!.phaseId)}><span className="au-kick">Next step · {progress.next.phaseName}</span><b>{progress.next.step.text}</b></button>
          : <Notice tone="approved" title="Every step is done">{view.run.status === 'open' ? 'Review the summary, then close the audit.' : 'This audit is closed.'}</Notice>}
        <div className="au-sign">
          <label className="ds-field"><span className="ds-label">Night auditor</span>
            <Input value={names.a} disabled={!canWrite} maxLength={80} onChange={(e) => setNames({ ...names, a: e.target.value })} onBlur={() => names.a !== view.run.nightAuditor && void a.setMeta({ nightAuditor: names.a })} /></label>
          <label className="ds-field"><span className="ds-label">Night manager</span>
            <Input value={names.m} disabled={!canWrite} maxLength={80} onChange={(e) => setNames({ ...names, m: e.target.value })} onBlur={() => names.m !== view.run.nightManager && void a.setMeta({ nightManager: names.m })} /></label>
        </div>
        <div className="au-actions">
          <Button className="wide" icon="menu" onClick={() => void showSummary()}>Shift summary</Button>
          {template.folders && <Button variant="secondary" icon="layers" onClick={() => setFolders(true)}>Folders</Button>}
          {canWrite && <Button variant="secondary" icon="check-circle" onClick={() => { setClosing(true); setCloseErr(''); }}>Close audit</Button>}
          {view.canReopen && <Button variant="secondary" icon="reset" onClick={() => void a.reopen()}>Reopen</Button>}
        </div>
      </aside>

      <div className="au-phases">
        <div className="ds-row">
          <div className="au-mode" role="group" aria-label="Checklist view">
            <button type="button" aria-pressed={!simple} onClick={() => setSimple(false)}>Detailed</button>
            <button type="button" aria-pressed={simple} onClick={() => setSimple(true)}>Simplified</button>
          </div>
          <span className="ds-muted">{simple ? 'Main tasks only' : 'Every step'}</span>
          <span className="ds-spacer" />
          {view.rolled && <span className="au-stamp"><Icon name="check" size={13} />System rolled</span>}
        </div>
        {template.phases.map((p, idx) => {
          if (!isPhase(p)) return <div key={p.id} className="au-roll" role="separator" aria-label="System roll"><span>{p.label ?? 'System roll'}{view.rolled ? ' · done' : ''}</span></div>;
          const steps = simple ? p.steps.filter((s) => keyIds.has(s.id)) : p.steps;
          if (!steps.length) return null;
          const pp = progress.phases.find((x) => x.id === p.id)!;
          const active = progress.next?.phaseId === p.id;
          const num = template.phases.slice(0, idx).filter(isPhase).length + 1;
          return (
            <details key={p.id} className={`au-phase${active ? ' is-active' : ''}${pp.complete ? ' is-complete' : ''}`} open={open[p.id] ?? active}
              onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== (open[p.id] ?? active)) setOpen((x) => ({ ...x, [p.id]: o })); }}>
              <summary>
                <span className="au-idx">{pp.complete ? <Icon name="check" size={20} /> : num}</span>
                <span className="au-pname">{p.name}</span>
                <span className="au-tag">{p.when === 'pre' ? 'Before roll' : 'After roll'}</span>
                <span className="au-pmeta">{pp.done}/{pp.total}<i className="au-chev" /></span>
              </summary>
              {steps.map((s) => <StepRow key={s.id} step={s} state={states[s.id] ?? BLANK} next={s.id === nextId} canWrite={canWrite} files={a.files} a={a} view={view} onTool={onTool} />)}
            </details>
          );
        })}
      </div>

      <Modal open={summary !== null} onClose={() => setSummary(null)} title="Shift summary" wide
        footer={<><Button variant="secondary" icon="link" onClick={() => summary && void navigator.clipboard?.writeText(summary)}>Copy</Button><Button onClick={() => setSummary(null)}>Close</Button></>}>
        <pre className="au-pre" tabIndex={0}>{summary}</pre>
      </Modal>
      <Modal open={folders} onClose={() => setFolders(false)} title="Where saved reports go" footer={<Button onClick={() => setFolders(false)}>Close</Button>}>
        <p className="ds-muted">A reference list of the report names this property saves. Files attached to steps are kept for 7 days.</p>
        {Object.entries(template.folders ?? {}).map(([k, names2]) => <section key={k}><h3 style={{ fontSize: '1em' }}>{k}</h3><ul>{names2.map((n) => <li key={n}>{n}</li>)}</ul></section>)}
      </Modal>
      <Modal open={closing} onClose={() => setClosing(false)} title="Close this audit?"
        footer={<><Button variant="ghost" onClick={() => setClosing(false)}>Keep working</Button><Button icon="check-circle" disabled={incomplete > 0 && reason.trim().length < 3} onClick={() => void confirmClose()}>{incomplete ? 'Close with gaps' : 'Close audit'}</Button></>}>
        {incomplete === 0
          ? <p>All {progress.total} steps are done. Closing locks the audit as a record. Only an administrator can reopen it.</p>
          : <>
              <Notice tone="pending" title={`${incomplete} step${incomplete === 1 ? ' is' : 's are'} not done`}>You can still close, but the gaps and your reason stay on the record.</Notice>
              <label className="ds-field"><span className="ds-label">Reason</span><Textarea value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Why were these steps not completed?" /></label>
            </>}
        {closeErr && <Notice tone="rejected" title={closeErr} />}
      </Modal>
    </div>
  );
}
export { AuditPill };
