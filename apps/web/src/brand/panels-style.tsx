import { useState } from 'react';
import {
  DENSITY_IDS, FONT_LIBRARY, RADIUS_IDS, STATUS_KEYS, STATUS_LABELS, generateDarkFromLight, getFont, hasPath, mergeConfigs,
  type ColorKey, type ConfigGroup, type DensityId, type ModeId, type Path, type RadiusId, type ResolvedScheme, type Scheme, type StatusKey,
} from '@staffhub/theme-core';
import { OPTIONAL_COLOR_KEYS, DEFAULT_STATUS_COLORS, RADIUS_TOKENS } from '@staffhub/theme-core';
import { Button, Checkbox, Icon, Input, Notice, Select, StatusBadge, Tabs, ThemeScope } from '@staffhub/ui';
import { ColorRow, ContrastChip, FieldShell, ImageUploader, LockNotice, type Source } from './controls.tsx';
import type { BrandEditor } from './useBrandEditor.ts';

/** Where does the value currently shown come from? Always conveyed as text, never colour alone. */
function sourceOf(ed: BrandEditor, path: Path, derived = false): Source {
  const isProp = ed.server?.scope.type === 'property';
  if (hasPath(ed.overrides, path)) return isProp ? 'overridden' : 'custom';
  if (isProp && ed.server!.inheritedLayers.some((l) => hasPath(l, path))) return 'inherited'; // set by the company, not just a system default
  return derived ? 'auto' : 'default';
}

const Locked = ({ group, ed }: { group: ConfigGroup; ed: BrandEditor }) =>
  ed.server && !ed.server.editable[group] ? <LockNotice>Your company administrator controls these settings for all properties. You are seeing the inherited values.</LockNotice> : null;

// ─────────────────────────── identity ───────────────────────────

export function IdentityPanel({ ed }: { ed: BrandEditor }) {
  const s = ed.server!, id = ed.resolved.identity, isProp = s.scope.type === 'property';
  const disabled = !s.editable.identity;
  const p = (k: string): Path => ['identity', k];
  const text = (key: 'companyName' | 'propertyName' | 'tagline') => (v: string) => {
    if (key === 'companyName') return v.trim() ? ed.set(p(key), v) : undefined;
    if (v.trim()) ed.set(p(key), v); else if (isProp) ed.set(p(key), null); else ed.clear(p(key));
  };
  const asset = (key: 'logoAssetId' | 'logoDarkAssetId' | 'faviconAssetId') => (v: string | null | undefined) => (v === undefined ? ed.clear(p(key)) : ed.set(p(key), v));
  return (
    <div className="ds-stack panel-stack">
      <Locked group="identity" ed={ed} />
      <div className="ds-form-grid">
        <FieldShell label="Company name" source={sourceOf(ed, p('companyName'))} onReset={() => ed.clear(p('companyName'))}>
          <Input value={id.companyName} disabled={disabled} maxLength={80} onChange={(e) => text('companyName')(e.target.value)} aria-label="Company name" />
        </FieldShell>
        {isProp && (
          <FieldShell label="Hotel / property name" source={sourceOf(ed, p('propertyName'))} onReset={() => ed.clear(p('propertyName'))} hint="Shown under the logo. Defaults to the property’s record name.">
            <Input value={id.propertyName ?? ''} disabled={disabled} maxLength={80} onChange={(e) => text('propertyName')(e.target.value)} aria-label="Property name" />
          </FieldShell>
        )}
        <FieldShell label="Tagline" source={sourceOf(ed, p('tagline'))} onReset={() => ed.clear(p('tagline'))} hint="Optional. Shown on the sign-in page and under the logo.">
          <Input value={id.tagline ?? ''} disabled={disabled} maxLength={120} onChange={(e) => text('tagline')(e.target.value)} aria-label="Tagline" />
        </FieldShell>
      </div>
      <div className="ds-form-grid uploader-grid">
        <ImageUploader kind="logo" label="Logo" hint="PNG, JPEG, WebP or SVG up to 512 KB. Wide logos around 160×48 work best." assetId={id.logoAssetId} source={sourceOf(ed, p('logoAssetId'))} onChange={asset('logoAssetId')} disabled={disabled} />
        <ImageUploader kind="logoDark" label="Logo for dark mode" hint="Optional. Without it, the main logo is used on dark backgrounds." assetId={id.logoDarkAssetId} source={sourceOf(ed, p('logoDarkAssetId'))} onChange={asset('logoDarkAssetId')} disabled={disabled} onDark />
        <ImageUploader kind="favicon" label="Favicon" hint="Square PNG, SVG or ICO up to 256 KB." assetId={id.faviconAssetId} source={sourceOf(ed, p('faviconAssetId'))} onChange={asset('faviconAssetId')} disabled={disabled} max={256} />
      </div>
      <Notice tone="info" icon="shield">Only upload logos your organisation owns or is licensed to use. Without a logo, StaffHub shows a monogram in your brand colour. Example themes imitate no real company.</Notice>
    </div>
  );
}

