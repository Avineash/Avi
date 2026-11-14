'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

/** Tiny fetch hook: { data, error, loading, reload }. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    try { const d = await api<T>(path); if (my === seq.current) { setData(d); setError(null); } }
    catch (e) { if (my === seq.current) setError(e as ApiError); }
    finally { if (my === seq.current) setLoading(false); }
  }, [path]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(!!path); reload(); }, [reload, ...deps]);
  return { data, error, loading, reload, setData };
}

/** Server-Sent Events with auto-reconnect (EventSource handles backoff) and a polling safety net. */
export function useEventStream(url: string | null, onEvent: (type: string, data: any) => void, fallbackPoll?: () => void, pollMs = 8000) {
  const handler = useRef(onEvent); handler.current = onEvent;
  const poll = useRef(fallbackPoll); poll.current = fallbackPoll;
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url, { withCredentials: true });
    const types = ['order.paid', 'order.status', 'order.updated', 'payment.updated', 'payment.duplicate', 'hello'];
    types.forEach((t) => es.addEventListener(t, (e) => { try { handler.current(t, JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ } }));
    es.onopen = () => setLive(true); es.onerror = () => setLive(false);
    const timer = poll.current ? setInterval(() => poll.current?.(), pollMs) : undefined;
    return () => { es.close(); if (timer) clearInterval(timer); };
  }, [url, pollMs]);
  return live;
}

export function useCountdown(until: string | Date | null | undefined) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!until) return;
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000)));
    tick(); const i = setInterval(tick, 1000); return () => clearInterval(i);
  }, [until]);
  return left;
}

export function useLocalState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  // Read once on mount; only start persisting after hydration so the initial value never clobbers stored data.
  useEffect(() => { try { const s = localStorage.getItem(key); if (s) setV(JSON.parse(s)); } catch { /* storage blocked */ } setHydrated(true); }, [key]);
  useEffect(() => { if (hydrated) try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v, hydrated]);
  return [v, setV] as const;
}
