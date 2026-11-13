import { useEffect, useMemo, useState } from 'react';
import {
  CONFIG_GROUPS, CUSTOM_BRAND_DEFAULT, GROUP_LABELS, PRESETS, applyFixes, applyPreset, auditTheme, customBrandConfig, normalizeHex, resolveTheme,
  type AuditIssue, type ConfigGroup, type ThemePreset,
} from '@staffhub/theme-core';
import { Button, Card, Checkbox, Icon, Notice } from '@staffhub/ui';
import { api, ApiError } from '../api.ts';
import { fmtDay, timeAgo } from '../format.ts';
import { LockNotice } from './controls.tsx';
import { MiniPreview } from './Preview.tsx';
import type { BrandEditor } from './useBrandEditor.ts';

// ─────────────────────────── presets ───────────────────────────

function PresetCard({ preset, brandColor, ed, onApplied }: { preset: ThemePreset; brandColor: string; ed: BrandEditor; onApplied: (name: string) => void }) {
  const config = useMemo(() => (preset.generated ? customBrandConfig(brandColor) : preset.config), [preset, brandColor]);
  const theme = useMemo(() => resolveTheme(config), [config]);
  const ok = useMemo(() => auditTheme(theme).errors === 0, [theme]);
  const canColors = ed.server!.editable.colors;
  const c = theme.schemes.light.colors;
  return (
    <article className="preset">
      <MiniPreview theme={theme} mode={theme.mode.default === 'system' ? 'light' : theme.mode.default} />
      <div className="preset__meta">
        <h4>{preset.name}</h4>
        <p className="ds-hint">{preset.description}</p>
        <div className="preset__row">
          <span className="swatches" aria-hidden="true">{[c.primary, c.secondary, c.accent, c.sidebarBg].map((x) => <i key={x} style={{ background: x }} />)}</span>
          <span className={`pill ${ok ? 'pill--ok' : 'pill--bad'}`}><Icon name={ok ? 'check' : 'alert'} size={12} />{ok ? 'Passes AA' : 'Needs review'}</span>
        </div>
        <Button size="sm" variant="secondary" disabled={!canColors} onClick={() => { ed.update((cfg) => applyPreset(cfg, { ...preset, config }, ed.server!.editable)); onApplied(preset.name); }}>Use this preset</Button>
      </div>
    </article>
  );
}

export function PresetsPanel({ ed }: { ed: BrandEditor }) {
  const [brandColor, setBrandColor] = useState<string>(CUSTOM_BRAND_DEFAULT);
  const [hex, setHex] = useState<string>(CUSTOM_BRAND_DEFAULT);
  const [applied, setApplied] = useState<string | null>(null);
  const locked = !ed.server!.editable.colors;
  return (
    <div className="ds-stack panel-stack">
      {locked && <LockNotice>Presets change colours, fonts and shape, which your company administrator controls.</LockNotice>}
      <p className="ds-hint">Presets are starting points: they replace colours, fonts, corners and mode, but never your names, logos or leave-status colours. Everything stays editable afterwards.</p>
      <div className="custom-brand">
        <label className="ds-label" htmlFor="brand-hex">Custom brand: start from one colour</label>
        <div className="ds-row">
          <input type="color" value={brandColor} aria-label="Brand colour picker" onChange={(e) => { setBrandColor(e.target.value); setHex(e.target.value); }} />
          <input id="brand-hex" className="ds-input color-row__hex" value={hex} maxLength={7} spellCheck={false}
            onChange={(e) => { setHex(e.target.value); const n = normalizeHex(e.target.value); if (n) setBrandColor(n); }} onBlur={() => setHex(brandColor)} />
        </div>
      </div>
      <div className="preset-grid">
        {PRESETS.map((p) => <PresetCard key={p.id} preset={p} brandColor={brandColor} ed={ed} onApplied={setApplied} />)}
      </div>
      <div role="status" aria-live="polite" className="ds-hint">
        {applied && <>Applied “{applied}” to your draft. <Button size="sm" variant="ghost" icon="undo" onClick={() => { ed.undo(); setApplied(null); }}>Undo</Button></>}
      </div>
    </div>
  );
}

// ─────────────────────────── accessibility ───────────────────────────