// ─────────────────────────── colours ───────────────────────────

type Pair = { fg: string; bg: string; min: number; label: string } | null;
interface RowSpec { key: ColorKey; label: string; hint?: string; pair?: (s: ResolvedScheme) => Pair }
const ROWS: Array<{ title: string; rows: RowSpec[] }> = [
  { title: 'Brand', rows: [
    { key: 'primary', label: 'Primary', hint: 'Main buttons, links and highlights', pair: (s) => (s.colors.buttonBg === s.colors.primary ? { fg: s.colors.buttonText, bg: s.colors.primary, min: 4.5, label: 'Button label' } : null) },
    { key: 'secondary', label: 'Secondary', hint: 'Secondary buttons and soft fills', pair: (s) => ({ fg: s.onSecondary, bg: s.colors.secondary, min: 4.5, label: 'Text on secondary' }) },
    { key: 'accent', label: 'Accent', hint: 'Active-item marker, badges, charts', pair: (s) => ({ fg: s.onAccent, bg: s.colors.accent, min: 4.5, label: 'Text on accent' }) },
  ] },
  { title: 'Page & cards', rows: [
    { key: 'pageBg', label: 'Page background', pair: (s) => ({ fg: s.colors.text, bg: s.colors.pageBg, min: 4.5, label: 'Text on page' }) },
    { key: 'surface', label: 'Card background', pair: (s) => ({ fg: s.colors.text, bg: s.colors.surface, min: 4.5, label: 'Text on cards' }) },
    { key: 'text', label: 'Text', pair: (s) => ({ fg: s.colors.text, bg: s.colors.surface, min: 4.5, label: 'Text on cards' }) },
    { key: 'mutedText', label: 'Secondary text', hint: 'Hints, captions, labels', pair: (s) => ({ fg: s.colors.mutedText, bg: s.colors.surface, min: 4.5, label: 'Secondary text' }) },
    { key: 'border', label: 'Card border', hint: 'Decorative dividers' },
    { key: 'inputBorder', label: 'Field border', hint: 'Needs 3:1 to be seen', pair: (s) => ({ fg: s.colors.inputBorder, bg: s.colors.surface, min: 3, label: 'Field border' }) },
  ] },
  { title: 'Sidebar & navigation', rows: [
    { key: 'sidebarBg', label: 'Sidebar background', pair: (s) => ({ fg: s.colors.sidebarText, bg: s.colors.sidebarBg, min: 4.5, label: 'Nav text' }) },
    { key: 'sidebarText', label: 'Sidebar text & icons', pair: (s) => ({ fg: s.colors.sidebarText, bg: s.colors.sidebarBg, min: 4.5, label: 'Nav text' }) },
    { key: 'sidebarActive', label: 'Active item', pair: (s) => ({ fg: s.colors.sidebarText, bg: s.colors.sidebarActive, min: 4.5, label: 'Active item text' }) },
  ] },
  { title: 'Buttons & focus', rows: [
    { key: 'buttonBg', label: 'Button', hint: 'Follows Primary unless set', pair: (s) => ({ fg: s.colors.buttonText, bg: s.colors.buttonBg, min: 4.5, label: 'Button label' }) },
    { key: 'buttonText', label: 'Button label', pair: (s) => ({ fg: s.colors.buttonText, bg: s.colors.buttonBg, min: 4.5, label: 'Button label' }) },
    { key: 'buttonHoverBg', label: 'Button · hover', pair: (s) => ({ fg: s.colors.buttonText, bg: s.colors.buttonHoverBg, min: 4.5, label: 'Label on hover' }) },
    { key: 'buttonActiveBg', label: 'Button · pressed', pair: (s) => ({ fg: s.colors.buttonText, bg: s.colors.buttonActiveBg, min: 4.5, label: 'Label when pressed' }) },
    { key: 'focusRing', label: 'Keyboard focus ring', hint: 'Needs 3:1 on page and cards', pair: (s) => ({ fg: s.colors.focusRing, bg: s.colors.surface, min: 3, label: 'Focus ring' }) },
  ] },
];

