import { useCallback, useEffect, useRef, useState } from 'react';
import type { StepState } from '@staffhub/audit-core';
import { api, ApiError } from '../api.ts';
import type { AuditFile, AuditView, RunView } from './types.ts';

const HEARTBEAT_MS = 30_000;
const POLL_MS = 8_000;

/**
 * One audit date of one property, as seen by this person.
 *  - Auditors take the edit lock automatically when it is free; the lock token lives only in memory + sessionStorage.
 *  - Everyone else (managers, administrators, an auditor who is locked out) gets a live, read-only view that refreshes itself.
 *  - If the lock is taken over, the next write fails with `locked` and the view flips to read-only without losing anything typed elsewhere.
 */
export function useAudit(propertyId: string | null, date: string, canWork: boolean) {
  const [view, setView] = useState<AuditView | null>(null);
  const [files, setFiles] = useState<AuditFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const key = `audit-lock:${propertyId}:${date}`;
  const lockHeader = useCallback(() => (token.current ? { 'x-audit-lock': token.current } : undefined), []);

  const setToken = useCallback((t: string | null) => {
    token.current = t;
    try { if (t) sessionStorage.setItem(key, t); else sessionStorage.removeItem(key); } catch { /* storage unavailable */ }
  }, [key]);

  const load = useCallback(async (quiet = false) => {
    if (!propertyId) return null;
    try {
      const v = await api.get<AuditView>(`/api/audit/run?propertyId=${propertyId}&date=${date}`, lockHeader());
      if (v.exists && token.current && !v.lock.heldByMe) { setToken(null); if (v.run.status === 'open') setLost(v.lock.heldBy ? `${v.lock.heldBy} is now editing this audit.` : 'You no longer hold the edit lock.'); }
      setView(v);
      if (v.exists) setFiles((await api.get<{ files: AuditFile[] }>(`/api/audit/run/${v.run.id}/files`)).files);
      else setFiles([]);
      setError(null);
      return v;
    } catch (e) { if (!quiet) setError(e instanceof ApiError ? e.message : 'Could not load the audit.'); return null; }
  }, [propertyId, date, lockHeader, setToken]);

  // (Re)load whenever the property or date changes, trying to resume a lock this browser already held.
  useEffect(() => {
    setView(null); setLost(null);
    try { token.current = sessionStorage.getItem(key); } catch { token.current = null; }
    let cancelled = false;
    (async () => {
      const v = await load();
      // Resume or take a free lock automatically. A live lock held by someone else is never taken silently.
      if (cancelled || !v || !canWork || !v.exists || v.run.status !== 'open' || !v.canEdit || v.lock.heldByMe || v.lock.heldBy) return;
      try { await acquire(); } catch { /* the banner explains */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, date, canWork]);

  async function acquire(path = '/api/audit/run/open', body?: unknown) {
    const r = await api.post<RunView>(path, body ?? { propertyId, date });
    setToken(r.lockToken ?? null); setLost(null);
    setView(r);
    setFiles((await api.get<{ files: AuditFile[] }>(`/api/audit/run/${r.run.id}/files`)).files);
    return r;
  }

  const holding = !!(view && view.exists && token.current && view.lock.heldByMe);

  // Keep the lock alive while held; watch (read-only) otherwise so a manager sees progress as it happens.
  useEffect(() => {
    if (!view?.exists) return;
    const id = view.run.id;
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      if (token.current && view.lock.heldByMe) {
        try { await api.post(`/api/audit/run/${id}/heartbeat`, {}, lockHeader()); }
        catch (e) { if (e instanceof ApiError && e.status === 409) await load(true); }
      } else await load(true);
    }, token.current && view.lock.heldByMe ? HEARTBEAT_MS : POLL_MS);
    return () => clearInterval(t);
  }, [view, load, lockHeader]);

  // Best-effort release when leaving the page, so the next auditor does not wait for the lock to go stale.
  useEffect(() => () => {
    if (token.current && view?.exists) void fetch(`/api/audit/run/${view.run.id}/release`, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'x-requested-with': 'staffhub', 'x-audit-lock': token.current, 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
  }, [view?.exists ? view.run.id : null]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try { return await fn(); }
    catch (e) {
      if (e instanceof ApiError && (e.code === 'locked' || e.code === 'closed')) { await load(true); setLost(e.code === 'closed' ? 'This audit has been closed.' : e.message); }
      else setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      return undefined;
    }
  }

  const start = () => guarded(() => acquire());
  const takeOver = () => guarded(async () => { if (view?.exists) await acquire(`/api/audit/run/${view.run.id}/takeover`, {}); });

  const setStep = (stepId: string, patch: Partial<Pick<StepState, 'done' | 'initials' | 'note' | 'subs'>>) => guarded(async () => {
    if (!view?.exists) return;
    // optimistic: the checkbox responds instantly, the server answer then replaces it
    setView((v) => v && v.exists ? { ...v, states: { ...v.states, [stepId]: { ...(v.states[stepId] ?? { done: false, initials: '', note: '', subs: [] }), ...patch } } } : v);
    const r = await api.put<{ state: StepState; progress: RunView['progress']; rolled: boolean }>(`/api/audit/run/${view.run.id}/step/${stepId}`, patch, lockHeader());
    setView((v) => v && v.exists ? { ...v, states: { ...v.states, [stepId]: r.state }, progress: r.progress, rolled: r.rolled } : v);
  });

  const setMeta = (m: { nightAuditor?: string; nightManager?: string }) => guarded(async () => {
    if (!view?.exists) return;
    setView((v) => v && v.exists ? { ...v, run: { ...v.run, ...m } } : v);
    await api.put(`/api/audit/run/${view.run.id}/meta`, m, lockHeader());
  });

  const close = (body: { acknowledgeIncomplete?: boolean; reason?: string }) => (async () => {
    if (!view?.exists) return { ok: false as const, error: 'No audit.' };
    try { await api.post(`/api/audit/run/${view.run.id}/close`, body, lockHeader()); setToken(null); await load(true); return { ok: true as const }; }
    catch (e) { return { ok: false as const, error: e instanceof ApiError ? e.message : 'Could not close.', code: e instanceof ApiError ? e.code : undefined, remaining: e instanceof ApiError ? (e.extra.remaining as number | undefined) : undefined }; }
  })();

  const reopen = () => guarded(async () => { if (view?.exists) { await api.post(`/api/audit/run/${view.run.id}/reopen`, {}); await load(true); } });

  const upload = (stepId: string, file: File) => guarded(async () => {
    if (!view?.exists) return;
    await api.upload(`/api/audit/run/${view.run.id}/files?step=${encodeURIComponent(stepId)}`, file, { ...lockHeader(), 'x-file-name': encodeURIComponent(file.name) });
    await load(true);
  });
  const removeFile = (id: string) => guarded(async () => { await api.del(`/api/audit/files/${id}`, lockHeader()); await load(true); });

  return { view, files, error, setError, lost, holding, load, start, takeOver, setStep, setMeta, close, reopen, upload, removeFile, lockHeader };
}
export type AuditApi = ReturnType<typeof useAudit>;
