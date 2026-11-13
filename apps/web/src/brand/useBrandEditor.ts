import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  auditTheme, deletePath, diffConfigs, fingerprint, resolveTheme, setPath,
  type AuditReport, type ConfigGroup, type OverridePolicy, type Path, type ResolvedTheme, type ThemeConfig,
} from '@staffhub/theme-core';
import { api, ApiError } from '../api.ts';

export interface ScopeSummary { key: string; type: 'company' | 'property'; name: string; activeVersion: number | null; hasUnpublishedChanges: boolean; overrides: boolean | null }
export interface ServerState {
  scope: { key: string; type: 'company' | 'property'; propertyId: string | null; name: string };
  draft: { config: ThemeConfig; revision: number; hasUnpublishedChanges: boolean; updatedAt: string | null };
  active: { version: number; config: ThemeConfig; publishedAt: string; publishedBy: string | null; note: string | null; kind: string } | null;
  inheritedLayers: ThemeConfig[];
  policy: OverridePolicy;
  editable: Record<ConfigGroup, boolean>;
  canEditPolicy: boolean;
}
export interface VersionInfo {
  version: number; kind: 'publish' | 'rollback'; restoredFrom: number | null; note: string | null; author: string | null; createdAt: string;
  accessibilityAcknowledged: boolean; active: boolean; summary: Array<{ group: ConfigGroup; label: string; count: number }>;
}

const HISTORY_LIMIT = 50;
const NO_LAYERS: ThemeConfig[] = [];

/**
 * State machine behind Brand & Appearance for one scope (company, or one property).
 *  - `overrides`   : the layer being edited (sparse: only what this scope changes).
 *  - `resolved`    : system default → inherited layers → overrides, i.e. exactly what users will see once published.
 *  - nothing here touches the published theme until `publish()` succeeds.
 */
