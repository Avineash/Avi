import { useEffect, useMemo, useState } from 'react';
import { summarizeChanges, type AuditReport } from '@staffhub/theme-core';
import { Button, Checkbox, Field, Modal, Notice, Select, Tabs, Textarea, type IconName } from '@staffhub/ui';
import { api, ApiError } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { fmtDay } from '../format.ts';
import { AccessPanel, AccessibilityPanel, HistoryPanel, IssueRow, PresetsPanel } from './panels-meta.tsx';
import { ColorsPanel, IdentityPanel, StatusPanel, StylePanel } from './panels-style.tsx';
import { PreviewFrame, type Device } from './Preview.tsx';
import { useBrandEditor, type ScopeSummary } from './useBrandEditor.ts';

type Tab = 'identity' | 'colors' | 'status' | 'style' | 'presets' | 'a11y' | 'history' | 'access';
type SchemeView = 'light' | 'dark' | 'both';

export function BrandAppearance() {
  const { me, reload } = useAuth();
  const [scopes, setScopes] = useState<ScopeSummary[] | null>(null);
  const [scopeKey, setScopeKey] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ scopes: ScopeSummary[] }>('/api/brand/scopes').then((r) => { setScopes(r.scopes); setScopeKey((k) => k ?? r.scopes[0]?.key ?? null); });
  }, []);
  if (!scopes || !scopeKey) return <p className="ds-muted" role="status">Loading…</p>;
  return <Manager key={scopeKey} scopeKey={scopeKey} scopes={scopes} onScope={setScopeKey} onPublished={async () => {
    await reload();
    setScopes((await api.get<{ scopes: ScopeSummary[] }>('/api/brand/scopes')).scopes);
  }} role={me!.user.role} />;
}