const SEV_LABEL = { error: 'Fails AA', warning: 'Review', info: 'Note' } as const;
const SEV_ICON = { error: 'x-circle', warning: 'alert', info: 'info' } as const;

export function IssueRow({ issue, onFix, canFix }: { issue: AuditIssue; onFix?: () => void; canFix: boolean }) {
  return (
    <li className={`issue issue--${issue.severity}`}>
      <span className="issue__sev"><Icon name={SEV_ICON[issue.severity]} size={15} />{SEV_LABEL[issue.severity]}</span>
      <div className="issue__main">
        <strong>{issue.title}</strong>
        <div>{issue.detail}</div>
        {issue.criterion && <div className="ds-hint">{issue.criterion}</div>}
      </div>
      {issue.fg && issue.bg && <span className="issue__sample" style={{ color: issue.fg, background: issue.bg }} aria-hidden="true">Aa</span>}
      {issue.fix && onFix && <Button size="sm" variant="secondary" disabled={!canFix} onClick={onFix}>Fix</Button>}
    </li>
  );
}

export function AccessibilityPanel({ ed }: { ed: BrandEditor }) {
  const { audit } = ed;
  const canFixPath = (i: AuditIssue) => !!i.fix && ed.server!.editable[i.fix.path[0] as ConfigGroup];
  const fixable = audit.issues.filter((i) => i.severity === 'error' && canFixPath(i));
  const sorted = [...audit.issues].sort((a, b) => ['error', 'warning', 'info'].indexOf(a.severity) - ['error', 'warning', 'info'].indexOf(b.severity));
  return (
    <div className="ds-stack panel-stack">
      <div className={`a11y-summary ${audit.errors ? 'is-bad' : 'is-ok'}`} role="status">
        <Icon name={audit.errors ? 'alert' : 'shield'} size={22} />
        <div>
          <strong>{audit.errors ? `${audit.errors} contrast failure${audit.errors === 1 ? '' : 's'} against WCAG 2.2 AA` : 'Passes WCAG 2.2 AA contrast'}</strong>
          <div className="ds-hint">{audit.checks - audit.errors} of {audit.checks} checks passed · {audit.warnings} to review · {audit.infos} note{audit.infos === 1 ? '' : 's'}. Checked in light and dark mode, including hover, pressed and focus states.</div>
        </div>
        {fixable.length > 0 && <Button size="sm" onClick={() => ed.update((c) => applyFixes(c, fixable))}>Fix all ({fixable.length})</Button>}
      </div>
      {audit.blocking.length > 0 && <Notice tone="rejected" title="Leave status colours must pass before publishing">Status colours that fail AA can’t be published, even with acknowledgement, because people rely on them to read leave at a glance.</Notice>}
      {sorted.length === 0 ? <p className="ds-muted">Nothing to report.</p> : (
        <ul className="issues">{sorted.map((i) => <IssueRow key={i.id} issue={i} canFix={canFixPath(i)} onFix={() => ed.set(i.fix!.path, i.fix!.value)} />)}</ul>
      )}
      <details className="ds-hint"><summary>What is checked</summary>
        <ul>
          <li>Text on page, cards, navigation, secondary and accent fills: 4.5:1 (1.4.3)</li>
          <li>Button labels in default, hover and pressed states: 4.5:1</li>
          <li>Field borders and keyboard focus ring: 3:1 (1.4.11)</li>
          <li>Each leave status: text on its background 4.5:1, an icon and a label always present (1.4.1), plus colour-convention and distinctness warnings</li>
          <li>Chart colours are derived automatically to reach 3:1 on cards</li>
        </ul>
      </details>
    </div>
  );
}

// ─────────────────────────── history ───────────────────────────