export function useBrandEditor(scopeKey: string) {
  const [server, setServer] = useState<ServerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ThemeConfig>({});
  const [saved, setSaved] = useState<ThemeConfig>({});
  const [revision, setRevision] = useState(0);
  const [past, setPast] = useState<ThemeConfig[]>([]);
  const [future, setFuture] = useState<ThemeConfig[]>([]);
  const [versionPreview, setVersionPreview] = useState<{ version: number; config: ThemeConfig } | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'publish' | 'reset' | 'restore'>(null);
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  // Latest values for async callbacks. `save` also writes here synchronously: state setters only take effect on the
  // next render, so a `publish` that runs right after `save` would otherwise send a stale revision (a 409).
  const live = useRef({ overrides, revision, saved });
  live.current = { overrides, revision, saved };

  const load = useCallback(async () => {
    setError(null);
    const s = await api.get<ServerState>(`/api/brand/scope/${scopeKey}`);
    setServer(s); setOverrides(s.draft.config); setSaved(s.draft.config); setRevision(s.draft.revision);
    setPast([]); setFuture([]); setVersionPreview(null);
    return s;
  }, [scopeKey]);

  const loadVersions = useCallback(async () => {
    setVersions((await api.get<{ versions: VersionInfo[] }>(`/api/brand/scope/${scopeKey}/versions`)).versions);
  }, [scopeKey]);

  useEffect(() => { setServer(null); setVersions(null); load().catch((e) => setError(e.message)); }, [load]);

  const commit = useCallback((next: ThemeConfig) => {
    setPast((p) => [...p.slice(-HISTORY_LIMIT), live.current.overrides]);
    setFuture([]);
    setOverrides(next);
    setVersionPreview(null);
  }, []);

  /** Repeated edits to the same field within ~1s (dragging a colour, typing a name) collapse into one undo step. */
  const lastEdit = useRef<{ key: string; t: number } | null>(null);
  const set = useCallback((path: Path, value: unknown) => {
    const key = path.join('.'), t = Date.now();
    const coalesce = lastEdit.current?.key === key && t - lastEdit.current.t < 1200;
    lastEdit.current = { key, t };
    const next = setPath(live.current.overrides, path, value);
    if (coalesce) { setOverrides(next); setFuture([]); setVersionPreview(null); } else commit(next);
  }, [commit]);
  const clear = useCallback((path: Path) => { lastEdit.current = null; commit(deletePath(live.current.overrides, path)); }, [commit]);
  const update = useCallback((fn: (c: ThemeConfig) => ThemeConfig) => { lastEdit.current = null; commit(fn(live.current.overrides)); }, [commit]);
  const undo = useCallback(() => setPast((p) => { if (!p.length) return p; setFuture((f) => [live.current.overrides, ...f]); setOverrides(p[p.length - 1]!); return p.slice(0, -1); }), []);
  const redo = useCallback(() => setFuture((f) => { if (!f.length) return f; setPast((p) => [...p, live.current.overrides]); setOverrides(f[0]!); return f.slice(1); }), []);

  const inheritedLayers = server?.inheritedLayers ?? NO_LAYERS;
  const inherited: ResolvedTheme = useMemo(() => resolveTheme(...inheritedLayers), [inheritedLayers]);
  const shown = versionPreview?.config ?? overrides;
  const resolved: ResolvedTheme = useMemo(() => resolveTheme(...inheritedLayers, shown), [inheritedLayers, shown]);
  const audit: AuditReport = useMemo(() => auditTheme(resolved), [resolved]);

  const dirty = fingerprint(overrides) !== fingerprint(saved);
  const differsFromActive = useMemo(() => diffConfigs(server?.active?.config ?? {}, overrides).length > 0, [server, overrides]);
  const changes = useMemo(() => diffConfigs(server?.active?.config ?? {}, overrides), [server, overrides]);

  const save = useCallback(async () => {
    setBusy('save'); setError(null);
    try {
      const config = live.current.overrides;
      const r = await api.put<{ revision: number }>(`/api/brand/scope/${scopeKey}/draft`, { config, baseRevision: live.current.revision });
      live.current = { ...live.current, revision: r.revision, saved: config };
      setRevision(r.revision); setSaved(config);
      setServer((s) => s && { ...s, draft: { ...s.draft, revision: r.revision, hasUnpublishedChanges: diffConfigs(s.active?.config ?? {}, config).length > 0 } });
      return r.revision;
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save.'); throw e; }
    finally { setBusy(null); }
  }, [scopeKey]);

  const reset = useCallback(async () => {
    setBusy('reset'); setError(null);
    try { await api.del(`/api/brand/scope/${scopeKey}/draft`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not reset.'); throw e; }
    finally { setBusy(null); }
  }, [scopeKey, load]);

  /** Saves the working copy if needed, then publishes exactly that revision. Errors (incl. the 422 accessibility report) propagate to the caller. */
  const publish = useCallback(async (opts: { note: string; acknowledgeAccessibility: boolean }) => {
    setBusy('publish'); setError(null);
    try {
      const revision = fingerprint(live.current.overrides) !== fingerprint(live.current.saved) ? await save() : live.current.revision;
      const res = await api.post<{ version: number }>(`/api/brand/scope/${scopeKey}/publish`, { baseRevision: revision, ...opts });
      await load(); setVersions(null);
      return res;
    } finally { setBusy(null); }
  }, [scopeKey, save, load]);

  const restore = useCallback(async (version: number) => {
    setBusy('restore'); setError(null);
    try { await api.post(`/api/brand/scope/${scopeKey}/rollback`, { version }); await load(); await loadVersions(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not restore.'); throw e; }
    finally { setBusy(null); }
  }, [scopeKey, load, loadVersions]);

  const previewVersion = useCallback(async (version: number | null) => {
    if (version === null) return setVersionPreview(null);
    const v = await api.get<{ config: ThemeConfig }>(`/api/brand/scope/${scopeKey}/versions/${version}`);
    setVersionPreview({ version, config: v.config });
  }, [scopeKey]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  return {
    server, error, setError, overrides, resolved, inherited, audit, dirty, differsFromActive, changes, busy, revision,
    canUndo: past.length > 0, canRedo: future.length > 0, versions, versionPreview,
    set, clear, update, undo, redo, save, reset, publish, restore, previewVersion, loadVersions, reload: load,
  };
}
export type BrandEditor = ReturnType<typeof useBrandEditor>;