function Manager({ scopeKey, scopes, onScope, onPublished, role }: { scopeKey: string; scopes: ScopeSummary[]; onScope: (k: string) => void; onPublished: () => Promise<void>; role: string }) {
  const ed = useBrandEditor(scopeKey);
  const [tab, setTab] = useState<Tab>('identity');
  const [device, setDevice] = useState<Device>('desktop');
  const [schemeView, setSchemeView] = useState<SchemeView>('light');
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const [publishOpen, setPublishOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [restoreV, setRestoreV] = useState<number | null>(null);
  const [flash, setFlash] = useState('');

  const server = ed.server;
  const defaultScheme = ed.resolved.mode.default === 'dark' ? 'dark' : 'light';
  useEffect(() => { setSchemeView(defaultScheme); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [server?.scope.key]);

  if (ed.error && !server) return <Notice tone="rejected" title="Could not load Brand & Appearance">{ed.error}</Notice>;
  if (!server) return <p className="ds-muted" role="status">Loading…</p>;

  const isProp = server.scope.type === 'property';
  const status = ed.dirty ? 'Unsaved changes' : ed.differsFromActive ? 'Draft saved, not published' : 'No unpublished changes';
  const tabs: Array<{ id: Tab; label: string; icon: IconName; badge?: React.ReactNode }> = [
    { id: 'identity', label: 'Identity', icon: 'building' },
    { id: 'colors', label: 'Colors', icon: 'palette' },
    { id: 'status', label: 'Status', icon: 'clock' },
    { id: 'style', label: 'Type & shape', icon: 'type' },
    { id: 'presets', label: 'Presets', icon: 'layers' },
    { id: 'a11y', label: 'Accessibility', icon: 'shield', badge: ed.audit.errors ? <span className="tab-count" aria-label={`${ed.audit.errors} failures`}>{ed.audit.errors}</span> : undefined },
    { id: 'history', label: 'History', icon: 'history' },
    { id: 'access', label: isProp ? 'Permissions' : 'Governance', icon: 'lock' },
  ];

  const confirmLeave = (k: string) => { if (!ed.dirty || window.confirm('You have unsaved changes. Discard them and switch?')) onScope(k); };
  const save = async () => { try { await ed.save(); setFlash('Draft saved. Nothing has changed for your users yet.'); } catch { /* shown via ed.error */ } };

  return (
    <div className="brand-screen">
      <header className="brand-head">
        <div>
          <h2 className="brand-title">Brand & Appearance</h2>
          <p className="ds-muted">Changes appear in the preview straight away. Your live theme only changes when you publish.</p>
        </div>
        {scopes.length > 1 && (
          <Field label="Editing" htmlFor="scope">
            <Select id="scope" value={scopeKey} onChange={(e) => confirmLeave(e.target.value)}>
              {scopes.map((s) => <option key={s.key} value={s.key}>{s.type === 'company' ? 'Company · ' : 'Property · '}{s.name}{s.activeVersion ? ` (v${s.activeVersion})` : ''}</option>)}
            </Select>
          </Field>
        )}
      </header>

      {isProp && <Notice tone="info" icon="link" title={`${server.scope.name} inherits the company brand`}>Only the settings you override here differ. Everything else follows the company theme, including future company changes.</Notice>}

      <div className="brand-toolbar" role="toolbar" aria-label="Theme actions">
        <div className="ds-row">
          <Button variant="ghost" size="sm" icon="undo" disabled={!ed.canUndo} onClick={ed.undo} aria-label="Undo">Undo</Button>
          <Button variant="ghost" size="sm" icon="redo" disabled={!ed.canRedo} onClick={ed.redo} aria-label="Redo">Redo</Button>
        </div>
        <div className="brand-toolbar__status" role="status" aria-live="polite">
          <span className={`dot ${ed.dirty ? 'dot--dirty' : ed.differsFromActive ? 'dot--draft' : 'dot--clean'}`} aria-hidden="true" />
          <span><strong>{status}</strong>{server.active ? <> · Live: v{server.active.version}</> : <> · {isProp ? 'Inheriting company theme' : 'Not yet published'}</>}</span>
          {flash && <span className="ds-hint"> — {flash}</span>}
        </div>
        <div className="ds-row">
          {isProp && <Button variant="ghost" size="sm" icon="link" onClick={() => ed.update(() => ({}))} disabled={!Object.keys(ed.overrides).length}>Inherit all</Button>}
          <Button variant="secondary" size="sm" icon="reset" onClick={() => setResetOpen(true)} disabled={!ed.dirty && !server.draft.hasUnpublishedChanges}>Reset</Button>
          <Button variant="secondary" size="sm" icon="save" onClick={save} disabled={!ed.dirty || ed.busy !== null}>{ed.busy === 'save' ? 'Saving…' : 'Save draft'}</Button>
          <Button size="sm" icon="publish" onClick={() => { setPublishOpen(true); }} disabled={!ed.differsFromActive || ed.busy !== null}>Publish theme</Button>
        </div>
      </div>

      {ed.error && (
        <Notice tone="rejected" title={ed.error}>
          <Button size="sm" variant="secondary" onClick={() => { ed.setError(null); void ed.reload(); }}>Reload latest</Button>
        </Notice>
      )}

      <div className="brand-mobile-switch"><Tabs label="Show" value={mobileView} onChange={setMobileView} tabs={[{ id: 'edit', label: 'Edit', icon: 'sliders' }, { id: 'preview', label: 'Preview', icon: 'eye' }]} /></div>

      <div className={`brand-body is-${mobileView}`}>
        <section className="brand-editor ds-card" aria-label="Theme editor">
          <Tabs label="Theme settings" value={tab} onChange={setTab} tabs={tabs} />
          <div className="brand-editor__panel" role="tabpanel">
            {tab === 'identity' && <IdentityPanel ed={ed} />}
            {tab === 'colors' && <ColorsPanel ed={ed} />}
            {tab === 'status' && <StatusPanel ed={ed} />}
            {tab === 'style' && <StylePanel ed={ed} />}
            {tab === 'presets' && <PresetsPanel ed={ed} />}
            {tab === 'a11y' && <AccessibilityPanel ed={ed} />}
            {tab === 'history' && <HistoryPanel ed={ed} onRestore={setRestoreV} />}
            {tab === 'access' && <AccessPanel ed={ed} />}
          </div>
        </section>

        <section className="brand-preview" aria-label="Live preview">
          <div className="brand-preview__bar">
            <Tabs label="Device" value={device} onChange={setDevice} tabs={[{ id: 'desktop', label: 'Desktop', icon: 'monitor' }, { id: 'mobile', label: 'Mobile', icon: 'phone' }]} />
            <Tabs label="Appearance" value={schemeView} onChange={setSchemeView} tabs={[{ id: 'light', label: 'Light', icon: 'sun' }, { id: 'dark', label: 'Dark', icon: 'moon' }, { id: 'both', label: 'Both', icon: 'layers' }]} />
          </div>
          {ed.versionPreview && (
            <Notice tone="pending" icon="eye" title={`Previewing version ${ed.versionPreview.version}: not applied`}>
              <div className="ds-row" style={{ marginTop: 6 }}>
                <Button size="sm" variant="secondary" onClick={() => ed.previewVersion(null)}>Back to my draft</Button>
                <Button size="sm" onClick={() => setRestoreV(ed.versionPreview!.version)}>Restore this version…</Button>
              </div>
            </Notice>
          )}
          <div className={`brand-preview__frames ${schemeView === 'both' && device === 'mobile' ? 'is-side' : ''}`}>
            {(schemeView === 'both' ? (['light', 'dark'] as const) : [schemeView]).map((s) => (
              <PreviewFrame key={s} theme={ed.resolved} scheme={s} device={device} caption={`${s === 'light' ? 'Light' : 'Dark'} mode · ${device === 'desktop' ? 'Desktop' : 'Mobile'} · ${ed.versionPreview ? `version ${ed.versionPreview.version}` : 'your draft'}`} />
            ))}
          </div>
        </section>
      </div>

      <PublishModal ed={ed} open={publishOpen} onClose={() => setPublishOpen(false)} scopeName={server.scope.name} isProp={isProp}
        onDone={async (v) => { setPublishOpen(false); setFlash(`Version ${v} is live.`); await onPublished(); }} />

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset to the live theme?"
        footer={<><Button variant="ghost" onClick={() => setResetOpen(false)}>Keep editing</Button><Button variant="danger" icon="reset" disabled={ed.busy !== null} onClick={async () => { await ed.reset().catch(() => {}); setResetOpen(false); setFlash('Draft discarded.'); }}>Discard my changes</Button></>}>
        <p>This discards your unsaved edits and any saved draft, and goes back to what your users see today{server.active ? ` (version ${server.active.version})` : ' (the default theme)'}. Published themes and history are not affected.</p>
      </Modal>

      <Modal open={restoreV !== null} onClose={() => setRestoreV(null)} title={`Restore version ${restoreV}?`}
        footer={<><Button variant="ghost" onClick={() => setRestoreV(null)}>Cancel</Button><Button icon="history" disabled={ed.busy !== null} onClick={async () => { await ed.restore(restoreV!).then(async () => { setFlash(`Version ${restoreV} restored as a new version.`); setRestoreV(null); await onPublished(); }).catch(() => setRestoreV(null)); }}>Restore and publish</Button></>}>
        <p>Version {restoreV} will be published again as a <strong>new</strong> version and go live immediately for {isProp ? server.scope.name : 'every property that follows the company theme'}. The version you are replacing stays in history, so you can switch back at any time.</p>
        {ed.dirty && <Notice tone="pending" title="Your unsaved draft will be discarded." />}
        {role === 'property_admin' && <p className="ds-hint">Restoring only works if your company still allows the settings that version contains.</p>}
      </Modal>
    </div>
  );
}

function PublishModal({ ed, open, onClose, onDone, scopeName, isProp }: { ed: ReturnType<typeof useBrandEditor>; open: boolean; onClose: () => void; onDone: (version: number) => void | Promise<void>; scopeName: string; isProp: boolean }) {
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverReport, setServerReport] = useState<AuditReport | null>(null);
  useEffect(() => { if (open) { setNote(''); setAck(false); setError(null); setServerReport(null); } }, [open]);

  const report = serverReport ?? ed.audit;
  const summary = useMemo(() => summarizeChanges(ed.changes), [ed.changes]);
  const blocked = report.blocking.length > 0;
  const needsAck = report.acknowledgeable.length > 0;
  const errors = report.issues.filter((i) => i.severity === 'error');

  async function go() {
    setError(null);
    try { const r = await ed.publish({ note, acknowledgeAccessibility: ack }); await onDone(r.version); }
    catch (e) {
      if (e instanceof ApiError) { setError(e.message); if (e.extra.report) setServerReport(e.extra.report as AuditReport); } else setError('Could not publish.');
    }
  }
  return (
    <Modal open={open} onClose={onClose} wide title="Publish theme"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="publish" onClick={go} disabled={blocked || (needsAck && !ack) || ed.busy !== null}>{ed.busy === 'publish' ? 'Publishing…' : 'Publish theme'}</Button></>}>
      <p>This updates the look for {isProp ? <strong>{scopeName}</strong> : <>everyone at <strong>{scopeName}</strong> (and every property that follows the company theme)</>} the next time their app loads, on every device. Employee, leave and roster data are not touched.</p>
      <section>
        <h3 className="panel-h">What will change</h3>
        {summary.length ? <div className="version__chips">{summary.map((s) => <span key={s.group} className="pill">{s.label} · {s.count}</span>)}</div> : <p className="ds-muted">No differences from the live theme.</p>}
      </section>
      <section>
        <h3 className="panel-h">Accessibility (WCAG 2.2 AA)</h3>
        {errors.length === 0 ? <Notice tone="approved" icon="shield" title="Passes AA contrast in light and dark mode">{report.warnings > 0 ? `${report.warnings} item${report.warnings === 1 ? '' : 's'} to review in the Accessibility tab.` : 'No issues found.'}</Notice> : (
          <>
            {blocked && <Notice tone="rejected" title="Leave status colours fail AA and can’t be published">Fix them on the Status tab, then publish. These colours are how people read leave at a glance.</Notice>}
            <ul className="issues">{errors.map((i) => <IssueRow key={i.id} issue={i} canFix={false} />)}</ul>
            {needsAck && !blocked && <Checkbox label="I understand these combinations don’t meet WCAG 2.2 AA, and want to publish anyway." checked={ack} onChange={(e) => setAck(e.target.checked)} />}
          </>
        )}
      </section>
      <Field label="Note for the history" hint={`Shown in version history. Last live change: ${ed.server?.active ? fmtDay(ed.server.active.publishedAt.slice(0, 10)) : 'never'}.`} htmlFor="note"><Textarea id="note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Spring refresh, new logo" /></Field>
      {error && <Notice tone="rejected" title={error} />}
    </Modal>
  );
}
