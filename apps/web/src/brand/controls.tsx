import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { contrastRatio, normalizeHex } from '@staffhub/theme-core';
import { Button, Icon } from '@staffhub/ui';
import { api, ApiError, assetUrl } from '../api.ts';

export function ratioText(fg: string, bg: string) { return `${(Math.floor(contrastRatio(fg, bg) * 100) / 100).toFixed(2)}:1`; }

/** Contrast result as icon + text + sample, so it never relies on colour. */
export function ContrastChip({ fg, bg, min, label }: { fg: string; bg: string; min: number; label: string }) {
  const r = contrastRatio(fg, bg), ok = r >= min;
  return (
    <span className={`contrast-chip ${ok ? 'is-pass' : 'is-fail'}`} title={`${label}: ${ratioText(fg, bg)} (needs ${min}:1)`}>
      <span className="contrast-chip__sample" style={{ color: fg, background: bg }} aria-hidden="true">Aa</span>
      <Icon name={ok ? 'check' : 'alert'} size={13} />
      <span>{ratioText(fg, bg)}</span>
      <span className="ds-sr-only">{ok ? 'passes' : 'fails'} WCAG AA {min}:1 for {label}</span>
    </span>
  );
}

export type Source = 'custom' | 'inherited' | 'auto' | 'default' | 'overridden';
const SOURCE_LABEL: Record<Source, string> = { custom: 'Custom', inherited: 'Inherited', auto: 'Auto', default: 'Default', overridden: 'Overrides company' };

export function SourceTag({ source }: { source: Source }) { return <span className={`source-tag source-tag--${source}`}>{SOURCE_LABEL[source]}</span>; }

export function ColorRow({ label, hint, value, source, onChange, onReset, disabled, pair }: {
  label: string; hint?: string; value: string; source: Source; onChange: (hex: string) => void; onReset?: () => void; disabled?: boolean;
  pair?: { fg: string; bg: string; min: number; label: string } | null;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = !!normalizeHex(text);
  return (
    <div className="color-row">
      <label className="color-row__swatch" style={{ background: value }} title={`Pick ${label}`}>
        <input type="color" value={value} disabled={disabled} aria-label={`${label} colour picker`} onChange={(e) => onChange(e.target.value.toLowerCase())} />
      </label>
      <div className="color-row__main">
        <label htmlFor={id} className="color-row__label">{label} <SourceTag source={source} /></label>
        {hint && <span className="ds-hint">{hint}</span>}
      </div>
      <input id={id} className={`ds-input color-row__hex${valid ? '' : ' is-invalid'}`} value={text} disabled={disabled} spellCheck={false} maxLength={7}
        aria-invalid={!valid} aria-label={`${label} hex value`}
        onChange={(e) => { setText(e.target.value); const n = normalizeHex(e.target.value); if (n && n !== value) onChange(n); }}
        onBlur={() => setText(value)} />
      <div className="color-row__tail">
        {pair && <ContrastChip {...pair} />}
        {onReset && source !== 'default' && source !== 'auto' && source !== 'inherited' && !disabled
          ? <Button size="sm" variant="ghost" icon="reset" onClick={onReset} aria-label={`Reset ${label}`} title="Reset" />
          : <span className="color-row__noreset" />}
      </div>
    </div>
  );
}

/** Wraps any control with its label, inheritance state and reset. */
export function FieldShell({ label, hint, source, onReset, children }: { label: string; hint?: ReactNode; source: Source; onReset?: () => void; children: ReactNode }) {
  return (
    <div className="field-shell">
      <div className="field-shell__head">
        <span className="ds-label">{label} <SourceTag source={source} /></span>
        {onReset && (source === 'custom' || source === 'overridden') && <Button size="sm" variant="ghost" icon="reset" onClick={onReset}>Reset</Button>}
      </div>
      {children}
      {hint && <div className="ds-hint">{hint}</div>}
    </div>
  );
}

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Upload → server inspects the real bytes (type, size, unsafe SVG) → returns an asset id. Preview shows instantly. */
export function ImageUploader({ kind, label, hint, assetId, source, onChange, disabled, onDark, max = 512 }: {
  kind: 'logo' | 'logoDark' | 'favicon'; label: string; hint: string; assetId: string | null; source: Source;
  onChange: (id: string | null | undefined) => void; disabled?: boolean; onDark?: boolean; max?: number;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function take(file: File | undefined) {
    if (!file) return;
    setError('');
    const okType = TYPES.includes(file.type) || (kind === 'favicon' && (file.type === 'image/x-icon' || file.type === 'image/vnd.microsoft.icon'));
    if (!okType) return setError(`Use a PNG, JPEG, WebP or SVG file${kind === 'favicon' ? ' (ICO also works)' : ''}.`);
    if (file.size > max * 1024) return setError(`That file is ${Math.round(file.size / 1024)} KB. The limit is ${max} KB.`);
    const url = URL.createObjectURL(file);
    setLocal(url); setBusy(true);
    try {
      const r = await api.upload<{ id: string }>(`/api/brand/assets?kind=${kind}`, file);
      onChange(r.id); setLocal(null);
    } catch (e) { setLocal(null); setError(e instanceof ApiError ? e.message : 'Upload failed.'); }
    finally { setBusy(false); URL.revokeObjectURL(url); }
  }

  const src = local ?? assetUrl(assetId);
  return (
    <div className="uploader">
      <div className="uploader__head"><span className="ds-label">{label} <SourceTag source={source} /></span></div>
      <div className={`uploader__zone${over ? ' is-over' : ''}${onDark ? ' on-dark' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) void take(e.dataTransfer.files[0]); }}>
        {src ? <img src={src} alt={`${label} preview`} className={kind === 'favicon' ? 'uploader__fav' : 'uploader__img'} />
          : <span className="ds-muted uploader__empty"><Icon name="image" size={22} />{assetId === null && source !== 'inherited' ? 'No image' : 'Drop an image here'}</span>}
      </div>
      <div className="ds-row">
        <input ref={fileRef} id={inputId} type="file" hidden accept={[...TYPES, ...(kind === 'favicon' ? ['image/x-icon', '.ico'] : [])].join(',')} onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
        <Button size="sm" variant="secondary" icon="upload" disabled={disabled || busy} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : src ? 'Replace' : 'Upload'}</Button>
        {src && !disabled && <Button size="sm" variant="ghost" icon="trash" onClick={() => onChange(null)}>Remove</Button>}
        {(source === 'custom' || source === 'overridden') && !disabled && <Button size="sm" variant="ghost" icon="reset" onClick={() => onChange(undefined)}>Use inherited</Button>}
      </div>
      <div className="ds-hint">{hint}</div>
      {error && <div className="ds-error" role="alert"><Icon name="alert" size={14} /> {error}</div>}
    </div>
  );
}

export function LockNotice({ children }: { children: ReactNode }) {
  return <div className="lock-notice"><Icon name="lock" size={16} /><span>{children}</span></div>;
}
