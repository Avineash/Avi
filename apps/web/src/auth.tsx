import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api.ts';
import type { Me } from './types.ts';

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}
const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => { const c = useContext(Ctx); if (!c) throw new Error('useAuth outside AuthProvider'); return c; };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try { setMe(await api.get<Me>('/api/me')); }
    catch (e) { if (e instanceof ApiError && e.status === 401) setMe(null); else throw e; }
  }, []);

  useEffect(() => { reload().catch(() => setMe(null)).finally(() => setLoading(false)); }, [reload]);

  const login = useCallback(async (email: string, password: string) => {
    await api.post('/api/auth/login', { email, password });
    await reload();
  }, [reload]);
  const logout = useCallback(async () => { await api.post('/api/auth/logout'); setMe(null); }, []);

  return <Ctx.Provider value={{ me, loading, login, logout, reload }}>{children}</Ctx.Provider>;
}