export function HistoryPanel({ ed, onRestore }: { ed: BrandEditor; onRestore: (version: number) => void }) {
  const { loadVersions } = ed;
  useEffect(() => { void loadVersions(); }, [loadVersions]);
  const vs = ed.versions;
  if (!vs) return <p className="ds-muted" role="status">Loading history…</p>;
  if (!vs.length) return <p className="ds-muted">Nothing has been published for this scope yet.{ed.server!.scope.type === 'property' && ' It currently inherits the company theme.'}</p>;
  return (
    <ol className="versions">
      {vs.map((v) => (
        <li key={v.version} className={`version${v.active ? ' is-active' : ''}`}>
          <div className="version__head">
            <strong>Version {v.version}</strong>
            {v.active && <span className="pill pill--ok"><Icon name="check" size={12} />Live</span>}
            {v.kind === 'rollback' && <span className="pill"><Icon name="history" size={12} />Restored v{v.restoredFrom}</span>}
            {v.accessibilityAcknowledged && <span className="pill pill--bad"><Icon name="alert" size={12} />Published with AA failures</span>}
          </div>
          <div className="ds-hint">{v.author ?? 'Unknown'} · {fmtDay(v.createdAt.slice(0, 10))} · {timeAgo(v.createdAt)}</div>
          {v.note && <div>“{v.note}”</div>}
          {v.summary.length > 0 && <div className="version__chips">{v.summary.map((s) => <span key={s.group} className="pill">{s.label} · {s.count}</span>)}</div>}
          <div className="ds-row">
            <Button size="sm" variant={ed.versionPreview?.version === v.version ? 'primary' : 'secondary'} icon="eye" onClick={() => ed.previewVersion(ed.versionPreview?.version === v.version ? null : v.version)}>
              {ed.versionPreview?.version === v.version ? 'Previewing' : 'Preview'}
            </Button>
            {!v.active && <Button size="sm" variant="secondary" icon="history" onClick={() => onRestore(v.version)}>Restore…</Button>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─────────────────────────── access & governance ───────────────────────────

interface AuditEntry { id: number; action: string; detail: string; createdAt: string; actor: string | null }

export function AccessPanel({ ed }: { ed: BrandEditor }) {
  const s = ed.server!;
  const [policy, setPolicy] = useState(s.policy);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => setPolicy(s.policy), [s.policy]);
  useEffect(() => { if (s.canEditPolicy) api.get<{ entries: AuditEntry[] }>('/api/brand/audit').then((r) => setEntries(r.entries)).catch(() => setEntries([])); }, [s.canEditPolicy]);

  async function toggle(g: ConfigGroup, value: boolean) {
    const next = { ...policy, [g]: value }; setPolicy(next); setMsg('');
    try { await api.put('/api/brand/policy', { policy: next }); setMsg('Saved. Properties see the change immediately.'); }
    catch (e) { setPolicy(policy); setMsg(e instanceof ApiError ? e.message : 'Could not save.'); }
  }
  return (
    <div className="ds-stack panel-stack">
      <section className="ds-stack">
        <h3 className="panel-h">Hierarchy</h3>
        <p className="ds-hint">Company → Hotel/property → Department. Properties inherit the company brand until they override it. Departments share their property’s theme.</p>
      </section>
      <section className="ds-stack">
        <h3 className="panel-h">What property administrators may change</h3>
        {s.canEditPolicy ? (
          <>
            {CONFIG_GROUPS.map((g) => <Checkbox key={g} label={GROUP_LABELS[g]} checked={policy[g]} onChange={(e) => toggle(g, e.target.checked)} />)}
            <div role="status" aria-live="polite" className="ds-hint">{msg}</div>
            <span className="ds-hint">Company administrators can always change everything. Tightening a rule doesn’t remove overrides a property already published; reset them from that property’s screen.</span>
          </>
        ) : (
          <ul className="perm-list">
            {CONFIG_GROUPS.map((g) => <li key={g}><Icon name={s.editable[g] ? 'check' : 'lock'} size={15} /><span>{GROUP_LABELS[g]}</span><span className="ds-hint">{s.editable[g] ? 'You can override' : 'Controlled by the company'}</span></li>)}
          </ul>
        )}
      </section>
      {s.canEditPolicy && (
        <section className="ds-stack">
          <h3 className="panel-h">Recent branding activity</h3>
          {!entries ? <p className="ds-muted">Loading…</p> : !entries.length ? <p className="ds-muted">No activity yet.</p> : (
            <ul className="audit">{entries.slice(0, 12).map((e) => <li key={e.id}><strong>{e.action.replace('brand.', '')}</strong> <span className="ds-hint">{e.actor ?? 'system'} · {timeAgo(e.createdAt)}</span></li>)}</ul>
          )}
        </section>
      )}
      <Card className="ds-hint" title={undefined}><Icon name="shield" size={14} /> Branding is stored separately from employee, leave and roster data. Publishing, restoring or resetting a theme never changes them.</Card>
    </div>
  );
}
