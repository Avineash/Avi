import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ThemeConfig } from '@staffhub/theme-core';
import { Button, Card, Field, Input, Notice, BrandLogo } from '@staffhub/ui';
import { api, ApiError, assetUrl } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { useAppearance } from '../theme/ThemeProvider.tsx';
import type { PublishedTheme } from '../types.ts';

interface Demo { password: string; accounts: Array<{ email: string; name: string; role: string; auditAccess: 'auditor' | 'manager' | 'both' | null; company: string; companySlug: string; property: string | null }> }

const ROLE = { company_admin: 'Company admin', property_admin: 'Property admin', manager: 'Manager', employee: 'Employee' } as Record<string, string>;

export function Login({ onBrand }: { onBrand: (c: ThemeConfig | undefined) => void }) {
  const { login } = useAuth();
  const { theme } = useAppearance();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const company = params.get('company'), property = params.get('property');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<Demo | null>(null);

  // Brand the sign-in page with the published theme of the company in the URL (?company=aurora&property=harbour).
  useEffect(() => {
    if (!company) return;
    api.get<PublishedTheme>(`/api/public/brand?company=${encodeURIComponent(company)}${property ? `&property=${encodeURIComponent(property)}` : ''}`)
      .then((t) => onBrand(t.config)).catch(() => onBrand(undefined));
  }, [company, property, onBrand]);
  useEffect(() => { api.get<Demo>('/api/public/demo-accounts').then(setDemo).catch(() => setDemo(null)); }, []);

  async function submit(e?: FormEvent, creds = { email, password }) {
    e?.preventDefault();
    setBusy(true); setError('');
    try { await login(creds.email, creds.password); nav('/', { replace: true }); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }

  const id = theme.identity;
  const isPlatform = id.companyName === 'Your Company'; // placeholder default: no company context yet
  const displayName = isPlatform ? 'VOCO StaffHub' : id.displayName;
  return (
    <div className="ds-root login-page">
      <div className="login-wrap">
        <div className="login-brand">
          <BrandLogo name={displayName} logoUrl={assetUrl(id.logoAssetId)} logoDarkUrl={assetUrl(id.logoDarkAssetId)} height={52} />
          {id.tagline && <p className="ds-muted">{id.tagline}</p>}
        </div>
        <Card>
          <form className="ds-stack" onSubmit={(e) => submit(e)}>
            <h1 className="login-title">Sign in</h1>
            {error && <Notice tone="rejected" title={error} />}
            <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        </Card>

        {demo && (
          <Card title="Demo accounts" className="demo-card">
            <p className="ds-muted" style={{ marginBottom: 12 }}>Pick an account to explore each company’s branding. Password for all: <code>{demo.password}</code></p>
            <div className="demo-list">
              {demo.accounts.map((a) => (
                <button key={a.email} type="button" className="demo-chip" onClick={() => { setEmail(a.email); setPassword(demo.password); setParams({ company: a.companySlug }); void submit(undefined, { email: a.email, password: demo.password }); }}>
                  <strong>{a.name}</strong>
                  <span>{a.auditAccess ? `Night ${a.auditAccess === 'both' ? 'auditor + manager' : a.auditAccess}` : ROLE[a.role]} · {a.property ?? a.company}</span>
                </button>
              ))}
            </div>
          </Card>
        )}
        <p className="ds-muted login-foot">Powered by VOCO StaffHub</p>
      </div>
    </div>
  );
}
