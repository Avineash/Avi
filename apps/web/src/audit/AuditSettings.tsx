import { useEffect, useState } from 'react';
import { DEFAULT_TEMPLATE, allSteps, type AuditTemplate } from '@staffhub/audit-core';
import { Button, Card, Notice, Select, Textarea } from '@staffhub/ui';
import { api, ApiError } from '../api.ts';

interface AccessUser { id: string; name: string; email: string; role: string; property: string | null; access: 'auditor' | 'manager' | 'both' | null }

/** Administrator tools: who may use the module, and the checklist each property follows. */
export function AuditSettings({ propertyId, propertyName, onChanged }: { propertyId: string; propertyName: string; onChanged: () => void }) {
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [json, setJson] = useState('');
  const [version, setVersion] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState('');

  const loadUsers = () => api.get<{ users: AccessUser[] }>('/api/audit/access').then((r) => setUsers(r.users));
  useEffect(() => { void loadUsers(); }, []);
  useEffect(() => {
    api.get<{ version: number; template: AuditTemplate }>(`/api/audit/template?propertyId=${propertyId}`).then((r) => { setJson(JSON.stringify(r.template, null, 2)); setVersion(r.version); setErrors([]); setSaved(''); });
  }, [propertyId]);

  async function setAccess(id: string, access: string) {
    await api.put(`/api/audit/access/${id}`, { access: access || null });
    await loadUsers(); onChanged();
  }
  async function saveTemplate() {
    setErrors([]); setSaved('');
    let template: unknown;
    try { template = JSON.parse(json); } catch (e) { return setErrors([`This is not valid JSON: ${(e as Error).message}`]); }
    try { const r = await api.put<{ version: number }>(`/api/audit/template?propertyId=${propertyId}`, { template }); setVersion(r.version); setSaved(`Saved as version ${r.version}. New audits use it; audits already started keep theirs.`); }
    catch (e) { setErrors(e instanceof ApiError && Array.isArray(e.extra.errors) ? (e.extra.errors as string[]) : [e instanceof Error ? e.message : 'Could not save.']); }
  }

  return (
    <div className="ds-stack">
      <Card title="Who can use the night audit">
        <p className="ds-hint">Auditors run the checklist and tick tasks. Managers see everything and can’t change it. “Both” can switch between the two. Administrators can always view.</p>
        {!users ? <p className="ds-muted">Loading…</p> : (
          <div className="au-scroll">
            <table className="au-tbl">
              <thead><tr><th>Name</th><th>Property</th><th>Workforce role</th><th>Night audit</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.name}</strong><div className="ds-hint">{u.email}</div></td>
                    <td>{u.property}</td>
                    <td>{u.role.replace('_', ' ')}</td>
                    <td><Select aria-label={`Night audit access for ${u.name}`} value={u.access ?? ''} onChange={(e) => void setAccess(u.id, e.target.value)} style={{ minWidth: 150 }}>
                      <option value="">No access</option><option value="auditor">Night auditor</option><option value="manager">Night manager</option><option value="both">Auditor + manager</option>
                    </Select></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Checklist · ${propertyName}`}>
        <p className="ds-hint">{version === 0 ? 'Using the standard checklist.' : `Custom checklist, version ${version}.`} Each step needs a unique <code>id</code>. Steps marked <code>"key": true</code> appear in the simplified view; <code>"tool": "ccrec"</code> adds the built-in card reconciliation; any other tool id needs an entry under <code>links</code>.</p>
        <Textarea className="au-json" value={json} spellCheck={false} onChange={(e) => { setJson(e.target.value); setSaved(''); }} aria-label="Checklist JSON" />
        {errors.length > 0 && <Notice tone="rejected" title="The checklist has problems"><ul>{errors.slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul></Notice>}
        {saved && <Notice tone="approved" title={saved} />}
        <div className="ds-row">
          <Button icon="save" onClick={() => void saveTemplate()}>Save checklist</Button>
          <Button variant="secondary" icon="reset" onClick={() => { setJson(JSON.stringify(DEFAULT_TEMPLATE, null, 2)); setSaved(''); }}>Load the standard checklist</Button>
          <span className="ds-hint">{(() => { try { const t = JSON.parse(json); return `${allSteps(t).length} steps`; } catch { return ''; } })()}</span>
        </div>
      </Card>
    </div>
  );
}
