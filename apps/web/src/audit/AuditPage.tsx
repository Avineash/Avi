import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { defaultAuditDate } from '@staffhub/audit-core';
import { Button, Field, Icon, Input, Notice, Select, Tabs, type IconName } from '@staffhub/ui';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { AuditDashboard } from './AuditDashboard.tsx';
import { AuditSettings } from './AuditSettings.tsx';
import { CcRecTool } from './CcRecTool.tsx';
import { Checklist } from './Checklist.tsx';
import type { OverviewRow, RunSummary } from './types.ts';
import { useAudit } from './useAudit.ts';
import './audit.css';

type Tab = 'home' | 'checklist' | 'ccrec' | 'settings';
const MODE_KEY = 'sh:audit-mode';

export function AuditPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [props, setProps] = useState<Array<{ id: string; name: string }> | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [overview, setOverview] = useState<OverviewRow[]>([]);
  const role = me!.permissions.nightAuditRole;
  const isAdmin = me!.user.role === 'company_admin' || me!.user.role === 'property_admin';

  // People with both roles pick how they are working; it only ever *reduces* what they can do on this screen.
  const [asAuditor, setAsAuditor] = useState(() => { try { return localStorage.getItem(MODE_KEY) !== 'manager'; } catch { return true; } });
  const mayWork = role === 'auditor' || role === 'both';
  const working = mayWork && (role === 'auditor' || asAuditor);

  const tab = (params.get('tab') as Tab) || 'home';
  const date = params.get('date') || defaultAuditDate();
  const propertyId = params.get('property') ?? (props?.find((p) => p.id === me!.property?.id)?.id ?? props?.[0]?.id ?? null);
  const set = useCallback((patch: Record<string, string | null>) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) v === null ? n.delete(k) : n.set(k, v); return n; }, { replace: true }), [setParams]);

  useEffect(() => { api.get<{ properties: Array<{ id: string; name: string }> }>('/api/audit/properties').then((r) => setProps(r.properties)); }, []);

  const canWork = working && !!propertyId && propertyId === me!.property?.id;
  const a = useAudit(propertyId, date, canWork);
  const { view } = a;

  const refreshLists = useCallback(async () => {
    if (!propertyId) return;
    setRuns((await api.get<{ runs: RunSummary[] }>(`/api/audit/runs?propertyId=${propertyId}`)).runs);
    if (isAdmin) setOverview((await api.get<{ properties: OverviewRow[] }>(`/api/audit/overview?date=${date}`)).properties);
  }, [propertyId, date, isAdmin]);
  useEffect(() => { void refreshLists(); }, [refreshLists, view?.exists ? view.progress.done : -1, view?.exists ? view.run.status : '']);

  const prop = props?.find((p) => p.id === propertyId);
  const tabs = useMemo(() => {
    const t: Array<{ id: Tab; label: string; icon: IconName; badge?: React.ReactNode }> = [
      { id: 'home', label: 'Overview', icon: 'home' },
      { id: 'checklist', label: 'Checklist', icon: 'check-circle', badge: view?.exists ? <span className="tab-count" style={{ background: 'var(--ds-secondary)', color: 'var(--ds-on-secondary)', borderColor: 'var(--ds-border-input)' }}>{view.progress.done}/{view.progress.total}</span> : undefined },
      { id: 'ccrec', label: 'Card rec', icon: 'roster' },
    ];
    if (isAdmin) t.push({ id: 'settings', label: 'Settings', icon: 'sliders' });
    return t;
  }, [view, isAdmin]);

  if (!props) return <p className="ds-muted" role="status">Loading…</p>;
  if (!props.length || !propertyId) return <Notice tone="info" title="No property">Night audits are run per property. Ask an administrator to assign you to one.</Notice>;

  const runView = view?.exists ? view : null;
  const writable = !!runView && runView.canEdit && working && a.holding;
  const heldByOther = !!runView && runView.run.status === 'open' && !!runView.lock.heldBy && !runView.lock.heldByMe;

  return (
    <div className="au">
      <div className="au-bar">
        {props.length > 1 && (
          <Field label="Property" htmlFor="au-prop"><Select id="au-prop" value={propertyId} onChange={(e) => set({ property: e.target.value })}>{props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        )}
        <Field label="Audit date" htmlFor="au-date" hint={view ? `Business date ${view.exists ? view.run.businessDate : view.businessDate}` : undefined}>
          <Input id="au-date" type="date" value={date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </Field>
        <Button variant="ghost" size="sm" onClick={() => set({ date: null })}>Tonight</Button>
        <span className="grow" />
        {role === 'both' && (
          <div className="au-mode" role="group" aria-label="Working as">
            <button type="button" aria-pressed={asAuditor} onClick={() => { setAsAuditor(true); try { localStorage.setItem(MODE_KEY, 'auditor'); } catch { /* ignore */ } }}>Night auditor</button>
            <button type="button" aria-pressed={!asAuditor} onClick={() => { setAsAuditor(false); try { localStorage.setItem(MODE_KEY, 'manager'); } catch { /* ignore */ } }}>Night manager</button>
          </div>
        )}
      </div>

      {a.error && <Notice tone="rejected" title={a.error} />}
      {a.lost && <Notice tone="pending" icon="lock" title="Editing paused">{a.lost}</Notice>}
      {runView?.run.status === 'closed' && (
        <div className="au-banner" data-tone="closed"><Icon name="check-circle" size={18} /><span className="grow"><strong>Closed</strong>{runView.run.closedBy ? ` by ${runView.run.closedBy}` : ''}. This audit is a read-only record.{runView.run.closeNote ? ` Reason for gaps: “${runView.run.closeNote}”` : ''}</span></div>
      )}
      {runView && runView.run.status === 'open' && !writable && (
        <div className="au-banner" data-tone={heldByOther ? 'warn' : 'view'}>
          <Icon name={heldByOther ? 'lock' : 'eye'} size={18} />
          <span className="grow"><strong>Display only.</strong> {heldByOther ? `${runView.lock.heldBy} is working on this audit. This view updates automatically.` : !mayWork ? 'Your role can see the audit but not change it.' : !working ? 'You are working as night manager.' : propertyId !== me!.property?.id ? 'You can only run audits for your own property.' : 'You are not holding the edit lock.'}</span>
          {heldByOther && mayWork && working && canWork && <Button size="sm" onClick={() => void a.takeOver()}>Take over</Button>}
        </div>
      )}

      <Tabs label="Night audit sections" value={tab} onChange={(t) => set({ tab: t === 'home' ? null : t })} tabs={tabs} />

      {tab === 'home' && (
        <AuditDashboard view={view} runs={runs} overview={overview} date={date} canWork={working} canStart={canWork && !!view && !view.exists && view.canStart}
          showOverview={isAdmin && overview.length > 0}
          onStart={async () => { await a.start(); set({ tab: 'checklist' }); }} onOpen={() => set({ tab: 'checklist' })}
          onPickDate={(d) => set({ date: d, tab: 'checklist' })} onTool={(t) => set({ tab: t === 'ccrec' ? 'ccrec' : null })} />
      )}
      {tab === 'checklist' && (runView
        ? <Checklist a={a} view={runView} canWrite={writable} onTool={(t) => t === 'ccrec' && set({ tab: 'ccrec' })} />
        : view ? (
          <Notice tone="info" title="This audit has not been started">
            {canWork && !view.exists && view.canStart ? <><p>Starting creates the audit for this date and gives you the edit lock.</p><Button onClick={() => void a.start()} icon="moon">Start night audit</Button></> : 'A night auditor needs to start it. You will see it here as soon as they do.'}
          </Notice>) : <p className="ds-muted" role="status">Loading…</p>)}
      {tab === 'ccrec' && (runView ? <CcRecTool a={a} view={runView} canWrite={writable} /> : <Notice tone="info" title="Start the audit first">The card reconciliation belongs to a night audit. Start it from the Overview or Checklist tab.</Notice>)}
      {tab === 'settings' && isAdmin && prop && <AuditSettings propertyId={propertyId} propertyName={prop.name} onChanged={() => void a.load(true)} />}
    </div>
  );
}