export function ColorsPanel({ ed }: { ed: BrandEditor }) {
  const [scheme, setScheme] = useState<Scheme>('light');
  const disabled = !ed.server!.editable.colors;
  const s = ed.resolved.schemes[scheme];
  const lightCustom = hasPath(ed.overrides, ['colors', 'light']);
  const darkCustom = hasPath(ed.overrides, ['colors', 'dark']);
  const setColor = (key: ColorKey) => (hex: string) => ed.set(['colors', scheme, key], hex);

  return (
    <div className="ds-stack panel-stack">
      <Locked group="colors" ed={ed} />
      <div className="ds-row">
        <Tabs label="Edit colours for" value={scheme} onChange={setScheme} tabs={[{ id: 'light', label: 'Light', icon: 'sun' }, { id: 'dark', label: 'Dark', icon: 'moon' }]} />
        <span className="ds-spacer" />
        {scheme === 'dark' && !disabled && (
          <Button size="sm" variant="secondary" icon="moon" onClick={() => ed.update((c) => mergeConfigs(c, { colors: { dark: generateDarkFromLight(ed.resolved.schemes.light.colors) } }))}>
            Generate dark from light
          </Button>
        )}
      </div>
      {scheme === 'dark' && lightCustom && !darkCustom && !disabled && (
        <Notice tone="pending" icon="moon" title="Dark mode still uses the default palette">
          You customised light mode only. Use “Generate dark from light” to derive a matching dark palette, then fine-tune it.
        </Notice>
      )}
      {ROWS.map((g) => (
        <fieldset key={g.title} className="color-group" disabled={disabled}>
          <legend>{g.title}</legend>
          {g.rows.map((r) => {
            const path: Path = ['colors', scheme, r.key];
            const derived = (OPTIONAL_COLOR_KEYS as readonly string[]).includes(r.key);
            return (
              <ColorRow key={r.key} label={r.label} hint={r.hint} value={s.colors[r.key]} source={sourceOf(ed, path, derived)}
                onChange={setColor(r.key)} onReset={() => ed.clear(path)} disabled={disabled} pair={r.pair?.(s) ?? null} />
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

// ─────────────────────────── status ───────────────────────────

export function StatusPanel({ ed }: { ed: BrandEditor }) {
  const [scheme, setScheme] = useState<Scheme>('light');
  const disabled = !ed.server!.editable.status;
  const issues = ed.audit.issues.filter((i) => (i.category === 'status' || i.category === 'convention') && i.scheme === scheme);
  const customised = hasPath(ed.overrides, ['status']);
  return (
    <div className="ds-stack panel-stack">
      <Locked group="status" ed={ed} />
      <Notice tone="info" icon="shield" title="Status colours are independent of your brand palette">
        Approved, Pending, Rejected and Cancelled keep their own colours so they stay instantly recognisable. Every status always shows an icon <em>and</em> a text label, so colour is never the only signal.
      </Notice>
      <div className="ds-row">
        <Tabs label="Edit status colours for" value={scheme} onChange={setScheme} tabs={[{ id: 'light', label: 'Light', icon: 'sun' }, { id: 'dark', label: 'Dark', icon: 'moon' }]} />
        <span className="ds-spacer" />
        {customised && !disabled && <Button size="sm" variant="secondary" icon="reset" onClick={() => ed.clear(['status'])}>Restore default colours</Button>}
      </div>
      {STATUS_KEYS.map((k: StatusKey) => {
        const c = ed.resolved.schemes[scheme].status[k];
        const def = DEFAULT_STATUS_COLORS[k][scheme]!;
        return (
          <fieldset key={k} className="color-group status-group" disabled={disabled}>
            <legend>{STATUS_LABELS[k]}</legend>
            <div className="status-sample">
              <ThemeScope theme={ed.resolved} mode={scheme}><span className="status-sample__inner"><StatusBadge status={k} /><StatusBadge status={k} compact /></span></ThemeScope>
              <ContrastChip fg={c.fg} bg={c.bg} min={4.5} label={`${STATUS_LABELS[k]} text`} />
            </div>
            <ColorRow label="Background" value={c.bg} source={sourceOf(ed, ['status', k, scheme, 'bg'], true)} onChange={(hex) => ed.set(['status', k, scheme, 'bg'], hex)} onReset={() => ed.clear(['status', k, scheme, 'bg'])} disabled={disabled} />
            <ColorRow label="Text & icon" value={c.fg} source={sourceOf(ed, ['status', k, scheme, 'fg'], true)} onChange={(hex) => ed.set(['status', k, scheme, 'fg'], hex)} onReset={() => ed.clear(['status', k, scheme, 'fg'])} disabled={disabled} />
            <span className="ds-hint">Default: {def.bg} / {def.fg}</span>
          </fieldset>
        );
      })}
      {issues.length > 0 && (
        <div className="ds-stack">{issues.map((i) => (
          <Notice key={i.id} tone={i.severity === 'error' ? 'rejected' : 'pending'} title={i.title}>{i.detail}{i.fix && !disabled && <> <Button size="sm" variant="secondary" onClick={() => ed.set(i.fix!.path, i.fix!.value)}>Apply suggested colour</Button></>}</Notice>
        ))}</div>
      )}
    </div>
  );
}

// ─────────────────────────── typography, shape, mode ───────────────────────────

const RADIUS_LABEL: Record<RadiusId, string> = { none: 'Square', subtle: 'Subtle', rounded: 'Rounded', soft: 'Soft', pill: 'Pill' };
const DENSITY_LABEL: Record<DensityId, [string, string]> = { compact: ['Compact', 'More on screen'], comfortable: ['Comfortable', 'Balanced'], spacious: ['Spacious', 'Relaxed, touch-friendly'] };

function Choice<T extends string>({ name, value, options, onChange, disabled, render }: { name: string; value: T; options: readonly T[]; onChange: (v: T) => void; disabled?: boolean; render: (o: T) => React.ReactNode }) {
  return (
    <div className="choice-grid" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <label key={o} className={`choice${value === o ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}>
          <input type="radio" name={name} value={o} checked={value === o} disabled={disabled} onChange={() => onChange(o)} />
          {render(o)}
          {value === o && <Icon name="check" size={14} className="choice__tick" />}
        </label>
      ))}
    </div>
  );
}

export function StylePanel({ ed }: { ed: BrandEditor }) {
  const t = ed.resolved.typography, shape = ed.resolved.shape, mode = ed.resolved.mode;
  const dT = !ed.server!.editable.typography, dS = !ed.server!.editable.shape, dM = !ed.server!.editable.mode;
  const fontSelect = (key: 'headingFont' | 'bodyFont', label: string) => (
    <FieldShell label={label} source={sourceOf(ed, ['typography', key])} onReset={() => ed.clear(['typography', key])}>
      <Select value={t[key]} disabled={dT} onChange={(e) => ed.set(['typography', key], e.target.value)} aria-label={label}>
        {(['sans', 'serif', 'system'] as const).map((cat) => (
          <optgroup key={cat} label={{ sans: 'Sans-serif', serif: 'Serif', system: 'System' }[cat]}>
            {FONT_LIBRARY.filter((f) => f.category === cat).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </optgroup>
        ))}
      </Select>
      <p className="font-sample" style={{ fontFamily: getFont(t[key]).stack, fontSize: key === 'headingFont' ? '1.5em' : '1em', fontWeight: key === 'headingFont' ? 600 : 400 }}>
        {key === 'headingFont' ? 'Welcome to your stay' : 'Your leave request for 12–14 March was approved.'}
      </p>
    </FieldShell>
  );
  return (
    <div className="ds-stack panel-stack">
      <section className="ds-stack"><h3 className="panel-h">Typography</h3>
        <Locked group="typography" ed={ed} />
        <div className="ds-form-grid">{fontSelect('headingFont', 'Headings')}{fontSelect('bodyFont', 'Body text')}</div>
        <span className="ds-hint">Fonts come from an approved, self-hosted library, so pages stay fast and private.</span>
      </section>
      <section className="ds-stack"><h3 className="panel-h">Corners</h3>
        <Locked group="shape" ed={ed} />
        <FieldShell label="Corner style" source={sourceOf(ed, ['shape', 'radius'])} onReset={() => ed.clear(['shape', 'radius'])}>
          <Choice name="Corner style" value={shape.radius} options={RADIUS_IDS} disabled={dS} onChange={(v) => ed.set(['shape', 'radius'], v)}
            render={(o) => <><span className="radius-demo" style={{ borderRadius: Math.min(RADIUS_TOKENS[o].md, 14), ...(o === 'pill' ? { borderRadius: 14 } : {}) }} /><span>{RADIUS_LABEL[o]}</span></>} />
        </FieldShell>
        <FieldShell label="Density" source={sourceOf(ed, ['shape', 'density'])} onReset={() => ed.clear(['shape', 'density'])}>
          <Choice name="Density" value={shape.density} options={DENSITY_IDS} disabled={dS} onChange={(v) => ed.set(['shape', 'density'], v)}
            render={(o) => <><span className={`density-demo density-demo--${o}`}><i /><i /><i /></span><span>{DENSITY_LABEL[o][0]}</span><small>{DENSITY_LABEL[o][1]}</small></>} />
        </FieldShell>
      </section>
      <section className="ds-stack"><h3 className="panel-h">Appearance mode</h3>
        <Locked group="mode" ed={ed} />
        <FieldShell label="Default mode" source={sourceOf(ed, ['mode', 'default'])} onReset={() => ed.clear(['mode', 'default'])} hint="What people see before they choose for themselves. “System” follows their device.">
          <Choice<ModeId> name="Default mode" value={mode.default} options={['light', 'dark', 'system']} disabled={dM} onChange={(v) => ed.set(['mode', 'default'], v)}
            render={(o) => <><Icon name={o === 'light' ? 'sun' : o === 'dark' ? 'moon' : 'monitor'} size={20} /><span>{o[0]!.toUpperCase() + o.slice(1)}</span></>} />
        </FieldShell>
        <Checkbox label="Let people choose their own light / dark mode" hint="Their choice is remembered on every device they sign in from." checked={mode.allowUserOverride} disabled={dM}
          onChange={(e) => ed.set(['mode', 'allowUserOverride'], e.target.checked)} />
      </section>
    </div>
  );
}

